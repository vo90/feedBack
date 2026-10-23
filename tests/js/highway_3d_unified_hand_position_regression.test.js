const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildHandshapeGuidance, composeHandPositionLanes,
} = require('../../plugins/highway_3d/src/hand-position-guidance.mjs');
const fixtures = require('../helpers/hand_position_guidance_fixtures.cjs');

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

function resolve(chart) {
    const model = buildHandshapeGuidance({
        notes: chart.notes, chords: chart.chords, handShapes: chart.handShapes,
        templates: chart.chordTemplates, stringCount: 6,
    });
    return { model, rows: composeHandPositionLanes(chart.anchors, model.grips,
        { eventGrips: model.eventGrips }) };
}

function spanAt(rows, time) {
    let row = rows[0];
    for (const next of rows) {
        if (next.time > time) break;
        row = next;
    }
    return [row.fret, row.fret + row.width - 1];
}

function assertOneTimeline(rows) {
    for (const [i, row] of rows.entries()) {
        assert.ok(Number.isFinite(row.time), 'lane boundaries use real chart time');
        assert.ok(Number.isInteger(row.fret) && Number.isInteger(row.width));
        assert.ok(row.fret >= 1 && row.width >= 1 && row.fret + row.width - 1 <= 24);
        if (i) assert.ok(rows[i - 1].time < row.time, 'one lane row owns each instant');
    }
}

test('a containing position keeps a power chord at 2–5', () => {
    const chart = freeze(fixtures.containingPowerChord());
    const { model, rows } = resolve(chart);
    assert.deepEqual(model.handShapes, chart.handShapes);
    for (const t of [0, 9.9, 10, 11, 12, 15]) assert.deepEqual(spanAt(rows, t), [2, 5]);
    assertOneTimeline(rows);
});

test('a verified picked grip widens the main lane to include all three frets', () => {
    const chart = freeze(fixtures.pickedWideGrip());
    const { model, rows } = resolve(chart);
    assert.deepEqual(model.handShapes, chart.handShapes);
    assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[3, 7]]);
    assert.deepEqual(spanAt(rows, 9.9), [3, 6]);
    for (const t of [10, 10.15, 10.3, 10.45, 10.59]) assert.deepEqual(spanAt(rows, t), [3, 7]);
    assert.deepEqual(spanAt(rows, 11.1), [3, 6]);
    assertOneTimeline(rows);
});

for (const name of ['stalePowerGrip', 'staleFullGrip']) {
    test(`${name}: unrelated previous fingering cannot move the current lane`, () => {
        const chart = freeze(fixtures[name]());
        const { model, rows } = resolve(chart);
        assert.equal(model.handShapes.length, 0);
        assert.equal(model.grips.length, 0);
        for (const t of [10, 10.25, 10.5, 11.25]) assert.deepEqual(spanAt(rows, t), [7, 10]);
        assertOneTimeline(rows);
    });
}

test('slide destination and arpeggio share one lane; unsupported low-string grip is excluded', () => {
    const chart = freeze(fixtures.slideIntoArpeggio());
    const { model, rows } = resolve(chart);
    assert.deepEqual(model.handShapes.map(h => h.chord_id), [0]);
    assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[4, 5]]);
    assert.deepEqual(spanAt(rows, 9.9), [1, 4]);
    assert.deepEqual(spanAt(rows, 10.05), [1, 5], 'current slide source and destination coexist');
    for (const t of [10.152, 10.303, 10.601, 10.7]) assert.deepEqual(spanAt(rows, t), [4, 7]);
    assertOneTimeline(rows);
});

test('a partial chord does not invalidate a larger grip supported by the surrounding picks', () => {
    const chart = freeze(fixtures.partialChordInFullGrip());
    const { model, rows } = resolve(chart);
    assert.deepEqual(model.handShapes, chart.handShapes);
    assert.deepEqual(spanAt(rows, 10.1), [3, 7]);
    assert.deepEqual(spanAt(rows, 10.5), [3, 7]);
    assertOneTimeline(rows);
});

test('a supported high grip cannot exclude simultaneously sounding lower-string chord notes', () => {
    const chart = freeze(fixtures.disjointSustainedContacts());
    const { model, rows } = resolve(chart);
    assert.equal(model.handShapes.length, 1);
    assert.deepEqual(spanAt(rows, 10.25), [15, 18]);
    for (const t of [10.55, 10.9, 11.29]) assert.deepEqual(spanAt(rows, t), [3, 17]);
    assert.deepEqual(spanAt(rows, 11.4), [15, 18], 'released low notes do not leave a permanently wide lane');
    assert.deepEqual(spanAt(rows, 12.1), [3, 6]);
    assertOneTimeline(rows);
});

test('guidance resolution never changes playable events, sustain timing, templates or source anchors', () => {
    for (const factory of Object.values(fixtures)) {
        const chart = freeze(factory()), before = JSON.stringify(chart);
        const first = resolve(chart), second = resolve(chart);
        assert.equal(JSON.stringify(chart), before);
        assert.deepEqual(second, first, 'independent rebuilds are deterministic');
        assertOneTimeline(first.rows);
    }
});

test('forward playback, reverse seeks and difficulty replacement cannot retain an earlier grip', () => {
    const chart = freeze(fixtures.pickedWideGrip());
    const original = resolve(chart);
    for (const time of [10.3, 9, 11.2, 10, 11.2, 10.3, 0]) {
        assert.deepEqual(spanAt(original.rows, time), spanAt(resolve(chart).rows, time));
    }
    const easier = freeze({ ...chart, notes: [], chords: [], handShapes: [] });
    const withoutGrip = resolve(easier);
    assert.equal(withoutGrip.model.grips.length, 0);
    assert.deepEqual(spanAt(withoutGrip.rows, 10.3), [3, 6]);
    assert.deepEqual(resolve(chart), original, 'restoring the original difficulty restores its own guidance');
});

test('replacing templates of equal length cannot keep a formerly supported handshape', () => {
    const chart = freeze(fixtures.pickedWideGrip());
    assert.equal(resolve(chart).model.grips.length, 1);
    const replaced = freeze({ ...chart,
        chordTemplates: [{ frets: [-1, 12, 14, 16, -1, -1] }],
    });
    const next = resolve(replaced);
    assert.equal(next.model.handShapes.length, 0);
    assert.deepEqual(spanAt(next.rows, 10.3), [3, 6]);
});

test('many local handshapes do not repeatedly scan the entire event stream', () => {
    const count = 1500;
    let fieldReads = 0;
    const notes = [], handShapes = [];
    for (let i = 0; i < count; i++) {
        const start = i * 2;
        handShapes.push({ chord_id: 0, start_time: start, end_time: start + 0.6 });
        for (const [offset, s, f] of [[0, 1, 3], [0.15, 2, 5], [0.3, 3, 7], [0.45, 2, 5]]) {
            notes.push(Object.freeze({ s,
                get t() { fieldReads++; return start + offset; },
                get f() { fieldReads++; return f; },
            }));
        }
    }
    const model = buildHandshapeGuidance({ notes, chords: [], handShapes,
        templates: [{ frets: [-1, 3, 5, 7, -1, -1] }], stringCount: 6 });
    assert.equal(model.handShapes.length, count);
    assert.ok(fieldReads < notes.length * 128,
        `${fieldReads} event field reads exceed a bounded local lookup budget`);
});
