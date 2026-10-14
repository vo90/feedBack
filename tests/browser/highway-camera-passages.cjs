#!/usr/bin/env node
'use strict';

// Production-renderer camera acceptance. Only the isolated page is changed.
// Examples:
//   node tests/browser/highway-camera-passages.cjs --out <fresh artifact dir>
//   ... --source-ref <ref> --reference --fps 60 --case high-slide
//   ... --baseline-ref <ref> --require-improvement --private-chart <compact JSON>
// Optional: --variants (lefty/wide), --rates .5,2 (reversal cases at 60 FPS),
// --captures, --perf (diagnostics, never a gate).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/camera-passages')));
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const readRef = ref => normalize(execFileSync('git', ['-C', repo, 'show', `${ref}:plugins/highway_3d/screen.js`], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024}));
const source = option('--source-ref') ? readRef(option('--source-ref')) : normalize(fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8'));
const baseline = option('--baseline-ref') ? readRef(option('--baseline-ref')) : null;
assert.ok(!args.includes('--require-improvement') || baseline, '--require-improvement needs --baseline-ref');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const failures = [], browserErrors = [], results = [];
const note = value => ({t: 6, s: 2, f: 4, sus: 0, sl: -1, slu: -1, bn: 0, ...value});
const base = value => ({currentTime: 6, isPlaying: true, playbackRate: 1, notes: [], chords: [], chordTemplates: [],
  handShapes: [], anchors: [{time: 0, fret: 2, width: 4}], beats: Array.from({length: 600}, (_, i) => ({time: i / 2, measure: i % 4 ? -1 : i / 4})),
  sections: [], lyrics: [], stringCount: 6, tuning: Array(6).fill(0), songInfo: {arrangement: 'Lead'}, lefty: false, inverted: false, renderScale: 1, ...value});

function fixture(kind) {
  if (kind === 'fixed') return base({notes: Array.from({length: 48}, (_, i) => note({t: 6 + i / 8, f: 2 + i % 4, s: i % 6}))});
  if (kind === 'local') return base({notes: Array.from({length: 35}, (_, i) => note({t: 6 + i / 5, f: 4, s: i % 6})),
    anchors: [{time: 0, fret: 2, width: 4}, ...[3, 4, 3, 2, 3, 2].map((fret, i) => ({time: 7 + i, fret, width: 4}))]});
  if (kind === 'long-shift') return base({notes: [note({t: 6.2, f: 3, sus: .3}), ...Array.from({length: 20}, (_, i) => note({t: 8 + i / 5, f: 16 + i % 3, s: i % 6}))],
    anchors: [{time: 0, fret: 2, width: 4}, {time: 8, fret: 15, width: 4}]});
  if (kind === 'high-slide') return base({notes: [
    ...Array.from({length: 6}, (_, i) => note({t: 6.2 + i * .3, f: 4 + i % 4, s: i % 6})), note({t: 8.066, f: 14, sus: .8})],
    chords: [{t: 9.134, id: 0, notes: [0, 1].map(s => ({s, f: 22, sus: .683, sl: -1, slu: 10, tr: true, tp: true}))},
      ...Array.from({length: 5}, (_, i) => ({t: 9.893 + i * .6, id: 1, notes: [{s: 0, f: 0}, {s: 1, f: 2}, {s: 2, f: 2}]}))],
    chordTemplates: [{name: 'High', frets: [22, 22, -1, -1, -1, -1], fingers: [-1, -1, -1, -1, -1, -1]},
      {name: 'Low', frets: [0, 2, 2, -1, -1, -1], fingers: [0, 1, 2, -1, -1, -1]}],
    anchors: [{time: 0, fret: 4, width: 4}, {time: 8.066, fret: 12, width: 4}, {time: 9.134, fret: 18, width: 5}, {time: 9.893, fret: 2, width: 4}]});
  throw Error(`Unknown fixture ${kind}`);
}

const cases = [];
const fpsValues = option('--fps', '30,60,120').split(',').map(Number);
assert.ok(fpsValues.every(fps => Number.isFinite(fps) && fps > 0));
for (const preset of ['straight', 'angled']) {
  for (const fps of fpsValues) for (const kind of ['fixed', 'local', 'long-shift', 'high-slide']) {
    cases.push({name: `${kind}-${preset}-${fps}`, kind, preset, fps, start: 6, end: 13, b: fixture(kind), viewport: {width: 1920, height: 1032}});
  }
  if (args.includes('--variants')) for (const variant of ['lefty', 'wide']) {
    cases.push({name: `high-slide-${preset}-${variant}`, kind: 'high-slide', preset, fps: 60, start: 6, end: 13,
      b: {...fixture('high-slide'), lefty: variant === 'lefty'}, viewport: {width: 1920, height: variant === 'wide' ? 720 : 1032}});
  }
  if (option('--private-chart')) {
    const raw = JSON.parse(fs.readFileSync(option('--private-chart'), 'utf8'));
    const b = base({...raw, chordTemplates: raw.chordTemplates || raw.templates || [], handShapes: raw.handShapes || raw.handshapes || []});
    for (const fps of fpsValues) cases.push({name: `private-${preset}-${fps}`, kind: 'private', preset, fps, start: 155, end: 161, b, viewport: {width: 1920, height: 1032}});
  }
}
if(option('--rates')) {
  const rates=option('--rates').split(',').map(Number);
  assert.ok(rates.every(rate=>Number.isFinite(rate)&&rate>=.1&&rate<=4),'Playback rates must be between .1 and 4');
  for(const c of cases.slice().filter(c=>['high-slide','private'].includes(c.kind)&&c.name.endsWith('-60'))) {
    for(const rate of rates) if(rate!==1)cases.push({...c,name:`${c.name}-rate${rate}`,b:{...c.b,playbackRate:rate}});
  }
}
const active = cases.filter(c => !option('--case') || option('--case').split(',').some(fragment => c.name.includes(fragment)));
assert.ok(active.length, 'No cases selected');

// One insertion at the renderer's public contract; no rewriting solver/plan
// statements. The audit reads the state produced by draw() and never invokes
// a resolver with the caller's unaugmented chart arrays.
function instrument(input) {
  const marker = "contextType: 'webgl2',";
  assert.equal(input.split(marker).length, 2, 'Expected one renderer contract');
  return input.replace(marker, `
    __passageAudit() {
      cam.updateMatrixWorld(); scene.updateMatrixWorld(true);
      const region = _stableRegionResult;
      const point = new T.Vector3();
      const imminentHorizon = .25 * (window.bundle.playbackRate || 1);
      const imminentFrets = window.__passageEvents.filter(n => n.f > 0 && n.t >= _frameNow-1e-7 && n.t <= _frameNow+imminentHorizon)
        .map(n => ({dt:n.t-_frameNow, screen:new T.Vector3(xFretMid(n.f),sY(n.s),dZ(n.t-_frameNow)).project(cam).toArray()}));
      const heads = [];
      pNote.forEachActive(mesh => {
        if (!mesh.visible || mesh.userData.stableCameraRelevant === false || mesh.material?.opacity === 0) return;
        mesh.getWorldPosition(point); const dt = -point.z / TS;
        if (dt < -1e-7 || dt > imminentHorizon) return;
        point.project(cam);
        const fretted = imminentFrets.some(n => Math.abs(n.dt-dt)<.003 && Math.abs(n.screen[0]-point.x)<.02 && Math.abs(n.screen[1]-point.y)<.02);
        const rect = {}; if (_incomingLabelScreenRect(mesh, rect, true)) heads.push({dt, fretted, rect});
      });
      const labels = [];
      for (let fret = 1; fret < _incomingFixedFretLabels.length; fret++) {
        const mesh = _incomingFixedFretLabels[fret];
        if (mesh?.visible && mesh.material?.opacity === 1) {
          const rect = {}; if (_incomingLabelScreenRect(mesh, rect, true)) labels.push({fret, rect});
        }
      }
      return {time:_frameNow, mode:cameraMode, position:cam.position.toArray(), quaternion:cam.quaternion.toArray(), fov:cam.fov,
        x:_stableCam.x, plannedX:_stableCam.planX, distance:_stableCam.distance, correction:_stableCam.correction,
        targetDistance:_stableCam.targetDistance, zoomVelocity:_stableCam.zoomVelocity, safetyOffset:_stableCam.safetyOffset,
        planDistance:_stablePlan.result.distance, planReturnFloor:_stablePlan.result.returnFloor,
        revision:_stableCam.planRevision, fretWidth:Math.abs(xFretMid(6)-xFretMid(5)),
        focus:region?.valid?{x:region.x,minX:region.minX,maxX:region.maxX,firstFret:region.dMin+1,lastFret:region.dMax}:null,
        heads, labels};
    },
    __passagePlanSnapshot() {
      return {revision:_stablePlan.revision,stops:_stablePlan.stops.map(row=>({...row})),regions:_stablePlan.regions.map(row=>({...row})),
        zoomRegions:(_stablePlan.zoomRegions||_stablePlan.regions).map(row=>({...row}))};
    },
    __passageDisableGpu() { this.__passageGpu = ren.render.bind(ren); ren.render = () => {}; },
    __passageCapture() { this.__passageGpu(scene, cam); return ren.domElement.toDataURL('image/png'); },
    __passageBenchmark(bundle, count) {
      for (let i=0;i<40;i++) { window.__wall+=1000/60; camUpdate(bundle); }
      const samples=[];
      for (let i=0;i<count;i++) { window.__wall+=1000/60; const t=window.__realNow(); camUpdate(bundle); samples.push(window.__realNow()-t); }
      return samples;
    },
    ${marker}`);
}

const delta = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const quantile = (values, q) => values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
function summarize(samples, viewport, rate) {
  const first = samples[0], width = first.fretWidth, nominal = first.distance;
  let travel = 0, logZoomTravel = 0, reversals = 0, sign = 0, zoomEvents = 0, zoomed = false;
  const panSpeed = [], zoomSpeed = [], panAcceleration = [], zoomAcceleration = [], readableWidths = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!zoomed && s.distance > nominal * 1.05) { zoomEvents++; zoomed = true; }
    if (zoomed && s.distance < nominal * 1.02) zoomed = false;
    for (const head of s.heads) if(head.fretted) readableWidths.push((head.rect.maxX - head.rect.minX) * viewport.width / 2);
    if (!i) continue;
    const previous = samples[i - 1], dx = (s.x - previous.x) / width;
    const dz = Math.log(s.distance / previous.distance), dt = (s.time - previous.time)/rate;
    travel += Math.abs(dx); logZoomTravel += Math.abs(dz);
    if (Math.abs(dx) > .001) { const next = Math.sign(dx); if (sign && sign !== next) reversals++; sign = next; }
    if (dt > 0) {
      const vx=dx/dt, vz=dz/dt;
      if(panSpeed.length) { panAcceleration.push((vx-panSpeed.at(-1))/dt); zoomAcceleration.push((vz-zoomSpeed.at(-1))/dt); }
      panSpeed.push(vx); zoomSpeed.push(vz);
    }
  }
  return {frames:samples.length, panTravelFrets:travel, panReversals:reversals,
    peakPanSpeedFretsPerSecond:Math.max(0,...panSpeed.map(Math.abs)),
    peakPanAccelerationFretsPerSecondSquared:Math.max(0,...panAcceleration.map(Math.abs)),
    peakDistanceRatio:Math.max(...samples.map(s=>s.distance))/nominal, zoomEvents, logZoomTravel,
    peakLogZoomSpeedPerSecond:Math.max(0,...zoomSpeed.map(Math.abs)),
    peakLogZoomAccelerationPerSecondSquared:Math.max(0,...zoomAcceleration.map(Math.abs)),
    hardSafetyCorrections:samples.filter(s=>s.correction).length,
    hardSafetyCorrectionTimes:samples.filter(s=>s.correction).map(s=>s.time),
    minImminentFrettedGemPixels:readableWidths.length?Math.min(...readableWidths):null,
    planRevisions:[...new Set(samples.map(s=>s.revision))]};
}

function validate(c, run, label) {
  const fail = message => failures.push({case:c.name, label, category:'correctness', message});
  const samples = run.samples, first = samples[0];
  if (run.metrics.planRevisions.length !== 1) fail('Unchanged playback rebuilt the camera plan');
  for (const sample of samples) {
    if (sample.mode !== 'stable' || ![sample.x,sample.distance,...sample.position,...sample.quaternion].every(Number.isFinite)) fail(`Invalid pose at ${sample.time}`);
    if (delta(sample.quaternion, first.quaternion) > 1e-8 || Math.abs(sample.fov-first.fov) > 1e-8) fail(`Automatic angle/FOV changed at ${sample.time}`);
    if (!sample.heads.every(h=>h.rect.minX>=-1.001&&h.rect.maxX<=1.001)) fail(`Imminent note clipped horizontally at ${sample.time}`);
    if (!sample.labels.every(h=>h.rect.minX>=-1.01&&h.rect.maxX<=1.01&&h.rect.minY>=-1.01&&h.rect.maxY<=1.01)) fail(`Current gold label clipped at ${sample.time}`);
  }
  if (c.kind === 'fixed') {
    const settled = samples.filter(s=>s.time>=7);
    if (Math.max(...settled.map(s=>s.x))-Math.min(...settled.map(s=>s.x)) > first.fretWidth*.02) fail('Camera moved within an unchanged playing area');
    if (Math.max(...settled.map(s=>s.distance))-Math.min(...settled.map(s=>s.distance)) > first.distance*.01) fail('Ordinary attacks pulsed zoom');
  }
  if (c.kind === 'long-shift') {
    const last=samples.at(-1);
    if (last.x < last.focus.minX || last.x > last.focus.maxX) fail('Camera did not settle into the sustained new playing area');
  }
}

async function main() {
  assert.ok(!fs.existsSync(path.join(out, 'results.json')), 'Use a fresh output directory');
  fs.mkdirSync(out, {recursive:true});
  const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  let served='';
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1032}});
    page.on('pageerror', error=>browserErrors.push(error.stack));
    page.on('console', message=>{if(message.type()==='error')browserErrors.push(message.text());});
    await page.addInitScript(()=>{window.__wall=1000;window.__realNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>window.__wall,configurable:true});});
    await page.route('**/*', route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://camera-passages.test')return route.fulfill({status:403,body:'External network disabled'});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
      if(url.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
      const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
      if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Missing fixture asset'});
    });
    for(const [label,input] of baseline?[['baseline',baseline],['candidate',source]]:[['candidate',source]]) {
      served=instrument(input);await page.goto('http://camera-passages.test/');
      for(const c of active) {
        await page.setViewportSize(c.viewport);
        await page.evaluate(async c=>{
          window.r?.destroy();window.__wall=1000;localStorage.clear();window.__h3dCamCtl=null;
          const settings={cameraMode:'stable',stableCameraPreset:c.preset,stableCameraFollow:true,cameraSmoothing:.5,zoomSmoothing:.5,tiltSmoothing:.5,cameraLockLow:false,
            notationStyle:'rsplus',style:'off',glow:0,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false};
          for(const [key,value]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+key,String(value));window['h3dBgSet'+key[0].toUpperCase()+key.slice(1)]?.(value);}
          window.bundle={...c.b,currentTime:c.start};window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;r.__passageDisableGpu();
          window.__passageEvents=[...bundle.notes,...bundle.chords.flatMap(chord=>(chord.notes||[]).map(n=>({...n,t:chord.t})))];
        },c);
        const captureTimes=args.includes('--captures')&&c.fps===60?(c.kind==='high-slide'?[8,9.3,9.8,10.3]:c.kind==='private'?[157,158.3,158.8,159.3]:[]):[];
        const rate=c.b.playbackRate||1;
        const playback=await page.evaluate(({start,end,fps,captureTimes,rate})=>{
          const samples=[],captures=[];let planSnapshot;
          const frames=Math.round((end-start)*fps/rate);
          for(let frame=0;frame<=frames;frame++) {
            if(frame)window.__wall+=1000/fps;bundle.currentTime=start+(end-start)*frame/frames;r.draw(bundle);samples.push(r.__passageAudit());
            if(!frame)planSnapshot=r.__passagePlanSnapshot();
            if(captureTimes.some(time=>Math.abs(time-bundle.currentTime)<rate/(fps*2)))captures.push({time:bundle.currentTime,png:r.__passageCapture()});
          }
          return {samples,captures,planSnapshot};
        },{...c,captureTimes,rate});
        const samples=playback.samples;
        for(const capture of playback.captures)fs.writeFileSync(path.join(out,`${label}-${c.name}-${capture.time.toFixed(3)}.png`),Buffer.from(capture.png.split(',')[1],'base64'));
        const run={name:c.name,label,kind:c.kind,preset:c.preset,fps:c.fps,rate,viewport:c.viewport,samples,planSnapshot:playback.planSnapshot,metrics:summarize(samples,c.viewport,rate)};
        validate(c,run,label);
        if(args.includes('--perf')) {
          const times=await page.evaluate(()=>r.__passageBenchmark(bundle,200));
          run.performanceDiagnostics={method:'Warm stationary camera CPU only; real wall clock; GPU disabled. Not a correctness gate or live frame-time measurement.',meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:quantile(times,.95),maxMs:Math.max(...times)};
        }
        fs.writeFileSync(path.join(out,`${label}-${c.name}.json`),JSON.stringify(run));
        results.push({...run,samples:undefined,planSnapshot:undefined});
        console.log(`${label} ${c.name}: ${samples.length} frames, pan ${run.metrics.panTravelFrets.toFixed(2)} frets, peak zoom ${run.metrics.peakDistanceRatio.toFixed(3)}x`);
      }
    }
  } finally { await browser.close(); }
  const fpsComparisons=[];
  for(const label of baseline?['baseline','candidate']:['candidate']) for(const c of active) {
    const siblings=active.filter(other=>other.kind===c.kind&&other.preset===c.preset&&other.b.playbackRate===c.b.playbackRate&&other.b.lefty===c.b.lefty&&other.viewport.width===c.viewport.width&&other.viewport.height===c.viewport.height);
    const high=siblings.reduce((best,next)=>next.fps>best.fps?next:best,c);
    if(c.fps>=high.fps)continue;
    const lowSamples=JSON.parse(fs.readFileSync(path.join(out,`${label}-${c.name}.json`),'utf8')).samples;
    const highSamples=JSON.parse(fs.readFileSync(path.join(out,`${label}-${high.name}.json`),'utf8')).samples;
    const pairs=lowSamples.map((sample,i)=>[sample,highSamples[Math.round(i*high.fps/c.fps)]]);
    const maxPanDifferenceFrets=Math.max(...pairs.map(([a,b])=>Math.abs(a.x-b.x)/a.fretWidth));
    const maxDistanceDifferenceNominal=Math.max(...pairs.map(([a,b])=>Math.abs(a.distance-b.distance)/lowSamples[0].distance));
    const comparison={name:c.name,reference:high.name,label,maxPanDifferenceFrets,maxDistanceDifferenceNominal};
    fpsComparisons.push(comparison);
    // Reactive visibility protection is sampled at different instants. Allow
    // half a fret / 15% of normal distance at 30 FPS, while detecting a changed path
    // or an additional lag filter. Fixed/local timelines normally match exactly.
    if(maxPanDifferenceFrets>.5||maxDistanceDifferenceNominal>.15)failures.push({case:c.name,label,category:'cadence',message:'Camera path diverged across frame rates',comparison});
  }
  const comparisons=[];
  if(baseline) for(const c of active) {
    const previous=results.find(r=>r.name===c.name&&r.label==='baseline'),current=results.find(r=>r.name===c.name&&r.label==='candidate');
    const comparison={name:c.name,panTravelRatio:current.metrics.panTravelFrets/Math.max(previous.metrics.panTravelFrets,1e-9),
      excessZoomRatio:(current.metrics.peakDistanceRatio-1)/Math.max(previous.metrics.peakDistanceRatio-1,1e-9),
      logZoomTravelRatio:current.metrics.logZoomTravel/Math.max(previous.metrics.logZoomTravel,1e-9)};
    comparisons.push(comparison);
    if(args.includes('--require-improvement')&&['high-slide','private'].includes(c.kind)) {
      const noRegression=comparison.panTravelRatio<=1.05&&comparison.excessZoomRatio<=1.05;
      const improved=comparison.panTravelRatio<=.9||comparison.excessZoomRatio<=.9;
      if(!noRegression||!improved)failures.push({case:c.name,label:'candidate',category:'motion',message:'Expected lower pan travel or excess zoom without increasing the other by more than 5%',comparison});
    }
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourceHash:sha(source),baselineHash:baseline?sha(baseline):null,
    method:'Isolated production renderer, deterministic simulated playback, read-only state/mesh audit. Camera algorithms are unmodified. Correctness/motion failures are separate from optional CPU diagnostics.',
    failures,browserErrors,comparisons,fpsComparisons,results},null,2));
  console.log(JSON.stringify({out,cases:results.length,failures:failures.length,browserErrors},null,2));
  if(browserErrors.length||(failures.length&&!args.includes('--reference')))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
