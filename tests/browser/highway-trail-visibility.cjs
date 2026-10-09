#!/usr/bin/env node
// Real WebGL visibility/ordering regression fixtures; no running app or library writes.
// PLAYWRIGHT_MODULE=<existing module> node tests/browser/highway-trail-visibility.cjs
// --out <directory> --style current|rsplus [--real-chart <private websocket capture>]
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const repo=path.resolve(__dirname,'../..'),out=path.resolve(option('--out','test-results/trail-visibility'));
const style=option('--style','rsplus');
let served=fs.readFileSync(path.join(repo,'plugins/highway_3d/screen.js'),'utf8').replace(/\r\n/g,'\n');
function patch(a,b){assert.equal(served.split(a).length,2,a);served=served.replace(a,b);}
patch('bodyGeom.attributes.position.needsUpdate = true;',`bodyGeom.attributes.position.needsUpdate = true;
 if(window.audit)audit.trails.push({id:_noteDrawEvent?.__auditId,t:n.t,s:n.s,f:n.f,scale:Math.min(...times.map((t,i)=>(bodyPositions[i*12+3]-bodyPositions[i*12])/bodyTw))});`);
patch('tr.scale.set(tw, th, segLen);',`tr.scale.set(tw, th, segLen); if(window.audit)audit.trails.push({id:_noteDrawEvent?.__auditId,t:n.t,s:n.s,f:n.f,scale:1});`);
patch('const core = pNote.get();',`const core = pNote.get(); if(window.audit)audit.gems.push({id:_noteDrawEvent?.__auditId,t:n.t,s:n.s,f:n.f});`);
patch('function trailYieldRegisterTargetTrail(event, outline, body) {',`function trailYieldRegisterTargetTrail(event, outline, body) {
 if(window.audit)audit.orders.push({id:event?.__auditId,kind:'trail',meshes:[outline,body]});`);
const gemRegistrar=served.match(/function trailYieldRegisterGem\([^)]*\) \{/)[0];
patch(gemRegistrar,gemRegistrar+`if(window.audit)audit.orders.push({id:event?.__auditId,kind:'gem',meshes:[outline,core,face].filter(Boolean)});`);
patch("contextType: 'webgl2',",`__audit(){return {events:_trailYieldEventsByFret.flat().filter(Boolean),queue:_noteDrawQueue,ren,now:_frameNow};},contextType:'webgl2',`);
const n=extra=>({t:10,s:3,f:5,sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,...extra});
const tpl=(frets,arp=false)=>({name:arp?'Test-arp':'Test',displayName:arp?'Test-arp':'Test',arp,frets,fingers:frets.map(f=>f<0?-1:1)});
const base=extra=>({currentTime:9.8,isPlaying:false,notes:[],chords:[],chordTemplates:[],anchors:[{time:0,fret:4,width:5}],handShapes:[],beats:Array.from({length:20},(_,i)=>({time:7+i*.5,measure:-1})),sections:[],lyrics:[],stringCount:6,tuning:[0,0,0,0,0,0],songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false,...extra});
const cases=[];const add=(name,b,source,times)=>cases.push({name,b,source,times:times||[b.currentTime]});
const slide=base({notes:[n({t:11,s:2,f:9,sus:2}),n({t:11,s:3,f:9,sus:2})],chords:[{t:10,id:0,notes:[n({s:2,f:7,sus:1,sl:9,ln:true}),n({s:3,f:7,sus:1,sl:9,ln:true})]}],chordTemplates:[tpl([-1,-1,7,7,-1,-1]),tpl([-1,-1,9,9,-1,-1])],handShapes:[{start_time:11.000002,end_time:13,chord_id:1}]});
add('hidden-synthetic-guide',slide,{t:11,s:3},[9.8,10.9,11,11.05]);
add('linked-continuation-control',{...slide,handShapes:[]},{t:11,s:3},[9.8,11.05]);
for(const sourceString of [2,3]){
 const repeat=(extra={},sus=0)=>base({currentTime:10.4,notes:[n({t:10.6,s:sourceString,f:5,sus:1.4})],chords:[{t:10.5,id:0,notes:[n({s:3}),n({s:4,f:7})]},{t:10.8,id:0,hd:true,notes:[n({s:3,sus,...extra}),n({s:4,f:7,sus,...extra})]}],chordTemplates:[tpl([-1,-1,-1,5,7,-1])]});
 add('compact-repeat-'+sourceString,repeat(),{t:10.6,s:sourceString},[10.4,10.81]);
 add('shared-hold-repeat-'+sourceString,repeat({},.7),{t:10.6,s:sourceString},[10.4,10.81]);
 add('visible-accent-repeat-control-'+sourceString,repeat({ac:true}),{t:10.6,s:sourceString});
}
for(const explicit of [false,true]){
 const b=base({notes:[n({s:3,f:7,sus:1.3}),n({t:11,s:2,f:5}),n({t:12,s:3,f:7})],chords:[{t:11,id:0,notes:[n({s:2,f:5}),n({s:3,f:7})]}],chordTemplates:[tpl([-1,-1,5,7,-1,-1],explicit)],handShapes:explicit?[{start_time:11,end_time:12.2,chord_id:0,arpeggio:true}]:[]});
 add((explicit?'explicit':'inferred')+'-deferred-arpeggio',b,{t:10,s:3},[9.8,11.05]);
}
add('arpeggio-first-note-only',base({notes:[n({s:3,f:7,sus:1.3}),n({t:11,s:2,f:5})],chords:[{t:11,id:0,notes:[n({s:2,f:5}),n({s:3,f:7})]}],chordTemplates:[tpl([-1,-1,5,7,-1,-1],true)],handShapes:[{start_time:11,end_time:12.2,chord_id:0,arpeggio:true}]}),{t:10,s:3},[9.8,11.05]);
add('arpeggio-preview-fallback-control',base({notes:[n({s:3,f:7,sus:1.3})],chords:[{t:11,id:0,notes:[n({s:2,f:5}),n({s:3,f:7})]}],chordTemplates:[tpl([-1,-1,5,7,-1,-1],true)],handShapes:[{start_time:11,end_time:12.2,chord_id:0,arpeggio:true}]}),{t:10,s:3});
add('hidden-continuation-visible-trail-control',base({notes:[n({s:2,f:5,sus:2}),n({t:9.8,s:3,f:5,sus:.4,ln:true}),n({t:10.2,s:3,f:5,sus:2})]}),{t:10,s:2});
add('shared-hold-hidden-trails-control',base({notes:[n({s:2,f:5,sus:2})],chords:[{t:10.2,id:0,notes:[n({s:3,f:5,sus:1.5}),n({s:4,f:7,sus:1.5})]}],chordTemplates:[tpl([-1,-1,-1,5,7,-1])]}),{t:10,s:2});
add('pick-scrape',base({notes:[n({s:2,f:7,sus:1.3}),n({t:11,s:3,f:0,sus:.4,mt:true,pick_scrape_marks:[{start:0,end:.4,direction:'down'}]})]}),{t:10,s:2});
add('ghost-note-visible-control',base({notes:[n({s:2,f:5,sus:2}),n({t:11,s:3,f:5,ghost:true})]}),{t:10,s:2});
for(const explicit of [false,true]){
 const b=base({notes:[n({s:1,f:7,sus:1.3}),n({t:11,s:2,f:5}),n({t:12,s:3,f:7})],chords:[{t:11,id:0,notes:[n({s:2,f:5,sus:0}),n({s:3,f:7,sus:1})]}],chordTemplates:[tpl([-1,-1,5,7,-1,-1],explicit)],handShapes:explicit?[{start_time:11,end_time:12.2,chord_id:0,arpeggio:true}]:[]});
 add((explicit?'explicit':'inferred')+'-hidden-chord-trail',b,{t:10,s:1},[9.8,11.05]);
}

if(option('--real-chart')){
 const messages=JSON.parse(fs.readFileSync(option('--real-chart'),'utf8'));
 const data=type=>messages.filter(m=>m.type===type).flatMap(m=>m.data||[]);
 add('actual-song-guide',base({currentTime:50.7,notes:data('notes'),chords:data('chords'),chordTemplates:data('chord_templates'),anchors:data('anchors'),handShapes:data('handshapes'),beats:data('beats'),sections:data('sections')}),{t:51.066,s:3},[50.7,51.06601,51.12,51.5,50.7]);
}
// Exercise open slabs/rails and the opposite physical string hierarchy too.
const originals=cases.slice();
for(const c of originals.filter(c=>['inferred-hidden-chord-trail','hidden-continuation-visible-trail-control','compact-repeat-2'].includes(c.name))){
 const b=structuredClone(c.b);b.inverted=true;b.lefty=true;
 for(const v of b.notes)v.s=5-v.s;
 for(const ch of b.chords)for(const v of ch.notes)v.s=5-v.s;
 for(const t of b.chordTemplates){t.frets.reverse();t.fingers.reverse();}
 add(c.name+'-inverted-lefty',b,{t:c.source.t,s:5-c.source.s},c.times);
}
add('open-linked-visible-trail',base({notes:[n({t:10,s:1,f:0,sus:2}),n({t:9.8,s:3,f:0,sus:.4,ln:true}),n({t:10.2,s:3,f:0,sus:2})]}),{t:10,s:1});
add('fretted-scrape-identity',base({notes:[n({t:10,s:1,f:7,sus:2}),n({t:11,s:3,f:19,sus:.4,mt:true,pick_scrape_marks:[{start:0,end:.4,direction:'down'}]})]}),{t:10,s:1});
add('ordering-control',base({notes:[n({t:10,s:2,f:7,sus:2}),n({t:11,s:3,f:7,sus:.4})]}),{t:10,s:2});
function expectWidth(c,time){
 if(c.name.startsWith('hidden-synthetic-guide'))return time>11.000002?.3:1;
 if(c.name==='actual-song-guide')return time>=51.066002?.3:1;
 if(c.name.startsWith('compact-repeat')||c.name.startsWith('shared-hold-repeat'))return time>=10.8?.3:1;
 if(c.name==='arpeggio-first-note-only')return time>=11?.3:1;
 if(c.name.includes('deferred-arpeggio')||c.name.includes('hidden-chord-trail')||c.name==='linked-continuation-control'||c.name==='pick-scrape')return 1;
 if(c.name==='open-linked-visible-trail'||c.name==='fretted-scrape-identity')return null; // independent rail/scrape footprints
 return .3;
}
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 const results=[],failures=[],errors=[];const check=(ok,msg)=>{if(!ok)failures.push(msg);};
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.stack));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://visibility.test')return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas id="highway"></canvas><script src="/screen.js"></script>'});
   if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
   const file=path.resolve(repo,'.'+u.pathname);return file.startsWith(repo+path.sep)&&fs.existsSync(file)?route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)}):route.fulfill({status:404,body:''});});
  await page.goto('http://visibility.test/');
  for(const c of cases){
   await page.evaluate(async({b,style})=>{if(window.r)r.destroy();window.audit=null;localStorage.clear();
    for(const [k,v]of Object.entries({style:'off',notationStyle:style,cameraMode:'stable',glow:0,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false})){
     localStorage.setItem('h3d_bg_'+k,String(v));const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(typeof setter==='function')setter(v);}
    window.bundle=b;b.notes.sort((a,b)=>a.t-b.t);window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;for(let i=0;i<3;i++)r.draw(bundle);
   },{b:c.b,style});
   // Include a rewind with no re-init; flip every checkbox combination live.
   const times=[...c.times,c.times[0]];
   for(const time of times)for(const mask of [0,1,3,7,5,4,6,2,1]){
    const p=await page.evaluate(({time,mask})=>{
     bundle.currentTime=time;bundle.isPlaying=!!(mask&4);h3dBgSetTrailYieldEnabled(!!(mask&1));h3dBgSetTrailYieldGemInFront(!!(mask&2));h3dBgSetTrailYieldIncludeTrails(!!(mask&4));
     const a=r.__audit();a.events.forEach((e,i)=>e.__auditId=i);window.audit={trails:[],gems:[],orders:[]};r.draw(bundle);
     const p=window.audit;window.audit=null;
     p.renderTime=r.__audit().now;p.playing=bundle.isPlaying;
     p.orders=p.orders.map(({meshes,...v})=>({...v,orders:meshes.map(m=>m.renderOrder)}));
     p.events=a.events.map(e=>({id:e.__auditId,t:e.t,s:e.s,f:e.f,head:e.gemVisible,trail:e.trailVisible}));
     p.queueRetainsReferences=a.queue.some(q=>q.event||q.args.some(v=>v!==undefined));
     return p;
    },{time,mask});
    const label=c.name+' @'+time+' mask '+mask;
    for(const event of p.events){
     check(event.head===p.gems.some(v=>v.id===event.id),label+': head visibility differs from emitted mesh '+event.id);
     check(event.trail===p.trails.some(v=>v.id===event.id),label+': trail visibility differs from emitted mesh '+event.id);
    }
    check(!p.queueRetainsReferences,label+': queue retains completed draw arguments');
    for(const part of [...p.gems,...p.trails])check(Number.isInteger(part.id),label+': emitted geometry has no origin');
    for(const order of p.orders)check(order.orders.every(Number.isFinite),label+': invalid draw order');
    if(c.name==='ordering-control'){
     const source=p.events.find(e=>e.t===10&&e.s===2),target=p.events.find(e=>e.t===11&&e.s===3);
     const covering=p.orders.find(o=>o.id===source.id&&o.kind==='trail');
     const head=p.orders.find(o=>o.id===target.id&&o.kind==='gem');
     const trail=p.orders.find(o=>o.id===target.id&&o.kind==='trail');
     check(covering&&head&&trail,label+': ordering meshes missing');
     if(covering&&head&&trail){
      const front=(a,b)=>Math.min(...a.orders)>Math.max(...b.orders);
      check((mask&3)===3?front(head,covering):front(covering,head),label+': head checkbox priority');
      check(mask===7?front(trail,covering):front(covering,trail),label+': trail checkbox priority');
     }
    }
    const scales=p.trails.filter(v=>v.s===c.source.s&&Math.abs(v.t-c.source.t)<1e-6).map(v=>v.scale);
    const width=scales.length?Math.min(...scales):null,expected=mask&1?expectWidth(c,p.renderTime):1;
    check(width!==null,label+': source trail missing');
    // In playback the clock advances between calls: clipping can expose a
    // partially recovered notch. Assert exact notch depth in paused frames;
    // emitted-part agreement and checkbox ordering are checked in every frame.
    if(expected!==null&&(!p.playing||expected===1))check(Math.abs(width-expected)<.015,label+': width '+width+' expected '+expected);
    check(width>=.285&&width<=1.015,label+': width outside configured bounds');
    results.push({name:c.name,time,mask,width,...p});
   }
   if(c.name==='hidden-synthetic-guide'||c.name==='actual-song-guide')await page.screenshot({path:path.join(out,c.name+'.png')});
   console.log(c.name+': '+times.length*9+' visibility/geometry frames');
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({style,failures,errors,results},null,2));
 console.log(JSON.stringify({out,scenarios:cases.length,frames:results.length,failures,errors},null,2));
 if(failures.length||errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
