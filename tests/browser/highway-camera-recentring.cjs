#!/usr/bin/env node
'use strict';

// Isolated production-renderer camera acceptance; no app/profile/library writes.
// --repo <checkout> --out <fresh-directory> --compare-ref <pre-fix Git ref>
// Optional: --case <comma-separated substrings> --airbourne <private lead.json>
//           --perf --reference (diagnostic, disables candidate acceptance)
// PLAYWRIGHT_MODULE selects an already installed Playwright package.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/camera-recentring')));
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourcePath = path.join(repo, 'plugins/highway_3d/screen.js');
const source = normalize(fs.readFileSync(sourcePath, 'utf8'));
const compareRef = option('--compare-ref');
const baseline = compareRef ? normalize(execFileSync('git', [
    '-c', 'safe.directory=' + repo, '-C', repo, 'show', compareRef + ':plugins/highway_3d/screen.js',
], {encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})) : null;
const selected = name => !option('--case') || option('--case').split(',').some(part => name.includes(part));
const errors = [], failures = [], results = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const delta = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const pose = p => [...p.position, ...p.quaternion, p.fov];

function instrument(input) {
    const anchor = "contextType: 'webgl2',";
    assert.equal(input.split(anchor).length, 2, 'Missing unique camera hook');
    return input.replace(anchor, `
        __recentreAudit() {
            return {ren,scene,cam,mode:cameraMode,
                state:Object.fromEntries(Object.entries(_stableCam).filter(([k,v])=>
                    v===null||['number','string','boolean'].includes(typeof v))),
                projectFret(f){return new T.Vector3(xFretMid(f),sY(2),0).project(cam).toArray();},
                heads(){const heads=[];pNote.forEachActive(mesh=>{
                    if(!mesh.visible||mesh.userData.stableCameraRelevant===false)return;
                    const r={};if(_incomingLabelScreenRect(mesh,r,true))heads.push(r);
                });return heads;},
                geometry(){const items=[];
                    for(const [kind,pool] of [['note',pNote],['box',pChordBox],['frame',pRsChordFrame],
                        ['tail',pSus],['ribbon',pSusRibbon],['technique',pTechPlane]]) {
                        pool?.forEachActive(mesh=>{if(!mesh.visible)return;
                            const attr=mesh.geometry?.attributes?.position;
                            const slices=mesh.geometry?.userData?.ribbonSlices;
                            const count=Number.isFinite(slices)?Math.min(attr.count,(slices+1)*4):attr?.count||0;
                            items.push({kind,position:mesh.position.toArray(),scale:mesh.scale.toArray(),
                                quaternion:mesh.quaternion.toArray(),vertices:attr?Array.from(attr.array.slice(0,count*3)):[]});
                        });
                    }return items;
                }
            };
        },
        __recentreBenchmark(bundle,iterations){
            for(let i=0;i<20;i++){window.__wall+=1000/60;camUpdate(bundle);}
            const samples=[];
            for(let i=0;i<iterations;i++){
                window.__wall+=1000/60;const start=window.__realNow();camUpdate(bundle);
                samples.push(window.__realNow()-start);
            }
            samples.sort((a,b)=>a-b);
            return{mean:samples.reduce((a,b)=>a+b,0)/samples.length,
                p95:samples[Math.floor(samples.length*.95)],max:samples.at(-1),pointCount:_stableCam.pointCount};
        },
        contextType:'webgl2',`);
}

const note = extra => ({t:6,s:2,f:4,sus:0,sl:-1,slu:-1,bn:0,...extra});
const base = extra => ({
    currentTime:6,isPlaying:true,playbackRate:1,notes:[],chords:[],chordTemplates:[],handShapes:[],
    anchors:[{time:0,fret:2,width:4}],
    beats:Array.from({length:500},(_,i)=>({time:i*.5,measure:i%4===0?i/4:-1})),
    sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},
    lefty:false,inverted:false,renderScale:1,...extra,
});
function fixture(kind) {
    return base({
        notes:Array.from({length:84},(_,i)=>{
            const t=6+i*.5;
            const excursion=(kind==='return'||kind==='return-pattern')&&t>=13&&t<16;
            const f=excursion?19:(kind==='small-passage'||kind==='return-pattern')?3+(i%2)*2:4;
            return note({t,f,s:i%3});
        }),
        anchors:kind.startsWith('return')?[{time:0,fret:2,width:4},{time:13,fret:18,width:4},{time:16,fret:2,width:4}]:[{time:0,fret:2,width:4}],
    });
}
function chart(file) {
    const raw=JSON.parse(fs.readFileSync(file,'utf8'));
    return base({...raw,currentTime:0,chordTemplates:raw.templates||raw.chordTemplates||[],handShapes:raw.handshapes||raw.handShapes||[]});
}
const cases=[];
for(const preset of ['straight','angled']) {
    for(const fps of [10,20,60]) cases.push({name:'return-'+preset+'-'+fps,preset,fps,b:fixture('return'),start:6,end:28,kind:'return'});
    for(const kind of ['stationary','small-passage']) cases.push({name:kind+'-'+preset,preset,fps:20,b:fixture(kind),start:6,end:28,kind});
    cases.push({name:'return-pattern-'+preset,preset,fps:20,b:fixture('return-pattern'),start:6,end:28,kind:'return-pattern'});
    cases.push({name:'controls-'+preset,preset,fps:20,b:fixture('return'),start:6,end:18,kind:'controls'});
    if(option('--airbourne')) cases.push({name:'airbourne-full-'+preset,preset,fps:10,b:chart(option('--airbourne')),
        start:0,end:229,kind:'real',compareTimes:[20,30,60,90,120,150,180,210],captureTimes:[20,150]});
}

function validate(c, run) {
    if(args.includes('--reference'))return;
    const samples=[run.first,...run.samples];
    for(const p of samples) {
        check(p.mode==='stable',c.name+': stable camera inactive');
        check(pose(p).every(Number.isFinite),c.name+': non-finite camera pose');
        check(delta(p.quaternion,run.first.quaternion)<1e-8,c.name+': automatic viewing angle changed');
        check(Math.abs(p.fov-60)<1e-8,c.name+': lens changed');
    }
    if(c.kind==='controls') {
        check(delta(pose(run.pause[0]),pose(run.pause[1]))<1e-9,c.name+': pause moved automatic pose');
        check(delta([run.frozen[0].state.x,run.frozen[0].state.distance],
            [run.frozen[1].state.x,run.frozen[1].state.distance])<1e-9,c.name+': follow-off moved automatic pose');
        check(run.bridgePreserved,c.name+': manual camera transform was reset');
        check(delta(pose(run.offset),pose(run.frozen[1]))>.001,c.name+': paused manual transform did not apply');
        check(delta(pose(run.seek),pose(run.direct))<.002,c.name+': seek retained old travel');
        return;
    }
    if(c.kind.startsWith('return')) {
        check(Math.abs(run.played.state.x-run.direct.state.x)<.01,c.name+': historical horizontal offset remains');
        check(Math.abs(run.played.state.distance-run.direct.state.distance)<.025,c.name+': distance failed to return');
        check(delta(pose(run.seek),pose(run.direct))<.002,c.name+': seek differs from direct opening');
    }
    if(c.kind==='stationary')check(Math.max(...samples.map(p=>Math.abs(p.state.x-run.first.state.x)))<.005,c.name+': unchanged passage drifts');
    if(c.kind==='small-passage'||c.kind==='return-pattern') {
        const settled=samples.filter(p=>p.time>=20).map(p=>p.state.x);
        check(Math.max(...settled)-Math.min(...settled)<.025,c.name+': centre chases ordinary alternating notes');
    }
    if(c.kind==='real')for(const comparison of run.comparisons) {
        // These repeated low-position passages are settled, away from the
        // higher-fret transition; allow a small residual from gentle damping.
        if(comparison.time>=30)check(Math.abs(comparison.deltaX)<.025,c.name+' t'+comparison.time+': settled playback differs from seek');
    }
}

async function main() {
    assert.ok(!fs.existsSync(path.join(out,'results.json')),'Choose a fresh evidence directory');
    const active=cases.filter(c=>selected(c.name));
    assert.ok(active.length>0,'No cases match --case');
    fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    let served='';
    try {
        const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.stack));
        page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
        await page.addInitScript(()=>{
            window.__wall=1000;window.__realNow=performance.now.bind(performance);
            Object.defineProperty(performance,'now',{configurable:true,value:()=>window.__wall});
        });
        await page.route('**/*',async route=>{
            const u=new URL(route.request().url());
            if(u.origin!=='http://recentring.test')return route.fulfill({status:403,body:'External network forbidden'});
            if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
            if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:served});
            const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
            if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':'application/octet-stream',body:fs.readFileSync(file)});
            return route.fulfill({status:404,body:'Missing fixture asset'});
        });
        async function load(input) {
            served=instrument(input);await page.goto('http://recentring.test/');
            await page.evaluate(()=>{
                window.capture=()=>{
                    const a=r.__recentreAudit();a.cam.updateMatrixWorld();a.scene.updateMatrixWorld(true);
                    return{time:bundle.currentTime,mode:a.mode,state:a.state,position:a.cam.position.toArray(),
                        quaternion:a.cam.quaternion.toArray(),fov:a.cam.fov,projectedFret4:a.projectFret(4),heads:a.heads()};
                };
                window.step=(time,ms,playing=true)=>{window.__wall+=ms;bundle.currentTime=time;bundle.isPlaying=playing;r.draw(bundle);return capture();};
                window.renderNow=()=>{
                    const a=r.__recentreAudit();a.ren.info.autoReset=false;a.ren.info.reset();window.__realRender(a.scene,a.cam);
                    return{calls:a.ren.info.render.calls,triangles:a.ren.info.render.triangles,
                        geometries:a.ren.info.memory.geometries,geometry:a.geometry()};
                };
            });
        }
        async function init(c, extra={}) {
            return page.evaluate(async({c,extra})=>{
                if(window.r)r.destroy();window.__wall=1000;localStorage.clear();window.__h3dCamCtl=extra.bridge||null;
                const settings={cameraMode:'stable',stableCameraPreset:c.preset,stableCameraFollow:true,cameraSmoothing:.5,zoomSmoothing:.5,tiltSmoothing:.5,
                    cameraLockLow:false,style:'off',notationStyle:'rsplus',glow:0,cinematic:false,sparks:false,bloom:false,
                    verdictMarks:false,timingFx:false,streakFx:false,hitFx:0,chordDiagramVisible:false};
                for(const[k,v]of Object.entries(settings)){
                    localStorage.setItem('h3d_bg_'+k,String(v));const set=window['h3dBgSet'+k[0].toUpperCase()+k.slice(1)];if(set)set(v);
                }
                window.bundle={...c.b,...extra.bundle};window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
                const a=r.__recentreAudit();window.__realRender=a.ren.render.bind(a.ren);a.ren.render=()=>{};
                return step(bundle.currentTime,0,bundle.isPlaying);
            },{c,extra});
        }
        async function advance(start,end,fps) {
            return page.evaluate(({start,end,fps})=>{
                const samples=[];
                for(let i=1;i<=Math.round((end-start)*fps);i++){
                    const p=step(start+i/fps,1000/fps);
                    if(i%Math.max(1,Math.round(fps/2))===0||i===Math.round((end-start)*fps))samples.push(p);
                }
                return samples;
            },{start,end,fps});
        }
        async function snapshot(name) {
            const stats=await page.evaluate(()=>renderNow());
            if(name)await page.screenshot({path:path.join(out,name+'.png')});
            return{...stats,geometryHash:hash(JSON.stringify(stats.geometry)),geometry:undefined};
        }
        async function run(c,label) {
            const first=await init(c),initialRender=await snapshot();
            const samples=[];
            let start=c.start;
            for(const end of [...(c.captureTimes||[]),c.end]) {
                samples.push(...await advance(start,end,c.fps));start=end;
                if(c.captureTimes?.includes(end))await snapshot(c.name+'-'+end+'-'+label+'-played');
            }
            const played=samples.at(-1);
            const finalRender=await snapshot(c.kind==='return'&&c.fps===20?c.name+'-'+label+'-played':null);
            if(c.kind==='controls') {
                const controls=await page.evaluate(()=>{
                    const pause=[step(bundle.currentTime,0,false)];
                    for(let i=0;i<80;i++)step(bundle.currentTime,50,false);
                    pause.push(capture());h3dBgSetStableCameraFollow(false);
                    const frozen=[step(bundle.currentTime,0,true)];
                    for(let i=0;i<80;i++)step(22+i*.05,50,true);
                    frozen.push(capture());
                    const bridge={enabled:true,distMul:1.1,heightMul:1.05,yaw:.08,pitch:4,panX:2,panY:1};
                    window.__h3dCamCtl={...bridge};const offset=step(bundle.currentTime,50,false);
                    h3dBgSetStableCameraFollow(true);const seek=step(28,50,false);
                    return{pause,frozen,bridge,offset,seek,bridgePreserved:JSON.stringify(bridge)===JSON.stringify(window.__h3dCamCtl)};
                });
                const direct=await init(c,{bundle:{currentTime:28,isPlaying:false},bridge:controls.bridge});
                return{first,samples,played,initialRender,finalRender,...controls,direct};
            }
            const seek=await page.evaluate(end=>{step(end-4,50,false);return step(end,50,false);},c.end);
            const direct=await init(c,{bundle:{currentTime:c.end,isPlaying:false}});
            const comparisons=[];
            for(const time of c.compareTimes||[]) {
                const continued=samples.find(p=>Math.abs(p.time-time)<1e-6);
                const sought=await init(c,{bundle:{currentTime:time,isPlaying:false}});
                comparisons.push({time,continued,sought,deltaX:continued.state.x-sought.state.x,
                    deltaDistance:continued.state.distance-sought.state.distance,
                    pixelDelta:640*(continued.projectedFret4[0]-sought.projectedFret4[0])});
                if(c.captureTimes?.includes(time))await snapshot(c.name+'-'+time+'-'+label+'-seek');
            }
            return{first,samples,played,seek,direct,comparisons,initialRender,finalRender};
        }
        const before=new Map();
        if(baseline){await load(baseline);for(const c of active){before.set(c.name,await run(c,'baseline'));console.log('baseline '+c.name);}}
        await load(source);
        for(const c of active) {
            const proof=await run(c,'candidate');validate(c,proof);
            const old=before.get(c.name);
            if(old) {
                check(proof.initialRender.geometryHash===old.initialRender.geometryHash,c.name+': note/technique geometry changed at identical opening pose');
                for(const key of ['calls','triangles','geometries'])check(proof.initialRender[key]===old.initialRender[key],c.name+': opening '+key+' changed');
            }
            results.push({name:c.name,preset:c.preset,fps:c.fps,proof,baseline:old});
            console.log(c.name+': final X error '+(proof.played.state.x-proof.direct.state.x));
        }
        if(args.includes('--perf')) {
            const c={name:'dense',preset:'straight',b:base({currentTime:9,notes:Array.from({length:48},(_,i)=>note({t:8.5+i*.01,s:i%6,f:1+i%20,sus:3,sl:i%2?24:1,bn:i%3===0?2:0}))})};
            const timings=[];
            for(let round=0;round<3;round++)for(const[label,input]of(round%2?[['candidate',source],['baseline',baseline]]:[['baseline',baseline],['candidate',source]])){
                if(!input)continue;await load(input);await init(c);
                const timing=await page.evaluate(()=>r.__recentreBenchmark(bundle,100));
                timings.push({round,label,...timing});
            }
            results.push({name:'camera-cpu-cost',timings});
        }
    } finally { await browser.close(); }
    check(errors.length===0,'Browser errors: '+errors.join('\n'));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({sourcePath,sourceHash:hash(source),compareRef,
        baselineHash:baseline?hash(baseline):null,reference:args.includes('--reference'),
        method:'Production geometry/camera updates at simulated FPS; GPU submissions only at captures. Camera CPU benchmark uses real elapsed time.',
        failures,errors,results},null,2));
    console.log(JSON.stringify({out,cases:results.length,failures,errors},null,2));
    if(failures.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
