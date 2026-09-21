#!/usr/bin/env node
// Isolated GPU regression for distant RS+ dividers. No app/profile/library writes.
// --out <fresh-dir> [--source-ref <git-ref> --reference] [--compare <baseline-dir>]
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const repo = path.resolve(option('--repo', path.join(__dirname, '../..')));
const out = path.resolve(option('--out', path.join(repo, 'test-results/rsplus-dividers')));
const reference = args.includes('--reference'), ref = option('--source-ref');
const source = ref ? cp.execFileSync('git', ['-C', repo, 'show', ref + ':plugins/highway_3d/screen.js'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    : fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8');
const hook = "contextType: 'webgl2',";
assert.equal(source.split(hook).length, 2);
const served = source.replace('mRsLaneDivider = rsLaneDividerMaterial();', `mRsLaneDivider = rsLaneDividerMaterial();
 mRsLaneDivider.onBeforeCompile=()=>{window.__dividerCompiles=(window.__dividerCompiles||0)+1;};`)
    .replace(hook, `__dividerAudit(){return {ren,cam,scene,noteG,T,K,TS,AHEAD,mRsLaneDivider,mLaneDividerExt,mLaneDivider,mHandPositionEdge,xFret,
 syncViewport(){if(mRsLaneDivider.uniforms?.uViewport)ren.getDrawingBufferSize(mRsLaneDivider.uniforms.uViewport.value);}};},${hook}`);
const failures = [], errors = [], results = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
    if (fs.existsSync(path.join(out, 'results.json'))) throw new Error('Choose a fresh output directory');
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const size of [
            { name: '720', w: 1280, h: 720, dpr: 1, scale: 1 },
            { name: '1080', w: 1920, h: 1080, dpr: 2, scale: 0.5 },
            { name: 'hidpi', w: 1280, h: 720, dpr: 2, scale: 1 },
            { name: 'split', w: 640, h: 720, dpr: 1, scale: 1 },
            { name: 'scaled', w: 1280, h: 720, dpr: 1, scale: 0.5 },
        ]) {
            const context = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr });
            const page = await context.newPage();
            page.on('pageerror', e => errors.push(String(e)));
            page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
            await page.route('**/*', async route => {
                const u = new URL(route.request().url());
                if (u.origin !== 'http://divider-fixture.test') return route.fulfill({ status: 403, body: 'External network blocked' });
                if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;background:#101820}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>' });
                if (u.pathname === '/screen.js') return route.fulfill({ contentType: 'text/javascript', body: served });
                const file = path.resolve(repo, '.' + decodeURIComponent(u.pathname));
                if (file.startsWith(repo + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
                    return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(file) });
                }
                return route.fulfill({ status: 404, body: 'Missing fixture asset' });
            });
            await page.goto('http://divider-fixture.test');
            await page.evaluate(async size => {
                const config = { style: 'off', notationStyle: 'rsplus', glow: 0, bloom: false, cinematic: false, chordDiagramVisible: false, projectionVisible: false };
                for (const [k, v] of Object.entries(config)) localStorage.setItem('h3d_bg_' + k, String(v));
                window.bundle = { currentTime: 8, isPlaying: false, playbackRate: 1, notes: [], chords: [], chordTemplates: [], anchors: [{ time: 0, fret: 9, width: 4 }], handShapes: [], beats: [], sections: [], lyrics: [], stringCount: 6, tuning: Array(6).fill(0), songInfo: { arrangement: 'Lead' }, lefty: false, inverted: false, renderScale: size.scale, bgReactive: false };
                window.r = feedBackViz_highway_3d();
                r.init(document.getElementById('highway'), bundle);
                await r.readyPromise;
                window.__dividerPrewarmed = window.__dividerCompiles || 0;
                window.a = r.__dividerAudit();
                window.pose = (angle = 0, shift = 0) => {
                    const cx = a.xFret(10);
                    a.cam.fov = 60;
                    a.cam.updateProjectionMatrix();
                    a.cam.projectionMatrix.elements[9] = 0.48;
                    a.cam.projectionMatrixInverse.copy(a.cam.projectionMatrix).invert();
                    a.cam.position.set(cx + shift, 0.4144636963, 0.6797308403);
                    a.cam.rotation.set(-25 * Math.PI / 180, angle, 0, 'YXZ');
                    a.cam.updateMatrixWorld(true);
                    a.syncViewport();
                };
                window.render = () => a.ren.render(a.scene, a.cam);
                window.dividers = () => a.noteG.children.filter(m => m.visible && [a.mRsLaneDivider, a.mLaneDividerExt, a.mLaneDivider, a.mHandPositionEdge].includes(m.material));
                window.pixels = () => {
                    const gl = a.ren.getContext(), w = a.ren.domElement.width, h = a.ren.domElement.height;
                    const p = new Uint8Array(w * h * 4);
                    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);
                    return p;
                };
                window.project = p => {
                    p.project(a.cam);
                    return [(p.x + 1) * a.ren.domElement.width / 2, (p.y + 1) * a.ren.domElement.height / 2];
                };
                window.measure = () => {
                    const inner = dividers().filter(m => m.material === a.mRsLaneDivider);
                    render(); const on = pixels();
                    for (const m of inner) m.visible = false;
                    render(); const off = pixels();
                    for (const m of inner) m.visible = true;
                    render();
                    const w = a.ren.domElement.width, h = a.ren.domElement.height;
                    const lines = inner.map(m => {
                        // Only the distant floor, clear of the foreground strings.
                        const lo = Math.max(-a.TS * a.AHEAD, m.position.z - m.scale.z / 2);
                        const hi = Math.min(-a.TS * 0.9, m.position.z + m.scale.z / 2);
                        const p = project(new a.T.Vector3(m.position.x, m.position.y + 0.075 * a.K, lo));
                        const q = project(new a.T.Vector3(m.position.x, m.position.y + 0.075 * a.K, hi));
                        let rows = 0, missing = 0, run = 0, longestGap = 0, peak = 0;
                        if (hi > lo) for (let y = Math.max(0, Math.ceil(Math.min(p[1], q[1])) + 2); y < Math.min(h, Math.floor(Math.max(p[1], q[1])) - 2); y++) {
                            const x = p[0] + (q[0] - p[0]) * (y + 0.5 - p[1]) / (q[1] - p[1]);
                            if (x < 3 || x >= w - 3) continue;
                            let delta = 0;
                            for (let sx = Math.floor(x) - 2; sx <= Math.floor(x) + 2; sx++) for (let c = 0; c < 3; c++) {
                                const i = (y * w + sx) * 4 + c;
                                delta = Math.max(delta, Math.abs(on[i] - off[i]));
                            }
                            rows++; peak = Math.max(peak, delta);
                            if (delta < 2) { missing++; longestGap = Math.max(longestGap, ++run); } else run = 0;
                        }
                        return { x: m.position.x, lo, hi, rows, missing, longestGap, peak, geometry: m.geometry.type, order: m.renderOrder, depthTest: m.material.depthTest, depthWrite: m.material.depthWrite };
                    });
                    return { canvas: [w, h], viewport: a.mRsLaneDivider.uniforms?.uViewport.value.toArray(), lines, meshes: dividers().length, calls: a.ren.info.render.calls, geometries: a.ren.info.memory.geometries };
                };
                r.draw(bundle); pose();
            }, size);
            if (!reference) check(await page.evaluate(() => __dividerPrewarmed > 0), size.name + ': divider shader was not precompiled');
            for (const angle of [0, 14 * Math.PI / 180]) {
                for (const shift of [0, 0.0004, 0.002]) {
                    const name = `${size.name}-${angle ? 'angled' : 'straight'}-${shift}`;
                    const result = await page.evaluate(({ angle, shift }) => { r.draw(bundle); pose(angle, shift); return measure(); }, { angle, shift });
                    results.push({ name, ...result });
                    if (!reference) {
                        check(result.lines.some(l => l.rows > 5), name + ': no measurable inner divider');
                        check(result.lines.every(l => l.missing === 0), name + ': missing distant divider pixels');
                        check(JSON.stringify(result.canvas) === JSON.stringify(result.viewport), name + ': stale drawing-buffer size');
                        check(result.lines.every(l => l.order === 2.01 && l.depthTest && !l.depthWrite), name + ': changed depth contract');
                    }
                    if (shift === 0) await page.screenshot({ path: path.join(out, name + '.png') });
                }
            }
            // Reuse the very same pool objects across styles and themes.
            for (const [style, theme, name] of [['current', 'default', 'current'], ['rsplus', 'forest', 'forest'], ['rsplus', 'default', 'roundtrip']]) {
                await page.evaluate(({ style, theme }) => { h3dBgSetNotationStyle(style); h3dBgSetHwTheme(theme); r.draw(bundle); pose(); render(); }, { style, theme });
                const geometry = await page.evaluate(() => dividers().map(m => ({ shader: !!m.material.isShaderMaterial, type: m.geometry.type, cull: m.frustumCulled })));
                if (!reference) check(geometry.every(m => m.shader ? m.type === 'PlaneGeometry' && !m.cull : m.type === 'BoxGeometry' && m.cull), size.name + '-' + name + ': pool geometry was not reset');
                await page.screenshot({ path: path.join(out, size.name + '-' + name + '.png') });
                if (name === 'roundtrip') {
                    check(hash(fs.readFileSync(path.join(out, size.name + '-straight-0.png'))) === hash(fs.readFileSync(path.join(out, size.name + '-roundtrip.png'))), size.name + ': style roundtrip changed output');
                }
            }
            if (size.name === '720') {
                // Anchor changes split otherwise continuous inner dividers. Check
                // GPU output against an unsplit segment, without altering production.
                const join = await page.evaluate(() => {
                    r.draw(bundle); pose(); render(); const before = pixels();
                    const m = dividers().find(m => m.material === a.mRsLaneDivider && Math.abs(m.position.x - a.xFret(10)) < 1e-6);
                    const total = m.scale.z, middle = m.position.z;
                    const copy = m.clone(); a.noteG.add(copy);
                    m.scale.z = copy.scale.z = total / 2;
                    m.position.z = middle - total / 4; copy.position.z = middle + total / 4;
                    render(); const after = pixels();
                    let changed = 0, maxDelta = 0;
                    for (let i = 0; i < before.length; i++) { const d = Math.abs(before[i] - after[i]); if (d) changed++; maxDelta = Math.max(maxDelta, d); }
                    a.noteG.remove(copy); m.scale.z = total; m.position.z = middle;
                    return { changed, maxDelta };
                });
                results.push({ name: 'segment-join', ...join });
                if (!reference) check(join.maxDelta <= 1, 'segment join creates a visible seam');
                // Playback/anchor transitions, fallback lane, live render-scale and viewport changes.
                const moving = await page.evaluate(() => {
                    bundle.anchors = [{ time: 0, fret: 9, width: 4 }, { time: 9.5, fret: 10, width: 5 }, { time: 11, fret: 8, width: 4 }];
                    const frames = [];
                    for (let i = 0; i < 18; i++) { bundle.currentTime = 8 + i * 0.2; r.draw(bundle); pose(0, i * 0.0001); frames.push(measure()); }
                    bundle.anchors = []; bundle.notes = [{ t: 12, s: 2, f: 9, sus: 0 }, { t: 12.2, s: 3, f: 12, sus: 0 }]; bundle.currentTime = 11.5;
                    r.draw(bundle); pose(); const fallback = measure();
                    bundle.renderScale = 0.75; r.draw(bundle); pose(); const scaled = measure();
                    return { frames, fallback, scaled };
                });
                results.push({ name: 'playback-fallback-scale', ...moving });
                if (!reference) for (const f of [...moving.frames, moving.fallback, moving.scaled]) {
                    check(f.lines.every(l => !l.missing), 'playback/fallback/scale: divider gap');
                    check(JSON.stringify(f.canvas) === JSON.stringify(f.viewport), 'live render scale: stale viewport');
                }
                await page.setViewportSize({ width: 800, height: 600 });
                const resized = await page.evaluate(() => { r.resize(800, 600); r.draw(bundle); pose(); return measure(); });
                results.push({ name: 'resized', ...resized });
                if (!reference) check(JSON.stringify(resized.canvas) === JSON.stringify(resized.viewport) && resized.lines.every(l => !l.missing), 'resize: divider coverage/viewport');
                const clipping = await page.evaluate(() => {
                    // A free camera may cross a segment. Exercise the real shader
                    // with one end behind its near plane, both ends behind, and
                    // a zero-length segment; no giant unclipped quads may remain.
                    const scene = new a.T.Scene(), cam = new a.T.PerspectiveCamera(60, 800 / 600, 0.01, 15);
                    const mesh = dividers().find(m => m.material === a.mRsLaneDivider).clone();
                    scene.add(mesh); cam.updateMatrixWorld(true);
                    mesh.visible = false; a.ren.render(scene, cam); const blank = pixels();
                    const changed = () => {
                        a.ren.render(scene, cam); const p = pixels(); let count = 0;
                        for (let i = 0; i < p.length; i += 4) if ([0, 1, 2].some(c => Math.abs(p[i + c] - blank[i + c]) > 2)) count++;
                        return count;
                    };
                    mesh.visible = true; mesh.position.set(0, -0.002, -0.5); mesh.scale.set(1, 1, 1.5);
                    const crossing = changed();
                    mesh.position.z = 0.5; mesh.scale.z = 0.5; const behind = changed();
                    mesh.position.z = -0.5; mesh.scale.z = 0; const zero = changed();
                    return { crossing, behind, zero, error: a.ren.getContext().getError() };
                });
                results.push({ name: 'near-clipping', ...clipping });
                if (!reference) check(clipping.crossing > 10 && clipping.crossing < 5000 && !clipping.behind && !clipping.zero && !clipping.error, 'near-plane or zero-length clipping failed');
                await page.evaluate(() => {
                    bundle.anchors = [{ time: 0, fret: 9, width: 4 }]; bundle.notes = []; bundle.currentTime = 8;
                    r.draw(bundle); pose(); render();
                });
                const memory = await page.evaluate(() => {
                    const state = () => ({ geometries: a.ren.info.memory.geometries, textures: a.ren.info.memory.textures, programs: a.ren.info.programs.length, objects: a.noteG.children.length, calls: a.ren.info.render.calls });
                    const before = state();
                    for (let i = 0; i < 60; i++) { bundle.currentTime += 1 / 60; r.draw(bundle); pose(0, i * 0.00002); render(); }
                    return { before, after: state() };
                });
                results.push({ name: 'steady-resources', ...memory });
                check(JSON.stringify(memory.before) === JSON.stringify(memory.after), 'steady frames grew GPU resources or draw calls');
            }
            await context.close();
        }
    } finally { await browser.close(); }
    if (option('--compare')) for (const file of fs.readdirSync(out).filter(f => /-(current|forest)\.png$/.test(f))) {
        check(hash(fs.readFileSync(path.join(out, file))) === hash(fs.readFileSync(path.join(option('--compare'), file))), file + ': unrelated style/theme changed');
    }
    const report = { sourceHash: hash(source), reference, results, errors, failures };
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ records: results.length, errors, failures }));
    if (errors.length || failures.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
