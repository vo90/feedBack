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
const reference = args.includes('--reference');
const perfOnly=args.includes('--perf-only'),perfRounds=Number(option('--perf-rounds',1));
const width=Number(option('--width',1280)),height=Number(option('--height',720));
const dpr=Number(option('--dpr',1)),renderScale=Number(option('--scale',1));
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const failures = [], errors = [], results = [];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function check(value, message) { if (!value) failures.push(message); }
function once(text, marker, replacement) {
  assert.equal(text.split(marker).length, 2, `Expected one instrumentation anchor: ${marker}`);
  return text.replace(marker, replacement);
}
let served = once(source, 'const core = pNote.get();', `const core = pNote.get();
  if (window.__notationProbe) window.__notationProbe.notes.push({ note: {...n}, dt, fromChord, core, outline });`);
served = once(served, 'const fill = pChordFrameFill.get();', `const fill = pChordFrameFill.get();
  if (window.__notationProbe) window.__notationProbe.frames.push({ t:ch.t, dt:chDt, isRepeat, isArpeggioFrame, compactRepeatFrame, palmMuted:chordNotes.some(cn=>cn.pm), fill });`);
served = once(served, 'const b = pChordBox.get();', `const b = pChordBox.get();
  if (window.__notationProbe) window.__notationProbe.edges.push({ t:ch.t, dt:chDt, isRepeat, mesh:b });`);
if(served.includes('const mesh = pRsChordFrame.get();'))served=once(served,'const mesh = pRsChordFrame.get();',`const mesh = pRsChordFrame.get();
  if(window.__notationProbe)window.__notationProbe.roundedFrames.push({mesh,openTop,halo,width,height,rim,z});`);
served = once(served, "contextType: 'webgl2',", `__notationAudit() { return {
  scene, cam, ren, noteG, pNote, pTechPlane, composer:_composer, bloom:_bloom,
  style:typeof rsPlusNotation === 'undefined' ? 'current' : rsPlusNotation ? 'rsplus' : 'current',
  settings:{glow:glowMul,vibrancy,cinematic:_cinematic,hitFx:_hitFx,bloom:_bloom},
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
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
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
      window.__probeMesh=m=>({material:__probeMaterial(m.material),geometry:m.geometry.type,triangles:(m.geometry.index?.count||m.geometry.attributes.position.count)/3,position:m.position.toArray(),scale:m.scale.toArray(),renderOrder:m.renderOrder,visible:m.visible});
      window.__fillAlpha=m=>{const source=m.map?.image;if(!source)return null;const rgba=source.data||source.getContext?.('2d').getImageData(0,0,source.width,source.height).data;if(!rgba)return null;let min=255,max=0;for(let i=3;i<rgba.length;i+=4){min=Math.min(min,rgba[i]);max=Math.max(max,rgba[i]);}return {min,max,width:source.width,height:source.height};};
      window.__captureNotation=()=>{
        const a=r.__notationAudit();
        window.__notationProbe={notes:[],frames:[],edges:[],roundedFrames:[]};
        a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);
        const p=window.__notationProbe;window.__notationProbe=null;
        const gl=a.ren.getContext();
        return {style:a.style,settings:a.settings,canvas:[a.ren.domElement.width,a.ren.domElement.height],
          renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,memory:{...a.ren.info.memory}},
          notes:p.notes.map(({note,dt,fromChord,core,outline})=>{const v=core.getWorldPosition(core.position.clone()).project(a.cam);const rgba=new Uint8Array(4);gl.readPixels(Math.round((v.x+1)*a.ren.domElement.width/2),Math.round((v.y+1)*a.ren.domElement.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return {note,dt,fromChord,core:__probeMesh(core),outline:__probeMesh(outline),screen:[(v.x+1)*innerWidth/2,(1-v.y)*innerHeight/2],centerPixel:Array.from(rgba)};}),
          frames:p.frames.map(({fill,...metadata})=>({...metadata,fill:__probeMesh(fill),textureAlpha:__fillAlpha(fill.material)})),
          edges:p.edges.map(({t,dt,isRepeat,mesh})=>({t,dt,isRepeat,mesh:__probeMesh(mesh)})),
          roundedFrames:p.roundedFrames.map(({mesh,...rest})=>({...rest,mesh:__probeMesh(mesh)}))};
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
    if(chordsOnly)for(const style of styles)await captureChordSequence(style);
    if(!chordsOnly&&!perfOnly&&!fidelityOnly)for(const style of styles){
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
    if(!chordsOnly&&fidelityOnly){
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
    if(!chordsOnly&&!baseline&&!perfOnly&&!fidelityOnly){
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
    if(!chordsOnly&&((!quick&&!fidelityOnly)||perfOnly))for(let round=0;round<perfRounds;round++)for(const style of (round%2?[...styles].reverse():styles))for(const [effect,glow,bloom] of (perfOnly?[['zero',0,false],['soft',.25,true]]:[['soft',.25,true]])){
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
    const report={repo,git,sourceSha256:sha(source),baseline,reference,viewport:[width,height],deviceScaleFactor:dpr,renderScale,comparisons,results,errors,failures};
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({output:out,cases:results.length,errors,failures},null,2));
    if(failures.length)process.exitCode=1;
  } finally {await browser.close();}
}
main().catch(e=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'fatal.txt'),e.stack);console.error(e);process.exitCode=1;});
