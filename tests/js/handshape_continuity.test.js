const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');
const highway = fs.readFileSync(path.join(__dirname, '../../static/highway.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const shape = (start, end, extra = {}) => ({
    chord_id: 46, start_time: start, end_time: end, arp: true, ...extra,
});
const level = handshapes => ({ notes: [], chords: [], anchors: [], handshapes });
const phrase = (start, end, handshapes) => ({
    start_time: start, end_time: end, levels: [level(handshapes)],
});

async function harness(phrases, originals, mastery = 1) {
    const { joinPhraseHandShapes } = await import('../../static/js/handshape-continuity.js');
    const state = { _phrases: phrases, handShapes: originals, _mastery: mastery };
    const rebuild = new Function('hwState', 'joinPhraseHandShapes', `
        const _restageChartTransform = () => {};
        ${extractFunction(highway, 'function _rebuildMasteryFilter')}
        return _rebuildMasteryFilter;
    `)(state, joinPhraseHandShapes);
    rebuild();
    return { state, rebuild };
}

function syntheticChords(handshapes, realChords = []) {
    const names = ['isPlayableFret', 'validString', 'chordTemplateLabel',
        'chordNotesFromTemplate', 'mergeHandShapeSynthChords'];
    const merge = new Function(`
        const NFRETS = 24, nStr = 6, S_COL = Array(6), _oobStringWarned = true;
        ${names.map(name => extractFunction(renderer, 'function ' + name)).join('\n')}
        return mergeHandShapeSynthChords;
    `)();
    const templates = [];
    templates[46] = { name: 'D5', frets: [-1, -1, 0, 2, 3, -1], arp: true };
    return merge(realChords, handshapes, templates);
}

test('Rush-style arpeggio crossing a rounded phrase boundary has one frame onset', async () => {
    const original = shape(443.959015, 449.497986);
    const phrases = [
        phrase(408.799, 447.168, [shape(443.959015, 447.167999)]),
        phrase(447.168, 481.599, [shape(447.167999, 449.497986)]),
    ];
    const note = { t: 446.549011, s: 4, f: 3, sus: 2.401 };
    phrases[0].levels[0].notes.push(note);
    const before = JSON.stringify({ phrases, original });
    assert.deepEqual(syntheticChords(phrases.flatMap(p => p.levels[0].handshapes)).map(c => c.t),
        [443.959015, 447.167999], 'unjoined fragments reproduce the phantom onset');
    const { state } = await harness(phrases, [original]);
    assert.deepEqual(state._filteredHandShapes, [original]);
    assert.deepEqual(syntheticChords(state._filteredHandShapes).map(c => c.t), [443.959015]);
    assert.equal(state._filteredNotes[0], note, 'the sustain retains its original object and duration');
    assert.equal(JSON.stringify({ phrases, original }), before, 'authored data stays immutable');
});

for (const arp of [true, false]) {
    test(`${arp ? 'arpeggio' : 'ordinary'} handshape can continue across three phrases`, async () => {
        const originals = [shape(8, 35, { arp })];
        const phrases = [
            phrase(0, 10, [shape(8, 10, { arp })]),
            phrase(10, 20, [shape(10, 20, { arp })]),
            phrase(20, 40, [shape(20, 35, { arp })]),
        ];
        const { state } = await harness(phrases, originals);
        assert.deepEqual(state._filteredHandShapes, originals);
    });
}

test('a real chord at a joined boundary remains an authored attack', async () => {
    const attack = { t: 10, id: 46, notes: [{ s: 2, f: 0 }, { s: 3, f: 2 }, { s: 4, f: 3 }] };
    const phrases = [phrase(0, 10, [shape(8, 10)]), phrase(10, 20, [shape(10, 15)])];
    phrases[1].levels[0].chords.push(attack);
    const { state } = await harness(phrases, [shape(8, 15)]);
    const chords = syntheticChords(state._filteredHandShapes, state._filteredChords);
    assert.equal(chords.filter(c => c.h3dSynth).length, 1);
    assert.equal(chords.find(c => !c.h3dSynth), attack);
});

test('mastery changes rebuild continuity from selected slices without filling hidden phrases', async () => {
    const phrases = [
        { ...phrase(0, 10, []), levels: [level([]), level([shape(8, 10)])] },
        { ...phrase(10, 20, []), levels: [level([]), level([shape(10, 20)])] },
        { ...phrase(20, 40, []), levels: [level([shape(20, 35)]), level([shape(20, 35)])] },
    ];
    const { state, rebuild } = await harness(phrases, [shape(8, 35)]);
    assert.deepEqual(state._filteredHandShapes, [shape(8, 35)]);
    state._mastery = 0;
    rebuild();
    assert.deepEqual(state._filteredHandShapes, [shape(20, 35)]);
    state._mastery = 1;
    rebuild();
    assert.deepEqual(state._filteredHandShapes, [shape(8, 35)]);
    phrases[1].levels[1].handshapes = [];
    rebuild();
    assert.deepEqual(state._filteredHandShapes, [shape(8, 10), shape(20, 35)]);
});

test('different per-phrase level counts can still select one continuous grip', async () => {
    const phrases = [
        { ...phrase(0, 10, []), levels: [level([]), level([shape(8, 10)])] },
        { ...phrase(10, 20, []), levels: [level([]), level([]), level([shape(10, 15)])] },
    ];
    const { state } = await harness(phrases, [shape(8, 15)], 0.8);
    assert.deepEqual(state._filteredHandShapes, [shape(8, 15)]);
});

test('genuine adjacent occurrences keep both frame onsets, including equal names and IDs', async () => {
    const originals = [shape(8, 10), shape(10, 15)];
    const { state } = await harness([
        phrase(0, 10, [originals[0]]), phrase(10, 20, [originals[1]]),
    ], originals);
    assert.deepEqual(syntheticChords(state._filteredHandShapes).map(c => c.t), [8, 10]);
});

test('gaps, changed grips, arpeggio flags, and extension metadata do not join', async () => {
    for (const right of [
        shape(10.001, 15), shape(10, 15, { chord_id: 47 }),
        shape(10, 15, { arp: false }), shape(10, 15, { source: 'another-gesture' }),
    ]) {
        const left = shape(8, 10);
        const { state } = await harness([
            phrase(0, 10, [left]), phrase(10, 20, [right]),
        ], [shape(8, 15)]);
        assert.deepEqual(state._filteredHandShapes, [left, right]);
    }
});

test('touching shapes within one phrase or away from the phrase boundary stay separate', async () => {
    const left = shape(8, 10), right = shape(10, 15);
    for (const phrases of [
        [phrase(0, 20, [left, right])],
        [phrase(0, 11, [left]), phrase(11, 20, [right])],
    ]) {
        const { state } = await harness(phrases, [shape(8, 15)]);
        assert.deepEqual(state._filteredHandShapes, [left, right]);
    }
});

test('missing or ambiguous original evidence cannot erase a new onset', async () => {
    const left = shape(8, 10), right = shape(10, 15);
    for (const originals of [[], [shape(8, 15), shape(7, 16)], [shape(8, 15), shape(10, 15)]]) {
        const { state } = await harness([
            phrase(0, 10, [left]), phrase(10, 20, [right]),
        ], originals);
        assert.deepEqual(state._filteredHandShapes, [left, right]);
    }
});

test('a reduced voicing cannot borrow continuity from a different full-difficulty template', async () => {
    const left = shape(8, 10, { chord_id: 481, arp: false });
    const right = shape(10, 15, { chord_id: 481, arp: false });
    const attack = { t: 10, id: 481, notes: [{ s: 1, f: 5 }, { s: 2, f: 7 }] };
    const phrases = [
        { ...phrase(0, 10, []), levels: [level([left]), level([shape(8, 10, { arp: false })])] },
        { ...phrase(10, 20, []), levels: [level([right]), level([shape(10, 15, { arp: false })])] },
    ];
    phrases[1].levels[0].chords.push(attack);
    const { state } = await harness(phrases, [shape(8, 15, { arp: false })], 0);
    assert.deepEqual(state._filteredHandShapes, [left, right]);
    assert.equal(state._filteredChords[0], attack);
});

test('wire aliases and numeric IDs join without rewriting the source objects', async () => {
    const left = { chordId: '46', startTime: 8, endTime: 10, arp: 1 };
    const right = { chordId: 46, startTime: 10, endTime: 15, arp: true };
    const { state } = await harness([
        phrase(0, 10, [left]), phrase(10, 20, [right]),
    ], [shape(8, 15)]);
    assert.deepEqual(state._filteredHandShapes, [{ ...left, endTime: 15 }]);
    assert.equal(left.endTime, 10);
});

test('charts without phrase handshapes retain flat fallback and intentional filtered emptiness', async () => {
    const { state } = await harness([phrase(0, 20, [])], [shape(8, 15)]);
    assert.deepEqual(state._filteredHandShapes, []);
    assert.equal(state._phrasesHaveHandShapes, false);
    const lower = await harness([{
        ...phrase(0, 20, []), levels: [level([]), level([shape(8, 15)])],
    }], [shape(8, 15)], 0);
    assert.deepEqual(lower.state._filteredHandShapes, []);
    assert.equal(lower.state._phrasesHaveHandShapes, true);
    const flat = await harness(null, [shape(8, 15)]);
    assert.equal(flat.state._filteredHandShapes, null);
});
