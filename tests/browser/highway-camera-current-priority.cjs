#!/usr/bin/env node
'use strict';

// Isolated production-renderer acceptance for current/immediate-next framing.
// No live app/profile/library writes. GPU submission only for named captures.
// --repo <checkout> --out <fresh-dir> --six <private compact chart>
// --airbourne <private compact chart> --compare-ref <ref> --perf
// --case <comma-separated name fragments> --reference (report expected old failures)
// --source-ref <ref> reads that committed renderer instead of the working source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const repo=path.resolve(option('--repo',path.join(__dirname,'../..'))),out=path.resolve(option('--out',path.join(repo,'test-results/camera-current-priority')));
const normalize=s=>s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const gitSource=ref=>normalize(execFileSync('git',['-c','safe.directory='+repo,'-C',repo,'show',ref+':plugins/highway_3d/screen.js'],{encoding:'utf8',maxBuffer:8*1024*1024}));
const sourcePath=path.join(repo,'plugins/highway_3d/screen.js'),source=option('--source-ref')?gitSource(option('--source-ref')):normalize(fs.readFileSync(sourcePath,'utf8'));
const compareRef=option('--compare-ref'),baseline=compareRef?gitSource(compareRef):null;
const selected=name=>!option('--case')||option('--case').split(',').some(p=>name.includes(p));
const failures=[],errors=[],results=[];
const check=(ok,message)=>{if(!ok)failures.push(message);};
const maxDelta=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
const pose=p=>[...p.position,...p.quaternion,p.fov];
// pNote also owns narrow open-string edge pieces. Size only chart-matched
// imminent fretted gems; all relevant meshes still receive visibility checks.
const frettedHeads=s=>s.heads.filter(h=>h.dt>=0&&h.dt<=.25&&s.next.some(n=>n.f>0&&Math.abs(n.dt-h.dt)<.003&&Math.abs(n.screen[0]-h.screen[0])<.02&&Math.abs(n.screen[1]-h.screen[1])<.02));
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'Missing unique hook: '+a);return s.replace(a,b);};

function instrument(input){
 let result=once(input,'_stableFit.distance = high;',`_stableFit.distance = high;
 if(window.__prioritySolves)window.__prioritySolves.push({preferredX,baseDistance,prediction,margin,fixedCentre,interval:{...interval},result:{..._stableFit}});`);
 return once(result,"contextType: 'webgl2',",`__priorityAudit(){return {ren,scene,cam,mode:cameraMode,constants:{K,TS,AHEAD},
 state:Object.fromEntries(Object.entries(_stableCam).filter(([k,v])=>v===null||['number','string','boolean'].includes(typeof v))),
 projectFret(f,s=2,dt=0){return new T.Vector3(xFretMid(f),sY(s),dZ(dt)).project(cam).toArray();},
 fretWorldX(f){return xFretMid(f);},
 heads(){const heads=[];pNote.forEachActive(m=>{if(!m.visible||m.userData.stableCameraRelevant===false||m.material?.opacity===0)return;
 const p=new T.Vector3();m.getWorldPosition(p);const dt=-p.z/TS,world=p.toArray();p.project(cam);const rect={};
 if(_incomingLabelScreenRect(m,rect,true))heads.push({dt,world,screen:p.toArray(),rect});});return heads;},
 geometry(){const items=[];for(const[kind,pool]of[['note',pNote],['tail',pSus],['ribbon',pSusRibbon],['chord',pChordBox],['frame',pRsChordFrame],['technique',pTechPlane]]){
 pool?.forEachActive(m=>{if(!m.visible)return;const a=m.geometry?.attributes?.position,n=Number.isFinite(m.geometry?.userData?.ribbonSlices)?Math.min(a.count,(m.geometry.userData.ribbonSlices+1)*4):a?.count||0;
 items.push({kind,position:m.position.toArray(),scale:m.scale.toArray(),quaternion:m.quaternion.toArray(),vertices:a?Array.from(a.array.slice(0,n*3)):[]});});}return items;}
 };},
 __priorityBenchmark(bundle,count){window.__prioritySolves=null;for(let i=0;i<30;i++){window.__wall+=1000/60;camUpdate(bundle);}
 const samples=[];for(let i=0;i<count;i++){window.__wall+=1000/60;const t=window.__realNow();camUpdate(bundle);samples.push(window.__realNow()-t);}
 samples.sort((a,b)=>a-b);return{mean:samples.reduce((a,b)=>a+b,0)/samples.length,p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),points:_stableCam.pointCount};},
 contextType:'webgl2',`);
}
const note=e=>({t:6,s:2,f:4,sus:0,sl:-1,slu:-1,bn:0,...e});
const base=e=>({currentTime:6,isPlaying:true,playbackRate:1,notes:[],chords:[],chordTemplates:[],handShapes:[],anchors:[{time:0,fret:2,width:4}],
 beats:Array.from({length:520},(_,i)=>({time:i*.5,measure:i%4===0?i/4:-1})),sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},lefty:false,inverted:false,renderScale:1,...e});
const fixture=kind=>{
 if(kind==='priority')return base({notes:[...Array.from({length:8},(_,i)=>note({t:6+i*.15,f:4})),note({t:8.85,f:19})]});
 if(kind==='churn')return base({notes:[...Array.from({length:20},(_,i)=>note({t:6+i*.12,f:4,s:i%3})),...Array.from({length:11},(_,i)=>note({t:8.4+i*.11,f:[17,20,22,18][i%4],s:i%3}))].sort((a,b)=>a.t-b.t)});
 if(kind==='churn-return')return base({notes:[...Array.from({length:5},(_,i)=>note({t:6+i*.25,f:19,s:i%3})),...Array.from({length:30},(_,i)=>note({t:7.25+i*.15,f:4,s:i%3})),...Array.from({length:20},(_,i)=>note({t:9.8+i*.13,f:[17,20,22,18][i%4],s:i%3}))].sort((a,b)=>a.t-b.t)});
 if(kind==='return')return base({notes:Array.from({length:60},(_,i)=>note({t:6+i*.25,f:i<10?19:4,s:i%3})),anchors:[{time:0,fret:18,width:4},{time:8.5,fret:2,width:4}]});
 if(kind==='rest-entry')return base({notes:[note({t:6,f:4,sus:.1}),note({t:10,f:20,sus:.3})],anchors:[{time:0,fret:2,width:4},{time:10,fret:18,width:4}]});
 if(kind==='restrike')return base({notes:[note({t:6,f:3,s:2,sus:4}),note({t:7,f:16,s:2,sus:3})],anchors:[{time:0,fret:3,width:4},{time:7,fret:15,width:4}]});
 if(kind==='mixed')return base({notes:[note({t:6,f:0,sus:1.8}),note({t:6.5,f:7,sus:1.7,sl:12}),note({t:7.2,f:12,sus:1.2,bn:2}),note({t:8.5,f:3,sus:1.5,slu:10}),note({t:10.5,f:5,pm:true,sus:.8}),note({t:11.5,f:8,sus:2.4,sl:3})],
 chords:[{t:6.25,id:0,notes:[{s:1,f:3,sus:.9},{s:2,f:5,sus:.9},{s:3,f:5,sus:.9}]},{t:9.5,id:1,notes:[{s:0,f:0,sus:1},{s:1,f:7,sus:1},{s:2,f:9,sus:1}]}],
 chordTemplates:[{name:'C5',frets:[-1,3,5,5,-1,-1],fingers:[-1,1,3,4,-1,-1]},{name:'Open',frets:[0,7,9,-1,-1,-1],fingers:[0,1,3,-1,-1,-1]}],anchors:[{time:0,fret:3,width:4},{time:7,fret:7,width:6},{time:8.5,fret:3,width:8}]});
 throw Error(kind);
};
const chart=file=>{const r=JSON.parse(fs.readFileSync(file,'utf8'));return base({...r,currentTime:0,chordTemplates:r.templates||r.chordTemplates||[],handShapes:r.handshapes||r.handShapes||[]});};
const cases=[];
for(const preset of ['straight','angled']){
 for(const fps of [10,20,60]){
 cases.push({name:`priority-${preset}-${fps}`,kind:'priority',preset,fps,b:fixture('priority'),start:6,end:6.7,focus:4});
 cases.push({name:`return-${preset}-${fps}`,kind:'return',preset,fps,b:fixture('return'),start:6,end:15,focus:4});
 }
 cases.push({name:`churn-${preset}`,kind:'churn',preset,fps:20,b:fixture('churn'),start:6,end:7.3,focus:4});
 cases.push({name:`churn-return-${preset}`,kind:'churn-return',preset,fps:20,b:fixture('churn-return'),start:6,end:9.1,focus:4});
 cases.push({name:`mixed-${preset}`,kind:'mixed',preset,fps:20,b:fixture('mixed'),start:6,end:14,captureTimes:[7,10]});
 cases.push({name:`controls-${preset}`,kind:'controls',preset,fps:20,b:fixture('return'),start:6,end:10,focus:4});
 cases.push({name:`rest-entry-${preset}`,kind:'rest-entry',preset,fps:20,b:fixture('rest-entry'),start:6,end:10.3,focus:4,viewport:{width:800,height:900},captureTimes:[9]});
 cases.push({name:`restrike-${preset}`,kind:'restrike',preset,fps:20,b:fixture('restrike'),start:6,end:8.5,focus:16,captureTimes:[8]});
 for(const viewport of [{width:800,height:900},{width:1920,height:720}])cases.push({name:`viewport-${preset}-${viewport.width}`,kind:'priority',preset,fps:20,b:fixture('priority'),start:6,end:6.7,focus:4,viewport});
 if(option('--six'))cases.push({name:`six-full-${preset}`,kind:'six',preset,fps:20,b:chart(option('--six')),start:0,end:212,captureTimes:[30.4,160.1],checkTimes:[30.4,160.1,199]});
 if(option('--airbourne'))cases.push({name:`airbourne-full-${preset}`,kind:'airbourne',preset,fps:20,b:chart(option('--airbourne')),start:0,end:229,captureTimes:[20,150]});
}
function validate(c,run){
 const samples=[run.first,...run.samples],prefix=c.name+': ';
 for(const s of samples){
 check(s.mode==='stable',prefix+'Stable mode inactive at '+s.time);
 check(pose(s).every(Number.isFinite),prefix+'nonfinite pose at '+s.time);
 check(maxDelta(s.quaternion,run.first.quaternion)<1e-8,prefix+'automatic viewing angle changed at '+s.time);
 check(Math.abs(s.fov-60)<1e-8,prefix+'FOV changed at '+s.time);
 const near=s.heads.filter(h=>h.dt>=0&&h.dt<=(c.kind==='rest-entry'?1.1:.25));
 check(near.every(h=>h.rect.minX>=-1.001&&h.rect.maxX<=1.001),prefix+'near note clipped horizontally at '+s.time);
 check(frettedHeads(s).every(h=>(h.rect.maxX-h.rect.minX)*run.viewport.width/2>=5),prefix+'imminent fretted gem narrower than 5 px at '+s.time);
 }
 if(c.kind==='priority'){
 check(Math.abs(run.first.state.x-run.controlWithoutFar.state.x)<.01,prefix+'adding distant geometry that fits displaces the current centre');
 check(Math.abs(run.first.focusScreen[0])<.12,prefix+'distant note displaces current note at opening ('+run.first.focusScreen[0]+')');
 check(Math.abs(run.first.state.x-run.first.focusWorldX)<.06,prefix+'initial centre follows distant extreme');
 check(Math.max(...samples.map(s=>Math.abs(s.focusScreen[0])))<.20,prefix+'current note leaves centre band while distant notes already fit');
 }
 if(c.kind==='churn'){
 const lo=Math.min(...samples.map(s=>s.state.x)),hi=Math.max(...samples.map(s=>s.state.x));
 check(hi-lo<.06,prefix+'distant churn changes current-note centre by '+(hi-lo));
 check(Math.max(...samples.map(s=>Math.abs(s.focusScreen[0])))<.22,prefix+'distant churn keeps current notes off centre');
 }
 if(c.kind==='return'){
 const settled=samples.filter(s=>s.time>=12);
 check(Math.max(...settled.map(s=>Math.abs(s.focusScreen[0])))<.08,prefix+'low passage does not recenter after higher passage');
 check(Math.abs(run.last.state.x-run.direct.state.x)<.025,prefix+'played/direct historical centre differs');
 }
 if(c.kind==='churn-return'){
 const settled=samples.filter(s=>s.time>=8.7);
 check(Math.max(...settled.map(s=>Math.abs(s.state.x-s.focusWorldX)))<.10,prefix+'changing distant notes prevent return to current low notes');
 check(Math.max(...settled.map(s=>Math.abs(s.focusScreen[0])))<.20,prefix+'low notes remain outside comfort band after transition');
 }
 if(c.kind==='rest-entry'){
 const rest=samples.filter(s=>s.time>=7&&s.time<=8.5);
 check(Math.max(...rest.map(s=>s.state.x))-Math.min(...rest.map(s=>s.state.x))<.001,prefix+'camera centre moves through empty rest');
 }
 if(c.kind==='restrike'){
 const settled=samples.filter(s=>s.time>=8);
 check(Math.max(...settled.map(s=>Math.abs(s.state.x-s.focusWorldX)))<.10,prefix+'old same-string sustain still pulls focus after a new attack');
 }
 if(c.kind==='controls'){
 check(maxDelta(pose(run.pause[0]),pose(run.pause[1]))<1e-9,prefix+'paused automatic camera moved');
 check(maxDelta([run.frozen[0].state.x,run.frozen[0].state.distance],[run.frozen[1].state.x,run.frozen[1].state.distance])<1e-9,prefix+'Follow off moved automatic camera');
 check(run.bridgePreserved,prefix+'manual control bridge reset');
 check(maxDelta(pose(run.offset),pose(run.frozen[1]))>.001,prefix+'manual offset did not apply while paused');
 check(maxDelta(pose(run.seek),pose(run.direct))<.003,prefix+'seek retains preceding manual/autocamera history');
 }
 if(c.kind==='six')for(const t of c.checkTimes){const s=samples.find(s=>Math.abs(s.time-t)<1e-7);check(!!s,prefix+'missing representative sample '+t);if(!s)continue;
 const n=s.next.find(n=>n.f>0);check(!!n,prefix+'missing imminent fretted note '+t);if(n)check(n.screen[0]>-.4,prefix+'imminent fret '+n.f+' remains left of 30% viewport at '+t+' ('+n.screen[0]+')');}
}

async function main(){
 assert.ok(!fs.existsSync(path.join(out,'results.json')),'Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
 const active=cases.filter(c=>selected(c.name));assert.ok(active.length,'No selected cases');
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});let served='';
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.__wall=1000;window.__realNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__wall});});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.origin!=='http://current-priority.test')return route.fulfill({status:403,body:'External network forbidden'});
 if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
 if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
 const f=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(f.startsWith(repo+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(f)});
 return route.fulfill({status:404,body:'Missing isolated fixture asset'});});
 async function load(input){served=instrument(input);await page.goto('http://current-priority.test/');
 await page.evaluate(()=>{
 window.capture=()=>{const a=r.__priorityAudit();a.cam.updateMatrixWorld();a.scene.updateMatrixWorld(true);const now=bundle.currentTime;
 const upcoming=window.chartEvents.filter(n=>n.t>=now-1e-7),t=upcoming[0]?.t;
 const next=upcoming.filter(n=>Math.abs(n.t-t)<1e-7).map(n=>({t:n.t,dt:n.t-now,f:n.f,s:n.s,screen:a.projectFret(n.f,n.s,n.t-now),playline:a.projectFret(n.f,n.s,0)}));
 return{time:now,mode:a.mode,state:a.state,position:a.cam.position.toArray(),quaternion:a.cam.quaternion.toArray(),fov:a.cam.fov,focusScreen:a.projectFret(window.focusFret||4),focusWorldX:a.fretWorldX(window.focusFret||4),heads:a.heads(),next,solves:window.__prioritySolves||[]};};
 window.step=(time,ms,playing=true)=>{window.__wall+=ms;bundle.currentTime=time;bundle.isPlaying=playing;window.__prioritySolves=[];r.draw(bundle);return capture();};
 window.renderNow=()=>{const a=r.__priorityAudit();a.ren.info.autoReset=false;a.ren.info.reset();window.__realRender(a.scene,a.cam);return{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,geometry:a.geometry()};};
 });}
 async function init(c,extra={}){
 const viewport=c.viewport||{width:1280,height:720};await page.setViewportSize(viewport);
 return page.evaluate(async({c,extra})=>{if(window.r)r.destroy();window.__wall=1000;localStorage.clear();window.__h3dCamCtl=extra.bridge||null;
 const settings={cameraMode:'stable',stableCameraPreset:c.preset,stableCameraFollow:true,cameraSmoothing:.5,zoomSmoothing:.5,tiltSmoothing:.5,cameraLockLow:false,
 style:'off',notationStyle:'rsplus',glow:0,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false};
 for(const[k,v]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const set=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(set)set(v);}
 window.bundle={...c.b,...extra.bundle};window.focusFret=c.focus||4;
 window.chartEvents=[...bundle.notes,...bundle.chords.flatMap(c=>(c.notes||[]).map(n=>({...n,t:c.t})))].sort((a,b)=>a.t-b.t);
 window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;const a=r.__priorityAudit();window.__realRender=a.ren.render.bind(a.ren);a.ren.render=()=>{};
 return step(bundle.currentTime,0,bundle.isPlaying);
 },{c,extra});}
 async function advance(start,end,fps){return page.evaluate(({start,end,fps})=>{const samples=[];for(let i=1;i<=Math.round((end-start)*fps);i++)samples.push(step(start+i/fps,1000/fps));return samples;},{start,end,fps});}
 async function snapshot(name){const stats=await page.evaluate(()=>renderNow());if(name)await page.screenshot({path:path.join(out,name+'.png')});return{...stats,geometryHash:hash(JSON.stringify(stats.geometry)),geometry:undefined};}
 await load(source);
 for(const c of active){
 const first=await init(c),samples=[],captures=[];let start=c.start;
 const stops=[...new Set([...(c.captureTimes||[]),...Array.from({length:Math.floor((c.end-c.start)/10)},(_,i)=>c.start+(i+1)*10),c.end])].filter(t=>t>c.start&&t<=c.end).sort((a,b)=>a-b);
 for(const end of stops){samples.push(...await advance(start,end,c.fps));start=end;if(c.captureTimes?.includes(end))captures.push({time:end,...await snapshot(c.name+'-'+end)});}
 const last=samples.at(-1)||first;let extras={};
 if(c.kind==='controls'){
 extras=await page.evaluate(()=>{const pause=[step(bundle.currentTime,0,false)];for(let i=0;i<60;i++)step(bundle.currentTime,50,false);pause.push(capture());h3dBgSetStableCameraFollow(false);
 const frozen=[step(bundle.currentTime,0,true)];for(let i=0;i<60;i++)step(11+i*.05,50,true);frozen.push(capture());
 const bridge={enabled:true,distMul:1.1,heightMul:1.05,yaw:.08,pitch:4,panX:2,panY:1};window.__h3dCamCtl={...bridge};const offset=step(bundle.currentTime,50,false);h3dBgSetStableCameraFollow(true);const seek=step(17,50,false);
 return{pause,frozen,bridge,offset,seek,bridgePreserved:JSON.stringify(bridge)===JSON.stringify(window.__h3dCamCtl)};});
 extras.direct=await init(c,{bundle:{currentTime:17,isPlaying:false},bridge:extras.bridge});
 }else if(c.kind==='return')extras.direct=await init(c,{bundle:{currentTime:c.end,isPlaying:false}});
 else if(c.kind==='priority')extras.controlWithoutFar=await init(c,{bundle:{notes:c.b.notes.filter(n=>n.t<8.8)}});
 const run={viewport:c.viewport||{width:1280,height:720},first,samples,last,captures,...extras};validate(c,run);
 const filename=c.name+'.json';fs.writeFileSync(path.join(out,filename),JSON.stringify(run));
 const width=samples.flatMap(s=>frettedHeads(s).map(h=>(h.rect.maxX-h.rect.minX)*run.viewport.width/2));
 results.push({name:c.name,kind:c.kind,preset:c.preset,fps:c.fps,start:c.start,end:c.end,frames:samples.length+1,viewport:run.viewport,minimumIncomingFrettedGemPixels:width.length?Math.min(...width):null,file:filename,failures:failures.filter(f=>f.startsWith(c.name+':'))});
 console.log(c.name+': '+(samples.length+1)+' frames, '+results.at(-1).failures.length+' failures');
 }
 if(args.includes('--perf')){
 const c={preset:'straight',b:base({currentTime:1000,notes:Array.from({length:50000},(_,i)=>note({t:i*.04,f:2+i%18,s:i%6,sus:i%2?.12:.3,sl:i%8===0?20:-1}))}),focus:8};
 const timings=[];for(let round=0;round<3;round++)for(const[label,input]of(round%2?[['candidate',source],['baseline',baseline]]:[['baseline',baseline],['candidate',source]])){
 if(!input)continue;await load(input);await init(c);const timing=await page.evaluate(()=>r.__priorityBenchmark(bundle,200));timings.push({round,label,...timing});}
 const candidate=timings.filter(t=>t.label==='candidate');check(candidate.every(t=>t.mean<3),'camera-cpu-cost: mean camera update exceeds 3 ms in dense 50k-note chart');results.push({name:'camera-cpu-cost',timings});
 }
 }finally{await browser.close();}
 check(errors.length===0,'Browser errors: '+errors.join('\n'));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceHash:hash(source),sourceRef:option('--source-ref'),compareRef,baselineHash:baseline?hash(baseline):null,reference:args.includes('--reference'),
 method:'Every-frame production geometry/camera at deterministic simulated FPS. Actual GPU submissions only for captures. CPU benchmark uses real wall clock. No live app/profile/network writes.',failures,errors,results},null,2));
 console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));if(failures.length&&!args.includes('--reference'))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
