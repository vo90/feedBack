'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unbalanced helper ' + name);
}
const helpers = [
    'hwyCoincidentSustainKey', 'hwyPlainSustainMetadata', 'hwyBuildCoincidentSustainOwnership', 'createCoincidentSustainView',
    'isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'laneBoundsFromAnchor', 'anchorPlayedFretInclusiveSpan', 'playedFretSpanCoversShape',
    'chordFallbackLaneBounds', 'chordShapeLaneBounds', 'hwyLinkNextTargetNotes', 'slideInMarks',
    'hwyTrailBoundaryOverlapIsNegligible', 'hwyBuildChordHoldGuidance', 'chordMemberTrailSuppressed',
    'hwyBuildIndependentTrailOrigins', '_buildChordCullIndex', '_findChordCullCandidate', '_nextChordCullCandidate',
];
const constants = ['CHORD_ANCHOR_TIME_EPS', 'NEXT_ON_STRING_T_EPS', 'BEND_LINK_TIME_EPS', 'TRAIL_BOUNDARY_OVERLAP_TOLERANCE_S']
    .map(name => source.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n');
const api = new Function('const NFRETS = 24;\n' + constants
    + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);\n'
    + helpers.map(extract).join('\n') + '\nreturn {build:hwyBuildCoincidentSustainOwnership,view:createCoincidentSustainView,'
    + 'holds:hwyBuildChordHoldGuidance,origins:hwyBuildIndependentTrailOrigins,cull:_buildChordCullIndex,next:_nextChordCullCandidate};')();
function fixture(blueSustain) {
    const yellow = { t: 30.393, s: 1, f: 5, sus: .442 };
    const chord = { t: 30.393, id: 15, hd: true, notes: [{ s: 1, f: 5 }, { s: 2, f: 7,
        ...(blueSustain === undefined ? {} : { sus: blueSustain }) }] };
    return { notes: [yellow], chords: [chord], anchors: [],
        handShapes: [{ start_time: 29.726, end_time: 31.504999, chord_id: 15 }],
        chordTemplates: { 15: { frets: [-1, 5, 7, -1, -1, -1] } } };
}
function holds(bundle) {
    return api.holds(bundle.chords, bundle.handShapes, bundle.chordTemplates, bundle.anchors, 6, bundle.notes);
}
function freeze(value) {
    if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
    return value;
}
const defaults = { sl: -1, slu: -1, bn: 0, ho: false, po: false, hm: false, hp: false,
    pm: false, mt: false, vb: false, tr: false, ac: false, tp: false };

test('original 30.393 overlap keeps only the yellow hold and cannot invent a shared legacy release', () => {
    const raw = fixture();
    raw.chords.push({ ...raw.chords[0], t: 30.838 });
    assert.equal(holds(raw).byChord.get(raw.chords[0]).end, 30.838, 'old sparse inference');
    const before = JSON.stringify(raw); freeze(raw);
    const view = api.view()(raw, 6), model = holds(view), chord = view.chords[0];
    assert.equal(view.notes.length, 0, 'one attack owner');
    assert.equal(chord.notes[0].sus, .442);
    assert.equal(Object.hasOwn(chord.notes[1], 'sus'), false);
    assert.equal(model.byChord.has(chord), false, 'yellow-only duration does not ring blue');
    const origins = api.origins(view.notes, view.chords, model.byChord, 6);
    assert.equal(origins.drawable.has(chord.notes[0]), true);
    assert.equal(origins.drawable.has(chord.notes[1]), false);
    assert.equal(JSON.stringify(raw), before, 'source and scoring inputs remain untouched');
    const repaired = { ...raw, notes: [], chords: [{ ...raw.chords[0], notes: [{ s: 1, f: 5, sus: .442 }, raw.chords[0].notes[1]] }, raw.chords[1]] };
    assert.deepEqual(view.chords, repaired.chords);
    assert.deepEqual(holds(view).holds.map(h => [h.start, h.end]), holds(repaired).holds.map(h => [h.start, h.end]));
});

test('equal ordinary members use the exact shared lanes with no duplicate standalone trail', () => {
    for (const normalized of [false, true]) {
        const raw = fixture(.442);
        raw.notes.push({ t: 30.393, s: 2, f: 7, sus: .442 });
        if (normalized) {
            raw.notes = raw.notes.map(n => ({ ...defaults, ...n }));
            raw.chords[0].notes = raw.chords[0].notes.map(n => ({ ...defaults, ...n }));
        }
        const view = api.view()(freeze(raw), 6), chord = view.chords[0], model = holds(view);
        const hold = model.byChord.get(chord);
        assert.equal(view.notes.length, 0);
        assert.equal(hold.end, 30.835);
        assert.equal(hold.suppressMemberTrails, true);
        const origins = api.origins(view.notes, view.chords, model.byChord, 6);
        assert.equal(chord.notes.some(n => origins.drawable.has(n)), false);
    }
});

test('explicit zero, unequal positive durations and nearby onsets are never reconciled', () => {
    for (const sustain of [0, .441, .445, NaN, null, -1, '0.442']) {
        const raw = fixture(); raw.chords[0].notes[0].sus = sustain;
        const result = api.build(raw.notes, raw.chords);
        assert.equal(result.notes, raw.notes); assert.equal(result.chords, raw.chords);
    }
    for (const offset of [-.000001, .000001, .001, .003]) {
        const raw = fixture(); raw.notes[0].t += offset;
        assert.equal(api.build(raw.notes, raw.chords).notes, raw.notes);
    }
});

test('ambiguous onsets, same-string attacks, unknown metadata and techniques stay untouched', () => {
    const changes = [
        x => x.notes.push({ ...x.notes[0] }),
        x => x.notes.push({ ...x.notes[0], f: 6 }),
        x => x.chords.push({ ...x.chords[0] }),
        x => x.chords[0].notes.push({ s: 1, f: 5 }),
        x => x.chords[0].notes[0].t = 30.394,
        x => x.chords[0].notes[0].t = 30.393,
        x => x.chords[0].notes[0].fg = 1,
        x => x.chords[0].unknownTechnique = true,
        x => x.chords[0].hd = 1,
    ];
    for (const data of [{ sl: 7 }, { ho: true }, { mt: true }, { bn: 1 }, { ln: true },
        { pm: true }, { vb: true }, { bnv: [{ t: 0, v: 1 }] }, { slide_in_marks: [] },
        { future: null }, { let_ring_sus: 1 }, { ch: 2 }]) {
        changes.push(x => Object.assign(x.notes[0], data));
        changes.push(x => Object.assign(x.chords[0].notes[0], data));
    }
    for (const change of changes) {
        const raw = fixture(); change(raw);
        const before = JSON.stringify(raw), result = api.build(raw.notes, raw.chords);
        assert.equal(result.notes, raw.notes, String(change)); assert.equal(result.chords, raw.chords);
        assert.equal(JSON.stringify(raw), before);
    }
});

test('runtime defaults and matching teaching metadata preserve the original source for verdict lookup', () => {
    const raw = fixture();
    raw.notes[0] = { ...defaults, fg: 1, sd: 1, ...raw.notes[0] };
    raw.chords[0].notes[0] = { ...defaults, fg: 1, sd: 1, ...raw.chords[0].notes[0] };
    const calls = [];
    raw.getNoteState = (note, time) => { calls.push([note, time]); return 'active'; };
    const view = api.view()(freeze(raw), 6), member = view.chords[0].notes[0];
    assert.equal(view.getNoteState({ ...member, t: 30.393 }, 30.393), 'active');
    assert.equal(calls[0][0], raw.notes[0]); assert.equal(calls[0][1], 30.393);
    view.getNoteState(view.chords[0].notes[1], 30.393);
    assert.equal(calls[1][0], raw.chords[0].notes[1]);
});

test('ownership arrays are cached across frames and seeks, refreshed on chart/string/provider changes, and released', () => {
    const raw = fixture(), view = api.view(), first = view(raw, 6);
    for (const currentTime of [30, 30.5, 31, 29]) {
        const next = view({ ...raw, currentTime }, 6);
        assert.equal(next.notes, first.notes); assert.equal(next.chords, first.chords);
        assert.equal(next.currentTime, currentTime);
    }
    assert.notEqual(view({ ...raw, notes: [...raw.notes] }, 6).chords, first.chords);
    assert.equal(view(raw, 1), raw, 'invalid string count does not steal a note');
    let called = false;
    assert.equal(view({ ...raw, getNoteState: () => { called = true; return 'hit'; } }, 6)
        .getNoteState(first.chords[0].notes[0], 30.393), 'hit');
    assert.equal(called, true);
    const cached = view(raw, 6); view.clear();
    assert.notEqual(view(raw, 6).chords, cached.chords);
});

test('transferred long tails participate in the real chord culling index', () => {
    const raw = fixture(); raw.notes[0].sus = 20;
    const view = api.view()(raw, 6), index = api.cull(view.chords, 3, 6);
    assert.equal(index.maxSustains[0], 20);
    assert.equal(api.next(index, 0, 1, 45), 0);
    assert.equal(api.next(index, 0, 1, 51), 1);
});

test('the presentation view precedes both drawing and camera derivation', () => {
    const draw = source.slice(source.indexOf('            draw(bundle) {'));
    assert.ok(draw.indexOf('bundle = coincidentSustainView(bundle, resolveStringCount(bundle));') < draw.indexOf('update(bundle);'));
    assert.ok(draw.indexOf('bundle = coincidentSustainView(bundle, resolveStringCount(bundle));') < draw.indexOf('camUpdate(bundle);'));
    assert.match(extract('teardown'), /coincidentSustainView\.clear\(\)/);
});
