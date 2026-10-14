#!/usr/bin/env node
'use strict';

// Isolated production-renderer acceptance. Software WebGL, no live app access.
// --out <fresh directory> [--chart <private compact arrangement JSON>]
// --source-ref <git ref> --reference captures the old behavior for comparison.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2), option = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const repo = path.resolve(__dirname, '../..'), out = path.resolve(option('--out', path.join(repo, 'test-results/fret-clearance')));
const ref = option('--source-ref'), reference = args.includes('--reference');
let source = ref ? execFileSync('git', ['-C', repo, 'show', ref + ':plugins/highway_3d/screen.js'], {encoding:'utf8', maxBuffer:8*1024*1024})
    : fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8');
source = source.replace(/\r\n/g, '\n');
const once = (a, b) => { assert.equal(source.split(a).length, 2, a); source = source.replace(a, b); };
once('sp.material.opacity = 0.85 * _colFadeIn;', 'sp.userData.auditFret=f; sp.userData.auditTime=b.time; sp.material.opacity = 0.85 * _colFadeIn;');
if (!reference) {
    once('function _fretReferenceHiddenFrets(time, frets) {', `function _fretReferenceHiddenFrets(time, frets) {
        const start=window.__realNow(); const result=_auditHiddenFrets(time,frets);
        window.__costs.push(window.__realNow()-start); return result;
    }
    function _auditHiddenFrets(time, frets) {`);
    once('const byFret = Array.from({ length: NFRETS + 1 }, () => []);',
        'const auditIndexStart=window.__realNow(); window.__indexBuilds++; const byFret = Array.from({ length: NFRETS + 1 }, () => []);');
    once('strumFrames: _authoredStrumCache, byFret,\n            };\n            return byFret;',
        'strumFrames: _authoredStrumCache, byFret,\n            };\n            window.__indexCosts.push(window.__realNow()-auditIndexStart);\n            return byFret;');
}
once("contextType: 'webgl2',", `__clearanceAudit(){
    const grey=[];pFretColMarker.forEachActive(sp=>{const rect={};_incomingLabelScreenRect(sp,rect,true);
        grey.push({f:sp.userData.auditFret,t:sp.userData.auditTime,visible:sp.visible,opacity:sp.material.opacity,rect});});
    return {ren,scene,cam,grey,waves:Array.from(_fretMarkerWaveCache,([t,c])=>({t,frets:c.fretList,hidden:Array.from(c.hiddenFrets||[])})),
        gold:_incomingFloorLabels.slice(0,_incomingFloorLabelCount).map(r=>({t:r.time,f:r.fret,visible:r.sprite.visible}))};
}, contextType:'webgl2',`);
const privateChart = option('--chart') ? JSON.parse(fs.readFileSync(option('--chart'),'utf8')) : null;
const fixture = {notes:[{t:220.597,s:0,f:3,ig:true,po:true}],chords:[],anchors:[{time:0,fret:3,width:4}],
    beats:[{time:220.673996,measure:165}],chordTemplates:[],handShapes:[]};
const results = [], errors = [];

async function main() {
    assert.ok(!fs.existsSync(path.join(out,'results.json')), 'Use a fresh output directory');
    fs.mkdirSync(out,{recursive:true});
    const browser = await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    try {
        const page = await browser.newPage({viewport:{width:3440,height:1440},deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.stack));
        await page.addInitScript(()=>{
            window.__wall=1000;window.__realNow=performance.now.bind(performance);
            Object.defineProperty(performance,'now',{value:()=>window.__wall,configurable:true});
        });
        await page.route('**/*',async route=>{
            const u=new URL(route.request().url());
            if(u.origin!=='http://fret-clearance.test')return route.fulfill({status:403,body:'No external network'});
            if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}canvas{width:100%;height:100%;display:block}#host{width:100vw;height:100vh}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
            if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:source});
            const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
            if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});
            return route.fulfill({status:404,body:'Missing fixture asset'});
        });
        for(const preset of ['straight','angled']) {
            await page.goto('http://fret-clearance.test');
            const data = privateChart || fixture;
            const initialization = await page.evaluate(async ({data,preset})=>{
                window.__costs=[];window.__indexBuilds=0;window.__indexCosts=[];
                const config={cameraMode:'stable',stableCameraPreset:preset,notationStyle:'rsplus',style:'off',glow:0,bloom:false,
                    cinematic:false,chordDiagramVisible:false,projectionVisible:false,fretColumnMarkerCadence:1};
                for(const [k,v] of Object.entries(config))localStorage.setItem('h3d_bg_'+k,String(v));
                window.bundle={...data, currentTime:216.9,isPlaying:false,playbackRate:1,
                    chordTemplates:data.chordTemplates||data.templates||[],handShapes:data.handShapes||data.handshapes||[],
                    sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},lefty:false,inverted:false,renderScale:1};
                window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
                const a=r.__clearanceAudit(),gl=a.ren.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
                window.__render=a.ren.render.bind(a.ren);a.ren.render=()=>{};
                return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
            },{data,preset});
            assert.match(initialization.renderer,/SwiftShader/i,'fixture must use software rendering');
            const run=await page.evaluate(()=>{
                const samples=[],costs=[];
                bundle.isPlaying=true;
                for(let i=0;i<=680;i++){
                    bundle.currentTime=216.9+i/174.963;window.__wall+=1000/174.963;
                    const start=window.__realNow();r.draw(bundle);costs.push(window.__realNow()-start);
                    const a=r.__clearanceAudit(),wave=a.waves.find(w=>Math.abs(w.t-220.673996)<1e-7);
                    const grey=a.grey.find(g=>g.f===3&&Math.abs(g.t-220.673996)<1e-7);
                    if(wave)samples.push({time:bundle.currentTime,decision:wave.hidden.includes(3),visible:!!grey?.visible,opacity:grey?.opacity||0,
                        frets:wave.frets,hidden:wave.hidden,visibleFrets:a.grey.filter(g=>g.visible&&g.opacity>0&&Math.abs(g.t-220.673996)<1e-7).map(g=>g.f)});
                }
                const ordered=costs.slice(10).sort((a,b)=>a-b);
                return {samples,indexBuilds:window.__indexBuilds,indexBuildMs:window.__indexCosts,wavePlanningMs:window.__costs,
                    updateMs:{p50:ordered[Math.floor(ordered.length*.5)],p95:ordered[Math.floor(ordered.length*.95)],max:ordered.at(-1)}};
            });
            if(!reference){
                assert.ok(run.samples.length>300,'full approach sampled');
                assert.ok(run.samples.every(s=>s.decision&&!s.visible),'reported grey 3 must be absent for its whole approach');
                const retained=run.samples[0].frets.filter(f=>!run.samples[0].hidden.includes(f));
                assert.ok(retained.length>0,'clear references must remain');
                for(const s of run.samples)assert.deepEqual(s.visibleFrets,retained,'visible references must remain throughout');
                assert.equal(run.indexBuilds,1,'unchanged chart index builds once');
            }
            for(const time of [219.6,220.05]) {
                await page.evaluate(time=>{bundle.currentTime=time;window.__wall+=1000/60;r.draw(bundle);const a=r.__clearanceAudit();window.__render(a.scene,a.cam);},time);
                await page.screenshot({path:path.join(out,`${preset}-${time}.png`)});
            }
            results.push({preset,...initialization,...run});
            await page.evaluate(()=>r.destroy?.());
        }
        assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({reference,sourceRef:ref||null,chart:privateChart?'provided private arrangement':'reported-event fixture',errors,results},null,2)+'\n');
    console.log(JSON.stringify({out,results:results.map(r=>({preset:r.preset,renderer:r.renderer,samples:r.samples.length,indexBuilds:r.indexBuilds,indexBuildMs:r.indexBuildMs,waves:r.wavePlanningMs.length,maxWavePlanningMs:Math.max(0,...r.wavePlanningMs),updateMs:r.updateMs}))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
