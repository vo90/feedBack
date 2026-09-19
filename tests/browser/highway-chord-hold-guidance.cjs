#!/usr/bin/env node
/* Isolated actual-WebGL chord hold acceptance. No server or library writes.
 * node tests/browser/highway-chord-hold-guidance.cjs --out <fresh directory>
 * Optional: --repo <checkout> --reference --style current|rsplus --case <substring>
 * --real-root <verification root> --perf [--perf-only] --width 1280 --height 720
 * PLAYWRIGHT_MODULE can identify an existing Playwright installation.
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
if(served.includes('function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) {'))
  served=once(served,'function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) {',
    'function hwyBuildChordHoldGuidance(chords, handShapes, templates, anchors, stringCount = 6, notes = []) { if(window.__holdBuilds!==undefined)window.__holdBuilds++;');
served = once(served, 'const core = pNote.get();', `const core = pNote.get();
 if(window.__holdProbe)window.__holdProbe.notes.push({note:{...n},fromChord,mesh:core});`);
served = once(served, 'const fill = pChordFrameFill.get();', `const fill = pChordFrameFill.get();
 if(window.__holdProbe)window.__holdProbe.frames.push({t:ch.t,isRepeat,isArpeggioFrame,compactRepeatFrame,mesh:fill});`);
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
served = once(served, "contextType: 'webgl2',", `__holdAudit(){return {ren,cam,scene,style:typeof rsPlusNotation==='undefined'?'current':rsPlusNotation?'rsplus':'current'};},contextType: 'webgl2',`);

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
for(const now of [9.7,10,10.4,10.99,11,11.01,12.5]) add('known-one-second-'+now,
  base({currentTime:now,chords:[chord(10,1)],handShapes:[shape()]}),now<11?[[10,11]]:[],{image:[9.7,10.4,11.01].includes(now),noTrails:true});
for(const now of [9.7,10.05,10.11]) add('short-known-'+now,
  base({currentTime:now,chords:[chord(10,.1)]}),now<10.1?[[10,10.1]]:[],{image:now===9.7,noTrails:true});
add('unknown',base({chords:[chord()]}),[],{image:true});
add('legacy-repeat',base({chords:[chord(10),chord(10.6,0,{hd:true}),chord(11.2,0,{hd:true})],handShapes:[shape(10,12)]}),[[10,12]],{image:true,wantFrames:3});
add('muted',base({chords:[chord(10,0,{notes:pair().map(n=>({...n,pm:true}))})],handShapes:[shape()]}),[],{image:true});
add('partial',base({chords:[chord(10,0,{notes:[...pair().slice(0,1)]})],handShapes:[shape()]}),[],{image:true});
add('picked',base({notes:[note({t:10,s:1,f:3,sus:.4}),note({t:10.5,s:2,f:5,sus:.5})],handShapes:[shape()]}),[],{image:true});
add('picked-carrier',base({chords:[chord()],notes:[note({t:10.1,s:1,f:3,sus:.4}),note({t:10.5,s:2,f:5,sus:.5})],handShapes:[shape()]}),[],{image:true});
add('arpeggio',base({chords:[chord(10,1)],handShapes:[shape(10,13,0,{arp:true})],chordTemplates:[{...template,arp:true}]}),[],{image:true});
add('open-unequal',base({chords:[chord(10,0,{notes:[note({s:1,f:0,sus:1.5}),note({s:2,f:2,sus:.7})]})],
  chordTemplates:[{name:'A5',frets:[-1,0,2,-1,-1,-1],fingers:[-1,-1,1,-1,-1,-1]}]}),[],{image:true,wantOpenTrail:true});
add('linked-slide',base({chords:[chord(10,1,{notes:pair(1).map(n=>({...n,sl:n.f+2,ln:true}))}),
  chord(11,1,{notes:pair(1).map(n=>({...n,f:n.f+2}))})]}),null,{image:true,wantRibbons:true});
for(const now of [9.7,10.6]) add('anchor-change-'+now,base({currentTime:now,chords:[chord(10,2)],anchors:[{time:0,fret:3,width:4},{time:10.4,fret:9,width:4}]}),[[10,12]],{image:true,noTrails:true});
for(const now of [10.5,11.5])add('guide-anchor-change-'+now,base({currentTime:now,chords:[chord(10,1)],handShapes:[shape(10,13)],
  anchors:[{time:0,fret:3,width:4},{time:11,fret:8,width:4}]}),now<11?[[10,11]]:[],{image:true,wantPositionGuide:[11,13]});
add('equivalent-template',base({chords:[chord()],chordTemplates:[template,{...template}],handShapes:[shape(10,12,1)]}),[[10,12]],{image:false});
add('gap',base({chords:[chord(10),chord(11)],handShapes:[shape(10,10.4),shape(11,11.5)]}),[[10,10.4],[11,11.5]],{image:true});
add('no-duplicate-open-trail',base({chords:[chord(10,0,{notes:[note({s:1,f:0,sus:1}),note({s:2,f:2,sus:1})]})],
  chordTemplates:[{name:'A5',frets:[-1,0,2,-1,-1,-1],fingers:[-1,-1,1,-1,-1,-1]}]}),[[10,11]],{image:true,noTrails:true});
add('overlap-explicit-different-chords',base({chords:[chord(10,2),chord(11,2,{id:1,notes:pair(2).map(n=>({...n,f:n.f+1}))})],
  chordTemplates:[template,{name:'C#5',frets:[-1,4,6,-1,-1,-1],fingers:[-1,1,3,-1,-1,-1]}]}),[],{image:true,wantTrailOnsets:[10,11]});
add('overlap-explicit-shorter-repeat',base({chords:[chord(10,2),chord(11,.5)]}),[],{image:true,wantTrailOnsets:[10,11]});
for(const [name,extra] of [['left-handed',{lefty:true}],['inverted',{inverted:true}],['bass',{stringCount:4,tuning:[0,0,0,0]}],['eight-string',{stringCount:8,tuning:Array(8).fill(0)}],['no-anchor',{anchors:[]}]])
  add(name,base({...extra,chords:[chord(10,1)],handShapes:[shape()]}),[[10,11]],{image:false,noTrails:true});
const realRoot=option('--real-root');
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
  const browser=await chromium.launch({headless:true});
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
      const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
      if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Unknown fixture asset'});
    });
    await page.goto('http://hold-fixture.test/');
    await page.evaluate(()=>{
      window.__mesh=m=>({position:m.position.toArray(),scale:m.scale.toArray(),visible:m.visible,renderOrder:m.renderOrder,
        material:{color:m.material.color?.getHexString(),opacity:m.material.opacity,type:m.material.type,depthTest:m.material.depthTest,depthWrite:m.material.depthWrite,fog:m.material.fog}});
      window.__capture=()=>{
        const a=r.__holdAudit();window.__holdProbe={notes:[],frames:[],trails:[],ribbons:[],rails:[],caps:[],legacyRails:[],positionRails:[]};
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
        const settings={style:'off',notationStyle:style,palette:'default',glow:0,vibrancy:.85,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0};
        for(const [k,v] of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(typeof setter==='function')setter(v);}
        window.__holdBuilds=0;window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
        for(let i=0;i<5;i++)r.draw(bundle);
      },{b,style});
    }
    for(const scenario of scenarios.filter(s=>!args.includes('--perf-only')&&(!option('--case')||s.name.includes(option('--case'))))) {
      await init(scenario.b);
      const proof=await page.evaluate(()=>__capture());
      results.push({name:scenario.name,expected:scenario.expected,realFileSha:scenario.realFileSha,...proof});
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
      if(!reference&&scenario.wantPositionGuide){const [start,end]=scenario.wantPositionGuide;
        check(proof.positionRails.filter(g=>g.start===start&&g.end===end).length===2,scenario.name+': hand-shape guidance lost after anchor change');}
      if(!reference&&scenario.wantTrailOnsets)for(const onset of scenario.wantTrailOnsets)
        check([...proof.trails,...proof.ribbons].some(t=>t.note.t===onset),scenario.name+': missing independent trail at '+onset);
      if(scenario.image)await page.screenshot({path:path.join(out,scenario.name+'.png')});
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
      const bundles=[['dense',dense()]];
      const real=scenarios.find(s=>s.name==='bon-jovi-39');if(real)bundles.push(['bon-jovi',real.b]);
      for(const [name,b] of bundles){await init(b);const measured=await page.evaluate(()=>{
        const a=r.__holdAudit(),gl=a.ren.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');
        for(let i=0;i<15;i++)r.draw(bundle);gl.finish();const cpu=[],finish=[];
        for(let round=0;round<3;round++){let t=performance.now();for(let i=0;i<15;i++)r.draw(bundle);cpu.push((performance.now()-t)/15);t=performance.now();gl.finish();finish.push(performance.now()-t);}
        return {cpuMsPerDraw:cpu,finishWaitMs:finish,gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),proof:__capture()};
      });results.push({name:'performance-'+name,...measured});console.log('Performance '+name+': '+JSON.stringify(measured.cpuMsPerDraw));}
    }
    check(errors.length===0,'Browser errors: '+errors.join('\n'));
  }finally{await browser.close();}
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceSha:sha(source),sourceNormalizedLfSha:sha(source.replace(/\r\n/g,'\n')),reference,style,width,height,failures,errors,results},null,2));
  console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));
  if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
