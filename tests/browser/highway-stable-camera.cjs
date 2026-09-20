#!/usr/bin/env node
/* Deterministic isolated renderer acceptance. No real app/profile/library writes.
 * --repo <checkout> --out <fresh-directory> [--case <substring>]
 * Optional private inputs: --nexus <lead.json> --amaranthine <lead.json>
 * PLAYWRIGHT_MODULE can select the existing bundled Playwright installation.
 */
'use strict';

const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const {
  chromium
} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2),
  option = (n, d) => args.includes(n) ? args[args.indexOf(n) + 1] : d;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..'))),
  out = path.resolve(option('--out', path.join(repo, 'test-results/stable-camera')));
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js'),
  source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const results = [],
  failures = [],
  errors = [],
  check = (ok, message) => {
    if (!ok) failures.push(message);
  };
const once = (value, anchor, replacement) => {
  assert.equal(value.split(anchor).length, 2, 'Expected unique hook: ' + anchor);
  return value.replace(anchor, replacement);
};
let served = source;
for (const [anchor, kind, mesh, meta] of [['const core = pNote.get();', 'gem', 'core', 't:n.t,s:n.s,f:n.f,sus:n.sus||0'], ['const fill = pChordFrameFill.get();', 'chord', 'fill', 't:ch.t'], ['const tr = pSus.get();', 'sustain', 'tr', 't:n.t,s:n.s,f:n.f,sus:n.sus||0'], ['const body = pSusRibbon.get();', 'ribbon', 'body', 't:n.t,s:n.s,f:n.f,sus:n.sus||0']]) served = once(served, anchor, `${anchor} if(window.__stableProbe)window.__stableProbe.push({kind:'${kind}',mesh:${mesh},${meta}});`);
served = once(served, "contextType: 'webgl2',", `
__cameraBenchmark(bundle, iterations) {
  for (let i=0;i<30;i++) { window.__cameraWall+=1000/60; camUpdate(bundle); }
  const times=[], start=window.__realCameraNow();
  for (let i=0;i<iterations;i++) {
    window.__cameraWall+=1000/60;
    const before=window.__realCameraNow(); camUpdate(bundle);
    times.push(window.__realCameraNow()-before);
  }
  const mean=(window.__realCameraNow()-start)/iterations;
  times.sort((a,b)=>a-b);
  return { mean, p50:times[Math.floor(times.length*.5)],
    p95:times[Math.floor(times.length*.95)], max:times.at(-1),
    pointCount:typeof _stableCam==='undefined'?null:_stableCam.pointCount };
},
__stableAudit(){return {ren,cam,scene,curX,curDist,curLookY,tgtX,tgtDist,tgtLookY,mode:cameraMode,
 state:typeof _stableCam==='undefined'?null:Object.fromEntries(Object.entries(_stableCam).filter(([k,v])=>v===null||['number','string','boolean'].includes(typeof v))),
 labels:Array.from({length:_incomingFloorLabelCount},(_,i)=>{const r=_incomingFloorLabels[i];return {kind:'gold-label',mesh:r.sprite,t:r.time,f:r.fret};}),
 fixedLabels:_incomingFixedFretLabels.map((mesh,f)=>mesh&&mesh.material.opacity>=0.999?{kind:'fixed-gold-label',mesh,t:0,f}:null).filter(Boolean),
 rect(mesh){const r={};return _incomingLabelScreenRect(mesh,r,true)?r:null;}};},contextType:'webgl2',`);
const note = e => ({
  t: 10,
  s: 2,
  f: 5,
  sus: 0,
  sl: -1,
  slu: -1,
  bn: 0,
  ...e
});
const base = e => ({
  currentTime: 9,
  isPlaying: true,
  playbackRate: 1,
  notes: [],
  chords: [],
  chordTemplates: [],
  anchors: [{
    time: 0,
    fret: 3,
    width: 4
  }],
  handShapes: [],
  beats: Array.from({
    length: 160
  }, (_, i) => ({
    time: i * .5,
    measure: i % 4 === 0 ? i / 4 : -1
  })),
  sections: [],
  lyrics: [],
  stringCount: 6,
  tuning: Array(6).fill(0),
  songInfo: {
    arrangement: 'Lead'
  },
  lefty: false,
  inverted: false,
  renderScale: 1,
  bgReactive: false,
  ...e
});
const low = () => base({
  notes: [note({
    t: 9.1,
    f: 3
  }), note({
    t: 9.5,
    f: 5,
    s: 1
  }), note({
    t: 10,
    f: 3,
    s: 3
  }), note({
    t: 10.5,
    f: 5
  }), note({
    t: 11,
    f: 4
  })]
});
const moving = () => base({
  notes: [...Array.from({
    length: 16
  }, (_, i) => note({
    t: 9 + i * .4,
    f: i < 7 ? 3 : 20,
    s: i % 6
  })), note({
    t: 20,
    f: 7
  })],
  anchors: [{
    time: 0,
    fret: 2,
    width: 4
  }, {
    time: 11.8,
    fret: 18,
    width: 4
  }, {
    time: 20,
    fret: 5,
    width: 4
  }]
});
const shape = {
  name: 'Wide',
  frets: [1, -1, -1, -1, 12, 24],
  fingers: [1, -1, -1, -1, 2, 4]
};
const wide = () => base({
  notes: [note({
    t: 10.2,
    s: 0,
    f: 1,
    sus: 2,
    sl: 24
  }), note({
    t: 10.5,
    s: 5,
    f: 24,
    sus: 2,
    bn: 2,
    bnv: [{
      t: 0,
      v: 2
    }, {
      t: 2,
      v: 0
    }]
  })],
  chords: [{
    t: 9.7,
    id: 0,
    notes: [note({
      t: 9.7,
      s: 0,
      f: 1
    }), note({
      t: 9.7,
      s: 4,
      f: 12
    }), note({
      t: 9.7,
      s: 5,
      f: 24
    })]
  }],
  chordTemplates: [shape],
  anchors: [{
    time: 0,
    fret: 1,
    width: 24
  }]
});
function privateChart(file, time) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return base({
    ...raw,
    currentTime: time,
    chordTemplates: raw.chordTemplates || raw.templates || [],
    handShapes: raw.handShapes || raw.handshapes || [],
    songInfo: {
      arrangement: 'Lead'
    }
  });
}
const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const pose = p => [...p.position, ...p.quaternion, p.fov];
const statePose = p => p.state ? [p.state.x, p.state.distance] : [p.curX, p.curDist];
function validateFrame(name, p, {
  checkVisible = true
} = {}) {
  check(p.mode === 'stable', name + ': Stable mode inactive');
  check(p.position.concat(p.quaternion, [p.fov]).every(Number.isFinite), name + ': non-finite camera');
  if (!checkVisible) return;
  for (const m of p.geometry) {
    // Authored anchor spans can outlive the notes that used them. Only a gold
    // row digit needed by an imminent or actively held note is a fit constraint.
    if (m.kind === 'fixed-gold-label' && !m.required) continue;
    if (!m.rect || m.t < p.time - .03 && !['sustain', 'ribbon', 'fixed-gold-label'].includes(m.kind)) continue;
    // Record all mesh envelopes. Imminent event heads and complete visible
    // active tails are protected; optional offscreen reference digits are absent.
    const imminent = m.t <= p.time + 1.2 || m.t < p.time && m.t + m.sus > p.time;
    if (!imminent) continue;
    const r = m.rect;
    check(r.minX >= -1.015 && r.maxX <= 1.015 && r.minY >= -1.015 && r.maxY <= 1.015, `${name}: ${m.kind} t${m.t} f${m.f ?? ''} clipped ${JSON.stringify(r)}`);
  }
}
async function main() {
  if (fs.existsSync(path.join(out, 'results.json'))) throw Error('Choose a fresh output directory');
  fs.mkdirSync(out, {
    recursive: true
  });
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 720
      },
      deviceScaleFactor: 1
    });
    page.on('pageerror', e => errors.push(e.stack));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(() => {
      window.__cameraWall = 1000;
      window.__realCameraNow = performance.now.bind(performance);
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => window.__cameraWall
      });
    });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://stable-camera.test') return route.fulfill({
        status: 403,
        body: 'Network blocked'
      });
      if (u.pathname === '/') return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'
      });
      if (u.pathname === '/screen.js') return route.fulfill({
        contentType: 'text/javascript',
        body: served
      });
      const f = path.resolve(repo, '.' + decodeURIComponent(u.pathname));
      if (f.startsWith(repo + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({
        contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'application/octet-stream',
        body: fs.readFileSync(f)
      });
      return route.fulfill({
        status: 404,
        body: 'Missing fixture asset'
      });
    });
    await page.goto('http://stable-camera.test/');
    await page.evaluate(() => {
      window.captureCamera = () => {
        const a = r.__stableAudit();
        a.cam.updateMatrixWorld();
        a.scene.updateMatrixWorld(true);
        const requiredFrets = new Set();
        const addNote = n => {
          for (const f of [n.f, n.sl, n.slu]) if (Number.isFinite(f) && f > 0) requiredFrets.add(f);
        };
        const relevant = n => n.t <= bundle.currentTime + 1.2
          && (n.t >= bundle.currentTime - .03 || n.t + (n.sus || 0) > bundle.currentTime);
        for (const n of bundle.notes || []) if (relevant(n)) addNote(n);
        for (const ch of bundle.chords || []) if (relevant(ch)) {
          for (const n of ch.notes || []) addNote(n);
          const template = (bundle.chordTemplates || [])[ch.id];
          for (const f of template?.frets || []) if (f > 0) requiredFrets.add(f);
        }
        for (const label of a.fixedLabels) label.required = requiredFrets.has(label.f);
        const geometry = [...window.__stableProbe, ...a.labels, ...a.fixedLabels].filter(o => o.mesh.visible && o.mesh.material?.opacity !== 0).map(({
          mesh,
          ...m
        }) => ({
          ...m,
          rect: a.rect(mesh)
        }));
        return {
          time: bundle.currentTime,
          mode: a.mode,
          state: a.state,
          curX: a.curX,
          curDist: a.curDist,
          position: a.cam.position.toArray(),
          quaternion: a.cam.quaternion.toArray(),
          rotation: a.cam.rotation.toArray(),
          fov: a.cam.fov,
          aspect: a.cam.aspect,
          geometry
        };
      };
      window.cameraStep = (time, ms, playing = bundle.isPlaying) => {
        window.__cameraWall += ms;
        bundle.currentTime = time;
        bundle.isPlaying = playing;
        window.__stableProbe = [];
        r.draw(bundle);
        return captureCamera();
      };
    });
    async function init(b, preset = 'straight', extra = {}) {
      return page.evaluate(async ({
        b,
        preset,
        extra
      }) => {
        if (window.r) r.destroy();
        window.__cameraWall = 1000;
        localStorage.clear();
        window.__h3dCamCtl = extra.bridge || null;
        const settings = {
          cameraMode: 'stable',
          stableCameraPreset: preset,
          stableCameraFollow: true,
          cameraSmoothing: .5,
          zoomSmoothing: .5,
          tiltSmoothing: .5,
          cameraLockLow: false,
          style: 'off',
          notationStyle: 'rsplus',
          glow: 0,
          cinematic: false,
          sparks: false,
          bloom: false,
          verdictMarks: false,
          timingFx: false,
          streakFx: false,
          hitFx: 0,
          chordDiagramVisible: false,
          ...extra.settings
        };
        for (const [k, v] of Object.entries(settings)) {
          localStorage.setItem('h3d_bg_' + k, String(v));
          const setter = window['h3dBgSet' + k[0].toUpperCase() + k.slice(1)];
          if (typeof setter === 'function') setter(v);
        }
        window.bundle = b;
        window.r = feedBackViz_highway_3d();
        r.init(document.getElementById('highway'), bundle);
        await r.readyPromise;
        window.__stableProbe = [];
        r.draw(bundle);
        return captureCamera();
      }, {
        b,
        preset,
        extra
      });
    }
    async function steps(start, seconds, fps = 30, rate = 1) {
      return page.evaluate(({
        start,
        seconds,
        fps,
        rate
      }) => {
        const captures = [];
        for (let i = 1; i <= Math.round(seconds * fps); i++) {
          const p = cameraStep(start + i / fps * rate, 1000 / fps, true);
          if (i % Math.max(1, Math.round(fps / 5)) === 0 || i === Math.round(seconds * fps)) captures.push(p);
        }
        return captures;
      }, {
        start,
        seconds,
        fps,
        rate
      });
    }
    const chosen = name => !option('--case') || option('--case').split(',').some(s => name.includes(s));
    async function record(name, samples, image = false, opts = {}) {
      for (const [i, p] of samples.entries()) {
        validateFrame(name + '#' + i, p, opts);
        check(Math.abs(p.fov - 60) < 1e-8, name + ': lens changed from fixed60FOV');
        check(distance(p.quaternion, samples[0].quaternion) < 1e-8, name + ': camera orientation changed during automatic movement');
      }
      results.push({
        name,
        samples
      });
      if (image) await page.screenshot({
        path: path.join(out, name + '.png')
      });
      console.log(name + ': ' + samples.length + ' samples');
    }
    for (const preset of ['straight', 'angled']) if (chosen('preset-' + preset)) {
      const p = await init(low(), preset);
      await record('preset-' + preset, [p], true);
      const far = low();
      far.notes.push(note({
        t: 30,
        f: 24
      }));
      far.anchors.push({
        time: 30,
        fret: 21,
        width: 4
      });
      const q = await init(far, preset);
      check(distance(pose(p), pose(q)) < 1e-8, preset + ': invisible distant event changes pose');
      await record('future-event-' + preset, [q]);
    }
    if (chosen('freeze')) {
      await init(moving());
      const progress = await steps(9, 1.4);
      const pause = await page.evaluate(() => {
        const p = [cameraStep(bundle.currentTime, 0, false)];
        for (let i = 0; i < 90; i++) p.push(cameraStep(bundle.currentTime, 1000 / 30, false));
        return [p[0], p.at(-1)];
      });
      check(distance(pose(pause[0]), pose(pause[1])) < 1e-9, 'pause: camera continued moving');
      await record('freeze-pause', pause, true, {
        checkVisible: false
      });
      const fixed = await page.evaluate(() => {
        h3dBgSetStableCameraFollow(false);
        const p = [cameraStep(bundle.currentTime, 0, true)];
        for (let i = 0; i < 60; i++) p.push(cameraStep(20 + i / 30, 1000 / 30, true));
        return [p[0], p.at(-1)];
      });
      check(distance(statePose(fixed[0]), statePose(fixed[1])) < 1e-9, 'follow-off: automatic pose moved during playback/seek');
      await record('freeze-follow-off', fixed, true, {
        checkVisible: false
      });
    }
    if (chosen('seek')) {
      await init(moving());
      await steps(9, 1);
      const seek = await page.evaluate(() => cameraStep(12.5, 1000 / 30, true));
      const direct = await init({
        ...moving(),
        currentTime: 12.5
      });
      check(distance(pose(seek), pose(direct)) < .002, 'seek: inherited camera travel differs from direct opening');
      await record('seek', [seek, direct], true);
    }
    if (chosen('paused-controls')) {
      const before = await init({
        ...low(),
        isPlaying: false
      });
      const preset = await page.evaluate(() => {
        h3dBgSetStableCameraPreset('angled');
        return cameraStep(bundle.currentTime, 1000, false);
      });
      check(distance(pose(before), pose(preset)) > .001, 'paused preset: explicit viewpoint did not move camera');
      await record('paused-controls-preset', [preset], true);
      await page.setViewportSize({
        width: 960,
        height: 720
      });
      const resized = await page.evaluate(() => {
        r.resize(960, 720);
        return cameraStep(bundle.currentTime, 1000, false);
      });
      check(Math.abs(resized.aspect - 960 / 720) < 1e-8, 'paused resize: projection aspect not updated');
      await record('paused-controls-resize', [resized], true);
      const offset = await page.evaluate(() => {
        window.__h3dCamCtl = {
          enabled: true,
          distMul: 1.1,
          heightMul: 1,
          yaw: .06,
          panX: 2,
          panY: 0,
          pitch: 0
        };
        return cameraStep(bundle.currentTime, 1000, false);
      });
      check(distance(pose(resized), pose(offset)) > .001, 'paused offset: explicit Camera Director adjustment did not move camera');
      check(distance(statePose(resized), statePose(offset)) < 1e-8, 'paused offset: changed underlying automatic pose');
      await record('paused-controls-offset', [offset], true, {
        checkVisible: false
      });
      await page.setViewportSize({
        width: 1280,
        height: 720
      });
    }
    if (chosen('follow-reset')) {
      await init(moving(), 'straight', {
        settings: {
          stableCameraFollow: false
        }
      });
      const jumped = await page.evaluate(() => cameraStep(14, 1000, true));
      const reset = await page.evaluate(() => {
        h3dStableCameraReset();
        return cameraStep(bundle.currentTime, 1000, true);
      });
      check(distance(statePose(jumped), statePose(reset)) > .001, 'follow-off reset: explicit reset failed to reframe');
      await record('follow-reset', [reset], true);
    }
    if (chosen('silence')) {
      await init(base({
        notes: [note({
          t: 9.5,
          f: 20
        })],
        anchors: [{
          time: 0,
          fret: 18,
          width: 4
        }]
      }));
      await steps(9, 2);
      const p = await page.evaluate(() => cameraStep(bundle.currentTime, 0, true));
      const later = await steps(11, 3);
      check(distance(pose(p), pose(later.at(-1))) < 1e-9, 'silence: automatic camera moved with no visible playable geometry');
      await record('silence', [p, later.at(-1)], true);
    }
    const bpmRuns = [];
    for (const bpm of [60, 120, 180]) if (chosen('bpm')) {
      const b = moving();
      b.beats = Array.from({
        length: 240
      }, (_, i) => ({
        time: i * 60 / bpm,
        measure: i % 4 === 0 ? i / 4 : -1
      }));
      await init(b);
      const samples = await steps(9, 3, 30);
      bpmRuns.push({
        bpm,
        samples
      });
      await record('bpm-' + bpm, samples, false);
    }
    if (bpmRuns.length === 3) for (let i = 0; i < bpmRuns[0].samples.length; i++) check(distance(pose(bpmRuns[0].samples[i]), pose(bpmRuns[2].samples[i])) < 1e-8, `BPM equivalence t${bpmRuns[0].samples[i].time}: camera behavior changed with beat density`);
    const fpsRuns = [];
    for (const fps of [15, 30, 60]) if (chosen('fps')) {
      await init(moving());
      const samples = await steps(9, 3, fps);
      fpsRuns.push({
        fps,
        samples
      });
      await record('fps-' + fps, samples, false);
    }
    if (fpsRuns.length === 3) {
      for (let i = 0; i < fpsRuns[0].samples.length; i++) {
        const a = fpsRuns[0].samples[i],
          b = fpsRuns[2].samples[i];
        check(distance(a.position, b.position) < .035, `fps equivalence t${a.time}: camera displacement ${distance(a.position, b.position)}`);
      }
    }
    for (const rate of [.5, 1, 1.5]) if (chosen('rate')) {
      await init({
        ...moving(),
        playbackRate: rate
      });
      const samples = await steps(9, 3, 30, rate);
      await record('rate-' + rate, samples, false);
    }
    for (const [name, changes, size] of [['wide', {}, [1280, 720]], ['wide-lefty', {
      lefty: true
    }, [1280, 720]], ['wide-inverted', {
      inverted: true
    }, [1280, 720]], ['narrow-window', {}, [720, 1000]], ['wide-window', {}, [1920, 540]]]) if (chosen(name)) {
      await page.setViewportSize({
        width: size[0],
        height: size[1]
      });
      const p = await init({
        ...wide(),
        ...changes
      }, 'angled');
      await record(name, [p], true);
    }
    const right = results.find(r => r.name === 'wide'),
      left = results.find(r => r.name === 'wide-lefty');
    if (right && left) {
      const q = right.samples[0].quaternion;
      check(distance(left.samples[0].quaternion, [q[0], -q[1], -q[2], q[3]]) < 1e-8, 'lefty: angled camera orientation is not the mirror of right handed');
    }
    if (chosen('active-sustains')) {
      await page.setViewportSize({
        width: 1280,
        height: 720
      });
      const b = base({
        currentTime: 12,
        notes: [note({
          t: 10,
          f: 1,
          s: 0,
          sus: 5,
          sl: 24
        }), note({
          t: 10,
          f: 24,
          s: 5,
          sus: 5,
          bn: 2,
          bnv: [{
            t: 0,
            v: 2
          }, {
            t: 5,
            v: 0
          }]
        })],
        anchors: [{
          time: 0,
          fret: 1,
          width: 4
        }]
      });
      const p = await init(b, 'angled');
      await record('active-sustains', [p], true);
    }
    if (chosen('eight-string')) for (const inverted of [false, true]) {
      await page.setViewportSize({
        width: 1280,
        height: 720
      });
      const b = base({
        stringCount: 8,
        tuning: Array(8).fill(0),
        inverted,
        notes: [note({
          t: 9.4,
          s: 0,
          f: 3,
          sus: 2
        }), note({
          t: 9.7,
          s: 7,
          f: 6,
          sus: 2,
          sl: 12
        })],
        anchors: [{
          time: 0,
          fret: 3,
          width: 4
        }]
      });
      const p = await init(b, 'angled', {
        settings: {
          textSize: 1
        }
      });
      await record('eight-string-' + (inverted ? 'inverted' : 'normal'), [p], true);
    }
    await page.setViewportSize({
      width: 1280,
      height: 720
    });
    if (option('--nexus') && chosen('nexus')) for (const preset of ['straight', 'angled']) {
      const b = privateChart(option('--nexus'), 36),
        samples = [await init(b, preset)];
      await page.screenshot({
        path: path.join(out, 'nexus-' + preset + '-36.png')
      });
      let from = 36;
      for (const end of [38, 41, 51, 57, 58, 60]) {
        samples.push(...(await steps(from, end - from, 15)));
        await page.screenshot({
          path: path.join(out, 'nexus-' + preset + '-' + end + '.png')
        });
        from = end;
      }
      const early = samples.filter(p => p.time <= 51);
      check(early.every(p => Math.abs(p.state.distance - early[0].state.distance) < 1e-8), preset + ': Nexus camera zoomed for far-future high fret before51s');
      await record('nexus-' + preset, samples, true);
    }
    if (option('--amaranthine') && chosen('amaranthine')) for (const preset of ['straight', 'angled']) {
      const p = await init(privateChart(option('--amaranthine'), 109.5), preset);
      await record('amaranthine-' + preset, [p], true);
    }
    for (const workload of ['camera-cost', 'dense-camera-cost']) if (chosen(workload)) {
      const dense = base({notes:Array.from({length:48},(_,i)=>note({
        t:7.5+i*.05, s:i%6, f:1+i%24, sus:4,
        sl:i%2===0?24-i%24:-1, bn:i%2===0?0:2,
        bnv:i%2===0?[]:[{t:0,v:0},{t:1,v:2},{t:2,v:0},{t:3,v:2},{t:4,v:0}]
      }))});
      const b = workload==='dense-camera-cost'?dense
        : option('--nexus') ? privateChart(option('--nexus'), 56.5) : moving();
      const samples = [];
      for (let round = 0; round < 3; round++) for (const mode of round % 2 ? ['stable', 'lookahead'] : ['lookahead', 'stable']) {
        await init(b, 'angled', {
          settings: {
            cameraMode: mode
          }
        });
        const ms = await page.evaluate(() => r.__cameraBenchmark(bundle, 120));
        samples.push({
          round,
          mode,
          msPerCameraUpdate: ms
        });
      }
      results.push({
        name: workload,
        samples
      });
      console.log(workload + ': ' + JSON.stringify(samples));
    }
    if (chosen('settings-dom')) {
      await page.evaluate(() => {
        if (window.r) r.destroy();
      });
      const settingsHtml = fs.readFileSync(path.join(repo, 'plugins/highway_3d/settings.html'), 'utf8');
      await page.route('**/settings-fixture', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><script>localStorage.clear();</script><script src="/screen.js"></script>' + settingsHtml
      }));
      await page.goto('http://stable-camera.test/settings-fixture');
      await page.locator('#h3d-camera-mode').selectOption('stable');
      check(await page.locator('#h3d-stable-camera-controls').isVisible(), 'settings: stable controls hidden after mode selection');
      check(await page.locator('#h3d-tilt-smoothing').isDisabled(), 'settings: legacy-only controls remain enabled');
      await page.locator('#h3d-stable-camera-preset').selectOption('angled');
      await page.locator('#h3d-stable-camera-follow').uncheck();
      check(await page.locator('#h3d-camera-smoothing').isDisabled(), 'settings: follow-off pan damping remains enabled');
      check(await page.locator('#h3d-zoom-smoothing').isDisabled(), 'settings: follow-off zoom damping remains enabled');
      await page.evaluate(() => {
        window.__h3dCamCtl = {
          enabled: true,
          distMul: 1.2
        };
      });
      await page.locator('#h3d-stable-camera-reset').click();
      const persisted = await page.evaluate(() => ({
        mode: localStorage.getItem('h3d_bg_cameraMode'),
        preset: localStorage.getItem('h3d_bg_stableCameraPreset'),
        follow: localStorage.getItem('h3d_bg_stableCameraFollow'),
        bridge: window.__h3dCamCtl
      }));
      check(persisted.mode === 'stable' && persisted.preset === 'angled' && persisted.follow === 'false', 'settings: mode/preset/follow persistence mismatch');
      check(persisted.bridge?.distMul === 1.2, 'settings: reset mutated Camera Director bridge');
      await page.locator('#h3d-camera-mode').selectOption('lookahead');
      check(!(await page.locator('#h3d-tilt-smoothing').isDisabled()), 'settings: legacy controls did not reenable');
      check(!(await page.locator('#h3d-stable-camera-controls').isVisible()), 'settings: stable controls remain visible in legacy mode');
      results.push({
        name: 'settings-dom',
        persisted
      });
      console.log('settings-dom: passed interactions');
    }
  } finally {
    await browser.close();
  }
  check(errors.length === 0, 'Browser errors: ' + errors.join('\n'));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({
    sourcePath,
    sourceNormalizedLfSha: crypto.createHash('sha256').update(source).digest('hex'),
    failures,
    errors,
    results
  }, null, 2));
  console.log(JSON.stringify({
    out,
    cases: results.length,
    failures: failures.slice(0, 30),
    failureCount: failures.length,
    errors
  }, null, 2));
  if (failures.length) process.exitCode = 1;
}
main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
