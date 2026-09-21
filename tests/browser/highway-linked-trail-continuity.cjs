#!/usr/bin/env node
/* Actual-WebGL linked-trail acceptance; no app runtime, library, or settings writes.
 * node tests/browser/highway-linked-trail-continuity.cjs --out <fresh directory>
 * Optional: --repo <checkout> --reference --style current|rsplus --case <substring>
 * --real-chart <private lead.json> --perf [--perf-only] --width 1280 --height 720
 * PLAYWRIGHT_MODULE may name an existing Playwright module; no installation occurs.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/linked-trail-continuity')));
const style = option('--style', 'current');
const reference = args.includes('--reference');
const width = Number(option('--width', 1280)), height = Number(option('--height', 720));
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const failures = [], errors = [], results = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
function once(value, anchor, replacement) {
    assert.equal(value.split(anchor).length, 2, 'Expected unique instrumentation anchor: ' + anchor);
    return value.replace(anchor, replacement);
}
let served = source;
if (served.includes('function hwyBuildLinkedTrailPaths(links) {')) served = once(served,
    'function hwyBuildLinkedTrailPaths(links) {',
    'function hwyBuildLinkedTrailPaths(links) { if(window.__trailBuilds!==undefined)window.__trailBuilds++;');
served = once(served, 'bodyGeom.attributes.position.needsUpdate = true;', `bodyGeom.attributes.position.needsUpdate = true;
 if(window.__trailProbe)window.__trailProbe.strands.push({kind:'ribbon',note:{...n},nominalBodyWidth:bodyTw,nominalOutlineWidth:outlineTw,trailEnd,yieldWindows:Array.from({length:yieldCount},(_,i)=>[yieldStarts[i],yieldEnds[i]]),yieldSettings:{...yieldSettings},
 samples:times.map((t,i)=>{const o=i*12;return {t,body:Array.from(bodyPositions.slice(o,o+12)),outline:Array.from(outlinePositions.slice(o,o+12)),alpha:bodyColors?bodyColors[i*16+3]:1};})});`);
served = once(served, 'tr.scale.set(tw, th, segLen);', `tr.scale.set(tw, th, segLen);
 if(window.__trailProbe){const sample=(t,z,bw,bh,ow,oh)=>({t,body:[xOff-bw/2,y-bh/2,z,xOff+bw/2,y-bh/2,z,xOff+bw/2,y+bh/2,z,xOff-bw/2,y+bh/2,z],outline:[xOff-ow/2,y-oh/2,z,xOff+ow/2,y-oh/2,z,xOff+ow/2,y+oh/2,z,xOff-ow/2,y+oh/2,z],alpha:1});
 window.__trailProbe.strands.push({kind:'box',note:{...n},nominalBodyWidth:tw,nominalOutlineWidth:tw+0.4*K,samples:[sample(now-(zCenter+segLen/2)/TS,zCenter+segLen/2,tw,th,tw+0.4*K,th+0.4*K),sample(now-(zCenter-segLen/2)/TS,zCenter-segLen/2,tw,th,tw+0.4*K,th+0.4*K)]});}`);
served = once(served, 'const core = pNote.get();', `const core = pNote.get();
 if(window.__trailProbe)window.__trailProbe.gems.push({note:{...n},fromChord});`);
served = once(served, 'function trailYieldRegisterGem(event, worldZ, outline, core, face) {', `function trailYieldRegisterGem(event, worldZ, outline, core, face) {
 if(window.__trailProbe&&event)window.__trailProbe.orders.push({kind:'gem',t:event.t,s:event.s,f:event.f,meshes:[outline,core,face].filter(Boolean)});`);
served = once(served, 'function trailYieldRegisterTargetTrail(event, outline, body) {', `function trailYieldRegisterTargetTrail(event, outline, body) {
 if(window.__trailProbe&&event)window.__trailProbe.orders.push({kind:'trail',t:event.t,s:event.s,f:event.f,meshes:[outline,body]});`);
served = once(served, "contextType: 'webgl2',", `__trailAudit(){return {ren,cam,scene,notation:typeof rsPlusNotation==='undefined'?'current':rsPlusNotation?'rsplus':'current'};},contextType:'webgl2',`);

const note = extra => ({t:10,s:0,f:5,sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,...extra});
const template = {name:'C5',frets:[5,-1,7,-1,-1,-1],fingers:[1,-1,3,-1,-1,-1]};
function base(extra={}) {
    return {currentTime:9.8,isPlaying:false,notes:[],chords:[],chordTemplates:[template],anchors:[{time:0,fret:4,width:5}],handShapes:[],
        beats:Array.from({length:25},(_,i)=>({time:6+i*.5,measure:i%4===0?i/4:-1})),sections:[],lyrics:[],stringCount:6,tuning:[0,0,0,0,0,0],
        songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false,...extra};
}
const obstacle = extra => note({t:11.2,s:1,f:5,sus:.15,...extra});
const straightSplit = () => base({notes:[note({sus:1,ln:true}),note({t:11,sus:1}),obstacle()]});
const turnAway = () => base({notes:[note({sus:1,ln:true}),note({t:11,sus:.2,slu:2}),obstacle({t:11.35})]});
const turnToward = () => base({notes:[note({sus:1,ln:true}),note({t:11,sus:.4,sl:8}),obstacle({t:11.1,f:5}),obstacle({t:11.5,f:8})]});
const scenes = [];
const add = (name,b,extra={}) => scenes.push({name,b,mode:1,...extra});
add('straight-unsplit',base({notes:[note({sus:2}),obstacle()]}),{image:true,expectNarrow:true,equivalent:'straight'});
add('straight-split',straightSplit(),{image:true,expectNarrow:true,seams:[[10,11]],equivalent:'straight'});
add('turn-away',turnAway(),{image:true,seams:[[10,11]],expectFull:[10,11]});
add('turn-toward',turnToward(),{image:true,seams:[[10,11]],expectNarrow:true});
add('multiple-links',base({notes:[note({sus:.6,ln:true}),note({t:10.6,sus:.6,ln:true}),note({t:11.2,sus:.6,sl:8}),obstacle({t:10.8}),obstacle({t:11.9,f:8})]}),{seams:[[10,10.6],[10.6,11.2]],expectNarrow:true});
add('bend-unsplit',base({notes:[note({sus:2,bn:2,bnv:[{t:0,v:0},{t:1,v:2},{t:2,v:0}]}),obstacle({t:11.1})]}),{equivalent:'bend',image:true});
add('bend-split',base({notes:[note({sus:1,ln:true,bn:2,bnv:[{t:0,v:0},{t:1,v:2}]}),note({t:11,sus:1,bn:2,bnv:[{t:0,v:2},{t:1,v:0}]}),obstacle({t:11.1})]}),{equivalent:'bend',image:true,seams:[[10,11]]});
add('slide-bend',base({notes:[note({sus:1,sl:8,ln:true}),note({t:11,f:8,sus:1,bn:2,bnv:[{t:0,v:0},{t:1,v:2}]}),obstacle({t:11.3,f:8})]}),{seams:[[10,11]]});
add('chord-to-single',base({chords:[{t:10,id:0,notes:[note({sus:1,ln:true}),note({s:2,f:7,sus:.3})]}],notes:[note({t:11,sus:.4,slu:2}),obstacle({t:11.5})]}),{image:true,seams:[[10,11]],expectFull:[10,11]});
add('single-to-chord',base({notes:[note({sus:1,ln:true}),obstacle({t:11.2})],chords:[{t:11,id:0,notes:[note({t:11,sus:1}),note({t:11,s:2,f:7,sus:.4})]}]}),{seams:[[10,11]],expectNarrow:true});
add('arpeggio-to-single',base({notes:[note({sus:1,ln:true}),note({t:10.3,s:2,f:7}),note({t:11,sus:1}),obstacle()],handShapes:[{start_time:10,end_time:10.9,chord_id:0,arpeggio:true}]}),{image:true,seams:[[10,11]]});
// A chart moves open-string display geometry with its anchor. These disjoint
// strands must not be falsely joined or acquire narrowing from a hidden attack.
add('open-anchor-change',base({notes:[note({f:0,sus:1,ln:true}),note({t:11,f:0,sus:1})],anchors:[{time:0,fret:3,width:4},{time:11,fret:7,width:5}]}),{image:true,expectFull:[10,11]});
add('hidden-continuation-unsplit',base({notes:[note({t:9.8,s:1,sus:1.5}),note({sus:2})]}),{expectNarrow:true});
add('hidden-continuation-split',base({notes:[note({t:9.8,s:1,sus:1.2,ln:true}),note({sus:2}),note({t:11,s:1,sus:.3})]}),{expectNarrow:true,hidden:[{t:11,s:1}]});
add('target-linked-trail',base({notes:[note({sus:2}),note({t:10.2,s:1,sus:.8,ln:true}),note({t:11,s:1,sus:.8,sl:8})]}),{mode:3,expectNarrow:true});
add('real-gap',base({notes:[note({sus:.8,ln:true}),note({t:11,sus:1}),obstacle()]}),{gap:[10.8,11]});
add('new-attack',base({notes:[note({sus:1}),note({t:11,sus:1}),obstacle()]}));
add('ambiguous-target',base({notes:[note({sus:1,ln:true}),note({t:11,sus:1}),note({t:11,sus:.7,sl:7}),obstacle()]}));
add('missing-duration',base({notes:[note({sus:0,ln:true}),note({t:11,sus:1}),obstacle()]}));
add('independent-open-chord',base({chords:[{t:10,id:1,notes:[note({f:0,sus:2}),note({s:2,f:7,sus:1})]}],chordTemplates:[template,{name:'Open',frets:[0,-1,7,-1,-1,-1],fingers:[0,-1,3,-1,-1,-1]}],notes:[obstacle()]}),{image:true});
add('targetless-slide-out',base({notes:[note({sus:1,ln:true}),note({t:11,sus:.6,slide_out:'down',slide_out_marks:[{direction:'down',start:.2,end:.6}]}),obstacle({t:11.05})]}),{image:true,seams:[[10,11]],fade:true});
for (let mode=0; mode<4; mode++) for (const [orientation, inverted, lefty] of [['normal',false,false],['inverted',true,false],['lefty',false,true],['both',true,true]]) {
    const b=turnToward();b.inverted=inverted;b.lefty=lefty;
    // Keep the obstacle on the visually lower string in inverted mode.
    if(inverted){for(const n of b.notes)n.s=5-n.s;}
    add(`mode-${mode}-${orientation}`,b,{mode,seams:[[10,11]],sourceString:inverted?5:0,expectNarrow:mode>0});
}
const realPath=option('--real-chart');
if(realPath){const raw=JSON.parse(fs.readFileSync(realPath,'utf8'));for(const t of [109,109.2,109.35,109.45])add('amaranthine-'+t,base({...raw,currentTime:t,chordTemplates:raw.templates,handShapes:raw.handshapes}),{image:true,realFileSha:sha(fs.readFileSync(realPath)),seams:t<109.44?[[108.093002,109.440002]]:[],expectFull:t<109.44?[108.093002,109.440002]:[109.440002]});}
function dense(){const b=base({currentTime:9.8});for(let i=0;i<320;i++){const t=8+i*.032,s=i%6,f=4+i%5;b.notes.push(note({t,s,f,sus:.18,ln:true}),note({t:t+.18,s,f,sus:.28,sl:4+(i+2)%5}));}b.notes.sort((a,b)=>a.t-b.t);return b;}
function sourceStrands(proof,onset,s=0){return proof.strands.filter(r=>r.note.s===s&&Math.abs(r.note.t-onset)<1e-5);}
function dim(sample,kind){const a=sample[kind];return {width:a[3]-a[0],height:a[7]-a[1],x:(a[3]+a[0])/2,y:(a[7]+a[1])/2,z:a[2]};}
function widthScaleAt(proof,t,s=0){const strand=proof.strands.find(r=>r.note.s===s&&r.samples[0].t<=t+1e-6&&r.samples.at(-1).t>=t-1e-6);if(!strand)return null;const a=strand.samples;let hi=a.findIndex(v=>v.t>=t-1e-8);if(hi<0)hi=a.length-1;const lo=Math.max(0,hi-1),mix=a[hi].t>a[lo].t?(t-a[lo].t)/(a[hi].t-a[lo].t):0;return (dim(a[lo],'body').width*(1-mix)+dim(a[hi],'body').width*mix)/strand.nominalBodyWidth;}
function validateScene(s,p){
    check(p.renderer.calls>0,s.name+': no WebGL draw calls');
    check(p.notation===style,s.name+': wrong notation style '+p.notation);
    for(const strand of p.strands)for(const sample of strand.samples)for(const kind of ['body','outline'])check(sample[kind].every(Number.isFinite),s.name+': nonfinite '+kind+' geometry');
    if(reference)return;
    const ss=s.sourceString??0;
    for(const [left,right] of s.seams||[]){const a=sourceStrands(p,left,ss).find(r=>Math.abs(r.samples.at(-1).t-right)<.0011),b=sourceStrands(p,right,ss)[0];check(a&&b,`${s.name}: missing connected seam ${left}-${right}`);if(!a||!b)continue;
        for(const kind of ['body','outline']){const x=dim(a.samples.at(-1),kind),y=dim(b.samples[0],kind);for(const key of ['width','height','x','y','z'])check(Math.abs(x[key]-y[key])<2e-6,`${s.name}: ${kind} ${key} seam mismatch ${x[key]} vs ${y[key]}`);}}
    if(s.expectNarrow)check(p.strands.filter(r=>r.note.s===ss).some(r=>r.samples.some(v=>dim(v,'body').width/r.nominalBodyWidth<.7)),s.name+': genuine obstacle never narrows source');
    for(const onset of s.expectFull||[])for(const r of sourceStrands(p,onset,ss))check(r.samples.every(v=>dim(v,'body').width/r.nominalBodyWidth>.99),s.name+': false narrowing at '+onset);
    for(const h of s.hidden||[])check(!p.gems.some(n=>n.note.s===h.s&&Math.abs(n.note.t-h.t)<1e-5),s.name+': hidden continuation attack rendered');
    if(s.gap)check(!p.strands.filter(r=>r.note.s===ss).some(r=>r.samples[0].t<s.gap[1]-1e-5&&r.samples.at(-1).t>s.gap[0]+1e-5),s.name+': authored gap bridged');
    if(s.fade){const r=sourceStrands(p,11,ss)[0];check(r?.samples.at(-1).alpha<.05,s.name+': authored slide-out fade missing');}
    if(s.name.startsWith('mode-')){
        const covering=p.orders.find(r=>r.kind==='trail'&&r.s===ss&&r.t===11);
        const targetGem=p.orders.find(r=>r.kind==='gem'&&r.s===(ss===0?1:4)&&r.t===11.1);
        const targetTrail=p.orders.find(r=>r.kind==='trail'&&r.s===(ss===0?1:4)&&r.t===11.1);
        check(covering&&targetGem&&targetTrail,s.name+': missing meshes for ordering assertion');
        if(covering&&targetGem&&targetTrail){
            const front=(target,owner)=>Math.min(...target.orders)>Math.max(...owner.orders);
            check(s.mode>=2?front(targetGem,covering):front(covering,targetGem),s.name+': gem foreground preference reversed');
            check(s.mode===3?front(targetTrail,covering):front(covering,targetTrail),s.name+': trail foreground preference reversed');
        }
    }
}
async function main(){
    if(fs.existsSync(path.join(out,'results.json')))throw new Error('Choose a fresh output directory');
    fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    try{
        const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://trail-fixture.test')return route.fulfill({status:403,body:'External network forbidden'});
            if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
            if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
            const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});return route.fulfill({status:404,body:'Unknown fixture asset'});});
        await page.goto('http://trail-fixture.test/');
        await page.evaluate(()=>{window.__capture=()=>{const a=r.__trailAudit();window.__trailProbe={strands:[],gems:[],orders:[]};a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);const p=window.__trailProbe;window.__trailProbe=null;p.orders=p.orders.map(({meshes,...v})=>({...v,orders:meshes.map(m=>m.renderOrder)}));return {time:bundle.currentTime,notation:a.notation,modelBuilds:window.__trailBuilds,renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,memory:{...a.ren.info.memory}},...p};};});
        async function init(b,mode=1){await page.evaluate(async({b,style,mode})=>{if(window.r)r.destroy();localStorage.clear();const settings={trailYieldEnabled:mode>0,trailYieldGemInFront:mode>=2,trailYieldIncludeTrails:mode===3,style:'off',notationStyle:style,palette:'default',glow:0,vibrancy:.85,cinematic:false,sparks:false,bloom:false,verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false,cameraSmoothing:0,zoomSmoothing:0,tiltSmoothing:0};for(const [k,v] of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const setter=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(typeof setter==='function')setter(v);}window.__trailBuilds=0;window.bundle=b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;for(let i=0;i<3;i++)r.draw(bundle);},{b,style,mode});}
        for(const s of scenes.filter(s=>!args.includes('--perf-only')&&(!option('--case')||s.name.includes(option('--case'))))){
            await init(s.b,s.mode);const p=await page.evaluate(()=>__capture());validateScene(s,p);results.push({name:s.name,mode:s.mode,realFileSha:s.realFileSha,...p});if(s.image)await page.screenshot({path:path.join(out,s.name+'.png')});console.log(s.name+': '+p.strands.length+' trail strands, '+p.renderer.calls+' calls');}
        if(!option('--case')&&!args.includes('--perf-only')){
            if(!reference)for(const key of ['straight','bend','hidden-continuation']){const a=results.find(s=>s.name===key+'-unsplit'),b=results.find(s=>s.name===key+'-split');for(let t=10;t<=12+.0001;t+=.025){const aw=widthScaleAt(a,t),bw=widthScaleAt(b,t);check(aw!==null&&bw!==null&&Math.abs(aw-bw)<.07,`${key} partition changes width at ${t.toFixed(3)}: ${aw} vs ${bw}`);}}
            await init(straightSplit());const seeks=[];for(const time of [8,9.8,10.3,10.98,11.02,11.8,12.1,9.8])seeks.push(await page.evaluate(time=>{bundle.currentTime=time;return __capture();},time));
            results.push({name:'seek-and-viewport',samples:seeks});if(!reference){for(const p of seeks){check(p.modelBuilds===1,'seek: linked model rebuilt or missing');if(p.time<11)validateScene({name:'seek-'+p.time,seams:[[10,11]]},p);for(const t of [10.95,11.025,11.1,11.3,11.7]){if(t<Math.max(10,p.time)||t>p.time+3)continue;const a=widthScaleAt(seeks[1],t),b=widthScaleAt(p,t);check(a!==null&&b!==null&&Math.abs(a-b)<.07,`seek ${p.time} changes chart-space width at ${t}: ${a} vs ${b}`);}}}
        }
        if(args.includes('--perf')){
            const perfScenes=[{name:'dense-linked',b:dense(),mode:3}];
            const real=scenes.find(s=>s.name==='amaranthine-109.2');if(real)perfScenes.push({...real,name:'amaranthine'});
            for(const s of perfScenes){await init(s.b,s.mode);const perf=await page.evaluate(()=>{const a=r.__trailAudit(),gl=a.ren.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');for(let i=0;i<10;i++)r.draw(bundle);gl.finish();const cpu=[],finish=[];for(let round=0;round<3;round++){let t=performance.now();for(let i=0;i<10;i++)r.draw(bundle);cpu.push((performance.now()-t)/10);t=performance.now();gl.finish();finish.push(performance.now()-t);}return {cpuMsPerDraw:cpu,finishWaitMs:finish,gpu:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),proof:__capture()};});results.push({name:'performance-'+s.name,...perf});console.log(s.name+' CPU '+JSON.stringify(perf.cpuMsPerDraw));}
        }
        check(errors.length===0,'Browser errors: '+errors.join('\n'));
    }finally{await browser.close();}
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceNormalizedLfSha:sha(source),reference,style,width,height,failures,errors,results},null,2));
    console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
