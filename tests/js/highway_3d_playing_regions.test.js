const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

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
const helpers = ['isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'usesUnfrettedPosition',
    'slideTrailEnd', 'getChartAnchorAt', 'hwyBuildPlayingRegions'].map(extract).join('\n');
function harness(logarithmic = false) {
    return new Function(`
        const NFRETS = 24, CHORD_ANCHOR_TIME_EPS = 0.000501;
        const fretWire = f => ${logarithmic ? '100 * (1 - Math.pow(2, -f / 12))' : 'f * 10'};
        const fretMid = f => f > 0 ? (fretWire(f - 1) + fretWire(f)) / 2 : -2;
        ${helpers}
        return { build: hwyBuildPlayingRegions, at: getChartAnchorAt, fretMid };
    `)();
}
const { build, at } = harness();
const note = (t, f, extra = {}) => ({ t, f, s: 0, ...extra });
const anchor = (time, fret, width = 4) => ({ time, fret, width });
const chord = (t, frets, extra = {}) => ({ t, notes: frets.map((f, s) => ({ f, s })), ...extra });
const bounds = row => [row.fret, row.width];
const covers = (row, f) => f >= row.fret && f < row.fret + row.width;
function frozen(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) frozen(child);
        Object.freeze(value);
    }
    return value;
}

test('fixed authored area ignores alternating fretted, open and chord attacks', () => {
    const notes = Array.from({ length: 60 }, (_, i) => note(i / 10, [2, 0, 5, 3][i % 4]));
    const rows = build(notes, [chord(2.5, [0, 2, 5])], [anchor(0, 2)]);
    assert.deepEqual(rows, [{ time: 0, fret: 2, width: 4, source: 'authored' }]);
});

test('authored position changes during an empty rest before any next attack', () => {
    const rows = build([note(107.5, 2), note(119.458, 10)], [], [anchor(0, 2), anchor(108.720001, 10)]);
    assert.deepEqual(bounds(at(rows, 108.72)), [2, 4]);
    assert.deepEqual(bounds(at(rows, 108.721)), [10, 4]);
    assert.equal(at(rows, 115).source, 'authored');
});

test('equal authored rows coalesce and width-only changes remain meaningful', () => {
    const rows = build([], [], [anchor(0, 2), anchor(1, 2), anchor(2, 2, 7), anchor(3, 2, 7)]);
    assert.deepEqual(rows.map(r => [r.time, r.fret, r.width]), [[0, 2, 4], [2, 2, 7]]);
});

test('first useful authored position also applies before its source timestamp', () => {
    const rows = build([note(-1, 5)], [], [anchor(10, 5), anchor(20, 9)]);
    assert.deepEqual(bounds(at(rows, -100)), [5, 4]);
    assert.deepEqual(bounds(at(rows, 19)), [5, 4]);
});

test('authored rows are sorted and last duplicate timestamp wins', () => {
    const rows = build([], [], [anchor(20, 9), anchor(0, 3), anchor(20, 10)]);
    assert.deepEqual(bounds(at(rows, 19)), [3, 4]);
    assert.deepEqual(bounds(at(rows, 20)), [10, 4]);
});

test('fret-zero anchors and missing widths match the existing lane convention', () => {
    const rows = build([], [], [{ time: 0, fret: 0 }, { time: 1, fret: 6, width: null }]);
    assert.deepEqual(rows.map(bounds), [[1, 4], [6, 4]]);
});

test('legitimate wide authored tapping positions are retained', () => {
    const rows = build([note(1, 18)], [chord(2, [4, 18])], [anchor(0, 4, 15)]);
    assert.equal(rows.length, 1);
    assert.deepEqual(bounds(rows[0]), [4, 15]);
    assert.equal(rows[0].source, 'authored');
});

test('malformed and out-of-neck anchors provide local inference', () => {
    const invalid = [null, { time: NaN, fret: 10, width: 4 }, anchor(0, -2), anchor(0, 25),
        anchor(0, 22, 4), anchor(0, 5, 0), anchor(0, 5, -1), anchor(0, 5, Infinity),
        { time: 0, fret: null, width: 4 }];
    for (const row of invalid) {
        const rows = build([note(2, 12)], [], [row]);
        assert.ok(covers(at(rows, 2), 12), JSON.stringify(row));
        assert.equal(at(rows, 2).source, 'inferred');
        assert.deepEqual(bounds(at(rows, 1)), [1, 4], 'a future note must not pull the area early');
    }
});

test('a whole-neck placeholder does not force permanent whole-neck framing', () => {
    const rows = build([note(1, 12), note(2, 10)], [], [anchor(0, 1, 24)]);
    assert.deepEqual(bounds(at(rows, 0)), [1, 4]);
    assert.ok(covers(at(rows, 2), 10));
    assert.equal(at(rows, 2).width, 4);
});

test('actual whole-neck simultaneous music still gets a whole-neck fallback', () => {
    const rows = build([], [chord(2, [1, 24])], [anchor(0, 1, 24)]);
    assert.deepEqual(bounds(at(rows, 2)), [1, 24]);
    assert.equal(at(rows, 2).source, 'inferred');
});

test('a wide inferred group returns to a normal area after a sustained coherent passage', () => {
    const rows = build([note(1, 3), note(1.5, 4), note(2, 3), note(2.5, 2)], [chord(0, [1, 24])], []);
    assert.deepEqual(bounds(at(rows, 1.99)), [1, 24]);
    assert.deepEqual(bounds(at(rows, 2)), [1, 4]);
    assert.equal(rows.length, 2);
});

test('one narrow pick, sparse picks and brief flurries do not collapse a wide inferred area', () => {
    for (const notes of [[note(1, 3)], [note(1, 3), note(5, 3), note(9, 3)],
        [note(1, 3), note(1.1, 4), note(1.2, 3)]]) {
        const rows = build(notes, [chord(0, [1, 24])], []);
        assert.equal(rows.length, 1);
        assert.deepEqual(bounds(at(rows, 100)), [1, 24]);
    }
});

test('wide authored regions remain authoritative during a narrower run', () => {
    const rows = build([note(1, 3), note(1.5, 4), note(2, 3)], [], [anchor(0, 2, 18)]);
    assert.deepEqual(bounds(at(rows, 3)), [2, 18]);
    assert.equal(rows.length, 1);
});

test('an invalid position ends valid guidance without inventing a rest movement', () => {
    const rows = build([note(5, 14)], [], [anchor(0, 3), anchor(2, 1, 24), anchor(10, 7)]);
    assert.deepEqual(bounds(at(rows, 3)), [3, 4]);
    assert.ok(covers(at(rows, 5), 14));
    assert.deepEqual(bounds(at(rows, 10)), [7, 4]);
});

test('fallback retains its area for local notes and through silence and opens', () => {
    const rows = build([note(0, 6), note(1, 4), note(2, 5), note(20, 0), note(50, 6)], [], []);
    assert.equal(rows.length, 1);
    assert.deepEqual(bounds(at(rows, 100)), [3, 4]);
});

test('fallback does not use distant future fretted events to place an open intro', () => {
    const rows = build([note(0, 0), note(120, 24)], [], []);
    assert.deepEqual(bounds(at(rows, 119.9)), [1, 4]);
    assert.deepEqual(bounds(at(rows, 120)), [21, 4]);
});

test('a simultaneous fallback chord expands the area once and ignores open members', () => {
    const rows = build([], [chord(1, [0, 4, 12])], []);
    assert.deepEqual(bounds(at(rows, 1)), [4, 9]);
    assert.equal(rows.length, 2);
});

test('coincident rounded notes and duplicate chord members count as one attack', () => {
    const rows = build([note(1, 12), note(1.0004, 12, { s: 1 })], [chord(1, [12, 12])], [anchor(0, 2)]);
    assert.equal(rows.length, 1, 'one chord must not trigger the three-attack mismatch rule');
});

test('synthetic arpeggio preview chords cannot change the playing area', () => {
    const rows = build([note(1, 3)], [chord(1, [19, 22], { h3dSynth: true })], []);
    assert.deepEqual(rows, [{ time: 0, fret: 1, width: 4, source: 'inferred' }]);
});

test('an isolated outlying note or a slide does not replace useful authored guidance', () => {
    const rows = build([note(1, 12), note(2, 3), note(3, 3, { sus: 4, sl: 22 })], [], [anchor(0, 2)]);
    assert.equal(rows.length, 1);
    assert.deepEqual(bounds(at(rows, 8)), [2, 4]);
});

test('three outlying attacks in a local second establish persistent disagreement', () => {
    const rows = build([note(1, 12), note(1.3, 11), note(1.7, 12), note(2, 10)], [], [anchor(0, 2)]);
    assert.deepEqual(bounds(at(rows, 1.69)), [2, 4]);
    assert.equal(at(rows, 1.7).source, 'inferred');
    assert.ok(covers(at(rows, 2), 10));
});

test('sparse isolated outliers do not accumulate into a false persistent mismatch', () => {
    const rows = build([note(1, 12), note(5, 12), note(9, 12)], [], [anchor(0, 2)]);
    assert.equal(rows.length, 1);
});

test('in-bounds fretted attacks reset an unconfirmed mismatch streak', () => {
    const rows = build([note(1, 12), note(1.1, 12), note(1.2, 3), note(1.3, 12), note(1.4, 12)], [], [anchor(0, 2)]);
    assert.equal(rows.length, 1);
});

test('confirmed fallback survives identical authored rows and occasional in-bounds notes', () => {
    const notes = [note(1, 12), note(1.1, 12), note(1.2, 12), note(1.4, 3), note(1.6, 12)];
    const rows = build(notes, [], [anchor(0, 2), anchor(1.3, 2), anchor(1.5, 2), anchor(5, 8)]);
    assert.equal(at(rows, 1.6).source, 'inferred');
    assert.ok(covers(at(rows, 1.6), 12));
    assert.deepEqual(bounds(at(rows, 5)), [8, 4]);
    assert.equal(at(rows, 5).source, 'authored');
});

test('known slides move inferred positions along the actual eased path, not at onset', () => {
    for (const logarithmic of [false, true]) {
        const h = harness(logarithmic), rows = h.build([note(0, 3, { sus: 2, sl: 15 })], [], []);
        assert.deepEqual(bounds(h.at(rows, 0.5)), [1, 4]);
        assert.ok(rows.some(row => row.time > 0.5 && row.time < 2));
        assert.ok(covers(h.at(rows, 2), 15));
        const firstShift = rows.find(row => row.time > 0);
        const p = firstShift.time / 2;
        const actualX = h.fretMid(3) + (h.fretMid(15) - h.fretMid(3)) * Math.pow(Math.sin(p * Math.PI / 2), 3);
        assert.ok(Math.abs(actualX - h.fretMid(5)) < 1e-8);
    }
});

test('descending and known unpitched slides generate bounded destination coverage', () => {
    for (const key of ['sl', 'slu']) {
        const rows = build([note(1, 20, { sus: 4, [key]: 3 })], [], []);
        assert.ok(covers(at(rows, 1), 20));
        assert.ok(covers(at(rows, 5), 3));
        for (const row of rows) {
            assert.ok(row.fret >= 1 && row.fret + row.width - 1 <= 24);
            assert.ok(row.width >= 4);
        }
    }
});

test('targetless slide directions never invent a new inferred fret', () => {
    const notes = [note(0, 3, { sus: 2, slide_out: 'up', slide_out_marks: [{ t: 0, d: 'up' }] }),
        note(3, 3, { sus: 2, slide_in: 'down', slide_in_marks: [{ t: 0, d: 'down' }] })];
    const rows = build(notes, [], []);
    assert.deepEqual(rows, [{ time: 0, fret: 1, width: 4, source: 'inferred' }]);
});

test('new same-string attacks stop old written slide overlap from reclaiming focus', () => {
    for (const replacement of [note(0.3, 3), note(0.3, 0), note(0.3, 127, { mt: true })]) {
        const rows = build([note(0, 3, { sus: 10, sl: 24, ln: 1 }), replacement], [], []);
        assert.deepEqual(bounds(at(rows, 10)), [1, 4]);
        assert.equal(rows.length, 1);
    }
});

test('an attack on a different string does not terminate a real slide position', () => {
    const rows = build([note(0, 3, { sus: 2, sl: 15 }), note(0.3, 3, { s: 1 })], [], []);
    assert.ok(covers(at(rows, 2), 15));
});

test('chord slides inherit the enclosing onset and source objects stay immutable', () => {
    const input = frozen({ notes: [note(0, 3)], chords: [{ t: 5, notes: [{ s: 0, f: 3, sus: 2, sl: 15 }] }],
        anchors: [anchor(0, 1, 24)] });
    const before = JSON.stringify(input);
    const rows = build(input.notes, input.chords, input.anchors);
    assert.ok(covers(at(rows, 7), 15));
    assert.deepEqual(bounds(at(rows, 5)), [1, 4]);
    assert.equal(JSON.stringify(input), before);
});

test('bass string count and malformed notes do not introduce phantom areas', () => {
    const rows = build([note(0, 3), note(1, 24, { s: 4 }), note(NaN, 20), note(2, -1), note(3, 127),
        note(4, 20, { s: 0.5 }), null], [null], [], 4);
    assert.deepEqual(rows, [{ time: 0, fret: 1, width: 4, source: 'inferred' }]);
});

test('missing and all-open charts always provide a finite stable default area', () => {
    for (const notes of [undefined, [], [note(5, 0), note(500, 0)]]) {
        const rows = build(notes, null, undefined);
        assert.deepEqual(rows, [{ time: 0, fret: 1, width: 4, source: 'inferred' }]);
    }
});

test('a dense 50,000-note chart builds once in a bounded CPU budget', () => {
    const notes = Array.from({ length: 50000 }, (_, i) => note(i * 0.025, [3, 0, 4, 2][i % 4], { s: i % 6 }));
    const started = performance.now();
    const rows = build(notes, [], [anchor(0, 2)]);
    const duration = performance.now() - started;
    assert.equal(rows.length, 1);
    assert.ok(duration < 2500, `50k-note index build took ${duration.toFixed(1)} ms`);
});
