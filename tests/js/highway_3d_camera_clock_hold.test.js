const test = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('../helpers/highway_camera_harness.cjs');

const near = (actual, expected, message, tolerance = 1e-8) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} versus ${expected}`);
const points = x => [[30, 13, 0], [x, 13, -30]];

function camera(preset, rate = 1, autoZoom = true) {
    const h = harness();
    h.settings({preset, rate, autoZoom, startBeforeMs: 400, arriveAfterMs: 50});
    h.setRegionTimeline([{time: 0, minX: 10, maxX: 50}]);
    return h;
}

function sample(h, songTime, wallMs, rate = 1, options = {}, raf = true) {
    return h.clockFrame(songTime, wallMs, raf ? wallMs + 100 : undefined, {rate, ...options});
}

function warm(h, rate = 1, end = 4.6, raf = true) {
    let result;
    const frames = Math.round(end * 120);
    for (let frame = 0; frame <= frames; frame++) {
        const time = frame / 120;
        h.setPoints(points(time < 4 ? 310 : 30));
        result = sample(h, time, time * 1000 / rate, rate, {}, raf);
    }
    return result;
}

function stale(h, rate, lastSongTime, frameCount = 180, raf = true) {
    const lastWall = lastSongTime * 1000 / rate;
    const results = [];
    for (let frame = 1; frame <= frameCount; frame++) {
        const wallMs = lastWall + frame * 1000 / 120;
        results.push(sample(h, lastSongTime, wallMs, rate,
            {position: lastSongTime, sampledAt: lastWall, freshAt: lastWall}, raf));
    }
    return {results, wallMs: lastWall + frameCount * 1000 / 120};
}

function sameReturn(actual, expected, label) {
    for (const field of ['distance', 'quietZoomTime', 'zoomReturnFrom', 'zoomVelocity'])
        near(actual[field], expected[field], `${label}: ${field}`);
}

for (const preset of ['straight', 'angled']) {
    for (const rate of [.5, 1, 2]) {
        test(`${preset}/${rate}x: stale audio freezes inward recovery and resumes only with fresh elapsed frames`, () => {
            const h = camera(preset, rate);
            warm(h, rate);
            const evidence = h.planCache().cameraEvidence;
            const areas = h.planCache().tappingAreas;
            const {results, wallMs} = stale(h, rate, 4.6);
            // The presentation clock has its own 250 real-ms extrapolation
            // budget. Only after that budget expires must zoom stop as well.
            const held = results[30];
            assert.ok(held.state.zoomVelocity < 0, 'fixture reaches a real inward return before the hold');
            for (const result of results.slice(31)) {
                near(result.time, held.time, 'the displayed highway must have stopped');
                sameReturn(result.state, held.state, 'stale source holds the zoom phase');
            }
            assert.equal(h.planCache().cameraEvidence, evidence, 'clock holds reuse chart evidence');
            assert.equal(h.planCache().tappingAreas, areas, 'clock holds reuse tapping evidence');

            const resumed = sample(h, held.time, wallMs, rate);
            near(resumed.time, held.time, 'fresh source can resume at the held song position');
            sameReturn(resumed.state, held.state, 'fresh source without elapsed time cannot move zoom');
            const advancing = sample(h, held.time + rate / 120, wallMs + 1000 / 120, rate);
            near(advancing.state.quietZoomTime - held.state.quietZoomTime, rate / 120,
                'zoom advances by one new song-time frame rather than the outage duration');
            assert.ok(advancing.state.distance < held.state.distance, 'inward motion resumes');
            let settled = advancing;
            for (let frame = 2; frame <= 360; frame++)
                settled = sample(h, held.time + frame * rate / 120, wallMs + frame * 1000 / 120, rate);
            near(settled.state.distance, settled.state.targetDistance, 'resumed recovery finishes normally');
        });
    }

    test(`${preset}: playback reaching its end holds an unfinished inward return`, () => {
        const h = camera(preset);
        warm(h);
        let held;
        for (let frame = 1; frame <= 180; frame++) {
            const wallMs = 4600 + frame * 1000 / 120;
            const result = sample(h, Math.min(4.8, wallMs / 1000), wallMs, 1, {endTime: 4.8});
            if (frame === 25) {
                held = result;
                assert.ok(held.state.zoomVelocity < 0, 'end fixture must still be recovering');
            } else if (frame > 25) {
                near(result.time, 4.8, 'song remains at its end');
                sameReturn(result.state, held.state, 'end hold preserves recovery phase');
            }
        }
    });

    test(`${preset}: stale and track-end boundaries spend only the final visible song-time slice`, () => {
        for (const boundary of ['stale', 'end']) {
            const h = camera(preset);
            warm(h);
            let before, reached;
            if (boundary === 'stale') {
                const observation = {position: 4.6, sampledAt: 4600, freshAt: 4600};
                before = sample(h, 4.6, 4840, 1, observation);
                reached = sample(h, 4.6, 4870, 1, observation);
            } else {
                before = sample(h, 4.79, 4790, 1, {endTime: 4.8});
                reached = sample(h, 4.81, 4810, 1, {endTime: 4.8});
            }
            near(reached.time - before.time, .01, `${boundary}: highway has one final 10-ms slice`);
            near(reached.state.quietZoomTime - before.state.quietZoomTime, .01,
                `${boundary}: zoom uses the same final slice, not the full wall interval`);
            assert.ok(reached.state.distance < before.state.distance,
                `${boundary}: the remaining valid movement must not be dropped`);
        }
    });

    test(`${preset}: a long-frame or stale-source recovery directly to track end cannot spend the jump on zoom`, () => {
        for (const wasStale of [false, true]) {
            const h = camera(preset);
            let before = warm(h), wallMs = 4600;
            if (wasStale) {
                const held = stale(h, 1, 4.6);
                before = held.results.at(-1); wallMs = held.wallMs;
            }
            const recovered = sample(h, 12, wallMs + 5000, 1, {endTime: 12});
            near(recovered.time, 12, 'the highway can resynchronize directly to the final frame');
            sameReturn(recovered.state, before.state,
                `${wasStale ? 'stale source' : 'long frame'}: recovery jump is not elapsed zoom movement`);
            for (let frame = 1; frame <= 60; frame++) {
                const result = sample(h, 12, wallMs + 5000 + frame * 1000 / 120, 1, {endTime: 12});
                sameReturn(result.state, recovered.state, 'subsequent end frames remain held');
            }
        }
    });

    test(`${preset}: a held clock still allows immediate outward visibility protection`, () => {
        const h = camera(preset);
        warm(h);
        const {results, wallMs} = stale(h, 1, 4.6);
        const before = results.at(-1);
        const geometry = points(500);
        h.setPoints(geometry);
        const widened = sample(h, 4.6, wallMs + 1000 / 120, 1,
            {position: 4.6, sampledAt: 4600, freshAt: 4600});
        near(widened.time, before.time, 'visibility cannot advance the song clock');
        assert.ok(widened.state.distance > before.state.distance * 1.1,
            'new wide geometry receives necessary room even during a hold');
        for (const point of geometry)
            assert.ok(h.viewFits(point, widened.state), 'held clock cannot suppress visible-note protection');
        h.setPoints(points(30));
        for (let frame = 2; frame <= 120; frame++) {
            const held = sample(h, 4.6, wallMs + frame * 1000 / 120, 1,
                {position: 4.6, sampledAt: 4600, freshAt: 4600});
            near(held.state.distance, widened.state.distance,
                'newly widened view waits for song time before recovering inward');
        }
    });

    test(`${preset}: missing animation timestamps retain normal wall-clock fallback`, () => {
        const normal = camera(preset), fallback = camera(preset);
        warm(normal); warm(fallback, 1, 4.6, false);
        for (let frame = 1; frame <= 240; frame++) {
            const time = 4.6 + frame / 120;
            const expected = sample(normal, time, time * 1000);
            const actual = sample(fallback, time, time * 1000, 1, {}, false);
            near(actual.time, expected.time, 'fresh data advances without RAF timestamp');
            sameReturn(actual.state, expected.state, 'missing optional timestamp is not a deliberate hold');
        }
    });

    test(`${preset}: pause during inward recovery holds position and phase before a smooth resume`, () => {
        const h = camera(preset);
        const before = warm(h);
        for (let frame = 1; frame <= 120; frame++) {
            const result = sample(h, 4.6, 4600 + frame * 1000 / 120, 1, {state: 'paused'});
            near(result.state.distance, before.state.distance, 'pause holds inward distance');
            near(result.state.quietZoomTime, before.state.quietZoomTime, 'pause holds return phase');
        }
        const resumed = sample(h, 4.6, 5600);
        near(resumed.state.distance, before.state.distance, 'zero-time resume preserves the held pose');
        let settled;
        for (let frame = 1; frame <= 240; frame++)
            settled = sample(h, 4.6 + frame / 120, 5600 + frame * 1000 / 120);
        near(settled.state.distance, settled.state.targetDistance, 'pause does not prevent finite completion');
    });

    test(`${preset}: disabled zoom remains fixed through stale hold, fresh recovery and pause`, () => {
        const h = camera(preset, 1, false);
        const initial = warm(h);
        const {results, wallMs} = stale(h, 1, 4.6);
        for (const result of results) near(result.state.distance, initial.state.distance, 'zoom off stays fixed');
        const time = results.at(-1).time;
        for (let frame = 1; frame <= 60; frame++) {
            const result = sample(h, time, wallMs + frame * 1000 / 120, 1, {state: 'paused'});
            near(result.state.distance, initial.state.distance, 'pause preserves disabled zoom');
        }
        for (let frame = 61; frame <= 180; frame++) {
            const result = sample(h, time + (frame - 60) / 120, wallMs + frame * 1000 / 120);
            near(result.state.distance, initial.state.distance, 'fresh playback preserves disabled zoom');
        }
    });
}

test('stale hold does not spend the quiet waiting period before an inward return', () => {
    const h = camera('straight');
    warm(h, 1, 4.05);
    const {results} = stale(h, 1, 4.05);
    const held = results[30];
    assert.ok(held.state.quietZoomTime > 0 && held.state.quietZoomTime < .5,
        'the source must stop during the quiet waiting period');
    for (const result of results.slice(31)) sameReturn(result.state, held.state, 'quiet wait freezes too');
});
