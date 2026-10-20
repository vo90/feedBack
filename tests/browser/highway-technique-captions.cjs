#!/usr/bin/env node
'use strict';
// Real WebGL + screen-resolution caption acceptance. No server, Electron,
// profile, or library writes. Every browser request is fulfilled from checkout.
// PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE_PATH select prepared dependencies.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const repo = path.resolve(__dirname, '../..');
const out = path.resolve(option('--out', path.join(repo, 'test-results/technique-captions')));
const source = fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8');
const report = {sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), rows: [], errors: [], failures: []};
const check = (value, message) => {if (!value) report.failures.push(message);};
const hook = "contextType: 'webgl2',";
assert.equal(source.split(hook).length, 2, 'Unique renderer inspection hook');
const served = source.replace(hook, `__captionAudit(){return {ren,scene,cam};},${hook}`);
const baseNote = (extra = {}) => ({t: 10, s: 1, f: 5, sus: 1.6, sl: -1, slu: -1, ...extra});
const target = kind => ({kind, node: 12, interval: 12, policy: 'harmonic'});
const examples = [
  {id: 'natural-5', title: 'Natural harmonic', expected: ['5'], notes: [baseNote({hm: true, hn: 5, hps: 24})]},
  {id: 'natural-3-2', title: 'Decimal natural harmonic', expected: ['3.2'], notes: [baseNote({f: 3, hm: true, hn: 3.2, hps: 31})]},
  {id: 'bar', title: 'Whammy bar', expected: ['BAR'], notes: [baseNote({whammy: {version: 1, policy: 'optional', segments: [{start: 0, end: 1.6, curve: [{t: 0, v: 0}, {t: 1.6, v: -2}]}]}})]},
  {id: 'artificial', title: 'Artificial harmonic', expected: ['AH 17'], notes: [baseNote({harmonic_target: target('artificial')})]},
  {id: 'tapped', title: 'Tapped harmonic', expected: ['TH 17'], notes: [baseNote({harmonic_target: target('tapped')})]},
  {id: 'scrape', title: 'Pick scrape · two strings, one caption', expected: ['PICK SCRAPE ↘'], notes: [1, 2].map(s => baseNote({s, f: 127, mt: true, pick_scrape_marks: [{direction: 'down', start: 0, end: 1.6}]}))},
  {id: 'wah', title: 'Wah open', expected: ['WAH ○'], notes: [baseNote()], wah: [{t: 10, state: 'open', strings: [1]}]},
  {id: 'timed-contact', title: 'Harmonic contact during sustain', expected: ['AH 17'], notes: [baseNote({t: 9, sus: 3,
    harmonic_changes: {version: 1, events: [{start: 1, end: 3, source_id: 'caption-fixture', target: target('artificial')}]}})]},
];
function validate(row, expected, fontSize = 14, close = true) {
  const prefix = row.name + ': ';
  const fills = row.ink.filter(i => i.kind === 'fillText' && i.alpha > .01);
  check(fills.length === expected.length, prefix + 'caption count ' + fills.length + ', expected ' + expected.length);
  check(JSON.stringify(fills.map(i => i.text).sort()) === JSON.stringify([...expected].sort()), prefix + 'caption text mismatch');
  check(fills.every(i => i.font === `bold ${fontSize}px Arial, sans-serif`), prefix + 'font differs from shared size/style');
  check(fills.every(i => i.fill === '#ffffff'), prefix + 'caption is not white');
  check(!row.ink.some(i => i.kind === 'fillRect'), prefix + 'caption has a rectangular background');
  for (const fill of fills) {
    check(row.ink.some(i => i.kind === 'strokeText' && i.text === fill.text && i.stroke === '#0a1018'), prefix + 'caption lacks dark outline');
    check(fill.rect.x >= -1 && fill.rect.y >= -1 && fill.rect.x + fill.rect.w <= row.width + 1 && fill.rect.y + fill.rect.h <= row.height + 1, prefix + 'caption clipped');
    if (close) {
      const anchors = row.anchors.filter(a => a.label === fill.text);
      const distances = anchors.map(a => {
        const dx = Math.max(a.rect.x - fill.rect.x - fill.rect.w, fill.rect.x - a.rect.x - a.rect.w, 0);
        const dy = Math.max(a.rect.y - fill.rect.y - fill.rect.h, fill.rect.y - a.rect.y - a.rect.h, 0);
        return Math.hypot(dx, dy);
      });
      check(distances.length && Math.min(...distances) <= 12, prefix + 'caption is detached from its anchor');
    }
  }
  check(row.glError === 0, prefix + 'WebGL error');
}
async function main() {
  assert.ok(!fs.existsSync(path.join(out, 'report.json')), 'Use a fresh evidence directory');
  fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}, deviceScaleFactor: 1});
    page.on('pageerror', e => report.errors.push(e.stack));
    await page.addInitScript(() => {
      window.__wall = 1000;
      Object.defineProperty(performance, 'now', {value: () => window.__wall, configurable: true});
      window.__captionInk = [];
      for (const kind of ['fillText', 'strokeText', 'fillRect']) {
        const original = CanvasRenderingContext2D.prototype[kind];
        CanvasRenderingContext2D.prototype[kind] = function (...values) {
          if (this.canvas.classList.contains('highway-harmonic-labels')) {
            const [text, x, y] = values;
            const m = kind === 'fillRect' ? null : this.measureText(text);
            window.__captionInk.push({kind, text: String(text), x, y, font: this.font, fill: this.fillStyle,
              stroke: this.strokeStyle, alpha: this.globalAlpha, lineWidth: this.lineWidth,
              rect: m ? {x: x - m.actualBoundingBoxLeft, y: y - m.actualBoundingBoxAscent,
                w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent} : null});
          }
          return original.apply(this, values);
        };
      }
    });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://technique-captions.test') return route.fulfill({status: 403, body: 'External network blocked'});
      if (u.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
      if (u.pathname === '/screen.js') return route.fulfill({contentType: 'text/javascript', body: served});
      if (u.pathname === '/gallery') return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(out, 'gallery.html'))});
      if (u.pathname.startsWith('/evidence/')) {
        const file = path.resolve(out, decodeURIComponent(u.pathname.slice('/evidence/'.length)));
        if (file.startsWith(out + path.sep) && fs.existsSync(file)) return route.fulfill({contentType: 'image/png', body: fs.readFileSync(file)});
      }
      const assetPath = decodeURIComponent(u.pathname).replace(/^\/api\/plugins\/highway_3d\/(?:g\/camera-\d+\/)?src\//, '/plugins/highway_3d/src/');
      const file = path.resolve(repo, '.' + assetPath);
      if (file.startsWith(repo + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return route.fulfill({contentType: /\.(js|mjs)$/.test(file) ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(file)});
      }
      return route.fulfill({status: 404, body: 'Missing fixture asset'});
    });
    await page.goto('http://technique-captions.test');
    await page.evaluate(async () => {
      const {harmonicContactsApi} = await import('/static/js/harmonic-contacts.js');
      const {whammyApi} = await import('/static/js/whammy.js');
      window.feedBackWhammy = whammyApi;
      window.feedBackHarmonicContacts = {...harmonicContactsApi, createOverlay(canvas) {
        const overlay = harmonicContactsApi.createOverlay(canvas);
        return {...overlay,
          beginFrame(...values) {window.__captionFrame = values; window.__captionAnchors = []; overlay.beginFrame(...values);},
          addGem(gem) {window.__captionAnchors.push({...gem}); overlay.addGem(gem);},
        };
      }};
      for (const [k, v] of Object.entries({cameraMode: 'stable', notationStyle: 'rsplus', style: 'off', glow: 0, bloom: false,
        cinematic: false, chordDiagramVisible: false, projectionVisible: false, textSize: .5, fpsVisible: false})) localStorage.setItem('h3d_bg_' + k, String(v));
      window.makeBundle = (fixture, flags = {}) => ({notes: fixture.notes || [], wah: fixture.wah || [], chords: [], chordTemplates: [],
        anchors: [{time: 0, fret: 2, width: 7}], handShapes: [], beats: [], sections: [], lyrics: [], currentTime: 9.75,
        isPlaying: false, playbackRate: 1, stringCount: 6, tuning: Array(6).fill(0), songInfo: {arrangement: 'Lead'},
        lefty: false, inverted: false, renderScale: 1, bgReactive: false, ...flags});
      window.bundle = makeBundle({notes: []});
      window.r = feedBackViz_highway_3d(); r.init(document.getElementById('highway'), bundle); await r.readyPromise;
      const a = r.__captionAudit();
      window.__realRender = a.ren.render.bind(a.ren); a.ren.render = () => {};
      window.drawFixture = (fixture, flags = {}, settle = true) => {
        bundle = makeBundle(fixture, flags);
        for (let i = 0; i < (settle ? 45 : 1); i++) {
          window.__wall += 100; window.__captionInk = []; window.__captionAnchors = []; r.draw(bundle);
        }
        const a = r.__captionAudit(); __realRender(a.scene, a.cam);
        const canvas = a.ren.domElement, frame = window.__captionFrame || [canvas.width, canvas.height, false];
        const rx = canvas.clientWidth / frame[0], ry = canvas.clientHeight / frame[1];
        const obstacles = window.__captionAnchors.map(g => ({label: g.label,
          rect: {x: ((frame[2] ? frame[0] - g.x : g.x) - g.rx) * rx, y: (g.y - g.ry) * ry, w: 2 * g.rx * rx, h: 2 * g.ry * ry}}));
        const anchors = obstacles.filter(g => g.label);
        return {ink: window.__captionInk, anchors, width: canvas.clientWidth, height: canvas.clientHeight,
          obstacles,
          backingWidth: canvas.width, backingHeight: canvas.height, glError: a.ren.getContext().getError(),
          overlayVisible: [...document.querySelectorAll('.highway-harmonic-labels')].some(c => c.style.display !== 'none')};
      };
    });
    for (const fixture of examples) {
      const row = {name: fixture.id, ...await page.evaluate(f => drawFixture(f), fixture)};
      report.rows.push(row); validate(row, fixture.expected);
      await page.screenshot({path: path.join(out, fixture.id + '.png')});
      const text = row.ink.find(i => i.kind === 'fillText');
      const cx = text ? text.rect.x + text.rect.w / 2 : 640, cy = text ? text.rect.y + text.rect.h / 2 : 430;
      await page.screenshot({path: path.join(out, fixture.id + '-detail.png'),
        clip: {x: Math.round(Math.max(0, Math.min(680, cx - 300))), y: Math.round(Math.max(0, Math.min(450, cy - 135))), width: 600, height: 270}});
    }
    for (const style of ['current', 'rsplus']) for (const variant of [
      {id: 'reduced', renderScale: .25}, {id: 'lefty-inverted', lefty: true, inverted: true},
    ]) for (const fixture of examples) {
      await page.evaluate(style => h3dBgSetNotationStyle(style), style);
      const row = {name: `${fixture.id}-${style}-${variant.id}`, ...await page.evaluate(({f, v}) => drawFixture(f, v), {f: fixture, v: variant})};
      report.rows.push(row); validate(row, fixture.expected);
      if (fixture.id === 'natural-3-2' || fixture.id === 'scrape') await page.screenshot({path: path.join(out, row.name + '.png')});
    }
    const crowded = {notes: examples.slice(0, 6).map((f, s) => ({...f.notes[0], s})),
      wah: [{t: 10, state: 'closed', strings: [0]}]};
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    for (const inverted of [false, true]) {
      const row = {name: 'crowded-' + (inverted ? 'inverted' : 'normal'),
        ...await page.evaluate(({f, inverted}) => drawFixture(f, {inverted}), {f: crowded, inverted})};
      report.rows.push(row); validate(row, ['5', '3.2', 'BAR', 'AH 17', 'TH 17', 'PICK SCRAPE ↘', 'WAH +'], 14, false);
      const ink = row.ink.filter(i => i.kind === 'fillText');
      for (let i = 0; i < ink.length; i++) {
        check(!row.obstacles.some(o => !o.label && overlap(ink[i].rect, o.rect) > .1), row.name + ': caption covers a visible note/technique');
        check(!ink.slice(i + 1).some(other => overlap(ink[i].rect, other.rect) > .1), row.name + ': captions overlap');
      }
      await page.screenshot({path: path.join(out, row.name + '.png')});
    }
    const openBar = {notes: examples[2].notes.map(n => ({...n, f: 0}))};
    for (const visible of [false, true]) {
      await page.evaluate(visible => h3dBgSetOpenStringStemsVisible(visible), visible);
      const row = {name: 'open-bar-stems-' + visible, ...await page.evaluate(f => drawFixture(f), openBar)};
      report.rows.push(row); validate(row, ['BAR']);
      const ink = row.ink.find(i => i.kind === 'fillText'), anchor = row.anchors[0];
      check(ink && anchor && Math.abs(ink.rect.x + ink.rect.w / 2 - anchor.rect.x - anchor.rect.w / 2) < 2,
        row.name + ': caption is not centered on the open-string bar');
      await page.screenshot({path: path.join(out, row.name + '.png')});
    }
    await page.evaluate(() => h3dBgSetTextSize(1));
    const larger = {name: 'text-size-maximum', ...await page.evaluate(f => drawFixture(f), examples[1])};
    report.rows.push(larger); validate(larger, examples[1].expected, 21);
    await page.evaluate(() => h3dBgSetTextSize(.5));
    const beforeSeek = {name: 'seek-before', ...await page.evaluate(f => drawFixture(f), examples[0])};
    const empty = {name: 'empty-after-seek', ...await page.evaluate(() => drawFixture({notes: []}, {currentTime: 30}))};
    report.rows.push(beforeSeek, empty); validate(beforeSeek, ['5']); validate(empty, []);
    check(!empty.overlayVisible, 'Caption canvas remains visible after labels end');
    const afterSeek = {name: 'seek-return', ...await page.evaluate(f => drawFixture(f), examples[0])};
    report.rows.push(afterSeek); validate(afterSeek, ['5']);
    check(JSON.stringify(beforeSeek.ink) === JSON.stringify(afterSeek.ink), 'Caption presentation changes after seek and pool reuse');
    fs.writeFileSync(path.join(out, 'gallery.html'), '<!doctype html><meta charset="utf-8"><title>Technique captions · actual renderer</title><style>body{margin:0;padding:24px;background:#0e171e;color:#f3f4f6;font:16px Arial,sans-serif}h1{font-size:24px;margin:0 0 8px}p{color:#aebac7;margin:0 0 20px}.grid{display:grid;grid-template-columns:600px 600px;gap:16px}.card{background:#15222c;border:1px solid #344957;border-radius:8px;overflow:hidden}.label{padding:10px 14px}img{display:block;width:600px;height:270px}</style><h1>Shared technique captions</h1><p>Actual renderer screenshots · white text, dark outline, consistent type and spacing</p><div class="grid">' +
      examples.map(f => `<div class="card"><div class="label">${f.title}</div><img src="/evidence/${f.id}-detail.png"></div>`).join('') + '</div>');
    await page.setViewportSize({width: 1266, height: 1450});
    await page.goto('http://technique-captions.test/gallery');
    await page.screenshot({path: path.join(out, 'technique-captions-gallery.png'), fullPage: true});
    check(report.errors.length === 0, 'Browser errors');
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({cases: report.rows.length, failures: report.failures, errors: report.errors, out}));
  if (report.failures.length || report.errors.length) process.exitCode = 1;
}
main().catch(error => {
  report.errors.push(error.stack); fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1;
});
