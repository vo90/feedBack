#!/usr/bin/env node
// Real WebGL regression for saved/live chord tops, rim pixels and pool reuse.
// --out <fresh-directory> [--baseline-ref <revision before the change>]
// Uses only local source/assets and isolated browser storage; no app or song writes.
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = path.resolve(__dirname, '../..');
const out = path.resolve(option('--out', path.join(repo, 'test-results/chord-top')));
const baselineRef = option('--baseline-ref', 'HEAD');
const sourcePath = 'plugins/highway_3d/screen.js';
const baseline = cp.execFileSync('git', ['-C', repo, 'show', baselineRef + ':' + sourcePath], {encoding:'utf8',maxBuffer:4*1024*1024});
const source = fs.readFileSync(path.join(repo, sourcePath), 'utf8');
const settings = fs.readFileSync(path.join(repo, 'plugins/highway_3d/settings.html'), 'utf8');
const settingsStart = settings.indexOf("            const notationSelect = document.getElementById('h3d-notation-style');");
const settingsEnd = settings.indexOf("            const sel = document.getElementById('h3d-bg-style');", settingsStart);
const notationMarkup = settings.slice(settings.indexOf('<div role="group" aria-labelledby="h3d-notation-heading"'), settings.indexOf('<div role="group" aria-labelledby="h3d-bg-heading"'));
const errors = [], results = [];
const bundle = {currentTime:10,isPlaying:false,notes:[],chords:[],chordTemplates:[],
    anchors:[{time:0,fret:5,width:4}],handShapes:[],beats:[],sections:[],lyrics:[],
    stringCount:6,tuning:Array(6).fill(0),songInfo:{arrangement:'Lead'},inverted:false,lefty:false,renderScale:1,bgReactive:false};
const members = () => [{s:0,f:5},{s:1,f:7},{s:2,f:7}].map(n=>({sus:0,sl:-1,slu:-1,bn:0,ho:false,po:false,hm:false,hp:false,pm:false,mt:false,fhm:false,vb:false,tr:false,ac:false,tp:false,...n}));
bundle.chordTemplates = [{name:'A5',frets:[5,7,7,-1,-1,-1],fingers:[1,3,4,-1,-1,-1]}];
bundle.chords = [{t:10.15,id:0,notes:members()}, {t:10.55,id:0,hd:true,notes:members()},
    {t:10.95,id:0,hd:true,notes:members().map(n=>({...n,ac:true}))},
    {t:11.35,id:0,hd:true,notes:members().map(n=>({...n,pm:true}))}];
bundle.handShapes = [{chord_id:0,start_time:10.15,end_time:11.6}];

async function openPage(browser, code, reference) {
    const marker = "contextType: 'webgl2',";
    assert.equal(code.split(marker).length, 2);
    code = code.replace(marker, `__topAudit(){return {T,ren,cam,scene,noteG};}, ${marker}`);
    const context = await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:1});
    const page = await context.newPage();
    page.on('pageerror',e=>errors.push(String(e)));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.route('**/*',async route=>{
        const u = new URL(route.request().url());
        if(u.origin!=='http://chord-top.test')return route.fulfill({status:403,body:'External requests blocked'});
        if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{display:block;width:100%;height:100%}#settings{position:absolute;top:0;left:0;background:#fff}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>`});
        if(u.pathname==='/screen.js')return route.fulfill({contentType:'text/javascript',body:code});
        const file = path.resolve(repo,'.'+decodeURIComponent(u.pathname));
        if(file.startsWith(repo+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':'application/octet-stream',body:fs.readFileSync(file)});
        return route.fulfill({status:404,body:'Missing local asset'});
    });
    await page.goto('http://chord-top.test/');
    await page.evaluate(async({bundle,reference})=>{
        for(const[k,v]of Object.entries({notationStyle:'rsplus',style:'off',glow:.25,bloom:true,cinematic:false,chordDiagramVisible:false,projectionVisible:false}))localStorage.setItem('h3d_bg_'+k,String(v));
        window.bundle=bundle;window.r=feedBackViz_highway_3d();
        r.init(document.getElementById('highway'),bundle);await r.readyPromise;
        for(let i=0;i<45;i++)r.draw(bundle);
        window.captureTop = (top, style='rsplus') => {
            if(!reference)h3dBgSetChordBoxTop(top);
            h3dBgSetNotationStyle(style);r.draw(bundle);
            const a=r.__topAudit();
            const rims=a.noteG.children.filter(m=>m.visible&&m.material?.uniforms?.uBracketCap);
            const uniformRows=rims.map(m=>({top:m.material.uniforms.uTopCap?.value??0,bracket:m.material.uniforms.uBracketCap.value,width:m.material.uniforms.uSize.value.x,halo:m.material.uniforms.uHalo.value}));
            const counts={geometries:a.ren.info.memory.geometries,textures:a.ren.info.memory.textures,programs:a.ren.info.programs.length,objects:a.noteG.children.length};
            if(style==='current')return {uniformRows,counts};
            // Isolate the actual ordinary rim + halo in a fixed orthographic view.
            // This makes before/after pixel comparisons independent of camera easing.
            const scene=new a.T.Scene();scene.background=new a.T.Color(0);
            const first=rims.find(m=>m.material.uniforms.uHalo.value===0&&m.material.uniforms.uBracketCap.value===0);
            const u=first.material.uniforms,w=u.uSize.value.x,h=u.uSize.value.y;
            for(const m of rims.filter(m=>m.position.equals(first.position))){const copy=m.clone();copy.position.set(0,0,-1);scene.add(copy);}
            const camera=new a.T.OrthographicCamera(-w*.6,w*.6,h*.65,-h*.65,.1,5);
            a.ren.render(scene,camera);
            const gl=a.ren.getContext(),width=a.ren.domElement.width,height=a.ren.domElement.height;
            const pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            let whole=2166136261,lower=2166136261,topCenter=0,topCorners=0;
            for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
                const v=pixels[(y*width+x)*4+c];whole=Math.imul(whole^v,16777619);
                if(y<height/2)lower=Math.imul(lower^v,16777619);
                else if(x>width*.2&&x<width*.8)topCenter+=v;
                else topCorners+=v;
            }
            a.ren.render(a.scene,a.cam);
            return {uniformRows,counts,whole:whole>>>0,lower:lower>>>0,topCenter,topCorners};
        };
    },{bundle,reference});
    return {context,page};
}

async function main(){
    if(fs.existsSync(path.join(out,'results.json')))throw Error('Choose a fresh output directory');
    fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
    try{
        const old=await openPage(browser,baseline,true);
        const original=await old.page.evaluate(()=>captureTop('full'));
        await old.context.close();
        const {page,context}=await openPage(browser,source,false);
        const defaultTops=await page.evaluate(()=>r.__topAudit().noteG.children.filter(m=>m.visible&&m.material?.uniforms?.uTopCap).map(m=>({top:m.material.uniforms.uTopCap.value,width:m.material.uniforms.uSize.value.x})));
        assert.ok(defaultTops.length>0&&defaultTops.every(m=>Math.abs(m.top/m.width-.06)<1e-8));
        const full=await page.evaluate(()=>captureTop('full'));
        assert.equal(full.whole,original.whole,'Full border must restore the pre-change rim and halo pixels');
        await page.screenshot({path:path.join(out,'full-border.png')});
        const short=await page.evaluate(()=>captureTop('short-caps'));
        await page.screenshot({path:path.join(out,'short-caps.png')});
        assert.equal(short.lower,full.lower,'Lower border and sides must remain unchanged');
        assert.equal(short.topCenter,0,'Neither rim nor halo may bridge the opening');
        assert.ok(full.topCenter>0&&short.topCorners>0,'Full top and retained corner strokes must be visible');
        assert.ok(short.uniformRows.every(m=>Math.abs(m.top/m.width-.06)<1e-8),'All full-height, repeat, accent and muted frame passes need six-percent caps');
        assert.equal(short.uniformRows.length,full.uniformRows.length,'The cap treatment must not add rim or halo passes');
        const again=await page.evaluate(()=>captureTop('full'));
        assert.equal(again.whole,full.whole,'Live round trip must restore exact pixels');
        const current=await page.evaluate(()=>captureTop('short-caps','current'));
        assert.equal(current.uniformRows.length,0,'Current style keeps its original frame path');
        const returned=await page.evaluate(()=>captureTop('short-caps'));
        assert.equal(returned.whole,short.whole,'Notation round trip must retain the chosen caps');
        const memory=await page.evaluate(()=>{for(let i=0;i<20;i++)captureTop(i%2?'full':'short-caps');const before=captureTop('short-caps').counts;for(let i=0;i<40;i++)captureTop(i%2?'full':'short-caps');return {before,after:captureTop('short-caps').counts};});
        assert.deepEqual(memory.before,memory.after,'Live toggles must not grow GPU resources');
        // Exercise the actual Settings markup and hydration against the running renderer.
        await page.evaluate(({markup,script})=>{const div=document.createElement('div');div.id='settings';div.innerHTML=markup;document.body.append(div);new Function(script)();},{markup:notationMarkup,script:settings.slice(settingsStart,settingsEnd)});
        const topSelect=page.locator('#h3d-chord-box-top');
        assert.equal(await topSelect.inputValue(),'short-caps');
        await topSelect.selectOption('full');
        assert.equal(await page.evaluate(()=>localStorage.getItem('h3d_bg_chordBoxTop')),'full');
        await page.locator('#h3d-notation-style').selectOption('current');
        assert.equal(await topSelect.isDisabled(),true);
        await page.locator('#h3d-notation-style').selectOption('rsplus');
        assert.equal(await topSelect.inputValue(),'full');
        assert.equal(await topSelect.isEnabled(),true);
        const persisted=await page.evaluate(async()=>{r.destroy();r=feedBackViz_highway_3d();r.init(document.getElementById('highway'),bundle);await r.readyPromise;r.draw(bundle);return r.__topAudit().noteG.children.filter(m=>m.visible&&m.material?.uniforms?.uTopCap).every(m=>m.material.uniforms.uTopCap.value===0);});
        assert.equal(persisted,true,'Full border must survive renderer remount');
        results.push({baselineRef,defaultFrames:defaultTops.length,original,full,short,memory,persisted});
        assert.deepEqual(errors,[]);
        fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({errors,results},null,2));
        await context.close();
        console.log('Passed: baseline pixels, default caps, lower-edge preservation, glow gap, live/style toggles, stable GPU resources, Settings and saved remount.');
    }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
