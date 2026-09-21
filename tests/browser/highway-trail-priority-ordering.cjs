#!/usr/bin/env node
'use strict';

// Isolated actual-WebGL regression. No app, profile, library or checkout writes.
// --repo <checkout> --out <fresh directory> --compare-ref <pre-fix Git revision>
// Optional: --style current|rsplus --case <comma-separated substrings>
// --real-chart <private Airbourne lead.json> --perf --perf-only --reference
// PLAYWRIGHT_MODULE may select the already-installed Playwright package.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/trail-priority-ordering')));
const style = option('--style', 'current');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const source = normalize(fs.readFileSync(sourcePath, 'utf8'));
const compareRef = option('--compare-ref');
const reference = args.includes('--reference');
const baseline = compareRef ? normalize(execFileSync('git', [
    '-c', 'safe.directory=' + repo, '-C', repo, 'show', compareRef + ':plugins/highway_3d/screen.js',
], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})) : null;
const failures = [], errors = [], results = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const selected = name => !option('--case') || option('--case').split(',').some(part => name.includes(part));

function once(value, anchor, replacement) {
    assert.equal(value.split(anchor).length, 2, 'Expected unique hook: ' + anchor);
    return value.replace(anchor, replacement);
}

function instrument(input) {
    let value = once(input, 'bodyGeom.attributes.position.needsUpdate = true;', `
        bodyGeom.attributes.position.needsUpdate = true;
        if (window.__priorityProbe) window.__priorityProbe.geometry.push({
            kind:'ribbon',t:n.t,s:n.s,f:n.f,nominal:bodyTw,
            windows:Array.from({length:yieldCount},(_,i)=>[yieldStarts[i],yieldEnds[i]]),
            samples:times.map((t,i)=>({t,
                body:Array.from(bodyPositions.slice(i*12,i*12+12)),
                outline:Array.from(outlinePositions.slice(i*12,i*12+12))
            }))
        });`);
    value = once(value, 'tr.scale.set(tw, th, segLen);', `tr.scale.set(tw, th, segLen);
        if (window.__priorityProbe) window.__priorityProbe.geometry.push({
            kind:'box',t:n.t,s:n.s,f:n.f,nominal:tw,
            position:tr.position.toArray(),scale:tr.scale.toArray(),
            outlinePosition:trOut.position.toArray(),outlineScale:trOut.scale.toArray()
        });`);
    const gemAnchor = value.match(/function trailYieldRegisterGem\([^)]*\) \{/)[0];
    value = once(value, gemAnchor, `${gemAnchor}
        if (window.__priorityProbe && event) window.__priorityProbe.orders.push({
            kind:'gem',t:event.t,s:event.s,f:event.f,meshes:[outline,core,face].filter(Boolean)
        });`);
    value = once(value, 'function trailYieldRegisterTargetTrail(event, outline, body) {', `
        function trailYieldRegisterTargetTrail(event, outline, body) {
        if (window.__priorityProbe && event) window.__priorityProbe.orders.push({
            kind:'trail',t:event.t,s:event.s,f:event.f,meshes:[outline,body]
        });`);
    return once(value, "contextType: 'webgl2',", `
        __priorityAudit(){return {ren,cam,scene,settings:{...trailYieldSettings},
            notation:typeof rsPlusNotation==='undefined'?'current':rsPlusNotation?'rsplus':'current'};},
        contextType:'webgl2',`);
}

const note = extra => ({t:10,s:0,f:3,sus:0,sl:-1,slu:-1,bn:0,...extra});
const base = extra => ({
    currentTime:9.95,isPlaying:false,notes:[],chords:[],chordTemplates:[],handShapes:[],
    anchors:[{time:0,fret:2,width:4}],
    beats:Array.from({length:50},(_,i)=>({time:i*.5,measure:i%4===0?i/4:-1})),
    sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),
    songInfo:{arrangement:'Lead'},lefty:false,inverted:false,renderScale:1,...extra,
});
const intervening = () => note({t:10.185,s:1,f:2});
const later = () => note({t:10.370,s:1,f:0});
function makeFixture(kind) {
    const n = note({sus:.139});
    const b = base({notes:[n,intervening(),note({t:10.185,s:2,f:2}),later()]});
    if (kind === 'bend') n.bn = .5;
    if (kind === 'slide') n.sl = 4;
    if (kind === 'open-two-rails') n.f = 0;
    if (kind === 'chord') {
        b.notes.shift();
        b.chordTemplates = [{name:'C',frets:[3,-1,-1,5,-1,-1],fingers:[1,-1,-1,3,-1,-1]}];
        b.chords = [{t:10,id:0,notes:[{...n,bn:.5},note({s:3,f:5})]}];
    }
    if (kind === 'linked') {
        n.sus = .06; n.ln = true;
        b.notes.splice(1,0,note({t:10.06,sus:.079,bn:.5}));
    }
    if (kind === 'fretted-target') b.notes.at(-1).f = 3;
    if (kind === 'target-trail') b.notes.at(-1).sus = .25;
    return b;
}
const cases = [];
for (const kind of ['plain','bend','slide','open-two-rails','chord','linked','fretted-target','target-trail']) {
    for (let mode=0;mode<4;mode++) cases.push({
        name:kind+'-mode-'+mode,b:makeFixture(kind),mode,sourceTimes:kind==='linked'?[10,10.06]:[10],
        targetTime:10.185,sourceString:0,targetString:1,expectNarrow:mode>0,
        image:kind==='bend'&&(mode===0||mode===1),turned:true,
    });
}
for (const [name,inverted,lefty,turned] of [
    ['straight',false,false,false],['inverted',true,false,true],
    ['lefty',false,true,true],['both',true,true,true],
]) {
    const b=makeFixture('bend');b.inverted=inverted;b.lefty=lefty;
    if(inverted) for(const n of b.notes)n.s=5-n.s;
    cases.push({name:'orientation-'+name,b,mode:1,sourceTimes:[10],targetTime:10.185,
        sourceString:inverted?5:0,targetString:inverted?4:1,expectNarrow:true,turned,image:true});
}
cases.push({name:'physical-crossing',b:base({notes:[
    note({sus:1,bn:2}),note({t:10.4,s:1,f:3,sus:.2}),note({t:10.85,s:1,f:0}),
]}),mode:1,sourceTimes:[10],targetTime:10.4,sourceString:0,targetString:1,expectNarrow:true,turned:true});
if(option('--real-chart')) {
    const raw=JSON.parse(fs.readFileSync(option('--real-chart'),'utf8'));
    for(const time of [24.85,24.95,25]) for(const mode of [0,1]) cases.push({
        name:'airbourne-'+time+'-mode-'+mode,
        b:base({...raw,currentTime:time,chordTemplates:raw.templates||raw.chordTemplates,
            handShapes:raw.handshapes||raw.handShapes}),
        mode,sourceTimes:[25],targetTime:25.184999,sourceString:0,targetString:1,
        expectNarrow:mode>0,turned:true,image:time===24.95,
    });
}

function objectAt(proof,kind,t,s) {
    return proof.orders.filter(o=>o.kind===kind&&Math.abs(o.t-t)<1e-5&&o.s===s);
}
function trailFirstOrderViolation(c,p) {
    const source=c.sourceTimes.flatMap(t=>objectAt(p,'trail',t,c.sourceString));
    const target=objectAt(p,'gem',c.targetTime,c.targetString);
    return c.mode<=1&&source.length>0&&target.length>0&&
        Math.min(...source.flatMap(o=>o.orders))<=Math.max(...target.flatMap(o=>o.orders));
}
function validate(c,p) {
    check(p.renderer.calls>0,c.name+': no WebGL rendering');
    check(p.notation===style,c.name+': notation mismatch');
    for(const g of p.geometry) {
        const values=g.kind==='ribbon'?g.samples.flatMap(s=>s.body.concat(s.outline)):g.position.concat(g.scale);
        check(values.every(Number.isFinite),c.name+': non-finite trail geometry');
    }
    if(reference)return;
    const source=c.sourceTimes.flatMap(t=>objectAt(p,'trail',t,c.sourceString));
    const target=objectAt(p,'gem',c.targetTime,c.targetString);
    check(source.length>0&&target.length>0,c.name+': missing source/target meshes');
    if(c.mode<=1&&source.length&&target.length) {
        check(Math.min(...source.flatMap(o=>o.orders))>Math.max(...target.flatMap(o=>o.orders)),
            c.name+': intervening gem paints above trail-first source');
    }
    if(c.expectNarrow) {
        const strands=p.geometry.filter(g=>g.s===c.sourceString&&c.sourceTimes.some(t=>Math.abs(t-g.t)<1e-5));
        check(strands.some(g=>g.samples?.some(s=>(s.body[3]-s.body[0])/g.nominal<.9)),
            c.name+': genuine target stopped narrowing trail');
    }
    if(c.name.startsWith('open-two-rails')) check(source.length===2,c.name+': open sustain lost one rail');
}
function compare(c,p,before) {
    check(sha(JSON.stringify(p.geometry))===sha(JSON.stringify(before.geometry)),c.name+': geometry or narrowing changed');
    check(p.renderer.calls===before.renderer.calls,c.name+': draw-call count changed');
    check(p.renderer.triangles===before.renderer.triangles,c.name+': triangle count changed');
    check(p.renderer.geometries===before.renderer.geometries,c.name+': allocated geometry count changed');
    if(c.mode===0||c.mode>=2)check(JSON.stringify(p.orders)===JSON.stringify(before.orders),c.name+': unchanged mode ordering changed');
}

async function main(){
    if(fs.existsSync(path.join(out,'results.json')))throw Error('Choose a fresh evidence directory');
    fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    let served='';
    try{
        const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.stack));
        page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.route('**/*',async route=>{
            const u=new URL(route.request().url());
            if(u.origin!=='http://priority.test')return route.fulfill({status:403,body:'External network forbidden'});
            if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
            if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
            const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
            if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
            return route.fulfill({status:404,body:'Unknown fixture asset'});
        });
        async function load(input,label){served=instrument(input);await page.goto('http://priority.test/?revision='+label);}
        async function init(c,input){
            return page.evaluate(async({c,style,stable})=>{
                if(window.r)r.destroy();window.__priorityProbe=null;localStorage.clear();
                window.__h3dCamCtl=c.turned?{enabled:true,distMul:1,heightMul:1,yaw:-24*Math.PI/180,pitch:5,panX:0,panY:0}:null;
                const settings={cameraMode:stable?'stable':'lookahead',stableCameraPreset:'straight',
                    trailYieldEnabled:c.mode>0,trailYieldGemInFront:c.mode>=2,trailYieldIncludeTrails:c.mode===3,
                    style:'off',notationStyle:style,glow:0,cinematic:false,sparks:false,bloom:false,
                    verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false};
                for(const[k,v]of Object.entries(settings)){localStorage.setItem('h3d_bg_'+k,String(v));const set=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(set)set(v);}
                window.bundle=c.b;window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
                for(let i=0;i<3;i++)r.draw(bundle);
                window.capturePriority=()=>{
                    const a=r.__priorityAudit();window.__priorityProbe={geometry:[],orders:[]};
                    a.ren.info.autoReset=false;a.ren.info.reset();r.draw(bundle);
                    const p=window.__priorityProbe;window.__priorityProbe=null;
                    p.orders=p.orders.map(({meshes,...o})=>({...o,orders:meshes.map(m=>m.renderOrder)}));
                    return{...p,time:bundle.currentTime,notation:a.notation,settings:a.settings,
                        renderer:{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,geometries:a.ren.info.memory.geometries}};
                };
                return capturePriority();
            },{c,style,stable:input.includes('stableCameraPreset')});
        }
        const active=cases.filter(c=>selected(c.name)&&!args.includes('--perf-only'));
        assert.ok(active.length>0||args.includes('--perf-only')||selected('pause-seek-horizon'),
            'No validation cases match --case');
        assert.ok(reference||baseline||!active.some(c=>c.mode>=2),
            'Modes 2/3 acceptance requires --compare-ref; --reference is diagnostic only');
        const before=new Map();
        if(baseline&&active.length){
            await load(baseline,'baseline');
            for(const c of active){
                before.set(c.name,await init(c,baseline));
                if(c.image)await page.screenshot({path:path.join(out,c.name+'-baseline.png')});
            }
        }
        await load(source,'candidate');
        for(const c of active){
            const p=await init(c,source);validate(c,p);
            if(before.has(c.name))compare(c,p,before.get(c.name));
            results.push({name:c.name,mode:c.mode,proof:p,baseline:before.get(c.name),
                baselineTrailFirstOrderViolation:before.has(c.name)?trailFirstOrderViolation(c,before.get(c.name)):null,
                candidateTrailFirstOrderViolation:trailFirstOrderViolation(c,p)});
            if(c.image)await page.screenshot({path:path.join(out,c.name+'.png')});
            console.log(c.name+': '+p.renderer.calls+' calls');
        }
        if(!args.includes('--perf-only')&&selected('pause-seek-horizon')){
            const c={...cases.find(c=>c.name==='bend-mode-1'),name:'pause-seek-horizon'};
            await init(c,source);const samples=[];
            for(const time of [7.35,8,9.95,9.95,10.02,10.12,10.3,9.95]){
                const p=await page.evaluate(time=>{bundle.currentTime=time;return capturePriority();},time);
                samples.push(p);
                if(time>=7.4&&time<=10.12)validate({...c,name:c.name+'-'+time},p);
            }
            check(JSON.stringify(samples[2].geometry)===JSON.stringify(samples[3].geometry),'pause: trail geometry changed');
            check(JSON.stringify(samples[2].orders)===JSON.stringify(samples[3].orders),'pause: drawing order changed');
            check(JSON.stringify(samples[2].orders)===JSON.stringify(samples.at(-1).orders),'seek: drawing order differs after return');
            results.push({name:c.name,samples});
        }
        if(args.includes('--perf')){
            const b=base({notes:[]});
            for(let i=0;i<100;i++){
                const t=8+i*.035,s=i%4;
                b.notes.push(note({t,s,f:3+i%5,sus:.139,bn:.5}),note({t:t+.185,s:s+1,f:2}),note({t:t+.370,s:s+1,f:0}));
            }
            b.notes.sort((a,b)=>a.t-b.t);
            const c={name:'dense',b,mode:1,turned:true},samples=[];
            for(let round=0;round<3;round++)for(const [label,input]of(round%2?[['candidate',source],['baseline',baseline]]:[['baseline',baseline],['candidate',source]])){
                if(!input)continue;await load(input,label);await init(c,input);
                const p=await page.evaluate(()=>{
                    window.__priorityProbe=null;const a=r.__priorityAudit(),gl=a.ren.getContext();
                    for(let i=0;i<6;i++)r.draw(bundle);gl.finish();
                    const start=performance.now();for(let i=0;i<12;i++)r.draw(bundle);
                    const ms=(performance.now()-start)/12;gl.finish();
                    // The final GPU finish is outside the timer: this measures
                    // CPU draw submission, not complete GPU frame duration.
                    return{cpuDrawSubmissionMs:ms,proof:capturePriority()};
                });
                samples.push({round,label,...p});
            }
            for(let round=0;round<3;round++){
                const a=samples.find(s=>s.round===round&&s.label==='candidate'),b=samples.find(s=>s.round===round&&s.label==='baseline');
                if(a&&b)compare({name:'dense-round-'+round,mode:1},a.proof,b.proof);
            }
            results.push({name:'dense-performance',samples});
        }
    }finally{await browser.close();}
    check(errors.length===0,'Browser errors: '+errors.join('\n'));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceHash:sha(source),compareRef,
        baselineHash:baseline?sha(baseline):null,style,reference,failures,errors,results},null,2));
    console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));
    if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
