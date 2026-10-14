const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

function harness() {
    return new Function(`
        const NFRETS = 24;
        let builds = 0;
        ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote'].map(extract).join('\n')}
        ${extract('hwyBuildCameraAttackIndex').replace('function hwyBuildCameraAttackIndex(', 'function buildIndex(')}
        function hwyBuildCameraAttackIndex(...args) { builds++; return buildIndex(...args); }
        ${extract('hwyPrepareCameraStops')}
        return { build: hwyBuildCameraAttackIndex, prepare: hwyPrepareCameraStops, builds: () => builds };
    `)();
}

const stops = Object.freeze([
    Object.freeze({ time: 0, x: 25 }),
    Object.freeze({ time: 4, x: 125 }),
]);

test('expressive holds retain focus while plain holds allow early preparation', () => {
    const h = harness();
    const target = { t: 4, s: 1, f: 12 };
    const expressive = [{ t: 0, s: 0, f: 5, sus: 6, vb: true }, target];
    assert.deepEqual(h.build(expressive, []), [{ time: 0, busy: 6 }, { time: 4, busy: 6 }]);
    assert.equal(h.prepare(stops, expressive, [], 1)[1].lead, 0.6);

    const plain = [{ t: 0, s: 0, f: 5, sus: 6 }, target];
    assert.equal(h.prepare(stops, plain, [], 1)[1].lead, 1.2);
});

test('only replacement on the same string releases an overlapping expressive hold', () => {
    const h = harness();
    const held = { t: 0, s: 0, f: 5, sus: 6, bn: 1 };
    const target = { t: 4, s: 2, f: 12 };
    const sameString = [held, { t: 1, s: 0, f: 7 }, target];
    assert.deepEqual(h.build(sameString, []), [
        { time: 0, busy: 1 }, { time: 1, busy: 1 }, { time: 4, busy: 1 },
    ]);
    assert.equal(h.prepare(stops, sameString, [], 1)[1].lead, 1.2);
    assert.equal(h.prepare(stops, [held, { t: 1, s: 1, f: 7 }, target], [], 1)[1].lead, 0.6);
});

test('simultaneous chord members do not cut each other off and synthetic chords do not replace notes', () => {
    const h = harness();
    const notes = [{ t: 0.0003, s: 0, f: 5 }, { t: 4, s: 1, f: 12 }];
    const chords = [
        { t: 0, notes: [{ s: 0, f: 5, sus: 5, vb: true }] },
        { t: 2, h3dSynth: true, notes: [{ s: 0, f: 7 }] },
    ];
    assert.deepEqual(h.build(notes, chords), [{ time: 0, busy: 5 }, { time: 4, busy: 5 }]);
    assert.equal(h.prepare(stops, notes, chords, 1)[1].lead, 0.6);
});

test('directional slide-out allows preparation but a targeted slide still holds focus', () => {
    const h = harness();
    const target = { t: 4, s: 1, f: 12 };
    assert.equal(h.prepare(stops, [{ t: 0, s: 0, f: 5, sus: 6, slide_out: 'down' }, target], [], 1)[1].lead, 1.2);
    assert.equal(h.prepare(stops, [{ t: 0, s: 0, f: 5, sus: 6, sl: 7 }, target], [], 1)[1].lead, 0.6);
});

test('prepared attack indexes preserve timing across rate changes without rescanning chart inputs', () => {
    const h = harness();
    const notes = Object.freeze([
        Object.freeze({ t: 4, s: 1, f: 12 }),
        Object.freeze({ t: 0, s: 0, f: 5, sus: 3.2, vb: true }),
        Object.freeze({ t: 1, s: 0, f: 7 }),
    ]);
    const chords = Object.freeze([]);
    const attacks = Object.freeze(h.build(notes, chords).map(Object.freeze));
    const forbiddenInputs = new Proxy([], { get() { throw new Error('prepared index rescanned chart'); } });
    for (const rate of [0.25, 0.5, 1, 2, 4]) {
        const expected = h.prepare(stops, notes, chords, rate);
        const builds = h.builds();
        assert.deepEqual(h.prepare(stops, forbiddenInputs, forbiddenInputs, rate, 6, attacks), expected);
        assert.equal(h.builds(), builds);
    }
    assert.equal(notes[0].t, 4, 'building the index must not sort source arrays');
});

test('an empty prepared index and trivial stop plan require no chart scan', () => {
    const h = harness();
    const forbiddenInputs = new Proxy([], { get() { throw new Error('unexpected chart scan'); } });
    assert.deepEqual(h.prepare(stops, forbiddenInputs, forbiddenInputs, 1, 6, []),
        stops.map(stop => ({ ...stop, lead: 0.6 })));
    assert.deepEqual(h.prepare(stops.slice(0, 1), forbiddenInputs, forbiddenInputs, 1),
        [{ ...stops[0], lead: 0.6 }]);
    assert.equal(h.builds(), 0);
});

test('attack index respects effective string count and ignores non-renderable notes', () => {
    const h = harness();
    const notes = [
        { t: 0, s: 6, f: 5, sus: 5, vb: true },
        { t: 1, s: 0, f: 40, sus: 5, vb: true },
        { t: NaN, s: 0, f: 5 },
        { t: 4, s: 1, f: 12 },
    ];
    assert.deepEqual(h.build(notes, [], 6), [{ time: 4, busy: -Infinity }]);
    assert.deepEqual(h.build(notes, [], 7), [{ time: 0, busy: 5 }, { time: 4, busy: 5 }]);
});
