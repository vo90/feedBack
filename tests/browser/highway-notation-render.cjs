#!/usr/bin/env node
/* Isolated WebGL acceptance probe. No application server, Electron, or library writes.
 * Run: node tests/browser/highway-notation-render.cjs --repo <checkout> --out <new-output-dir>
 * Optional: --baseline (Current only), --fixture <wire-arrangement.json>, --quick,
 * --style current|rsplus, --width 1920 --height 1080 --dpr 2 --scale 0.5.
 * --compare <baseline-output-dir> checks matching Current PNGs byte for byte.
 * --perf-only --perf-rounds 3 runs alternating styles, Glow0 and soft glow,
 * recording draw CPU time, finish wait, draw calls, triangles, and GPU identity.
 * --fidelity-only reviews each technique plus open-marker and arpeggio layouts.
 * --chords-only captures and validates just the chord sequence in both styles.
 * --orientation-only checks stable RS+ gems/markers across approach and live style reuse.
 * --open-chords-only checks open/muted floor stems, hand-shape association and pool reuse.
 * --bends-only checks bend chevron amounts, colors, orientation and style reuse.
 * --readability-only samples technique contrast and moving trails; --quick omits yellow-only masks.
 * --readability-extra checks scored accented chord/slides and records real RAF playback to WebM.
 * --readability-motion-only samples deterministic trail poses without repeating face captures.
 * --source-ref <git-ref> serves screen.js from a Git revision for before/after evidence.
 * --reference captures older notation for comparison without new geometry checks.
 * --detail-filter name,name limits closeups; --times t,t and --fixture-name name
 * select chart poses without changing or importing the source song library.
 * PLAYWRIGHT_MODULE may point at a preinstalled Playwright package. All browser
 * requests are fulfilled from this checkout; external requests are rejected.
 * Instrumentation exists only in the served source, never in production code.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
function option(name, fallback) { const i=args.indexOf(name); return i<0 ? fallback : args[i+1]; }
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/highway-notation')));
const baseline = args.includes('--baseline');
const quick = args.includes('--quick');
const fidelityOnly = args.includes('--fidelity-only');
const chordsOnly = args.includes('--chords-only');
const orientationOnly = args.includes('--orientation-only');
const openChordsOnly = args.includes('--open-chords-only');
const bendsOnly = args.includes('--bends-only');
const readabilityExtra = args.includes('--readability-extra');
const readabilityMotionOnly = args.includes('--readability-motion-only');
const readabilityOnly = args.includes('--readability-only') || readabilityExtra || readabilityMotionOnly;
const reference = args.includes('--reference');
const perfOnly=args.includes('--perf-only'),perfRounds=Number(option('--perf-rounds',1));
const width=Number(option('--width',1280)),height=Number(option('--height',720));
const dpr=Number(option('--dpr',1)),renderScale=Number(option('--scale',1));
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const sourceRef = option('--source-ref');
const source = sourceRef
  ? cp.execFileSync('git', ['-C', repo, 'show', `${sourceRef}:plugins/highway_3d/screen.js`], {encoding:'utf8',maxBuffer:8*1024*1024})
  : fs.readFileSync(sourcePath, 'utf8');
const failures = [], errors = [], results = [];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function check(value, message) { if (!value) failures.push(message); }
function once(text, marker, replacement) {
  assert.equal(text.split(marker).length, 2, `Expected one instrumentation anchor: ${marker}`);
  return text.replace(marker, replacement);
}
let served = once(source, 'const core = pNote.get();', `const core = pNote.get();
  if (window.__notationProbe) window.__notationProbe.notes.push({ note: {...n}, sourceFret:sourceNote.f, dt, fromChord, core, outline });`);
served = once(served, 'const fill = pChordFrameFill.get();', `const fill = pChordFrameFill.get();
  if (window.__notationProbe) window.__notationProbe.frames.push({ t:ch.t, dt:chDt, isRepeat, isArpeggioFrame, compactRepeatFrame, palmMuted:chordNotes.some(cn=>cn.pm), fill });`);
served = once(served, 'const b = pChordBox.get();', `const b = pChordBox.get();
  if (window.__notationProbe) window.__notationProbe.edges.push({ t:ch.t, dt:chDt, isRepeat, mesh:b });`);
if(served.includes('const mesh = pRsChordFrame.get();'))served=once(served,'const mesh = pRsChordFrame.get();',`const mesh = pRsChordFrame.get();
  if(window.__notationProbe)window.__notationProbe.roundedFrames.push({mesh,openTop,halo,width,height,rim,z});`);
if(orientationOnly)for(const [anchor,name,kind] of [
  ['const l = pTechPlane.get();','l','bend'],
  ['const face = pTechPlane.get();','face','face'],
  ['const arrow = pTechPlane.get();','arrow','slide'],
  ['const halo = pAccentHalo.get();','halo','halo'],
  ['const edges = pNoteEdge.get();','edges','verdict-edge'],
])served=once(served,anchor,`${anchor}
  if(window.__notationProbe)window.__notationProbe.markers.push({note:{...n},dt,kind:'${kind}',mesh:${name}});`);
if(bendsOnly&&!orientationOnly)served=once(served,'const l = pTechPlane.get();',`const l = pTechPlane.get();
  if(window.__notationProbe)window.__notationProbe.markers.push({note:{...n},dt,kind:'bend',steps,mesh:l});`);
if(readabilityOnly){
  if(!orientationOnly)served=once(served,'const face = pTechPlane.get();',`const face = pTechPlane.get();
    if(window.__notationProbe)window.__notationProbe.markers.push({note:{...n},dt,kind:'face',mesh:face});`);
  served=once(served,'const tr = pSus.get();',`const tr = pSus.get();
    if(window.__notationProbe)window.__notationProbe.trails.push({note:{...n},width:tw,height:th,yieldCount:0,mesh:tr,ribbon:false});`);
  served=once(served,'const body = pSusRibbon.get();',`const body = pSusRibbon.get();
    if(window.__notationProbe)window.__notationProbe.trails.push({note:{...n},width:tw,height:th,yieldCount:strandYieldCount,mesh:body,ribbon:true});`);
}
served = once(served, "contextType: 'webgl2',", `__notationAudit() { return {
  scene, cam, ren, noteG, pNote, pTechPlane, projMeshArr, composer:_composer, bloom:_bloom,
  openStemFloor:Math.min(sY(0),sY(nStr-1))-S_GAP*.55, noteHeight:NH,
  style:typeof rsPlusNotation === 'undefined' ? 'current' : rsPlusNotation ? 'rsplus' : 'current',
  settings:{glow:glowMul,vibrancy,cinematic:_cinematic,hitFx:_hitFx,bloom:_bloom,
    ${readabilityOnly?'trailYield:{...trailYieldSettings},sustainStroke:rsPlusNotation?RSPLUS_SUSTAIN_STROKE_SCALE:1,':''}},
}; }, contextType: 'webgl2',`);

function baseBundle(stringCount=6) {
  return {currentTime:10,isPlaying:false,notes:[],chords:[],chordTemplates:[],
    anchors:[{time:0,fret:2,width:6}],handShapes:[],beats:[],sections:[],lyrics:[],
    stringCount,tuning:Array(stringCount).fill(0),songInfo:{arrangement:'Lead'},
    inverted:false,lefty:false,renderScale,bgReactive:false};
}
function matrix(stringCount=8) {
  const b=baseBundle(stringCount);
  for (const dt of [.35,1.45,2.65]) for (let s=0;s<stringCount;s++) for (const ac of [false,true])
    b.notes.push({t:10+dt,s,f:ac?5:3,ac});
  b.notes.sort((a,b)=>a.t-b.t || a.s-b.s || a.f-b.f);
  return b;
}
const techniqueFlags = [
  ['normal',{}],['accent',{ac:true}],['hammer-on',{ho:true}],['pull-off',{po:true}],
  ['tap',{tp:true}],['fret-mute',{fhm:true}],['palm-mute',{pm:true}],
  ['natural-harmonic',{hm:true}],['pinch-harmonic',{hp:true}],['slap',{slp:true}],
  ['pop',{plk:true}],['tremolo',{tr:true,sus:1.3}],['vibrato',{vb:true,sus:1.3}],
  ['slide',{sl:9,sus:1.3}],['unpitched-slide',{slu:9,sus:1.3}],
  ['half-bend',{bn:.5,sus:1.3}],['prebend-release',{bn:1,bt:1,sus:1.3,bnv:[{t:0,v:1},{t:.7,v:1},{t:1.3,v:0}]}],
  ['accent-hammer',{ac:true,ho:true}],['accent-palm',{ac:true,pm:true}],
  ['accent-harmonic',{ac:true,hp:true}],['open',{}],['open-accent',{ac:true}],
  ['sustain',{sus:1.3}],
];
function techniqueScene(offset=0) {
  const b=baseBundle();
  for(let i=0;i<6;i++) {
    const [name,flags]=techniqueFlags[(offset+i)%techniqueFlags.length];
    b.notes.push({t:10.12,s:i,f:name.startsWith('open')?0:5,...flags,_fixtureName:name});
  }
  return b;
}
function chordScene() {
  const b=baseBundle();
  b.chordTemplates=[{name:'A5',frets:[5,7,7,-1,-1,-1],fingers:[1,3,4,-1,-1,-1]}];
  // Match lib/song.py note_to_wire: legacy flags are emitted even when false.
  // Sparse fixture members otherwise inherit the reused chord scratch's flags.
  const members=()=>[{s:0,f:5},{s:1,f:7},{s:2,f:7}].map(n=>({
    sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,
    pm:false,mt:false,vb:false,tr:false,ac:false,tp:false,...n
  }));
  b.chords=[{t:10.4,id:0,notes:members()}, {t:10.8,id:0,hd:true,notes:members()},
    {t:11.2,id:0,hd:true,notes:members().map(n=>({...n,ac:true}))},
    {t:11.6,id:0,hd:true,notes:members().map(n=>({...n,pm:true}))},
    {t:12,id:0,notes:members().map((n,i)=>({...n,...(i===1?{ho:true}: {})}))},
    {t:12.4,id:0,hd:true,notes:members()}, {t:12.8,id:0,hd:true,notes:members()}];
  b.handShapes=[{chord_id:0,start_time:10.4,end_time:12.95}];
  return b;
}
function denseScene() {
  const b=baseBundle(8);
  for(let i=0;i<120;i++) b.notes.push({t:10+i*.023,s:i%8,f:3+i%5,ac:i%3===0,sus:i%6===0?2:0,...(i%11===0?{vb:true}: {})});
  return b;
}
async function main() {
  // Refuse an occupied output so earlier evidence is never silently overwritten.
  if(fs.existsSync(path.join(out,'results.json'))) throw new Error('Choose a fresh --out directory; results.json already exists.');
  fs.mkdirSync(out,{recursive:true});
  const git=cp.execFileSync('git',['-c',`safe.directory=${repo.replaceAll('\\','/')}`,'-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  fs.writeFileSync(path.join(out,'source-sha256.txt'),`${sha(source)}  ${sourcePath}\n${git}\n`);
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,
      ...(readabilityExtra?{recordVideo:{dir:path.join(out,'video'),size:{width,height}}}:{})});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.stack));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(u.origin!=='http://notation-fixture.test') return route.fulfill({status:403,body:'External network forbidden by fixture'});
      if(u.pathname==='/') return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>`});
      if(u.pathname==='/screen.js') return route.fulfill({contentType:'text/javascript',body:served});
      const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
      if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())
        return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
      return route.fulfill({status:404,body:'Unknown isolated fixture asset'});
    });
    await page.goto('http://notation-fixture.test/');
    await page.evaluate(()=>{
      window.__probeMaterial=m=>({type:m.type,opacity:m.opacity,transparent:m.transparent,fog:m.fog,color:m.color?.toArray(),emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity,vertexColors:m.vertexColors,blending:m.blending,depthTest:m.depthTest,depthWrite:m.depthWrite,uniforms:m.uniforms?Object.fromEntries(Object.entries(m.uniforms).map(([k,v])=>[k,v.value?.toArray?v.value.toArray():v.value])):undefined});
      window.__probeMesh=m=>({material:__probeMaterial(m.material),geometry:m.geometry.type,triangles:(m.geometry.index?.count||m.geometry.attributes.position.count)/3,position:m.position.toArray(),rotation:m.rotation.toArray().slice(0,3),scale:m.scale.toArray(),renderOrder:m.renderOrder,visible:m.visible});
      window.__probeBendTexture=m=>{
        const source=m.material.map?.image;if(!source?.getContext)return null;
        const {width,height}=source,rgba=source.getContext('2d').getImageData(0,0,width,height).data;
        const x=Math.floor(width/2),runs=[];let start=-1;const colors=new Map();
        for(let y=0;y<height;y++){
          const i=(y*width+x)*4,solid=rgba[i+3]>128;
          if(solid&&start<0)start=y;
          if(!solid&&start>=0){runs.push([start,y-1]);start=-1;}
        }
        if(start>=0)runs.push([start,height-1]);
        for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>250){const rgb=`${rgba[i]},${rgba[i+1]},${rgba[i+2]}`;colors.set(rgb,(colors.get(rgb)||0)+1);}
        return {width,height,centerRuns:runs,opaqueColors:[...colors.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)};
      };
      window.__probeTrail=({mesh,ribbon,...rest})=>{
        const samples=[];
        if(ribbon){
          const a=mesh.geometry.attributes.position.array;
          for(let k=0;k<=mesh.geometry.userData.ribbonSlices;k++){
            const i=k*12;samples.push([(a[i]+a[i+3])*.5,(a[i+1]+a[i+7])*.5,a[i+2],a[i+3]-a[i],a[i+7]-a[i+1]]);
          }
        }else samples.push([...mesh.position.toArray(),mesh.scale.x,mesh.scale.y]);
        return {...rest,ribbon,mesh:__probeMesh(mesh),samples};
      };
      window.__fillAlpha=m=>{const source=m.map?.image;if(!source)return null;const rgba=source.data||source.getContext?.('2d').getImageData(0,0,source.width,source.height).data;if(!rgba)return null;let min=255,max=0;for(let i=3;i<rgba.length;i+=4){min=Math.min(min,rgba[i]);max=Math.max(max,rgba[i]);}return {min,max,width:source.width,height:source.height};};
      window.__captureNotation=()=>{
        const a=r.__notationAudit();
        window.__notationProbe={notes:[],frames:[],edges:[],roundedFrames:[],markers:[],trails:[]};
        a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);
        const p=window.__notationProbe;window.__notationProbe=null;
        const gl=a.ren.getContext();
        return {style:a.style,settings:a.settings,openStemFloor:a.openStemFloor,noteHeight:a.noteHeight,canvas:[a.ren.domElement.width,a.ren.domElement.height],
          renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,memory:{...a.ren.info.memory}},
          notes:p.notes.map(({note,sourceFret,dt,fromChord,core,outline})=>{const v=core.getWorldPosition(core.position.clone()).project(a.cam);const rgba=new Uint8Array(4);gl.readPixels(Math.round((v.x+1)*a.ren.domElement.width/2),Math.round((v.y+1)*a.ren.domElement.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return {note,sourceFret,dt,fromChord,core:__probeMesh(core),outline:__probeMesh(outline),screen:[(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2],centerPixel:Array.from(rgba)};}),
          frames:p.frames.map(({fill,...metadata})=>({...metadata,fill:__probeMesh(fill),textureAlpha:__fillAlpha(fill.material)})),
          edges:p.edges.map(({t,dt,isRepeat,mesh})=>({t,dt,isRepeat,mesh:__probeMesh(mesh)})),
          roundedFrames:p.roundedFrames.map(({mesh,...rest})=>({...rest,mesh:__probeMesh(mesh)})),
          markers:p.markers.map(({mesh,...rest})=>{const v=mesh.getWorldPosition(mesh.position.clone()).project(a.cam);return {...rest,mesh:__probeMesh(mesh),texture:['bend','face'].includes(rest.kind)?__probeBendTexture(mesh):undefined,screen:[(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2]};}),
          trails:p.trails.map(__probeTrail),
          ghosts:(a.projMeshArr||[]).flat().filter(m=>m.visible).map(__probeMesh)};
      };
    });
    async function init(b,settings) {
      await page.evaluate(async({b,settings})=>{
        if(window.r)r.destroy();
        localStorage.clear();
        const config={style:'off',palette:'default',vibrancy:.85,glow:.25,cinematic:false,sparks:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,bloom:false,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0,...settings};
        for(const [k,v] of Object.entries(config)){
          localStorage.setItem('h3d_bg_'+k,String(v));
          const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];
          if(typeof setter==='function')setter(v);
        }
        if(settings.customColors)h3dBgSetStringColors(settings.customColors);
        window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
        if(settings.scored)bundle.getNoteState=note=>({state:note.s%3===0?'hit':note.s%3===1?'miss':'active',alpha:1});
        for(let i=0;i<45;i++)r.draw(bundle);
      },{b,settings});
      await page.waitForTimeout(50);
      await page.evaluate(()=>{for(let i=0;i<10;i++)r.draw(bundle);});
    }
    async function capture(name,b,settings,{image=true,expectBodies=false}={}) {
      await init(b,settings);
      const proof=await page.evaluate(()=>__captureNotation());
      results.push({name,...proof});
      if(!baseline)check(proof.style===settings.notationStyle,`${name}: requested ${settings.notationStyle}, rendered ${proof.style}`);
      check(proof.notes.length>0,`${name}: no actual core meshes rendered`);
      if(expectBodies&&proof.style==='rsplus')for(const n of proof.notes){
        check(n.core.material.opacity===1,`${name}: ${n.note.s}/${n.note.t} opacity ${n.core.material.opacity}`);
        check(n.core.material.type==='MeshBasicMaterial',`${name}: body must be unlit`);
        check(n.core.material.fog===false,`${name}: body must ignore fog`);
      }
      if(image)await page.screenshot({path:path.join(out,name+'.png')});
      console.log(`Captured ${name}: ${proof.notes.length} cores, ${proof.frames.length} frames`);
      return proof;
    }
    async function captureChordSequence(style) {
      const chords=await capture(`${style}-chord-sequence`,chordScene(),{notationStyle:style,glow:.05,bloom:false},{expectBodies:true});
      check(chords.frames.some(f=>f.isRepeat),`${style}: chord sequence did not exercise repeats`);
      const first=chords.notes.filter(n=>n.fromChord&&n.note.t===10.4);
      const muted=chords.notes.filter(n=>n.fromChord&&n.note.t===11.6);
      const accented=chords.notes.filter(n=>n.fromChord&&n.note.t===11.2);
      check(first.length===3&&first.every(n=>!n.note.pm&&!n.note.mt&&!n.note.fhm&&!n.note.ac&&!n.note.ho),`${style}: first plain chord inherited a later technique/accent`);
      check(chords.frames.some(f=>f.t===10.4&&!f.isRepeat),`${style}: first chord was incorrectly reduced to a repeat`);
      check(muted.length===0&&chords.frames.some(f=>f.t===11.6&&f.palmMuted&&f.compactRepeatFrame),`${style}: palm-muted repeat lost its compact frame mute cue`);
      check(accented.length===3&&accented.every(n=>n.note.ac===true&&!n.note.pm),`${style}: accented repeat did not retain its own three notes`);
      check(chords.frames.some(f=>f.t===10.4&&!f.compactRepeatFrame&&!f.palmMuted),`${style}: first plain chord frame is not full and unmuted`);
      if(style==='rsplus'&&!reference){
        check(chords.frames.every(f=>f.fill.material.opacity===1),'RS+ chord fill opacity changed with distance/repeat');
        check(chords.frames.every(f=>f.textureAlpha&&f.textureAlpha.max<=64),'RS+ frame fill texture is not lightly translucent');
        check(chords.roundedFrames.filter(f=>!f.halo).every(f=>f.mesh.material.uniforms.uOpacity===1),'RS+ frame rim opacity changed with distance/repeat');
        const rims=chords.roundedFrames.filter(f=>!f.halo);
        const full=rims.reduce((a,b)=>a.height>b.height?a:b),compact=rims.reduce((a,b)=>a.height<b.height?a:b);
        check(rims.every(f=>!f.openTop),'RS+ modern repeat panels should have a closed top');
        check(full&&compact&&Math.abs(compact.height/full.height-.5)<1e-6,'RS+ ordinary repeat frame is not half height');
      }
      const palmBundle=chordScene();
      palmBundle.chords=[{t:10.4,id:0,notes:palmBundle.chords[0].notes.map(n=>({...n,pm:true}))}];
      const palm=await capture(`${style}-chord-palm-full`,palmBundle,{notationStyle:style,glow:.05,bloom:false},{expectBodies:true});
      const palmNotes=palm.notes.filter(n=>n.fromChord&&n.note.t===10.4);
      check(palmNotes.length===3&&palmNotes.every(n=>n.note.pm===true&&!n.note.ac),`${style}: full palm-muted chord did not retain its own three note markers`);
      check(palm.frames.some(f=>f.t===10.4&&f.palmMuted&&!f.isRepeat&&!f.compactRepeatFrame),`${style}: full palm-muted chord was incorrectly reduced to a repeat`);
      return chords;
    }
    const styles=baseline?['current']:option('--style')?[option('--style')]:['current','rsplus'];
    if(readabilityOnly){
      const member=n=>({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,
        pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,slp:false,plk:false,...n});
      function faceScene(compound){
        const b=baseBundle();b.anchors=[{time:0,fret:3,width:6}];
        const flags=compound?[{pm:true,ho:true},{hp:true,ho:true},{pm:true,hp:true},
          {fhm:true,tp:true,hp:true},{pm:true,po:true,hm:true},{slp:true,pm:true,hm:true}]
          :[{pm:true},{fhm:true},{hm:true},{hp:true},{ho:true},{tp:true}];
        b.notes=flags.map((flag,s)=>member({t:10.22,s,f:3+s,...flag}));return b;
      }
      function trailScene(){
        const b=baseBundle();b.anchors=[{time:0,fret:3,width:6}];
        b.notes=[
          {t:10.1,s:0,f:5,sus:2.6},
          {t:10.35,s:3,f:7,sus:1.6,bn:2,bnv:[{t:0,v:0},{t:.8,v:2},{t:1.6,v:0}]},
          {t:10.45,s:4,f:8,sus:1.5,tr:true},
          {t:10.5,s:5,f:3,sus:1.4,vb:true},
          {t:10.8,s:1,f:5,pm:true},{t:11.3,s:2,f:5,sus:.7,hp:true},
        ].map(member);return b;
      }
      for(const style of styles){
        const settings={notationStyle:style,glow:0,bloom:false};
        if(readabilityExtra){
          const chord=baseBundle();chord.anchors=[{time:0,fret:3,width:6}];
          chord.chordTemplates=[{name:'Mixed techniques',frets:[4,5,7,-1,-1,-1],fingers:[1,2,4,-1,-1,-1]}];
          chord.chords=[{t:10.15,id:0,notes:[
            {s:0,f:4,pm:true,ho:true,hp:true,slp:true,plk:true,ac:true,sus:1.3},
            {s:1,f:5,hp:true,tp:true,pm:true,slp:true,ac:true,sus:1.3},
            {s:2,f:7,sl:9,ac:true,sus:1.5},
          ].map(member)}];
          chord.handShapes=[{chord_id:0,start_time:10.15,end_time:11.65}];
          for(const time of [10,10.15]){
            chord.currentTime=time;
            const proof=await capture(`readability-${style}-scored-chord-${time}`,chord,
              {...settings,scored:true,slideArrowApproachVisible:true},{expectBodies:true});
            check(proof.notes.length===3&&proof.notes.every(n=>n.note.ac),`${style}/${time}: accented chord coverage missing`);
            check(proof.trails.some(t=>t.note.sl===9),`${style}/${time}: slide trail missing`);
          }
          await init(trailScene(),settings);
          const motion=await page.evaluate(async()=>{
            const started=performance.now(),samples=[];
            bundle.isPlaying=true;
            await new Promise(resolve=>{
              const frame=()=>{
                const elapsed=(performance.now()-started)/1000;
                bundle.currentTime=10+Math.min(elapsed,2);r.draw(bundle);
                samples.push({elapsed,chartTime:bundle.currentTime});
                if(elapsed>=2)resolve();else requestAnimationFrame(frame);
              };requestAnimationFrame(frame);
            });
            return {durationSeconds:(performance.now()-started)/1000,samples,finalProof:__captureNotation()};
          });
          check(motion.samples.length>=5&&motion.durationSeconds>=2,`${style}: real RAF playback did not advance`);
          check(motion.samples.every((s,i)=>i===0||s.chartTime>=motion.samples[i-1].chartTime),`${style}: real playback moved backward`);
          results.push({name:`readability-${style}-realtime-playback`,...motion});
          console.log(`Recorded ${style}: ${motion.samples.length} real RAF frames over ${motion.durationSeconds.toFixed(2)} s`);
          continue;
        }
        if(!readabilityMotionOnly)for(const palette of style==='current'?['default']:quick?['default','white']:['default','yellow','white']){
          const config={...settings,...(palette==='default'?{}:{customColors:Array(8).fill(palette==='white'?'#ffffff':'#ffe04b')})};
          for(const compound of [false,true]){
            const name=`readability-${style}-${palette}-${compound?'combined':'single'}`;
            const proof=await capture(name,faceScene(compound),config,{expectBodies:true});
            check(proof.notes.length===6,`${name}: missing note bodies`);
            if(style==='rsplus')check(proof.markers.length===6&&proof.markers.every(m=>m.mesh.visible&&m.mesh.material.opacity===1),`${name}: missing or faded face masks`);
          }
        }
        await init(trailScene(),settings);
        const frames=[];
        for(const [index,time] of [10,10.2,10.4,10.6,10.8,11,11.2,11.4].entries()){
          // Paused chart poses bypass the renderer's wall-clock interpolation;
          // real time advancement has its own RAF/video probe above.
          const proof=await page.evaluate(time=>{bundle.currentTime=time;bundle.isPlaying=false;
            for(let i=0;i<4;i++)r.draw(bundle);return __captureNotation();},time);
          check(proof.trails.length>0,`${style}/${time}: no sustain meshes`);
          check(proof.settings.trailYield.minScale===.3,`${style}/${time}: shared visibility minimum changed`);
          check(proof.settings.sustainStroke===(style==='rsplus'?(reference ? .5 : .6):1),`${style}/${time}: wrong sustain stroke scale`);
          for(const trail of proof.trails){
            check(trail.samples.length>0&&trail.samples.every(s=>s.every(Number.isFinite)),`${style}/${time}: invalid trail samples`);
            check(trail.samples.every(s=>s[3]>0&&s[4]>0),`${style}/${time}: collapsed trail width/height`);
          }
          if([0,3,6].includes(index))await page.screenshot({path:path.join(out,`readability-${style}-trails-${time}.png`)});
          frames.push({time,...proof});
        }
        check(frames.some(f=>f.trails.some(t=>t.yieldCount>0&&t.samples.some(s=>Math.abs(s[3]/t.width-.30)<1e-5))),`${style}: fixture did not exercise the .30 minimum-width reveal`);
        results.push({name:`readability-${style}-moving-trails`,frames});
        console.log(`Sampled readability ${style}: ${frames.length} moving frames`);
      }
    }
    if(bendsOnly){
      const onset=10.15,settings={notationStyle:'rsplus',glow:0,bloom:false};
      const member=n=>({sus:1.3,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,
        pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,slp:false,plk:false,...n});
      function bendScene(amount,{strings=[0,1,2,5],inverted=false,lefty=false,curveOnly=false,chord=false}={}){
        const b=baseBundle();b.inverted=inverted;b.lefty=lefty;b.anchors=[{time:0,fret:3,width:4}];
        const notes=strings.map(s=>member({t:onset,s,f:5,bn:curveOnly?0:amount,
          bnv:[{t:0,v:0},{t:.7,v:amount},{t:1.3,v:amount}]}));
        if(chord){
          b.chordTemplates=[{name:'Bend',frets:[-1,-1,5,5,-1,-1],fingers:[-1,-1,1,1,-1,-1]}];
          b.chords=[{t:onset,id:0,notes}];
          b.handShapes=[{chord_id:0,start_time:onset,end_time:onset+1.3}];
        }else b.notes=notes;
        return b;
      }
      function assertBends(proof,label,{amount,strings,inverted=false}={}){
        const markers=proof.markers.filter(m=>m.kind==='bend');
        check(markers.length===strings.length,`${label}: expected ${strings.length} bend marker meshes, got ${markers.length}`);
        for(const marker of markers){
          const expectedSteps=Math.max(1,Math.min(4,Math.round(amount)));
          const expectedRuns=proof.style==='rsplus'&&reference?1:expectedSteps;
          check(marker.steps===expectedSteps,`${label}: note ${marker.note.s} got wrong semitone amount`);
          check(marker.texture?.centerRuns.length===expectedRuns,`${label}: note ${marker.note.s} texture has ${marker.texture?.centerRuns.length} chevrons, expected ${expectedRuns}`);
          check(marker.mesh.visible&&marker.mesh.material.opacity===1,`${label}: bend marker disappeared or faded`);
          const visualString=inverted?marker.note.s:5-marker.note.s;
          const expectedRotation=(proof.style==='rsplus'?0:.15/3*Math.PI/2)+(visualString>=2.5?Math.PI:0);
          check(Math.abs(marker.mesh.rotation[2]-expectedRotation)<1e-8,`${label}: bend direction or orientation changed`);
        }
      }
      async function captureBends(name,b,amount,strings,config=settings){
        const proof=await capture(name,b,config,{expectBodies:true});
        assertBends(proof,name,{amount,strings,inverted:b.inverted});
        const marker=proof.markers.find(m=>m.kind==='bend');
        const [px,py]=marker.screen,clipWidth=Math.min(width,600),clipHeight=Math.min(height,450);
        await page.screenshot({path:path.join(out,name+'-close.png'),clip:{
          x:Math.max(0,Math.min(width-clipWidth,Math.round(px-clipWidth*.5))),
          y:Math.max(0,Math.min(height-clipHeight,Math.round(py-clipHeight*.5))),width:clipWidth,height:clipHeight}});
        return proof;
      }
      for(const amount of [1,2])await captureBends(`bend-${amount}-colors`,bendScene(amount),amount,[0,1,2,5]);
      for(const amount of [1,2,3])await captureBends(`bend-${amount}-yellow`,bendScene(amount,{strings:[1]}),amount,[1]);
      await captureBends('bend-2-curve-only',bendScene(2,{strings:[2],curveOnly:true}),2,[2]);
      await captureBends('bend-2-inverted-lefty',bendScene(2,{inverted:true,lefty:true}),2,[0,1,2,5]);
      await captureBends('bend-2-chord',bendScene(2,{strings:[2,3],chord:true}),2,[2,3]);
      await captureBends('bend-2-current',bendScene(2),2,[0,1,2,5],{...settings,notationStyle:'current'});
      const live=bendScene(2);await init(live,settings);
      const passes=[];
      for(const style of ['rsplus','current','rsplus','current']){
        const proof=await page.evaluate(style=>{h3dBgSetNotationStyle(style);for(let i=0;i<45;i++)r.draw(bundle);return __captureNotation();},style);
        assertBends(proof,`bend live ${style}`,{amount:2,strings:[0,1,2,5]});passes.push(proof);
      }
      results.push({name:'bend-live-style-reuse',passes});
    }
    if(openChordsOnly){
      const onset=10.4;
      const member=n=>({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,
        pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,slp:false,plk:false,...n});
      function openChord({lefty=false,arpeggio=false,repeat=false}={}){
        const b=baseBundle();b.lefty=lefty;b.currentTime=onset-.3;
        b.anchors=[{time:0,fret:2,width:4}];
        b.chordTemplates=[{name:'A5',frets:[-1,0,2,2,-1,-1],fingers:[-1,-1,1,1,-1,-1],arp:arpeggio}];
        b.chords=[{t:onset,id:0,hd:repeat,notes:[{s:1,f:0,ac:repeat},{s:2,f:2},{s:3,f:2}].map(member)}];
        if(repeat)b.chords.unshift({t:onset-.4,id:0,notes:[{s:1,f:0},{s:2,f:2},{s:3,f:2}].map(member)});
        b.handShapes=[{chord_id:0,start_time:repeat?onset-.4:onset,end_time:onset+2,arp:arpeggio}];
        return b;
      }
      const framedVisibility=reference&&!source.includes('hasEnclosingChordFrame');
      function assertFloorStems(proof,label){
        if(reference||proof.style!=='rsplus')return;
        for(const n of proof.notes.filter(n=>n.note.f===0&&n.outline.visible)){
          const bottom=n.outline.position[1]-n.outline.scale[1]*proof.noteHeight/2;
          check(Math.abs(bottom-proof.openStemFloor)<1e-5,`${label}: string ${n.note.s} at ${n.note.t} has a short stem (${bottom}, floor ${proof.openStemFloor})`);
        }
      }
      function assertOpen(proof,label,{visible,frame=false,arpeggio=false}={}){
        assertFloorStems(proof,label);
        const open=proof.notes.filter(n=>n.note.f===0&&Math.abs(n.note.t-onset)<1e-6);
        check(open.length>0,`${label}: fixture did not render any open string`);
        check(open.every(n=>n.outline.visible===visible),`${label}: open stem visibility should be ${visible}`);
        check(open.every(n=>n.core.visible&&(proof.style!=='rsplus'||n.core.material.opacity===1)),`${label}: open colored bar disappeared or faded`);
        if(frame)check(proof.frames.some(f=>!f.isArpeggioFrame),`${label}: missing enclosing ordinary frame`);
        if(arpeggio)check(proof.roundedFrames.some(f=>f.mesh.material.uniforms.uBracketCap>0),`${label}: missing arpeggio guidance`);
      }
      async function captureOpen(name,b,settings,expectation){
        const proof=await capture(name,b,settings,{expectBodies:true});
        assertOpen(proof,name,expectation);
        const [px,py]=proof.notes.find(n=>n.note.f===0).screen;
        const clipWidth=Math.min(width,600),clipHeight=Math.min(height,400);
        await page.screenshot({path:path.join(out,name+'-close.png'),clip:{
          x:Math.max(0,Math.min(width-clipWidth,Math.round(px-clipWidth*.5))),
          y:Math.max(0,Math.min(height-clipHeight,Math.round(py-clipHeight*.45))),width:clipWidth,height:clipHeight}});
        return proof;
      }
      const modern={notationStyle:'rsplus',glow:0,bloom:false};
      for(const lefty of [false,true]){
        const b=openChord({lefty});
        await captureOpen(`open-chord-framed-${lefty?'lefty':'righty'}`,b,modern,{visible:framedVisibility,frame:true});
      }
      const repeated=openChord({repeat:true});
      const repeatedProof=await captureOpen('open-chord-accented-repeat',repeated,modern,{visible:framedVisibility,frame:true});
      check(repeatedProof.frames.some(f=>f.isRepeat&&!f.compactRepeatFrame),'Open repeat fixture did not exercise a repeated full frame');
      const onsetBundle=openChord();onsetBundle.currentTime=onset;
      const onsetProof=await captureOpen('open-chord-onset',onsetBundle,modern,{visible:true});
      check(onsetProof.frames.length===0,'Ordinary chord frame survived onset');
      onsetBundle.currentTime=onset+.03;
      const postOnsetProof=await captureOpen('open-chord-after-onset',onsetBundle,modern,{visible:true});
      check(postOnsetProof.frames.length===0,'Ordinary chord frame survived after onset');
      const single=baseBundle();single.notes=[member({t:onset,s:0,f:0})];single.currentTime=onset-.3;
      await captureOpen('open-standalone',single,modern,{visible:true});
      await captureOpen('open-chord-arpeggio',openChord({arpeggio:true}),modern,{visible:true,arpeggio:true});
      await captureOpen('open-chord-current',openChord(),{notationStyle:'current',glow:0,bloom:false},{visible:true,frame:true});
      // Reproduce the reported pattern: standalone PM opens associated with a
      // hand shape, interleaved with actual open/fretted power-chord strikes.
      // The shared fromChord flag must still be exercised without shortening
      // stems or modifying chart ownership. This is synthetic chart data.
      function mutedSequence(){
        const b=baseBundle();b.currentTime=onset-.25;
        b.anchors=[{time:0,fret:2,width:4}];
        b.chordTemplates=[{name:'B5',frets:[0,2,-1,-1,-1,-1],fingers:[-1,1,-1,-1,-1,-1]}];
        b.notes=[0,.157,.471,.628,.942,1.099].map(dt=>member({t:onset+dt,s:0,f:0,pm:true}));
        b.chords=[.314,.785,1.256].map(dt=>({t:onset+dt,id:0,notes:[{s:0,f:0,ac:true},{s:1,f:2,ac:true}].map(member)}));
        b.handShapes=[{chord_id:0,start_time:onset,end_time:onset+.275},
          {chord_id:0,start_time:onset+.314,end_time:onset+1.5}];
        return b;
      }
      const sequence=mutedSequence();
      const sequenceProof=await captureOpen('muted-open-handshape-sequence',sequence,modern,{visible:true});
      check(sequenceProof.notes.some(n=>n.note.pm&&n.note.f===0&&n.fromChord),'PM fixture did not exercise hand-shape association');
      for(const n of sequenceProof.notes.filter(n=>n.note.f===0)){
        const standalone=sequence.notes.some(s=>s.t===n.note.t&&s.s===n.note.s);
        check(n.outline.visible===(standalone||framedVisibility),'PM sequence confused a standalone bar with an enclosed chord member');
      }
      await captureOpen('muted-open-handshape-current',mutedSequence(),{...modern,notationStyle:'current'},{visible:true});
      for(const strings of [4,6,7,8])for(const lefty of [false,true])for(const inverted of [false,true]){
        const b=baseBundle(strings);b.lefty=lefty;b.inverted=inverted;b.currentTime=onset-.3;
        b.notes=[member({t:onset,s:0,f:0,pm:true}),member({t:onset+.4,s:strings-1,f:127,mt:true,fhm:true})];
        const proof=await captureOpen(`open-muted-${strings}-${lefty?'lefty':'righty'}-${inverted?'inverted':'normal'}`,b,modern,{visible:true});
        check(proof.notes.some(n=>n.sourceFret===127&&n.outline.visible),'Standalone unpitched mute slab missing');
      }
      const mutedChord=openChord();
      mutedChord.chordTemplates[0].frets=[-1,127,127,127,-1,-1];
      mutedChord.chords[0].notes=[1,2,3].map(s=>member({s,f:127,mt:true,fhm:true}));
      const muteProof=await captureOpen('unpitched-muted-chord',mutedChord,modern,{visible:reference,frame:true});
      check(muteProof.notes.every(n=>n.sourceFret===127),'Unpitched chord fixture lost its source frets');
      await captureOpen('unpitched-muted-chord-current',mutedChord,{...modern,notationStyle:'current'},{visible:true,frame:true});
      mutedChord.currentTime=onset;
      await captureOpen('unpitched-muted-chord-onset',mutedChord,modern,{visible:true});
      // Read-only optional local chart evidence. Do not commit library data.
      if(option('--fixture')){
        const raw=JSON.parse(fs.readFileSync(option('--fixture'),'utf8'));
        for(const style of ['rsplus','current'])for(const currentTime of option('--times','132,132.171005,132.485001').split(',').map(Number)){
          const b={...baseBundle(),...raw,handShapes:raw.handshapes||raw.handShapes,chordTemplates:raw.templates||raw.chordTemplates,currentTime};
          const name=`${style}-${option('--fixture-name','open-muted')}-${currentTime}`;
          const proof=await capture(name,b,{...modern,notationStyle:style},{expectBodies:true});
          assertFloorStems(proof,name);
          const singles=proof.notes.filter(n=>n.note.f===0&&b.notes.some(s=>s.t===n.note.t&&s.s===n.note.s));
          check(singles.length>0&&singles.every(n=>n.outline.visible),`${name}: standalone open bars lost their stems`);
        }
      }
      // The same renderer must reset pooled visibility at the frame boundary,
      // when rewinding, and when switching styles in either direction.
      await init(openChord(),modern);
      const passes=[];
      for(const [style,time,visible] of [
        ['rsplus',onset-.3,framedVisibility],['rsplus',onset,true],
        ['rsplus',onset+.03,true],
        ['rsplus',onset-.3,framedVisibility],['current',onset-.3,true],
        ['rsplus',onset-.3,framedVisibility],['current',onset-.3,true],
      ]){
        const proof=await page.evaluate(({style,time})=>{h3dBgSetNotationStyle(style);bundle.currentTime=time;
          for(let i=0;i<45;i++)r.draw(bundle);return __captureNotation();},{style,time});
        assertOpen(proof,`live ${style}/${time}`,{visible,frame:time<onset});
        passes.push(proof);
      }
      results.push({name:'open-chord-live-style-and-onset-reuse',passes});
    }
    if(orientationOnly){
      const onset=13,distances=[2.7,1.5,.3,0];
      const member=n=>({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,
        pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,slp:false,plk:false,...n});
      const singles=baseBundle();
      singles.notes=techniqueFlags.map(([name,flags],i)=>({t:onset,s:i%6,f:name.startsWith('open')?0:3+Math.floor(i/6),...flags,_fixtureName:name}));
      // Both physical bend directions must survive removal of the decorative roll.
      singles.notes.push({t:onset,s:0,f:8,bn:1,sus:1},{t:onset,s:5,f:8,bn:1,sus:1});
      const chord=baseBundle();
      chord.chordTemplates=[{name:'C',frets:[0,3,5,5,4,3],fingers:[-1,1,3,4,2,1]}];
      chord.chords=[{t:onset,id:0,notes:[{s:0,f:0},{s:1,f:3,ac:true},{s:2,f:5,ho:true},{s:3,f:5,pm:true},{s:4,f:4,hp:true},{s:5,f:3}].map(member)}];
      chord.handShapes=[{chord_id:0,start_time:onset,end_time:onset+1.5}];
      const arp=baseBundle();
      arp.chordTemplates=[{name:'Am',frets:[-1,0,2,2,1,0],fingers:[-1,-1,2,3,1,-1],arp:true}];
      arp.handShapes=[{chord_id:0,start_time:onset,end_time:onset+2.6,arp:true}];
      arp.chords=[{t:onset,id:0,notes:[{s:1,f:0},{s:2,f:2},{s:3,f:2},{s:4,f:1},{s:5,f:0}].map(member)}];
      arp.notes=[{t:onset,s:1,f:0},{t:onset+.2,s:2,f:2,ac:true},{t:onset+.4,s:3,f:2,ho:true},{t:onset+.6,s:4,f:1},{t:onset+.8,s:5,f:0}];
      const isZero=rotation=>rotation.every(v=>Math.abs(v)<1e-10);
      function assertOrientation(proof,label,inverted=false){
        const modern=proof.style==='rsplus';
        for(const n of proof.notes){
          const expected=modern||n.note.f===0?0:Math.max(0,Math.min(1,n.dt/3))*Math.PI/2;
          for(const part of ['core','outline']){
            const [x,y,z]=n[part].rotation;
            check(Math.abs(x)+Math.abs(y)<1e-10&&Math.abs(z-expected)<1e-10,`${label}: ${part} rotated for ${n.note.s}/${n.note.f}/${n.dt}`);
          }
        }
        for(const marker of proof.markers){
          const {note,kind,mesh}=marker;
          const visualString=inverted?note.s:5-note.s;
          const expected=kind==='bend'&&visualString>=2.5?Math.PI:0;
          check(Math.abs(mesh.rotation[0])+Math.abs(mesh.rotation[1])<1e-10&&Math.abs(mesh.rotation[2]-expected)<1e-10,
            `${label}: ${kind} marker lost stable orientation/direction for string ${note.s}`);
        }
        for(const frame of proof.frames)check(isZero(frame.fill.rotation),`${label}: chord fill rotated`);
        for(const frame of proof.roundedFrames)check(isZero(frame.mesh.rotation),`${label}: chord/arpeggio rim rotated`);
        for(const ghost of proof.ghosts)check(isZero(ghost.rotation),`${label}: fretboard projection rotated`);
      }
      for(const [name,b] of [['singles',singles],['chord',chord],['arpeggio',arp]]){
        for(const dt of distances){
          b.currentTime=onset-dt;
          const proof=await capture(`orientation-${name}-${dt}`,b,{notationStyle:'rsplus',glow:.25,bloom:true,slideArrowApproachVisible:true},
            {expectBodies:true,image:dt===1.5||dt===0});
          assertOrientation(proof,`${name}/${dt}`);
          if(name==='singles'){
            check(proof.notes.length===singles.notes.length,`${name}/${dt}: missing technique note coverage`);
            check(proof.markers.some(m=>m.kind==='face')&&proof.markers.some(m=>m.kind==='bend')&&proof.markers.some(m=>m.kind==='slide')&&proof.markers.some(m=>m.kind==='halo'),`${name}/${dt}: missing attached marker/halo coverage`);
          }
          if(name==='chord')check(proof.notes.filter(n=>n.fromChord).length===6&&(dt===0||proof.frames.length>0),`${name}/${dt}: chord fixture missing members/frame`);
          if(name==='arpeggio')check(proof.roundedFrames.some(f=>f.mesh.material.uniforms.uBracketCap>0),`${name}/${dt}: missing arpeggio brackets`);
        }
      }
      const inverted={...singles,currentTime:onset-1.5,inverted:true,lefty:true};
      const invertedProof=await capture('orientation-inverted-lefty',inverted,{notationStyle:'rsplus',glow:.25,bloom:false},{expectBodies:true});
      assertOrientation(invertedProof,'inverted-lefty',true);
      const scored=await capture('orientation-verdict', {...singles,currentTime:onset}, {notationStyle:'rsplus',glow:.25,bloom:false,scored:true},{expectBodies:true});
      assertOrientation(scored,'verdict');
      check(scored.markers.some(m=>m.kind==='verdict-edge'),'Verdict fixture did not exercise edge meshes');

      // Warm both styles before measuring; the same live renderer reuses every pool.
      const live={...singles,currentTime:onset-1.5};
      await init(live,{notationStyle:'current',glow:.25,bloom:false});
      await page.evaluate(()=>{
        for(const style of ['rsplus','current']){
          h3dBgSetNotationStyle(style);
          for(let i=0;i<90;i++)r.draw(bundle);
        }
      });
      const passes=[];
      for(const style of ['current','rsplus','current','rsplus','current']){
        const proof=await page.evaluate(style=>{h3dBgSetNotationStyle(style);for(let i=0;i<90;i++)r.draw(bundle);return __captureNotation();},style);
        check(proof.style===style,`Orientation style setter failed for ${style}`);
        if(style==='rsplus')assertOrientation(proof,'live-rsplus');
        else{
          check(proof.notes.some(n=>n.note.f>0&&n.core.rotation[2]>.5),'Current legacy turn disappeared');
          for(const n of proof.notes)check(Math.abs(n.core.rotation[2]-(n.note.f>0?Math.PI/4:0))<1e-10,'Current legacy rotation did not restore');
        }
        passes.push(proof);
      }
      for(const [a,b] of [[1,3],[2,4]]){
        check(JSON.stringify(passes[a].renderer)===JSON.stringify(passes[b].renderer),`Orientation roundtrip added draw calls/resources for ${passes[a].style}`);
        const meshes=p=>p.notes.map(n=>({note:n.note,core:n.core,outline:n.outline}));
        check(JSON.stringify(meshes(passes[a]))===JSON.stringify(meshes(passes[b])),`Orientation roundtrip retained stale pooled state for ${passes[a].style}`);
      }
      results.push({name:'orientation-live-style-roundtrip',passes});
    }
    if(chordsOnly)for(const style of styles)await captureChordSequence(style);
    if(!readabilityOnly&&!bendsOnly&&!openChordsOnly&&!orientationOnly&&!chordsOnly&&!perfOnly&&!fidelityOnly)for(const style of styles){
      const effectProofs=[];
      for(const [effect,glow,bloom] of [['zero',0,false],['soft',.25,true],['user',.05,false]]){
        const proof=await capture(`${style}-eight-strings-${effect}`,matrix(),{notationStyle:style,glow,bloom},{expectBodies:true});
        effectProofs.push(proof);
        check(proof.notes.length===48,`${style}/${effect}: expected 48 colored core meshes, got ${proof.notes.length}`);
        check(new Set(proof.notes.map(n=>n.note.s)).size===8,`${style}/${effect}: missing string`);
      }
      const whiteSoft=await capture(`${style}-white-soft`,matrix(6),{notationStyle:style,glow:.4,bloom:true,customColors:Array(8).fill('#ffffff')},{expectBodies:true});
      if(style==='rsplus'){
        const whiteZero=await capture(`${style}-white-zero`,matrix(6),{notationStyle:style,glow:0,bloom:false,customColors:Array(8).fill('#ffffff')},{expectBodies:true});
        for(const [label,off,on] of [['colored',effectProofs[0],effectProofs[1]],['white',whiteZero,whiteSoft]]){
          check(JSON.stringify(off.notes.map(n=>n.core.material))===JSON.stringify(on.notes.map(n=>n.core.material)),`RS+ ${label} body materials changed when Soft glow toggled`);
          const differences=off.notes.map((n,i)=>n.dt<.5?Math.max(...n.centerPixel.slice(0,3).map((v,k)=>Math.abs(v-on.notes[i].centerPixel[k]))):0);
          check(Math.max(...differences)<=2,`RS+ ${label} near-center pixel changed with Soft glow by ${Math.max(...differences)} channels`);
          results.push({name:`rsplus-${label}-soft-glow-core-invariance`,maxNearCenterChannelDifference:Math.max(...differences)});
        }
      }
      await capture(`${style}-low-vibrancy-cinematic`,matrix(6),{notationStyle:style,glow:0,bloom:false,vibrancy:0,cinematic:true},{expectBodies:true});
      await captureChordSequence(style);
      for(const offset of quick?[0]:[0,6,12,18])await capture(`${style}-techniques-${offset}`,techniqueScene(offset),{notationStyle:style,glow:0,bloom:false},{expectBodies:true});
      if(!quick){const b=chordScene();b.currentTime=10.4;b.chords[0].notes=b.chords[0].notes.map((n,i)=>({...n,ac:true,...(i===1?{ho:true}: {})}));await capture(`${style}-chord-verdict-onset`,b,{notationStyle:style,glow:0,bloom:false,scored:true},{expectBodies:true});}
      if(!quick)for(const [name,count,lefty,inverted] of [['four-string-lefty',4,true,false],['seven-string-inverted',7,false,true],['eight-string-lefty-inverted',8,true,true]]){
        const b=matrix(count);b.lefty=lefty;b.inverted=inverted;
        await capture(`${style}-${name}`,b,{notationStyle:style,glow:0,bloom:false},{expectBodies:true});
      }
      if(option('--fixture')){
        const raw=JSON.parse(fs.readFileSync(option('--fixture'),'utf8'));
        for(const currentTime of option('--times','33.9,63,183').split(',').map(Number)){
          const b={...baseBundle(),...raw,handShapes:raw.handshapes||raw.handShapes,chordTemplates:raw.templates||raw.chordTemplates,currentTime};
          await capture(`${style}-${option('--fixture-name','airbourne')}-${currentTime}`,b,{notationStyle:style,glow:.05,bloom:false},{expectBodies:true});
        }
      }
    }
    if(!readabilityOnly&&!bendsOnly&&!openChordsOnly&&!orientationOnly&&!chordsOnly&&fidelityOnly){
      for(const [index,[name,flags]] of techniqueFlags.entries()){
        if(option('--detail-filter')&&!option('--detail-filter').split(',').includes(name))continue;
        const string = name==='tap'?4:name==='half-bend'?2:
          ['pop','tremolo','vibrato'].includes(name)?3:0;
        const b=baseBundle();
        b.notes=[{t:10.22,s:string,f:name.startsWith('open')?0:5,...flags,_fixtureName:name}];
        const proof=await capture(`detail-${name}`,b,{notationStyle:'rsplus',glow:0,bloom:false},{expectBodies:true});
        const [px,py]=proof.notes[0].screen;
        const clipWidth=Math.min(width,name.startsWith('open')?560:360),clipHeight=Math.min(height,350);
        const clip={x:Math.max(0,Math.min(width-clipWidth,Math.round(px-clipWidth*.5))),y:Math.max(0,Math.min(height-clipHeight,Math.round(py-clipHeight*.70))),width:clipWidth,height:clipHeight};
        await page.screenshot({path:path.join(out,`detail-${name}-close.png`),clip});
      }
      // A real render/pool check: the open marker fits within its colored bar,
      // its stem mirrors, and ordinary/accented open attacks stay fully opaque.
      for(const lefty of [false,true])for(const inverted of [false,true]){
        const b=baseBundle();b.lefty=lefty;b.inverted=inverted;
        b.notes=[{t:10.3,s:0,f:0},{t:11.2,s:2,f:0,ac:true},{t:12.1,s:5,f:0}];
        const proof=await capture(`open-layout-${lefty}-${inverted}`,b,{notationStyle:'rsplus',glow:0,bloom:false},{expectBodies:true});
        for(const n of proof.notes){
          const bodyW=n.core.scale[0],stemW=n.outline.scale[0];
          check(stemW<bodyW*.05,'Open stem is still a stretched horizontal outline');
          check(Math.sign(n.outline.position[0]-n.core.position[0])===(lefty?1:-1),'Open stem did not mirror with lefty layout');
          check(n.outline.material.opacity===1,'Open marker became translucent with distance');
        }
      }
      await capture('rsplus-white-techniques',techniqueScene(6),{
        notationStyle:'rsplus',glow:0,bloom:false,customColors:Array(8).fill('#ffffff'),
      },{expectBodies:true});
      for(const now of [10,10.8,11.6]){
        const b=baseBundle();b.currentTime=now;
        b.anchors=[{time:0,fret:1,width:4}];
        b.chordTemplates=[{name:'Am',frets:[-1,0,2,2,1,0],fingers:[-1,-1,2,3,1,-1],arp:true}];
        b.handShapes=[{chord_id:0,start_time:10.4,end_time:13,arp:true}];
        b.chords=[{t:10.4,id:0,notes:[{s:1,f:0},{s:2,f:2},{s:3,f:2},{s:4,f:1},{s:5,f:0}]}];
        b.notes=[{t:10.4,s:1,f:0},{t:10.8,s:2,f:2},{t:11.2,s:3,f:2},{t:11.6,s:4,f:1},{t:12,s:5,f:0},{t:12.4,s:3,f:2}];
        const proof=await capture(`rsplus-arpeggio-${now}`,b,{notationStyle:'rsplus',glow:0,bloom:false},{expectBodies:true});
        check(proof.roundedFrames.some(f=>f.mesh.material.uniforms.uBracketCap>0),'Arpeggio fixture did not render rounded bracket pairs');
        check(proof.roundedFrames.filter(f=>f.mesh.material.uniforms.uBracketCap>0).every(f=>!f.halo),'Arpeggio guide gained an unwanted halo');
      }
      if(option('--fixture')){
        const raw=JSON.parse(fs.readFileSync(option('--fixture'),'utf8'));
        for(const currentTime of option('--times','21,22.172001,22.8').split(',').map(Number)){
          const b={...baseBundle(),...raw,handShapes:raw.handshapes||raw.handShapes,chordTemplates:raw.templates||raw.chordTemplates,currentTime};
          await capture(`rsplus-${option('--fixture-name','aerosmith')}-${currentTime}`,b,{notationStyle:'rsplus',glow:.05,bloom:false},{expectBodies:true});
        }
      }
    }
    if(!readabilityOnly&&!bendsOnly&&!openChordsOnly&&!orientationOnly&&!chordsOnly&&!baseline&&!perfOnly&&!fidelityOnly){
      await init(matrix(),{notationStyle:'current',glow:0,bloom:false});
      const controls=await page.evaluate(()=>feedBackViz_highway_3d.panelControls);
      for(const key of ['notationStyle','glow','bloom'])check(controls.some(c=>c.key===key),`Missing panel control ${key}`);
      const roundtrip=[];
      for(const style of ['current','rsplus','current']){
        const p=await page.evaluate(style=>{h3dBgSetNotationStyle(style);for(let i=0;i<12;i++)r.draw(bundle);return __captureNotation();},style);
        check(p.style===style,`Live style setter did not apply ${style}`);roundtrip.push(p);
      }
      const comparable=p=>p.notes.map(n=>({note:n.note,core:n.core,outline:n.outline}));
      check(JSON.stringify(comparable(roundtrip[0]))===JSON.stringify(comparable(roundtrip[2])),'Current -> RS+ -> Current did not restore pooled core/rim state');
      results.push({name:'style-roundtrip',controls,proof:roundtrip});
      if(!quick){
        const split=await page.evaluate(async b=>{
          r.destroy();
          const host=document.getElementById('host');host.style.display='flex';host.innerHTML='<canvas id="split0" style="width:50%;height:100%"></canvas><canvas id="split1" style="width:50%;height:100%"></canvas>';
          const canvases=[document.getElementById('split0'),document.getElementById('split1')],listeners=new Set();
          window.feedBackSplitscreen={isActive:()=>true,panelIndexFor:c=>canvases.indexOf(c),isCanvasFocused:c=>c===canvases[0],onFocusChange:fn=>listeners.add(fn),offFocusChange:fn=>listeners.delete(fn)};
          for(const [index,style,glow,bloom] of [[0,'current',0,false],[1,'rsplus',.25,true]])for(const [key,value] of Object.entries({notationStyle:style,glow,bloom}))localStorage.setItem(`h3d_bg_panel${index}_${key}`,String(value));
          const instances=canvases.map(()=>feedBackViz_highway_3d());
          for(let i=0;i<2;i++)instances[i].init(canvases[i],b);
          await Promise.all(instances.map(x=>x.readyPromise));
          for(let i=0;i<50;i++)for(const x of instances)x.draw(b);
          window.bundle=b;
          const capture=i=>{window.r=instances[i];return __captureNotation();};
          const before=[capture(0),capture(1)];
          localStorage.setItem('h3d_bg_panel0_notationStyle','rsplus');h3dBgSetNotationStyle('current');
          for(let i=0;i<12;i++)for(const x of instances)x.draw(b);
          const after=[capture(0),capture(1)];
          const independentRenderers=instances[0].__notationAudit().ren!==instances[1].__notationAudit().ren;
          const secondRenderer=instances[1].__notationAudit().ren;
          instances[0].destroy();
          for(let i=0;i<10;i++)instances[1].draw(b);
          const surviving=capture(1);
          const firstAgain=feedBackViz_highway_3d();firstAgain.init(canvases[0],b);await firstAgain.readyPromise;
          for(let i=0;i<20;i++){firstAgain.draw(b);instances[1].draw(b);}
          const remounted=firstAgain.__notationAudit().ren!==secondRenderer;
          window.__splitInstances=[firstAgain,instances[1]];
          return {before,after,independentRenderers,surviving,remounted,listeners:listeners.size};
        },matrix(6));
        check(split.before[0].style==='current'&&split.before[1].style==='rsplus','Split initial styles not independent');
        check(split.after[0].style==='rsplus'&&split.after[1].style==='rsplus','Split style toggle failed');
        check(split.after[0].settings.glow===0&&split.after[1].settings.glow===.25,'Split glow settings not independent');
        check(split.after[0].settings.bloom===false&&split.after[1].settings.bloom===true,'Split bloom settings not independent');
        check(split.independentRenderers&&split.remounted,'Split renderers did not retain independent GPU resources');
        check(split.surviving.notes.length===36&&split.surviving.notes.every(n=>n.core.material.opacity===1&&!n.core.material.fog),'Disposing first split renderer damaged the survivor');
        results.push({name:'split-independent-toggle-dispose',...split});
        await page.screenshot({path:path.join(out,'split-independent-toggle-dispose.png')});
        await page.evaluate(()=>{for(const x of __splitInstances)x.destroy();delete window.feedBackSplitscreen;window.r=null;const host=document.getElementById('host');host.style.display='block';host.innerHTML='<canvas id="highway"></canvas>';});
      }
    }
    if(!readabilityOnly&&!bendsOnly&&!openChordsOnly&&!orientationOnly&&!chordsOnly&&((!quick&&!fidelityOnly)||perfOnly))for(let round=0;round<perfRounds;round++)for(const style of (round%2?[...styles].reverse():styles))for(const [effect,glow,bloom] of (perfOnly?[['zero',0,false],['soft',.25,true]]:[['soft',.25,true]])){
      await init(denseScene(),{notationStyle:style,glow,bloom});
      const perf=await page.evaluate(async()=>{
        const a=r.__notationAudit(),gl=a.ren.getContext(),samples=[],cpuSamples=[],finishSamples=[];
        a.ren.info.autoReset=false;
        for(let i=0;i<90;i++){a.ren.info.reset();const start=performance.now();r.draw(bundle);const afterDraw=performance.now();gl.finish();const afterFinish=performance.now();cpuSamples.push(afterDraw-start);finishSamples.push(afterFinish-afterDraw);samples.push(afterFinish-start);if(i%10===0)await new Promise(requestAnimationFrame);}
        samples.sort((a,b)=>a-b);cpuSamples.sort((a,b)=>a-b);finishSamples.sort((a,b)=>a-b);const debug=gl.getExtension('WEBGL_debug_renderer_info');return {samples,p50:samples[45],p95:samples[85],cpuP50:cpuSamples[45],cpuP95:cpuSamples[85],finishP50:finishSamples[45],finishP95:finishSamples[85],calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,memory:{...a.ren.info.memory},canvas:[a.ren.domElement.width,a.ren.domElement.height],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),style:a.style};
      });
      check(perf.style===style,`Performance probe expected ${style}, rendered ${perf.style}`);
      results.push({name:perfOnly?`${style}-performance-${effect}-r${round+1}`:`${style}-performance`,round,effect,...perf});
      console.log(`Performance ${style}/${effect}/${round+1}: p50=${perf.p50.toFixed(2)} p95=${perf.p95.toFixed(2)} CPU p50=${perf.cpuP50.toFixed(2)} finish p50=${perf.finishP50.toFixed(2)}`);
    }
    const comparisons=[];
    if(option('--compare'))for(const name of ['current-eight-strings-zero','current-eight-strings-soft','current-eight-strings-user','current-white-soft','current-low-vibrancy-cinematic','current-airbourne-33.9','current-airbourne-63','current-airbourne-183']){
      const before=path.join(option('--compare'),name+'.png'),after=path.join(out,name+'.png');
      if(fs.existsSync(before)&&fs.existsSync(after)){
        const identical=sha(fs.readFileSync(before))===sha(fs.readFileSync(after));
        comparisons.push({name,identical});check(identical,`Current regression screenshot differs: ${name}`);
      }
    }
    check(errors.length===0,`Browser errors: ${errors.join('\n')}`);
    const videoPath=readabilityExtra?await page.video().path():undefined;
    const report={repo,git,sourceRef,sourceSha256:sha(source),baseline,reference,viewport:[width,height],deviceScaleFactor:dpr,renderScale,videoPath,comparisons,results,errors,failures};
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output:out,cases:results.length,errors,failures},null,2));
    if(failures.length)process.exitCode=1;
  } finally {await browser.close();}
}
main().catch(e=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fatal.txt'),e.stack);console.error(e);process.exitCode=1;});
