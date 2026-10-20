const { test } = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');

function harness() {
    let visits = 0;
    const {hwyBuildCameraAttackIndex:build,hwyPrepareCameraStops:prepare} =
        cameraApi({onRenderableNote:()=>visits++});
    return {
        // Timing assertions deliberately ignore composition-only metadata.
        build: (...args) => build(...args).map(({frets,...event})=>event),
        focus: build, prepare, visits: () => visits,
    };
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
        const visits = h.visits();
        assert.deepEqual(h.prepare(stops, forbiddenInputs, forbiddenInputs, rate, 6, attacks), expected);
        assert.equal(h.visits(), visits);
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
    assert.equal(h.visits(), 0);
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

test('composition evidence records real picked frets and never slide endpoints or opens', () => {
    const h=harness();
    const rows=h.focus([{t:0,s:0,f:8,sus:2,sl:2},{t:1,s:1,f:0}],
        [{t:2,notes:[{s:0,f:5},{s:1,f:7}]},{t:3,h3dSynth:true,notes:[{s:0,f:2}]}]);
    assert.deepEqual(rows.map(({time,frets})=>({time,frets})),[
        {time:0,frets:1<<8},{time:1,frets:0},{time:2,frets:(1<<5)|(1<<7)},
    ]);
});
