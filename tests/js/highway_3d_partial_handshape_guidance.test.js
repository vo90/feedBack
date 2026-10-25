const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHandshapeGuidance, composeHandPositionLanes } =
    require('../../plugins/highway_3d/src/hand-position-guidance.mjs');

function fixture(extra = {}) {
    return {
        notes: [],
        chords: [10, 10.2, 10.3, 10.4].map((t, i) => ({ t, id: 1, hd: i > 0,
            notes: [2, 3].map(s => ({ s, f: 7, ...(i ? { fhm: true } : {}) })) })),
        anchors: [{ time: 0, fret: 7, width: 4, guidanceOrigin: 'source' }],
        handShapes: [{ chord_id: 0, start_time: 10, end_time: 11 }],
        templates: [{ frets: [-1, 5, 7, 7, -1, -1] },
            { frets: [-1, -1, 7, 7, -1, -1] }],
        ...extra,
    };
}

function resolve(chart) {
    const model = buildHandshapeGuidance(chart);
    const rows = composeHandPositionLanes(chart.anchors, model.grips,
        { eventGrips: model.eventGrips });
    return { model, rows };
}

function spanAt(rows, time) {
    const row = rows.filter(r => r.time <= time).at(-1);
    return [row.fret, row.fret + row.width - 1];
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

test('a partial chord retains its parent context without borrowing its unplayed lower fret', () => {
    for (const guidanceOrigin of ['source', 'user', 'unknown', 'generated']) {
        const chart = freeze(fixture({ anchors: [{ time: 0, fret: 7, width: 4, guidanceOrigin }] }));
        const before = JSON.stringify(chart);
        const { model, rows } = resolve(chart);
        assert.equal(model.handShapes[0], chart.handShapes[0], 'keep the contextual handshape');
        assert.equal(model.decisions[0].status, 'supported');
        assert.deepEqual(model.decisions[0].matchedStrings, [2, 3]);
        assert.deepEqual(model.decisions[0].unmatchedStrings, [1]);
        assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[7, 7]]);
        for (const time of [0, 9.9, 10, 10.2, 10.3, 10.9, 11, 12]) {
            assert.deepEqual(spanAt(rows, time), [7, 10]);
        }
        assert.equal(JSON.stringify(chart), before, 'source notes, techniques, templates and anchors stay intact');
    }
});

test('unused high template frets cannot widen pitched or muted partial chords', () => {
    for (const technique of [{}, { fhm: true }, { pm: true }]) {
        const chart = fixture({ templates: [{ frets: [-1, -1, 7, 7, 17, -1] }],
            chords: [{ t: 10, id: 0, notes: [2, 3].map(s => ({ s, f: 7, ...technique })) }] });
        const { model, rows } = resolve(chart);
        assert.equal(model.handShapes.length, 1);
        assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[7, 7]]);
        assert.deepEqual(spanAt(rows, 10.2), [7, 10]);
    }
});

test('supported open strings do not borrow a fretted member from their parent template', () => {
    const chart = fixture({ templates: [{ frets: [-1, 5, 0, 0, -1, -1] }],
        chords: [{ t: 10, notes: [{ s: 2, f: 0 }, { s: 3, f: 0 }] }] });
    const { model, rows } = resolve(chart);
    assert.equal(model.handShapes.length, 1);
    assert.deepEqual(model.grips, []);
    assert.equal(rows, chart.anchors, 'no positive grip requires composition');
});

const optionalContactCases = [
    ['separately picked', [{ t: 10.25, s: 1, f: 5 }], true],
    ['carried sustain', [{ t: 9.5, s: 1, f: 5, sus: 1 }], true],
    ['expired sustain', [{ t: 9, s: 1, f: 5, sus: 0.5 }], false],
    ['replaced sustain', [{ t: 9, s: 1, f: 5, sus: 2 }, { t: 9.9, s: 1, f: 5, mt: true }], false],
    ['plain dead strike', [{ t: 10.25, s: 1, f: 5, mt: true }], false],
    ['reached slide target', [{ t: 9.75, s: 1, f: 3, sl: 5, sus: 0.5 }], true],
    ['interrupted slide', [{ t: 9.75, s: 1, f: 3, sl: 5, sus: 0.5 }, { t: 10.1, s: 1, f: 9 }], false],
    ['attack after shape ends', [{ t: 11, s: 1, f: 5 }], false],
];
for (const [name, notes, supported] of optionalContactCases) {
    test(`partial chord optional contact: ${name}`, () => {
        const { model, rows } = resolve(freeze(fixture({ notes })));
        assert.equal(model.handShapes.length, 1, 'the two played chord strings still support context');
        assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[supported ? 5 : 7, 7]]);
        assert.deepEqual(spanAt(rows, 10.6), supported ? [5, 10] : [7, 10]);
        assert.deepEqual(spanAt(rows, 11.1), [7, 10], 'restore the underlying position at the grip end');
    });
}

test('a real sustained outside note remains covered without validating an unused template member', () => {
    const { model, rows } = resolve(fixture({ notes: [{ t: 9.9, s: 0, f: 4, sus: 0.3 }] }));
    assert.deepEqual(model.grips.map(g => [g.low, g.high]), [[7, 7]]);
    assert.deepEqual(spanAt(rows, 10.1), [4, 10]);
    assert.deepEqual(spanAt(rows, 10.3), [7, 10], 'the outside note stops widening after its real sustain');
});
