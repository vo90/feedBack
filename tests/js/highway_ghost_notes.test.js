'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
const draw = fs.readFileSync(path.join(root, 'static/js/highway-draw.js'), 'utf8');
const geometry = fs.readFileSync(path.join(root, 'static/js/highway-geometry.js'), 'utf8');
function extract(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw Error('Unbalanced function ' + name);
}
function load(src, name) { return new Function(extract(src, name) + '; return ' + name)(); }

test('actual Three geometry brackets the gem without a label or additional mesh', async () => {
    const T = await import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);
    const geo = load(screen, 'hwyGhostNoteOutlineGeometry')(T, 10, 8, 2);
    const { min, max } = geo.boundingBox;
    assert.ok(Math.abs(min.x + 7.4) < 1e-5 && Math.abs(max.x - 7.4) < 1e-5);
    assert.ok(Math.abs(min.y + 4.64) < 1e-5 && Math.abs(max.y - 4.64) < 1e-5);
    assert.equal(min.z, -1);
    assert.equal(max.z, 1);
    const positions = geo.attributes.position.array;
    assert.ok(Array.from(positions).every(Number.isFinite));
    assert.ok(Array.from(geo.attributes.normal.array).every(Number.isFinite));
    // Geometry has the original body and separate curved solids on both sides.
    assert.ok(Array.from(positions).filter((_, i) => i % 3 === 0).some(x => x < -6));
    assert.ok(Array.from(positions).filter((_, i) => i % 3 === 0).some(x => x > 6));
    assert.ok(geo.boundingSphere.radius > 7.4);
    const ghostCore = geo.clone();
    ghostCore.setAttribute('color', new T.BufferAttribute(
        new Float32Array(ghostCore.attributes.position.count * 3), 3));
    const plainCore = new T.BoxGeometry(10, 8, 2);
    plainCore.setAttribute('color', new T.BufferAttribute(
        new Float32Array(plainCore.attributes.position.count * 3), 3));
    // Execute the real palette update against actual BufferGeometry. Body
    // colors must remain the original gradient; brackets must be high contrast.
    new Function('T', 'plainCore', 'ghostCore', `
        const NW=10, NH=8, gNoteGrad=[plainCore], gNoteGhostGrad=[ghostCore];
        const activePalette=[0x0077ff], _customPalette=[];
        const DEFAULT_GEM_GRADIENTS=[[0x2299ff,0x004477]];
        ${extract(screen, '_recolorGemGradients')}
        _recolorGemGradients();`)(T, plainCore, ghostCore);
    const gp = ghostCore.attributes.position, gc = ghostCore.attributes.color;
    for (let i = 0; i < gp.count; i++) {
        if (Math.abs(gp.getX(i)) > 5.1) {
            assert.ok(gc.getX(i) > 0.8 && gc.getY(i) > 0.8 && gc.getZ(i) > 0.8);
        } else {
            const expected = new T.Color(0x004477).lerp(new T.Color(0x2299ff), (gp.getY(i) + 4) / 8);
            assert.ok(Math.abs(gc.getX(i) - expected.r) < 1e-6);
            assert.ok(Math.abs(gc.getY(i) - expected.g) < 1e-6);
            assert.ok(Math.abs(gc.getZ(i) - expected.b) < 1e-6);
        }
    }
    plainCore.dispose(); ghostCore.dispose();
    geo.dispose();
});

test('2D actual note path writes pitched and dead ghost labels without inferring ties', () => {
    const label = load(geometry, 'noteFretLabel');
    const rendered = [];
    const ctx = new Proxy({}, { get(target, key) {
        if (key in target) return target[key];
        return () => {};
    } });
    const drawNote = new Function('noteFretLabel', 'roundRect', 'fillTextReadable', '_paintGemGlow',
        extract(draw, 'drawNote') + '; return drawNote;')(
        label, () => {}, (_state, text) => rendered.push(text), () => {});
    const state = {ctx, STRING_COLORS: ['#f00'], STRING_DIM: ['#300'], STRING_BRIGHT: ['#fff']};
    // Small glyphs exercise the real shape/text path without unrelated teaching labels.
    for (const [fret, opts] of [[12, {ghost: true}], [7, {ghost: true, mt: true}],
        [17, {ln: true}], [12, {ghost: 'true'}], [0, {ghost: true}]]) {
        drawNote(state, 900, 900, 100, 100, 0.15, 0, fret, opts, null);
    }
    assert.deepEqual(rendered, ['(12)', '(X)', '17', '12', '(0)']);
    assert.equal(load(draw, '_noteHasTechniqueFlags')({ghost: true}), true);
    assert.equal(load(draw, '_noteHasTechniqueFlags')({ln: true}), false);
});

test('open ghost curves keep readable proportions around a thin slab and follow pooled colors', async () => {
    const T = await import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);
    const template = load(screen, 'hwyGhostNoteOutlineGeometry')(T, 10, 8, 2);
    template.setAttribute('color', new T.BufferAttribute(new Float32Array(template.attributes.position.count * 3).fill(.2), 3));
    const outline = new T.Mesh(template), core = new T.Mesh(template);
    const shape = load(screen, 'hwyShapeOpenGhostGeometry');
    const owned = [];
    const extent = (mesh, isBracket) => {
        let loX=Infinity, hiX=-Infinity, loY=Infinity, hiY=-Infinity;
        const base = template.attributes.position, p = mesh.geometry.attributes.position;
        for (let i=0; i<p.count; i++) {
            if ((Math.abs(base.getX(i)) > 5.1) !== isBracket) continue;
            const x=p.getX(i)*mesh.scale.x, y=p.getY(i)*mesh.scale.y;
            loX=Math.min(loX,x); hiX=Math.max(hiX,x); loY=Math.min(loY,y); hiY=Math.max(hiY,y);
        }
        return {width:hiX-loX, height:hiY-loY};
    };
    for (const bodyWidth of [80, 160]) {
        outline.scale.set(bodyWidth/10*.9625,.165,.66);
        core.scale.set(bodyWidth/10,.15,.6);
        shape(outline,template,bodyWidth,1.1,10,owned);
        shape(core,template,bodyWidth,1,10,owned);
        assert.ok(Math.abs(extent(core,false).height-1.2)<1e-5,'open body stays thin');
        assert.ok(Math.abs(extent(core,false).width-bodyWidth)<1e-5);
        assert.ok(Math.abs(extent(core,true).height-9.28)<1e-5,'curves do not inherit slab flattening');
        assert.ok(Math.abs(extent(core,true).width-(bodyWidth+4.8))<1e-5,'curve width does not stretch with the lane');
        assert.ok(Math.abs(extent(outline,true).width-(bodyWidth+5.28))<1e-5);
    }
    assert.equal(owned.length,2,'one geometry per mesh, no width-keyed cache growth');
    const register = new Function(`
        const NW=10,NH=8,ND=2;
        const _trailOrderGems=[],_trailOrderGemBuckets=[[]],_trailOrderGemBucketCounts=[0];
        let _trailOrderGemCount=0; const trailOrderDepthBucket=()=>0;
        ${extract(screen,'trailOrderRegisterUpcomingGem')}
        return (outline,core)=>{trailOrderRegisterUpcomingGem({s:0,f:0,ghost:true,mt:true},1,{},outline,core);return _trailOrderGems.at(-1);};`)();
    for (const rotation of [0,Math.PI/2]) {
        outline.rotation.z=core.rotation.z=rotation;
        const r=register(outline,core);
        assert.ok(Math.abs((rotation ? r.height : r.width)-165.28)<1e-5);
        assert.ok(Math.abs((rotation ? r.width : r.height)-10.208)<1e-5,
            'ordering encloses readable curves even on a muted chord/open note');
    }
    core.scale.multiplyScalar(1.22);
    shape(core,template,160*1.22,1.22,10,owned);
    assert.ok(Math.abs(extent(core,true).height-9.28*1.22)<1e-5,'whole-note hit scale remains inherited');
    const firstGeometry=core.geometry;
    template.attributes.color.array.fill(.75);
    template.attributes.color.needsUpdate=true;
    shape(core,template,160*1.22,1.22,10,owned);
    assert.equal(core.geometry,firstGeometry);
    assert.equal(core.geometry.attributes.color.getX(0),.75,'palette changes refresh cached geometry');
    const anotherString=template.clone();
    anotherString.attributes.color.array.fill(.5);
    shape(core,anotherString,160*1.22,1.22,10,owned);
    assert.equal(core.geometry.attributes.color.getX(0),.5,'pool reuse cannot retain another string color');
    assert.equal(owned.length,2);
    for(const g of owned)g.dispose();
    template.dispose(); anotherString.dispose();
});

test('repeat simplification retains ghost cues but does not manufacture tied attacks', () => {
    const fns = ['noteHasVibrato', 'noteHasVisibleMotionSustain', 'noteHasRepeatTechniqueCue',
        'chordMuteKind', 'repeatChordMaySuppressGems', 'hwyShouldSuppressNoteBody'];
    const slideHelpers = screen.slice(screen.indexOf('    function slideTrailEnd('),
        screen.indexOf('    // Camera tgtDist building blocks'));
    const api = new Function(slideHelpers + fns.map(n => extract(screen, n)).join('\n')
        + '; return {repeatChordMaySuppressGems, hwyShouldSuppressNoteBody};')();
    assert.equal(api.repeatChordMaySuppressGems(true, false, [{ghost: true}]), false);
    assert.equal(api.repeatChordMaySuppressGems(true, false, [{ghost: true, mt: true}]), false);
    assert.equal(api.repeatChordMaySuppressGems(true, false, [{}]), true);
    for (const dt of [2, 0, -0.2]) {
        assert.equal(api.hwyShouldSuppressNoteBody(false, true, dt), true,
            'an explicit continuation must never acquire another attack');
    }
});

test('chord scratch resets the omitted ghost field after a marked member', () => {
    const statement = screen.match(/_scrChordNote\.ghost = cn\.ghost === true;/)?.[0];
    assert.ok(statement);
    const assign = new Function('_scrChordNote', 'cn', 'Object.assign(_scrChordNote, cn);' + statement);
    const scratch = {};
    assign(scratch, {f: 7, ghost: true, mt: true});
    assert.equal(scratch.ghost, true);
    assign(scratch, {f: 9});
    assert.equal(scratch.ghost, false);
});

test('ghost geometry stays under the existing body, culling and physical-order gates', () => {
    const body = extract(screen, 'drawNote');
    const outline = body.indexOf('outline.geometry = n.ghost === true');
    assert.ok(outline > body.indexOf('if (!effSkipBody'));
    assert.ok(outline < body.indexOf('trailYieldRegisterGem('));
    assert.ok(outline < body.indexOf('trailOrderRegisterUpcomingGem('));
    assert.doesNotMatch(body, /sourceTechniqueLabel|txtMat\(['"]\(/);
    // Shape changes only; source x/y, rotation, material, depth and label settings
    // continue through the same outline mesh and ordering callback.
    const ordered = extract(screen, 'trailYieldApplyBehindLayerRecord');
    assert.match(ordered, /outline\.renderOrder = Number\.isFinite\(coveringRenderOrder\)/);
    assert.match(body, /outline\.position\.set\(x, y \+ techniqueYNow, noteZ\)/);
    assert.match(body, /outline\.rotation\.z = approachRot/);
    assert.match(body, /core\.geometry = n\.ghost === true/);
});

test('rotated ghost bounds enter the actual upcoming-gem ordering index', () => {
    const register = new Function(`
        const NW = 10, NH = 8, ND = 2;
        const _trailOrderGems = [], _trailOrderGemBuckets = [[]], _trailOrderGemBucketCounts = [0];
        let _trailOrderGemCount = 0;
        const trailOrderDepthBucket = () => 0;
        ${extract(screen, 'trailOrderRegisterUpcomingGem')}
        return (n, mesh, core = mesh) => {
            trailOrderRegisterUpcomingGem(n, 1, {}, mesh, core);
            return _trailOrderGems[_trailOrderGemCount - 1];
        };`)();
    const mesh = {scale: {x: 1, y: 1, z: 1}, position: {x: 2, y: 3, z: -5}, rotation: {z: 0}};
    let record = register({s: 2, ghost: true}, mesh);
    assert.equal(record.width, 14.8);
    assert.equal(record.height, 9.28);
    mesh.rotation.z = Math.PI / 2;
    record = register({s: 2, ghost: true}, mesh);
    assert.ok(Math.abs(record.width - 9.28) < 1e-9);
    assert.ok(Math.abs(record.height - 14.8) < 1e-9);
    assert.ok(Math.abs(register({s: 2}, mesh).width - 8) < 1e-9);

    const outline = {scale: {x: 3.85, y: 0.165, z: 0.66},
        position: {x: 0, y: 3, z: -5}, rotation: {z: 0}};
    const core = {scale: {x: 4, y: 0.15, z: 0.6},
        position: {x: 0, y: 3, z: -4.999}, rotation: {z: 0}};
    record = register({s: 2, ghost: true, f: 0}, outline, core);
    assert.ok(Math.abs(record.width - 40 * 1.48) < 1e-9,
        'wide open core brackets must not be clipped to the narrower outline');
    outline.rotation.z = core.rotation.z = Math.PI / 2;
    record = register({s: 2, ghost: true, f: 0}, outline, core);
    assert.ok(Math.abs(record.height - 40 * 1.48) < 1e-9,
        'the union must rotate with both actual meshes');
    core.scale.x *= 1.22; core.scale.y *= 1.22; core.scale.z *= 1.22;
    core.position.x += 0.1;
    record = register({s: 2, ghost: true, f: 0}, outline, core);
    assert.ok(Math.abs(record.height - 40 * 1.48 * 1.22) < 1e-9,
        'hit scaling belongs to the physical footprint too');
    assert.ok(record.x > 0 && record.zHalf > 0.66);
});

test('the chart footprint index retains a ghost on either coincident source', () => {
    const build = new Function('const NFRETS=24;' + extract(screen, 'hwyBuildTrailYieldEvents')
        + '; return hwyBuildTrailYieldEvents;')();
    const a = build([{t: 1, s: 0, f: 7}], [{t: 1, notes: [{s: 0, f: 7, ghost: true}]}], 6);
    assert.equal(a[7].length, 1);
    assert.equal(a[7][0].ghost, true);
    assert.equal(build([{t: 1, s: 0, f: 7, ln: true}], [], 6)[7][0].ghost, false);
});
