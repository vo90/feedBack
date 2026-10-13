#!/usr/bin/env node
'use strict';
// Isolated production-renderer regression; no app, profile or library writes.
// --out <fresh-dir> [--chart <private streamed Lead JSON>]
// --source-ref 6454ffc --reference proves the old endpoint stepping.
// --edges additionally requires the RS+ default cyan analytic material.
// PLAYWRIGHT_MODULE may point to an already prepared Playwright installation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const repo=path.resolve(__dirname,'../..'),out=path.resolve(option('--out',path.join(repo,'test-results/lane-stability')));
const ref=option('--source-ref'),reference=args.includes('--reference'),edges=args.includes('--edges'),chartPath=option('--chart');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const source=ref?cp.execFileSync('git',['-C',repo,'show',ref+':plugins/highway_3d/screen.js'],{encoding:'utf8',maxBuffer:8*1024*1024}):fs.readFileSync(path.join(repo,'plugins/highway_3d/screen.js'),'utf8');
const targets=[
 {time:176.850998,before:[4,8],after:[3,7]}, {time:177.175995,before:[3,7],after:[1,5]},
 {time:179.612,before:[1,5],after:[4,8]}, {time:181.800003,before:[4,8],after:[3,7]},
 {time:183.498001,before:[3,7],after:[9,13]}, {time:185.207001,before:[9,13],after:[16,20]},
];
const fixture={notes:[],chords:[],templates:[],handshapes:[],beats:[],anchors:[{time:0,fret:5,width:4},...targets.map(t=>({time:t.time,fret:t.after[0]+1,width:t.after[1]-t.after[0]}))]};
const chartBytes=chartPath?fs.readFileSync(chartPath):null,chart=chartBytes?JSON.parse(chartBytes):fixture;
if(chartBytes)for(const t of targets)assert.ok(chart.anchors.some(a=>Math.abs(a.time-t.time)<1e-7),'Optional chart must contain the documented Lead passage');
let served=source;const hook="contextType: 'webgl2',";assert.equal(served.split(hook).length,2);
served=served.replace(hook,`__laneAudit(){return {ren,cam,scene,noteG,T,K,TS,AHEAD,now:_frameNow,xFret,gLanePlane,gLaneDivider,gRsLaneDivider,
 mLaneOdd,mLaneEven,mLaneDivider,mRsLaneDivider,mHandPositionEdge,mLaneDividerExt,
 edge:typeof mRsLaneEdge==='undefined'?null:mRsLaneEdge};},${hook}`);
// Count actual shader compilation during readyPromise, including offscreen prewarm.
const factoryStart=served.indexOf('function rsLaneDividerMaterial(');assert.ok(factoryStart>=0);
const factoryEnd=served.indexOf('\n        }',factoryStart);assert.ok(factoryEnd>factoryStart);
let factory=served.slice(factoryStart,factoryEnd);
assert.equal(factory.split('return new T.ShaderMaterial({').length,2);
factory=factory.replace('return new T.ShaderMaterial({','const auditMaterial = new T.ShaderMaterial({');
factory+='\n auditMaterial.onBeforeCompile=()=>{const c=auditMaterial.uniforms.uColor.value.getHexString();window.__compiles[c]=(window.__compiles[c]||0)+1;};return auditMaterial;';
served=served.slice(0,factoryStart)+factory+served.slice(factoryEnd);
const report={sourceRef:ref||null,sourceSha256:hash(source),chart:chartBytes?'private immutable chart':'portable anchor fixture',chartSha256:hash(chartBytes||JSON.stringify(fixture)),reference,edges,hz:174.963,viewport:[3440,1343],results:[],errors:[],failures:[]};
const check=(ok,message)=>{if(!ok)report.failures.push(message);};
async function main(){
 assert.ok(!fs.existsSync(out),'Use a fresh evidence directory');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:3440,height:1343},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.stack));
  await page.addInitScript(()=>{window.__wall=1000;window.__compiles={};Object.defineProperty(performance,'now',{value:()=>window.__wall,configurable:true});});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='http://lane-stability.test')return route.fulfill({status:403,body:'External network blocked'});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
   if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
   const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
   if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});
   return route.fulfill({status:404,body:'Missing fixture asset'});
  });
  for(const preset of ['straight','angled']){
   await page.goto('http://lane-stability.test');
   const init=await page.evaluate(async({chart,preset})=>{
    for(const[k,v]of Object.entries({cameraMode:'stable',stableCameraPreset:preset,notationStyle:'rsplus',style:'off',glow:0,bloom:false,cinematic:false,chordDiagramVisible:false,projectionVisible:false}))localStorage.setItem('h3d_bg_'+k,String(v));
    window.makeBundle=c=>({...c,currentTime:175,isPlaying:false,playbackRate:1,chordTemplates:c.chordTemplates||c.templates||[],handShapes:c.handShapes||c.handshapes||[],beats:c.beats||[],sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},lefty:false,inverted:false,renderScale:1,bgReactive:false});
    window.bundle=makeBundle(chart);window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
    window.a=r.__laneAudit();window.rawRender=a.ren.render.bind(a.ren);a.ren.render=()=>{};
    window.step=(time,draw=false)=>{
     bundle.currentTime=time;bundle.isPlaying=false;window.__wall+=1000/174.963;r.draw(bundle);a=r.__laneAudit();
     const visible=m=>{for(let p=m;p;p=p.parent)if(!p.visible)return false;return true;};
     const floors=a.noteG.children.filter(m=>visible(m)&&[a.mLaneOdd,a.mLaneEven].includes(m.material));
     let submitted=0;for(const m of floors)m.onBeforeRender=()=>submitted++;
     if(draw)rawRender(a.scene,a.cam);
     const floor=floors.map(m=>({id:m.id,x0:m.position.x-m.scale.x/2,x1:m.position.x+m.scale.x/2,z0:m.position.z-m.scale.y/2,z1:m.position.z+m.scale.y/2,geometry:m.geometry.type}));
     const materialName=m=>m===a.edge?'edge':m===a.mRsLaneDivider?'gray':m===a.mHandPositionEdge?'legacyEdge':m===a.mLaneDividerExt?'extension':m===a.mLaneDivider?'legacy':null;
     const rails=a.noteG.children.filter(m=>visible(m)&&materialName(m.material)).map(m=>({id:m.id,material:materialName(m.material),geometry:m.geometry.type,frustumCulled:m.frustumCulled,order:m.renderOrder,depthTest:m.material.depthTest,depthWrite:m.material.depthWrite,x:m.position.x,z:m.position.z,length:m.scale.z}));
     return {time,now:a.now,floor,rails,submitted,error:a.ren.getContext().getError(),objects:a.noteG.children.length};
    };
    window.boundaryCheck=(snapshot,targets)=>{
     const errors=[];
     for(const t of targets){const dt=t.time-snapshot.now;if(dt<=1e-7||dt>=a.AHEAD-1e-7)continue;const z=-a.TS*dt;
      for(const side of ['before','after']){const span=t[side],x=(a.xFret(span[0])+a.xFret(span[0]+1))/2;
       if(!snapshot.floor.some(m=>x>Math.min(m.x0,m.x1)+1e-8&&x<Math.max(m.x0,m.x1)-1e-8&&Math.min(Math.abs(m.z0-z),Math.abs(m.z1-z))<1e-8))errors.push({time:snapshot.time,now:snapshot.now,boundary:t.time,side,expectedZ:z});}
     }
     for(const m of snapshot.floor)if(m.z0< -a.TS*a.AHEAD-1e-8||m.z1>1e-8||m.z1-m.z0<=1e-9)errors.push({time:snapshot.time,invalidFloor:m});
     return errors;
    };
    const gl=a.ren.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),canvas:[a.ren.domElement.width,a.ren.domElement.height],prewarmed:{...window.__compiles}};
   },{chart,preset});
   check(/SwiftShader/i.test(init.renderer),'Expected isolated software renderer');
   const sweep=await page.evaluate(targets=>{let count=0,violations=0,examples=[];for(let i=0;i<=Math.floor(11*174.963);i++){const s=step(175+i/174.963),errs=boundaryCheck(s,targets);count++;violations+=errs.length;examples.push(...errs.slice(0,Math.max(0,8-examples.length)));}return {count,violations,examples};},targets);
   report.results.push({preset,init,sweep});
   check(reference?sweep.violations>100:sweep.violations===0,`${preset}: ${reference?'baseline stepping not reproduced':'authored endpoints mismatch'} (${sweep.violations})`);
   for(const time of [180.636,183.286,183.498001-3,183.498001-1e-6,183.498001,183.498001+1e-6,175]){
    const row=await page.evaluate(({time,targets})=>{const s=step(time,true);return {...s,violations:boundaryCheck(s,targets),png:a.ren.domElement.toDataURL('image/png')};},{time,targets});
    if(!reference)check(!row.violations.length,`${preset}: boundary/seek at${time}`);
    check(row.submitted>0&&!row.error,`${preset}: actual floor draw at${time}`);
    if([180.636,183.286].includes(time)){fs.writeFileSync(path.join(out,`${preset}-${time}.png`),Buffer.from(row.png.split(',')[1],'base64'));}delete row.png;
    report.results.push({preset,capture:row});
   }
   const fixtures=await page.evaluate(()=>{
    const original=bundle,results=[];
    const run=(name,chart,times,targets)=>{bundle=makeBundle(chart);let violations=[];for(const time of times)violations.push(...boundaryCheck(step(time),targets));results.push({name,violations});};
    const bare={notes:[],chords:[],templates:[],handshapes:[],anchors:[]};
    const tiny=[{time:10.003,before:[3,7],after:[9,13]},{time:10.004,before:[9,13],after:[3,7]}];
    run('one-millisecond-section',{...bare,anchors:[{time:0,fret:4,width:4},{time:10.003,fret:10,width:4},{time:10.004,fret:4,width:4}]},[9,10.0035,8],tiny);
    const dense=Array.from({length:150},(_,i)=>({time:10+i*.004,fret:i%2?4:10,width:4}));
    const denseTargets=dense.map((x,i)=>({time:x.time,before:i?(dense[i-1].fret===4?[3,7]:[9,13]):[3,7],after:x.fret===4?[3,7]:[9,13]}));
    run('dense-chart-regions',{...bare,anchors:[{time:0,fret:4,width:4},...dense]},[9.9,10.3,11,9.9],denseTargets);
    const arp={...bare,anchors:[{time:0,fret:4,width:4}],templates:[{frets:[-1,4,6,-1,-1,-1],arp:true}],handshapes:[{chord_id:0,start_time:10,end_time:11,arp:true}]};
    bundle=makeBundle(arp);const arpState=step(9.7);results.push({name:'constant-bounds-arpeggio',floorCount:arpState.floor.length,expectedFloors:4,finite:arpState.floor.every(m=>Object.values(m).every(v=>typeof v!=='number'||Number.isFinite(v)))});
    h3dBgSetCameraMode('lookahead');bundle=makeBundle({...bare,notes:[{t:10,s:1,f:5,sus:1}]});const fallback=step(9);results.push({name:'no-anchor-fallback',floorCount:fallback.floor.length,rails:fallback.rails});h3dBgSetCameraMode('stable');
    bundle=makeBundle({...bare,anchors:[{time:0,fret:4,width:4}],templates:[{frets:[-1,10,12,-1,-1,-1]}],handshapes:[{chord_id:0,start_time:10,end_time:11}]});
    const guides=step(9.7);results.push({name:'additional-hand-position-guides',rails:guides.rails});
    bundle=original;const before=step(183.286);step(180.636);const after=step(183.286);results.push({name:'seek-and-pool-reuse',same:JSON.stringify(before.floor)===JSON.stringify(after.floor)});
    return results;
   });
   report.results.push({preset,fixtures});
   if(!reference)for(const f of fixtures){if(f.violations)check(!f.violations.length,`${preset}: ${f.name} boundary mismatch`);if('floorCount'in f)check(f.floorCount>0&&f.finite!==false,`${preset}: ${f.name} absent/nonfinite floor`);if('expectedFloors'in f)check(f.floorCount===f.expectedFloors,`${preset}: redundant arpeggio floor split`);if('same'in f)check(f.same,`${preset}: seek pool reuse differs`);}
   const variants=await page.evaluate(()=>{
    const result=[];const snapshot=name=>{const s=step(183.286);result.push({name,violations:boundaryCheck(s,[{time:183.498001,before:[3,7],after:[9,13]}]),floor:s.floor.length,rails:s.rails});};
    bundle.lefty=true;snapshot('lefty');bundle.lefty=false;
    h3dSetFretSpacing('log');snapshot('logarithmic');h3dSetFretSpacing('uniform');
    h3dBgSetNotationStyle('current');snapshot('current');h3dBgSetNotationStyle('rsplus');
    h3dBgSetHwTheme('forest');snapshot('forest');h3dBgSetHwTheme('default');snapshot('rsplus-default');
    return result;
   });
   report.results.push({preset,variants});if(!reference)for(const v of variants)check(!v.violations.length&&v.floor>0,`${preset}: ${v.name} endpoints`);
   if(edges){
    const fallback=fixtures.find(f=>f.name==='no-anchor-fallback');check(fallback.rails.filter(r=>r.material==='edge').length===2,`${preset}: no-anchor fallback lacks analytic outer edges`);
    const guides=fixtures.find(f=>f.name==='additional-hand-position-guides').rails.filter(r=>r.material==='legacyEdge');check(guides.length===2&&guides.every(r=>r.geometry==='BoxGeometry'&&!r.depthTest&&r.order===2),`${preset}: additional hand-position guide material changed`);
    check(init.prewarmed['62b9be']>0,`${preset}: cyan shader not prewarmed`);
    for(const v of variants){const active=v.rails.filter(r=>r.material==='edge');if(['current','forest'].includes(v.name))check(!active.length,`${preset}: ${v.name} uses RS+ edge`);else check(active.length>0&&active.every(r=>r.geometry==='PlaneGeometry'&&!r.frustumCulled&&!r.depthTest&&!r.depthWrite&&r.order>2.01),`${preset}: ${v.name} edge geometry/depth/order`);}
    const lifecycle=await page.evaluate(async()=>{
     const edge=a.edge,geo=a.gRsLaneDivider;let edgeDisposed=0,geoDisposed=0;edge.addEventListener('dispose',()=>edgeDisposed++);geo.addEventListener('dispose',()=>geoDisposed++);
     const pool=()=>a.noteG.children.filter(m=>m.visible&&[a.edge,a.mRsLaneDivider,a.mLaneDividerExt,a.mHandPositionEdge,a.mLaneDivider].includes(m.material));
     bundle.renderScale=.5;step(183.286,true);const half={buffer:[a.ren.domElement.width,a.ren.domElement.height],uniform:edge.uniforms.uViewport.value.toArray()};
     bundle.renderScale=1;step(183.286,true);const full={buffer:[a.ren.domElement.width,a.ren.domElement.height],uniform:edge.uniforms.uViewport.value.toArray()};
     h3dBgSetNotationStyle('current');step(183.286,true);const oldBoxes=pool().filter(m=>m.material===a.mHandPositionEdge||m.material===a.mLaneDivider).every(m=>m.geometry===a.gLaneDivider);
     h3dBgSetNotationStyle('rsplus');step(183.286,true);const restored=pool().filter(m=>m.material===edge).every(m=>m.geometry===geo);
     r.destroy();return {half,full,oldBoxes,restored,edgeDisposed,geoDisposed};
    });
    report.results.push({preset,lifecycle});check(JSON.stringify(lifecycle.half.buffer)===JSON.stringify(lifecycle.half.uniform)&&JSON.stringify(lifecycle.full.buffer)===JSON.stringify(lifecycle.full.uniform),`${preset}: viewport uniform stale`);
    // Shared resources can receive idempotent dispose calls from both traversal
    // and the owned-resource list; absence of disposal is the regression.
    check(lifecycle.oldBoxes&&lifecycle.restored&&lifecycle.edgeDisposed>=1&&lifecycle.geoDisposed>=1,`${preset}: pool geometry/disposal`);
   }else await page.evaluate(()=>r.destroy());
  }
 }catch(e){report.failure=e.stack;throw e;}
 finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');}
 if(chartPath)assert.equal(hash(fs.readFileSync(chartPath)),report.chartSha256,'Input chart changed');
 console.log(JSON.stringify({out,reference,edges,errors:report.errors,failures:report.failures,sweeps:report.results.filter(r=>r.sweep).map(r=>({preset:r.preset,...r.sweep}))},null,2));
 if(report.errors.length||report.failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
