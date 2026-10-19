#!/usr/bin/env node
'use strict';

// Isolated production renderer: never launches the game or changes its library.
// Supply private compact arrangement JSON with repeated --songs Name=absolute-path.
// --root/ CAMERA_SOURCE_ROOT selects source and assets. --out must be a fresh
// external evidence directory; private chart data never belongs in this repo.
// --source-ref HEAD --reference records old behavior without enforcing new policy.
// --rates .5,1,2 --presets straight,angled --viewports 1920x1032,800x900
// --fps 30 --song-fps 10 --case name-fragment --captures Name=15.359,16.586
// --range Name=start,end limits a focused song/performance passage.
// --songs-only / --synthetic-only, --perf, --moving-perf, --lifecycle are optional.
// --tuning-ui checks the live panel and captures wide/narrow screenshots on sustained cases.
// --live-consistency exercises committed threshold edits during playback, pause,
// Follow and rate changes, then loop wrap. Use --range to select a private passage.
// --live-home Name=fret checks a known 300ms-lane riff holds at 350/500/900ms and moves at 250ms.
// Repeat --setting stableCameraDepartureDelay=0 etc. to exercise camera controls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repeated = key => args.flatMap((value, i) => value === key ? [args[i + 1]] : []);
const root = path.resolve(option('--root', process.env.CAMERA_SOURCE_ROOT || path.join(__dirname, '../..')));
assert.ok(option('--out'), 'Supply --out with a fresh external evidence directory');
const out = path.resolve(option('--out'));
assert.ok(!out.startsWith(root + path.sep), 'Keep private acceptance evidence outside the source checkout');
assert.ok(!fs.existsSync(out), 'Use a fresh output directory');
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const source = option('--source-ref') ? normalize(execFileSync('git', ['-C', root, 'show', `${option('--source-ref')}:plugins/highway_3d/screen.js`],
  {encoding:'utf8', maxBuffer:8*1024*1024})) : normalize(fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const rates = option('--rates', '.5,1,2').split(',').map(Number);
const presets = option('--presets', 'straight,angled').split(',');
const cameraSettings = Object.fromEntries(repeated('--setting').map(value => {
  const at=value.indexOf('='),key=value.slice(0,at),number=Number(value.slice(at+1));
  assert.ok(at>0&&/^stableCamera[A-Za-z]+$/.test(key)&&Number.isFinite(number),'--setting stableCameraName=number');
  return [key,number];
}));
const viewports = option('--viewports', '1920x1032,800x900').split(',').map(value => {
  const [width,height] = value.split('x').map(Number); return {width,height};
});
assert.ok(rates.every(rate => rate >= .1 && rate <= 4));
assert.ok(presets.every(preset => ['straight','angled'].includes(preset)));
assert.ok(viewports.every(v => v.width > 0 && v.height > 0));
const failures = [], errors = [], results = [];
const check = (condition, name, message, evidence) => { if (!condition) failures.push({name,message,evidence}); };
const note = value => ({t:6,s:2,f:3,sus:.08,sl:-1,slu:-1,bn:0,...value});
const base = value => ({currentTime:4,isPlaying:true,playbackRate:1,notes:[],chords:[],anchors:[{time:0,fret:2,width:4}],
  chordTemplates:[],handShapes:[],beats:[],sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},
  lefty:false,inverted:false,renderScale:1,...value});
const fixtures = [];
for (const duration of [.499,.5,.501,1]) fixtures.push({name:`threshold-${duration}`,kind:'threshold',duration,start:4,end:12,
  b:base({notes:[note({t:6}),note({t:8,f:9,sus:Math.min(.2,duration)}),note({t:8+duration})],
    anchors:[{time:0,fret:2,width:4},{time:8,fret:8,width:4},{time:8+duration,fret:2,width:4}]})});
fixtures.push({name:'far-24',kind:'held',start:4,end:13,b:base({notes:[note({t:6}),note({t:8,f:24,sus:.2}),note({t:8.3})],
  anchors:[{time:0,fret:2,width:4},{time:8,fret:21,width:4},{time:8.3,fret:2,width:4}]})});
fixtures.push({name:'chain',kind:'chain',start:4,end:14,b:base({notes:[note({t:6}),note({t:8,f:7}),note({t:8.61,f:9}),note({t:9.22,f:11}),note({t:11,f:12})],
  anchors:[{time:0,fret:2,width:4},{time:8,fret:7,width:4},{time:8.61,fret:9,width:4},{time:9.22,fret:11,width:4}]})});
fixtures.push({name:'extension',kind:'held',start:4,end:16,b:base({notes:[note({t:6}),note({t:8,f:7}),note({t:10,f:8}),note({t:12})],
  anchors:[{time:0,fret:2,width:4},{time:8,fret:2,width:7},{time:12,fret:2,width:4}]})});
fixtures.push({name:'sustained',kind:'arrival',start:4,end:14,b:base({notes:[note({t:6}),note({t:8,f:16,sus:1}),note({t:10,f:17})],
  anchors:[{time:0,fret:2,width:4},{time:8,fret:15,width:4}]})});
const riffAnchors=[{time:0,fret:5,width:4}],riffNotes=[];
for(let i=0;i<5;i++) { const t=6+i*2;
  riffAnchors.push({time:t+1.7,fret:2,width:4},{time:t+2,fret:5,width:4});
  for(const [offset,f]of [[0,5],[.3,7],[.6,8],[1,5],[1.75,3]])riffNotes.push(note({t:t+offset,f}));
}
fixtures.push({name:'rooted-riff',kind:'held',start:4,end:18,b:base({anchors:riffAnchors,notes:riffNotes})});
{
  const anchors=[{time:0,fret:5,width:4}],notes=[];
  for(let i=0;i<16;i++) {
    const time=6+i*.3,fret=[8,7,4,5][i%4];
    anchors.push({time,fret,width:4});notes.push(note({t:time,f:fret}));
  }
  fixtures.push({name:'per-lane-riff',kind:'held',start:4,end:15,b:base({anchors,notes})});
}
for(const [name,path]of [
  ['per-lane-scale',[2,4,6,8,10,12,14,16,18,20,21,19,17,15,13,11,9,7,5,3,2]],
  ['per-lane-zigzag',[2,4,3,5,4,6,5,7,6,8,7,9,2]],
]) {
  const peakFret=Math.max(...path);
  const frets=[...path.slice(1),...path.slice(1)],anchors=[{time:0,fret:2,width:4}],notes=[],peakTimes=[];
  for(const [i,fret]of frets.entries()) {
    const time=6+i*.2;
    anchors.push({time,fret,width:4});notes.push(note({t:time,f:fret}));
    if(fret===peakFret)peakTimes.push(time);
  }
  fixtures.push({name,kind:'progressive-return',start:4,end:18,peakTimes,peakFret,b:base({anchors,notes})});
}
if(args.includes('--live-consistency')) {
  const anchors=[{time:0,fret:5,width:4}],notes=[];
  for(let i=0;i<32;i++) {
    const time=6+i*.3,fret=[5,8,7,4][i%4];
    anchors.push({time,fret,width:4});notes.push(note({t:time,f:fret,sus:.1}));
  }
  // A distant future destination must not hijack a local correction when
  // playback speed changes while the current passage holds its home lane.
  anchors.push({time:15.6,fret:5,width:4},{time:22,fret:2,width:4});
  fixtures.push({name:'live-cycle',kind:'live-cycle',start:4,end:18,b:base({anchors,notes})});
}

const captures = new Map(repeated('--captures').map(value => { const at=value.indexOf('=');
  assert.ok(at>0,'--captures Name=seconds,seconds');return [value.slice(0,at),value.slice(at+1).split(',').map(Number)]; }));
const ranges = new Map(repeated('--range').map(value => { const at=value.indexOf('='),range=value.slice(at+1).split(',').map(Number);
  assert.ok(at>0&&range.length===2&&range.every(Number.isFinite)&&range[1]>range[0],'--range Name=start,end');
  return [value.slice(0,at),range]; }));
const liveHomes = new Map(repeated('--live-home').map(value=>{const at=value.indexOf('='),fret=Number(value.slice(at+1));
  assert.ok(at>0&&Number.isInteger(fret)&&fret>=1&&fret<=24,'--live-home Name=fret');return [value.slice(0,at),fret];}));
const songs = repeated('--songs').map(value => {
  const at=value.indexOf('='); const file=path.resolve(at>0?value.slice(at+1):value);
  const name=at>0?value.slice(0,at):path.basename(file,'.json');
  const bytes=fs.readFileSync(file), raw=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  const events=[...(raw.notes||[]),...(raw.chords||[]).flatMap(c=>(c.notes||[]).map(n=>({...n,t:c.t})))];
  const manifest=path.resolve(path.dirname(file),'../manifest.yaml');
  const duration=fs.existsSync(manifest)?Number(fs.readFileSync(manifest,'utf8').match(/^duration:\s*([0-9.]+)/m)?.[1]):NaN;
  const eventEnd=Math.max(0,...events.map(n=>n.t+(n.sus||0)),...(raw.anchors||[]).map(a=>a.time));
  const end=Number.isFinite(duration)&&duration>=eventEnd?duration:eventEnd+2;
  return {name,kind:'song',start:0,end,file,chartHash:sha(bytes),b:base({...raw,chordTemplates:raw.chordTemplates||raw.templates||[],handShapes:raw.handShapes||raw.handshapes||[]})};
});
const inputs=[...(args.includes('--songs-only')?[]:fixtures),...(args.includes('--synthetic-only')?[]:songs)];
const cases=[];
for(const fixture of inputs)for(const preset of presets)for(const rate of rates)for(const viewport of viewports) {
  const name=`${fixture.name}-${preset}-rate${rate}-${viewport.width}x${viewport.height}`;
  if(option('--case')&&!option('--case').split(',').some(part=>name.includes(part)))continue;
  const range=ranges.get(fixture.name),start=Math.max(fixture.start,range?.[0]??fixture.start),end=Math.min(fixture.end,range?.[1]??fixture.end);
  assert.ok(end>start,'Selected range must intersect the fixture');
  cases.push({...fixture,name,sourceName:fixture.name,start,end,preset,rate,viewport,cameraSettings,liveHome:liveHomes.get(fixture.name),fps:Number(option(fixture.kind==='song'?'--song-fps':'--fps',fixture.kind==='song'?'10':'30'))});
}
assert.ok(cases.length,'No cases selected');

// Expose state at the public renderer contract. Never rewrite planning/fit logic.
function instrument(input) {
  const marker="contextType: 'webgl2',";
  assert.equal(input.split(marker).length,2,'Expected one public renderer contract');
  return input.replace(marker,`
    __laneAudit(detail=false) {
      cam.updateMatrixWorld();scene.updateMatrixWorld(true);
      const clean=o=>Object.fromEntries(Object.entries(o||{}).filter(([,v])=>v===null||['number','string','boolean'].includes(typeof v)));
      const p=new T.Vector3(),bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,count:0};
      for(let i=0;i<_stableCam.viewPointCount;i+=3){p.fromArray(_stableViewPoints,i).project(cam);
        bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);bounds.count++;}
      const labels=[];
      if(detail)for(let f=1;f<_incomingFixedFretLabels.length;f++){const m=_incomingFixedFretLabels[f];
        if(m?.visible&&m.material?.opacity===1){const rect={};if(_incomingLabelScreenRect(m,rect,true))labels.push({f,rect});}}
      const stops=_stablePlan.stops||[];let i=0;while(i+1<stops.length&&stops[i+1].time<=_frameNow+1e-7)i++;
      const row=_stablePlan.regions[_stablePlan.result.regionIndex];
      const requiredRegionDistance=row?stableRegionViewDistance(row,_stablePlan.result.closeDistance,_stableCam.x):null;
      const requiredVisibleDistance=stableSolve(_stableCam.x,_stablePlan.result.closeDistance,0,.96,true,
        _stableViewPoints,_stableCam.viewPointCount,_stableViewBasis).distance;
      return {time:_frameNow,x:_stableCam.x,velocity:_stableCam.planVelocity,distance:_stableCam.distance,
        zoomVelocity:_stableCam.zoomVelocity,plannedX:_stableCam.planX,targetDistance:_stableCam.targetDistance,
        safetyOffset:_stableCam.safetyOffset,correction:_stableCam.correction,region:clean(_stableRegionResult),
        decision:clean(stops[i]),plan:clean(_stablePlan.result),fretWidth:Math.abs(xFretMid(6)-xFretMid(5)),
        position:cam.position.toArray(),quaternion:cam.quaternion.toArray(),fov:cam.fov,bounds,labels,
        requiredRegionDistance,requiredVisibleDistance};
    },
    __lanePlan(){return {stops:_stablePlan.stops.map(r=>({...r})),motion:(_stablePlan.stops.motion||[]).map(r=>({...r})),regions:_stablePlan.regions.map(r=>({...r})),timeline:(_stablePlan.timeline||[]).map(r=>({...r}))};},
    __laneLiveAudit(){const s=_stableCam,p=_stablePlan.result;return {time:_frameNow,x:s.x,distance:s.distance,
      velocity:(s.planVelocity||0)+(s.rejoinVelocity||0),plannedX:s.planX,plannedVelocity:s.planVelocity,
      following:s.following,clockReset:s.clockReset,rate:_stablePlan.rate,revision:p.revision,transit:p.transit,
      arrivalTime:p.arrivalTime,arrivalX:p.arrivalX,rejoinEnd:s.rejoinEnd,resumeUntil:s.resumeUntil};},
    __laneDisableGpu(){this.__laneGpu=ren.render.bind(ren);ren.render=()=>{};},
    __laneCapture(){this.__laneGpu(scene,cam);return ren.domElement.toDataURL('image/png');},
    __laneCpu(count){const a=[];for(let i=0;i<count+30;i++){window.__wall+=1000/60;const t=window.__realNow();camUpdate(window.bundle);if(i>=30)a.push(window.__realNow()-t);}return a;},
    __laneMovingCpu(start,end,count){
      const a=[];
      for(let pass=0;pass<2;pass++){
        window.bundle.currentTime=start;this.draw(window.bundle);
        for(let i=1;i<=count;i++){
          const time=start+(end-start)*i/count;
          window.__wall+=(time-window.bundle.currentTime)/window.bundle.playbackRate*1000;
          window.bundle.currentTime=time;const t=window.__realNow();this.draw(window.bundle);
          if(pass)a.push(window.__realNow()-t);
        }
      }
      return a;
    },
    ${marker}`);
}

function validate(c, samples, plan) {
  const first=samples[0], width=first.fretWidth;
  const threshold=(c.cameraSettings.stableCameraExcursionThreshold??500)/1000;
  const finite=samples.every(s=>[s.x,s.distance,...s.position,...s.quaternion].every(Number.isFinite));
  check(finite,c.name,'Non-finite camera state');
  check(samples.every(s=>s.fov===first.fov&&s.quaternion.every((v,i)=>Math.abs(v-first.quaternion[i])<1e-8)),c.name,'Automatic orientation/FOV changed');
  const clipped=samples.filter(s=>s.bounds.count&&(s.bounds.minX<-.961||s.bounds.maxX>.961||s.bounds.minY<-.961||s.bounds.maxY>.961));
  check(!clipped.length,c.name,'Collected visibility support clipped',clipped.slice(0,5).map(s=>({time:s.time,bounds:s.bounds})));
  // Independently compact metadata fragments for the old-source baseline.
  // Candidate timelines also expose intentional riff exceptions and held homes.
  const compact=[];
  for(const row of plan.regions)if(compact.at(-1)?.firstFret!==row.firstFret)compact.push(row);
  const semantic=plan.timeline.length?plan.timeline:compact;
  const boundary=[];
  for(let i=1;i<semantic.length;i++) {
    const row=semantic[i],duration=(semantic[i+1]?.time??Infinity)-row.time;
    if(row.lasting===false||duration<threshold-1e-8||row.time<c.start||row.time>c.end)continue;
    const motion=plan.motion.find(s=>s.lasting&&Math.abs((s.nominalEnd??s.end)-row.time)<1e-7);
    const arrival=motion?.end??row.time;
    const sample=samples.find(s=>Math.abs(s.time-arrival)<1e-6);
    if(!sample){check(arrival>c.end,c.name,'A scheduled arrival was not sampled',{time:row.time,arrival});continue;}
    const onset=samples.find(s=>Math.abs(s.time-row.time)<1e-6);
    const target=row.kind==='riff-variation'?row.cameraX:row.x;
    const error=Math.abs(sample.plannedX-target)/width;
    boundary.push({time:row.time,arrival,duration,firstFret:row.firstFret,lastFret:row.lastFret,kind:row.kind||'baseline-lasting',
      target,planErrorFrets:error,actualErrorFrets:Math.abs(sample.x-target)/width,
      onsetErrorFrets:onset?Math.abs(onset.x-target)/width:null,onsetDistance:onset?.distance,onsetRequiredDistance:onset?.requiredVisibleDistance});
  }
  if(!args.includes('--reference')) {
    check(boundary.every(b=>b.planErrorFrets<.05),c.name,'A lasting lane was not reached by its scheduled arrival',boundary.filter(b=>b.planErrorFrets>=.05).slice(0,12));
    check(boundary.every(b=>b.actualErrorFrets<.05),c.name,'The rendered camera missed a scheduled arrival',boundary.filter(b=>b.actualErrorFrets>=.05).slice(0,12));
    for(let i=0;i<plan.motion.length;i++) {
      const s=plan.motion[i],next=plan.motion[i+1];
      if(!Number.isFinite(s.nominalStart))continue;
      check(s.end>=s.start&&(!i||s.start>=plan.motion[i-1].end-1e-8),c.name,'Motion segments overlap or have negative duration',{index:i,segment:s});
      check(s.start>=s.nominalStart-1e-8&&s.end-s.start>=s.nominalEnd-s.nominalStart-1e-8,c.name,'Tuning departed earlier or shortened travel',{index:i,segment:s});
      if(s.tuningEligible) {
        const limit=(c.cameraSettings.stableCameraSettleLimit??250)/1000*c.rate;
        check(s.end<=s.nominalEnd+limit+1e-8&&(!next||s.end<=next.nominalStart+1e-8),c.name,'Long switch exceeded its settling or next-movement deadline',{index:i,segment:s});
      } else check(s.start===s.nominalStart&&s.end===s.nominalEnd,c.name,'Tuning changed an ineligible move or progressive chain',{index:i,segment:s});
    }
    const held=c.sourceName==='extension'||c.kind==='held'&&threshold>.3+1e-8||c.kind==='threshold'&&c.duration<threshold;
    if(held) {
      const range=(Math.max(...samples.map(s=>s.x))-Math.min(...samples.map(s=>s.x)))/width;
      check(range<.05,c.name,'Suppressed excursion/width extension changed horizontal center',{rangeFrets:range});
    }
    if(c.kind==='threshold'&&c.duration>=threshold) {
      const arrival=plan.motion.find(s=>Math.abs((s.nominalEnd??s.end)-8)<1e-6)?.end??8;
      const at=samples.find(s=>Math.abs(s.time-arrival)<1e-6);
      check(at&&Math.abs(at.x-first.x)>width,c.name,'Lasting outside lane was suppressed');
    }
    if(c.kind==='chain')check(samples.every((s,i)=>!i||s.x>=samples[i-1].x-1e-5),c.name,'Forward chain reversed direction');
    if(c.kind==='progressive-return') {
      const high=plan.regions.find(s=>s.firstFret===c.peakFret)?.preferred;
      for(const time of c.peakTimes) {
        const sample=samples.find(s=>Math.abs(s.time-time)<1e-6);
        check(sample&&Math.abs(sample.x-high)<width*.05,c.name,
          'An all-short repeated climb and descent was suppressed instead of following the high lane',{time,high,sample});
      }
      check(Math.abs(samples.at(-1).x-plan.stops.at(-1).x)<width*.05,c.name,
        'The progressive return did not settle back at its final lane');
    }
    if(c.sourceName==='far-24'&&held) {
      const last=samples.at(-1),peak=Math.max(...samples.map(s=>s.distance));
      check(peak>first.distance*1.05,c.name,'Far fret did not exercise outward visibility zoom');
      check(Math.abs(last.distance-first.distance)<first.distance*.01,c.name,'Far excursion zoom did not return to the original close view',{before:first.distance,after:last.distance,peak});
      const near=samples.filter(s=>s.time>=8&&s.time<8.3);
      check(near.every(s=>s.distance+1e-7>=s.requiredVisibleDistance),c.name,'Far fret was not given the minimum required visible room');
      const start=near.find(s=>Math.abs(s.time-8)<1e-6);
      check(start&&Math.abs(start.targetDistance-start.requiredRegionDistance)<1e-7,c.name,'Far excursion requested more zoom than its fixed-center region needs');
    }
  }
  return boundary;
}

function summary(samples) {
  let pan=0,maxVelocity=0,peakDistance=0,corrections=0;
  for(let i=0;i<samples.length;i++){const s=samples[i];peakDistance=Math.max(peakDistance,s.distance);maxVelocity=Math.max(maxVelocity,Math.abs(s.velocity||0));corrections+=s.correction?1:0;if(i)pan+=Math.abs(s.x-samples[i-1].x)/s.fretWidth;}
  return {frames:samples.length,panTravelFrets:pan,maxPlanVelocity:maxVelocity,peakDistance,corrections};
}

async function validateTuningUi(page,c) {
  const root=page.locator('.h3d-camera-tuning'),toggle=root.locator('[data-camera-tuning-toggle]');
  const panel=root.locator('[data-camera-tuning-panel]');
  const number=key=>root.locator(`[data-camera-setting="${key}"][data-camera-input="number"]`);
  const keys=['stableCameraDepartureDelay','stableCameraTravelExtra','stableCameraSettleLimit','stableCameraExcursionThreshold','stableCameraLongSwitchFrets'];
  check(await root.count()===1&&await toggle.isVisible()&&await panel.isHidden(),c.name,'Live tuning control was missing, duplicated, or initially expanded');
  await page.evaluate(()=>{window.__tuningKeyCount=0;window.__tuningKeyListener=()=>window.__tuningKeyCount++;document.addEventListener('keydown',window.__tuningKeyListener);});
  await toggle.click();check(await panel.isVisible(),c.name,'Camera tuning did not open');
  for(const [i,key] of keys.entries()) {
    const value=[150,20,350,750,8][i];await number(key).fill(String(value));await number(key).press('Enter');
    const stored=await page.evaluate(key=>localStorage.getItem('h3d_bg_'+key),key);
    check(Number(stored)===value,c.name,'Live number control did not persist its committed value',{key,value,stored});
  }
  for(const [preset,values] of [['previous',[0,0,0,500,5]],['gentler',[100,10,250,500,5]]]) {
    await root.locator(`[data-camera-tuning-preset="${preset}"]`).click();
    const actual=await Promise.all(keys.map(key=>number(key).inputValue()));
    check(actual.every((value,i)=>Number(value)===values[i]),c.name,'Live comparison button applied the wrong tuning',{preset,actual});
  }
  const follow=root.locator('[data-camera-setting="stableCameraFollow"]');
  await follow.uncheck();check(await number(keys[0]).isDisabled(),c.name,'Follow off left motion fields enabled');await follow.check();
  const view=root.locator('[data-camera-setting="stableCameraPreset"]');
  await view.selectOption(c.preset==='straight'?'angled':'straight');await view.selectOption(c.preset);
  await number(keys[0]).press('Escape');
  check(await panel.isHidden(),c.name,'Escape did not close live camera tuning');
  check(await page.evaluate(()=>document.activeElement?.hasAttribute('data-camera-tuning-toggle')),c.name,'Escape did not restore toggle focus');
  check(await page.evaluate(()=>window.__tuningKeyCount)===0,c.name,'Live tuning keystrokes leaked to game keyboard listeners');
  await page.evaluate(()=>document.removeEventListener('keydown',window.__tuningKeyListener));
  await toggle.click();
  const layout=[];
  for(const viewport of [c.viewport,{width:390,height:740}]) {
    await page.setViewportSize(viewport);
    await panel.evaluate(element=>{element.scrollTop=0;});
    await page.evaluate(viewport=>{r.resize(viewport.width,viewport.height);r.draw(bundle);r.__laneCapture();},viewport);
    const bounds=await panel.boundingBox();
    check(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width+1&&bounds.y+bounds.height<=viewport.height+1,c.name,'Live tuning panel leaves the viewport',{viewport,bounds});
    const noHorizontalOverflow=await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1);
    check(noHorizontalOverflow,c.name,'Live tuning panel has horizontal overflow',{viewport});
    await page.screenshot({path:path.join(out,`${c.name}-tuning-${viewport.width}x${viewport.height}.png`)});
    layout.push({viewport,bounds,noHorizontalOverflow});
  }
  await page.setViewportSize(c.viewport);
  const lifecycle=await page.evaluate(async()=>{
    const old=document.querySelector('[data-camera-setting="stableCameraDepartureDelay"][data-camera-input="number"]');
    r.destroy();const remaining=document.querySelectorAll('.h3d-camera-tuning').length;
    old.value='200';old.dispatchEvent(new Event('change',{bubbles:true}));
    const valueAfterDetachedEvent=localStorage.getItem('h3d_bg_stableCameraDepartureDelay');
    window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;r.__laneDisableGpu();r.draw(bundle);
    return {remaining,valueAfterDetachedEvent,recreated:document.querySelectorAll('.h3d-camera-tuning').length,
      restored:document.querySelector('[data-camera-setting="stableCameraDepartureDelay"][data-camera-input="number"]').value};
  });
  check(lifecycle.remaining===0&&lifecycle.recreated===1&&lifecycle.valueAfterDetachedEvent==='100'&&lifecycle.restored==='100',c.name,'Live panel cleanup/recreation lost settings or retained old handlers',lifecycle);
  return {layout,lifecycle};
}

async function validateLiveConsistency(page,c) {
  assert.ok(c.end-c.start>3,'Live consistency needs a passage longer than three source seconds');
  const runs=await page.evaluate(async c=>{
    const records=[];
    const audit=()=>r.__laneLiveAudit();
    const advance=(end,history=[])=>{
      while(bundle.currentTime<end-1e-9) {
        const time=Math.min(end,bundle.currentTime+bundle.playbackRate/60);
        window.__wall+=(time-bundle.currentTime)/bundle.playbackRate*1000;
        bundle.currentTime=time;r.draw(bundle);history.push(audit());
      }
      return audit();
    };
    const control=key=>document.querySelector('[data-camera-setting="'+key+'"][data-camera-input="number"]');
    const commit=value=>{const input=control('stableCameraExcursionThreshold');input.value=String(value);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    const follow=value=>{const input=document.querySelector('[data-camera-setting="stableCameraFollow"]');
      input.checked=value;input.dispatchEvent(new Event('change',{bubbles:true}));r.draw(bundle);};
    const reset=async()=>{
      r.destroy();window.__wall=1000;window.h3dBgSetStableCameraFollow(true);
      window.h3dBgSetStableCameraExcursionThreshold(250);
      window.bundle={...c.b,currentTime:c.start,playbackRate:c.rate,isPlaying:true};
      window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);
      await r.readyPromise;r.__laneDisableGpu();r.draw(bundle);
      document.querySelector('[data-camera-tuning-toggle]').click();
    };
    for(const mode of ['playing','paused','follow','rate','rapid']) {
      await reset();const changes=[];
      const thresholds=[500,900,350,250,500];
      for(const [index,value]of thresholds.entries()) {
        const target=mode==='rapid'?c.start+(c.end-c.start)*.2+index*.12*c.rate
          :c.start+(c.end-c.start)*[.1,.26,.42,.58,.74][index];
        advance(Math.max(bundle.currentTime,target));
        if(mode==='paused'){bundle.isPlaying=false;r.draw(bundle);}
        const before=audit();commit(value);r.draw(bundle);const after=audit();
        const change={value,before,after,stored:localStorage.getItem('h3d_bg_stableCameraExcursionThreshold'),history:[]};
        if(c.liveHome) {
          // Entry and next-section anticipation may straddle a manually chosen loop.
          const start=c.start+.4,end=c.end-.4,plan=r.__lanePlan(),prior=plan.stops.filter(s=>s.time<=start).at(-1);
          change.home={start,end,expected:plan.regions.find(s=>s.firstFret===c.liveHome)?.preferred,
            stops:[...(prior?[prior]:[]),...plan.stops.filter(s=>s.time>start&&s.time<end)].map(s=>({time:s.time,x:s.x})),
            motion:plan.motion.filter(s=>s.start<end&&s.end>start).map(s=>({start:s.start,end:s.end,from:s.from,to:s.to}))};
        }
        if(mode==='rapid'&&index<thresholds.length-1){changes.push(change);continue;}
        if(mode==='paused') {
          window.__wall+=500;r.draw(bundle);change.held=audit();
          bundle.isPlaying=true;r.draw(bundle);change.resume=audit();
        } else if(mode==='follow') {
          advance(bundle.currentTime+.15*bundle.playbackRate,change.history);follow(false);
          change.heldBefore=audit();advance(bundle.currentTime+.2*bundle.playbackRate);
          change.held=audit();follow(true);change.resume=audit();
        } else if(mode==='rate') {
          advance(bundle.currentTime+.15*bundle.playbackRate,change.history);change.rateBefore=audit();
          bundle.playbackRate=bundle.playbackRate===2?.5:2;r.draw(bundle);change.resume=audit();
        }
        change.rejoinStart=bundle.currentTime;
        change.converged=advance(bundle.currentTime+.7*bundle.playbackRate,change.history);
        change.afterConvergence=advance(bundle.currentTime+.2*bundle.playbackRate,change.history);
        changes.push(change);
      }
      advance(c.end);const beforeWrap=audit();
      window.__wall+=1000/60;bundle.currentTime=c.start;r.draw(bundle);const wrapped=audit();
      const wrapHistory=[];advance(Math.min(c.end,c.start+1.1*bundle.playbackRate),wrapHistory);
      records.push({mode,changes,beforeWrap,wrapped,wrapHistory});
    }
    return records;
  },c);
  for(const run of runs) {
    for(const change of run.changes) {
      const evidence={mode:run.mode,value:change.value,before:change.before,after:change.after};
      check(Number(change.stored)===change.value,c.name,'Live threshold edit was not committed',evidence);
      check(Math.abs(change.before.x-change.after.x)<1e-8,c.name,'Live threshold edit jumped horizontally',evidence);
      if(change.home) {
        const held=change.home.stops.every(s=>Math.abs(s.x-change.home.expected)<1e-8)
          &&change.home.motion.every(s=>Math.abs(s.from-change.home.expected)<1e-8&&Math.abs(s.to-change.home.expected)<1e-8);
        check(change.value===250?!held:held,c.name,change.value===250
          ?'The lower threshold incorrectly suppressed the known 300ms lane movements'
          :'The per-lane threshold did not consistently retain the known local riff home',
          {mode:run.mode,value:change.value,home:change.home});
      }
      if(run.mode!=='paused')check(Math.abs(change.before.velocity-change.after.velocity)<1e-7,c.name,'Live threshold edit broke velocity continuity',evidence);
      if(change.held) {
        const before=change.heldBefore||change.after;
        check(change.held.x===before.x&&change.held.distance===before.distance,c.name,'Pause or Follow-off did not hold the live-edit pose',{mode:run.mode,before,after:change.held});
        check(Math.abs(change.resume.x-change.held.x)<1e-8,c.name,'Resuming a live edit jumped horizontally',{mode:run.mode,held:change.held,resume:change.resume});
      }
      if(change.rateBefore)check(Math.abs(change.rateBefore.x-change.resume.x)<1e-8&&Math.abs(change.rateBefore.velocity-change.resume.velocity)<1e-7,
        c.name,'Changing speed during a live correction broke pose or velocity continuity',{before:change.rateBefore,after:change.resume});
      if(change.converged) {
        for(const sample of [change.converged,change.afterConvergence]) {
          check(Math.abs(sample.x-sample.plannedX)<1e-7&&Math.abs(sample.velocity-sample.plannedVelocity)<1e-6,
            c.name,'Live edit did not rejoin the current plan within 700ms without seeking',{mode:run.mode,value:change.value,rejoinStart:change.rejoinStart,sample});
        }
        check(change.history.every(s=>!s.clockReset&&[s.x,s.distance,s.velocity].every(Number.isFinite)),c.name,
          'Live-edit convergence required a seek or produced non-finite state',{mode:run.mode,value:change.value});
      }
    }
    check(Math.abs(run.wrapped.x-run.wrapped.plannedX)<1e-8&&run.wrapped.clockReset,c.name,
      'Loop wrap retained an obsolete live correction',{mode:run.mode,sample:run.wrapped});
    check(run.wrapHistory.every(s=>Math.abs(s.x-s.plannedX)<1e-7),c.name,
      'Loop playback diverged again after a live edit',{mode:run.mode});
  }
  return runs;
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'source.sha256'),sha(source)+'\n');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args:['--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage();
    page.on('pageerror',e=>errors.push(e.stack));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.addInitScript(()=>{window.__wall=1000;window.__realNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>window.__wall,configurable:true});});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://lane-follow.test')return route.fulfill({status:403,body:'External network disabled'});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
      if(url.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:instrument(source)});
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream'});
      return route.fulfill({status:404,body:'Missing fixture asset'});
    });
    await page.goto('http://lane-follow.test/');
    for(const c of cases) {
      await page.setViewportSize(c.viewport);
      const initial=await page.evaluate(async c=>{
        window.r?.destroy();localStorage.clear();window.__h3dCamCtl=null;window.__wall=1000;
        const settings={cameraMode:'stable',stableCameraPreset:c.preset,stableCameraFollow:true,cameraSmoothing:.5,zoomSmoothing:.5,tiltSmoothing:.5,cameraLockLow:false,
          notationStyle:'current',style:'off',glow:0,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false,
          ...c.cameraSettings};
        for(const[k,v]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)]?.(v);}
        window.bundle={...c.b,currentTime:c.start,playbackRate:c.rate};window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;r.__laneDisableGpu();r.draw(bundle);
        return {sample:r.__laneAudit(true),plan:r.__lanePlan()};
      },c);
      const captureTimes=captures.get(c.sourceName)||[];
      const boundariesAndMotion=[...initial.plan.regions.map(r=>r.time),...initial.plan.motion.flatMap(s=>[s.start,s.end,s.nominalStart,s.nominalEnd]).filter(Number.isFinite)];
      const times=new Set([c.start,c.end,...boundariesAndMotion.filter(t=>t>=c.start&&t<=c.end),...captureTimes.filter(t=>t>=c.start&&t<=c.end)]);
      for(let t=c.start+c.rate/c.fps;t<c.end;t+=c.rate/c.fps)times.add(Math.round(t*1e9)/1e9);
      const ordered=[...times].sort((a,b)=>a-b),samples=[];
      for(let offset=0;offset<ordered.length;offset+=600) {
        const chunk=await page.evaluate(({times,rate,captureTimes})=>{
          const samples=[],images=[];
          for(const time of times){window.__wall+=Math.max(0,time-bundle.currentTime)/rate*1000;bundle.currentTime=time;r.draw(bundle);
            const capture=captureTimes.some(t=>Math.abs(time-t)<1e-7);samples.push(r.__laneAudit(capture));
            if(capture)images.push({time,png:r.__laneCapture()});}
          return {samples,images};
        },{times:ordered.slice(offset,offset+600),rate:c.rate,captureTimes});
        samples.push(...chunk.samples);
        for(const image of chunk.images)fs.writeFileSync(path.join(out,`${c.name}-${image.time.toFixed(6)}.png`),Buffer.from(image.png.split(',')[1],'base64'));
      }
      const boundaries=validate(c,samples,initial.plan);
      let performanceDiagnostics;
      if(args.includes('--perf')){const times=await page.evaluate(()=>r.__laneCpu(200));const sorted=times.slice().sort((a,b)=>a-b);
        performanceDiagnostics={method:'Warm camera CPU, stationary song position, GPU disabled; not a live FPS measurement',meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)};}
      if(args.includes('--moving-perf')){
        const inRange=s=>s.start>=c.start&&s.end<=c.end;
        const movement=initial.plan.motion.find(s=>s.tuningEligible&&inRange(s))||initial.plan.motion.find(inRange);
        if(movement){
          const start=Math.max(c.start,movement.start),end=Math.min(c.end,movement.end);
          if(end>start){
            const times=await page.evaluate(({start,end})=>r.__laneMovingCpu(start,end,300),{start,end});
            const sorted=times.slice().sort((a,b)=>a-b);
            performanceDiagnostics={...performanceDiagnostics,moving:{method:'Warm production draw CPU over a camera movement, GPU rendering disabled; not live FPS',
              start,end,frames:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1)}};
          }
        }
      }
      let lifecycle;
      if(args.includes('--lifecycle'))lifecycle=await page.evaluate(()=>{
        bundle.isPlaying=false;r.draw(bundle);const before=r.__laneAudit();window.__wall+=1000;r.draw(bundle);const after=r.__laneAudit();
        bundle.currentTime=Math.max(0,bundle.currentTime-3);r.draw(bundle);const sought=r.__laneAudit();return {before,after,sought};
      });
      if(lifecycle)check(lifecycle.before.x===lifecycle.after.x&&lifecycle.before.distance===lifecycle.after.distance,c.name,'Pause changed camera pose');
      if(args.includes('--lifecycle')&&c.kind==='arrival') {
        const moving=await page.evaluate(async c=>{
          const reset=async()=>{window.r.destroy();window.__wall=1000;window.h3dBgSetStableCameraFollow(true);
            window.bundle={...c.b,currentTime:6,playbackRate:c.rate};window.r=feedBackViz_highway_3d();
            r.init(document.getElementById('highway'),bundle);await r.readyPromise;r.__laneDisableGpu();r.draw(bundle);};
          const advance=(end,history=null)=>{while(bundle.currentTime<end-1e-9){const time=Math.min(end,bundle.currentTime+bundle.playbackRate/60);
            window.__wall+=(time-bundle.currentTime)/bundle.playbackRate*1000;bundle.currentTime=time;r.draw(bundle);if(history)history.push(r.__laneAudit());}return r.__laneAudit();};
          const rateChanges=[];
          for(const rate of [.5,2].filter(rate=>rate!==c.rate)) {
            await reset();advance(7.5);const before=r.__laneAudit();bundle.playbackRate=rate;r.draw(bundle);
            const after=r.__laneAudit(),history=[after];
            const arrivalTime=r.__lanePlan().motion.find(s=>Math.abs((s.nominalEnd??s.end)-8)<1e-6)?.end??8;
            const arrival=advance(arrivalTime,history);
            rateChanges.push({from:c.rate,to:rate,before,after,arrivalTime,arrival,history});
          }
          await reset();advance(7.5);window.h3dBgSetStableCameraFollow(false);r.draw(bundle);
          const offBefore=r.__laneAudit(),offAfter=advance(7.7);
          window.h3dBgSetStableCameraFollow(true);r.draw(bundle);const resume=r.__laneAudit(),resumeHistory=[resume];
          const resumeArrivalTime=r.__lanePlan().motion.find(s=>Math.abs((s.nominalEnd??s.end)-8)<1e-6)?.end??8;
          const resumeArrival=advance(resumeArrivalTime,resumeHistory);
          const target=r.__lanePlan().timeline.find(s=>Math.abs(s.time-8)<1e-6)?.x;
          return {rateChanges,offBefore,offAfter,resume,resumeArrivalTime,resumeArrival,resumeHistory,target};
        },c);
        lifecycle.moving=moving;
        for(const change of moving.rateChanges) {
          check(Math.abs(change.before.x-change.after.x)<1e-8,c.name,'A mid-pan speed change jumped horizontally',{from:change.from,to:change.to});
          check(Math.abs(change.arrival.x-moving.target)<1e-7,c.name,'A mid-pan speed change missed the next lasting arrival',{from:change.from,to:change.to});
          check(change.history.every((s,i)=>!i||s.x>=change.history[i-1].x-1e-8),c.name,'A mid-pan speed change caused a reverse excursion',{from:change.from,to:change.to});
        }
        check(moving.offBefore.x===moving.offAfter.x&&moving.offBefore.distance===moving.offAfter.distance,c.name,'Follow off changed the held pose');
        check(Math.abs(moving.offAfter.x-moving.resume.x)<1e-8,c.name,'Resuming Follow jumped horizontally');
        check(Math.abs(moving.resumeArrival.x-moving.target)<1e-7,c.name,'Resuming Follow missed the next lasting arrival');
        check(moving.resumeHistory.every((s,i)=>!i||s.x>=moving.resumeHistory[i-1].x-1e-8),c.name,'Resuming Follow caused a reverse excursion');
      }
      const tuningUi=args.includes('--tuning-ui')&&c.kind==='arrival'?await validateTuningUi(page,c):undefined;
      const liveConsistency=args.includes('--live-consistency')?await validateLiveConsistency(page,c):undefined;
      const run={name:c.name,sourceName:c.sourceName,kind:c.kind,preset:c.preset,rate:c.rate,fps:c.fps,viewport:c.viewport,start:c.start,end:c.end,cameraSettings:c.cameraSettings,tuningUi,
        chartHash:c.chartHash,sourceHash:sha(source),metrics:summary(samples),boundaries,performanceDiagnostics,lifecycle,liveConsistency,
        classification:initial.plan.timeline.map(s=>({time:s.time,end:s.end,duration:s.duration,firstFret:s.firstFret,kind:s.kind,lasting:s.lasting})),plan:initial.plan,samples};
      fs.writeFileSync(path.join(out,c.name+'.json'),JSON.stringify(run));
      results.push({...run,plan:undefined,samples:undefined,lifecycle:undefined,liveConsistency:undefined});
      console.log(JSON.stringify({name:c.name,...run.metrics,boundaries:boundaries.length,failures:failures.filter(f=>f.name===c.name).length}));
    }
  } finally {await browser.close();}
  for(const run of results) {
    const peer=results.find(other=>other.sourceName===run.sourceName);
    check(JSON.stringify(run.classification)===JSON.stringify(peer.classification),run.name,'Speed, preset, or viewport changed original-song lane classification');
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourceHash:sha(source),reference:args.includes('--reference'),results,failures,errors},null,2));
  console.log(JSON.stringify({cases:results.length,failures:failures.length,browserErrors:errors.length,out}));
  if(errors.length||failures.length&&!args.includes('--reference'))process.exitCode=1;
}
main().catch(error=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fatal.txt'),error.stack);console.error(error);process.exitCode=1;});
