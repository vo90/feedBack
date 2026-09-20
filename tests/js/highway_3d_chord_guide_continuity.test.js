// Exercise the production cache: hold timing is independent of position guides,
// tempo, frame visibility and playback direction.
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
const constants = ['CHORD_ANCHOR_TIME_EPS', 'NEXT_ON_STRING_T_EPS', 'BEND_LINK_TIME_EPS']
    .map(name => src.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n') + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);';
const functions = ['isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'laneBoundsFromAnchor', 'anchorPlayedFretInclusiveSpan', 'playedFretSpanCoversShape',
    'chordFallbackLaneBounds', 'hwyLinkNextTargetNotes', 'slideInMarks', 'hwyBuildChordHoldGuidance',
    'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides', '_ensureChordGuideEnds', 'firstVisibleChordGuide'];
function makeHelpers() {
    return new Function(`
        const NFRETS = 24;
        let nStr = 6, _chordGuideCache = null;
        ${constants}
        ${functions.map(fn).join('\n')}
        return { ensure: _ensureChordGuideEnds, firstVisible: firstVisibleChordGuide,
            model() { return _chordGuideCache.model; }, setStringCount(v) { nStr = v; } };
    `)();
}
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
function chord(t, id, frets = [5, 7], sus = 0) {
    return { t, id, notes: frets.map((f, s) => ({ s, f, sus })) };
}
function fixture(nextTime = 10.7) {
    const chords = [chord(10, 0), chord(nextTime, 1, [8, 10])];
    return { chords, notes: [],
        chordTemplates: [{ frets: [5, 7, -1, -1, -1, -1] }, { frets: [8, 10, -1, -1, -1, -1] }],
        handShapes: chords.map((ch, i) => ({ chord_id: ch.id, start_time: ch.t, end_time: i ? ch.t + 0.2 : 10.5 })),
        beats: [{ time: 10 }, { time: 10.5 }], sections: [{ time: 9, name: 'riff' }],
        anchors: [{ time: 9, fret: 5, width: 4 }, { time: nextTime, fret: 8, width: 4 }] };
}
function firstEnd(b, h = makeHelpers()) { return h.ensure(b.chords, b).get(b.chords[0]); }

test('authored gaps remain empty independently of tempo or section labels', () => {
    for (const nextTime of [10.6, 10.7, 10.75, 12]) {
        const b = fixture(nextTime), h = makeHelpers(), ends = h.ensure(b.chords, b);
        near(ends.get(b.chords[0]), 10.5);
        near(ends.get(b.chords[1]), nextTime + 0.2);
        b.beats = [{ time: 0 }, { time: 100 }];
        b.sections = [{ time: 10.55, name: 'verse' }];
        assert.equal(h.ensure(b.chords, b), ends, 'presentation metadata is not hold timing');
    }
});
test('cache reuses unchanged charts and invalidates every actual notation dependency', () => {
    for (const key of ['chords', 'notes', 'handShapes', 'chordTemplates', 'anchors']) {
        const b = fixture(), h = makeHelpers(), initial = h.ensure(b.chords, b), model = h.model();
        assert.equal(h.ensure(b.chords, b), initial, key);
        assert.equal(h.model(), model, key);
        b[key] = b[key].slice();
        assert.notEqual(h.ensure(b.chords, b), initial, key);
        assert.notEqual(h.model(), model, key);
    }
    const b = fixture(), h = makeHelpers(), initial = h.ensure(b.chords, b);
    h.setStringCount(7);
    assert.notEqual(h.ensure(b.chords, b), initial);
});
test('late shape or template data restores legacy cues without altering note timing', () => {
    for (const key of ['handShapes', 'chordTemplates']) {
        const b = fixture(), h = makeHelpers(), saved = b[key];
        b[key] = [];
        assert.equal(firstEnd(b, h), undefined, key);
        b[key] = saved;
        near(firstEnd(b, h), 10.5);
        assert.deepEqual(b.chords[0].notes.map(n => n.sus), [0, 0]);
    }
});
test('late standalone attacks invalidate the old legacy endpoint', () => {
    const b = fixture(), h = makeHelpers();
    b.notes = null;
    near(firstEnd(b, h), 10.5);
    const prior = h.model();
    b.notes = [{ t: 10.2, s: 3, f: 12 }];
    near(firstEnd(b, h), 10.2);
    assert.notEqual(h.model(), prior);
    b.notes = [{ t: 10, s: 0, f: 5 }, { t: 10, s: 1, f: 7 }];
    near(firstEnd(b, h), 10.5);
});
test('a musical hold survives position changes without duplicating anchor-backed guides', () => {
    const b = fixture(), h = makeHelpers();
    b.chords = [chord(10, 0, [0, 0], 2)];
    b.chordTemplates = [{ frets: [0, 0, -1, -1, -1, -1] }];
    b.handShapes = [{ chord_id: 0, start_time: 10, end_time: 13 }];
    b.anchors = [{ time: 0, fret: 2, width: 4 }, { time: 10.5, fret: 8, width: 4 }];
    near(firstEnd(b, h), 12);
    assert.deepEqual(h.model().holds.map(x => [x.start, x.end, x.dMin, x.dMax]), [[10, 12, 1, 5]]);
    assert.equal(h.model().guides.length, 0, 'regular lane already covers both positional slices');
});
test('repeat geometry coalesces while culling retains per-attack endpoints', () => {
    const b = fixture(), h = makeHelpers();
    b.chords = [chord(10, 0), chord(10.2, 0), chord(10.4, 0)];
    b.handShapes = [{ chord_id: 0, start_time: 10, end_time: 10.7 }];
    const ends = h.ensure(b.chords, b);
    assert.deepEqual(b.chords.map(ch => ends.get(ch)), [10.2, 10.4, 10.7]);
    assert.deepEqual(h.model().holds.map(x => [x.start, x.end]), [[10, 10.7]]);
});
test('prefix maxima retain overlapping long holds during backward and forward seeks', () => {
    const b = fixture(), h = makeHelpers();
    b.chords = [chord(10, 0, [5, 7], 20), chord(15, 1, [12, 14], 1), chord(31, 1, [12, 14], 1)];
    b.handShapes = [];
    h.ensure(b.chords, b);
    const prefix = h.model().holdsPrefixEnds;
    assert.deepEqual(Array.from(prefix), [30, 30, 32]);
    for (const now of [9, 20, 29, 16, 10]) assert.equal(h.firstVisible(prefix, now), 0);
    assert.equal(h.firstVisible(prefix, 30), 2);
    assert.equal(h.firstVisible(prefix, 32), 3);
    assert.equal(h.firstVisible(new Float64Array(), 0), 0);
});
test('orphan picked shapes still cache guides without holds or chord cull extensions', () => {
    const b = fixture(), h = makeHelpers();
    b.chords = []; b.anchors = [];
    b.notes = [{ t: 10.1, s: 0, f: 5 }, { t: 10.3, s: 1, f: 7 }];
    assert.equal(h.ensure(b.chords, b) instanceof WeakMap, true);
    assert.equal(h.model().holds.length, 0);
    assert.equal(h.model().guides.length, 2);
    assert.equal(h.model().guidesPrefixEnds.length, 2);
});
