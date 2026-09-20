#!/usr/bin/env node
/* Isolated actual-WebGL slide-in/linked-trail/hold merge acceptance.
 * --repo <checkout> --out <fresh directory> --style current|rsplus
 * Optional --case <comma-separated substrings>. PLAYWRIGHT_MODULE selects an
 * existing installation. No real runtime, library, settings or server writes.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(n,f)=>args.includes(n)?args[args.indexOf(n)+1]:f;
const repo=path.resolve(option('--repo',path.join(__dirname,'../..'))),out=path.resolve(option('--out',path.join(repo,'test-results/slide-in-merge'))),style=option('--style','rsplus');
const sourcePath=path.join(repo,'plugins/highway_3d/screen.js'),source=fs.readFileSync(sourcePath,'utf8').replace(/\r\n/g,'\n');
const failures=[],errors=[],results=[],check=(ok,message)=>{if(!ok)failures.push(message);};
function once(value,anchor,replacement){assert.equal(value.split(anchor).length,2,'Unique instrumentation anchor: '+anchor);return value.replace(anchor,replacement);}
let served=source;
served=once(served,'bodyGeom.attributes.position.needsUpdate = true;',`bodyGeom.attributes.position.needsUpdate = true;
 if(window.__slideProbe)window.__slideProbe.ribbons.push({note:{...n},nominalBodyWidth:bodyTw,nominalOutlineWidth:outlineTw,
 samples:times.map((t,i)=>{const o=i*12;return {t,body:Array.from(bodyPositions.slice(o,o+12)),outline:Array.from(outlinePositions.slice(o,o+12)),alpha:bodyColors?bodyColors[i*16+3]:1};})});`);
served=once(served,'const core = pNote.get();',`const core = pNote.get(); if(window.__slideProbe)window.__slideProbe.gems.push({note:{...n},fromChord,mesh:core});`);
served=once(served,'const fill = pChordFrameFill.get();',`const fill = pChordFrameFill.get(); if(window.__slideProbe)window.__slideProbe.frames.push({t:ch.t,isRepeat,compactRepeatFrame});`);
if(served.includes('const holdRail = pSusRail.get();'))served=once(served,'const holdRail = pSusRail.get();',`const holdRail = pSusRail.get(); if(window.__slideProbe)window.__slideProbe.holds.push({start:hold.start,end:hold.end});`);
const registrar=served.match(/function trailYieldRegisterGem\([^)]*\) \{/)[0];
served=once(served,registrar,`${registrar} if(window.__slideProbe&&event)window.__slideProbe.orders.push({kind:'gem',t:event.t,s:event.s,f:event.f,meshes:[outline,core,face].filter(Boolean)});`);
served=once(served,'function trailYieldRegisterTargetTrail(event, outline, body) {',`function trailYieldRegisterTargetTrail(event, outline, body) { if(window.__slideProbe&&event)window.__slideProbe.orders.push({kind:'trail',t:event.t,s:event.s,f:event.f,meshes:[outline,body]});`);
served=once(served,"contextType: 'webgl2',",`__slideAudit(){return {ren,notation:typeof rsPlusNotation==='undefined'?'current':rsPlusNotation?'rsplus':'current'};},contextType:'webgl2',`);
const note=extra=>({t:10,s:2,f:7,sus:1.4,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,...extra});
const incoming=(direction='up',extra={})=>note({slide_in_marks:[{direction,time:0}],...extra});
const template={name:'Slide-in',frets:[-1,5,7,7,-1,-1],fingers:[-1,1,3,4,-1,-1]};
const base=extra=>({currentTime:9.5,isPlaying:false,notes:[],chords:[],chordTemplates:[template],handShapes:[],anchors:[{time:0,fret:5,width:4}],beats:Array.from({length:25},(_,i)=>({time:6+i*.5,measure:i%4===0?i/4:-1})),sections:[],lyrics:[],stringCount:6,tuning:[0,0,0,0,0,0],songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false,...extra});
const scenes=[],add=(name,b,extra={})=>scenes.push({name,b,mode:1,...extra});
for(const direction of ['up','down'])add('incoming-'+direction,base({notes:[incoming(direction)]}),{cue:[{t:10,s:2,direction}],image:true});
add('zero-sustain',base({notes:[incoming('up',{sus:0})]}),{cue:[{t:10,s:2,direction:'up'}],image:true});
add('ghost',base({notes:[incoming('up',{ghost:true})]}),{cue:[{t:10,s:2,direction:'up'}],image:true});
add('prebend',base({notes:[incoming('down',{bn:1,bnv:[{t:0,v:1},{t:.7,v:1},{t:1.4,v:0}]})]}),{cue:[{t:10,s:2,direction:'down'}],image:true});
add('known-outgoing',base({notes:[incoming('up',{sl:9})]}),{cue:[{t:10,s:2,direction:'up'}],outgoing:true,image:true});
add('unknown-outgoing',base({notes:[incoming('up',{slide_out:'down',slide_out_marks:[{direction:'down',start:.9,end:1.4}]})]}),{cue:[{t:10,s:2,direction:'up'}],fade:true,image:true});
add('tied-incoming',base({notes:[incoming('up',{sus:2.4,slide_in_marks:[{direction:'up',time:0},{direction:'down',time:1.5}]})]}),{cue:[{t:10,s:2,direction:'up'},{t:11.5,s:2,direction:'down',onset:10}],gemCount:1,image:true});
const plainMembers=()=>[note({s:1,f:5}),note({s:2,f:7}),note({s:3,f:7})];
add('repeat-chord-incoming',base({chords:[{t:9,id:0,notes:plainMembers().map(n=>({...n,t:9,sus:.1}))},{t:10,id:0,hd:true,notes:[note({s:1,f:5}),incoming('up'),incoming('down',{s:3})]}],handShapes:[{start_time:9,end_time:11.4,chord_id:0}]}),{cue:[{t:10,s:2,direction:'up'},{t:10,s:3,direction:'down'}],fullFrame:true,image:true});
add('equal-chord-incoming',base({chords:[{t:10,id:0,notes:[note({s:1,f:5}),incoming('up'),incoming('down',{s:3})]}]}),{cue:[{t:10,s:2,direction:'up'},{t:10,s:3,direction:'down'}],noSharedHold:true,image:true});
add('no-cue-open',base({notes:[incoming('up',{f:0,sus:0})]}),{noCue:true});
add('no-cue-song-start',base({currentTime:0,notes:[incoming('up',{t:0,sus:0})]}),{noCue:true});
add('before-incoming-horizon',base({currentTime:6.75,notes:[incoming('up',{sus:0})]}),{noCue:true,gemCount:0});
add('incoming-horizon',base({currentTime:6.9,notes:[incoming('up',{sus:0})]}),{horizon:true,gemCount:0,image:true});
add('incoming-consumed',base({currentTime:10.01,notes:[incoming('up',{sus:0})]}),{noCue:true});
add('linked-width-incoming',base({notes:[incoming('up',{s:0,f:5,sus:1,ln:true}),note({t:11,s:0,f:5,sus:1,sl:8}),note({t:11.2,s:1,f:5,sus:.2})]}),{cue:[{t:10,s:0,direction:'up'}],seam:[10,11,0],image:true});
add('linked-destination-incoming',base({notes:[note({s:0,f:5,sus:1,ln:true}),incoming('up',{t:11,s:0,f:5,sus:1})]}),{cue:[{t:11,onset:11,s:0,direction:'up'}],hidden:[{t:11,s:0}],image:true});
add('linked-internal-incoming',base({notes:[note({s:0,f:5,sus:1,ln:true}),note({t:11,s:0,f:5,sus:1,slide_in_marks:[{direction:'down',time:.5}]}),note({t:11.31,s:1,f:6,sus:0})]}),{cue:[{t:11.5,onset:11,s:0,direction:'down'}],hidden:[{t:11,s:0}],seam:[10,11,0],image:true});
for(let mode=0;mode<4;mode++)for(const orientation of ['normal','mirrored-inverted']){
  const mirrored=orientation!=='normal',s=mirrored?5:0,lower=mirrored?4:1,extra={lefty:mirrored,inverted:mirrored};
  add(`incoming-source-mode-${mode}-${orientation}`,base({...extra,notes:[note({t:9.98,s:lower,f:5,sus:0}),incoming('up',{s,f:5,sus:0})]}),{mode,cue:[{t:10,s,direction:'up'}],narrowSource:mode>0?s:null,image:mode===3});
  add(`incoming-target-mode-${mode}-${orientation}`,base({...extra,notes:[note({t:9.6,s,f:5,sus:1.2}),incoming('up',{s:lower,f:5,sus:0})]}),{mode,cue:[{t:10,s:lower,direction:'up'}],narrowSource:mode>0?s:null,image:mode===3});
}
const dim=(v,kind='body')=>({x:(v[kind][0]+v[kind][3])/2,y:(v[kind][1]+v[kind][7])/2,z:v[kind][2],width:v[kind][3]-v[kind][0],height:v[kind][7]-v[kind][1]});
const at=(r,t)=>r?.samples.reduce((best,v)=>Math.abs(v.t-t)<1e-6&&(!best||Math.abs(v.t-t)<Math.abs(best.t-t))?v:best,null);
function validate(s,p){
 check(p.renderer.calls>0,s.name+': renderer drew nothing');check(p.notation===style,s.name+': wrong style');
 for(const r of p.ribbons)for(const v of r.samples){check(Number.isFinite(v.alpha),s.name+': invalid alpha');for(const k of ['body','outline'])check(v[k].every(Number.isFinite),s.name+': invalid '+k+' geometry');}
 for(const o of p.orders)check(o.orders.every(Number.isFinite),s.name+': invalid render order');
 for(const c of s.cue||[]){
   const onset=c.onset??c.t,r=p.ribbons.find(r=>r.note.s===c.s&&Math.abs(r.note.t-onset)<1e-6),end=at(r,c.t),start=at(r,c.t-.22);
   check(r&&end&&start,s.name+': missing incoming samples at '+c.t);if(!r||!end||!start)continue;
   const dx=dim(end).x-dim(start).x;check(dx*(c.direction==='up'?1:-1)*(s.b.lefty?-1:1)>0,s.name+': incoming direction wrong');
   check(start.alpha<.001&&end.alpha>.99,s.name+': incoming fade/end opacity wrong');
   // A real lower chord member can independently reduce the whole approach
   // to the visibility floor. Only unobstructed tips have the exact .72 ratio.
   if(s.narrowSource==null){check(dim(start).width/r.nominalBodyWidth<=.735,s.name+': incoming tip too wide');if(!s.b.chords.length&&s.b.notes.every(n=>n.s===c.s))check(Math.abs(dim(start).width/dim(end).width-.72)<.015,s.name+': incoming tip width wrong');}
   if(c.onset===undefined){const gem=p.gems.find(g=>g.note.s===c.s&&Math.abs(g.note.t-c.t)<1e-6);check(gem,s.name+': authored destination gem missing');if(gem){const v=dim(end);for(const k of ['x','y','z'])check(Math.abs(v[k]-gem.position[k])<.002,s.name+': incoming misses gem '+k);}}
 }
 if(s.gemCount!==undefined)check(p.gems.length===s.gemCount,s.name+': phantom tied attack');
 for(const n of s.hidden||[])check(!p.gems.some(g=>g.note.t===n.t&&g.note.s===n.s),s.name+': hidden linked attack reappeared');
 if(s.noCue)check(!p.ribbons.length,s.name+': fabricated incoming cue');
 if(s.horizon)check(p.ribbons.length===1&&p.ribbons[0].samples[0].t<10&&p.ribbons[0].samples.at(-1).t<=s.b.currentTime+3.001,s.name+': approaching cue missing or not horizon-clipped');
 if(s.noSharedHold)check(!p.holds.length,s.name+': shared hold hides incoming technique');
 if(s.fullFrame)check(p.frames.some(f=>f.t===10&&!f.compactRepeatFrame),s.name+': incoming repeat collapsed to compact frame');
 if(s.narrowSource!=null)check(p.ribbons.filter(r=>r.note.s===s.narrowSource).some(r=>r.samples.some(v=>dim(v).width/r.nominalBodyWidth<.6)),s.name+': real crossing never narrows source');
 if(s.name.includes('-mode-')){
  const upper=s.b.inverted?5:0,lower=s.b.inverted?4:1,isIncomingSource=s.name.startsWith('incoming-source');
  const covering=p.orders.find(o=>o.kind==='trail'&&o.s===upper&&o.t===(isIncomingSource?10:9.6));
  const target=p.orders.find(o=>o.kind==='gem'&&o.s===lower&&o.t===(isIncomingSource?9.98:10));
  const front=(a,b)=>Math.min(...a.orders)>Math.max(...b.orders);
  check(covering&&target,s.name+': missing meshes for ordering check');
  if(covering&&target)check(s.mode>=2?front(target,covering):front(covering,target),s.name+': gem foreground mode reversed');
  if(!isIncomingSource){const targetTrail=p.orders.find(o=>o.kind==='trail'&&o.s===lower&&o.t===10);check(targetTrail,s.name+': incoming target trail not registered');if(covering&&targetTrail)check(s.mode===3?front(targetTrail,covering):front(covering,targetTrail),s.name+': incoming target trail foreground mode reversed');}
 }
 if(s.fade){const r=p.ribbons.find(r=>r.note.s===2);check(r?.samples.at(-1).alpha<.01,s.name+': slide-out fade lost');}
 if(s.outgoing){const r=p.ribbons.find(r=>r.note.s===2),a=at(r,10),b=r?.samples.at(-1);check(a&&b&&dim(b).x>dim(a).x,s.name+': known outgoing slide lost');}
 if(s.seam){const [a,b,string]=s.seam,l=p.ribbons.find(r=>r.note.s===string&&r.note.t===a),r=p.ribbons.find(r=>r.note.s===string&&r.note.t===b);check(l&&r,s.name+': missing linked ribbons');if(l&&r)for(const kind of ['body','outline'])for(const k of ['x','y','z','width','height'])check(Math.abs(dim(l.samples.at(-1),kind)[k]-dim(r.samples[0],kind)[k])<2e-6,s.name+': linked '+kind+' '+k+' seam');}
}
async function main(){
 if(fs.existsSync(path.join(out,'results.json')))throw new Error('Choose fresh output directory');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://slide-fixture.test')return route.fulfill({status:403,body:'External network forbidden'});if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});const f=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(f.startsWith(repo+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(f)});return route.fulfill({status:404,body:'Unknown fixture asset'});});
  await page.goto('http://slide-fixture.test/');
  for(const s of scenes.filter(s=>!option('--case')||option('--case').split(',').some(q=>s.name.includes(q)))){
   const p=await page.evaluate(async({b,mode,style})=>{if(window.r)r.destroy();localStorage.clear();const settings={trailYieldEnabled:mode>0,trailYieldGemInFront:mode>=2,trailYieldIncludeTrails:mode===3,style:'off',notationStyle:style,glow:0,vibrancy:.85,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0};for(const[k,v]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(typeof setter==='function')setter(v);}window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;for(let i=0;i<3;i++)r.draw(bundle);const a=r.__slideAudit();window.__slideProbe={ribbons:[],gems:[],frames:[],holds:[],orders:[]};a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);const p=window.__slideProbe;window.__slideProbe=null;p.gems=p.gems.map(({mesh,...v})=>({...v,position:{x:mesh.position.x,y:mesh.position.y,z:mesh.position.z}}));p.orders=p.orders.map(({meshes,...v})=>({...v,orders:meshes.map(m=>m.renderOrder)}));return{notation:a.notation,renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles},...p};},{b:s.b,mode:s.mode,style});
   validate(s,p);results.push({name:s.name,mode:s.mode,...p});if(s.image)await page.screenshot({path:path.join(out,s.name+'.png')});console.log(s.name+': '+p.ribbons.length+' ribbons, '+p.gems.length+' gems');
  }
  check(errors.length===0,'Browser errors: '+errors.join('\n'));
 }finally{await browser.close();}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceNormalizedLfSha:crypto.createHash('sha256').update(source).digest('hex'),style,failures,errors,results},null,2));console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
