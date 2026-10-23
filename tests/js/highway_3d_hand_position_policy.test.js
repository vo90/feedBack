const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHandshapeGuidance, composeHandPositionLanes } =
    require('../../plugins/highway_3d/src/hand-position-guidance.mjs');

const shape = (start = 1, end = 2) => ({ chord_id: 0, start_time: start, end_time: end });
const note = (t, s, f, extra = {}) => ({ t, s, f, ...extra });
const chord = (t, members, extra = {}) => ({ t, notes: members.map(([s, f]) => ({ s, f })), ...extra });
function build(extra = {}) {
    return buildHandshapeGuidance({ notes: [], chords: [],
        handShapes: [shape()], templates: [{ frets: [3, 5, -1, -1, -1, -1] }], ...extra });
}
function boundsAt(rows, time) {
    let row = rows[0];
    for (const next of rows) if (next.time <= time) row = next;
    return [row.fret, row.fret + row.width - 1];
}

test('incoming sounding contacts can validate a grip without a new attack', () => {
    const model = build({ notes: [note(0.5, 0, 3, { sus: 2 }), note(0.75, 1, 5, { sus: 2 })] });
    assert.equal(model.decisions[0].status, 'supported');
    assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[3, 5]]);
});

test('a muted or invalid-fret attack ends earlier sustain evidence on its string', () => {
    for (const replacement of [note(0.9, 0, 3, { mt: true }), note(0.9, 0, -1)]) {
        const model = build({ notes: [note(0.5, 0, 3, { sus: 2 }), replacement,
            note(1.1, 1, 5)] });
        assert.equal(model.handShapes.length, 0);
        assert.deepEqual(model.decisions[0].matchedStrings, [1]);
    }
});

test('muted chord attacks also end earlier sustaining contacts', () => {
    const model = build({ notes: [note(0.5, 0, 3, { sus: 2 }), note(1.1, 1, 5)],
        chords: [{ t: 0.9, notes: [{ s: 0, f: 3, mt: true }] }] });
    assert.equal(model.handShapes.length, 0);
});

test('palm and fret-hand mute still provide known positions, while plain dead strikes do not', () => {
    for (const flags of [{ pm: true }, { fhm: true }]) {
        assert.equal(build({ notes: [note(1, 0, 3, flags), note(1.1, 1, 5, flags)] }).handShapes.length, 1);
    }
    assert.equal(build({ notes: [note(1, 0, 3, { mt: true }), note(1.1, 1, 5, { mt: true })] }).handShapes.length, 0);
});

test('a positioned muted technique retains its known frets, matching playable renderer policy', () => {
    for (const flags of [{ ho: true }, { po: true }, { vb: true }, { slide_out: 'up' }, { ln: true }]) {
        assert.equal(build({ notes: [note(1, 0, 3, { mt: true, ...flags }),
            note(1.1, 1, 5, { mt: true, ...flags })] }).handShapes.length, 1);
    }
});

test('a linked contact can continue to the next known same-string attack', () => {
    const model = build({ notes: [note(0.5, 0, 3, { ln: true }), note(3, 0, 7), note(1.1, 1, 5)] });
    assert.equal(model.handShapes.length, 1);
    const unlinked = build({ notes: [note(0.5, 0, 3), note(3, 0, 7), note(1.1, 1, 5)] });
    assert.equal(unlinked.handShapes.length, 0);
});

test('slide targets count only when reached before the shape ends and the string is not repicked first', () => {
    const notes = [note(0.75, 0, 1, { sl: 3, sus: 0.5 }), note(1.5, 1, 5)];
    assert.equal(build({ notes }).handShapes.length, 1);
    assert.equal(build({ notes: [...notes, note(1.1, 0, 7)] }).handShapes.length, 0);
    assert.equal(build({ notes: [note(1, 0, 1, { sl: 3, sus: 2 }), note(1.5, 1, 5)] }).handShapes.length, 0);
});

test('zero-length slides cannot establish a destination contact', () => {
    assert.equal(build({ notes: [note(1, 0, 1, { sl: 3, sus: 0 }), note(1.5, 1, 5)] }).handShapes.length, 0);
});

test('shape intervals exclude an attack exactly at their end', () => {
    assert.equal(build({ notes: [note(1, 0, 3), note(2, 1, 5)] }).handShapes.length, 0);
    assert.equal(build({ notes: [note(1, 0, 3), note(1.9, 1, 5)] }).handShapes.length, 1);
});

test('a clear replacement clips only the presentation interval of an otherwise supported shape', () => {
    const original = Object.freeze(shape(1, 4));
    const model = build({ handShapes: [original], chords: [chord(1, [[0, 3], [1, 5]]), chord(2, [[0, 7], [1, 9]])] });
    assert.equal(model.decisions[0].status, 'supported');
    assert.equal(model.decisions[0].reason, 'supported-until-replacement');
    assert.equal(model.handShapes[0].end_time, 2);
    assert.equal(original.end_time, 4);
    assert.equal(model.grips[0].end, 2);
});

test('synthesized handshape frames cannot validate their own metadata', () => {
    const model = build({ chords: [chord(1, [[0, 3], [1, 5]], { h3dSynth: true })] });
    assert.equal(model.handShapes.length, 0);
    assert.equal(model.decisions[0].status, 'unresolved');
});

test('open string contacts support a shape without inventing positive fret bounds', () => {
    const model = build({ templates: [{ frets: [0, 0, -1, -1, -1, -1] }],
        chords: [chord(1, [[0, 0], [1, 0]])] });
    assert.equal(model.handShapes.length, 1);
    assert.deepEqual(model.grips, []);
});

test('simultaneous validated grips share a single actual span and end independently', () => {
    const base = Object.freeze({ time: 0, fret: 2, width: 4, guidanceOrigin: 'source', sourceId: 'authored' });
    const rows = composeHandPositionLanes([base], [
        { start: 1, end: 3, low: 3, high: 7 }, { start: 2, end: 4, low: 10, high: 12 },
    ]);
    assert.deepEqual(boundsAt(rows, 0), [2, 5]);
    assert.deepEqual(boundsAt(rows, 1), [2, 7]);
    assert.deepEqual(boundsAt(rows, 2), [2, 12]);
    assert.deepEqual(boundsAt(rows, 3), [10, 13]);
    assert.deepEqual(boundsAt(rows, 4), [2, 5]);
    assert.ok(rows.filter(r => r.time > 0 && r.time < 4).every(r =>
        r.h3dUnifiedHandPosition && r.h3dResolvedChordLane && r.guidanceOrigin === 'source' && r.sourceId === 'authored'));
    assert.deepEqual(base, { time: 0, fret: 2, width: 4, guidanceOrigin: 'source', sourceId: 'authored' });
});

test('remote grips use a local neck-bounded position instead of a phantom corridor', () => {
    const rows = composeHandPositionLanes([{ time: 0, fret: 1, width: 4 }], [
        { start: 1, end: 2, low: 22, high: 24 },
    ]);
    assert.deepEqual(boundsAt(rows, 1), [21, 24]);
    assert.deepEqual(boundsAt(rows, 2), [1, 4]);
});

test('a source position change within a grip takes effect without retaining a previous expansion', () => {
    const rows = composeHandPositionLanes([{ time: 0, fret: 1, width: 4 },
        { time: 1.5, fret: 4, width: 4 }], [{ start: 1, end: 2, low: 4, high: 5 }]);
    assert.deepEqual(boundsAt(rows, 1), [1, 5]);
    assert.deepEqual(boundsAt(rows, 1.5), [4, 7]);
});

test('a simultaneous disjoint real chord keeps its actual frets inside the unified grip lane', () => {
    const model = build({ templates: [{ frets: [-1, -1, 10, 12, -1, -1] }],
        notes: [note(1.1, 2, 10), note(1.2, 3, 12)],
        chords: [{ t: 1, notes: [{ s: 0, f: 3, sus: 0.5 }, { s: 1, f: 5, sus: 0.5 }] }] });
    const rows = composeHandPositionLanes([{ time: 0, fret: 2, width: 4, h3dResolvedChordLane: true }],
        model.grips, { eventGrips: model.eventGrips });
    assert.deepEqual(boundsAt(rows, 1), [3, 12], 'retain actual simultaneous chord contacts, without the stale padded edge');
    assert.deepEqual(boundsAt(rows, 1.4), [3, 12]);
    assert.deepEqual(boundsAt(rows, 1.6), [10, 13], 'the chord no longer owns the lane after its sustain');
});

test('instantaneous attacks remain covered at their onset but do not become permanent remote demands', () => {
    const model = build({ templates: [{ frets: [-1, -1, 10, 12, -1, -1] }],
        notes: [note(1.1, 2, 10), note(1.2, 3, 12)], chords: [chord(1, [[0, 3], [1, 5]])] });
    const rows = composeHandPositionLanes([{ time: 0, fret: 2, width: 4, h3dResolvedChordLane: true }],
        model.grips, { eventGrips: model.eventGrips });
    assert.deepEqual(boundsAt(rows, 1), [3, 12]);
    assert.deepEqual(boundsAt(rows, 1.01), [10, 13]);
});

test('an ended historical chord marker does not invent current sounding demands', () => {
    const model = build({ templates: [{ frets: [-1, -1, 10, 12, -1, -1] }],
        notes: [note(1.1, 2, 10), note(1.2, 3, 12)], chords: [chord(0.5, [[0, 3], [1, 5]])] });
    const rows = composeHandPositionLanes([{ time: 0.5, fret: 2, width: 4, h3dResolvedChordLane: true }],
        model.grips, { eventGrips: model.eventGrips });
    assert.deepEqual(boundsAt(rows, 1), [10, 13]);
});

test('event demands alone cannot alter lanes when there is no validated handshape', () => {
    const anchors = Object.freeze([{ time: 0, fret: 1, width: 4 }]);
    assert.equal(composeHandPositionLanes(anchors, [], { eventGrips: [{ start: 1, end: 2, low: 12, high: 14 }] }), anchors);
});

test('absent or streaming null metadata produces empty guidance safely', () => {
    const empty = { handShapes: [], grips: [], eventGrips: [], decisions: [] };
    assert.deepEqual(buildHandshapeGuidance(), empty);
    assert.deepEqual(buildHandshapeGuidance(null), empty);
    assert.deepEqual(buildHandshapeGuidance({ notes: null, chords: null, handShapes: null, templates: null }), empty);
    assert.deepEqual(composeHandPositionLanes(null, null, null), []);
    assert.deepEqual(composeHandPositionLanes(null, null, { eventGrips: null }), []);
    assert.equal(buildHandshapeGuidance({ handShapes: [shape()], templates: null }).handShapes.length, 0);
});

test('keyed template maps support chart IDs without array normalization', () => {
    const model = build({ handShapes: [{ ...shape(), chord_id: 'grip-7' }],
        templates: { 'grip-7': { frets: [3, 5, -1, -1, -1, -1] } },
        notes: [note(1, 0, 3), note(1.1, 1, 5)] });
    assert.equal(model.handShapes.length, 1);
    assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[3, 5]]);
});
