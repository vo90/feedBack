const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extractFunction(text, name) {
    const start = text.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = text.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < text.length) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return text.slice(start, end);
}

function harness() {
    const names = ['stableFocusClear', 'stableFocusReset', 'stableFocusIndex', 'stableFocusUpperBound',
        'stableFocusAccumulate', 'stableFocusActive', 'stableFocusOpenContext', 'stablePlayingFocus'];
    return new Function(`
        let nStr = 6, _leftyCached = false;
        const CAM_LOCK_CENTER_FRET = 6;
        const _stableFocus = { notes: null, chords: null, noteCount: -1, chordCount: -1, strings: 0 };
        const _stableFocusResult = {}, _stableFocusNext = {};
        const validString = s => Number.isInteger(s) && s >= 0 && s < nStr;
        const isRenderableNote = n => (Number.isInteger(n.f) && n.f >= 0 && n.f <= 24) || (n.f === 127 && n.mt);
        const usesUnfrettedPosition = n => n.f === 0 || (n.f === 127 && n.mt);
        const fretMid = f => f * 10;
        const xFret = f => (_leftyCached ? -1 : 1) * f * 10;
        const xFretMid = xFret;
        function anchorLaneBoundsAt(anchors, time) {
            if (!anchors?.length) return null;
            let anchor = anchors[0];
            for (const candidate of anchors) if (candidate.time <= time) anchor = candidate;
            return { dMin: anchor.fret - 1, dMax: anchor.fret + anchor.width - 1 };
        }
        ${extractFunction(source, 'slideTrailEnd')}
        ${extractFunction(source, 'slideOffsetWorldX')}
        ${names.map(name => extractFunction(source, name)).join('\n')}
        return {
            focus(bundle, time, rate = 1) { return { ...stablePlayingFocus(bundle, time, rate) }; },
            settings({ lefty = false, strings = 6 } = {}) { _leftyCached = lefty; nStr = strings; },
            cache() { return _stableFocus; },
            reset() { stableFocusReset(); },
        };
    `)();
}

const note = (t, f, extra = {}) => ({ t, f, s: 0, ...extra });
const chart = notes => ({ notes, chords: [], anchors: [] });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8,
    message || `${actual} != ${expected}`);

test('a distant higher note cannot shift the current playing focus', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 1 }), note(2.8, 14)]);
    const actual = h.focus(bundle, 0.01);
    assert.equal(actual.valid, true); near(actual.x, 30);
    near(actual.minX, 30); near(actual.maxX, 30);
    bundle.anchors = [{ time: 0, fret: 1, width: 24 }];
    near(h.focus(bundle, 0.01).x, 30, 'unused anchor frets must not move fretted-note focus');
});

test('a local 3/5 passage keeps one preferred centre instead of hopping per attack', () => {
    const h = harness(), bundle = chart([note(0, 3), note(0.5, 5), note(1, 3), note(1.5, 5)]);
    for (const time of [0.2, 0.49, 0.51, 0.75, 0.99, 1.01, 1.49]) {
        near(h.focus(bundle, time).x, 40, `coherent focus at ${time}`);
    }
});

test('the previous distant position does not remain in the new playing group', () => {
    const h = harness(), bundle = chart([note(0, 16), note(0.5, 3), note(0.7, 5)]);
    near(h.focus(bundle, 0.51).x, 40);
});

test('simultaneous chord members form one focus and open members do not pull it to zero', () => {
    const h = harness();
    const bundle = { notes: [], chords: [{ t: 2, notes: [note(undefined, 5), note(undefined, 7, { s: 1 }), note(undefined, 0, { s: 2 })] }] };
    const out = h.focus(bundle, 2.01);
    near(out.x, 60); near(out.minX, 50); near(out.maxX, 70);
});

test('open-only notes use the authored position rather than fret zero', () => {
    const h = harness(), bundle = chart([note(2, 0)]);
    bundle.anchors = [{ time: 0, fret: 12, width: 4 }];
    near(h.focus(bundle, 2.01).x, 130);
    h.settings({ lefty: true });
    near(h.focus(bundle, 2.01).x, -130);
});

test('open-only charts without anchors use deterministic fretted context or resting position', () => {
    const h = harness(), bundle = chart([note(0, 9), note(2, 0)]);
    near(h.focus(bundle, 2.01).x, 90);
    near(h.focus(chart([note(1, 0)]), 1.01).x, 60);
    near(h.focus(chart([note(0, 0), note(0.5, 4)]), 0.01).x, 40);
});

test('open-only focus cannot inherit a distant future or stale previous fretted passage', () => {
    const h = harness();
    near(h.focus(chart([note(0, 0), note(120, 24)]), 0.01).x, 60);
    near(h.focus(chart([note(0, 24), note(120, 0)]), 120.01).x, 60);
});

test('a genuine silent gap holds the camera until the next passage becomes imminent', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 1 }), note(6, 16)]);
    assert.equal(h.focus(bundle, 2).valid, false);
    assert.equal(h.focus(bundle, 5.5).valid, false);
    const arrival = h.focus(bundle, 5.8);
    assert.equal(arrival.valid, true); near(arrival.x, 160);
});

test('a wide next attack anticipates gently without outweighing the currently sustained note', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 2 }), note(1, 16)]);
    near(h.focus(bundle, 0.5).x, 30);
    const anticipatory = h.focus(bundle, 0.99);
    assert.ok(anticipatory.x > 30 && anticipatory.x <= 69);
    near(anticipatory.minX, 30); near(anticipatory.maxX, 30);
});

test('anticipation timing is measured in real time across playback rates', () => {
    const h = harness(), bundle = chart([note(1, 12)]);
    assert.equal(h.focus(bundle, 0.6, 0.5).valid, false);
    assert.equal(h.focus(bundle, 0.6, 1).valid, false);
    const fast = h.focus(bundle, 0.6, 2);
    assert.equal(fast.valid, true); near(fast.x, 120);
});

test('slides focus on the physical position now and not their distant endpoint', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 2, sl: 15 })]);
    const start = h.focus(bundle, 0.001), middle = h.focus(bundle, 1);
    assert.ok(start.x < 30.00001);
    near(middle.x, 30 + 120 * Math.pow(Math.sin(Math.PI / 4), 3));
    assert.ok(middle.x < 100);
});

test('a sustained chord slide uses its enclosing onset without mutating its source note', () => {
    const h = harness(), member = Object.freeze({ s: 0, f: 3, sus: 2, sl: 15 });
    const bundle = Object.freeze({ notes: Object.freeze([]), chords: Object.freeze([
        Object.freeze({ t: 5, notes: Object.freeze([member]) }),
    ]) });
    near(h.focus(bundle, 6).x, 30 + 120 * Math.pow(Math.sin(Math.PI / 4), 3));
    assert.equal(member.t, undefined);
    h.settings({ lefty: true });
    near(h.focus(bundle, 6).x, -(30 + 120 * Math.pow(Math.sin(Math.PI / 4), 3)));
});

test('bend height and a future bend peak do not change lateral hand position', () => {
    const h = harness(), bundle = chart([note(0, 8, { sus: 2, bn: 2, bnv: [{ t: 0, v: 0 }, { t: 2, v: 2 }] })]);
    near(h.focus(bundle, 0.1).x, 80); near(h.focus(bundle, 1).x, 80);
});

test('targetless slide flourishes do not invent a new camera hand position', () => {
    const h = harness(), bundle = chart([note(0, 8, { sus: 2,
        slide_in_marks: [{ direction: 'up', time: 0 }, { direction: 'down', time: 1 }],
        slide_out_marks: [{ direction: 'down', start: 1.5, end: 2 }],
    })]);
    // These short ribbon offsets are visual direction cues, not authored
    // destination frets. Their geometry is protected by secondary fitting.
    for (const time of [0.01, 0.9, 1, 1.9, 1.99]) near(h.focus(bundle, time).x, 80);
});

test('ongoing notes on other strings remain in the current playable envelope', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 4 }), note(2, 12, { s: 1, sus: 1 })]);
    const out = h.focus(bundle, 2.4);
    near(out.minX, 30); near(out.maxX, 120); near(out.x, 75);
    near(h.focus(bundle, 3.4).x, 30);
});

test('a new onset supersedes an overlapping same-string sustain without changing written timing', () => {
    const h = harness(), held = Object.freeze(note(0, 3, { sus: 4 }));
    const bundle = chart([held, note(2, 16)]);
    near(h.focus(bundle, 2.1).x, 160);
    assert.equal(h.focus(bundle, 2.4).valid, false, 'the superseded sustain must not resume after the new note ends');
    assert.equal(held.sus, 4);
    assert.equal(h.cache().groups[0].members[0].end, 4, 'authored slide/trail timing is retained');
    assert.equal(h.cache().groups[0].members[0].focusEnd, 2);
});

test('same-string replacement preserves simultaneous holds on other strings', () => {
    const h = harness(), bundle = chart([
        note(0, 3, { sus: 4 }), note(0, 7, { s: 1, sus: 4 }), note(2, 16, { sus: 1 }),
    ]);
    const out = h.focus(bundle, 2.7);
    near(out.minX, 70); near(out.maxX, 160); near(out.x, 115);
    near(h.focus(bundle, 3.2).x, 70);
});

test('standalone notes and chord members share same-string replacement rules', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 4 })]);
    bundle.chords = [{ t: 2, notes: [note(undefined, 16, { sus: 1 }), note(undefined, 18, { s: 1, sus: 1 })] }];
    near(h.focus(bundle, 2.5).x, 170);
    bundle.notes = [note(2, 16, { sus: 1 })];
    bundle.chords = [{ t: 0, notes: [note(undefined, 3, { sus: 4 }), note(undefined, 5, { s: 1, sus: 4 })] }];
    const out = h.focus(bundle, 2.5);
    near(out.minX, 50); near(out.maxX, 160);
});

test('overlapping linked slide continuations transfer focus to the current segment', () => {
    const h = harness(), bundle = chart([
        note(0, 3, { sus: 3, sl: 16, ln: true }), note(2, 16, { sus: 2 }),
    ]);
    near(h.focus(bundle, 1.5).x, 30 + 130 * Math.pow(Math.sin(Math.PI / 4), 3));
    near(h.focus(bundle, 2.01).x, 160);
    near(h.focus(bundle, 3).x, 160);
});

test('coincident representations do not supersede each other as separate attacks', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 4 })]);
    bundle.chords = [{ t: 0.0004, notes: [note(undefined, 3, { sus: 1 })] }];
    near(h.focus(bundle, 2).x, 30);
});

test('invalid strings/frets and synthetic arpeggio preview chords cannot claim primary focus', () => {
    const h = harness(), bundle = chart([note(0, 3), note(0, 24, { s: 6 }), note(0, 127)]);
    bundle.chords = [{ t: 0, h3dSynth: true, notes: [note(undefined, 22)] }];
    near(h.focus(bundle, 0.01).x, 30);
    h.settings({ strings: 7 });
    assert.equal(h.focus(bundle, 0.01).maxX, 240, 'string count changes rebuild the cache');
});

test('an unpitched muted string uses the open-position context instead of fret 127', () => {
    const h = harness(), bundle = chart([note(0, 127, { mt: true })]);
    bundle.anchors = [{ time: 0, fret: 3, width: 4 }];
    near(h.focus(bundle, 0.01).x, 40);
});

test('seeking returns the same focus as continuous queries without retained distant state', () => {
    const h = harness(), fresh = harness(), bundle = chart([
        note(0, 16), note(0.5, 3), note(0.7, 5), note(1.2, 3), note(3.7, 22),
    ]);
    for (let t = 0; t < 1.3; t += 0.025) h.focus(bundle, t);
    const played = h.focus(bundle, 1.3), sought = fresh.focus(bundle, 1.3);
    for (const field of ['valid', 'x', 'minX', 'maxX']) assert.equal(played[field], sought[field], field);
    h.focus(bundle, 3.7);
    near(h.focus(bundle, 0.7).x, fresh.focus(bundle, 0.7).x);
});

test('cached queries visit nearby events rather than scanning the complete chart', () => {
    const h = harness();
    let reads = 0;
    const notes = Array.from({ length: 50000 }, (_, i) => ({ t: i * 0.1, s: i % 6,
        get f() { reads++; return 5 + i % 2; } }));
    const bundle = chart(notes);
    h.focus(bundle, 1000); reads = 0;
    for (let i = 0; i < 60; i++) h.focus(bundle, 1000 + i / 60);
    assert.ok(reads < 5000, `${reads} note-fret reads should scale with the local passage`);
});

test('appended data and replaced arrangements invalidate the event index', () => {
    const h = harness(), bundle = chart([note(0, 3)]);
    near(h.focus(bundle, 0).x, 30);
    bundle.notes.push(note(1, 16));
    near(h.focus(bundle, 1).x, 160);
    bundle.notes = [note(0, 8), note(1, 11)];
    near(h.focus(bundle, 1).x, 110);
});

test('renderer teardown releases indexed chart references and supports reinitialization', () => {
    const h = harness(), bundle = chart([note(0, 3, { sus: 3 })]);
    h.focus(bundle, 1);
    assert.equal(h.cache().notes, bundle.notes);
    h.reset();
    assert.equal(h.cache().notes, null); assert.equal(h.cache().chords, null);
    assert.deepEqual(h.cache().groups, []); assert.equal(h.cache().ends, null);
    near(h.focus(bundle, 1).x, 30);
});
