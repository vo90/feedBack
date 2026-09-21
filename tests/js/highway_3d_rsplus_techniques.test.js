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
        CanvasTexture: class { constructor(image) { this.image = image; } dispose() { this.disposed = true; } },
        DoubleSide: 2, SRGBColorSpace: 'srgb' };
    return new Function('document', 'T', `
        const _techMatCache = new Map(), _techMeshMatClones = new Set();
        ${fn('rsPlusTechniqueFlags')}
        ${fn('rsPlusTechniqueCells')}
        ${fn('rsPlusTechniqueColor')}
        ${fn('drawRsPlusTechniqueGlyph')}
        ${fn('rsPlusTechniqueMat')}
        ${fn('rsPlusNoteFaceMat')}
        ${fn('_spriteMat2MeshMat')}
        return { flags: rsPlusTechniqueFlags, cells: rsPlusTechniqueCells,
            mat: rsPlusTechniqueMat, faceMat: rsPlusNoteFaceMat, meshMat: _spriteMat2MeshMat,
            cache: _techMatCache, clones: _techMeshMatClones };
    `)(document, T);
}

test('compound attack marks retain every supported family and square proportions', () => {
    const f = factory();
    const note = Object.freeze({ po: true, ho: true, tp: true, slp: true, plk: true,
        pm: true, fhm: true, hm: true, hp: true });
    const cells = f.cells(f.flags(note));
    assert.deepEqual(cells.map(c => c.kind), ['pullOff', 'slap', 'pop', 'fretHandMute', 'naturalHarmonic']);
    for (const a of cells) {
        assert.equal(a.w, a.h, 'uniform scale preserves the glyph proportions');
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

// Conservative bounds of the actual paths, including rounded stroke caps.
// Cell padding may overlap; the painted symbols must not intersect or clip.
function inkBounds(calls) {
    let pathBounds;
    const result = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const point = (x, y) => {
        pathBounds.minX = Math.min(pathBounds.minX, x);
        pathBounds.minY = Math.min(pathBounds.minY, y);
        pathBounds.maxX = Math.max(pathBounds.maxX, x);
        pathBounds.maxY = Math.max(pathBounds.maxY, y);
    };
    for (const { method, args, width } of calls) {
        if (method === 'beginPath') pathBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        else if (method === 'moveTo' || method === 'lineTo') point(...args);
        else if (method === 'quadraticCurveTo') { point(...args.slice(0, 2)); point(...args.slice(2, 4)); }
        else if (method === 'arc' || method === 'ellipse') {
            const [x, y, rx] = args, ry = method === 'arc' ? rx : args[3];
            point(x - rx, y - ry); point(x + rx, y + ry);
        } else if (method === 'stroke' || method === 'fill') {
            const pad = method === 'stroke' ? width / 2 : 0;
            result.minX = Math.min(result.minX, pathBounds.minX - pad);
            result.minY = Math.min(result.minY, pathBounds.minY - pad);
            result.maxX = Math.max(result.maxX, pathBounds.maxX + pad);
            result.maxY = Math.max(result.maxY, pathBounds.maxY + pad);
        }
    }
    return result;
}

// Inspect the actual compound mask, including its cell-dependent strokes.
function glyphCalls(material) {
    const groups = [];
    let group;
    for (const call of material.map.image.context.calls) {
        if (call.method === 'save') { group = []; groups.push(group); }
        else if (call.method === 'restore') group = null;
        else if (group) group.push(call);
    }
    return groups;
}

test('every supported 2–5 symbol combination stays square with separate unclipped ink', () => {
    const f = factory(), seenCounts = new Set();
    for (const attack of [{}, { ho: true }, { po: true }, { tp: true }]) {
        for (const slp of [false, true]) for (const plk of [false, true]) {
            for (const mute of [{}, { pm: true }, { fhm: true }]) {
                for (const harmonic of [{}, { hm: true }, { hp: true }]) {
                    const flags = f.flags({ ...attack, slp, plk, ...mute, ...harmonic });
                    const cells = f.cells(flags);
                    if (cells.length < 2) continue;
                    seenCounts.add(cells.length);
                    const painted = glyphCalls(f.faceMat(flags, 0xffcc00));
                    assert.equal(painted.length, cells.length, 'each family is painted once');
                    const ink = cells.map((cell, index) => {
                        assert.equal(cell.w, cell.h, cell.kind);
                        assert.deepEqual(painted[index].find(c => c.method === 'translate').args, [cell.x, cell.y]);
                        assert.deepEqual(painted[index].find(c => c.method === 'scale').args, [cell.w, cell.h]);
                        const bounds = inkBounds(painted[index]);
                        return { minX: cell.x + bounds.minX * cell.w, maxX: cell.x + bounds.maxX * cell.w,
                            minY: cell.y + bounds.minY * cell.h, maxY: cell.y + bounds.maxY * cell.h };
                    });
                    for (const a of ink) {
                        assert.ok(a.minX > 0.005 && a.minY > 0.005 && a.maxX < 0.995 && a.maxY < 0.995,
                            'painted ink needs antialiasing room at the texture edges');
                        for (const b of ink) if (a !== b) {
                            assert.ok(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY,
                                'painted techniques must remain separate');
                        }
                    }
                    if (cells.length % 2 === 1) {
                        const last = cells.at(-1);
                        assert.equal(last.x + last.w / 2, 0.5, 'center an incomplete final row');
                    }
                }
            }
        }
    }
    assert.deepEqual([...seenCounts].sort(), [2, 3, 4, 5]);
});

test('reduced face cells strengthen fine strokes without losing mute contrast or harmonic holes', () => {
    const f = factory();
    for (const note of [
        { tp: true, pm: true },
        { ho: true, pm: true, hp: true },
        { po: true, slp: true, pm: true, hm: true },
        { tp: true, slp: true, plk: true, pm: true, hp: true },
    ]) {
        const flags = f.flags(note), cells = f.cells(flags);
        const groups = glyphCalls(f.faceMat(flags, 0xffcc00));
        for (let i = 0; i < cells.length; i++) {
            const kind = cells[i].kind, calls = groups[i];
            const strokes = calls.filter(c => c.method === 'stroke');
            const standalone = f.mat(kind, 0xffcc00).map.image.context.calls.filter(c => c.method === 'stroke');
            assert.equal(strokes.length, standalone.length);
            strokes.forEach((stroke, j) => {
                assert.equal(stroke.stroke, standalone[j].stroke, 'the symbol palette is preserved');
                assert.ok(stroke.width > standalone[j].width, 'reduced cells strengthen each stroke');
                assert.ok(stroke.width <= standalone[j].width * 1.5, 'bounded weight avoids flooding small cells');
            });
            if (kind === 'palmMute') {
                assert.equal(strokes[0].stroke, '#fff8f6');
                assert.equal(strokes[1].stroke, '#614e00');
                assert.ok(strokes[0].width > strokes[1].width * 1.8, 'PM keeps a clear pale edge and dark core');
            }
            if (kind === 'naturalHarmonic' || kind === 'pinchHarmonic') {
                assert.equal(calls.some(c => c.method === 'fill'), false);
                for (const curve of calls.filter(c => c.method === 'arc' || c.method === 'ellipse')) {
                    const radius = curve.method === 'arc' ? curve.args[2] : Math.min(curve.args[2], curve.args[3]);
                    assert.ok(radius - strokes[0].width / 2 > 0.09, 'the hollow center survives compensated outlines');
                }
            }
        }
    }
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

test('triangles are opposite solid pale string tints and tap keeps its own string tint', () => {
    const f = factory();
    const calls = kind => f.mat(kind, 0xee2233).map.image.context.calls;
    const ho = calls('hammerOn').filter(c => c.method === 'moveTo' || c.method === 'lineTo');
    const po = calls('pullOff').filter(c => c.method === 'moveTo' || c.method === 'lineTo');
    for (let i = 0; i < ho.length; i++) {
        assert.equal(ho[i].args[0], po[i].args[0]);
        assert.ok(Math.abs(ho[i].args[1] + po[i].args[1] - 1) < 1e-12);
    }
    assert.equal(calls('hammerOn').find(c => c.method === 'fill').fill, '#fac1c6');
    assert.equal(calls('hammerOn').find(c => c.method === 'stroke').stroke, '#18222c',
        'a thin dark contour protects the pale triangle');
    const greenTap = f.mat('tap', 0x22cc44).map.image.context.calls.find(c => c.method === 'fill').fill;
    assert.equal(greenTap, '#b4eebf');
    for (const kind of ['slap', 'pop']) {
        assert.equal(calls(kind).find(c => c.method === 'fill').fill, '#ffe593', 'bass attack keeps the guide’s warm gold');
    }
});

test('mute masks distinguish an outlined string-dark PM from a solid pale FH, with hollow harmonics', () => {
    const f = factory();
    const strokes = kind => f.mat(kind, 0xff0000).map.image.context.calls.filter(c => c.method === 'stroke');
    assert.deepEqual(strokes('palmMute').map(c => c.stroke), ['#fff8f6', '#610000']);
    assert.deepEqual(strokes('fretHandMute').map(c => c.stroke), ['#18222c', '#fff8f6']);
    const pm = f.mat('palmMute').map.image.context.calls.find(c => c.method === 'moveTo');
    const fh = f.mat('fretHandMute').map.image.context.calls.find(c => c.method === 'moveTo');
    assert.ok(pm.args[0] < fh.args[0], 'PM spans wider than FH');
    for (const kind of ['naturalHarmonic', 'pinchHarmonic']) {
        const mat = f.mat(kind), ctx = mat.map.image.context;
        assert.equal(ctx.calls.some(c => c.method === 'fill'), false, 'harmonic center remains transparent');
        assert.equal(ctx.shadowBlur, undefined, 'no baked blur');
        assert.equal(mat.opacity, 1);
        assert.equal(mat.fog, false);
        assert.equal(mat.toneMapped, false);
    }
});

test('RS+ masks reuse per-palette textures and preserve their sharp material policy on pooled planes', () => {
    const f = factory(), mask = f.flags({ ho: true, hm: true });
    const sm = f.faceMat(mask, 0x112233);
    assert.equal(sm, f.faceMat(mask, 0x112233));
    assert.notEqual(sm, f.faceMat(mask, 0x334455));
    assert.notEqual(sm, f.mat(f.flags({ po: true, hm: true })));
    const cached = f.cache.size;
    for (let i = 0; i < 5000; i++) assert.equal(f.faceMat(mask, 0x112233), sm);
    assert.equal(f.cache.size, cached, 'repeated rendered notes reuse the existing texture and material');
    assert.equal(sm.map.image.width, 512);
    assert.equal(sm.map.colorSpace, 'srgb', 'canvas colors must not be brightened by treating them as linear');
    const mesh = { userData: {}, material: { dispose() {} } };
    const converted = f.meshMat(mesh, sm);
    assert.equal(converted, f.meshMat(mesh, sm));
    assert.equal(converted.map, sm.map);
    assert.equal(converted.fog, false);
    assert.equal(converted.toneMapped, false);
    assert.equal(f.clones.size, 1);
    assert.ok([...f.cache.values()].includes(sm), 'shared technique teardown owns the new mask');
    assert.ok([...f.cache.keys()].every(k => Number.isSafeInteger(k) && k < 0), 'packed keys cannot collide with Current');
    const legacy = { map: {}, userData: {} };
    const restored = f.meshMat(mesh, legacy);
    assert.equal(restored.fog, true, 'switching to Current restores its material policy');
    assert.equal(restored.toneMapped, true);
});

test('pale face marks keep their ink over a narrow dark contour across bright and dark palettes', () => {
    const f = factory();
    for (const kind of ['hammerOn', 'pullOff', 'tap', 'slap', 'pop', 'fretHandMute',
        'naturalHarmonic', 'pinchHarmonic']) {
        const calls = hex => f.mat(kind, hex).map.image.context.calls;
        for (const color of [0xee2233, 0xffcc00, 0xff8800, 0x44cc44, 0xaa44dd,
            0xffffff, 0xf5eeee, 0xddeeff, 0x111111, 0]) {
            const outline = calls(color).find(c => c.method === 'stroke' && c.stroke === '#18222c');
            assert.ok(outline, kind + ' stays identifiable across face colors');
            const ink = calls(color).filter(c => c.method === 'stroke' || c.method === 'fill');
            const last = ink.at(-1);
            assert.notEqual(last[last.method], '#18222c', 'keyline must not replace the pale mark');
            if (kind.endsWith('Harmonic')) {
                assert.equal(calls(color).some(c => c.method === 'fill'), false, 'the harmonic center remains open');
                assert.ok(Math.abs(outline.width - last.width - 0.032) < 1e-12, 'contour separates pale ink without filling the ring');
                assert.equal(last.width, kind === 'naturalHarmonic' ? 0.085 : 0.060);
            }
        }
    }
    for (const kind of ['slideRight', 'slideLeft']) {
        assert.equal(f.mat(kind, 0xffffff).map.image.context.calls.some(c => c.method === 'stroke'), false,
            'slide direction cues retain solid string color');
    }
});

test('numeric technique-cache teardown disposes face and bend-stack bases, textures and sprites', () => {
    const f = factory();
    const sprites = [f.faceMat(f.flags({ hm: true }), 0xff2233),
        ...[1, 2, 3, 4].map(steps => f.mat('bend', 0xff2233, steps))];
    const records = sprites.map(sprite => {
        const mesh = { userData: {}, material: { dispose() {} } };
        const clone = f.meshMat(mesh, sprite), base = sprite.userData.h3dTechMeshMat, texture = sprite.map;
        assert.ok(base && base !== clone);
        return {sprite, clone, base, texture};
    });
    const start = src.indexOf('            for (const tm of _techMatCache.values()) {');
    const end = src.indexOf('            _techMatCache.clear();', start) + '            _techMatCache.clear();'.length;
    assert.ok(start >= 0 && end > start);
    const cleanup = new Function('_techMatCache', src.slice(start, end));
    cleanup(f.cache);
    for (const {sprite, clone, base, texture} of records) {
        assert.equal(base.disposed, true, 'the cached conversion base is owned by this teardown');
        assert.equal(sprite.userData.h3dTechMeshMat, null);
        assert.equal(sprite.disposed, true);
        assert.equal(texture.disposed, true);
        assert.equal(clone.disposed, undefined, 'per-mesh clones have their separate teardown owner');
    }
    assert.equal(f.cache.size, 0);
    assert.doesNotThrow(() => cleanup(f.cache), 'a repeated empty cleanup is safe');
});

test('bend stacks preserve their six-point arrows, string fill and pale edge for every palette', () => {
    const f = factory();
    const silhouette = [[.12,.53],[.50,.22],[.88,.53],[.88,.78],[.50,.49],[.12,.78]];
    for (const color of [0x22aaff, 0xdd1144, 0xffffff, 0]) for (const steps of [1, 2, 3, 4]) {
        const sm = f.mat('bend', color, steps), image = sm.map.image, calls = image.context.calls;
        assert.equal(image.width, 512);
        assert.equal(image.height, Math.round(512 * (1 + .4 * (steps - 1))));
        const painted = calls.filter(c => c.method === 'stroke' || c.method === 'fill');
        assert.equal(painted.length, steps * 3);
        const points = calls.filter(c => c.method === 'moveTo' || c.method === 'lineTo');
        for (let i = 0; i < steps; i++) {
            assert.deepEqual(points.slice(i * 6, i * 6 + 6).map(c => c.args), silhouette,
                'stacking must not change the existing six-point arrow silhouette');
            assert.deepEqual(painted.slice(i * 3, i * 3 + 3).map(c => [c.method, c[c.method]]),
                [['stroke', '#18222c'], ['stroke', '#fff8f6'], ['fill', '#' + color.toString(16).padStart(6, '0')]]);
            assert.equal(painted[i * 3].width, .07, 'dark outer contour stays visible behind the pale edge');
            assert.equal(painted[i * 3 + 1].width, .032);
        }
        assert.deepEqual(calls.filter(c => c.method === 'translate').map(c => c.args),
            Array.from({length: steps}, (_, i) => [0, i * .4]));
        assert.equal(calls.some(c => c.method.endsWith('Text')), false, 'the arrow count carries the amount');
        assert.equal(sm.opacity, 1);
        assert.equal(sm.fog, false);
        assert.equal(sm.toneMapped, false);
        assert.equal(f.mat('bend', color, steps), sm);
    }
});

test('bend count is clamped, cached separately from slides, and reused without new materials', () => {
    const f = factory();
    const colors = [0x22aaff, 0];
    for (const color of colors) {
        const stacks = [1, 2, 3, 4].map(steps => f.mat('bend', color, steps));
        assert.equal(new Set(stacks).size, 4);
        assert.equal(f.mat('bend', color), stacks[0]);
        for (const [amount, count] of [[0,1],[.25,1],[.5,1],[1.49,1],[1.5,2],[2.49,2],[2.5,3],[3.5,4],[20,4]]) {
            assert.equal(f.mat('bend', color, amount), stacks[count - 1]);
        }
        const slides = ['slideRight','slideLeft'].map(kind => f.mat(kind, color, 4));
        assert.equal(new Set([...stacks, ...slides]).size, 6, 'bend counts must not collide with slide cache entries');
        for (let i = 0; i < stacks.length; i++) {
            assert.equal(f.cache.get(-(color * 1024 + 512 + i * 4 + 1)), stacks[i]);
        }
        const size = f.cache.size;
        for (let i = 0; i < 200; i++) assert.equal(f.mat('bend', color, i % 4 + 1), stacks[i % 4]);
        assert.equal(f.cache.size, size);
    }
    assert.ok([...f.cache.keys()].every(k => Number.isSafeInteger(k) && k < 0));
});

test('slide arrows retain the original solid directional silhouettes and square textures', () => {
    const f = factory(), points = [[.26,.14],[.76,.50],[.26,.86],[.26,.63],[.45,.50],[.26,.37]];
    for (const [kind, code] of [['slideRight',513],['slideLeft',514]]) {
        const mat = f.mat(kind, 0x22aaff, 4), calls = mat.map.image.context.calls;
        assert.equal(f.mat(kind, 0x22aaff, 1), mat, 'a bend count cannot change slide cache identity');
        assert.equal(f.cache.get(-(0x22aaff * 1024 + code + 1)), mat);
        assert.equal(mat.map.image.width, 512);
        assert.equal(mat.map.image.height, 512);
        assert.deepEqual(calls.filter(c => c.method === 'moveTo' || c.method === 'lineTo').map(c => c.args),
            points.map(([x,y]) => [kind === 'slideLeft' ? 1 - x : x, y]));
        assert.equal(calls.some(c => c.method === 'stroke'), false);
        assert.equal(calls.filter(c => c.method === 'fill').length, 1);
        assert.equal(calls.find(c => c.method === 'fill').fill, '#22aaff');
    }
});

test('bend amounts use one proportional plane with unchanged gem clearance and correct string direction', () => {
    const f = factory();
    const start = src.indexOf('                const _bnvPeak =');
    const end = src.indexOf('\n                if (rsPlusNotation) {', start);
    assert.ok(start >= 0 && end > start);
    const run = new Function('f', 'n', 'options', `
        const rsPlusNotation=options.rs !== false, NH=1, NW=2, K=.1, x=5, y=10,
            techniqueYNow=.5, noteZ=-1, approachRot=.2, s=options.string ?? 0;
        const nStr=6, _invertedCached=!!options.inverted;
        ${fn('bendVisualDirY')}
        const activePalette=Array(6).fill(options.color ?? 0x22aaff);
        const techniqueMarkerRenderOrder=20, meshes=[], registrations=[], legacyCounts=[];
        const _registerIncomingLabelOccluder=(mesh,z)=>registrations.push({mesh,z});
        const pTechPlane={get:()=>{ const m={ material:{}, scale:{set(x,y,z){Object.assign(this,{x,y,z});}},
            position:{set(x,y,z){Object.assign(this,{x,y,z});}}, rotation:{} }; meshes.push(m); return m; }};
        const rsPlusTechniqueMat=f.mat, _spriteMat2MeshMat=(m,sm)=>sm;
        const bendChevronMat=(steps,color)=>{legacyCounts.push({steps,color});return {map:{image:{width:512,height:512}}};};
        let yo=11;
        ${src.slice(start, end)}
        return {meshes,registrations,yo,legacyCounts};
    `);
    const cases = [[{bn:.25},1],[{bn:.5},1],[{bn:1},1],[{bn:1.49},1],[{bn:1.5},2],[{bn:2},2],
        [{bn:3},3],[{bn:4},4],[{bn:12},4],[{bn:0,bnv:[{v:.5},{v:2},{v:1}]},2],
        [{bn:3,bnv:[{v:1}]},3],[{bn:1,bnv:[{v:4.5}]},4]];
    for (const inverted of [false,true]) for (const string of [0,5]) for (const accent of [false,true]) {
        const direction = inverted ? (string === 0 ? 1 : -1) : (string === 0 ? -1 : 1);
        for (const [note,count] of cases) for (const color of [0x22aaff,0]) {
            const {meshes,registrations,yo,legacyCounts} = run(f, {...note,ac:accent}, {inverted,string,color});
            assert.equal(meshes.length, 1, 'the full stack must use one plane and no amount label');
            const chevron = meshes[0], image = chevron.material.map.image;
            assert.equal(image.context.calls.filter(c => c.method === 'fill').length, count);
            assert.equal(chevron.scale.x, 1.5, 'each arrow keeps its one-step width');
            const height = 1.5 * image.height / image.width, extra = height - 1.5;
            assert.equal(chevron.scale.y, height, 'texture and plane aspect preserve arrow proportions');
            assert.equal(chevron.position.y, 10.5 + direction * (1.1 + extra * .5));
            assert.ok(Math.abs(Math.abs(chevron.position.y - 10.5) - height / 2 - .35) < 1e-12,
                'the nearest stack edge keeps the original clearance from the gem');
            assert.equal(chevron.rotation.z, .2 + (direction < 0 ? Math.PI : 0));
            assert.equal(yo, direction > 0 ? 13 + extra : 11, 'only upward stacks push following labels higher');
            assert.equal(chevron.material.map.image.context.calls.find(c => c.method === 'fill').fill,
                '#' + color.toString(16).padStart(6, '0'));
            assert.equal(registrations.length, 1);
            assert.equal(registrations[0].mesh, chevron, 'the full stack participates in label clearance');
            assert.equal(registrations[0].z, -1, 'clearance uses the note event depth');
            assert.equal(legacyCounts.length, 0);
        }
    }
    for (const [note, count] of cases) {
        const {meshes,yo,legacyCounts} = run(f,note,{rs:false,string:5});
        assert.deepEqual(legacyCounts,[{steps:count,color:0x22aaff}]);
        assert.deepEqual([meshes[0].scale.x,meshes[0].scale.y,meshes[0].position.y,yo],[2.4,2.4,11.6,13],
            'Current keeps its existing square stack and placement');
    }
    for (const note of [{bn:0},{bn:-1},{bn:0,bnv:[{v:0}]}]) {
        assert.equal(run(f,note,{}).meshes.length,0,'zero or absent bend amounts must not invent a cue');
    }
});

test('the rendered face keeps circular markers square and does not stretch them across an open string', () => {
    const f = factory();
    const start = src.indexOf('                if (rsPlusNotation) {\n                    const faceFlags');
    const end = src.indexOf(' else if (n.ho || n.po || n.tp)', start);
    assert.ok(start >= 0 && end > start);
    const render = new Function('f', 'n', `
        const rsPlusNotation=true, rsPlusTechniqueFlags=f.flags, rsPlusNoteFaceMat=f.faceMat;
        const _spriteMat2MeshMat=(m,sm)=>sm, activePalette=[0xff0000], s=0,
            NW=5, NH=3, K=1, openWScale=7, x=1, y=2, techniqueYNow=0,
            noteZ=-10, approachRot=.2, techniqueMarkerRenderOrder=20;
        const mesh={scale:{set(x,y,z){this.x=x;this.y=y;}}, position:{set(){}}, rotation:{}};
        const pTechPlane={get:()=>mesh};
        const registrations=[];
        const _registerIncomingLabelOccluder=(mesh,z)=>registrations.push({mesh,z});
        ${src.slice(start, end)}
        return {mesh,registrations};
    `);
    const frettedResult = render(f, { f: 5, hm: true }), openResult = render(f, { f: 0, hm: true });
    const fretted = frettedResult.mesh, open = openResult.mesh;
    assert.equal(fretted.scale.x, fretted.scale.y, 'the guide circle must remain circular');
    assert.equal(open.scale.x, fretted.scale.x, 'an open bar does not enlarge the technique symbol');
    assert.equal(open.scale.y, fretted.scale.y);
    assert.equal(fretted.material, open.material, 'open and fretted notes share the cached glyph');
    for (const result of [frettedResult,openResult]) {
        assert.equal(result.registrations.length,1);
        assert.equal(result.registrations[0].mesh,result.mesh, 'compound RS+ faces participate in label clearance');
        assert.equal(result.registrations[0].z,-10);
    }
});
