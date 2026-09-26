// Actual-WebGL trail attachment regression; instruments only the served in-memory source.
// Does not launch the game, read a song library, or edit checkout files.
'use strict';
// PLAYWRIGHT_MODULE selects an installed Playwright package.
// --quick: focused regression; default: family/layout matrix + lifecycle/chords.
// --source <file> / --ref <git ref>: capture a pre-fix renderer for comparison.
// --cases <json> --diagnose: explicit fixtures with actual-pixel overlap checks.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args=process.argv.slice(2),opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const repo=path.resolve(opt('--repo',path.join(__dirname,'../..')));
const ref=opt('--ref',null),out=opt('--out',path.join(repo,'test-results/trail-attachments'));
if(fs.existsSync(path.join(out,'results.json')))throw Error('Refusing to overwrite evidence');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'harness-used.cjs'),fs.readFileSync(__filename));
const source=opt('--source')?fs.readFileSync(opt('--source'),'utf8'):ref?cp.execFileSync('git',['-C',repo,'show',ref+':plugins/highway_3d/screen.js'],{encoding:'utf8',maxBuffer:8e6}):fs.readFileSync(path.join(repo,'plugins/highway_3d/screen.js'),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const drawStart=source.indexOf('        function drawNote('),drawEnd=source.indexOf('        function drawRsPlusChordFrame(',drawStart);
const sites=[];
const failures=[];
let served=source.replace(/\b(p[A-Z]\w*)\.get\(\)/g,(match,pool,offset)=>{
  const line=source.slice(0,offset).split('\n').length;
  const prefix=source.slice(source.lastIndexOf('\n',offset)+1,offset);
  const role=prefix.match(/(?:const|let)\s+(\w+)\s*=\s*$/)?.[1]||pool;
  const inNote=offset>drawStart&&offset<drawEnd;
  sites.push({line,pool,role,inNote});
  return `(window.__auditTake?window.__auditTake(${match},${JSON.stringify({line,pool,role})},${inNote?'{note:{...n},sourceFret:sourceNote.f,emission:window.__auditEmission,dt,fromChord,explicitLinkTarget,skipBody}':'null'}):${match})`;
});
served=served.replace(/(function drawNote\([^)]*\) \{)/, '$1\nwindow.__auditEmission=(window.__auditEmission||0)+1;');
served=served.replace("contextType: 'webgl2',",`__audit(){return {ren,scene,cam,settings:{...trailYieldSettings},style:rsPlusNotation?'rsplus':'current',
  gems:_trailOrderGems.slice(0,_trailOrderGemCount),strands:_trailOrderStrands.slice(0,_trailOrderStrandCount),
  sources:_trailOcclusionSources.slice(0,_trailOcclusionSourceCount),frame:_trailYieldFrameId,
  events:_trailYieldEventsByFret.flat().filter(Boolean),previews:projMeshArr.flat().filter(m=>m.visible)};},__auditUpdate(b){update(b);},contextType:'webgl2',`);
served=served.replace('            trailOcclusionFinalizeFrame();',`if(window.__auditTake)window.__beforeFinal=[];
  if(window.__auditTake)noteG.traverse(m=>{if(m.visible&&m.material)window.__beforeFinal.push([m.id,m.renderOrder]);});
  const auditStart=window.__perfTimings?performance.now():0;
  trailOcclusionFinalizeFrame();
  if(window.__perfTimings)window.__perfTimings.push(performance.now()-auditStart);`);
fs.writeFileSync(path.join(out,'instrumentation-sites.json'),JSON.stringify(sites,null,2));
const member=n=>({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,slp:false,plk:false,...n});
const base=()=>({currentTime:10.6,isPlaying:false,notes:[],chords:[],chordTemplates:[],anchors:[{time:0,fret:3,width:6}],handShapes:[],beats:[],sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false});
const flags=[['plain',{}],['pm',{pm:true}],['fhm',{fhm:true}],['mt',{mt:true}],['ho',{ho:true}],['po',{po:true}],['tap',{tp:true}],['slap',{slp:true}],['pop',{plk:true}],['slap-pop',{slp:true,plk:true}],['harmonic',{hm:true}],['pinch',{hp:true}],['compound',{pm:true,ho:true,hp:true,slp:true}],['accent',{ac:true,pm:true}],['ghost',{ghost:true,pm:true}],['open',{f:0,pm:true}],['open-ghost',{f:0,ghost:true,pm:true}],['unpitched',{f:127,mt:true}],['bend',{bn:2,sus:1.2}],['fractional-bend',{bn:.5,sus:1.2}],['prebend-release',{bn:2,bt:1,sus:1.2,bnv:[{t:0,v:2},{t:.5,v:2},{t:1.2,v:0}]}],['curve-only',{bn:0,sus:1.2,bnv:[{t:0,v:0},{t:.8,v:1}]}],['slide',{sl:8,sus:1.2}],['unpitched-slide',{slu:8,sus:1.2}],['legacy-slide-out',{slide_out:'up'}],['slide-out',{sus:1.2,slide_out_marks:[{start:.3,end:1,direction:'up'}]}],['slide-in',{slide_in_marks:[{time:0,direction:'up'}]}],['vibrato',{vb:true,sus:1.2}],['tremolo',{tr:true,sus:1.2}],['target-trail',{pm:true,sus:1.2}],['hit',{pm:true,ac:true,_verdict:'hit'}],['miss',{pm:true,ac:true,_verdict:'miss'}]];
function fixture(name,flag={}){
 const b=base();b.notes=[member({t:10.1,s:0,f:5,sus:2.6}),member({t:10.8,s:1,f:5,_case:name,...flag}),member({t:11.3,s:2,f:5,sus:.7,hp:true})];
 return b;
}
function chordFixture(kind){
 const b=base();b.chordTemplates=[{name:'A barre',frets:[-1,5,5,7,-1,-1],fingers:[-1,1,1,3,-1,-1]}];
 b.notes=[member({t:10.1,s:0,f:5,sus:2.6})];
 let ns=[member({s:1,f:5}),member({s:2,f:5}),member({s:3,f:7})];
 if(kind.includes('open'))ns[1].f=0;
 if(kind.includes('pm'))ns=ns.map(n=>({...n,pm:true}));
 if(kind.includes('fh'))ns=ns.map(n=>({...n,fhm:true}));
 if(kind.includes('retained'))ns=ns.map(n=>({...n,sus:1.1,vb:true,pm:true}));
 if(kind.includes('hold'))ns=ns.map(n=>({...n,sus:1.1}));
 if(kind.includes('mixed'))ns[0].ho=true;
 if(kind.includes('repeat'))b.chords.push({t:10.5,id:0,notes:ns.map(n=>({...n}))});
 b.chords.push({t:10.8,id:0,hd:kind.includes('repeat'),notes:ns});
 if(kind.includes('arp'))b.handShapes=[{chord_id:0,start_time:10.8,end_time:12.3,arpeggio:true}];
 return b;
}

// Enumerate actual creation sites independently of what the renderer registered.
const attachedRoles=new Set(['face','_pmMark','tri','chevron','attackMark','harmMark','l','arrow']);
function validateCapture(name,p){
 const check=(ok,msg)=>{if(!ok)failures.push(name+': '+msg);};
 check(p.sourceUnchanged,'renderer mutated authored fixture data');
 for(const id of p.attachments){
  const row=p.rows.find(r=>r.id===id);
  check(row&&attachedRoles.has(row.role),'independent guidance or stale mesh entered attachment registry');
 }
 for(const row of p.rows.filter(r=>r.note&&attachedRoles.has(r.role))){
  const core=p.rows.find(r=>r.role==='core'&&r.emission===row.emission);
  check(!!core,row.role+' has no parent body');if(!core)continue;
  check(p.attachments.includes(row.id),row.role+' real mesh not registered');
  check(row.order>core.order,row.role+' is not above its body');
  const gem=p.gems.find(g=>g.coreId===core.id);
  if(gem?.event?.demoted&&Number.isFinite(gem.event.cover))check(row.order<gem.event.cover,row.role+' escapes final cover order');
  const pixels=p.pixelAudit?.find(r=>r.role===row.role&&r.line===row.line);
  if(p.mode<2&&row.note.t===10.8&&gem?.event?.demoted&&pixels)
   check(pixels.pixelsChangedWhenPlacedBehind===0,row.role+' still paints pixels in front of the cover');
 }
 for(const g of p.gems){
  const core=p.rows.find(r=>r.id===g.coreId);
  if(core?.sourceFret===127)check(!!g.event,'unpitched body has no indexed event');
 }
 const target=p.rows.find(r=>r.role==='core'&&r.note?._case);
 if(target){
  const family=target.note._case;
  const faceFamilies=['pm','fhm','mt','ho','po','tap','slap','pop','slap-pop','harmonic','pinch','compound','accent','ghost','open','open-ghost','unpitched','target-trail','hit','miss'];
  let roles=[];
  if(p.style==='rsplus'&&faceFamilies.includes(family))roles=['face'];
  if(p.style==='current'){
   const map={pm:['_pmMark'],fhm:['_pmMark'],mt:['_pmMark'],ho:['tri'],po:['tri'],tap:['chevron'],slap:['attackMark'],pop:['attackMark'],'slap-pop':['attackMark'],harmonic:['harmMark'],pinch:['harmMark'],compound:['tri','attackMark','_pmMark','harmMark']};
   roles=map[family]||(faceFamilies.includes(family)?['_pmMark']:[]);
  }
  if(['bend','fractional-bend','prebend-release','curve-only'].includes(family))roles=['l'];
  if(['slide','unpitched-slide','legacy-slide-out'].includes(family))roles=['arrow'];
  for(const role of roles)check(p.rows.some(r=>r.emission===target.emission&&r.role===role),'missing actual '+family+' '+role+' emission');
 }
}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});const errors=[],results=[];
 try{
 const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!=='http://trail-audit.test')return route.fulfill({status:403,body:'External network blocked'});
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
  if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
  const f=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(f.startsWith(path.resolve(repo)+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({contentType:f.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(f)});
  return route.fulfill({status:404,body:'Missing fixture asset'});
 });
 await page.goto('http://trail-audit.test');
 await page.evaluate(async b=>{
  const settings={style:'off',notationStyle:'rsplus',palette:'default',glow:.5,bloom:false,vibrancy:.85,cinematic:false,sparks:false,hitFx:.7,verdictMarks:false,timingFx:false,streakFx:false,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0};
  for(const [k,v]of Object.entries(settings))window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)]?.(v);
  window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),b);await r.readyPromise;
  window.auditSettings={...settings};
  window.auditCharts=new Map();
  window.takeAudit=(b,style,mode)=>{
   if(b.auditChartKey){const old=auditCharts.get(b.auditChartKey);if(old){old.currentTime=b.currentTime;old.inverted=b.inverted;old.lefty=b.lefty;b=old;}else auditCharts.set(b.auditChartKey,b);}
   for(const [k,v]of Object.entries({notationStyle:style,bloom:style==='rsplus',trailYieldEnabled:mode>0,trailYieldGemInFront:mode>=2,trailYieldIncludeTrails:mode===3,...b.auditSettings}))if(auditSettings[k]!==v){window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)](v);auditSettings[k]=v;}
   window.bundle=b;b.getNoteState=n=>n._verdict?{state:n._verdict,alpha:1}:null;
   const sourceBefore=JSON.stringify([b.notes,b.chords,b.anchors,b.handShapes]);
   r.draw(b);
   const rows=[];window.__auditTake=(m,site,ctx)=>{rows.push({mesh:m,...site,...ctx});return m;};
   r.draw(b);window.__auditTake=null;
   window.lastAuditRows=rows;
   const a=r.__audit(),mat=m=>({type:m.type,opacity:m.opacity,transparent:m.transparent,depthTest:m.depthTest,depthWrite:m.depthWrite,blending:m.blending,side:m.side});
   const mesh=m=>{
    const p=m.getWorldPosition(m.position.clone()).project(a.cam),before=window.__beforeFinal?.find(x=>x[0]===m.id)?.[1];
    return {id:m.id,order:m.renderOrder,beforeFinal:before,visible:m.visible,geometry:m.geometry?.type,position:m.position.toArray(),scale:m.scale.toArray(),rotation:m.rotation.toArray().slice(0,3),screen:[(p.x+1)*640,(1-p.y)*360],material:Array.isArray(m.material)?m.material.map(mat):mat(m.material)};
   };
   const event=e=>e?({t:e.t,s:e.s,f:e.f,headVisible:e.headVisible,trailStart:e.trailStart,trailEnd:e.trailEnd,
    demoted:e._trailYieldTargetFrame===a.frame,gemRecords:e._trailYieldGemFrame===a.frame?e._trailYieldGemRecordCount:0,sourceFret:e.sourceFret??e.f,gemOrder:e._trailYieldGemCore?.renderOrder,cover:e._trailYieldGemPriorityFrame===a.frame?e._trailYieldGemPriorityOrder:null}):null;
   return {sourceUnchanged:sourceBefore===JSON.stringify([b.notes,b.chords,b.anchors,b.handShapes]),style:a.style,mode,settings:a.settings,time:b.currentTime,inverted:b.inverted,lefty:b.lefty,
    rows:rows.map(({mesh:m,...rest})=>({...rest,...mesh(m)})),
    events:a.events.map(event),
    gems:a.gems.map(g=>({coreId:g.core.id,event:event(g.event),outline:g.outline.renderOrder,core:g.core.renderOrder})),
    relations:a.sources.flatMap(s=>Array.from({length:s._trailOcclusionRelationCount},(_,i)=>({source:event(s),target:event(s._trailOcclusionTargets[i]),flags:s._trailOcclusionFlags[i]}))),
    strands:a.strands.map(s=>({event:event(s.event),outline:s.outline.renderOrder,body:s.body.renderOrder,near:s.nearZ,far:s.farZ,
     samples:s.geometry?Array.from({length:s.geometry.userData.ribbonSlices+1},(_,i)=>Array.from(s.geometry.attributes.position.array.slice(i*12,i*12+12))):null,
     colors:s.geometry?.attributes.color?Array.from(s.geometry.attributes.color.array.slice(0,(s.geometry.userData.ribbonSlices+1)*16)):null})),
    attachments:a.events.flatMap(e=>e._trailYieldGemFrame!==a.frame?[]:[e,...(e._trailYieldGemExtraRecords||[]).slice(0,Math.max(0,e._trailYieldGemRecordCount-1))].flatMap(r=>(r._trailYieldAttachments||[]).slice(0,r._trailYieldAttachmentCount||0).map(m=>m.id))),
    storage:a.events.reduce((v,e)=>{for(const r of [e,...(e._trailYieldGemExtraRecords||[])]){v.records++;v.slots+=(r._trailYieldAttachments||[]).length;}return v;},{records:0,slots:0}),
    previews:a.previews.map(mesh),renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,geometries:a.ren.info.memory.geometries,textures:a.ren.info.memory.textures},
   };
  };
  window.pixelAudit=()=>{
   const a=r.__audit(),rows=window.lastAuditRows,targets=rows.filter(x=>x.note?.t===10.8&&['face','_pmMark','tri','chevron','attackMark','harmMark','l','arrow','line','dl','core'].includes(x.role));
   const trails=rows.filter(x=>x.note?.t===10.1&&['trOut','tr','olMesh','body'].includes(x.role)).map(x=>x.mesh);
   const saved=[];a.scene.traverse(m=>{if(m.material)saved.push([m,m.visible]);});
   const bg=a.scene.background;a.scene.background=null;
   const oldColor=a.ren.getClearColor(trails[0].material.color.clone());
   const colorHex=oldColor?.getHex?.();
   const gl=a.ren.getContext(),w=a.ren.domElement.width,h=a.ren.domElement.height;
   const render=meshes=>{const set=new Set(meshes);for(const [m]of saved)m.visible=set.has(m);a.ren.setClearColor(0,1);a.ren.render(a.scene,a.cam);const p=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
   const maskTrail=render(trails),data=[];
   for(const t of targets){const m=t.mesh,mask=render([m]);let overlap=0;for(let i=0;i<mask.length;i+=4)if((mask[i]+mask[i+1]+mask[i+2]>5)&&(maskTrail[i]+maskTrail[i+1]+maskTrail[i+2]>5))overlap++;
    const actual=render([...trails,m]),old=m.renderOrder;m.renderOrder=Math.min(...trails.map(t=>t.renderOrder))-.02;const behind=render([...trails,m]);m.renderOrder=old;let changed=0;
    for(let i=0;i<actual.length;i+=4)if(Math.abs(actual[i]-behind[i])+Math.abs(actual[i+1]-behind[i+1])+Math.abs(actual[i+2]-behind[i+2])>3)changed++;
    data.push({role:t.role,line:t.line,overlapPixels:overlap,pixelsChangedWhenPlacedBehind:changed,order:old});
   }
   for(const [m,v]of saved)m.visible=v;a.scene.background=bg;if(colorHex!==undefined)a.ren.setClearColor(colorHex,1);a.ren.render(a.scene,a.cam);
   return data;
  };
 },base());
 const capture=async(name,b,style,mode,image=false,reset=false)=>{
  if(reset)await page.evaluate(async b=>{r.destroy();window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),b);await r.readyPromise;for(let i=0;i<30;i++)r.draw(b);},b);
  const p=await page.evaluate(({b,style,mode})=>takeAudit(b,style,mode),{b,style,mode});
  if(args.includes('--diagnose'))p.pixelAudit=await page.evaluate(()=>pixelAudit());
  validateCapture(name,p);
  results.push({name,...p});
  fs.appendFileSync(path.join(out,'progress.jsonl'),JSON.stringify({name,...p})+'\n');
  if(image){await page.screenshot({path:path.join(out,name+'.png')});const c=p.rows.find(x=>x.role==='core'&&Math.abs(x.note?.t-10.8)<1e-6);if(c&&c.screen[0]>80&&c.screen[0]<1200&&c.screen[1]>80&&c.screen[1]<640)await page.screenshot({path:path.join(out,name+'-close.png'),clip:{x:Math.round(c.screen[0]-80),y:Math.round(c.screen[1]-80),width:160,height:160}});}
  return p;
 };
 if(args.includes('--perf-only')){
  const b=base();for(let i=0;i<100;i++){
   const t=8+i*.035,s=i%4;
   b.notes.push(member({t,s,f:3+i%5,sus:.139,bn:.5,pm:true}),member({t:t+.185,s:s+1,f:2,ho:true}),member({t:t+.370,s:s+1,f:0,mt:true}));
  }b.notes.sort((a,b)=>a.t-b.t);
  for(const style of ['current','rsplus']){
   b.auditChartKey='perf-'+style;
   const first=await capture('perf-'+style,b,style,1,false,true);
   const timing=await page.evaluate(()=>{
    for(let i=0;i<200;i++)r.__auditUpdate(bundle);
    const samples=[];window.__perfTimings=[];
    for(let round=0;round<7;round++){
     const start=performance.now();for(let i=0;i<100;i++)r.__auditUpdate(bundle);
     samples.push((performance.now()-start)/100);
    }
    const finalizer=window.__perfTimings;window.__perfTimings=null;
    return{updateMs:samples,finalizerMeanMs:finalizer.reduce((a,b)=>a+b,0)/finalizer.length};
   });
   const last=await capture('perf-'+style+'-after',b,style,1);
   if(JSON.stringify(first.storage)!==JSON.stringify(last.storage))failures.push('steady-state attachment storage grew');
   if(JSON.stringify(first.renderer)!==JSON.stringify(last.renderer))failures.push('steady-state GPU resources grew');
   results.push({name:'timing-'+style,...timing,first:first.renderer,last:last.renderer,firstStorage:first.storage,lastStorage:last.storage});
  }
 }else if(opt('--cases')){
  const cases=JSON.parse(fs.readFileSync(opt('--cases'),'utf8'));
  for(const c of cases){await capture(c.name,c.bundle,c.style,c.mode,c.image!==false,c.reset!==false);if(results.length%20===0)console.log('Completed custom',results.length);}
 }else{

 if(!args.includes('--extra-only'))for(const style of ['current','rsplus'])for(const mode of [0,1,2,3])for(const inverted of (args.includes('--quick')?[false]:[false,true]))for(const lefty of (args.includes('--quick')?[false]:[false,true])){
  for(const [kind,flag]of flags.filter(([k])=>!args.includes('--quick')||['pm','tap','bend','slide','unpitched','open'].includes(k))){
   const b=fixture(kind,flag);b.inverted=inverted;b.lefty=lefty;b.auditSettings={slideArrowApproachVisible:true};if(inverted)b.notes.forEach(n=>n.s=5-n.s);
   await capture(style+'-m'+mode+'-'+inverted+'-'+lefty+'-'+kind,b,style,mode,mode===1&&!inverted&&!lefty&&['pm','tap','bend','slide','unpitched','open'].includes(kind));
  }
 console.log('Completed',style,mode,inverted,lefty,results.length);
 }
 if(!args.includes('--quick')&&!args.includes('--matrix-only')){
  const extra=require('./highway-trail-attachment-cases.cjs')({base,member,fixture,chordFixture});
  for(const c of extra)await capture(c.name,c.bundle,c.style,c.mode,c.image,c.reset);
 }

 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({repo,ref,git:cp.execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:sha(source),cases:results.length,errors,failures,results}));
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({cases:results.length,errors,failures},null,2));
 console.log(JSON.stringify({cases:results.length,errors,failed:failures.length,examples:failures.slice(0,8),out}));
 if(errors.length||failures.length)process.exitCode=1;
 }finally{await browser.close();}
}
main().catch(e=>{fs.writeFileSync(path.join(out,'fatal.txt'),e.stack);console.error(e);process.exitCode=1;});
