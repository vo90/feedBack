// A floor digit may keep its existing layer until it overlaps an equal-depth
// or nearer gem. Only the digit's order changes; actual gem/trail priorities
// remain authoritative, including gems demoted by the trail finalizer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' must exist in the production renderer');
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unbalanced function: ' + name);
}
const orderBehindGem = vm.runInNewContext(
    '(' + extractFunction('hwyIncomingLabelBehindGemOrder') + ')',
);
const rectsOverlap = vm.runInNewContext(
    '(' + extractFunction('hwyScreenRectsOverlap') + ')',
);

test('a nearer gem wins a label overlap inside the same rounded depth bucket', () => {
    // These are the legacy natural orders for a label and normal gem in one
    // bucket. The old label layer wins even though the gem is slightly nearer.
    const labelOrder = 600.85;
    const gemOrder = 600.65;
    const labelZ = -100.23;
    const gemZ = -100;
    assert.equal(Math.round(700 + labelZ), Math.round(700 + gemZ));
    assert.ok(labelOrder > gemOrder, 'fixture reproduces the old overpainting');
    const result = orderBehindGem(labelOrder, labelZ, gemOrder, gemZ);
    assert.ok(result < gemOrder, 'the complete gem paints after the overlapping digit');
    assert.ok(result <= labelOrder);
});

test('sub-bucket depth differences are respected without quantizing note time', () => {
    const K = 0.015;
    const labelZ = -90 * K;
    const gemZ = labelZ + 0.00001 * K;
    assert.notEqual(labelZ, gemZ);
    assert.ok(orderBehindGem(610.9, labelZ, 610.2, gemZ) < 610.2);
    assert.equal(orderBehindGem(610.9, gemZ, 610.2, labelZ), 610.9,
        'the reverse depth relationship leaves the nearer digit alone');
});

test('same-event gem overlap also gives the playable body priority', () => {
    for (const z of [-9, -0.1, 0]) {
        assert.ok(orderBehindGem(700.95, z, 700.2, z) < 700.2);
    }
});

test('a nearer gem demoted below a covering trail retains its actual priority', () => {
    const label = { order: 670.85, z: -30 };
    const coveringTrailOrder = 620.3;
    const gem = { order: coveringTrailOrder - 0.003, z: -5 };
    const originalGemOrder = gem.order;
    const result = orderBehindGem(label.order, label.z, gem.order, gem.z);
    assert.ok(result < gem.order, 'nominal depth buckets must not replace the final mesh order');
    assert.equal(gem.order, originalGemOrder, 'gem/trail layering is left unchanged');
});

test('a farther gem cannot demote a nearer label even with an unusual render order', () => {
    assert.equal(orderBehindGem(500.85, -5, 900, -6), 500.85);
    assert.equal(orderBehindGem(500.85, -5, 100, -6), 500.85);
});

test('a label already behind the gem is never raised and repeated application is stable', () => {
    assert.equal(orderBehindGem(499, -20, 500, -10), 499);
    const once = orderBehindGem(700, -20, 500, -10);
    assert.equal(orderBehindGem(once, -20, 500, -10), once);
});

test('multiple overlaps converge independently of gem iteration order', () => {
    const candidates = [
        { z: -9, order: 600.3 },
        { z: -7, order: 500.2 },
        { z: -11, order: 100 }, // farther than the label: irrelevant
        { z: -10, order: 550.6 },
    ];
    const resolve = list => list.reduce(
        (order, gem) => orderBehindGem(order, -10, gem.order, gem.z), 700.9,
    );
    const result = resolve(candidates);
    assert.ok(result < 500.2 && result > 100);
    assert.equal(result, resolve([...candidates].reverse()));
});

test('non-finite order or depth input leaves the caller order unchanged', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
        for (let index = 0; index < 4; index++) {
            const args = [600.9, -10, 500.2, -9];
            args[index] = invalid;
            assert.ok(Object.is(orderBehindGem(...args), args[0]),
                'invalid argument ' + index + ' must not create a new render order');
        }
    }
});

test('screen overlap detects containment in either direction without changing rectangles', () => {
    const outer = Object.freeze({ minX: -0.8, maxX: 0.8, minY: -0.6, maxY: 0.7 });
    const inner = Object.freeze({ minX: -0.2, maxX: 0.1, minY: -0.1, maxY: 0.1 });
    assert.equal(rectsOverlap(outer, inner), true);
    assert.equal(rectsOverlap(inner, outer), true);
    assert.equal(rectsOverlap(inner, inner), true);
});

test('screen rectangles separated on either axis do not trigger label demotion', () => {
    const label = { minX: -0.2, maxX: 0.2, minY: -0.8, maxY: -0.6 };
    for (const gem of [
        { minX: 0.21, maxX: 0.4, minY: -0.7, maxY: -0.5 },
        { minX: -0.4, maxX: -0.21, minY: -0.7, maxY: -0.5 },
        { minX: -0.1, maxX: 0.1, minY: -0.59, maxY: -0.3 },
        { minX: -0.1, maxX: 0.1, minY: -1, maxY: -0.81 },
    ]) {
        assert.equal(rectsOverlap(label, gem), false);
        assert.equal(rectsOverlap(gem, label), false);
    }
});

test('touching projected edges and corners count as overlap', () => {
    const label = { minX: -1, maxX: 0, minY: -1, maxY: 0 };
    assert.equal(rectsOverlap(label, { minX: 0, maxX: 1, minY: -0.5, maxY: 0.5 }), true);
    assert.equal(rectsOverlap(label, { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1 }), true);
    assert.equal(rectsOverlap(label, { minX: 0, maxX: 1, minY: 0, maxY: 1 }), true);
});

test('partial viewport clipping does not discard an overlap still visible on screen', () => {
    const label = { minX: -0.2, maxX: 0.2, minY: -1.2, maxY: -0.8 };
    const gem = { minX: -0.1, maxX: 0.1, minY: -0.9, maxY: -0.7 };
    assert.equal(rectsOverlap(label, gem), true);
});

function visual(rect, inkRect = rect, overrides = {}) {
    return {
        visible: true, material: { opacity: 0.55 }, userData: {},
        center: { x: 0.5, y: 0.5, isVector2: true, set(x, y) { this.x = x; this.y = y; } },
        position: { z: 0 }, renderOrder: 1000, rect, inkRect, ...overrides,
    };
}
function projectFixtureRect(object, out, inkOnly) {
    if (object.projectable === false) return false;
    Object.assign(out, inkOnly ? object.inkRect : object.rect);
    out.spriteHeight = object.rect.maxY - object.rect.minY;
    const lift = (0.5 - object.center.y) * out.spriteHeight;
    out.minY += lift;
    out.maxY += lift;
    return true;
}
function runHandoff(row, fret = 9, options = {}) {
    const label = visual({ minX: -0.2, maxX: 0.2, minY: -1.1, maxY: -0.7 }, undefined,
        { position: { z: options.eventZ ?? 0 } });
    const fixed = [];
    if (row) fixed[9] = row;
    const occluders = options.occluders || [];
    const context = {
        cam: { updateMatrixWorld() {} },
        _incomingFloorLabelCount: 1,
        _incomingFloorLabels: [{ sprite: label, fret, rect: {} }],
        _incomingFixedFretLabels: fixed,
        _incomingLabelLayoutFrame: 0,
        _incomingLabelOccluderCount: occluders.length,
        _incomingLabelOccluders: occluders.map(occluder => ({ ...occluder, frame: -1, rect: {} })),
        _incomingLabelScreenRect: projectFixtureRect,
        _newLabelRect: () => ({}),
        hwyScreenRectsOverlap: rectsOverlap,
        hwyIncomingLabelBehindGemOrder: orderBehindGem,
        FRET_LABEL_GOLD_HEX: '#D8A636',
        txtMat: (text, color, wide, style) => ({ text, color, wide, style, opacity: 0.55 }),
    };
    vm.runInNewContext(extractFunction('_layoutIncomingFretLabels')
        + '\n_layoutIncomingFretLabels();', context);
    return label;
}

test('handoff uses fully visible ink even when transparent row padding is clipped', () => {
    const row = visual(
        { minX: -0.3, maxX: 0.3, minY: -1.1, maxY: -0.5 },
        { minX: -0.15, maxX: 0.15, minY: -0.97, maxY: -0.7 },
    );
    assert.equal(runHandoff(row).visible, false);
    assert.equal(row.visible, true);
    assert.equal(row.material.color, '#D8A636');
    assert.equal(row.material.text, 9, 'the replacement retains the incoming fret identity');
    assert.equal(row.material.opacity, 1);
});

test('horizontally clipped or fully offscreen row ink cannot hide the incoming fret number', () => {
    for (const ink of [
        { minX: -0.1, maxX: 0.1, minY: -1.3, maxY: -1 },
        { minX: -0.1, maxX: 0.1, minY: -1.3, maxY: -1.01 },
        { minX: -1.001, maxX: 0.1, minY: -0.97, maxY: -0.7 },
        { minX: -0.1, maxX: 1.001, minY: -0.97, maxY: -0.7 },
    ]) {
        const row = visual(ink);
        assert.equal(runHandoff(row).visible, true);
        assert.equal(row.material.opacity, 0.55);
    }
});

test('a partially visible arrival row lifts only enough to make its ink readable', () => {
    const row = visual(
        { minX: -0.2, maxX: 0.2, minY: -1.4, maxY: -0.8 },
        { minX: -0.1, maxX: 0.1, minY: -1.2, maxY: -0.95 },
    );
    const originalZ = row.position.z;
    assert.equal(runHandoff(row).visible, false);
    const projected = {};
    projectFixtureRect(row, projected, true);
    assert.ok(Math.abs(projected.minY - (-0.98)) < 1e-12);
    assert.ok(projected.maxY <= 1);
    assert.equal(row.position.z, originalZ, 'the fallback does not move the label in event depth');
    assert.equal(row.material.opacity, 1);
});

test('a lifted arrival row still yields to a gem nearer than the incoming event', () => {
    const row = visual(
        { minX: -0.2, maxX: 0.2, minY: -1.4, maxY: -0.8 },
        { minX: -0.1, maxX: 0.1, minY: -1.2, maxY: -0.95 },
    );
    const gem = visual({ minX: -0.15, maxX: 0.15, minY: -0.95, maxY: -0.8 }, undefined,
        { renderOrder: 600 });
    const label = runHandoff(row, 9, { eventZ: -10, occluders: [{ mesh: gem, z: -9 }] });
    assert.equal(label.visible, false);
    assert.ok(row.renderOrder < gem.renderOrder,
        'clearance uses incoming event depth rather than the replacement row at z=0');
    assert.equal(gem.renderOrder, 600);
});

test('reused fixed-row sprites reset the temporary viewport lift', () => {
    const rect = { minX: -0.1, maxX: 0.1, minY: -1.2, maxY: -0.95 };
    const makePool = vm.runInNewContext('(' + extractFunction('pool') + ')');
    const sprites = makePool({ add() {} }, () => visual(rect));
    const row = sprites.get();
    assert.equal(runHandoff(row).visible, false);
    assert.ok(row.center.y < 0.5);
    sprites.reset();
    const reused = sprites.get();
    assert.equal(reused, row);
    assert.equal(reused.center.y, 0.5, 'the next frame starts from the normal row anchor');
});

test('handoff requires a visible same-fret row that actually overlaps', () => {
    const touching = { minX: -0.1, maxX: 0.1, minY: -0.97, maxY: -0.7 };
    assert.equal(runHandoff(null).visible, true);
    assert.equal(runHandoff(visual(touching), 8).visible, true);
    assert.equal(runHandoff(visual(touching, touching, { visible: false })).visible, true);
    assert.equal(runHandoff(visual(touching, touching, { material: { opacity: 0 } })).visible, true);
    assert.equal(runHandoff(visual(touching, touching, { projectable: false })).visible, true);
    assert.equal(runHandoff(visual({ minX: 0.3, maxX: 0.5, minY: -0.97, maxY: -0.7 })).visible, true);
});

const cameraSource = extractFunction('camUpdate');
const guardComment = cameraSource.indexOf('// ── Fret-row fit guard');
const guardStart = cameraSource.indexOf('if (_freeCam && _freeCam.enabled)', guardComment);
assert.ok(guardComment >= 0 && guardStart > guardComment, 'actual camera fit guard must exist');
const cameraGuard = cameraSource.slice(guardStart, cameraSource.lastIndexOf('}'));
function fitGuard(rows, options = {}) {
    let projections = 0;
    const context = {
        _freeCam: { enabled: !!options.freeCamera },
        _fretRowFitBoost: options.boost ?? 1,
        _incomingFixedFretLabels: rows,
        cam: { updateMatrixWorld() {} },
        _probe: { y: 0, set() {}, project() { this.y = options.anchorY ?? -0.7; } },
        sY: s => s * 4, nStr: 6, S_GAP: 4, K: 1, curX: 8,
        _newLabelRect: () => ({}),
        _incomingLabelScreenRect(object, out, inkOnly) {
            projections++;
            assert.equal(inkOnly, true, 'the camera fits glyph ink, not transparent padding');
            return projectFixtureRect(object, out, inkOnly);
        },
    };
    for (const key of ['FRET_ROW_FIT_NDC_MIN', 'FRET_ROW_FIT_DEADBAND', 'FRET_ROW_FIT_BOOST_MAX']) {
        const declaration = source.match(new RegExp('const\\s+' + key + '\\s*=\\s*([^;]+);'));
        assert.ok(declaration, key);
        context[key] = Number(declaration[1]);
    }
    vm.runInNewContext(cameraGuard, context);
    return { boost: context._fretRowFitBoost, projections };
}

test('visible low glyph edges trigger bounded pullback when the row anchor fits', () => {
    const row = visual({ minX: -0.3, maxX: 0.3, minY: -1.3, maxY: -0.5 },
        { minX: -0.15, maxX: 0.15, minY: -1.02, maxY: -0.7 });
    assert.ok(fitGuard([row]).boost > 1, 'the formerly clipped ink now affects the camera');
    assert.equal(fitGuard([row], { boost: 1.59 }).boost, 1.6, 'existing maximum pullback is preserved');
});

test('camera fitting ignores hidden and horizontally clipped row glyphs', () => {
    const low = { minX: -0.1, maxX: 0.1, minY: -1.2, maxY: -0.7 };
    const clipped = { ...low, minX: -1.01 };
    const rows = [null, visual(low, low, { visible: false }),
        visual(low, low, { material: { opacity: 0 } }), visual(clipped)];
    assert.equal(fitGuard(rows).boost, 1);
});

test('camera fit retains its deadband, gradual relaxation and manual-camera opt-out', () => {
    const inBand = visual({ minX: -0.1, maxX: 0.1, minY: -0.83, maxY: -0.6 });
    assert.equal(fitGuard([inBand], { boost: 1.2 }).boost, 1.2);
    const clear = visual({ minX: -0.1, maxX: 0.1, minY: -0.75, maxY: -0.6 });
    assert.equal(fitGuard([clear], { boost: 1.2 }).boost, 1.19);
    const manual = fitGuard([inBand], { boost: 1.4, freeCamera: true });
    assert.equal(manual.boost, 1);
    assert.equal(manual.projections, 0, 'automatic fitting does not fight Camera Director');
});
