const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCameraSemantics } = require('../../plugins/highway_3d/src/camera-semantics.mjs');
const api = createCameraSemantics({ NFRETS: 24, isRenderableNote: () => true });
const row = (time, fret) => ({ time, firstFret: fret, lastFret: fret + 3,
    minX: (fret - 1) * 10, maxX: (fret + 3) * 10, x: (fret + 1) * 10 });
function repeats(durations) {
    const rows = [];
    let time = 0;
    for (const duration of durations) {
        rows.push(row(time, 5), row(time + .25, 9), row(time + .25 + duration, 12));
        time += .25 + 2 * duration;
    }
    rows.push(row(time, 5));
    return api.hwyCompileCameraEvidence(rows);
}
const excursions = evidence => evidence.candidates.filter(candidate => candidate.reason === 'repeated-cycle');
const apply = (evidence, threshold) => api.hwyApplyCameraThreshold(evidence, { excursionThreshold: threshold });
const heldTimes = stops => stops.timeline.filter(span => span.explanation.decision === 'hold').map(span => span.time);

test('later faster repeats cite the pair that justifies their hold, not the first pattern proof', () => {
    const evidence = repeats([.5, .5, .125, .125]);
    const candidates = excursions(evidence);
    assert.equal(evidence.patterns.length, 1);
    assert.deepEqual(candidates.map(candidate => candidate.interval), [
        { start: 0, end: 2.5 }, { start: 0, end: 2.5 },
        { start: 2.5, end: 3.5 }, { start: 2.5, end: 3.5 },
    ]);
    assert.deepEqual(candidates.map(candidate => candidate.requiredDuration), [.5, .5, .125, .125]);
    assert.deepEqual([evidence.patterns[0].proofStart, evidence.patterns[0].proofEnd], [0, 2.5],
        'the enclosing pattern still records its initial discovery proof');
    const before = JSON.stringify(evidence);
    for (const threshold of [125.01, 400, 500]) {
        const stops = apply(evidence, threshold);
        assert.deepEqual(heldTimes(stops), [2.75, 2.875, 3.25, 3.375]);
        assert.deepEqual(stops.map(stop => stop.firstFret), [5, 9, 12, 5, 9, 12, 5]);
        for (const index of [7, 8, 10, 11]) {
            const explanation = stops.timeline[index].explanation;
            assert.deepEqual(explanation.interval, { start: 2.5, end: 3.5 });
            assert.equal(explanation.home.firstFret, 5);
            assert.equal(explanation.home.time, 0, 'diagnostic proof must not reassign the home');
        }
        assert.equal(stops.timeline[7].explanation, stops.timeline[8].explanation,
            'away lanes in one candidate share the cached explanation');
    }
    assert.deepEqual(heldTimes(apply(evidence, 125)), [], 'equality still counts as lasting');
    assert.deepEqual(heldTimes(apply(evidence, 0)), []);
    assert.equal(JSON.stringify(evidence), before, 'threshold edits cannot mutate cached evidence');
});

test('a preceding faster pair remains the proof when the following repeat slows down', () => {
    const evidence = repeats([.125, .125, .5, .5]);
    const candidates = excursions(evidence);
    assert.deepEqual(candidates.map(candidate => candidate.interval), [
        { start: 0, end: 1 }, { start: 0, end: 1 },
        { start: .5, end: 2.25 }, { start: 1, end: 3.5 },
    ]);
    assert.deepEqual(heldTimes(apply(evidence, 400)), [.25, .375, .75, .875]);
    assert.deepEqual(candidates.map(candidate => candidate.requiredDuration), [.125, .125, .5, .5]);
});

test('equal-duration pairs keep the existing earliest-proof tie choice for each cycle', () => {
    const evidence = repeats([.25, .25, .25]);
    assert.deepEqual(excursions(evidence).map(candidate => candidate.interval), [
        { start: 0, end: 1.5 }, { start: 0, end: 1.5 }, { start: .75, end: 2.25 },
    ]);
    assert.deepEqual(heldTimes(apply(evidence, 250)), []);
    assert.deepEqual(heldTimes(apply(evidence, 250.01)), [.25, .5, 1, 1.25, 1.75, 2]);
});

test('successive single replies cite their own home-to-return interval while keeping one home', () => {
    const rows = [[0, 5], [1, 8], [1.25, 5], [2, 10], [2.125, 5], [3, 12], [3.25, 5]];
    const evidence = api.hwyCompileCameraEvidence(rows.map(([time, fret]) => row(time, fret)));
    const candidates = evidence.candidates.filter(candidate => candidate.reason === 'single-return');
    assert.equal(evidence.patterns.length, 1);
    assert.deepEqual(candidates.map(candidate => candidate.interval), [
        { start: 0, end: 1.25 }, { start: 1.25, end: 2.125 }, { start: 2.125, end: 3.25 },
    ]);
    assert.deepEqual(candidates.map(candidate => candidate.homeIndex), [0, 0, 0]);
    const stops = apply(evidence, 400);
    assert.deepEqual(stops.map(stop => stop.firstFret), [5]);
    assert.deepEqual(heldTimes(stops), [1, 2, 3]);
    for (let i = 0; i < candidates.length; i++) {
        assert.deepEqual(stops.timeline[2 * i + 1].explanation.interval, candidates[i].interval);
        assert.equal(stops.timeline[2 * i + 1].explanation.home.time, 0);
    }
});
