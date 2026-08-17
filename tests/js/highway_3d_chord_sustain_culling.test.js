// Behavioral regression tests for the 3D highway's chord outer-loop culling.
// The renderer itself owns a WebGL scene, so extract the chart-static pure
// index helpers and exercise the exact cutoff/recent-window query used by it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const src = fs.readFileSync(SCREEN_JS, 'utf8');

function extractFunction(name) {
    const signature = `function ${name}(`;
    const start = src.indexOf(signature);
    assert.notEqual(start, -1, `${name} not found`);
    const openBrace = src.indexOf('{', start);
    let depth = 1;
    let i = openBrace + 1;
    while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
    }
    assert.equal(depth, 0, `${name} has unbalanced braces`);
    return src.slice(start, i);
}

const helpers = new Function(`
    ${extractFunction('lowerBoundT')}
    ${extractFunction('_buildChordCullIndex')}
    ${extractFunction('_nextChordCullCandidate')}
    ${extractFunction('_findChordCullCandidate')}
    return { lowerBoundT, _buildChordCullIndex, _nextChordCullCandidate };
`)();

const AHEAD = 3.0;
const BEHIND = 0.5;
const VERDICT_WINDOW = 0.75;
const STRING_COUNT = 6;

function chord(t, sustains = [0, 0]) {
    return {
        t,
        notes: sustains.map((sus, s) => ({ s, f: 5 + s * 2, sus })),
    };
}

function cutoffAt(now, hasNoteStateProvider) {
    return now - (hasNoteStateProvider ? Math.max(BEHIND, VERDICT_WINDOW) : BEHIND);
}

function carryOverCandidates(chords, now, hasNoteStateProvider) {
    const cutoff = cutoffAt(now, hasNoteStateProvider);
    const recentLo = helpers.lowerBoundT(chords, cutoff - AHEAD);
    const index = helpers._buildChordCullIndex(chords, AHEAD, STRING_COUNT);
    const found = [];
    for (let ci = helpers._nextChordCullCandidate(index, 0, recentLo, cutoff);
        ci < recentLo;
        ci = helpers._nextChordCullCandidate(index, ci + 1, recentLo, cutoff)) {
        found.push(ci);
    }
    return { found, recentLo, index };
}

test('sustain longer than AHEAD remains a carry-over render candidate', () => {
    const chords = [chord(46, [7, 7])];

    // Just after the old onset-only lower bound moved past 46.0, the chord
    // used to disappear even though both members sustain until 53.0.
    const result = carryOverCandidates(chords, 49.76, true);
    assert.equal(result.recentLo, 1, 'onset must be outside the ordinary window');
    assert.deepEqual(result.found, [0]);

    assert.deepEqual(carryOverCandidates(chords, 52.99, true).found, [0]);
});

test('mixed member sustains keep the chord indexed through the longest member', () => {
    const chords = [chord(10, [1, 7])];
    const result = carryOverCandidates(chords, 16, false);

    assert.equal(result.index.maxSustains[0], 7);
    assert.deepEqual(result.found, [0], 'the 7 s member must keep the chord loop reachable');

    // The chord loop still passes each member's own sustain to drawNote, so
    // the 1 s member can expire independently while the 7 s member remains.
    assert.match(src, /_scrChordNote\.sus\s*=\s*cn\.sus\s*\|\|\s*0/);
    assert.match(src, /const cnSustainOk = chOnsetInWin \|\| \(chSusActive && ch\.t \+ \(cn\.sus \|\| 0\) >= now\)/);
});

test('carry-over lookup honors normal and note-state-provider cutoff windows', () => {
    const chords = [chord(46, [7, 7])];

    assert.deepEqual(carryOverCandidates(chords, 52.99, false).found, [0]);
    assert.deepEqual(carryOverCandidates(chords, 52.99, true).found, [0]);

    // Equality matches the renderer's existing `< ndVerdictT0` filter.
    assert.deepEqual(carryOverCandidates(chords, 53.5, false).found, [0]);
    assert.deepEqual(carryOverCandidates(chords, 53.5001, false).found, []);
    assert.deepEqual(carryOverCandidates(chords, 53.75, true).found, [0]);
    assert.deepEqual(carryOverCandidates(chords, 53.7501, true).found, []);
});

test('queries are seek-independent and recover the chord after rewinding', () => {
    const chords = [chord(46, [7, 7]), chord(70)];

    assert.deepEqual(carryOverCandidates(chords, 60, true).found, []);
    assert.deepEqual(carryOverCandidates(chords, 50, true).found, [0]);
    assert.deepEqual(carryOverCandidates(chords, 54, true).found, []);
});

test('ordinary dense chords retain the binary-search window fast path', () => {
    const chords = Array.from({ length: 20000 }, (_, i) => chord(i / 100));
    const now = 150;
    const cutoff = cutoffAt(now, false);
    const expectedRecentLo = helpers.lowerBoundT(chords, cutoff - AHEAD);
    const result = carryOverCandidates(chords, now, false);

    assert.equal(result.recentLo, expectedRecentLo);
    assert.deepEqual(result.found, [], 'non-sustained history must not enter carry-over scan');
    assert.equal(
        helpers._nextChordCullCandidate(result.index, 0, result.recentLo, cutoff),
        result.recentLo,
        'the range-max query must skip the expired dense prefix as one indexed search',
    );
});

test('a sparse long sustain is found without making intervening dense chords candidates', () => {
    const chords = Array.from({ length: 20000 }, (_, i) => chord(i / 100));
    chords[1000] = chord(10, [150, 0]);
    const now = 150;
    const cutoff = cutoffAt(now, false);
    const recentLo = helpers.lowerBoundT(chords, cutoff - AHEAD);
    const index = helpers._buildChordCullIndex(chords, AHEAD, STRING_COUNT);

    assert.equal(helpers._nextChordCullCandidate(index, 0, recentLo, cutoff), 1000);
    assert.equal(
        helpers._nextChordCullCandidate(index, 1001, recentLo, cutoff),
        recentLo,
        'expired chords between the long sustain and recent onset window stay skipped',
    );
});

test('renderer wires the sustain index ahead of the existing exact cull check', () => {
    assert.match(src, /_chordCullIndex\s*=\s*_buildChordCullIndex\(chords, AHEAD, nStr\)/);
    assert.match(src, /const _chordsRecentLoIdx = lowerBoundT\(chords, ndVerdictT0 - AHEAD\)/);
    assert.match(src, /_nextChordCullCandidate\([\s\S]{0,120}_chordsRecentLoIdx, ndVerdictT0/);
    assert.match(src, /const _chFilterSus = maxSus > 0 \? maxSus : AHEAD;\s*if \(ch\.t \+ _chFilterSus < ndVerdictT0\) continue;/);
});
