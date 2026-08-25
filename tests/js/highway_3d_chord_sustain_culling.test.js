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
    ${extractFunction('_restoreChordPredecessorState')}
    return {
        lowerBoundT,
        _buildChordCullIndex,
        _nextChordCullCandidate,
        _restoreChordPredecessorState,
    };
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

function shapeChord(t, sig, h3dSynth = false) {
    return { t, sig, h3dSynth };
}

function restoredPredecessors(chords, currentIndex) {
    return helpers._restoreChordPredecessorState(
        chords,
        currentIndex,
        0.5,
        ch => ch.sig ?? null,
        {},
    );
}

function isRepeatOf(current, predecessors) {
    return current.sig !== null
        && predecessors.prevChordSig === current.sig
        && Math.abs(current.t - predecessors.prevChordTime) < 0.5;
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

test('a skipped authored chord replaces stale repeat state after an indexed jump', () => {
    const chords = [
        shapeChord(0, 'A'),
        shapeChord(0.2, 'B'),
        shapeChord(0.4, 'A'),
    ];
    const restored = restoredPredecessors(chords, 2);

    assert.deepEqual(restored, {
        runSigPrev: 'B',
        prevAnyChordTime: 0.2,
        prevChordSig: 'B',
        prevChordTime: 0.2,
    });
    assert.equal(isRepeatOf(chords[2], restored), false);
});

test('indexed traversal restores the authored chord it actually skipped', () => {
    const chords = [
        { ...shapeChord(0, 'A'), notes: [{ s: 0, f: 5, sus: 2 }] },
        { ...shapeChord(0.2, 'B'), notes: [{ s: 0, f: 7, sus: 0 }] },
        { ...shapeChord(0.4, 'A'), notes: [{ s: 0, f: 5, sus: 2 }] },
    ];
    const index = helpers._buildChordCullIndex(chords, 0.1, STRING_COUNT);
    const visited = [];
    const repeatVerdicts = [];
    let prevChordSig = null;
    let prevChordTime = -Infinity;
    let previousVisitedIndex = -1;

    for (let ci = helpers._nextChordCullCandidate(index, 0, chords.length, 1);
        ci < chords.length;
        ci = helpers._nextChordCullCandidate(index, ci + 1, chords.length, 1)) {
        if (ci > previousVisitedIndex + 1) {
            const restored = restoredPredecessors(chords, ci);
            prevChordSig = restored.prevChordSig;
            prevChordTime = restored.prevChordTime;
        }
        const current = chords[ci];
        visited.push(ci);
        repeatVerdicts.push(
            prevChordSig === current.sig && Math.abs(current.t - prevChordTime) < 0.5,
        );
        prevChordSig = current.sig;
        prevChordTime = current.t;
        previousVisitedIndex = ci;
    }

    assert.deepEqual(visited, [0, 2], 'the expired B chord must be skipped by the index');
    assert.deepEqual(repeatVerdicts, [false, false], 'the skipped B chord must still break the A repeat');
});

test('a skipped authored repeat is recovered after an indexed jump', () => {
    const chords = [
        shapeChord(0, 'B'),
        shapeChord(0.2, 'A'),
        shapeChord(0.4, 'A'),
    ];
    const restored = restoredPredecessors(chords, 2);

    assert.equal(restored.runSigPrev, 'A');
    assert.equal(restored.prevChordSig, 'A');
    assert.equal(restored.prevChordTime, 0.2);
    assert.equal(isRepeatOf(chords[2], restored), true);
});

test('synthetic chords affect label runs but never become repeat predecessors', () => {
    const syntheticSameShape = [
        shapeChord(0, 'B'),
        shapeChord(0.2, 'A', true),
        shapeChord(0.4, 'A'),
    ];
    const fromSyntheticSameShape = restoredPredecessors(syntheticSameShape, 2);
    assert.equal(fromSyntheticSameShape.runSigPrev, 'A');
    assert.equal(fromSyntheticSameShape.prevChordSig, 'B');
    assert.equal(isRepeatOf(syntheticSameShape[2], fromSyntheticSameShape), false);

    const syntheticDifferentShape = [
        shapeChord(0, 'A'),
        shapeChord(0.2, 'B', true),
        shapeChord(0.4, 'A'),
    ];
    const fromSyntheticDifferentShape = restoredPredecessors(syntheticDifferentShape, 2);
    assert.equal(fromSyntheticDifferentShape.runSigPrev, 'B');
    assert.equal(fromSyntheticDifferentShape.prevChordSig, 'A');
    assert.equal(isRepeatOf(syntheticDifferentShape[2], fromSyntheticDifferentShape), true);
});

test('predecessor restoration honors null signatures and the exact repeat boundary', () => {
    const chords = [
        shapeChord(0, 'A'),
        shapeChord(0.25, null),
        shapeChord(0.5, 'A'),
    ];
    const restored = restoredPredecessors(chords, 2);

    assert.equal(restored.runSigPrev, 'A', 'null signatures must not stop the backward scan');
    assert.equal(restored.prevAnyChordTime, 0);
    assert.equal(restored.prevChordSig, null, 'repeat matching is strictly inside 0.5 s');
    assert.equal(isRepeatOf(chords[2], restored), false);
});

test('string-count rebuild includes newly valid extended-range sustains', () => {
    const chords = [{
        t: 10,
        notes: [
            { s: 0, f: 5, sus: 1 },
            { s: 6, f: 7, sus: 7 },
        ],
    }];
    const sixStringIndex = helpers._buildChordCullIndex(chords, AHEAD, 6);
    const sevenStringIndex = helpers._buildChordCullIndex(chords, AHEAD, 7);

    assert.equal(sixStringIndex.maxSustains[0], 1);
    assert.equal(sevenStringIndex.maxSustains[0], 7);
    assert.equal(helpers._nextChordCullCandidate(sixStringIndex, 0, 1, 16), 1);
    assert.equal(helpers._nextChordCullCandidate(sevenStringIndex, 0, 1, 16), 0);
});

test('cull cache reuses, rebuilds, and resets at every ownership boundary', () => {
    const cacheTransitions = new Function(`
        ${extractFunction('_buildChordCullIndex')}
        let _chordCullIndex = { count: 1 };
        let _chordCullIndexChordsRef = [{}];
        let _chordCullIndexStringCount = 7;
        ${extractFunction('_resetChordCullIndex')}
        ${extractFunction('_ensureChordCullIndex')}

        const originalChords = [{
            t: 10,
            notes: [
                { s: 0, f: 5, sus: 1 },
                { s: 6, f: 7, sus: 7 },
            ],
        }];
        const first = _ensureChordCullIndex(originalChords, 3, 6);
        const reused = _ensureChordCullIndex(originalChords, 3, 6);
        const countChanged = _ensureChordCullIndex(originalChords, 3, 7);

        const replacementChords = [{
            t: 20,
            notes: [{ s: 0, f: 9, sus: 2 }],
        }];
        const chartChanged = _ensureChordCullIndex(replacementChords, 3, 7);
        _resetChordCullIndex();
        const cleared = {
            index: _chordCullIndex,
            chordsRef: _chordCullIndexChordsRef,
            stringCount: _chordCullIndexStringCount,
        };
        const afterReset = _ensureChordCullIndex(replacementChords, 3, 7);

        return {
            reused: reused === first,
            countRebuilt: countChanged !== first,
            sixStringSustain: first.maxSustains[0],
            sevenStringSustain: countChanged.maxSustains[0],
            chartRebuilt: chartChanged !== countChanged,
            replacementSustain: chartChanged.maxSustains[0],
            cleared,
            resetRebuilt: afterReset !== chartChanged,
        };
    `)();

    assert.deepEqual(cacheTransitions, {
        reused: true,
        countRebuilt: true,
        sixStringSustain: 1,
        sevenStringSustain: 7,
        chartRebuilt: true,
        replacementSustain: 2,
        cleared: { index: null, chordsRef: null, stringCount: -1 },
        resetRebuilt: true,
    });
    assert.match(extractFunction('_resetStringDependentCaches'), /_resetChordCullIndex\(\);/);
    assert.match(extractFunction('teardown'), /_resetChordCullIndex\(\);/);
    assert.match(src, /_ensureChordCullIndex\(chords, AHEAD, nStr\);/);
});

test('renderer restores both predecessor states on initial and later indexed gaps', () => {
    const restoreSource = extractFunction('_restoreChordPredecessorState');
    assert.doesNotMatch(restoreSource, /\b(?:new|push|map|filter|slice)\b/);

    const loopStart = src.indexOf('const SHAPE_RUN_GAP_S = 0.5;');
    const loopEnd = src.indexOf('// Anchor selection for chord frame', loopStart);
    const chordLoop = src.slice(loopStart, loopEnd);
    assert.match(chordLoop, /let _chordsPrevVisitedIdx = -1;/);
    assert.match(chordLoop, /_restoreChordPredecessorState\(/);
    assert.match(chordLoop, /prevChordSig = _chordPredecessorStateScratch\.prevChordSig;/);
    assert.doesNotMatch(chordLoop, /chords\[_chordsLoIdx - 1\]/);
});

test('renderer wires the sustain index ahead of the existing exact cull check', () => {
    assert.match(
        extractFunction('_ensureChordCullIndex'),
        /_chordCullIndex\s*=\s*_buildChordCullIndex\(chords, ahead, stringCount\)/,
    );
    assert.match(src, /_ensureChordCullIndex\(chords, AHEAD, nStr\);/);
    assert.match(src, /const _chordsRecentLoIdx = lowerBoundT\(chords, ndVerdictT0 - AHEAD\)/);
    assert.match(src, /_nextChordCullCandidate\([\s\S]{0,120}_chordsRecentLoIdx, ndVerdictT0/);
    assert.match(src, /const _chFilterSus = maxSus > 0 \? maxSus : AHEAD;\s*if \(ch\.t \+ _chFilterSus < ndVerdictT0\) continue;/);
});
