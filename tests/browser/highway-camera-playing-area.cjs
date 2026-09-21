#!/usr/bin/env node
'use strict';

// Isolated production-renderer acceptance for stable playing-area framing.
// No live app/profile/library writes. GPU submissions for named captures or --motion.
// --repo <checkout> --out <fresh-dir> --six <private compact chart>
// --airbourne <private compact chart> --compare-ref <ref> --perf
// --case <comma-separated name fragments> --reference (report expected old failures)
// --source-ref <ref> or --source-file <snapshot> reads a renderer instead of the working source.
// --motion records every submitted frame at wall-clock playback speed (use --case).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const repo=path.resolve(option('--repo',path.join(__dirname,'../..'))),out=path.resolve(option('--out',path.join(repo,'test-results/camera-playing-area')));
const normalize=s=>s.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const gitSource=ref=>normalize(execFileSync('git',['-c','safe.directory='+repo,'-C',repo,'show',ref+':plugins/highway_3d/screen.js'],{encoding:'utf8',maxBuffer:8*1024*1024}));
const sourcePath=path.join(repo,'plugins/highway_3d/screen.js'),source=option('--source-file')?normalize(fs.readFileSync(option('--source-file'),'utf8')):option('--source-ref')?gitSource(option('--source-ref')):normalize(fs.readFileSync(sourcePath,'utf8'));
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
 return once(result,"contextType: 'webgl2',",`__priorityAudit(){return {ren,scene,cam,mode:cameraMode,frameTime:_frameNow,constants:{K,TS,AHEAD},
 state:Object.fromEntries(Object.entries(_stableCam).filter(([k,v])=>v===null||['number','string','boolean'].includes(typeof v))),
 projectFret(f,s=2,dt=0){return new T.Vector3(xFretMid(f),sY(s),dZ(dt)).project(cam).toArray();},
 fretWorldX(f){return xFretMid(f);},
 region(bundle){const r=typeof stablePlayingRegion==='function'?stablePlayingRegion(bundle,_frameNow):null;
 const a=getChartAnchorAt(bundle.anchors,_frameNow),bounds=a?laneBoundsFromAnchor(a):null;
 const expected=bounds?{minX:Math.min(xFret(bounds.dMin),xFret(bounds.dMax)),maxX:Math.max(xFret(bounds.dMin),xFret(bounds.dMax)),dMin:bounds.dMin,dMax:bounds.dMax}:null;
 if(expected)expected.x=(expected.minX+expected.maxX)/2;
 const floor=[];pLane.forEachActive(m=>{if(!m.visible)return;m.updateMatrixWorld(true);const b=new T.Box3().setFromObject(m);if(b.max.z>=-.02*K)floor.push([b.min.x,b.max.x,b.min.z,b.max.z]);});
 const gold=[];for(let f=1;f<_incomingFixedFretLabels.length;f++){const m=_incomingFixedFretLabels[f];if(m?.visible&&m.material?.opacity===1){const rect={};if(_incomingLabelScreenRect(m,rect,true))gold.push({f,rect});}}
 const rr=r?Object.fromEntries(Object.entries(r).filter(([k,v])=>v===null||['number','string','boolean'].includes(typeof v))):null;
 return{resolved:rr,expected,floor:floor.length?{minX:Math.min(...floor.map(v=>v[0])),maxX:Math.max(...floor.map(v=>v[1]))}:null,gold};},
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
const fixedNotes=()=>Array.from({length:48},(_,i)=>note({t:6+i*.125,f:i%3===0?0:2+i%4,s:i%6,sus:.08}));
const fixture=kind=>{
 const stable=base({notes:fixedNotes()});
 if(['fixed','controls'].includes(kind))return stable;
 if(kind==='invalidation')return {...stable,anchors:[{time:0,fret:2,width:4},{time:5,fret:2,width:4}]};
 if(kind==='duplicates')return {...stable,anchors:Array.from({length:60},(_,i)=>({time:i*.2,fret:2,width:4}))};
 if(kind==='quantized')return base({notes:[],anchors:[{time:0,fret:2,width:4},{time:8.025,fret:10,width:4}]});
 if(kind==='rest')return base({notes:[note({t:6,f:2,sus:.1}),note({t:19,f:10})],anchors:[{time:0,fret:2,width:4},{time:8,fret:10,width:4}]});
 if(kind==='width')return base({notes:[],anchors:[{time:0,fret:2,width:4},{time:8,fret:2,width:8}]});
 if(kind==='rapid')return base({notes:[],anchors:[{time:0,fret:2,width:4},...Array.from({length:20},(_,i)=>({time:7+i*.1,fret:i%2?2:3,width:4})),{time:9,fret:2,width:4}]});
 if(kind==='disjoint')return base({notes:[],anchors:[{time:0,fret:2,width:4},{time:8,fret:16,width:4}]});
 if(kind==='missing')return {...stable,anchors:[]};
 if(kind==='malformed')return {...stable,anchors:[{time:0,fret:-3,width:4},{time:7,fret:4,width:-1}]};
 if(kind==='placeholder')return {...stable,anchors:[{time:0,fret:1,width:24}]};
 if(kind==='mismatch')return base({notes:Array.from({length:28},(_,i)=>note({t:6+i*.2,f:14+i%3})),anchors:[{time:0,fret:2,width:4}]});
 if(kind==='fallback-wide-release')return base({notes:[note({t:6,f:2,sus:1,s:2}),note({t:6,f:17,sus:1,s:3}),...Array.from({length:30},(_,i)=>note({t:8+i*.12,f:2+i%3,s:i%6,sus:.05}))],anchors:[]});
 if(kind==='wide')return base({notes:Array.from({length:30},(_,i)=>note({t:6+i*.2,f:i%2?19:7,s:i%6})),anchors:[{time:0,fret:7,width:13}]});
 if(kind==='sustain')return base({notes:[note({t:6,f:3,s:3,sus:6}),note({t:8,f:16,s:2,sus:3}),note({t:12.5,f:16,s:2})],anchors:[{time:0,fret:2,width:4},{time:8,fret:15,width:4}]});
 if(kind==='parity')return base({notes:[note({t:7,f:2,s:3,sus:1,sl:5}),note({t:9,f:4,s:2,sus:1,bn:2})],chords:[{t:6,id:0,notes:[{s:0,f:2,sus:2},{s:1,f:4,sus:2},{s:2,f:5,sus:2}]}],chordTemplates:[{name:'Shape',frets:[2,4,5,-1,-1,-1],fingers:[1,3,4,-1,-1,-1]}]});
 if(kind==='slides')return base({notes:[note({t:6,f:2,sl:5,sus:1}),note({t:7.3,f:5,sl:2,sus:1}),note({t:8.6,f:2,bn:2,sus:1}),note({t:10,f:5,sl:15,sus:1.5})]});
 throw Error(kind);
};
const chart=file=>{const r=JSON.parse(fs.readFileSync(file,'utf8'));return base({...r,currentTime:0,chordTemplates:r.templates||r.chordTemplates||[],handShapes:r.handshapes||r.handShapes||[]});};
const cases=[];
for(const preset of ['straight','angled']){
 cases.push({name:`quantized-${preset}`,kind:'quantized',preset,fps:60,b:fixture('quantized'),start:6,end:10});
 for(const fps of [10,20,60,120])cases.push({name:`fixed-${preset}-${fps}`,kind:'fixed',preset,fps,b:fixture('fixed'),start:6,end:12,captureTimes:fps===20?[9]:[]});
 for(const kind of ['duplicates','rest','width','rapid','disjoint','missing','malformed','placeholder','mismatch','wide','sustain','slides','controls','invalidation','fallback-wide-release','parity'])cases.push({name:`${kind}-${preset}`,kind,preset,fps:20,b:fixture(kind),start:6,end:kind==='rest'?18:kind==='sustain'?13:12,captureTimes:kind==='parity'?[7.5,9.5]:kind==='slides'?[7,11]:['rest','wide','sustain','missing','placeholder'].includes(kind)?[9]:[]});
 for(const viewport of [{width:800,height:900},{width:1920,height:720}])cases.push({name:`rest-${preset}-${viewport.width}`,kind:'rest',preset,fps:20,b:fixture('rest'),start:6,end:11,viewport,captureTimes:[9]});
 for(const rate of [.5,1.5])cases.push({name:`fixed-${preset}-rate${rate}`,kind:'fixed',preset,fps:20,b:{...fixture('fixed'),playbackRate:rate},start:6,end:12});
 for(const stringCount of [4,7])cases.push({name:`fixed-${preset}-strings${stringCount}-lefty`,kind:'fixed',preset,fps:20,b:{...fixture('fixed'),lefty:true,stringCount,tuning:Array(stringCount).fill(0),notes:fixedNotes().map(n=>({...n,s:n.s%stringCount}))},start:6,end:12});
 if(option('--six')){
 cases.push({name:`six-full-${preset}`,kind:'six',preset,fps:20,b:chart(option('--six')),start:0,end:212,captureTimes:[104,109.75,119,160.1],checkTimes:[30.4,160.1,199]});
 cases.push({name:`six-motion-${preset}`,kind:'six-motion',preset,fps:20,b:chart(option('--six')),start:101,end:111,captureTimes:[104,109.75]});
 cases.push({name:`six-shifts-${preset}`,kind:'six-shifts',preset,fps:20,b:chart(option('--six')),start:140,end:150,captureTimes:[142,148.5]});
 }
 if(option('--airbourne'))cases.push({name:`airbourne-full-${preset}`,kind:'airbourne',preset,fps:20,b:chart(option('--airbourne')),start:0,end:229,captureTimes:[20,150]});
 for(const [key,start,end,times] of [['bonjovi',28,48,[31,39,40]],['amon',90,100,[92,93]],['extreme',308,330,[313,318,322]],['dragonforce',114,145,[117,142.5]]])if(option('--'+key))cases.push({name:`${key}-selection-${preset}`,kind:key,preset,fps:20,b:chart(option('--'+key)),start,end,captureTimes:times});
}
const range=values=>values.length?Math.max(...values)-Math.min(...values):0;
const reversals=values=>{let prev=0,count=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];if(Math.abs(d)<1e-5)continue;const sign=Math.sign(d);if(prev&&sign!==prev)count++;prev=sign;}return count;};
function validate(c,run){
 const samples=[run.first,...run.samples],prefix=c.name+': ';
 for(const s of samples){
 check(s.mode==='stable',prefix+'Stable mode inactive at '+s.time);
 check(pose(s).every(Number.isFinite),prefix+'nonfinite pose at '+s.time);
 check(maxDelta(s.quaternion,run.first.quaternion)<1e-8,prefix+'automatic viewing angle changed at '+s.time);
 check(Math.abs(s.fov-60)<1e-8,prefix+'FOV changed at '+s.time);
 const near=s.heads.filter(h=>h.dt>=0&&h.dt<=.25);
 check(near.every(h=>h.rect.minX>=-1.001&&h.rect.maxX<=1.001),prefix+'near note clipped horizontally at '+s.time);
 const rg=s.region?.resolved;
 if(rg&&s.region.floor){check(Math.abs(rg.minX-s.region.floor.minX)<.01&&Math.abs(rg.maxX-s.region.floor.maxX)<.01,prefix+'near lane differs from effective region at '+s.time);}
 if(c.kind!=='controls'&&s.region?.gold?.length)check(s.region.gold.every(g=>g.rect.minX>=-1.01&&g.rect.maxX<=1.01&&g.rect.minY>=-1.01&&g.rect.maxY<=1.01),prefix+'current gold label clipped at '+s.time);
 }
 const settled=samples.filter(s=>s.time>=7);
 if(c.kind==='quantized')check(samples.every(s=>Math.abs(s.state.focusX-s.region.resolved.x)<1e-8),prefix+'camera and visible playing-area clocks diverge');
 if(['fixed','duplicates'].includes(c.kind)){
 check(range(settled.map(s=>s.state.focusX))<1e-8,prefix+'attacks move preferred target inside fixed region');
 check(range(settled.map(s=>s.state.x))<.002,prefix+'camera pans inside unchanged region');
 check(reversals(settled.map(s=>s.state.x))===0,prefix+'lateral reversals inside unchanged region');
 check(settled.every(s=>Math.abs(s.state.focusX-s.region.expected.x)<.002),prefix+'target does not match outer-wire region midpoint');
 check(range(settled.map(s=>s.state.distance))<.05,prefix+'ordinary in-region notes pulse zoom');
 }
 if(['missing','malformed','placeholder'].includes(c.kind)){
 check(settled.every(s=>s.region.resolved?.source&&s.region.resolved?.source!=='authored'),prefix+'invalid/missing anchors did not use fallback');
 check(range(settled.map(s=>s.state.focusX))<.01,prefix+'fallback chases alternating attacks');
 check(settled.every(s=>s.region.floor&&s.region.gold.length>=4),prefix+'fallback lacks matching floor/gold numbers');
 }
 if(['rest','disjoint','width'].includes(c.kind)){
 const pre=samples.filter(s=>s.time<8),after=samples.filter(s=>s.time>=9.1);
 check(range(pre.map(s=>s.state.x))<.001,prefix+'camera moves toward future region before boundary');
 check(after.length&&after.every(s=>Math.abs(s.state.x-s.region.expected.x)<.10),prefix+'camera does not settle on new region during rest');
 check(Math.abs(run.last.state.x-run.first.state.x)>.1,prefix+'region change ignored without notes');
 }
 if(c.kind==='rapid')check(range(samples.map(s=>s.state.x))<.15,prefix+'brief overlapping lane changes cause unnecessary pan');
 if(c.kind==='fallback-wide-release')check(samples.filter(s=>s.time>=10).every(s=>s.region.resolved?.dMax-s.region.resolved?.dMin<=5),prefix+'temporary wide fallback never contracts for later compact playing');
 if(c.kind==='wide')check(samples.every(s=>s.region.resolved?.dMax-s.region.resolved?.dMin>=13),prefix+'genuine wide anchor discarded');
 if(c.kind==='mismatch')check(samples.filter(s=>s.time>=9).every(s=>s.region.resolved?.dMin>=10),prefix+'persistent authored mismatch did not find local region');
 if(c.kind==='slides')check(range(samples.filter(s=>s.time<9.8).map(s=>s.state.focusX))<.001,prefix+'in-region slides or bends move preferred centre');
 if(c.kind==='sustain'){
 check(samples.filter(s=>s.time>=9.1).every(s=>Math.abs(s.state.focusX-s.region.expected.x)<.001),prefix+'old sustain owns preferred centre after region change');
 check(samples.filter(s=>s.time<12).every(s=>s.liveHolds.filter(n=>n.f===3).every(n=>Math.abs(n.screen[0])<1&&Math.abs(n.screen[1])<1)),prefix+'ongoing old-position sustain is clipped');
 }
 if(c.kind==='invalidation'){
 check(run.anchorReplacement.region.resolved?.dMin===11,prefix+'anchor-only array replacement cache remained stale');
 check(run.anchorReplacement.region.gold.map(g=>g.f).join(',')==='12,13,14,15',prefix+'gold labels ignored anchor-only replacement');
 check(run.newChart.region.resolved?.dMin<=4&&run.newChart.region.resolved?.dMax>=7,prefix+'replacement notes/anchors did not rebuild inferred region');
 }
 if(c.kind==='controls'){
 check(maxDelta(pose(run.pause[0]),pose(run.pause[1]))<1e-9,prefix+'paused automatic camera moved');
 check(maxDelta([run.frozen[0].state.x,run.frozen[0].state.distance],[run.frozen[1].state.x,run.frozen[1].state.distance])<1e-9,prefix+'Follow off moved automatic camera');
 check(run.bridgePreserved,prefix+'manual control bridge reset');
 check(maxDelta(pose(run.offset),pose(run.frozen[1]))>.001,prefix+'manual offset did not apply while paused');
 check(maxDelta(pose(run.seek),pose(run.direct))<.003,prefix+'seek retains preceding manual/autocamera history');
 }
 if(c.kind==='six'){
 const fixed=samples.filter(s=>s.time>=101.5&&s.time<=107.4),rest=samples.filter(s=>s.time>=109.8&&s.time<=118.5);
 check(range(fixed.map(s=>s.state.focusX))<.001,prefix+'Six unchanged 2-5 region has moving preferred target');
 check(reversals(fixed.map(s=>s.state.x))===0,prefix+'Six unchanged 2-5 region has camera reversals');
 check(rest.length&&rest.every(s=>Math.abs(s.state.x-s.region.expected.x)<.10),prefix+'Six empty 10-13 region is not centred before next attack');
 }
}

async function main(){
 assert.ok(!fs.existsSync(path.join(out,'results.json')),'Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
 const active=cases.filter(c=>selected(c.name));assert.ok(active.length,'No selected cases');
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});let served='';
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1,...(args.includes('--motion')?{recordVideo:{dir:path.join(out,'motion'),size:{width:1280,height:720}}}:{})});
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.addInitScript(()=>{window.__wall=1000;window.__realNow=performance.now.bind(performance);Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__wall});});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());
 if(u.origin!=='http://playing-area.test')return route.fulfill({status:403,body:'External network forbidden'});
 if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
 if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
 const f=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(f.startsWith(repo+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(f)});
 return route.fulfill({status:404,body:'Missing isolated fixture asset'});});
 async function load(input){served=instrument(input);await page.goto('http://playing-area.test/');
 await page.evaluate(()=>{
 window.capture=()=>{const a=r.__priorityAudit();a.cam.updateMatrixWorld();a.scene.updateMatrixWorld(true);const now=bundle.currentTime;
 const upcoming=window.chartEvents.filter(n=>n.t>=now-1e-7),t=upcoming[0]?.t;
 const next=upcoming.filter(n=>Math.abs(n.t-t)<1e-7).map(n=>({t:n.t,dt:n.t-now,f:n.f,s:n.s,screen:a.projectFret(n.f,n.s,n.t-now),playline:a.projectFret(n.f,n.s,0)}));
 return{time:now,frameTime:a.frameTime,mode:a.mode,state:a.state,position:a.cam.position.toArray(),quaternion:a.cam.quaternion.toArray(),fov:a.cam.fov,focusScreen:a.projectFret(window.focusFret||4),focusWorldX:a.fretWorldX(window.focusFret||4),region:a.region(bundle),liveHolds:window.chartEvents.filter(n=>n.sus>0&&n.t<=now&&n.t+n.sus>now&&n.f>0).map(n=>({f:n.f,s:n.s,screen:a.projectFret(n.f,n.s,0)})),heads:a.heads(),next,solves:window.__prioritySolves||[]};};
 window.step=(time,ms,playing=true)=>{window.__wall+=ms;bundle.currentTime=time;bundle.isPlaying=playing;window.__prioritySolves=[];r.draw(bundle);return capture();};
 window.renderNow=()=>{const a=r.__priorityAudit();a.ren.info.autoReset=false;a.ren.info.reset();window.__realRender(a.scene,a.cam);return{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,geometry:a.geometry()};};
 });}
 async function init(c,extra={}){
 const viewport=c.viewport||{width:1280,height:720};await page.setViewportSize(viewport);
 return page.evaluate(async({c,extra})=>{if(window.r)r.destroy();window.__wall=1000;localStorage.clear();window.__h3dCamCtl=extra.bridge||null;
 const settings={cameraMode:'stable',stableCameraPreset:c.preset,stableCameraFollow:true,cameraSmoothing:.5,zoomSmoothing:.5,tiltSmoothing:.5,cameraLockLow:false,
 style:'off',notationStyle:'rsplus',glow:0,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false};
 for(const[k,v]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const set=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(set)set(v);}
 window.bundle={...c.b,currentTime:c.start??c.b.currentTime,...extra.bundle};window.focusFret=c.focus||4;
 window.chartEvents=[...bundle.notes,...bundle.chords.flatMap(c=>(c.notes||[]).map(n=>({...n,t:c.t})))].sort((a,b)=>a.t-b.t);
 window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;const a=r.__priorityAudit();window.__realRender=a.ren.render.bind(a.ren);a.ren.render=()=>{};
 return step(bundle.currentTime,0,bundle.isPlaying);
 },{c,extra});}
 async function advance(start,end,fps,rate=1,quantized=false){return page.evaluate(async({start,end,fps,rate,motion,quantized})=>{const samples=[],frames=Math.round((end-start)*fps/rate),t0=window.__realNow();for(let i=1;i<=frames;i++){const time=start+(end-start)*i/frames;samples.push(step(quantized?Math.floor((time+1e-8)*10)/10:time,1000/fps));if(motion){renderNow();await new Promise(resolve=>setTimeout(resolve,Math.max(0,t0+i*1000/fps-window.__realNow())));}}return samples;},{start,end,fps,rate,quantized,motion:args.includes('--motion')});}
 async function snapshot(name){const stats=await page.evaluate(()=>renderNow());if(name)await page.screenshot({path:path.join(out,name+'.png')});return{...stats,geometryHash:hash(JSON.stringify(stats.geometry)),geometry:undefined};}
 await load(source);
 for(const c of active){
 const first=await init(c),samples=[],captures=[];if(args.includes('--motion'))await snapshot();let start=c.start;
 const stops=[...new Set([...(c.captureTimes||[]),...Array.from({length:Math.floor((c.end-c.start)/10)},(_,i)=>c.start+(i+1)*10),c.end])].filter(t=>t>c.start&&t<=c.end).sort((a,b)=>a-b);
 for(const end of stops){samples.push(...await advance(start,end,c.fps,c.b.playbackRate||1,c.kind==='quantized'));start=end;if(c.captureTimes?.includes(end))captures.push({time:end,...await snapshot(c.name+'-'+end)});}
 const last=samples.at(-1)||first;let extras={};
 if(c.kind==='invalidation')extras=await page.evaluate(()=>{
 bundle.anchors=[{time:0,fret:2,width:4},{time:bundle.currentTime,fret:12,width:4}];const anchorReplacement=step(bundle.currentTime,50,false);
 bundle.notes=[{t:12,s:2,f:4,sus:2},{t:12,s:3,f:7,sus:2}];bundle.chords=[];bundle.anchors=[];const newChart=step(bundle.currentTime,50,false);return{anchorReplacement,newChart};
 });
 if(c.kind==='controls'){
 extras=await page.evaluate(()=>{const pause=[step(bundle.currentTime,0,false)];for(let i=0;i<60;i++)step(bundle.currentTime,50,false);pause.push(capture());h3dBgSetStableCameraFollow(false);
 const frozen=[step(bundle.currentTime,0,true)];for(let i=0;i<60;i++)step(11+i*.05,50,true);frozen.push(capture());
 const bridge={enabled:true,distMul:1.1,heightMul:1.05,yaw:.08,pitch:4,panX:2,panY:1};window.__h3dCamCtl={...bridge};const offset=step(bundle.currentTime,50,false);h3dBgSetStableCameraFollow(true);const seek=step(17,50,false);
 return{pause,frozen,bridge,offset,seek,bridgePreserved:JSON.stringify(bridge)===JSON.stringify(window.__h3dCamCtl)};});
 extras.direct=await init(c,{bundle:{currentTime:17,isPlaying:false},bridge:extras.bridge});
 }
 const run={viewport:c.viewport||{width:1280,height:720},first,samples,last,captures,...extras};validate(c,run);
 const filename=c.name+'.json';fs.writeFileSync(path.join(out,filename),JSON.stringify(run));
 const width=samples.flatMap(s=>frettedHeads(s).map(h=>(h.rect.maxX-h.rect.minX)*run.viewport.width/2));
 results.push({name:c.name,kind:c.kind,preset:c.preset,fps:c.fps,rate:c.b.playbackRate||1,start:c.start,end:c.end,travel:samples.reduce((v,s,i)=>v+(i?Math.abs(s.state.x-samples[i-1].state.x):0),0),reversals:reversals(samples.map(s=>s.state.x)),zoomRange:range(samples.map(s=>s.state.distance)),frames:samples.length+1,viewport:run.viewport,minimumIncomingFrettedGemPixels:width.length?Math.min(...width):null,file:filename,failures:failures.filter(f=>f.startsWith(c.name+':'))});
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
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceHash:hash(source),sourceRef:option('--source-ref'),sourceFile:option('--source-file'),compareRef,baselineHash:baseline?hash(baseline):null,reference:args.includes('--reference'),
 method:'Every-frame production geometry/camera at deterministic simulated FPS. Actual GPU submissions '+(args.includes('--motion')?'for every frame, paced to wall clock and recorded to WebM':'only for captures')+'. CPU benchmark uses real wall clock. No live app/profile/network writes.',failures,errors,results},null,2));
 console.log(JSON.stringify({out,cases:results.length,failureCount:failures.length,failures:failures.slice(0,20),errors},null,2));if(failures.length&&!args.includes('--reference'))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
