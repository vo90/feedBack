const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' exists');
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function: ' + name);
}
function helpers() {
    return new Function(`
        const NEXT_ON_STRING_T_EPS = .06, BEND_LINK_TIME_EPS = .001;
        ${['hwyLinkNextTargetNotes', 'hwyBuildLinkedTrailPaths', 'hwyLinkedTrailMemberAt'].map(fn).join('\n')}
        return { hwyLinkNextTargetNotes, hwyBuildLinkedTrailPaths, hwyLinkedTrailMemberAt };
    `)();
}
const n = extra => ({ t: 10, s: 0, f: 5, sus: 1, ...extra });
function build(notes, chords = []) {
    const h = helpers(), links = new Map();
    const attacks = h.hwyLinkNextTargetNotes(notes, chords, 1e-6, links);
    return { ...h.hwyBuildLinkedTrailPaths(links), attacks, links, memberAt: h.hwyLinkedTrailMemberAt };
}
function samePath(model, ...notes) {
    const context = model.byNote.get(notes[0]);
    assert.ok(context, 'first note has a linked path');
    for (const note of notes) assert.equal(model.byNote.get(note)?.path, context.path);
    return context.path;
}

test('an authored same-fret hold and its continuation form one timed path', () => {
    const a = n({ ln: true }), b = n({ t: 11 });
    const model = build([a, b]), p = samePath(model, a, b);
    assert.equal(p.start, 10); assert.equal(p.end, 12);
    assert.deepEqual(p.members.map(x => x.onset), [10, 11]);
    assert.equal(model.byNote.get(b).index, 1);
    assert.ok(model.attacks.has(b));
});

test('pitched and unpitched slides join only at their written destination frets', () => {
    for (const field of ['sl', 'slu']) {
        const a = n({ ln: true, [field]: 8 }), b = n({ t: 11, f: 8, ln: true, [field]: 3 });
        const c = n({ t: 12, f: 3 });
        const model = build([c, a, b]), p = samePath(model, a, b, c);
        assert.equal(p.end, 13);
        assert.deepEqual(p.members.map(x => x.note.f), [5, 8, 3]);
        assert.equal(build([a, n({ t: 11, f: 7 })]).byNote.get(a), undefined);
    }
});

test('chord member onsets come from their chords across both representations', () => {
    const a = { s: 2, f: 7, sus: 1, ln: true };
    const b = n({ t: 11, s: 2, f: 7, sus: 2, ln: true });
    const c = { s: 2, f: 7, sus: 1 };
    const chords = [{ t: 10, notes: [a] }, { t: 13, notes: [c] }];
    const model = build([b], chords), p = samePath(model, a, b, c);
    assert.deepEqual(p.members.map(x => x.onset), [10, 11, 13]);
    assert.equal(p.end, 14);
    assert.equal(a.t, undefined); assert.equal(c.t, undefined);
});

test('a partially linked chord preserves independent strings and attacks', () => {
    const a = { s: 0, f: 5, sus: 1, ln: true }, other = { s: 1, f: 7, sus: 1 };
    const b = { s: 0, f: 5, sus: 1 }, nextOther = { s: 1, f: 7, sus: 1 };
    const model = build([], [{ t: 10, notes: [a, other] }, { t: 11, notes: [b, nextOther] }]);
    samePath(model, a, b);
    assert.equal(model.byNote.get(other), undefined);
    assert.equal(model.byNote.get(nextOther), undefined);
    assert.equal(model.attacks.has(nextOther), false);
});

test('normal repeated attacks and cross-string notes never become continuations', () => {
    const a = n(), b = n({ t: 11 });
    assert.equal(build([a, b]).paths.length, 0);
    a.ln = true; b.s = 1;
    assert.equal(build([a, b]).paths.length, 0);
});

test('geometry continuity uses the strict rounding tolerance, not the attack grace window', () => {
    for (const delta of [-.0008, .0008]) {
        const a = n({ ln: true }), b = n({ t: 11 + delta });
        samePath(build([a, b]), a, b);
    }
    for (const delta of [-.05, .002, .03]) {
        const a = n({ ln: true }), b = n({ t: 11 + delta }), model = build([a, b]);
        assert.ok(model.attacks.has(b), 'existing compatible attack suppression is retained');
        assert.equal(model.paths.length, 0, 'real gap/overlap must not be bridged');
    }
});

test('missing or invalid duration never invents a continuous visible path', () => {
    for (const duration of [undefined, 0, -1, NaN, Infinity]) {
        const a = n({ ln: true, sus: duration }), b = n({ t: 11 });
        assert.equal(build([a, b]).paths.length, 0);
        const c = n({ ln: true }), d = n({ t: 11, sus: duration });
        assert.equal(build([c, d]).paths.length, 0);
    }
});

test('expired links cannot claim a later unrelated attack', () => {
    const a = n({ ln: true }), b = n({ t: 11.5 }), model = build([a, b]);
    assert.equal(model.paths.length, 0); assert.equal(model.attacks.has(b), false);
});

test('competing predecessor objects stay ambiguous regardless of array order', () => {
    const a = n({ ln: true }), duplicate = n({ ln: true }), b = n({ t: 11 });
    for (const notes of [[a, duplicate, b], [b, duplicate, a]]) {
        const model = build(notes);
        assert.equal(model.paths.length, 0);
        assert.equal(model.byNote.get(b), undefined);
    }
});

test('a fork into coincident destination objects cannot pick a path by array order', () => {
    const a = n({ ln: true }), b = n({ t: 11 }), duplicate = n({ t: 11 });
    for (const notes of [[a, b, duplicate], [duplicate, b, a]]) {
        assert.equal(build(notes).byNote.get(a), undefined);
    }
});

test('open-string linked sustains retain their own per-string path', () => {
    const a = n({ f: 0, ln: true }), b = n({ t: 11, f: 0 });
    const p = samePath(build([a, b]), a, b);
    assert.deepEqual(p.members.map(x => x.note.f), [0, 0]);
});

test('a non-drawable member ends a visibility path without changing attack suppression', () => {
    const a = n({ ln: true }), b = n({ t: 11, ln: true }), c = n({ t: 12, ln: true }), d = n({ t: 13 });
    const original = build([a, b, c, d]);
    const model = helpers().hwyBuildLinkedTrailPaths(original.links, { trailVisible: note => note !== b });
    assert.equal(model.byNote.get(a), undefined);
    assert.equal(model.byNote.get(b), undefined);
    samePath(model, c, d);
    assert.ok(original.attacks.has(b), 'visibility eligibility does not resurrect a suppressed attack');
});

test('an open lane-position change splits only the discontinuous join', () => {
    const a = n({ f: 0, ln: true }), b = n({ t: 11, f: 0, ln: true }), c = n({ t: 12, f: 0 });
    const original = build([a, b, c]);
    const model = helpers().hwyBuildLinkedTrailPaths(original.links, { canJoin: (source, target) => target !== b });
    assert.equal(model.byNote.get(a), undefined);
    samePath(model, b, c);
});

test('bend, vibrato and slide-out source metadata remains authoritative and immutable', () => {
    const a = Object.freeze(n({ ln: true, bn: 2, bnv: Object.freeze([{ t: 0, v: 1 }, { t: 1, v: 2 }]) }));
    const b = Object.freeze(n({ t: 11, vb: true, slide_out_marks: Object.freeze([{ start: .7, end: 1, direction: 'down' }]) }));
    const before = JSON.stringify([a, b]), model = build(Object.freeze([a, b]));
    const p = samePath(model, a, b);
    assert.equal(p.members[0].note, a); assert.equal(p.members[1].note, b);
    assert.equal(JSON.stringify([a, b]), before);
});

test('path sampling locates the correct piece independently of playback order', () => {
    const a = n({ ln: true }), b = n({ t: 11, ln: true }), c = n({ t: 12 });
    const model = build([a, b, c]), p = samePath(model, a, b, c);
    for (const [time, expected] of [[12.5, c], [10.5, a], [11, b], [12, c], [11.5, b]]) {
        assert.equal(model.memberAt(p, time).note, expected);
    }
});

test('long valid chains build iteratively without a recursion limit', () => {
    const notes = Array.from({ length: 12000 }, (_, i) => n({ t: i, ln: i < 11999 }));
    const model = build(notes), p = samePath(model, notes[0], notes[11999]);
    assert.equal(p.members.length, notes.length);
    assert.equal(p.end, 12000);
    assert.equal(model.memberAt(p, 11998.5).note, notes[11998]);
});

function visibilityHelpers() {
    const start = source.indexOf('    function hwyFootprintsOverlap1D(');
    const end = source.indexOf('    /** Fixed pre-impact ramp window', start);
    assert.ok(start >= 0 && end > start);
    return new Function(`
        const NFRETS = 24, MAX_RENDER_STRINGS = 8;
        ${source.slice(start, end)}
        return {hwyBuildTrailYieldEvents, hwyBuildTrailOcclusionIndex,
            hwyFillTrailYieldTimes, hwyFillTrailOcclusionTargets,
            TRAIL_OCCLUSION_GEM, TRAIL_OCCLUSION_TRAIL};
    `)();
}

test('a hidden continuation head cannot generate an upcoming-gem notch', () => {
    const a = n({ s: 1, ln: true }), b = n({ t: 11, s: 1 });
    const model = build([a, b]), h = visibilityHelpers();
    const events = h.hwyBuildTrailYieldEvents([a, b], [], 6, {
        linkedPaths: model, suppressedAttacks: model.attacks,
    });
    assert.equal(events[5][1].gemVisible, false);
    const starts = new Float64Array(8), ends = new Float64Array(8);
    const count = h.hwyFillTrailYieldTimes(events[5], 10.5, 0, 10.5, 12.5,
        false, starts, ends, 0, 12.5);
    assert.equal(count, 0);
});

test('the real trail attached to a hidden continuation remains a visibility target', () => {
    const a = n({ s: 1, ln: true }), b = n({ t: 11, s: 1 });
    const model = build([a, b]), h = visibilityHelpers();
    const events = h.hwyBuildTrailYieldEvents([a, b], [], 6, {
        linkedPaths: model, suppressedAttacks: model.attacks,
    });
    const index = h.hwyBuildTrailOcclusionIndex(events, 6);
    const targets = new Array(8), flags = new Uint8Array(8);
    const starts = new Float64Array(8), ends = new Float64Array(8);
    const count = h.hwyFillTrailOcclusionTargets(index, 10.5, 12.5, 0, 10.5,
        12.5, false, targets, flags, starts, ends);
    const targetIndex = targets.slice(0, count).findIndex(x => x.t === 11);
    assert.ok(targetIndex >= 0);
    assert.equal(flags[targetIndex] & h.TRAIL_OCCLUSION_GEM, 0);
    assert.ok(flags[targetIndex] & h.TRAIL_OCCLUSION_TRAIL);
});

test('trail eligibility can represent independent open chord trails without inventing others', () => {
    const member = { s: 1, f: 0, sus: 1 }, chords = [{ t: 10, notes: [member] }];
    const h = visibilityHelpers();
    const legacy = h.hwyBuildTrailYieldEvents([], chords, 6);
    assert.equal(legacy[0][0].trailVisible, false, 'baseline chord open tails are suppressed');
    const independent = h.hwyBuildTrailYieldEvents([], chords, 6, { trailVisible: () => true });
    assert.equal(independent[0][0].trailVisible, true);
    const sharedHold = h.hwyBuildTrailYieldEvents([], [{ t: 10, notes: [n()] }], 6,
        { trailVisible: () => false });
    assert.equal(sharedHold[5][0].trailVisible, false);
    assert.equal(sharedHold[5][0].gemVisible, true, 'shared timing does not hide the attack');
});

test('suppressed member trails cannot create phantom trail intersections', () => {
    const h = visibilityHelpers();
    const events = h.hwyBuildTrailYieldEvents([n({ t: 11, s: 1 })], [], 6,
        { trailVisible: () => false });
    const index = h.hwyBuildTrailOcclusionIndex(events, 6);
    const targets = new Array(8), flags = new Uint8Array(8);
    const starts = new Float64Array(8), ends = new Float64Array(8);
    const count = h.hwyFillTrailOcclusionTargets(index, 10, 13, 0, 10,
        13, false, targets, flags, starts, ends);
    assert.equal(count, 1);
    assert.ok(flags[0] & h.TRAIL_OCCLUSION_GEM);
    assert.equal(flags[0] & h.TRAIL_OCCLUSION_TRAIL, 0);
});

for (const longActiveTarget of [false, true]) {
    test(`late chain queries skip expired history${longActiveTarget ? ' while retaining an old active target' : ''}`, () => {
        const h = visibilityHelpers();
        const notes = Array.from({ length: 12000 }, (_, i) => n({ t: i + 1, s: 1, sus: .02 }));
        if (longActiveTarget) notes.unshift(n({ t: .1, s: 1, sus: 13000 }));
        const events = h.hwyBuildTrailYieldEvents(notes, [], 6)[5];
        let eventReads = 0;
        const observed = new Proxy(events, {
            get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) eventReads++;
                return Reflect.get(target, key, receiver);
            },
        });
        const starts = new Float64Array(32), ends = new Float64Array(32);
        const count = h.hwyFillTrailYieldTimes(observed, 0, 0, 11998, 12002,
            false, starts, ends, 0, 12001);
        assert.ok(count >= 3, 'upcoming targets must remain eligible');
        if (longActiveTarget) assert.ok(Array.from(starts.slice(0, count)).includes(.1),
            'an old still-visible sustain must not be discarded with expired history');
        assert.ok(eventReads < 100, `query read ${eventReads} events instead of nearby/live candidates`);
    });
}
