#!/usr/bin/env node
'use strict';

// Isolated full-renderer regression; software WebGL and no live application.
// node tests/browser/highway-sustain-lifetime.cjs --out <fresh directory>
// Optional: --chart <private streamed arrangement JSON> --preset straight|angled
// --source-ref cc22d0d --reference proves the old disappearance is reproduced.
// PLAYWRIGHT_MODULE may identify an already prepared Playwright installation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const repo=path.resolve(__dirname,'../..');
const out=path.resolve(option('--out',path.join(repo,'test-results/sustain-lifetime')));
const ref=option('--source-ref'),reference=args.includes('--reference'),chartFile=option('--chart');
const presets=option('--preset')?[option('--preset')]:['straight','angled'];
assert.ok(presets.every(p=>['straight','angled'].includes(p)),'Unknown stable camera preset');
const viewport={width:Number(option('--width','3440')),height:Number(option('--height','1343'))};
assert.ok(Object.values(viewport).every(n=>Number.isInteger(n)&&n>0&&n<=8192),'Invalid viewport');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const originalSource=ref?execFileSync('git',['-C',repo,'show',ref+':plugins/highway_3d/screen.js'],
    {encoding:'utf8',maxBuffer:8*1024*1024}):fs.readFileSync(path.join(repo,'plugins/highway_3d/screen.js'),'utf8');
let source=originalSource.replace(/\r\n/g,'\n');
const once=(before,after)=>{assert.equal(source.split(before).length,2,before);source=source.replace(before,after);};
// Instrument an in-memory copy. The production lifetime/geometry code stays
// untouched; expectations below come from the authored duration, not parts.trail.
once('drawNote.apply(null, record.args);',`window.__current={note:{...record.args[0]},parts:{...record.parts}};
    window.__queued.push(window.__current);drawNote.apply(null, record.args);window.__current=null;`);
once('function trailYieldRegisterTargetTrail(event, outline, body) {',`function trailYieldRegisterTargetTrail(event, outline, body) {
    if(window.__current){window.__emitted.push({current:window.__current,outline,body});
        for(const mesh of [outline,body])mesh.onBeforeRender=()=>{mesh.userData.auditDrawFrame=window.__frame;};}`);
once('function trailYieldRegisterGem(event, worldZ, outline, core, face, halo = null) {',
    `function trailYieldRegisterGem(event, worldZ, outline, core, face, halo = null) {
        if(window.__current)window.__gems.push(window.__current.note);`);
once("contextType: 'webgl2',",`__lifetimeAudit(){return {ren,scene,cam,T,now:_frameNow,
        queued:window.__queued,emitted:window.__emitted,gems:window.__gems};},contextType:'webgl2',`);

// The wire format rounds standalone/chord onsets to milliseconds while the
// handshape retains 221.449005. Its generated chord event is 5 us after the
// linked note. Ordinary note heads must not be created for either continuation.
const fixture={
    notes:[
        {t:221.371,s:1,f:7,sus:.078,sl:5,ln:true},{t:221.371,s:2,f:9,sus:.078,sl:7,ln:true},
        {t:221.449,s:1,f:5,sus:.393,ln:true},{t:221.449,s:2,f:7,sus:.393,ln:true},
        {t:221.842,s:1,f:5,sus:.079,sl:7,ln:true},{t:221.842,s:2,f:7,sus:.079,sl:9,ln:true},
        {t:221.921,s:1,f:7,sus:.235,ln:true},{t:221.921,s:2,f:9,sus:.235,ln:true},
    ],
    chords:[{t:220.983,id:0,notes:[{s:1,f:7,sus:.388,ln:true},{s:2,f:9,sus:.388,ln:true}]}],
    anchors:[{time:220.983002,fret:7,width:4},{time:221.449005,fret:5,width:4},{time:221.921005,fret:7,width:4}],
    handShapes:[{chord_id:0,start_time:220.983002,end_time:221.371002},
        {chord_id:1,start_time:221.449005,end_time:221.841995},
        {chord_id:0,start_time:221.921005,end_time:222.156}],
    chordTemplates:[{name:'E5',frets:[-1,7,9,-1,-1,-1]},{name:'D5',frets:[-1,5,7,-1,-1,-1]}],beats:[],
};
const chartBytes=chartFile?fs.readFileSync(chartFile):null;
const chart=chartBytes?JSON.parse(chartBytes):fixture;
const targets=chart.notes.filter(n=>Math.abs(n.t-221.449)<1e-9
    && ((n.s===1&&n.f===5)||(n.s===2&&n.f===7)));
assert.equal(targets.length,2,'Expected the rounded linked D5 pair in the supplied chart');
assert.ok(targets.every(n=>Math.abs(n.sus-.393)<1e-9&&n.ln===true),'Unexpected target duration/link');
const results=[],errors=[];
const report={reference,sourceRef:ref||null,sourceSha256:hash(originalSource),viewport,
    chart:chartFile?'provided private streamed arrangement':'portable timestamp-mismatch fixture',
    chartSha256:chartBytes?hash(chartBytes):hash(JSON.stringify(fixture)),fps:174.963,
    expectedInterval:{start:221.449,end:221.842,existingTrailCutoffSeconds:.01},
    limitations:['Isolated SwiftShader renderer, not a live application or physical presentation benchmark.',
        'Most frame updates skip GPU submission; selected frames explicitly submit the real scene.',
        'Expected mesh presence uses authored duration independently of the renderer queue lifetime flags.'],
    results,errors};
const key=n=>`${n.t}:${n.s}:${n.f}`;
const targetKeys=new Set(targets.map(key));
const checkMeshes=row=>{
    const expected=row.now>=221.449 && row.now<221.842-.01;
    const missing=[];
    for(const n of targets) {
        const emitted=row.emitted.filter(e=>key(e.note)===key(n));
        if(expected&&!emitted.length)missing.push(key(n));
        for(const e of emitted) {
            assert.ok(e.body.visible&&e.body.ancestorsVisible&&e.body.opacity>0,'Emitted body is visible');
            assert.ok(e.body.finiteBounds&&e.body.extents.every(v=>v>0),'Emitted body has finite nonzero geometry');
            if(row.realRender)assert.ok(e.body.submitted,'Expected body was submitted to Three.js renderer');
        }
    }
    assert.ok(!row.gems.some(n=>targetKeys.has(key(n))),'Linked continuation must not emit an attack gem');
    return missing;
};

async function main(){
    assert.ok(!fs.existsSync(out),'Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    let failure;
    try {
        const page=await browser.newPage({viewport,deviceScaleFactor:1});
        page.on('pageerror',e=>errors.push(e.stack));
        await page.addInitScript(()=>{
            window.__wall=1000;window.__realNow=performance.now.bind(performance);
            Object.defineProperty(performance,'now',{value:()=>window.__wall,configurable:true});
            window.__queued=[];window.__emitted=[];window.__gems=[];window.__frame=0;
        });
        await page.route('**/*',async route=>{
            const u=new URL(route.request().url());
            if(u.origin!=='http://sustain-lifetime.test')return route.fulfill({status:403,body:'No external network'});
            if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#101820}canvas{width:100%;height:100%;display:block}#host{width:100vw;height:100vh}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>'});
            if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:source});
            const file=path.resolve(repo,'.'+decodeURIComponent(u.pathname));
            if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())
                return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});
            return route.fulfill({status:404,body:'Missing fixture asset'});
        });
        for(const preset of presets){
            await page.goto('http://sustain-lifetime.test');
            const init=await page.evaluate(async({chart,preset})=>{
                const settings={cameraMode:'stable',stableCameraPreset:preset,notationStyle:'rsplus',style:'off',
                    glow:0,bloom:false,cinematic:false,chordDiagramVisible:false,projectionVisible:false};
                for(const[k,v]of Object.entries(settings))localStorage.setItem('h3d_bg_'+k,String(v));
                window.bundle={...chart,currentTime:221.2,isPlaying:false,playbackRate:1,
                    chordTemplates:chart.chordTemplates||chart.templates||[],handShapes:chart.handShapes||chart.handshapes||[],
                    sections:[],lyrics:[],stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},lefty:false,inverted:false,renderScale:1};
                window.r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;
                const a=r.__lifetimeAudit(),gl=a.ren.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
                window.__render=a.ren.render.bind(a.ren);a.ren.render=()=>{};
                window.__step=(time,realRender=false,seek=false)=>{
                    bundle.currentTime=time;bundle.isPlaying=!seek;window.__wall+=1000/174.963;
                    window.__queued=[];window.__emitted=[];window.__gems=[];window.__frame++;
                    r.draw(bundle);const a=r.__lifetimeAudit();
                    a.scene.updateMatrixWorld(true);a.cam.updateMatrixWorld(true);
                    if(realRender)window.__render(a.scene,a.cam);
                    const describe=m=>{
                        m.geometry.computeBoundingBox();const b=m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
                        let ancestorsVisible=true;for(let p=m;p;p=p.parent)ancestorsVisible&&=p.visible;
                        const extents=b.max.clone().sub(b.min).toArray();
                        return {id:m.id,visible:m.visible,ancestorsVisible,opacity:m.material.opacity,
                            finiteBounds:[...b.min.toArray(),...b.max.toArray()].every(Number.isFinite),extents,
                            submitted:m.userData.auditDrawFrame===window.__frame,geometry:m.geometry.type};
                    };
                    const target=n=>Math.abs(n.t-221.449)<1e-9&&((n.s===1&&n.f===5)||(n.s===2&&n.f===7));
                    return {time,now:a.now,realRender,queued:a.queued.filter(q=>target(q.note)),
                        emitted:a.emitted.filter(e=>target(e.current.note)).map(e=>({note:e.current.note,parts:e.current.parts,body:describe(e.body)})),
                        gems:a.gems.filter(target)};
                };
                return {settings,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
            },{chart,preset});
            assert.match(init.renderer,/SwiftShader/i,'Fixture requires software rendering');
            const samples=await page.evaluate(()=>{
                const rows=[];for(let i=0;i<=146;i++)rows.push(__step(221.2+i/174.963));return rows;
            });
            const run={preset,...init,samples,checks:[],missing:[]};results.push(run);
            for(const row of samples){
                assert.ok(Math.abs(row.now-row.time)<1e-7,'Fixed-rate fixture must have an exact renderer clock');
                const missing=checkMeshes(row);if(missing.length)run.missing.push({time:row.now,notes:missing});
            }
            // Explicit pause/seek/replay samples also exercise pool reuse. Only
            // four frames per preset need actual SwiftShader submissions.
            for(const time of [221.448,221.46,221.65,221.82,221.842,221.86,221.50]){
                const realRender=[221.448,221.46,221.65,221.50].includes(time);
                const row=await page.evaluate(({time,realRender})=>__step(time,realRender,true),{time,realRender});
                assert.ok(Math.abs(row.now-time)<1e-9,'Paused/seek sample uses the exact requested clock');
                const missing=checkMeshes(row);run.checks.push({...row,missing});
                if(realRender)await page.screenshot({path:path.join(out,`${preset}-${time}.png`)});
                if(time>=221.842)assert.equal(row.emitted.length,0,'The held segment must not extend beyond its authored release');
            }
            if(reference){
                assert.ok(run.missing.length>30,'Old source must reproduce a sustained interval of missing authored trails');
                assert.ok(run.checks.find(r=>r.time===221.65).missing.length===2,'Both baseline mid-hold trails must disappear');
                run.expectedFailureReproduced=true;
            }else{
                assert.deepEqual(run.missing,[],'Active authored sustains must emit throughout the hold');
                assert.ok(run.checks.every(r=>r.missing.length===0),'Seek/replay must preserve the same authored sustain lifetime');
            }
            await page.evaluate(()=>r.destroy?.());
        }
        assert.deepEqual(errors,[]);
    }catch(error){failure=error;report.failure=error.stack;}
    finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');}
    if(failure)throw failure;
    console.log(JSON.stringify({out,reference,runs:results.map(r=>({preset:r.preset,renderer:r.renderer,
        frames:r.samples.length,activeHoldSamples:r.samples.filter(s=>s.now>=221.449&&s.now<221.832).length,
        missingFrames:r.missing.length,realRenderChecks:r.checks.filter(c=>c.realRender).length,
        expectedFailureReproduced:r.expectedFailureReproduced||false}))},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
