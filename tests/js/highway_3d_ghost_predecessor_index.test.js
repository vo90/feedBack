const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let end = source.indexOf('{', start) + 1, depth = 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0);
    return source.slice(start, end);
}
const start = source.indexOf('_scrGhostPrevBuf.clear();');
const end = source.indexOf('// Ramp strGlow', start);
assert.ok(start >= 0 && end > start);
const prepass = new Function('notes', 'chords', 'now', 'nStr', 'rsPlusNotation', `
    ${extractFunction('lowerBoundT')}
    const _scrGhostPrevBuf = new Map(), _scrGhostLastT = Array(nStr).fill(-Infinity);
    const validString = s => Number.isInteger(s) && s >= 0 && s < nStr;
    ${source.slice(start, end)}
    return [..._ghostPrevBuf];
`);

// Declarative reference for the existing two-stream ordering: all note events
// precede chord events at the same onset; authored order within each survives.
function reference(notes, chords, now, nStr) {
    const events = [
        ...(notes || []).map((note, order) => ({ t: note.t, kind: 0, order, members: [note] })),
        ...(chords || []).map((chord, order) => ({ t: chord.t, kind: 1, order, members: chord.notes || [] })),
    ].filter(event => event.t >= now - 1 && event.t <= now + .65)
        .sort((a, b) => a.t - b.t || a.kind - b.kind || a.order - b.order);
    const result = new Map(), previous = Array(nStr).fill(-Infinity);
    for (const event of events) for (const note of event.members) {
        if (!Number.isInteger(note.s) || note.s < 0 || note.s >= nStr) continue;
        result.set(Math.round(event.t * 1e4) * 10 + note.s, previous[note.s]);
        previous[note.s] = event.t;
    }
    return [...result];
}

function verify(notes, chords, times, strings = 6) {
    const before = JSON.stringify({ notes, chords });
    for (const now of times) for (const rsPlus of [false, true]) {
        assert.deepEqual(prepass(notes, chords, now, strings, rsPlus),
            reference(notes, chords, now, strings), `time ${now}, RS+ ${rsPlus}`);
    }
    assert.equal(JSON.stringify({ notes, chords }), before, 'the prepass must not reorder or edit chart data');
}

test('indexed ghost candidates preserve both exact window boundaries and simultaneous event order', () => {
    const notes = [
        { t: 8.9999, s: 0, f: 2 },
        { t: 9, s: 0, f: 3 },
        { t: 10, s: 0, f: 4 },
        { t: 10, s: 1, f: 5 },
        { t: 10.65, s: 1, f: 6 },
        { t: 10.6501, s: 0, f: 7 },
    ];
    const chords = [
        { t: 8.9999, notes: [{ s: 1, f: 2 }] },
        { t: 9, notes: [{ s: 1, f: 3 }] },
        { t: 10, notes: [{ s: 0, f: 8 }, { s: 1, f: 9 }] },
        { t: 10, notes: [{ s: 1, f: 10 }, { s: 0, f: 11 }] },
        { t: 10.65, notes: [{ s: 0, f: 12 }] },
        { t: 10.6501, notes: [{ s: 1, f: 13 }] },
    ];
    verify(notes, chords, [10, 10.0001, 9.9999]);
    const result = new Map(prepass(notes, chords, 10, 6, false));
    assert.equal(result.get(90000 * 10), -Infinity);
    assert.equal(result.get(100000 * 10), 10, 'equal-time chords retain the same-stream overwrite order');
    assert.equal(result.has(106500 * 10), true);
    assert.equal(result.has(106501 * 10 + 1), false);
});

test('sustains, linked and synthetic chords preserve onset-only ghost predecessor semantics', () => {
    const notes = [
        { t: 1, s: 0, f: 3, sus: 100, linkNext: true },
        { t: 9, s: 1, f: 4, sus: 8 },
        { t: 9.8, s: 1, f: 7, sus: 0 },
        { t: 10.1, s: 0, f: 5, sus: 20 },
    ];
    const chords = [
        { t: 2, notes: [{ s: 0, f: 5, sus: 100 }] },
        { t: 9.25, h3dSynth: true, notes: [{ s: 1, f: 5, sus: 5 }] },
        { t: 9.8, h3dStrum: true, notes: [{ s: 1, f: 6, sus: 4 }] },
        { t: 10.2, notes: [{ s: 0, f: 7, sus: 1 }, { s: 1, f: 8, sus: 0 }] },
    ];
    verify(notes, chords, [10, 2, 9.2, 30, 10]); // backward/forward seeks do not retain a cursor
    const result = new Map(prepass(notes, chords, 10, 6, true));
    assert.equal(result.get(101000 * 10), -Infinity, 'old sustained attacks remain outside the onset window');
    assert.equal(result.get(102000 * 10 + 1), 9.8);
});

test('empty streams and invalid strings preserve the same valid candidates at all string counts', () => {
    verify(null, null, [-2, 0, 10]);
    verify([], [], [-2, 0, 10]);
    for (const strings of [4, 6, 7, 8]) {
        const chords = [
            { t: -1 }, { t: -.5, notes: [] },
            { t: 0, notes: [-1, 0, strings - 1, strings, 1.5, NaN].map(s => ({ s, f: 3 })) },
            { t: .5, notes: [{ s: strings - 1, f: 5 }] },
        ];
        verify(null, chords, [-1, 0, .5, 1], strings);
        verify([{ t: 0, s: 0, f: 4 }], null, [-1, 0, 1], strings);
    }
});

test('long-chart lookup reads a bounded prefix of candidates instead of all historical chords', () => {
    const plain = Array.from({ length: 16384 }, (_, i) => ({
        t: i * .25, notes: [{ s: i % 6, f: i % 12 + 1, sus: 2 }],
    }));
    let reads = 0;
    const chords = new Proxy(plain, {
        get(target, key, receiver) {
            if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver);
        },
    });
    const now = 4000;
    let priorIndex = 0;
    while (priorIndex < chords.length && chords[priorIndex].t < now - 1) priorIndex++;
    assert.ok(reads > 15000, 'the previous prefix scan reaches historical entries');
    reads = 0;
    const actual = prepass([], chords, now, 6, true);
    assert.ok(reads < 64, `expected a binary lookup and short local window, got ${reads} chord reads`);
    assert.deepEqual(actual, reference([], plain, now, 6));
});
