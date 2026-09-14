import { test, expect, type Page, type TestInfo } from '@playwright/test';

// Production player, controller, UI and native Three.js renderer. Only the
// highway song stream and its transport clock are deterministic test inputs.
// All non-highway WebSockets continue through the real browser implementation.
async function installSongFixture(page: Page, authored = true) {
  await page.route('**/api/profile', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { display_name: 'Harmony tester', player_hash: 'harmony-test', onboarded: true } });
    } else await route.continue();
  });
  await page.addInitScript((authored: boolean) => {
    (window as any).__hgErrorLocations = [];
    window.addEventListener('error', event => {
      (window as any).__hgErrorLocations.push({ message: event.message, filename: event.filename, line: event.lineno });
    });
    localStorage.setItem('vizSelection', 'highway_3d');
    localStorage.setItem('feedback.harmonicGuide.preferences.v1', JSON.stringify({
      enabled: true, thresholdMode: 'beats', minimumBeats: 4, minimumSeconds: 3,
      showPositions: true, showNoteNames: true,
    }));
    localStorage.setItem('h3d_bg_style', 'off');
    localStorage.setItem('h3d_bg_bloom', 'false');
    localStorage.setItem('h3d_bg_sparks', 'false');

    const NativeWebSocket = window.WebSocket;
    class SongSocket extends EventTarget {
      url: string;
      readyState = NativeWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string) {
        super(); this.url = url;
        setTimeout(() => {
          if (this.readyState === NativeWebSocket.CLOSED) return;
          this.readyState = NativeWebSocket.OPEN;
          this.onopen?.(new Event('open'));
          this.emit({
            type: 'song_info', artist: 'Harmony guide test', title: 'A minor progression',
            arrangement: 'Lead', arrangement_smart_name: 'Lead', arrangement_index: 0,
            naming_mode: 'smart', instrument: 'guitar', tuning: [0, 0, 0, 0, 0, 0],
            stringCount: 6, capo: 0, duration: 30, audio_url: null,
            harmonic_guide_revision: sessionStorage.getItem('hg-test-revision') || 'revision-one',
            has_keys: authored, has_harmony: authored,
          });
          this.emit({ type: 'beats', data: Array.from({ length: 61 }, (_, i) => ({ time: i / 2, measure: i % 4 === 0 ? i / 4 : -1 })) });
          this.emit({ type: 'sections', data: [{ time: 0, name: 'Verse' }] });
          if (authored) this.emit({ type: 'keys', version: 1, data: [{ t: 0, key: 'Am', scale: 'natural_minor' }] });
          if (authored) this.emit({ type: 'harmony', version: 1, data: [
            { t: 0, root: 'A', quality: 'min' }, { t: 4, root: 'F', quality: 'maj' },
            { t: 8, root: 'C', quality: 'maj' }, { t: 12, root: 'G', quality: 'maj' },
            { t: 16, root: 'A', quality: 'min' }, { t: 20, root: 'F', quality: 'maj' },
          ] });
          this.emit({ type: 'anchors', data: [{ time: 0, fret: 5, width: 4 }] });
          this.emit({ type: 'chord_templates', data: [] });
          this.emit({ type: 'notes', data: [
            { t: 1, s: 0, f: 5, sus: 1, d: 0 },
            { t: 12, s: 2, f: 7, sus: 1, d: 0 },
            { t: 22, s: 0, f: 5, sus: 2, d: 0 },
          ] });
          this.emit({ type: 'chords', data: [] });
          this.emit({ type: 'handshapes', data: [] });
          this.emit({ type: 'ready' });
        }, 0);
      }
      emit(payload: unknown) {
        if (this.readyState !== NativeWebSocket.OPEN) return;
        const event = new MessageEvent('message', { data: JSON.stringify(payload) });
        this.onmessage?.(event); this.dispatchEvent(event);
      }
      send() {}
      close() {
        this.readyState = NativeWebSocket.CLOSED;
        const event = new CloseEvent('close'); this.onclose?.(event); this.dispatchEvent(event);
      }
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const url = String(args[0]);
        if (new URL(url, location.href).pathname.startsWith('/ws/highway/')) return new SongSocket(url);
        return Reflect.construct(target, args);
      },
    });
  }, authored);
}

async function openSong(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).playSong === 'function'
    && typeof (window as any).feedBackViz_highway_3d === 'function' && !!(window as any).highway);
  await page.evaluate(() => {
    const w = window as any;
    w.__hgTime = 0;
    // An absent test audio file should not pull time back to zero between
    // assertions. Exercise the real freeze/seek state and display clocks.
    w.highway.setTime = () => w.highway.freezeTime(w.__hgTime);
    const originalFactory = w.feedBackViz_highway_3d;
    w.feedBackViz_highway_3d = () => {
      const renderer = originalFactory();
      const originalInit = renderer.init, originalDraw = renderer.draw;
      renderer.init = function (canvas: HTMLCanvasElement, bundle: any) {
        w.__hgNativeReady = false;
        originalInit.call(renderer, canvas, bundle);
        renderer.readyPromise.then(() => { w.__hgNativeReady = true; }, () => { /* a replaced init is deliberately cancelled */ });
      };
      renderer.draw = function (bundle: any) {
        originalDraw.call(renderer, bundle);
        const guide = bundle.harmonicGuide;
        w.__hgFrame = guide ? {
          time: bundle.currentTime, enabled: guide.enabled, alpha: guide.alpha,
          chord: guide.state?.current?.label, targetPc: guide.state?.targetPc,
          scale: guide.state?.scale?.id,
          labelMode: guide.options?.labelMode,
          markers: guide.markers.map((m: any) => ({ pc: m.pc, fret: m.fret, string: m.string,
            degree: m.degreeLabel, tonic: m.isTonic, target: m.isTarget })),
          positionCount: guide.positions.length,
        } : null;
      };
      return renderer;
    };
    w.setViz('highway_3d');
  });
  await page.evaluate(() => (window as any).playSong('mock-harmonic-guide.feedpak', 0));
  await expect(page.locator('#player')).toHaveClass(/active/);
  await page.waitForFunction(() => (window as any).__hgNativeReady === true
    && (window as any).highway?.getSongInfo?.().title === 'A minor progression'
    && (window as any).__hgFrame?.enabled === true);
  await expect(page.locator('.h3d-wrap')).toHaveCount(1);
  await expect(page.locator('.hg-strip')).toBeVisible();
}

async function atTime(page: Page, time: number) {
  await page.evaluate(t => {
    const w = window as any; w.__hgTime = t; w.highway.freezeTime(t);
  }, time);
  await expect.poll(() => page.evaluate(() => (window as any).__hgFrame?.time)).toBe(time);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

test('native 3D guide follows harmony through rests, seeks, responsive views and renderer lifecycle', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /renderer draw:|renderer init:|\[3D-Hwy\]/.test(message.text())) errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await installSongFixture(page); await openSong(page);
  await atTime(page, 1.5);
  await expect(page.locator('.hg-key')).toHaveText('Key: A minor');
  await expect(page.locator('.hg-scale')).toHaveText('Scale: A natural minor');
  await expect(page.locator('.hg-chord')).toHaveText('Am');
  expect(await page.evaluate(() => (window as any).__hgFrame.alpha)).toBe(0);
  await expect(page.locator('.hg-legend')).toBeHidden();
  await screenshot(page, testInfo, 'harmony-guide-chart-active');

  await atTime(page, 2.5);
  const tonicFrame = await page.evaluate(() => (window as any).__hgFrame);
  expect(tonicFrame.alpha).toBe(1);
  expect(tonicFrame.labelMode).toBe('degrees');
  expect(tonicFrame.markers.filter((m: any) => m.tonic).every((m: any) => m.target && m.degree === 'R')).toBe(true);
  await screenshot(page, testInfo, 'harmony-guide-tonic-and-target');

  await atTime(page, 4.5);
  await expect(page.locator('.hg-chord')).toHaveText('F');
  await expect(page.locator('.hg-next-chord').first()).toHaveText('C');
  await expect(page.locator('.hg-legend')).toBeVisible();
  const frame = await page.evaluate(() => (window as any).__hgFrame);
  expect(frame.alpha).toBe(1);
  expect(frame.targetPc).toBe(5);
  expect(frame.markers.length).toBeGreaterThan(70);
  expect(frame.positionCount).toBeGreaterThan(5);
  expect([...new Set(frame.markers.map((m: any) => m.pc))].sort()).toEqual([0, 2, 4, 5, 7, 9, 11].sort());
  expect(frame.markers.some((m: any) => m.target)).toBe(true);
  expect(frame.markers.some((m: any) => m.tonic)).toBe(true);
  expect(frame.markers.filter((m: any) => m.target).every((m: any) => m.pc === 5)).toBe(true);
  expect(frame.markers.filter((m: any) => m.target).every((m: any) => m.degree === '\u266d6' && !m.tonic)).toBe(true);
  expect(frame.markers.filter((m: any) => m.tonic).every((m: any) => m.pc === 9)).toBe(true);
  await screenshot(page, testInfo, 'harmony-guide-rest');

  await atTime(page, 8.5);
  await expect(page.locator('.hg-chord')).toHaveText('C');
  expect(await page.evaluate(() => (window as any).__hgFrame.targetPc)).toBe(0);
  await atTime(page, 11.8);
  expect(await page.evaluate(() => (window as any).__hgFrame.alpha)).toBeLessThan(1);
  await atTime(page, 12.5);
  expect(await page.evaluate(() => (window as any).__hgFrame.alpha)).toBe(0);
  await expect(page.locator('.hg-strip')).toBeVisible();
  await atTime(page, 4.5);
  await expect(page.locator('.hg-chord')).toHaveText('F');

  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('.hg-strip').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  const mobileKey = await page.locator('.hg-key').boundingBox();
  expect(mobileKey!.height).toBeLessThanOrEqual(23);
  await screenshot(page, testInfo, 'harmony-guide-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('.hg-controls').getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit song harmony' });
  await expect(editor).toBeVisible();
  const editorBounds = await editor.boundingBox();
  expect(editorBounds).not.toBeNull();
  expect(Math.abs(editorBounds!.x - (1440 - editorBounds!.width) / 2)).toBeLessThan(2);
  const saveBounds = await editor.getByRole('button', { name: 'Save locally', exact: true }).boundingBox();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(editorBounds!.y + editorBounds!.height);
  for (const mode of ['notes', 'none', 'degrees']) {
    await editor.getByLabel('Gem labels', { exact: true }).selectOption(mode);
    await expect.poll(() => page.evaluate(() => (window as any).__hgFrame.labelMode)).toBe(mode);
  }
  await screenshot(page, testInfo, 'harmony-guide-editor');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toHaveCount(0);

  await page.evaluate(() => (window as any).setViz('default'));
  await expect(page.locator('.hg-root')).toBeHidden();
  await expect(page.locator('.h3d-wrap')).toHaveCount(0);
  await page.evaluate(() => (window as any).setViz('highway_3d'));
  await page.waitForFunction(() => (window as any).__hgNativeReady === true);
  await expect(page.locator('.hg-strip')).toBeVisible();
  await expect(page.locator('.h3d-wrap')).toHaveCount(1);
  await atTime(page, 4.5);
  await expect(page.locator('.hg-chord')).toHaveText('F');
  expect(await page.evaluate(() => (window as any).highway.getNotes().length)).toBe(3);
  await page.evaluate(() => (window as any).highway.stop());
  await expect(page.locator('.hg-root')).toHaveCount(0);
  await expect(page.locator('.hg-editor')).toHaveCount(0);
  await expect(page.locator('.h3d-wrap')).toHaveCount(0);
  const locations = await page.evaluate(() => (window as any).__hgErrorLocations) as { message: string; filename: string; line: number }[];
  // These two optional-plugin failures were separately reproduced
  // against Main Dev 37a0bff with the guide absent. Match the exact message,
  // plugin version and source line; retain the failures as evidence and reject
  // every other error (including any duplicate beyond the reported event).
  const hasOrigin = (plugin: string, version: string, line: number) => locations.some(location => {
    const url = new URL(location.filename);
    return url.pathname === `/api/plugins/${plugin}/screen.js` && url.searchParams.get('v') === version && location.line === line;
  });
  let metronomeAllowance = hasOrigin('metronome', '1.0.0', 239) ? 1 : 0;
  let rigBuilderAllowance = hasOrigin('rig_builder', '3.0.6', 7347) ? 1 : 0;
  const knownBaselineErrors: string[] = [], unexpectedErrors: string[] = [];
  for (const error of errors) {
    if (metronomeAllowance && error === 'Illegal return statement') {
      metronomeAllowance--; knownBaselineErrors.push(error);
    } else if (rigBuilderAllowance
      && error.startsWith("ReferenceError: Cannot access 'rbToneOverride' before initialization")
      && error.includes('/api/plugins/rig_builder/screen.js?v=3.0.6:7347:')) {
      rigBuilderAllowance--; knownBaselineErrors.push(error);
    } else unexpectedErrors.push(error);
  }
  await testInfo.attach('browser-errors', {
    body: JSON.stringify({ errors, knownBaselineErrors, unexpectedErrors, locations }, null, 2),
    contentType: 'application/json',
  });
  expect(unexpectedErrors).toEqual([]);
});

test('local harmony edits reject conflicting scales, persist, and stay isolated to a song revision', async ({ page }, testInfo) => {
  // Three complete app boots also initialize installed optional plugins.
  test.setTimeout(180000);
  await installSongFixture(page); await openSong(page); await atTime(page, 4.5);
  await page.locator('.hg-controls').getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit song harmony' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Suggested scale', { exact: true }).selectOption('minor_pentatonic');
  await editor.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText(/scale and chord disagree/i);
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => (window as any).highway.getHarmonicGuide().hasOverride)).toBe(false);

  await editor.getByLabel('Suggested scale', { exact: true }).selectOption('natural_minor');
  await editor.getByLabel('Chord', { exact: true }).nth(1).fill('Dm');
  await editor.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.hg-chord')).toHaveText('Dm');
  await expect(page.locator('.hg-source')).toContainText('Your local guide');
  await screenshot(page, testInfo, 'harmony-guide-local-correction');

  await openSong(page); await atTime(page, 4.5);
  await expect(page.locator('.hg-chord')).toHaveText('Dm');
  expect(await page.evaluate(() => (window as any).highway.getHarmonicGuide().hasOverride)).toBe(true);
  await page.evaluate(() => sessionStorage.setItem('hg-test-revision', 'revision-two'));
  await openSong(page); await atTime(page, 4.5);
  await expect(page.locator('.hg-chord')).toHaveText('F');
  await expect(page.locator('.hg-source')).toHaveText('Feedpak annotations');
  expect(await page.evaluate(() => (window as any).highway.getHarmonicGuide().hasOverride)).toBe(false);
});

test('missing annotations trigger chart analysis, independent scales, honest gaps and local corrections', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const filename = 'mock-harmonic-guide.feedpak';
  const result = { version: 1, source: 'charts', revision: 'revision-one',
    keys: { version: 1, events: [{ t: 0, end: 30, key: 'C major', confidence: 'high' }] },
    harmony: { version: 1, events: [
      { t: 0, end: 6, root: 'D', quality: 'min' }, { t: 6, end: 8, unknown: true },
      { t: 8, end: 12, root: 'G', quality: '7' }, { t: 12, end: 16, root: 'E', confidence: 'low' },
      { t: 16, end: 30, unknown: true },
    ] },
    scales: { version: 1, events: [
      { t: 0, end: 6, root: 'D', type: 'dorian' }, { t: 6, end: 8, unknown: true },
      { t: 8, end: 12, root: 'G', type: 'mixolydian' }, { t: 12, end: 30, unknown: true },
    ] },
  };
  let submissions = 0, cancellations = 0, release = false;
  await page.route('**/api/harmony/analyse', route => {
    submissions++;
    expect(route.request().postDataJSON()).toEqual({ filenames: [filename], force: false, priority: 'current' });
    return route.fulfill({ json: { id: 'chart-browser-job', status: 'queued' } });
  });
  await page.route('**/api/harmony/jobs/chart-browser-job', route => {
    if (route.request().method() === 'DELETE') {
      cancellations++;
      return route.fulfill({ json: { id: 'chart-browser-job', status: 'cancelled' } });
    }
    return route.fulfill({ json: release
      ? { id: 'chart-browser-job', status: 'complete', items: [{ filename, status: 'complete', result }] }
      : { id: 'chart-browser-job', status: 'running', items: [] } });
  });
  await installSongFixture(page, false); await openSong(page); await atTime(page, 4.5);
  await expect(page.locator('.hg-status')).toHaveText('Analysing charts…');
  release = true;
  await expect(page.locator('.hg-key')).toHaveText('Key: C major');
  await expect(page.locator('.hg-scale')).toHaveText('Scale: D Dorian');
  await expect(page.locator('.hg-chord')).toHaveText('Dm');
  await expect(page.locator('.hg-source')).toHaveText('From charts');
  await expect.poll(() => page.evaluate(() => (window as any).__hgFrame.alpha)).toBeGreaterThan(0);
  // Startup plugins can replace the initial renderer. Every abandoned job
  // must be cancelled, and the settled player must not keep resubmitting.
  expect(submissions).toBeGreaterThan(0);
  expect(cancellations).toBe(submissions - 1);
  const completedSubmissions = submissions;
  await screenshot(page, testInfo, 'chart-analysis-independent-scale');
  await atTime(page, 7);
  await expect(page.locator('.hg-chord')).toHaveText('Unknown');
  await expect(page.locator('.hg-scale')).toHaveText('Scale unavailable');
  await expect(page.locator('.hg-key')).toHaveText('Key: C major');
  expect(await page.evaluate(() => (window as any).__hgFrame.targetPc)).toBeNull();
  await screenshot(page, testInfo, 'chart-analysis-evidence-gap');
  await atTime(page, 4.5);
  await page.locator('.hg-controls').getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit song harmony' });
  await expect(editor.getByLabel('Scale root', { exact: true }).first()).toHaveValue('D');
  await expect(editor.getByLabel('chord end time', { exact: true }).first()).toHaveValue('6');
  await editor.getByLabel('Chord', { exact: true }).first().fill('Em');
  await screenshot(page, testInfo, 'chart-analysis-editor');
  await editor.getByRole('button', { name: 'Save locally', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.hg-chord')).toHaveText('Em');
  await expect(page.locator('.hg-scale')).toHaveText('Scale: D Dorian');
  await expect(page.locator('.hg-source')).toContainText('From charts');
  await expect(page.locator('.hg-source')).toContainText('Your local guide');
  expect(submissions).toBe(completedSubmissions);
  await atTime(page, 8.5);
  await expect(page.locator('.hg-next-chord').first()).toHaveText('E ?');
  await atTime(page, 12.5);
  await expect(page.locator('.hg-current .hg-eyebrow')).toHaveText('POSSIBLE ROOT');
  await expect(page.locator('.hg-chord')).toHaveText('E');
});
