const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHandshapeGuidance } = require('../../plugins/highway_3d/src/hand-position-guidance.mjs');

const source = extra => ({ t: 10, s: 5, f: 15, sus: 1, ln: true, ...extra });
const target = extra => ({ t: 11, s: 5, f: 15, sus: .5, ...extra });
const model = (notes, chords = []) => buildHandshapeGuidance({ notes, chords });
const demand = (result, time = 10) => result.eventGrips.find(g => g.start === time);

test('an expired link cannot turn a short written sustain into a long remote contact', () => {
    const a = source({ t: 1463.578003, sus: 1.321, bn: 2, vb: true });
    for (const f of [13, 15]) {
        const result = model([a, target({ t: 1474.551025, f })]);
        assert.equal(demand(result, a.t).end, a.t + a.sus);
    }
});

test('valid same-fret continuations bridge only the one-millisecond physical seam', () => {
    for (const delta of [-.0008, 0, .0008, .001]) {
        const a = source(), b = target({ t: 11 + delta });
        const result = model([b, a]);
        assert.equal(demand(result).end, b.t);
        assert.equal(demand(result, b.t).end, b.t + b.sus);
    }
    for (const delta of [.0011, .002, .03, .061, 10]) {
        assert.equal(demand(model([source(), target({ t: 11 + delta })])).end, 11);
    }
});

test('a wrong fret, invalid or dead destination cannot bridge a rounding gap', () => {
    for (const extra of [{ f: 13 }, { f: -1 }, { mt: true }]) {
        assert.equal(demand(model([source(), target({ t: 11.0008, ...extra })])).end, 11);
    }
    assert.equal(demand(model([source({ ln: false }), target({ t: 11.0008 })])).end, 11);
    assert.equal(demand(model([source(), target({ t: 11.0008, s: 4 })])).end, 11);
});

test('missing or invalid written duration does not manufacture a physical hold', () => {
    for (const sus of [undefined, 0, -1, NaN, Infinity]) {
        const result = model([source({ sus }), target({ t: 20 })]);
        assert.equal(demand(result).end, 10 + 2 * .000501, 'retain only the attack footprint');
    }
});

test('genuine written sustains remain covered and stop at their next string attack', () => {
    for (const ln of [false, true]) {
        assert.equal(demand(model([source({ sus: 10, ln })])).end, 20);
        assert.equal(demand(model([source({ sus: 10, ln }), target({ t: 14, f: 13 })])).end, 14);
        assert.equal(demand(model([source({ sus: 10, ln }), target({ t: 14, mt: true })])).end, 14);
    }
});

test('links cannot jump over an intervening string attack to a later matching fret', () => {
    const result = model([source({ sus: .5 }), target({ t: 10.5, f: 13 }), target({ t: 11 })]);
    assert.equal(demand(result).end, 10.5);
});

test('coincident destination evidence is deterministic and must agree on the contact fret', () => {
    const a = source(), b = target({ t: 11.0008 }), c = target({ t: 11.0008, f: 13 });
    for (const notes of [[a, b, c], [c, b, a]]) assert.equal(demand(model(notes)).end, 11);
    const duplicate = { ...b };
    for (const notes of [[a, b, duplicate], [duplicate, b, a]]) {
        assert.equal(demand(model(notes)).end, b.t, 'identical contacts do not invent a different position');
    }
});

test('written chord-member ties keep their own intervals across note/chord representations', () => {
    const a = { s: 5, f: 15, sus: 1, ln: true }, b = target({ t: 11.0008, ln: true });
    const c = { s: 5, f: 15, sus: .5 };
    const result = model([b], [{ t: 10, notes: [a] }, { t: 11.5008, notes: [c] }]);
    assert.deepEqual(result.eventGrips.map(g => [g.start, g.end]),
        [[10, b.t], [b.t, 11.5008], [11.5008, 12.0008]]);
    assert.equal(a.t, undefined);
});

test('valid slide continuations keep the reached destination without holding the old fret', () => {
    for (const field of ['sl', 'slu']) {
        const a = source({ f: 7, [field]: 15 }), b = target({ t: 11 });
        const result = buildHandshapeGuidance({ notes: [a, b, { t: 11, s: 4, f: 13, sus: .5 }],
            templates: [{ frets: [-1, -1, -1, -1, 13, 15] }],
            handShapes: [{ chord_id: 0, start_time: 11, end_time: 11.5 }] });
        assert.equal(result.decisions[0].status, 'supported');
        assert.deepEqual(result.grips.map(g => [g.low, g.high]), [[13, 15]]);
        assert.equal(demand(result).end, 10 + 2 * .000501, 'moving fret is not a stationary grip');
        assert.equal(demand(result, 11).end, 11.5);
    }
});

test('open ties support contextual handshapes without introducing positive fret demands', () => {
    const a = source({ f: 0 }), b = target({ f: 0, t: 11.0008 });
    const result = buildHandshapeGuidance({ notes: [a, b, { t: 11, s: 4, f: 0, sus: 1 }],
        templates: [{ frets: [-1, -1, -1, -1, 0, 0] }],
        handShapes: [{ chord_id: 0, start_time: 11, end_time: 11.5 }] });
    assert.equal(result.handShapes.length, 1);
    assert.deepEqual(result.grips, []);
    assert.deepEqual(result.eventGrips, []);
});

test('link validation leaves chart notes and musical metadata unchanged', () => {
    const notes = [source({ bnv: [{ t: 0, v: 2 }] }), target({ t: 11.0008, vb: true })];
    const before = JSON.stringify(notes);
    notes.forEach(n => Object.freeze(n));
    model(Object.freeze(notes));
    assert.equal(JSON.stringify(notes), before);
});
