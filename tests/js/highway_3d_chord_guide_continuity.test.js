// Exercise chart-static guide derivation and the production render fragments.
// All notation decisions below come from screen.js; no WebGL scene is needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unbalanced function: ' + name);
}
const constantNames = [
    'CHORD_ANCHOR_TIME_EPS', 'ARP_INFER_MIN_HAND_SHAPE_SPAN_S',
    'ARP_INFER_MULTI_STRUM_WIN_MIN_S', 'ARP_INFER_MULTI_STRUM_HIT_SLACK',
    'ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S', 'ARP_INFER_MIN_HITS_VS_SHAPE_CAP',
];
const constants = constantNames.map(name => {
    const match = src.match(new RegExp('const ' + name + ' = [^;]+;'));
    assert.ok(match, name);
    return match[0];
}).join('\n');
const functionNames = [
    'lowerBoundT', 'isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'usesUnfrettedPosition',
    'validString', 'filterValidNotes', 'mergeChordShape', 'truthyChartFlag',
    'chordTemplateMarkedArpeggio', 'handShapeMarkedArpeggio', 'chordHandShapeArpeggioHint',
    'hsStart', 'hsEnd', 'hsChordIdNorm', 'handShapeChartSpanSec',
    'hitTimesQualifyArpeggioSpread', 'nextStrictlyLaterChordTime',
    'inferArpeggioFromNotePattern', '_inferArpeggioFromNotePatternUncached',
    'getChartAnchorAt', 'chordRailEndAt', 'chordGuideTimedRowAt', 'chordGuideHalfBeat',
    'laneBoundsFromAnchor', 'chordGuideEndAt',
    'chordGuideHasSectionBreak', 'chordGuideHasInterveningNote', '_ensureChordGuideEnds',
];
function makeHelpers() {
    return new Function(`
        const NFRETS = 24, S_COL = [];
        let nStr = 6, _oobStringWarned = true, _chordGuideCache = null;
        let _filterValidNotesCache = new WeakMap(), _chordShapeCache = new WeakMap();
        let _hintCache = new WeakMap(), _hintCacheHsRef = null, _hintCacheTplRef = null;
        let _arpInferCache = new WeakMap(), _arpInferCacheNotesRef = null, _arpInferCacheHssRef = null;
        ${src.match(/const _HINT_NONE = Object.freeze\([\s\S]*?\);/)[0]}
        ${constants}
        ${functionNames.map(fn).join('\n')}
        return {
            ensure: _ensureChordGuideEnds, halfBeat: chordGuideHalfBeat,
            intervening: chordGuideHasInterveningNote,
            sectionBreak: chordGuideHasSectionBreak,
            setStringCount(value) { nStr = value; }
        };
    `)();
}
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
function chord(t, id, frets = [5, 7], sus = 0) {
    return { t, id, notes: frets.map((f, s) => ({ s, f, sus })) };
}
function handShape(ch, end) {
    return { chord_id: ch.id, start_time: ch.t, end_time: end };
}
function fixture(nextTime = 10.7) {
    const chords = [chord(10, 0), chord(nextTime, 1, [8, 10])];
    return {
        chords, notes: [], chordTemplates: [],
        handShapes: [handShape(chords[0], 10.5), handShape(chords[1], nextTime + 0.2)],
        beats: Array.from({ length: 12 }, (_, i) => ({ time: 9 + i * 0.5 })),
        sections: [{ time: 9, name: 'riff' }],
        anchors: [{ time: 9, fret: 5, width: 4 }, { time: nextTime, fret: 8, width: 4 }],
    };
}
function firstEnd(bundle, h = makeHelpers()) {
    return h.ensure(bundle.chords, bundle).get(bundle.chords[0]);
}

test('half-beat rule compares the uncovered gap and preserves final authored end', () => {
    const b = fixture();
    const h = makeHelpers();
    const ends = h.ensure(b.chords, b);
    near(ends.get(b.chords[0]), 10.7);
    near(ends.get(b.chords[1]), 10.9);
    // Chord onsets are 0.7s apart: only the uncovered 0.2s gap is compared.
    near(firstEnd(fixture(10.75)), 10.75);
    near(firstEnd(fixture(10.752)), 10.5);
    const longHold = fixture(12.2);
    longHold.handShapes[0].end_time = 12;
    near(firstEnd(longHold), 12.2);
});

test('local beat spacing handles tempo changes instead of a smoothed BPM', () => {
    const h = makeHelpers();
    const beats = [9, 10, 10.5, 10.75, 11].map(time => ({ time }));
    near(h.halfBeat(beats, 9.5), 0.5);
    near(h.halfBeat(beats, 10.25), 0.25);
    near(h.halfBeat(beats, 10.5), 0.125);
    const b = fixture();
    b.beats = beats;
    near(firstEnd(b), 10.5, '0.2s gap exceeds half the new 0.25s beat');
});

test('missing or malformed beat data does not invent continuity', () => {
    for (const beats of [undefined, [], [{ time: 10 }], [{ time: 10.5 }, { time: 10.5 }],
        [{ time: 10 }, { time: Infinity }]]) {
        const b = fixture();
        b.beats = beats;
        near(firstEnd(b), 10.5);
    }
});

test('unloaded note arrays disable bridging until actual note data arrives', () => {
    for (const notes of [null, undefined]) {
        const b = fixture(), h = makeHelpers();
        b.notes = notes;
        near(firstEnd(b, h), 10.5);
        b.notes = [];
        near(firstEnd(b, h), 10.7);
    }
});

test('standalone passages break continuity, including attacks before the handshape ends', () => {
    for (const t of [10.1, 10.6]) {
        const b = fixture();
        b.notes = [{ t, s: 2, f: 12 }];
        near(firstEnd(b), 10.5);
    }
});

test('only matching endpoint chord members are ignored as duplicate attacks', () => {
    const b = fixture();
    const h = makeHelpers();
    const [ch, next] = b.chords;
    b.notes = [{ t: ch.t, s: 0, f: 5 }, { t: next.t, s: 1, f: 10 }];
    assert.equal(h.intervening(b.notes, ch, next, 6), false);
    near(firstEnd(b), next.t);
    for (const n of [{ t: ch.t, s: 2, f: 5 }, { t: next.t, s: 1, f: 11 },
        { t: ch.t + 0.001, s: 0, f: 5 }]) {
        assert.equal(h.intervening([n], ch, next, 6), true);
    }
    assert.equal(h.intervening([{ t: 10.6, s: 7, f: 5 }], ch, next, 6), false);
    assert.equal(h.intervening([{ t: 10.6, s: 7, f: 5 }], ch, next, 8), true);
    assert.equal(h.intervening([{ t: 10.6, s: 2, f: 127 }], ch, next, 6), false);
    assert.equal(h.intervening([{ t: 10.6, s: 2, f: 127, mt: true }], ch, next, 6), true);
});

test('no-guitar, silence and rest sections stop bridging', () => {
    for (const name of ['Noguitar', 'No Guitar', 'no_guitar', 'silence', 'rest']) {
        const b = fixture();
        b.sections.push({ time: 10.55, name });
        near(firstEnd(b), 10.5);
    }
    const ordinary = fixture();
    ordinary.sections.push({ time: 10.55, name: 'verse' });
    near(firstEnd(ordinary), 10.7);
});

test('arpeggios and synthetic handshapes do not become continuation strums', () => {
    for (const kind of ['handshape', 'template', 'synth', 'single']) {
        const b = fixture();
        if (kind === 'handshape') b.handShapes[1].arp = true;
        if (kind === 'template') b.chordTemplates[1] = { arp: true };
        if (kind === 'synth') b.chords[1].h3dSynth = true;
        if (kind === 'single') b.chords[1].notes.pop();
        const ends = makeHelpers().ensure(b.chords, b);
        near(ends.get(b.chords[0]), 10.5);
        assert.equal(ends.has(b.chords[1]), false, kind);
    }
    const inferred = fixture();
    inferred.handShapes[1].end_time = 11.4;
    inferred.notes = [{ t: 10.8, s: 0, f: 8 }, { t: 11, s: 1, f: 10 }];
    const ends = makeHelpers().ensure(inferred.chords, inferred);
    near(ends.get(inferred.chords[0]), 10.5);
    assert.equal(ends.has(inferred.chords[1]), false, 'actual note-stream inference stays excluded');
});

test('coincident chord rows remain ambiguous instead of inventing another strum', () => {
    const b = fixture();
    b.chords.splice(1, 0, chord(10, 2));
    b.handShapes.push(handShape(b.chords[1], 10.5));
    const ends = makeHelpers().ensure(b.chords, b);
    assert.equal(ends.has(b.chords[0]), false);
    assert.equal(ends.has(b.chords[1]), false);
});

test('overlapping spans stop at the next onset and the last strum ends at its handshape', () => {
    const b = fixture();
    b.handShapes[0].end_time = 10.8;
    const ends = makeHelpers().ensure(b.chords, b);
    near(ends.get(b.chords[0]), 10.7);
    near(ends.get(b.chords[1]), 10.9);
    const final = fixture();
    final.chords.pop();
    final.handShapes.pop();
    near(firstEnd(final), 10.5);
});

test('earlier actual position changes remain hard bounds on a continuation', () => {
    const b = fixture();
    b.anchors.splice(1, 0, { time: 10.6, fret: 12, width: 4 });
    near(firstEnd(b), 10.6);
});

test('redundant anchors keep one guide, while a width change still clips it', () => {
    const b = fixture();
    b.anchors.splice(1, 0, { time: 10.55, fret: 5, width: 4 });
    const end = firstEnd(b);
    near(end, 10.7);
    near(project(b.anchors, b.chords[0], 10.4, 0, end, 0, 0).end, 10.7);
    b.anchors.splice(2, 0, { time: 10.6, fret: 5, width: 5 });
    near(firstEnd(b), 10.6);
});

test('cache reuses unchanged charts and invalidates every guide input', () => {
    for (const key of ['chords', 'notes', 'handShapes', 'chordTemplates', 'beats', 'sections', 'anchors']) {
        const b = fixture(), h = makeHelpers();
        const initial = h.ensure(b.chords, b);
        assert.equal(h.ensure(b.chords, b), initial, key);
        b[key] = b[key].slice();
        assert.notEqual(h.ensure(b.chords, b), initial, key);
    }
    const b = fixture(), h = makeHelpers();
    const initial = h.ensure(b.chords, b);
    h.setStringCount(7);
    assert.notEqual(h.ensure(b.chords, b), initial);
    const late = fixture();
    const realBeats = late.beats;
    late.beats = [];
    near(firstEnd(late, h), 10.5);
    late.beats = realBeats;
    near(firstEnd(late, h), 10.7);
    const realShapes = late.handShapes;
    late.handShapes = [];
    assert.equal(firstEnd(late, h), undefined);
    late.handShapes = realShapes;
    near(firstEnd(late, h), 10.7);
});

const anchorStart = src.indexOf('const chDtEarly = ch.t - now;');
const anchorEnd = src.indexOf('const chAncB =', anchorStart);
const rawStart = src.indexOf('const _rawSus = _chGuideEnd != null');
const railEnd = src.indexOf('if (_railLen > 0.001)', rawStart);
assert.ok(anchorStart >= 0 && anchorEnd > anchorStart && rawStart >= 0 && railEnd > rawStart);
const selectAnchor = new Function('anchors', 'ch', 'now', 'maxSus', '_chGuideEnd',
    constants + fn('getChartAnchorAt') + src.slice(anchorStart, anchorEnd) + 'return chAnc;');
const project = new Function('anchors', 'ch', 'now', 'maxSus', '_chGuideEnd', '_hsSus', '_synthSus',
    constants + fn('chordRailEndAt')
    + 'const chDt = ch.t - now, AHEAD = 5, dZ = t => -t * 1.725;'
    + src.slice(rawStart, railEnd)
    + 'return {end: now + _dtSusEndRail, visible: _railLen > 0.001};'
    + '} return {visible: false};');

test('guide ending replaces the rail minimum and note sustain only for guide geometry', () => {
    const ch = chord(10, 0, [5, 7], 2);
    near(project([], ch, 9.9, 2, 10.15, 0, 0).end, 10.15);
    near(project([], ch, 9.9, 2, undefined, 0, 0).end, 12);
    near(project([], ch, 9.9, 0.1, undefined, 0, 0).end, 10.4);
    near(project([], ch, 9.9, 0.1, 10.15, 0, 0).end, 10.15);
    assert.deepEqual(ch.notes.map(n => n.sus), [2, 2]);
    assert.equal(project([], ch, 10.16, 2, 10.15, 0, 0).visible, false);
    assert.equal(project([], ch, 10.05, 2, 10.15, 0, 0).visible, true, 'rewind is deterministic');
});

test('after short sustains expire, guides keep the old anchor until their endpoint', () => {
    const anchors = [{ time: 10, fret: 5 }, { time: 10.7, fret: 8 }];
    const ch = chord(10, 0);
    for (const now of [10.05, 10.3, 10.69, 10.3]) {
        assert.equal(selectAnchor(anchors, ch, now, 0.1, 10.7), anchors[0]);
        assert.equal(project(anchors, ch, now, 0.1, 10.7, 0, 0).visible, true);
    }
    assert.equal(project(anchors, ch, 10.7, 0.1, 10.7, 0, 0).visible, false);
    assert.equal(selectAnchor(anchors, ch, 10.7, 0.1, 10.7), anchors[1]);
});
