#!/usr/bin/env node
/* Isolated actual-WebGL chord hold acceptance. No server or library writes.
 * node tests/browser/highway-chord-hold-guidance.cjs --out <fresh directory>
 * Optional: --repo <checkout> --reference --style current|rsplus --case <substring>
 * --real-root <verification root> --perf [--perf-only] --width 1280 --height 720
 * --evil-chart <extracted Hybrid Lead JSON> adds the reported Songsterr cases.
 * --position-chart <audited Rats JSON> adds chord-position regression cases.
 * PLAYWRIGHT_MODULE can identify an existing Playwright installation.
 * PLAYWRIGHT_EXECUTABLE_PATH can select an existing headless Chromium binary.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/chord-holds')));
const reference = args.includes('--reference');
const style = option('--style', 'rsplus');
const width = Number(option('--width', 1280)), height = Number(option('--height', 720));
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const failures = [], errors = [], results = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
function once(value, anchor, replacement) {
  assert.equal(value.split(anchor).length, 2, 'Expected unique instrumentation anchor: ' + anchor);
  return value.replace(anchor, replacement);
}
let served = source;
if(served.includes('const positionAnchors = anchors;'))served=once(served,'const positionAnchors = anchors;',
  'const positionAnchors = anchors; if(window.__holdProbe)window.__holdProbe.lanes=positionAnchors.map(a=>({...a}));');
if (served.includes('function hwyResolveGuidanceAnchors(notes, chords, anchors) {'))
  served=once(served,'function hwyResolveGuidanceAnchors(notes, chords, anchors) {',
    'function hwyResolveGuidanceAnchors(notes, chords, anchors) { window.__guidanceBuilds=(window.__guidanceBuilds||0)+1;');
if(served.includes('function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) {'))
  served=once(served,'function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) {',
    'function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) { if(window.__holdBuilds!==undefined)window.__holdBuilds++;');
served = once(served, 'const core = pNote.get();', `const core = pNote.get();
 if(window.__holdProbe)window.__holdProbe.notes.push({note:{...n},fromChord,mesh:core});`);
served = once(served, 'const proj = projMeshArr[s][0];', `const proj = projMeshArr[s][0];
 if(window.__holdProbe)window.__holdProbe.positions.push({note:{...n},fromChord,mesh:proj});`);
for (const anchor of ['const line = pConnectorLine.get();', 'const dl = pDropLine.get();']) {
  const mesh = anchor.includes('const line') ? 'line' : 'dl';
  served = once(served, anchor, `${anchor}
   if(window.__holdProbe)window.__holdProbe.stems.push({note:{...n},mesh:${mesh}});`);
}
served = once(served, 'const fill = pChordFrameFill.get();', `const fill = pChordFrameFill.get();
 if(window.__holdProbe)window.__holdProbe.frames.push({t:ch.t,isRepeat,isArpeggioFrame,compactRepeatFrame,outerWidth:width,borderWidth:ftSide,mesh:fill});`);
served = once(served, 'const tr = pSus.get();', `const tr = pSus.get();
 if(window.__holdProbe)window.__holdProbe.trails.push({note:{...n},mesh:tr});`);
if (served.includes('const holdRail = pSusRail.get();')) {
  served = once(served, 'const holdRail = pSusRail.get();', `const holdRail = pSusRail.get();
   if(window.__holdProbe)window.__holdProbe.rails.push({start:hold.start,end:hold.end,source:hold.source,dMin:hold.dMin,dMax:hold.dMax,nearTime,farTime,xl,xr,length,zMid,mesh:holdRail});`);
  served = once(served, 'const holdEnd = pSusRail.get();', `const holdEnd = pSusRail.get();
   if(window.__holdProbe)window.__holdProbe.caps.push({start:hold.start,end:hold.end,mesh:holdEnd});`);
}
if (served.includes('const rl = pSusRail.get();')) {
  served = once(served, 'const rl = pSusRail.get();', `const rl = pSusRail.get();
   if(window.__holdProbe)window.__holdProbe.${reference?'rails':'legacyRails'}.push({start:ch.t,end:now+_dtSusEndRail,nearTime:now+zToDt(_zNear),farTime:now+zToDt(_zFar),mesh:rl});`);
  // The old renderer has no inverse conversion helper; only semantic end is needed.
  served = served.replace('nearTime:now+zToDt(_zNear),farTime:now+zToDt(_zFar),', '');
}
if(served.includes('const positionRail = pLaneDivider.get();'))served=once(served,'const positionRail = pLaneDivider.get();',
  'const positionRail = pLaneDivider.get(); if(window.__holdProbe)window.__holdProbe.positionRails.push({start:guide.start,end:guide.end,dMin:guide.dMin,dMax:guide.dMax,nearTime,farTime,mesh:positionRail});');
served = once(served, 'bodyGeom.attributes.position.needsUpdate = true;', `bodyGeom.attributes.position.needsUpdate = true;
 if(window.__holdProbe)window.__holdProbe.ribbons.push({note:{...n},end:susStart+sliceDur});`);
served = once(served, "contextType: 'webgl2',", `__holdAudit(){return {ren,cam,scene,fretWorld:xFret,style:typeof rsPlusNotation==='undefined'?'current':rsPlusNotation?'rsplus':'current'};},contextType: 'webgl2',`);

const note = values => ({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,...values});
const pair = (sus=0) => [note({s:1,f:3,sus}),note({s:2,f:5,sus})];
const template = {name:'C5',frets:[-1,3,5,-1,-1,-1],fingers:[-1,1,3,-1,-1,-1]};
const shape = (start=10,end=13,chord_id=0,extra={}) => ({start_time:start,end_time:end,chord_id,...extra});
const chord = (t=10,sus=0,extra={}) => ({t,id:0,notes:pair(sus),...extra});
function base(extra={}) {
  return {currentTime:9.7,isPlaying:false,notes:[],chords:[],chordTemplates:[template],anchors:[{time:0,fret:3,width:4}],
    handShapes:[],beats:Array.from({length:25},(_,i)=>({time:6+i*.5,measure:i%4===0?i/4:-1})),sections:[],lyrics:[],stringCount:6,
    tuning:[0,0,0,0,0,0],songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false,...extra};
}
const scenarios=[];
function add(name,b,expected,extra={}) { scenarios.push({name,b,expected,...extra}); }
// A hand position is not an attack. This reduced Away from the Sun passage
// includes the reported false low-E 3 at 38.87 and the real sustained 3 later.
const handshapePassage = base({currentTime:38.2,anchors:[{time:0,fret:1,width:4}],
  notes:[note({t:38.869999,s:4,f:0}),note({t:39.097,s:3,f:0}),
    note({t:39.324001,s:0,f:3,sus:.34}),note({t:39.778,s:4,f:3})],
  chordTemplates:[{name:'',frets:[3,-1,-1,-1,-1,-1]},
    {name:'',frets:[3,-1,-1,-1,3,-1]}],
  handShapes:[shape(38.869999,39.266998),shape(39.324001,40.175999,1)]});
add('handshape-reported',handshapePassage,[],{image:true,
  absentGems:[{t:38.869999,s:0,f:3}],presentGems:[{t:39.324001,s:0,f:3}],
  stemNotes:[{t:39.324001,s:0,f:3}],wantTrailOnsets:[39.324001],
  sampleTimes:[38.2,38.7,38.869999,38.90,39.324001,39.45,39.8,38.2]});
for (const members of [[3,-1,-1,-1,-1,-1],[3,5,-1,-1,-1,-1]]) {
  const phantom=members.flatMap((f,s)=>f<0?[]:[{t:10,s,f}]);
  add('handshape-unplayed-'+phantom.length,base({notes:[note({t:10,s:4,f:1})],
    chordTemplates:[{name:'',frets:members}],handShapes:[shape(10,12)]}),[],
    {image:true,absentGems:phantom,presentGems:[{t:10,s:4,f:1}],stemNotes:[{t:10,s:4,f:1}],
      exactFrames:0,absentPositionNotes:phantom,sampleTimes:[9.7,10,10.03,10.5,9.7]});
}
add('handshape-coincident',base({notes:[note({t:10,s:1,f:3,sus:.6})],
  handShapes:[shape(10,12)]}),[],{image:true,absentGems:[{t:10,s:2,f:5}],
  presentGems:[{t:10,s:1,f:3}],stemNotes:[{t:10,s:1,f:3}],exactFrames:0,
  wantTrailOnsets:[10],sampleTimes:[9.7,10,10.03,10.3,9.7]});
// An arpeggio flag alone cannot justify phantom fingering or a blue frame.
add('handshape-explicit-unplayed',base({chordTemplates:[{...template,arp:true}],
  handShapes:[shape(10,12,0,{arp:true})]}),[],{image:true,
  absentGems:[{t:10,s:1,f:3},{t:10,s:2,f:5}],
  absentPositionNotes:[{t:10,s:1,f:3},{t:10,s:2,f:5}],exactFrames:0});
// The same authored grip remains visible when actual picked notes support it.
add('handshape-explicit-preview',base({chordTemplates:[{...template,arp:true}],
  notes:[note({t:10,s:1,f:3,sus:.3}),note({t:10.5,s:2,f:5,sus:.3})],
  handShapes:[shape(10,12,0,{arp:true})]}),[],{image:true,
  absentGems:[{t:10,s:2,f:5}],presentGems:[{t:10,s:1,f:3},{t:10.5,s:2,f:5}],
  positionNotes:[{t:10,s:1,f:3},{t:10,s:2,f:5}],exactFrames:1});
add('handshape-real-chord',base({chords:[chord(10,.6)],handShapes:[shape(10,12)]}),[[10,10.6]],
  {image:true,presentGems:[{t:10,s:1,f:3},{t:10,s:2,f:5}],exactFrames:1});
// A rejected grip's finite end is still negative-only timing evidence: the
// later picked note must not retroactively turn the real chord into an arp.
add('rejected-handshape-timing-veto',base({currentTime:19.7,
  anchors:[{time:0,fret:5,width:4}],
  chordTemplates:[{name:'A5',frets:[5,7,-1,-1,-1,-1]},
    {name:'Stale grip',frets:[3,5,-1,-1,-1,-1]}],
  chords:[20,21].map(t=>chord(t,0,{notes:[note({s:0,f:5}),note({s:1,f:7})]})),
  notes:[note({t:20,s:0,f:5}),note({t:20.25,s:1,f:7})],
  handShapes:[shape(20,20.25,1)]}),[],{image:true,wantFrames:2,
    presentGems:[{t:20,s:1,f:7},{t:21,s:1,f:7}],noArpeggioFrames:true});
for (const origin of ['source', 'user', 'generated', 'unknown']) {
  for (const cameraMode of ['lookahead', 'stable']) for (const lefty of [false, true]) {
    const lo = 1, hi = 5;
    add(`provenance-${origin}-${cameraMode}-${lefty}`, base({cameraMode,lefty,
      anchors:[{time:0,fret:2,width:4,guidanceOrigin:origin}],
      chords:[chord(10,0),chord(10.6,0,{hd:true})],handShapes:[shape(10,12)]}),[[10,12]],
      {image:true,wantFrames:2,frameBounds:[[10,lo,hi],[10.6,lo,hi]]});
  }
}
for(const cameraMode of ['lookahead','stable']) for(const lefty of [false,true]) {
  add(`shared-legacy-g-${cameraMode}-${lefty}`,base({cameraMode,lefty,currentTime:71.8,
    anchors:[{time:67.039001,fret:2,width:4},{time:71.998001,fret:2,width:4}],
    chordTemplates:[{name:'G5',frets:[3,-1,0,0,3,3],fingers:[-1,-1,-1,-1,-1,-1]}],
    chords:[71.998,72.468,72.937].map((t,i)=>chord(t,0,{hd:i>0,
      notes:[3,127,0,0,3,3].map((f,s)=>note({s,f,mt:f===127}))})),handShapes:[]}),[],
    {image:true,wantFrames:3,sharedLane:true,frameBounds:[71.998,72.468,72.937].map(t=>[t,1,5])});
  add(`shared-legacy-outlying-${cameraMode}-${lefty}`,base({cameraMode,lefty,
    anchors:[{time:0,fret:12,width:8}],chords:[chord(10,1)]}),[[10,11]],
    {image:true,sharedLane:true,frameBounds:[[10,2,6]]});
}
for (const cameraMode of ['lookahead', 'stable']) {
  add('provenance-invalid-lane-'+cameraMode, base({cameraMode,
    anchors:[{time:0,fret:5,width:4,guidanceOrigin:'source'}], chords:[chord(10,1)]}),[[10,11]],
    {image:true,frameBounds:[[10,2,8]]});
  add('provenance-wrong-handshape-'+cameraMode, base({cameraMode,
    anchors:[{time:0,fret:2,width:4,guidanceOrigin:'source'}], chords:[chord(10)],
    handShapes:[shape(10,12,99)]}),[], {image:true,frameBounds:[[10,1,5]]});
}
for(const now of [9.7,10,10.4,10.99,11,11.01,12.5]) add('known-one-second-'+now,
  base({currentTime:now,chords:[chord(10,1)],handShapes:[shape()]}),now<11?[[10,11]]:[],{image:[9.7,10.4,11.01].includes(now),noTrails:true});
for(const now of [9.7,10.05,10.11]) add('short-known-'+now,
  base({currentTime:now,chords:[chord(10,.1)]}),now<10.1?[[10,10.1]]:[],{image:now===9.7,noTrails:true});
add('unknown',base({chords:[chord()]}),[],{image:true});
add('legacy-repeat',base({chords:[chord(10),chord(10.6,0,{hd:true}),chord(11.2,0,{hd:true})],handShapes:[shape(10,12)]}),[[10,12]],{image:true,wantFrames:3});
add('muted',base({chords:[chord(10,0,{notes:pair().map(n=>({...n,pm:true}))})],handShapes:[shape()]}),[],{image:true});
add('palm-muted-open-chord',base({chords:[chord(10,.21375,{notes:[note({s:0,f:0,sus:.21375,pm:true}),note({s:1,f:0,sus:.21375,pm:true})]})]}),
  [[10,10.21375]],{image:true,noTrails:true,wantMute:true});
add('palm-muted-single-open',base({notes:[note({t:10,s:0,f:0,sus:.4,pm:true})]}),[],{image:true,wantOpenTrail:true,wantMute:true});
add('palm-muted-repeat',base({chords:[chord(10,.3,{notes:pair(.3).map(n=>({...n,pm:true}))}),
  chord(10.3,.3,{hd:true,notes:pair(.3).map(n=>({...n,pm:true}))})]}),[[10,10.6]],{image:true,noTrails:true,wantFrames:2});
for(const [name,frets] of [['hammer',[5,7]],['pull-open',[5,0]],['hammer-pull',[5,7,5,0]]]) {
  const step=.2, total=1;
  for(const now of [9.7,10.3,11.01]) {
    const notes=frets.slice(1).map((f,i)=>note({t:10+(i+1)*step,s:2,f,sus:i===frets.length-2?total-(i+1)*step:step,
      ln:i<frets.length-2,[f>frets[i]?'ho':'po']:true}));
    add('legato-'+name+'-'+now,base({currentTime:now,notes,
      chords:[chord(10,0,{notes:[note({s:1,f:5,sus:total}),note({s:2,f:frets[0],sus:step,ln:true})]})]}),
      now<11?[[10,11]]:[],{image:now===9.7,trailStrings:now<11?[2]:[],wantLegato:now===9.7});
  }
}
add('partial',base({chords:[chord(10,0,{notes:[...pair().slice(0,1)]})],handShapes:[shape()]}),[],{image:true});
add('picked',base({notes:[note({t:10,s:1,f:3,sus:.4}),note({t:10.5,s:2,f:5,sus:.5})],handShapes:[shape()]}),[],{image:true});
add('picked-carrier',base({chords:[chord()],notes:[note({t:10.1,s:1,f:3,sus:.4}),note({t:10.5,s:2,f:5,sus:.5})],handShapes:[shape()]}),[],{image:true});
add('arpeggio',base({chords:[chord(10,1)],handShapes:[shape(10,13,0,{arp:true})],chordTemplates:[{...template,arp:true}]}),[],{image:true});
add('open-unequal',base({chords:[chord(10,0,{notes:[note({s:1,f:0,sus:1.5}),note({s:2,f:2,sus:.7})]})],
  chordTemplates:[{name:'A5',frets:[-1,0,2,-1,-1,-1],fingers:[-1,-1,1,-1,-1,-1]}]}),[],{image:true,wantOpenTrail:true});
add('linked-slide',base({chords:[chord(10,1,{notes:pair(1).map(n=>({...n,sl:n.f+2,ln:true}))}),
  chord(11,1,{notes:pair(1).map(n=>({...n,f:n.f+2}))})]}),null,{image:true,wantRibbons:true});
for(const now of [9.7,10.6]) add('anchor-change-'+now,base({currentTime:now,chords:[chord(10,2)],anchors:[{time:0,fret:3,width:4},{time:10.4,fret:9,width:4}]}),[[10,12]],{image:true,noTrails:true});
// Both chord members support this full grip through the authored handshape.
// Keep its position in the single main lane after the one-second hold ends;
// the unrelated anchor resumes only when the handshape itself ends at 13.
for(const now of [10.5,11.5])add('guide-anchor-change-'+now,base({currentTime:now,chords:[chord(10,1)],handShapes:[shape(10,13)],
  anchors:[{time:0,fret:3,width:4},{time:11,fret:8,width:4}]}),now<11?[[10,11]]:[],
    {image:true,wantUnifiedPosition:[[11,3,6],[12.999,3,6],[13.001,8,11]]});
add('equivalent-template',base({chords:[chord()],chordTemplates:[template,{...template}],handShapes:[shape(10,12,1)]}),[[10,12]],{image:false});
add('gap',base({chords:[chord(10),chord(11)],handShapes:[shape(10,10.4),shape(11,11.5)]}),[[10,10.4],[11,11.5]],{image:true});
add('no-duplicate-open-trail',base({chords:[chord(10,0,{notes:[note({s:1,f:0,sus:1}),note({s:2,f:2,sus:1})]})],
  chordTemplates:[{name:'A5',frets:[-1,0,2,-1,-1,-1],fingers:[-1,-1,1,-1,-1,-1]}]}),[[10,11]],{image:true,noTrails:true});
add('overlap-explicit-different-chords',base({chords:[chord(10,2),chord(11,2,{id:1,notes:pair(2).map(n=>({...n,f:n.s===1?3:6}))})],
  chordTemplates:[template,{name:'Alternate voicing',frets:[-1,3,6,-1,-1,-1],fingers:[-1,1,3,-1,-1,-1]}]}),[],{image:true,wantTrailOnsets:[10,11]});
add('overlap-explicit-shorter-repeat',base({chords:[chord(10,2),chord(11,.5)]}),[],{image:true,wantTrailOnsets:[10,11]});
for(const [name,extra] of [['left-handed',{lefty:true}],['inverted',{inverted:true}],['bass',{stringCount:4,tuning:[0,0,0,0]}],['eight-string',{stringCount:8,tuning:Array(8).fill(0)}],['no-anchor',{anchors:[]}]])
  add(name,base({...extra,chords:[chord(10,1)],handShapes:[shape()]}),[[10,11]],{image:false,noTrails:true});
const realRoot=option('--real-root');
if(option('--evil-chart')) {
  const raw=JSON.parse(fs.readFileSync(option('--evil-chart'),'utf8'));
  const bundle=currentTime=>base({...raw,currentTime,chordTemplates:raw.templates,handShapes:raw.handshapes});
  add('evil-palm-muted',bundle(20.5),null,{image:true,
    hiddenTrailNotes:[{t:20.875,s:0},{t:20.875,s:1},{t:21.08875,s:0},{t:21.08875,s:1}],
    wantHoldRange:[20.875,21.3025]});
  add('evil-hammer',bundle(50.7),null,{image:true,hiddenTrailNotes:[{t:50.98,s:1}],
    visibleTrailNotes:[{t:50.98,s:2},{t:51.1975,s:2}],wantHoldRange:[50.98,51.85]});
}
if(realRoot)for(const [name,file,times] of [
  ['bon-jovi','highway-bon-jovi-guide-audit-20260919/bon-jovi-lead-production-wire.json',[30,31,33,33.3,39,40]],
  ['twilight','highway-chord-rails-integration-20260919/twilight-production-wire.json',[92.6,92.95,93.37]],
  ['hot','highway-lane-pop-audit-20260918/hot-lead-wire.json',[119.7,119.9,129.9]],
]) {
  const filePath=path.join(realRoot,file);if(!fs.existsSync(filePath))continue;
  const raw=JSON.parse(fs.readFileSync(filePath,'utf8'));
  for(const currentTime of times)add(name+'-'+currentTime,base({...raw,currentTime,chordTemplates:raw.chordTemplates||raw.templates,
    handShapes:raw.handShapes||raw.handshapes,stringCount:raw.stringCount||raw.tuning?.length||6}),null,{image:true,realFileSha:sha(fs.readFileSync(filePath))});
}
if(option('--position-chart')) {
  const raw=JSON.parse(fs.readFileSync(option('--position-chart'),'utf8'));
  for(const cameraMode of ['lookahead','stable']) for(const lefty of [false,true]) {
    const currentTime=105.6;
    add('rats-position-'+cameraMode+(lefty?'-lefty':''),base({...raw,currentTime,lefty,cameraMode,
      chordTemplates:raw.templates,handShapes:raw.handshapes}),null,{image:true,
      frameBounds:[[105.78625,6,10],[107.03,2,6],[107.75375,4,8]]});
  }
}
function dense() {
  const b=base({currentTime:9.7});
  for(let i=0;i<800;i++) {const t=8+i*.10;b.chords.push(chord(t,i%5===0?.4:0));if(i%4===0)b.handShapes.push(shape(t,t+.4));}
  for(let i=0;i<160;i++)b.notes.push(note({t:9+i*.023,s:i%6,f:3+i%4,sus:i%5===0?1:0}));
  return b;
}

async function main() {
  if(fs.existsSync(path.join(out,'results.json')))throw new Error('Choose fresh output directory.');
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'source-sha256.txt'),sha(source)+'  '+sourcePath+'\n'+sha(source.replace(/\r\n/g,'\n'))+'  normalized-LF\n');
  const browser=await chromium.launch({headless:true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
  try {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.stack));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!=='http://hold-fixture.test')return route.fulfill({status:403,body:'External network forbidden.'});
      if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
      if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
      const relative=decodeURIComponent(u.pathname).replace(/^\/api\/plugins\/highway_3d\/(?:g\/camera-\d+\/)?src\//,'/plugins/highway_3d/src/');
      const file=path.resolve(repo,'.'+relative);
      if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:/\.m?js$/.test(file)?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Unknown fixture asset'});
    });
    await page.goto('http://hold-fixture.test/');
    await page.evaluate(()=>{
      window.__mesh=m=>({position:m.position.toArray(),scale:m.scale.toArray(),visible:m.visible,renderOrder:m.renderOrder,
        material:{color:m.material.color?.getHexString(),opacity:m.material.opacity,type:m.material.type,depthTest:m.material.depthTest,depthWrite:m.material.depthWrite,fog:m.material.fog}});
      window.__capture=()=>{
        const a=r.__holdAudit();window.__holdProbe={notes:[],stems:[],positions:[],frames:[],trails:[],ribbons:[],rails:[],caps:[],legacyRails:[],positionRails:[]};
        a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);
        const p=window.__holdProbe;window.__holdProbe=null;
        const result={style:a.style,time:bundle.currentTime,modelBuilds:window.__holdBuilds,renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,memory:{...a.ren.info.memory}}};
        for(const k of Object.keys(p))result[k]=p[k].map(({mesh,...x})=>mesh?({...x,mesh:__mesh(mesh)}):x);
        return result;
      };
    });
    async function init(b) {
      await page.evaluate(async({b,style})=>{
        if(window.r)r.destroy();localStorage.clear();
        const settings={cameraMode:b.cameraMode||'lookahead',style:'off',notationStyle:style,palette:'default',glow:0,vibrancy:.85,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0};
        for(const [k,v] of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(typeof setter==='function')setter(v);}
        window.__holdBuilds=0;window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
        for(let i=0;i<5;i++)r.draw(bundle);
      },{b,style});
    }
    for(const scenario of scenarios.filter(s=>!args.includes('--perf-only')&&(!option('--case')||s.name.includes(option('--case'))))) {
      await init(scenario.b);
      const proof=await page.evaluate(()=>__capture());
      results.push({name:scenario.name,expected:scenario.expected,realFileSha:scenario.realFileSha,...proof});
      const sameNote=(a,b)=>Math.abs(a.t-b.t)<1e-6&&a.s===b.s&&a.f===b.f;
      if(!reference) {
        for(const n of scenario.absentGems||[])check(!proof.notes.some(g=>sameNote(g.note,n)),scenario.name+': phantom gem '+JSON.stringify(n));
        for(const n of scenario.presentGems||[])check(proof.notes.filter(g=>sameNote(g.note,n)).length===1,scenario.name+': missing/duplicate gem '+JSON.stringify(n));
        for(const n of scenario.stemNotes||[])check(proof.stems.filter(g=>sameNote(g.note,n)).length===1,scenario.name+': missing/duplicate stem '+JSON.stringify(n));
        for(const n of scenario.positionNotes||[])check(proof.positions.some(g=>sameNote(g.note,n)&&g.mesh.visible&&g.mesh.material.opacity>0),scenario.name+': missing hand-position ghost '+JSON.stringify(n));
        for(const n of scenario.absentPositionNotes||[])check(!proof.positions.some(g=>sameNote(g.note,n)&&g.mesh.visible&&g.mesh.material.opacity>0),scenario.name+': unsupported hand-position ghost '+JSON.stringify(n));
        if(scenario.exactFrames!==undefined)check(proof.frames.length===scenario.exactFrames,scenario.name+': unexpected frame count');
      }
      check(proof.renderer.calls>0,scenario.name+': no draw calls');
      if(!reference)check(proof.modelBuilds===1,scenario.name+': model must build once, got '+proof.modelBuilds);
      if(!reference)check(proof.legacyRails.length===0,scenario.name+': old ambiguous thick rails remain');
      if(!reference&&scenario.expected) {
        check(proof.rails.length===scenario.expected.length*2,`${scenario.name}: ${proof.rails.length} rails, expected ${scenario.expected.length*2}`);
        for(const [start,end] of scenario.expected){const matches=proof.rails.filter(r=>Math.abs(r.start-start)<.0001&&Math.abs(r.end-end)<.0001);check(matches.length===2,`${scenario.name}: expected rail pair ${start}-${end}`);}
        if(scenario.noTrails)check(proof.trails.length===0&&proof.ribbons.length===0,scenario.name+': redundant individual trails');
        if(scenario.wantOpenTrail)check([...proof.trails,...proof.ribbons].some(t=>t.note.f===0),scenario.name+': missing open-string individual trail');
        for(const rail of proof.rails){
          check(rail.mesh.material.opacity===.86,scenario.name+': hold opacity changed');
          check(rail.mesh.material.type==='MeshBasicMaterial',scenario.name+': hold uses lighting');
          check(Math.abs(rail.nearTime-Math.max(proof.time,rail.start))<.00001,scenario.name+': hold starts at wrong time');
          check(rail.farTime<=rail.end+.00001&&rail.farTime>rail.nearTime,scenario.name+': hold extends past chart endpoint');
          if(Math.abs(rail.farTime-rail.end)<.00001)check(proof.caps.some(c=>c.start===rail.start&&c.end===rail.end),scenario.name+': missing end cap');
        }
        if(!scenario.expected.length)check(proof.caps.length===0,scenario.name+': stray hold end cap');
      }
      if(!reference&&scenario.wantRibbons)check(proof.ribbons.length>0,scenario.name+': moving technique ribbon lost');
      if(!reference&&scenario.wantFrames)check(proof.frames.length===scenario.wantFrames,scenario.name+': repeated strum frames lost');
      if(!reference&&scenario.noArpeggioFrames)check(!proof.frames.some(f=>f.isArpeggioFrame),scenario.name+': rejected handshape produced a blue arpeggio frame');
      if(!reference&&scenario.wantUnifiedPosition){
        check(proof.positionRails.length===0,scenario.name+': duplicate hand-position rails');
        for(const [time,first,last] of scenario.wantUnifiedPosition){
          const lane=proof.lanes.filter(a=>a.time<=time+.000501).at(-1);
          check(lane&&lane.fret===first&&lane.fret+lane.width-1===last,
            scenario.name+': unified hand position at '+time+' should be '+first+'-'+last);
        }
      }
      if(!reference&&scenario.wantTrailOnsets)for(const onset of scenario.wantTrailOnsets)
        check([...proof.trails,...proof.ribbons].some(t=>t.note.t===onset),scenario.name+': missing independent trail at '+onset);
      if(!reference&&scenario.trailStrings) {
        const actual=[...new Set([...proof.trails,...proof.ribbons].map(t=>t.note.s))].sort();
        check(JSON.stringify(actual)===JSON.stringify(scenario.trailStrings),scenario.name+': wrong strings retain trails: '+actual);
      }
      if(!reference&&scenario.wantLegato)check(proof.notes.some(n=>n.note.ho||n.note.po),scenario.name+': missing legato target gem');
      if(!reference&&scenario.wantMute)check(proof.notes.some(n=>n.note.pm),scenario.name+': missing palm-muted attack gem');
      if(!reference)for(const [key,wanted] of [['hiddenTrailNotes',false],['visibleTrailNotes',true]])for(const n of scenario[key]||[]) {
        const found=[...proof.trails,...proof.ribbons].some(t=>t.note.s===n.s&&Math.abs(t.note.t-n.t)<1e-6);
        check(found===wanted,scenario.name+': trail visibility at '+JSON.stringify(n)+' should be '+wanted);
      }
      if(!reference&&scenario.wantHoldRange) {
        const [start,end]=scenario.wantHoldRange;
        check(proof.rails.some(r=>r.start<=start+1e-6&&r.end>=end-1e-6),scenario.name+': shared hold missing');
      }
      if(scenario.frameBounds) {
        if(scenario.sharedLane)for(const [t,lo,hi] of scenario.frameBounds) {
          const row=proof.lanes.filter(a=>a.time<=t+.000501).at(-1);
          check(row&&row.fret-1===lo&&row.fret+row.width-1===hi,scenario.name+': floor/box lane mismatch '+t);
        }
        const expected=await page.evaluate(rows=>rows.map(([t,lo,hi])=>{
          const a=r.__holdAudit(),l=a.fretWorld(lo),h=a.fretWorld(hi);
          return {t,center:(l+h)/2,width:Math.abs(h-l)};
        }),scenario.frameBounds);
        for(const e of expected) {
          const frame=proof.frames.find(f=>Math.abs(f.t-e.t)<1e-6);
          check(!!frame,scenario.name+': missing chord frame '+e.t);
          if(frame){
            check(Math.abs(frame.mesh.position[0]-e.center)<1e-7,scenario.name+': incorrect frame center '+e.t);
            check(Math.abs(frame.outerWidth-e.width)<1e-7 && Math.abs(frame.mesh.scale[0]-Math.max(e.width-2*frame.borderWidth,e.width*.45))<1e-7,scenario.name+': incorrect frame width '+e.t);
          }
        }
      }
      if(scenario.image)await page.screenshot({path:path.join(out,scenario.name+'.png')});
      if(scenario.sampleTimes) {
        const samples=[];
        for(const time of scenario.sampleTimes) {
          const sample=await page.evaluate(time=>{bundle.currentTime=time;bundle.isPlaying=true;return __capture();},time);
          samples.push(sample);
          if(!reference)for(const n of scenario.absentGems||[])
            check(!sample.notes.some(g=>sameNote(g.note,n)),`${scenario.name}: phantom gem at playback/seek ${time}`);
          if(!reference)for(const n of scenario.absentPositionNotes||[])
            check(!sample.positions.some(g=>sameNote(g.note,n)&&g.mesh.visible&&g.mesh.material.opacity>0),`${scenario.name}: unsupported hand-position ghost at playback/seek ${time}`);
          if(!reference)for(const n of scenario.presentGems||[]) {
            const authored=scenario.b.notes.find(a=>sameNote(a,n));
            if(authored&&time<=n.t+(authored.sus||0))check(sample.notes.filter(g=>sameNote(g.note,n)).length===1,
              `${scenario.name}: missing/duplicate real gem at playback/seek ${time}`);
          }
        }
        results.push({name:scenario.name+'-playback-seek',samples});
      }
      console.log(`${scenario.name}: ${proof.rails.length} rails, ${proof.trails.length} trails, ${proof.ribbons.length} ribbons`);
    }
    if(!option('--case')&&!args.includes('--perf-only')) {
      await init(base({chords:[chord(10,1)],handShapes:[shape()]}));
      const seek=[];
      for(const time of [9.7,10.7,11.1,9.7,12.5,10.3])seek.push(await page.evaluate(time=>{bundle.currentTime=time;return __capture();},time));
      results.push({name:'seek',samples:seek});
      if(!reference)for(const p of seek){check(p.rails.length===(p.time<11?2:0),`seek to ${p.time}: stale/missing rails`);check(p.modelBuilds===1,`seek to ${p.time}: rebuilt model unnecessarily`);}
    }
    if(args.includes('--perf')) {
      const authoredDense=dense(); authoredDense.anchors=authoredDense.anchors.map(a=>({...a,guidanceOrigin:'source'}));
      const bundles=[['dense',dense()],['dense-authored',authoredDense]];
      const real=scenarios.find(s=>s.name==='bon-jovi-39');if(real)bundles.push(['bon-jovi',real.b]);
      for(const [name,b] of bundles){await init(b);const measured=await page.evaluate(()=>{
        const a=r.__holdAudit(),gl=a.ren.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
        for(let i=0;i<100;i++)r.draw(bundle);gl.finish();const cpu=[],finish=[],buildsBefore=window.__guidanceBuilds||0;
        for(let round=0;round<5;round++){let t=performance.now();for(let i=0;i<100;i++)r.draw(bundle);cpu.push((performance.now()-t)/100);t=performance.now();gl.finish();finish.push(performance.now()-t);}
        return {cpuMsPerDraw:cpu,finishWaitMs:finish,guidanceBuildsDuringFrames:(window.__guidanceBuilds||0)-buildsBefore,
          gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),proof:__capture()};
      });check(measured.guidanceBuildsDuringFrames===0,name+': guidance rebuilt during unchanged frames');
      results.push({name:'performance-'+name,...measured});console.log('Performance '+name+': '+JSON.stringify(measured.cpuMsPerDraw));}
    }
    check(errors.length===0,'Browser errors: '+errors.join('\n'));
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceSha:sha(source),sourceNormalizedLfSha:sha(source.replace(/\r\n/g,'\n')),reference,style,width,height,failures,errors,results},null,2));
  console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));
  if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
