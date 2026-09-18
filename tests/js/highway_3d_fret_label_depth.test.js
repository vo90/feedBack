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
const sameFretBeat = vm.runInNewContext(
    '(' + extractFunction('hwySameFretLabelBeat') + ')',
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
    Object.assign(label, options.gold || {});
    const fixed = [];
    if (row) fixed[9] = row;
    const occluders = options.occluders || [];
    const labels = options.labels || [{ sprite: label, fret, time: options.time ?? NaN, rect: {} }];
    const context = {
        cam: { updateMatrixWorld() {} },
        _incomingFloorLabelCount: labels.length,
        _incomingFloorLabels: labels,
        _incomingFretColumnMarkers: options.markers || [],
        _incomingFretColumnMarkerCount: (options.markers || []).length,
        _incomingFixedFretLabels: fixed,
        _incomingLabelLayoutFrame: options.layoutFrame ?? 0,
        _incomingLabelOccluderCount: occluders.length,
        _incomingLabelOccluders: occluders.map(occluder => ({ ...occluder, frame: -1, rect: {} })),
        _incomingLabelScreenRect: projectFixtureRect,
        _newLabelRect: () => ({}),
        hwyScreenRectsOverlap: rectsOverlap,
        hwyIncomingLabelBehindGemOrder: orderBehindGem,
        hwySameFretLabelBeat: sameFretBeat,
        FRET_LABEL_GOLD_HEX: '#D8A636',
        txtMat: (text, color, wide, style) => ({ text, color, wide, style, opacity: 0.55 }),
    };
    vm.runInNewContext(extractFunction('_suppressCoincidentFretColumnMarkers') + '\n'
        + extractFunction('_layoutIncomingFretLabels')
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

test('only the same fret and beat within wire rounding tolerance identify a duplicate', () => {
    for (const time of [0, 12.345, 600]) {
        for (const delta of [0, -0.0007, 0.0007, -0.001, 0.001]) {
            assert.equal(sameFretBeat(5, time, 5, time + delta), true);
        }
        for (const delta of [-0.00101, 0.00101, -0.02, 0.02, 0.25, 1]) {
            assert.equal(sameFretBeat(5, time, 5, time + delta), false,
                'nearby note labels and neighboring beats retain their grey references');
        }
        assert.equal(sameFretBeat(5, time, 7, time), false);
        assert.equal(sameFretBeat(7, time, 5, time), false);
    }
    for (const invalid of [NaN, Infinity, -Infinity]) {
        assert.equal(sameFretBeat(5, invalid, 5, 10), false);
        assert.equal(sameFretBeat(5, 10, 5, invalid), false);
    }
    for (const fret of [0, -1, 5.5, NaN, Infinity]) {
        assert.equal(sameFretBeat(fret, 10, fret, 10), false);
    }
});

function columnMarker(fret = 9, time = 12.345) {
    return { fret, time, sprite: visual({ minX: -0.2, maxX: 0.2, minY: -0.9, maxY: -0.7 }) };
}

test('a visible gold label replaces only its coincident grey fret reference', () => {
    const matching = columnMarker(), otherFret = columnMarker(7), nextBeat = columnMarker(9, 12.595);
    const nearButDistinct = columnMarker(9, 12.365);
    const markers = [matching, otherFret, nextBeat, nearButDistinct];
    const label = runHandoff(null, 9, { time: 12.345, markers });
    assert.equal(label.visible, true);
    assert.equal(matching.sprite.visible, false);
    for (const marker of [otherFret, nextBeat, nearButDistinct]) assert.equal(marker.sprite.visible, true);
});

test('invisible, transparent, unprojectable and teaching gold entries cannot remove grey references', () => {
    for (const options of [
        { gold: { visible: false } },
        { gold: { material: { opacity: 0 } } },
        { gold: { material: { opacity: -0.01 } } },
        { gold: { projectable: false } },
        { time: NaN },
    ]) {
        const marker = columnMarker();
        runHandoff(null, 9, { time: 12.345, markers: [marker], ...options });
        assert.equal(marker.sprite.visible, true);
    }
    const teachingMatch = columnMarker(0);
    runHandoff(null, 0, { time: 12.345, markers: [teachingMatch] });
    assert.equal(teachingMatch.sprite.visible, true);
});

test('arrival handoff still leaves one gold identity after removing the matching grey marker', () => {
    const marker = columnMarker();
    const row = visual({ minX: -0.15, maxX: 0.15, minY: -0.97, maxY: -0.7 });
    const label = runHandoff(row, 9, { time: 12.345, markers: [marker] });
    assert.equal(marker.sprite.visible, false);
    assert.equal(label.visible, false);
    assert.equal(row.visible, true);
    assert.equal(row.material.color, '#D8A636');
    assert.equal(row.material.opacity, 1);
});

function registrationHarness() {
    const makePool = vm.runInNewContext('(' + extractFunction('pool') + ')');
    const makeSprite = () => {
        const sprite = visual({ minX: -0.2, maxX: 0.2, minY: -0.9, maxY: -0.7 });
        sprite.position.set = function (x, y, z) { Object.assign(this, { x, y, z }); };
        sprite.scale = { set(x, y, z) { Object.assign(this, { x, y, z }); } };
        return sprite;
    };
    const context = vm.createContext({
        _incomingFloorLabels: [], _incomingFloorLabelCount: 0,
        _incomingFretColumnMarkers: [], _incomingFretColumnMarkerCount: 0,
        _incomingFixedFretLabels: [], _incomingLabelOccluderCount: 0,
        _newLabelRect: () => ({}), hwySameFretLabelBeat: sameFretBeat,
        _setLabelMap(sprite, mat) { sprite.material = { ...mat }; },
        pNoteFretLabel: makePool({ add() {} }, makeSprite),
        pFretColMarker: makePool({ add() {} }, makeSprite),
        txtMat: (text, color) => ({ text, color, opacity: 1 }),
        FRET_LABEL_GOLD_HEX: '#D8A636',
        xFretMid: fret => fret * 5, sY: string => string * 4,
        renderOrderForLayerAtZ: () => 700, fretLabelScaleForFret: () => 1,
        AHEAD: 3, K: 1, S_GAP: 4, nStr: 6, _textSizeMul: 1,
    });
    vm.runInContext(['_setIncomingFloorLabelMap', '_registerFretColumnMarker',
        '_suppressCoincidentFretColumnMarkers'].map(extractFunction).join('\n'), context);
    const updateStart = source.indexOf('function update(');
    const resetStart = source.indexOf('_incomingFloorLabelCount = _incomingLabelOccluderCount = 0;', updateStart);
    const resetEnd = source.indexOf('pFretLbl.reset();', resetStart);
    assert.ok(updateStart >= 0 && resetStart > updateStart && resetEnd > resetStart);
    return {
        context,
        reset() {
            context.pNoteFretLabel.reset();
            context.pFretColMarker.reset();
            vm.runInContext(source.slice(resetStart, resetEnd), context);
        },
        run(code) { return vm.runInContext('{\n' + code + '\n}', context); },
    };
}

test('grey and gold registrations share a baseline and pooled records reset fret and time each frame', () => {
    const h = registrationHarness(), c = h.context;
    const gold = c.pNoteFretLabel.get(), grey = c.pFretColMarker.get();
    c._setIncomingFloorLabelMap(gold, { opacity: 1 }, 5, 12.345);
    c._registerFretColumnMarker(grey, 5, 12.345);
    assert.equal(gold.center.x, grey.center.x);
    assert.equal(gold.center.y, 1);
    assert.equal(grey.center.y, 1, 'the grey digit also sits wholly below its floor anchor');
    const goldRecord = c._incomingFloorLabels[0], greyRecord = c._incomingFretColumnMarkers[0];
    c._suppressCoincidentFretColumnMarkers(goldRecord);
    assert.equal(grey.visible, false);
    h.reset();
    assert.equal(c._incomingFloorLabelCount, 0);
    assert.equal(c._incomingFretColumnMarkerCount, 0, 'the actual update reset excludes previous frame markers');
    assert.equal(c.pFretColMarker.get(), grey);
    assert.equal(grey.visible, true, 'pool reuse restores a formerly suppressed reference');
    assert.equal(grey.center.y, 0.5, 'normal pool defaults are still authoritative before registration');
    c._registerFretColumnMarker(grey, 7, 12.595);
    assert.equal(c._incomingFretColumnMarkers[0], greyRecord, 'records are reused without per-frame allocation');
    assert.equal(greyRecord.fret, 7);
    assert.equal(greyRecord.time, 12.595);
    assert.equal(grey.center.y, 1);
    assert.equal(c.pNoteFretLabel.get(), gold);
    c._setIncomingFloorLabelMap(gold, { opacity: 1 });
    assert.equal(c._incomingFloorLabels[0], goldRecord);
    assert.equal(goldRecord.fret, 0);
    assert.ok(Number.isNaN(goldRecord.time), 'a reused teaching label cannot retain a previous gold timestamp');
    c._suppressCoincidentFretColumnMarkers(goldRecord);
    assert.equal(grey.visible, true);
});

function sourceBetween(startText, endText, from = 0, includeEnd = false) {
    const start = source.indexOf(startText, from), end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, startText);
    return source.slice(start, end + (includeEnd ? endText.length : 0));
}

function drawLabelPath(h, path, options = {}) {
    const c = h.context, time = options.time ?? 12.3456789, fret = 5;
    Object.assign(c, {
        ch: { t: time }, n: { t: time, f: fret }, b: { time }, f: fret,
        chShape: new Map([[0, fret], [1, fret], [2, 7], [3, 0]]),
        isRepeat: !!options.hidden, chDt: 0.7, chordTailMul: 1,
        fromChord: path !== 'single', arpBounds: path === 'arp' ? {} : null,
        skipBody: path === 'synthetic', skipLabel: !!options.hidden,
        _isArpNote: path === 'arp',
        _fretLabelAllowed: new Set(options.hidden ? [] : [Math.round(time * 25) * 100 + fret]),
        _frameLabeledKeys: new Set(), alpha: 1, dt: 0.7,
        yMinF: -3.2, labelY: -3.2, x: fret * 5, noteZ: -70, z: -70, _colFadeIn: 1,
    });
    let code;
    if (path === 'chord') {
        const from = source.indexOf('// ── Chord fret numbers at the base of the highway');
        code = sourceBetween('if (!isRepeat) {', '// ── Palm-mute strum indicator', from);
    } else if (path === 'synthetic') {
        code = sourceBetween('if (skipBody && fromChord && !skipLabel && n.f > 0 && dt >= 0)',
            '// ── Drop line for chord / arpeggio notes');
    } else if (path === 'grey') {
        const from = source.indexOf('// ── Fret-column reference markers');
        code = sourceBetween("const color = '#888888';", 'sp.scale.set(sz, sz, 1);', from, true);
    } else {
        code = sourceBetween('const _flFrameKey = Math.round(n.t * 25)', '// Teaching marks');
    }
    h.run(code);
    return time;
}

test('actual single, arpeggio, chord and synthetic label paths register authored times for grey dedup', () => {
    for (const path of ['single', 'arp', 'chord', 'synthetic']) {
        const h = registrationHarness(), c = h.context;
        const time = drawLabelPath(h, path);
        assert.equal(c._incomingFloorLabelCount, path === 'chord' ? 2 : 1, path);
        for (const record of c._incomingFloorLabels) assert.equal(record.time, time, path + ' retains exact chart time');
        drawLabelPath(h, 'grey');
        assert.equal(c._incomingFretColumnMarkerCount, 1);
        const marker = c._incomingFretColumnMarkers[0];
        assert.equal(marker.time, time, 'grey registration uses the authored beat time');
        c._suppressCoincidentFretColumnMarkers(c._incomingFloorLabels[0]);
        assert.equal(marker.sprite.visible, false, path);
        assert.equal(marker.sprite.center.y, 1);
        h.reset();
        drawLabelPath(h, path, { hidden: true });
        assert.equal(c._incomingFloorLabelCount, 0, path + ' hidden label creates no stale suppression record');
        drawLabelPath(h, 'grey');
        assert.equal(c._incomingFretColumnMarkers[0].sprite.visible, true);
    }
});

function goldRecord(fret = 9, time = 12.345, overrides = {}) {
    return {
        fret, time, layoutFrame: -1, rect: {},
        sprite: visual({ minX: -0.2, maxX: 0.2, minY: -1.1, maxY: -0.7 }, undefined, overrides),
    };
}

test('actual chord and standalone paths leave one gold label per coincident fret in either draw order', () => {
    for (const paths of [['single', 'chord'], ['chord', 'single']]) {
        const h = registrationHarness();
        for (const path of paths) drawLabelPath(h, path);
        const labels = h.context._incomingFloorLabels;
        assert.equal(labels.length, 3, 'the fixture exercises the original duplicate-producing draw paths');
        runHandoff(null, 9, { labels });
        const fives = labels.filter(record => record.fret === 5);
        assert.equal(fives[0].sprite.visible, true, 'the first drawable gold identity remains');
        assert.equal(fives[1].sprite.visible, false);
        assert.equal(labels.find(record => record.fret === 7).sprite.visible, true);
    }
});

test('gold dedup retains nearby beats, other frets, and adjacent teaching marks', () => {
    const labels = [goldRecord(), goldRecord(9, 12.365), goldRecord(7),
        goldRecord(0, NaN), goldRecord(0, NaN)];
    runHandoff(null, 9, { labels });
    for (const record of labels) assert.equal(record.sprite.visible, true);
});

test('a non-drawable first gold label cannot suppress a drawable replacement', () => {
    for (const overrides of [{ visible: false }, { material: { opacity: 0 } }, { projectable: false }]) {
        const first = goldRecord(9, 12.345, overrides), second = goldRecord();
        const grey = columnMarker();
        runHandoff(null, 9, { labels: [first, second], markers: [grey] });
        assert.equal(second.sprite.visible, true);
        assert.equal(second.layoutFrame, 1);
        assert.equal(first.layoutFrame, -1, 'non-drawable entries do not claim this frame identity');
        assert.equal(grey.sprite.visible, false, 'the surviving gold still replaces its grey reference');
    }
});

test('a gold label handed to the fixed row still prevents another incoming copy', () => {
    const first = goldRecord(), second = goldRecord(), grey = columnMarker();
    const row = visual({ minX: -0.15, maxX: 0.15, minY: -0.97, maxY: -0.7 });
    runHandoff(row, 9, { labels: [first, second], markers: [grey] });
    assert.equal(first.sprite.visible, false, 'the first identity moved to the fixed row');
    assert.equal(first.layoutFrame, 1, 'the handoff still owns this frame identity');
    assert.equal(second.sprite.visible, false);
    assert.equal(grey.sprite.visible, false);
    assert.equal(row.visible, true);
    assert.equal(row.material.color, '#D8A636');
    assert.equal(row.material.opacity, 1);
});

test('pooled gold labels restore visibility and do not inherit an earlier frame duplicate claim', () => {
    const h = registrationHarness(), c = h.context;
    drawLabelPath(h, 'single');
    drawLabelPath(h, 'chord');
    const first = c._incomingFloorLabels[0], duplicate = c._incomingFloorLabels[1];
    runHandoff(null, 9, { labels: c._incomingFloorLabels });
    assert.equal(first.layoutFrame, 1);
    assert.equal(duplicate.sprite.visible, false);
    h.reset();
    drawLabelPath(h, 'single');
    drawLabelPath(h, 'chord');
    assert.equal(c._incomingFloorLabels[0], first);
    assert.equal(c._incomingFloorLabels[1], duplicate);
    assert.equal(duplicate.sprite.visible, true, 'pool.get restores the suppressed sprite before layout');
    first.sprite.projectable = false;
    runHandoff(null, 9, { labels: c._incomingFloorLabels, layoutFrame: 1 });
    assert.equal(duplicate.sprite.visible, true, 'the first record stale frame stamp cannot hide this frame replacement');
    assert.equal(duplicate.layoutFrame, 2);
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
