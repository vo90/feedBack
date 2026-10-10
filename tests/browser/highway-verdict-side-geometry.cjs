// Actual Three renderer parity; isolated fixture, no app/profile/song library.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8');
const hook = "contextType: 'webgl2',";
assert.equal(source.split(hook).length, 2);
const served = source.replace(hook, `__verdictAudit() { return {
    T, ren, scene, cam, gNote, gNoteEdge, pNoteEdge, mEdgeTransparent,
    mHitBright, mMissOutline, K, NW, NH, ND,
}; }, ${hook}`);

test('verdict sides preserve geometry, pixels and depth/order while removing five calls per mesh', async () => {
    const browser = await chromium.launch({ headless: true,
        args: ['--enable-unsafe-swiftshader'],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 640, height: 320 } });
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== 'http://verdict-fixture.test') {
                return route.fulfill({ status: 403, body: 'External network blocked' });
            }
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
                '<!doctype html><style>html,body{margin:0}#host{position:relative;width:100vw;height:100vh}canvas{width:100%;height:100%;display:block}</style><div id="host"><canvas id="highway"></canvas></div><script src="/screen.js"></script>' });
            if (url.pathname === '/screen.js') return route.fulfill({ contentType: 'text/javascript', body: served });
            const file = path.resolve(repo, '.' + decodeURIComponent(url.pathname));
            if (file.startsWith(repo + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
                return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(file) });
            }
            return route.fulfill({ status: 404, body: 'Missing fixture asset' });
        });
        await page.goto('http://verdict-fixture.test');
        const result = await page.evaluate(async () => {
            const failures = [], cases = [];
            const check = (ok, message) => { if (!ok) failures.push(message); };
            for (const [key, value] of Object.entries({ style: 'off', notationStyle: 'current',
                glow: 0.4, bloom: false, cinematic: false, chordDiagramVisible: false,
                projectionVisible: false, sparks: false, verdictMarks: false, fpsVisible: false })) {
                localStorage.setItem('h3d_bg_' + key, String(value));
            }
            const verdict = note => ({ state: note.s % 2 ? 'hit' : 'miss', alpha: 0.7 });
            const bundle = { currentTime: 8, isPlaying: false, playbackRate: 1,
                notes: [], chords: [], chordTemplates: [], handShapes: [], beats: [], sections: [], lyrics: [],
                anchors: [{ time: 0, fret: 3, width: 5 }], stringCount: 6, tuning: Array(6).fill(0),
                songInfo: { arrangement: 'Lead' }, lefty: false, inverted: false,
                renderScale: 1, bgReactive: false, getNoteState: verdict, getNoteStateProvider: () => verdict };
            const renderer = feedBackViz_highway_3d();
            renderer.init(document.getElementById('highway'), bundle);
            await renderer.readyPromise;
            const a = renderer.__verdictAudit(), T = a.T;
            check(a.gNoteEdge !== a.gNote, 'side geometry does not change the playable box');
            check(a.gNote.groups.length === 6 && a.gNote.drawRange.count === Infinity, 'ordinary box stays complete');
            check(a.gNoteEdge.groups.length === 0 && a.gNoteEdge.drawRange.start === 0
                && a.gNoteEdge.drawRange.count === 24, 'side geometry is a single range');
            check([...a.gNoteEdge.index.array].every((v, i) => v === a.gNote.index.array[i]), 'identical original triangle indices');
            for (const name of ['position', 'normal', 'uv']) {
                check([...a.gNoteEdge.attributes[name].array].every((v, i) => v === a.gNote.attributes[name].array[i]),
                    'identical ' + name + ' attributes');
            }
            check(a.gNote.groups.slice(0, 4).every((g, i) => g.start === i * 6 && g.count === 6),
                'the range covers exactly the four original lateral faces');
            const pixels = () => {
                const gl = a.ren.getContext(), canvas = a.ren.domElement;
                const bytes = new Uint8Array(canvas.width * canvas.height * 4);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
                return bytes;
            };
            const render = () => { a.ren.render(a.scene, a.cam); return { bytes: pixels(), calls: a.ren.info.render.calls }; };
            const compare = (label, edges) => {
                for (const mesh of edges) mesh.updateMatrix();
                const saved = edges.map(mesh => ({ mesh, geometry: mesh.geometry, material: mesh.material,
                    order: mesh.renderOrder, matrix: mesh.matrix.toArray() }));
                const candidate = render();
                for (const item of saved) {
                    const m = item.material;
                    item.mesh.geometry = a.gNote;
                    item.mesh.material = [m, m, m, m, a.mEdgeTransparent, a.mEdgeTransparent];
                }
                const reference = render();
                for (const item of saved) {
                    item.mesh.geometry = item.geometry; item.mesh.material = item.material;
                    check(item.mesh.renderOrder === item.order && item.mesh.matrix.toArray().every((v, i) => v === item.matrix[i]),
                        label + ': same transform/order');
                    check(item.material.depthWrite === false && item.material.depthTest === false, label + ': same depth state');
                }
                let changed = 0;
                for (let i = 0; i < candidate.bytes.length; i++) if (candidate.bytes[i] !== reference.bytes[i]) changed++;
                check(changed === 0, label + ': ' + changed + ' differing bytes');
                check(reference.calls - candidate.calls === 5 * edges.length, label + ': five fewer draws per verdict mesh');
                // The scene actually contains visible side-fill pixels; an empty
                // or fully hidden fixture cannot pass the parity test by accident.
                for (const mesh of edges) mesh.visible = false;
                const disabled = render();
                for (const mesh of edges) mesh.visible = true;
                let sidePixels = 0;
                for (let i = 0; i < candidate.bytes.length; i += 4) {
                    if (candidate.bytes[i] !== disabled.bytes[i] || candidate.bytes[i + 1] !== disabled.bytes[i + 1]
                        || candidate.bytes[i + 2] !== disabled.bytes[i + 2]) sidePixels++;
                }
                check(sidePixels > 0, label + ': measurable side fill');
                cases.push({ label, visibleEdges: edges.length, changedBytes: changed, sidePixels,
                    beforeCalls: reference.calls, afterCalls: candidate.calls });
            };
            for (const style of ['current', 'rsplus']) for (const strings of [4, 6, 8]) {
                h3dBgSetNotationStyle(style);
                bundle.stringCount = strings; bundle.tuning = Array(strings).fill(0);
                bundle.notes = Array.from({ length: strings }, (_, s) => ({
                    t: 7.99 + s * 0.003, s, f: s === 0 ? 0 : 3 + s % 4, sus: 0.9,
                    ac: s === strings - 1, bn: s === 2 ? 1 : 0,
                }));
                for (const lefty of [false, true]) for (const inverted of [false, true]) {
                    bundle.lefty = lefty; bundle.inverted = inverted;
                    renderer.draw(bundle);
                    const edges = []; a.pNoteEdge.forEachActive(mesh => edges.push(mesh));
                    check(edges.length === strings, `${style}/${strings}: verdict count`);
                    // Keep every test edge in the frustum, with both visible
                    // sides and ordinary neighboring note/trail meshes present.
                    const center = new T.Vector3();
                    for (const mesh of edges) center.add(mesh.position);
                    center.multiplyScalar(1 / Math.max(1, edges.length));
                    a.cam.fov = 48; a.cam.aspect = 2;
                    a.cam.updateProjectionMatrix();
                    a.cam.position.copy(center).add(new T.Vector3(lefty ? -.18 : .18, .25, .75));
                    a.cam.lookAt(center); a.cam.updateMatrixWorld(true);
                    compare(`${style}/${strings}/lefty=${lefty}/inverted=${inverted}`, edges);
                }
            }
            // Force depth/ordering interactions without changing the production
            // mesh transforms between reference and candidate renders.
            const edges = []; a.pNoteEdge.forEachActive(mesh => edges.push(mesh));
            const group = new T.Group(); a.scene.add(group);
            for (const [order, z, transparent] of [[edges[0].renderOrder - .001, .01, true],
                [edges[0].renderOrder + .001, -.01, true], [0, .02, false]]) {
                const mesh = new T.Mesh(new T.BoxGeometry(.12, .11, .006),
                    new T.MeshBasicMaterial({ color: 0x819bc4, transparent, opacity: transparent ? .35 : 1, depthWrite: !transparent }));
                mesh.position.copy(edges[0].position); mesh.position.z += z;
                mesh.renderOrder = order; group.add(mesh);
            }
            for (const mesh of edges) mesh.rotation.z = .73;
            compare('overlapping depth writers and transparent neighbors; rotated sides', edges);
            for (const material of [a.mMissOutline, ...a.mHitBright]) material.opacity = .35;
            compare('translucent verdict materials retain face blending order', edges);
            a.ren.localClippingEnabled = true;
            for (const material of [a.mMissOutline, ...a.mHitBright]) {
                material.clippingPlanes = [new T.Plane(new T.Vector3(0, 1, 0), -edges[0].position.y)];
            }
            compare('partial side clipping with transparent neighbors', edges);
            group.traverse(mesh => { mesh.geometry?.dispose(); mesh.material?.dispose(); }); a.scene.remove(group);
            bundle.getNoteState = () => null; bundle.getNoteStateProvider = () => null;
            bundle.notes = bundle.notes.map(note => ({ ...note, t: 8.3, sus: 0 }));
            renderer.draw(bundle);
            let active = 0; a.pNoteEdge.forEachActive(() => active++);
            check(active === 0, 'notes without a verdict do not use side-fill slots');
            let disposed = 0; a.gNoteEdge.addEventListener('dispose', () => disposed++);
            renderer.destroy();
            check(disposed > 0, 'side geometry disposed with renderer');
            return { failures, cases };
        });
        assert.deepEqual(errors, [], 'browser errors');
        assert.deepEqual(result.failures, [], JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ cases: result.cases.length,
            changedBytes: result.cases.reduce((sum, r) => sum + r.changedBytes, 0),
            minDrawsSaved: Math.min(...result.cases.map(r => r.beforeCalls - r.afterCalls)),
            maxDrawsSaved: Math.max(...result.cases.map(r => r.beforeCalls - r.afterCalls)),
            minVisibleSidePixels: Math.min(...result.cases.map(r => r.sidePixels)) }));
    } finally { await browser.close(); }
});
