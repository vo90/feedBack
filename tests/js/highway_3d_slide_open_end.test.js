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
    throw new Error(name);
}
const eventStart = source.indexOf('    function hwyFootprintsOverlap1D(');
const eventEnd = source.indexOf('    /** Fixed pre-impact ramp window', eventStart);
const names = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'hwyLinkNextTargetNotes', 'slideTrailEnd',
    'targetedSlideInterval', 'slideOffsetWorldX', 'hwyOpenSlideTailNotes', 'chordMemberTrailSuppressed',
    'hwyBuildIndependentTrailOrigins', 'hwyNoteVisualParts'];
const h = new Function(`
    const BEND_LINK_TIME_EPS=.001, NFRETS=24, MAX_RENDER_STRINGS=8;
    const fretMid=f=>f<=0?-2:f*10, notePositionX=n=>fretMid(n.f);
    ${names.map(extract).join('\n')}
    ${source.slice(eventStart, eventEnd)}
    return {${names.join(',')}, hwyBuildTrailYieldEvents, hwyBuildTrailOcclusionIndex, hwyFillTrailOcclusionTargets};
`)();

function model(notes, chords = []) {
    const links = new Map();
    const attacks = h.hwyLinkNextTargetNotes(notes, chords, 1e-6, links);
    const hidden = h.hwyOpenSlideTailNotes(links);
    return { links, attacks, hidden };
}
function slidePair(extra = {}, targetExtra = {}) {
    return [{ t: 1, s: 0, f: 1, sus: .1, sl: 0, ln: true, ...extra },
        { t: 1.1, s: 0, f: 0, sus: .1, ...targetExtra }];
}

test('Square Hammer opening keeps seven slide segments to fret zero without detached open rails', () => {
    const frets = [12, 10, 8, 6, 4, 2, 1, 0];
    const notes = frets.map((f, i) => Object.freeze({ t: 2 + i * .0675, s: 0, f, sus: .0675,
        ...(i < 7 ? { sl: frets[i + 1], ln: true } : {}) }));
    const before = JSON.stringify(notes), { hidden, attacks } = model(notes);
    const origins = h.hwyBuildIndependentTrailOrigins(notes, [], new Map(), 6, hidden);
    for (let i = 0; i < 7; i++) {
        assert.equal(hidden.has(notes[i]), false);
        assert.equal(origins.drawable.has(notes[i]), true, `slide segment ${i} remains drawn`);
    }
    const lastSlide = notes[6], open = notes[7];
    assert.equal(hidden.has(open), true);
    assert.equal(origins.drawable.has(open), false);
    assert.equal(attacks.has(open), true, 'the destination remains a continuation, not a new attack');
    assert.equal(lastSlide.f * 10 + h.slideOffsetWorldX(lastSlide, open.t), -2,
        'the final ribbon still reaches the existing fret-zero position');
    assert.equal(JSON.stringify(notes), before, 'timing, sustain, links and pitches are unchanged');
});

test('both authored slide fields use their resolved zero destination and honor pitched precedence', () => {
    for (const field of ['sl', 'slu']) {
        const notes = slidePair({ sl: -1, [field]: 0 });
        assert.equal(model(notes).hidden.has(notes[1]), true);
    }
    const notes = slidePair({ sl: 2, slu: 0 });
    assert.equal(model(notes).hidden.has(notes[1]), false);
});

test('ordinary opens, pull-offs, unlinked slides and unrelated nearby notes retain their tails', () => {
    for (const [label, sourceExtra, targetExtra] of [
        ['unlinked slide', { ln: false }, {}],
        ['plain open hold', { f: 0, sl: -1 }, {}],
        ['pull-off', { sl: -1 }, { po: true }],
        ['other string', {}, { s: 1 }],
        ['different fret', {}, { f: 2 }],
        ['expired link', {}, { t: 1.3 }],
        ['real overlap', {}, { t: 1.05 }],
        ['small real gap', {}, { t: 1.102 }],
        ['no source duration', { sus: 0 }, {}],
    ]) {
        const notes = slidePair(sourceExtra, targetExtra);
        assert.equal(model(notes).hidden.has(notes[1]), false, label);
    }
    const plain = { t: 1, s: 0, f: 0, sus: 2 };
    assert.equal(model([plain]).hidden.has(plain), false);
});

test('open techniques after a slide remain visible, including an authored pull-off', () => {
    const techniques = [
        { po: true }, { ho: true }, { pm: true }, { mt: true }, { fhm: true },
        { tr: true }, { vb: true }, { bn: 1 }, { bnv: [{ t: 0, v: 1 }] },
        { hm: true }, { hp: true }, { harmonic_target: { kind: 'artificial' } },
        { harmonic_changes: { version: 1 } }, { whammy: { version: 1 } },
        { tp: true }, { slp: true }, { plk: true }, { lr: true }, { ghost: true },
        { vibrato_marks: [{ start: 0, end: .1 }] }, { tremolo_marks: [{ start: 0, end: .1 }] },
        { slide_out_marks: [{ start: 0, end: .1, direction: 'down' }] },
        { slide_in_marks: [{ time: 0, direction: 'up' }] }, { sl: 5 },
    ];
    for (const technique of techniques) {
        const notes = slidePair({}, technique);
        assert.equal(model(notes).hidden.has(notes[1]), false, JSON.stringify(technique));
    }
});

test('only plain linked open continuations inherit suppression, independent of map order', () => {
    const [a, b] = slidePair({}, { ln: true });
    const c = { t: 1.2, s: 0, f: 0, sus: .1, ln: true };
    const technique = { t: 1.3, s: 0, f: 0, sus: .1, ln: true, tr: true };
    const after = { t: 1.4, s: 0, f: 0, sus: .1 };
    const { links } = model([after, technique, c, b, a]);
    const hidden = h.hwyOpenSlideTailNotes(new Map([...links].reverse()));
    assert.equal(hidden.has(b), true);
    assert.equal(hidden.has(c), true);
    assert.equal(hidden.has(technique), false);
    assert.equal(hidden.has(after), false, 'the technique ends the plain endpoint hold');
    delete b.ln;
    assert.equal(model([a, b, c]).hidden.has(c), false, 'a separate open attack is never hidden');
});

test('ambiguous coincident predecessors keep destination trails regardless of input order', () => {
    const [a, b] = slidePair(), other = { ...a };
    for (const notes of [[a, other, b], [b, other, a]]) {
        const { hidden, attacks } = model(notes);
        assert.equal(attacks.has(b), true, 'existing attack suppression is independent');
        assert.equal(hidden.has(b), false, 'an unresolved predecessor cannot hide a tail');
    }
});

test('chord and standalone sources/destinations share original note identity without hiding other strings', () => {
    for (const sourceInChord of [false, true]) for (const targetInChord of [false, true]) {
        const [a, b] = slidePair(), other = { s: 1, f: 0, sus: .1 };
        const chords = [], notes = [];
        if (sourceInChord) { delete a.t; chords.push({ t: 1, notes: [a] }); } else notes.push(a);
        if (targetInChord) { delete b.t; chords.push({ t: 1.1, notes: [b, other] }); } else notes.push(b);
        const before = JSON.stringify([notes, chords]), { hidden } = model(notes, chords);
        assert.equal(hidden.has(b), true);
        assert.equal(hidden.has(other), false);
        const origins = h.hwyBuildIndependentTrailOrigins(notes, chords, new Map(), 6, hidden);
        assert.equal(origins.drawable.has(b), false);
        if (targetInChord) assert.equal(origins.drawable.has(other), true);
        assert.equal(JSON.stringify([notes, chords]), before);
    }
});

test('hidden endpoint tails leave neither drawable parts nor phantom overlap candidates', () => {
    const notes = slidePair({ s: 1 }, { s: 1 }), { hidden, attacks } = model(notes), open = notes[1];
    const events = h.hwyBuildTrailYieldEvents(notes, [], 6, {
        suppressedAttacks: attacks, trailVisible: note => !hidden.has(note),
    });
    const endpoint = events[0][0];
    assert.equal(endpoint.gemVisible, false);
    assert.equal(endpoint.trailVisible, false);
    assert.equal(endpoint.standaloneTrailVisible, false);
    for (const now of [.9, 1.1, 1.15]) {
        const parts = h.hwyNoteVisualParts(open, now, 3, .1, Infinity, open.t,
            attacks.has(open), hidden.has(open));
        assert.equal(parts.head, false);
        assert.equal(parts.trail, false);
    }
    const index = h.hwyBuildTrailOcclusionIndex(events, 6);
    const targets = new Array(8), flags = new Uint8Array(8);
    const starts = new Float64Array(8), ends = new Float64Array(8);
    const count = h.hwyFillTrailOcclusionTargets(index, 1.05, 1.5, 0, 1.05,
        1.5, false, targets, flags, starts, ends);
    assert.equal(targets.slice(0, count).includes(endpoint), false);
});

test('renderer gates both source-identity drawing and chart-static visibility with the endpoint policy', () => {
    assert.match(source, /_openSlideTailNotes = hwyOpenSlideTailNotes\(bendLinks\)/);
    assert.match(source, /notes, chords, _chordGuideCache\.model\.byChord, nStr, _openSlideTailNotes/);
    assert.match(source, /trailVisible: \(note, meta, chord\) => !_openSlideTailNotes\.has\(note\)/);
    assert.match(extract('drawNote'), /sharedChordHold \|\| _openSlideTailNotes\.has\(sourceIdentity\), record\.parts/);
    assert.match(source, /_linkNextTargetSet = null;\s*_openSlideTailNotes = new WeakSet\(\);/);
});
