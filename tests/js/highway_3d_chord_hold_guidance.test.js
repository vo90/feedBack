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
    throw new Error('Unbalanced helper: ' + name);
}
const helpers = [
    'isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'laneBoundsFromAnchor', 'anchorPlayedFretInclusiveSpan', 'playedFretSpanCoversShape',
    'chordFallbackLaneBounds', 'hwyLinkNextTargetNotes', 'slideInMarks', 'hwyBuildChordHoldGuidance',
    'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides',
];
const constants = ['CHORD_ANCHOR_TIME_EPS', 'NEXT_ON_STRING_T_EPS', 'BEND_LINK_TIME_EPS']
    .map(name => source.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n') + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);';
const build = new Function('const NFRETS = 24;\n' + constants + '\n'
    + helpers.map(extract).join('\n') + '\nreturn hwyBuildChordHoldGuidance;')();
const uncoveredGuides = new Function('const NFRETS = 24;\n' + constants + '\n'
    + helpers.map(extract).join('\n') + '\nreturn hwyUncoveredHandPositionGuides;')();

function chord(t = 10, frets = [3, 5], sus, id = 0) {
    return { t, id, notes: frets.map((f, s) => ({ s, f, ...(sus === undefined ? {} : { sus }) })) };
}
function template(ch) {
    const frets = Array(6).fill(-1);
    for (const n of ch.notes) frets[n.s] = n.f;
    return { frets };
}
function hs(start = 10, end = 13, id = 0) {
    return { start_time: start, end_time: end, chord_id: id };
}
function resolve(chords, shapes = [], templates = [], anchors = [], notes = [], count = 6) {
    return build(chords, shapes, templates, anchors, count, notes);
}
function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
}
function freezeDeep(value) {
    if (value && typeof value === 'object') {
        Object.freeze(value);
        for (const child of Object.values(value)) freezeDeep(child);
    }
    return value;
}

test('exact shared durations need no hand shape and have no minimum hold', () => {
    for (const duration of [0.05, 0.2, 0.738, 2]) {
        const ch = chord(10, [3, 5], duration);
        const result = resolve([ch]);
        assert.equal(result.holds.length, 1);
        const hold = result.byChord.get(ch);
        assert.equal(hold.source, 'explicit');
        assert.equal(hold.suppressMemberTrails, true);
        near(hold.start, 10);
        near(hold.end, 10 + duration);
    }
});

test('explicit chord timing and longer hand-shape guidance remain separate', () => {
    const ch = chord(10, [3, 5], 1);
    const result = resolve([ch], [hs()], [template(ch)]);
    near(result.byChord.get(ch).end, 11);
    assert.equal(result.guides.length, 1);
    near(result.guides[0].end, 13);
});

test('legacy hand shapes work with omitted or normalized-zero member timing', () => {
    for (const sus of [undefined, 0]) {
        const ch = chord(30.221001, [0, 2, 3, 0], sus);
        ch.notes.forEach(n => { n.s += 2; });
        const result = resolve([ch], [hs(ch.t, 33.174999)], [template(ch)]);
        assert.equal(result.byChord.get(ch).source, 'handshape');
        near(result.byChord.get(ch).end, 33.174999);
    }
});

test('equivalent template IDs match actual voicing, not chord names', () => {
    const ch = chord(148.119995, [2, 4, 4], undefined, 3);
    ch.notes.forEach(n => { n.s++; });
    const templates = { 3: { ...template(ch), name: 'B5' }, 4: { ...template(ch), name: 'Different label' } };
    const result = resolve([ch], [hs(ch.t - 0.1, 150.102997, 4)], templates);
    near(result.byChord.get(ch).end, 150.102997);
    templates[4].frets[3] = 5;
    templates[4].name = 'B5';
    assert.equal(resolve([ch], [hs(ch.t, 150.102997, 4)], templates).holds.length, 0);
});

test('partial chord attacks cannot inherit the full hand-shape hold', () => {
    const ch = chord(145.906998, [5, 5], undefined, 17);
    ch.notes.forEach(n => { n.s += 4; });
    const templates = { 17: template(ch), 19: { frets: [-1, 0, 2, 2, 5, 5] } };
    const result = resolve([ch], [hs(145.225006, 146.759003, 19)], templates);
    assert.equal(result.holds.length, 0);
    assert.equal(result.guides.length, 1, 'the larger shape remains positional guidance');
});

test('missing metadata never creates a hold until the next note', () => {
    const ch = chord(172.996002, [12, 14]);
    ch.notes.forEach(n => { n.s += 4; });
    const next = chord(185, [3, 5]);
    assert.equal(resolve([ch, next]).holds.length, 0);
});

test('partial, unequal and invalid sustains retain individual notation', () => {
    for (const durations of [[1, undefined], [1, 0], [1, 2], [0, NaN], [0, -1]]) {
        const ch = chord();
        ch.notes.forEach((n, i) => { n.sus = durations[i]; });
        assert.equal(resolve([ch], [hs()], [template(ch)]).holds.length, 0, String(durations));
    }
});

test('open members share known duration and persist across position changes', () => {
    const ch = chord(10, [0, 0], 2);
    const anchors = [{ time: 9, fret: 2, width: 4 }, { time: 10.5, fret: 12, width: 4 }];
    const result = resolve([ch], [hs()], [template(ch)], anchors);
    const hold = result.byChord.get(ch);
    near(hold.end, 12);
    assert.deepEqual([hold.dMin, hold.dMax], [1, 5]);
    assert.deepEqual(result.guides.map(g => [g.start, g.end, g.dMin, g.dMax]),
        [[10, 10.5, 1, 5], [10.5, 13, 11, 15]]);
});

test('bounds agree with chord fret cells, including out-of-anchor chords', () => {
    const ch = chord(10, [3, 5], 1);
    const narrow = resolve([ch], [], [], [{ time: 0, fret: 4, width: 4 }]).holds[0];
    assert.deepEqual([narrow.dMin, narrow.dMax], [2, 6]);
    const covering = resolve([ch], [], [], [{ time: 0, fret: 2, width: 4 }]).holds[0];
    assert.deepEqual([covering.dMin, covering.dMax], [1, 5]);
});

test('muted and moving technique chords do not lose per-string instruction', () => {
    const cues = [{ pm: true }, { mt: true }, { fhm: true }, { ln: true }, { bn: 1 },
        { bnv: [{ t: 0.2, v: 1 }] }, { vb: true }, { tr: true }, { sl: 7 }, { slu: 7 },
        { slide_out: 'down' }, { slide_out_marks: [{ start: 0.5, end: 1, direction: 'up' }] }];
    for (const cue of cues) for (const sustain of [undefined, 1]) {
        const ch = chord(10, [3, 5], sustain);
        Object.assign(ch.notes[0], cue);
        const result = resolve([ch], [hs()], [template(ch)]);
        assert.equal(result.holds.length, 0, JSON.stringify(cue));
        assert.equal(result.guides.length, 1);
    }
    const ch = chord(120.472, [5, 5, 5, 5]);
    ch.notes.forEach(n => { n.fhm = true; });
    assert.equal(resolve([ch]).holds.length, 0);
});

test('incoming linked targets cannot collapse into a shared chord hold', () => {
    const ch = chord(11, [5, 7], 1);
    const source = { t: 10, s: 0, f: 3, sl: 5, sus: 1, ln: true };
    assert.equal(resolve([ch], [], [], [], [source]).holds.length, 0);
    const preceding = chord(10, [5, 7], 1);
    preceding.notes[0].ln = true;
    assert.equal(resolve([preceding, ch]).holds.length, 0);
    source.sus = 0.2;
    assert.equal(resolve([ch], [], [], [], [source]).holds.length, 1, 'expired link is not a continuation');
});

test('synthetic previews and explicit arpeggios remain guidance only', () => {
    for (const kind of ['synth', 'shape', 'template', 'displayName', 'chord']) {
        const ch = chord(10, [3, 5], 1), shape = hs(), tpl = template(ch);
        if (kind === 'synth') ch.h3dSynth = true;
        if (kind === 'shape') shape.arp = true;
        if (kind === 'template') tpl.arpeggio = '1';
        if (kind === 'displayName') tpl.displayName = 'C-arp';
        if (kind === 'chord') ch.arp = true;
        const result = resolve([ch], [shape], [tpl]);
        assert.equal(result.holds.length, 0, kind);
        assert.equal(result.guides.length, 1, kind);
    }
});

test('picked shapes never fabricate a simultaneous full-chord hold', () => {
    const ch = chord(), tpl = template(ch);
    const notes = [{ t: 10.5, s: 0, f: 3 }, { t: 11, s: 1, f: 5 }];
    const result = resolve([ch], [hs()], [tpl], [], notes);
    assert.equal(result.holds.length, 0);
    assert.equal(result.guides.length, 1);
    const orphan = resolve([], [hs()], [tpl], [], notes);
    assert.equal(orphan.holds.length, 0);
    assert.equal(orphan.guides.length, 1);
});

test('legacy holds stop at partial, incompatible or standalone attacks', () => {
    const ch = chord(), tpl = template(ch);
    for (const later of [chord(11, [3]), chord(11, [8, 10]), chord(11, [3, 5], 0.2)]) {
        const result = resolve([ch, later], [hs()], [tpl]);
        near(result.byChord.get(ch).end, 11);
    }
    const result = resolve([ch], [hs()], [tpl], [], [{ t: 10.8, s: 3, f: 7 }]);
    near(result.byChord.get(ch).end, 10.8);
    assert.equal(resolve([ch], [hs()], [tpl], [], [{ t: 10, s: 3, f: 7 }]).holds.length, 0);
});

test('repeated attacks remain addressable without duplicate overlapping rails', () => {
    const a = chord(10), b = chord(11), c = chord(12);
    const result = resolve([a, b, c], [hs()], [template(a)]);
    assert.deepEqual([a, b, c].map(ch => [result.byChord.get(ch).start, result.byChord.get(ch).end]),
        [[10, 11], [11, 12], [12, 13]]);
    assert.equal(result.holds.length, 1);
    near(result.holds[0].end, 13);
    const duplicates = [a, b, c].flatMap(ch => ch.notes.map(n => ({ ...n, t: ch.t })));
    const withDuplicates = resolve([a, b, c], [hs()], [template(a)], [], duplicates);
    assert.equal(withDuplicates.byChord.size, 3);
    near(withDuplicates.holds[0].end, 13);
});

test('overlapping same-voicing holds can share edges when their release is identical', () => {
    const a = chord(10, [3, 5], 2), b = chord(11, [3, 5], 1);
    const result = resolve([b, a]);
    near(result.byChord.get(a).end, 12);
    near(result.byChord.get(b).end, 12);
    assert.deepEqual(result.holds.map(h => [h.start, h.end]), [[10, 12]]);
});

test('overlapping different chord voicings retain individual timing despite identical bounds', () => {
    for (const laterDuration of [1, 2]) {
        const a = chord(10, [3, 5], 2), b = chord(11, [4, 6], laterDuration);
        const anchors = [{ time: 0, fret: 3, width: 4 }];
        const before = JSON.stringify([a, b]);
        const result = resolve([a, b], [], [], anchors);
        assert.equal(result.holds.length, 0);
        assert.equal(result.byChord.has(a), false);
        assert.equal(result.byChord.has(b), false);
        assert.equal(JSON.stringify([a, b]), before, 'no clipping or duration mutation');
    }
});

test('shorter later repeats cannot inherit the release of an earlier longer chord', () => {
    for (const laterDuration of [0.5, 3]) {
        const a = chord(10, [3, 5], 3), b = chord(11, [3, 5], laterDuration);
        const result = resolve([a, b]);
        assert.equal(result.holds.length, 0);
        assert.equal(result.byChord.has(a), false);
        assert.equal(result.byChord.has(b), false);
        assert.deepEqual(a.notes.map(n => n.sus), [3, 3]);
        assert.deepEqual(b.notes.map(n => n.sus), [laterDuration, laterDuration]);
    }
});

test('touching explicit holds still share edges while keeping distinct attacks', () => {
    const a = chord(10, [3, 5], 1), b = chord(11, [4, 6], 2);
    const result = resolve([a, b], [], [], [{ time: 0, fret: 3, width: 4 }]);
    assert.deepEqual(result.holds.map(h => [h.start, h.end]), [[10, 13]]);
    assert.equal(result.byChord.size, 2);
    near(result.byChord.get(a).end, 11);
    near(result.byChord.get(b).end, 13);
});

test('an overlapping legacy repeat keeps its cue while conflicting explicit trails remain individual', () => {
    const a = chord(10, [3, 5], 3), b = chord(11, [3, 5]);
    const result = resolve([a, b], [hs(11, 12)], [template(b)]);
    assert.equal(result.byChord.has(a), false);
    assert.equal(result.byChord.get(b).source, 'handshape');
    assert.deepEqual(result.holds.map(h => [h.start, h.end]), [[11, 12]]);
});

test('authored gaps stay empty even when smaller than the onset tolerance', () => {
    const a = chord(10, [3, 5], 1), b = chord(11.0001, [3, 5], 1);
    const result = resolve([a, b]);
    assert.equal(result.holds.length, 2);
    const legacyA = chord(10), legacyB = chord(11.2);
    const legacy = resolve([legacyA, legacyB], [hs(10, 11), hs(11.2, 12)], [template(a)]);
    assert.deepEqual(legacy.holds.map(h => [h.start, h.end]), [[10, 11], [11.2, 12]]);
});

test('malformed shapes and coincident ambiguous attacks never create false holds', () => {
    const ch = chord();
    for (const shape of [hs(10, 10), hs(10, 9), hs(10, Infinity), hs(NaN, 12),
        { end_time: 13, chord_id: 0 }, hs(10, 13, 4)]) {
        assert.equal(resolve([ch], [shape], [template(ch)]).holds.length, 0);
    }
    const other = chord(10, [8, 10], 1);
    assert.equal(resolve([ch, other], [hs()], [template(ch)]).holds.length, 0);
});

test('chart timestamp rounding recognizes the correct onset without shortening its end', () => {
    const ch = chord(10);
    const result = resolve([ch], [hs(10.0004, 12)], [template(ch)],
        [{ time: 0, fret: 8 }, { time: 10.0004, fret: 2, width: 4 }]);
    const hold = result.byChord.get(ch);
    near(hold.end, 12);
    assert.deepEqual([hold.dMin, hold.dMax], [1, 5]);
});

test('resolution is deterministic for seeking and does not mutate chart input', () => {
    const a = chord(10, [0, 3, 5]), b = chord(11, [0, 3, 5]);
    const chords = freezeDeep([b, a]), shapes = freezeDeep([hs()]);
    const templates = freezeDeep([template(a)]);
    const anchors = freezeDeep([{ time: 12, fret: 3 }, { time: 0, fret: 2, width: 4 }]);
    const notes = freezeDeep([{ t: 10, s: 0, f: 0 }]);
    const first = resolve(chords, shapes, templates, anchors, notes);
    const second = resolve(chords, shapes, templates, anchors, notes);
    assert.deepEqual(first, second);
    assert.equal(chords[0], b);
    assert.equal(anchors[0].time, 12);
});

test('string-count changes include the actual voicing on seven-string charts', () => {
    const ch = chord(10, [3, 5], 1);
    ch.notes[1].s = 6;
    assert.equal(resolve([ch], [], [], [], [], 6).holds.length, 0);
    assert.equal(resolve([ch], [], [], [], [], 7).holds.length, 1);
});

test('overlapping hand shapes do not stack identical guide edges or lose real gaps', () => {
    const ch = chord();
    const result = resolve([], [hs(10, 12), hs(11, 13), hs(13, 14), hs(14.01, 15)], [template(ch)]);
    assert.deepEqual(result.guides.map(g => [g.start, g.end]), [[10, 14], [14.01, 15]]);
});

test('single-string and malformed member rows cannot create a shared chord hold', () => {
    const single = chord(10, [3], 1);
    assert.equal(resolve([single]).holds.length, 0);
    const malformed = chord(10, [3, 5], 1);
    malformed.notes.push(null, { s: 7, f: 100, sus: 1 });
    assert.equal(resolve([malformed]).holds.length, 0, 'dropping a member must not manufacture equal duration');
    const duplicate = chord(10, [3, 5], 1);
    duplicate.notes[1].s = 0;
    assert.equal(resolve([duplicate]).holds.length, 0);
});

test('many repeated shapes keep per-attack ownership and bounded guide geometry', () => {
    const chords = Array.from({ length: 2000 }, (_, i) => chord(10 + i * 0.25));
    const shapes = chords.map(ch => hs(ch.t, ch.t + 0.25));
    const result = resolve(chords, shapes, [template(chords[0])]);
    assert.equal(result.byChord.size, chords.length);
    assert.equal(result.holds.length, 1);
    assert.equal(result.guides.length, 1);
    near(result.holds[0].end, 510);
});

test('independent guides survive a later anchor moving away and back to identical shape bounds', () => {
    const ch = chord(10, [3, 5]);
    const anchors = [{ time: 0, fret: 3, width: 4 }, { time: 11, fret: 8, width: 4 },
        { time: 12, fret: 3, width: 4 }];
    const model = resolve([ch], [hs(10, 13)], [template(ch)], anchors);
    // Resolution can legitimately merge the same geometry across the whole
    // shape. Only the middle interval needs extra rails beside the anchor lane.
    assert.deepEqual(model.guides.map(g => [g.start, g.end, g.dMin, g.dMax]), [[10, 13, 2, 6]]);
    assert.deepEqual(uncoveredGuides(model.guides, anchors).map(g => [g.start, g.end, g.dMin, g.dMax]),
        [[11, 12, 2, 6]]);
    assert.deepEqual(uncoveredGuides(model.guides, []).map(g => [g.start, g.end]), [[10, 13]]);
});

test('valid incoming chord techniques keep their independent ribbons for both directions', () => {
    for (const direction of ['up', 'down']) for (const time of [0, 0.7]) {
        const ch = chord(10, [3, 5], 1);
        ch.notes[0].slide_in_marks = [{ direction, time }];
        const before = JSON.stringify(ch);
        const result = resolve([ch], [hs()], [template(ch)]);
        assert.equal(result.holds.length, 0, `${direction} at ${time}`);
        assert.equal(result.guides.length, 1);
        assert.equal(result.byChord.get(ch), undefined);
        assert.equal(JSON.stringify(ch), before, 'notation never rewrites authored timing');
    }
});

test('zero-sustain incoming chord cannot inherit a legacy shared hold', () => {
    const ch = chord(10, [3, 5], 0);
    ch.notes[0].slide_in_marks = [{ direction: 'down', time: 0 }];
    assert.equal(resolve([ch], [hs()], [template(ch)]).holds.length, 0);
});

test('invalid and open-only incoming metadata do not cancel ordinary shared holds', () => {
    for (const marks of [[], [{ direction: 'up', time: -1 }], [{ direction: 'up', time: true }],
        [{ direction: 'up', time: 2 }], [{ direction: 'left', time: 0 }]]) {
        const ch = chord(10, [3, 5], 1);
        ch.notes[0].slide_in_marks = marks;
        assert.equal(resolve([ch]).byChord.get(ch).suppressMemberTrails, true);
    }
    const ch = chord(10, [0, 5], 1);
    ch.notes[0].slide_in_marks = [{ direction: 'up', time: 0 }];
    assert.equal(resolve([ch]).byChord.get(ch).suppressMemberTrails, true,
        'open destinations do not draw an incoming fret approach');
});
