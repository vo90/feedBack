const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function factory() {
    const document = {
        createElement() {
            const calls = [];
            const context = { calls };
            for (const method of ['beginPath', 'closePath', 'save', 'restore', 'scale', 'translate',
                'moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'ellipse', 'fill', 'stroke', 'fillText', 'strokeText']) {
                context[method] = function (...args) {
                    calls.push({ method, args, fill: this.fillStyle, stroke: this.strokeStyle, width: this.lineWidth });
                };
            }
            return { context, getContext() { return context; } };
        },
    };
    class Material {
        constructor(props) { Object.assign(this, props); this.userData = {}; }
        clone() { return new Material(this); }
        dispose() { this.disposed = true; }
    }
    const T = { SpriteMaterial: Material, MeshBasicMaterial: Material,
        CanvasTexture: class { constructor(image) { this.image = image; } }, DoubleSide: 2 };
    return new Function('document', 'T', `
        const txtCache = {}, _techMeshMatClones = new Set();
        ${fn('rsPlusTechniqueFlags')}
        ${fn('rsPlusTechniqueCells')}
        ${fn('drawRsPlusTechniqueGlyph')}
        ${fn('rsPlusTechniqueMat')}
        ${fn('_spriteMat2MeshMat')}
        return { flags: rsPlusTechniqueFlags, cells: rsPlusTechniqueCells,
            mat: rsPlusTechniqueMat, meshMat: _spriteMat2MeshMat, txtCache, clones: _techMeshMatClones };
    `)(document, T);
}

test('compound attack marks retain every supported family without intersecting face cells', () => {
    const f = factory();
    const note = Object.freeze({ po: true, ho: true, tp: true, slp: true, plk: true,
        pm: true, fhm: true, hm: true, hp: true });
    const cells = f.cells(f.flags(note));
    assert.deepEqual(cells.map(c => c.kind), ['pullOff', 'slap', 'pop', 'fretHandMute', 'naturalHarmonic']);
    for (const a of cells) {
        assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1 && a.y + a.h <= 1);
        for (const b of cells) {
            if (a === b) continue;
            const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
                * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
            assert.equal(area, 0, 'technique cells cannot cover one another');
        }
    }
    assert.equal(f.flags({ ac: true, bn: 1, tr: true }), 0, 'accent and sustain flags do not invent attack glyphs');
});

test('tap stays angular while slap and pop have opposite curved silhouettes', () => {
    const f = factory();
    const calls = kind => f.mat(kind).map.image.context.calls;
    assert.equal(calls('tap').filter(c => c.method === 'quadraticCurveTo').length, 0);
    const slap = calls('slap').filter(c => c.method === 'quadraticCurveTo');
    const pop = calls('pop').filter(c => c.method === 'quadraticCurveTo');
    assert.equal(slap.length, 4);
    assert.equal(pop.length, 4);
    for (let i = 0; i < slap.length; i++) {
        assert.equal(slap[i].args[0], pop[i].args[0]);
        assert.ok(Math.abs(slap[i].args[1] + pop[i].args[1] - 1) < 1e-12);
        assert.ok(Math.abs(slap[i].args[3] + pop[i].args[3] - 1) < 1e-12);
    }
});

test('mute and harmonic masks keep contrasting strokes and genuinely hollow centers', () => {
    const f = factory();
    const strokes = kind => f.mat(kind).map.image.context.calls.filter(c => c.method === 'stroke');
    assert.deepEqual(strokes('palmMute').map(c => c.stroke), ['#fff5d6', '#17212b']);
    assert.deepEqual(strokes('fretHandMute').map(c => c.stroke), ['#17212b', '#fff5d6']);
    for (const kind of ['naturalHarmonic', 'pinchHarmonic']) {
        const mat = f.mat(kind), ctx = mat.map.image.context;
        assert.equal(ctx.calls.some(c => c.method === 'fill'), false, 'harmonic center remains transparent');
        assert.equal(ctx.shadowBlur, undefined, 'no baked blur');
        assert.equal(mat.opacity, 1);
        assert.equal(mat.fog, false);
        assert.equal(mat.toneMapped, false);
    }
});

test('RS+ masks reuse textures and preserve their sharp material policy on pooled planes', () => {
    const f = factory(), mask = f.flags({ ho: true, hm: true });
    const sm = f.mat(mask);
    assert.equal(sm, f.mat(mask));
    assert.notEqual(sm, f.mat(f.flags({ po: true, hm: true })));
    assert.equal(sm.map.image.width, 512);
    const mesh = { userData: {}, material: { dispose() {} } };
    const converted = f.meshMat(mesh, sm);
    assert.equal(converted, f.meshMat(mesh, sm));
    assert.equal(converted.map, sm.map);
    assert.equal(converted.fog, false);
    assert.equal(converted.toneMapped, false);
    assert.equal(f.clones.size, 1);
    assert.ok(Object.values(f.txtCache).includes(sm), 'shared teardown owns the new mask');
    const legacy = { map: {}, userData: {} };
    const restored = f.meshMat(mesh, legacy);
    assert.equal(restored.fog, true, 'switching to Current restores its material policy');
    assert.equal(restored.toneMapped, true);
});

test('bend amount cue retains fractional semitones instead of rounding or converting units', () => {
    const f = factory();
    for (const value of [0.25, 0.5, 1, 1.5, 2.25, 5]) {
        const sm = f.mat('bendAmount', value);
        const labels = sm.map.image.context.calls.filter(c => c.method === 'fillText');
        assert.deepEqual(labels.map(c => c.args[0]), [String(value) + ' st']);
        assert.equal(f.mat('bendAmount', value), sm);
    }
});

test('RS+ bend direction moves the chevron while leaving the exact amount upright', () => {
    const f = factory();
    const start = src.indexOf('                if (_bendPeak > 0) {');
    const end = src.indexOf('\n                if (rsPlusNotation) {', start);
    assert.ok(start >= 0 && end > start);
    const run = new Function('f', 'dir', 'peak', `
        const rsPlusNotation=true, _bendPeak=peak, NH=1, NW=2, K=.1, x=5, y=10,
            techniqueYNow=.5, noteZ=-1, approachRot=.2, s=0;
        const activePalette=[0xffffff], techniqueMarkerRenderOrder=20, meshes=[];
        const pTechPlane={get:()=>{ const m={ material:{}, scale:{set(){}},
            position:{set(x,y,z){this.x=x;this.y=y;}}, rotation:{} }; meshes.push(m); return m; }};
        const rsPlusTechniqueMat=f.mat, _spriteMat2MeshMat=(m,sm)=>sm, bendVisualDirY=()=>dir;
        let yo=11;
        ${src.slice(start, end)}
        return meshes;
    `);
    for (const direction of [-1, 1]) {
        const [chevron, amount] = run(f, direction, 0.5);
        assert.equal(Math.sign(chevron.position.y - 10.5), direction);
        assert.equal(amount.rotation.z, 0);
        assert.equal(amount.material.map.image.context.calls.find(c => c.method === 'fillText').args[0], '0.5 st');
    }
});
