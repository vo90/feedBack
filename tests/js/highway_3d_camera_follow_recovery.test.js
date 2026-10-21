const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, harness } = require('../helpers/highway_camera_harness.cjs');

const presets = ['straight', 'angled'];
const modes = ['reach-centres', 'latest-destination'];
const rates = [.1, .5, 1, 2, 4];
const near = (actual, expected, label = '', tolerance = 1e-7) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
const velocity = state => state.planVelocity + state.rejoinVelocity;
const timeline = [
    { time: 0, minX: 0, maxX: 40 },
    { time: 10, minX: 200, maxX: 240 },
];

function advance(h, from, to, rate, inspect = () => {}) {
    const steps = Math.max(1, Math.ceil((to - from) / rate * 120));
    let state, previous = from;
    for (let i = 1; i <= steps; i++) {
        const time = from + (to - from) * i / steps;
        state = h.frame(time, (time - previous) / rate);
        inspect(state, time);
        previous = time;
    }
    return state;
}

function heldCamera(preset, movementMode, rate, resumeAt, rows = timeline) {
    const h = harness();
    h.settings({ preset, movementMode, rate, startBeforeMs: 400, arriveAfterMs: 50,
        excursionThreshold: 0, autoZoom: false });
    h.setRegionTimeline(rows);
    h.frame(9.5, 0);
    h.settings({ follow: false });
    h.frame(9.5, 0);
    const held = advance(h, 9.5, resumeAt, rate);
    near(held.x, (rows[0].minX + rows[0].maxX) / 2, 'Follow off holds the original lane');
    return { h, held };
}

function assertRejoined(h, state) {
    near(state.x, h.planCache().result.x, 'recovery rejoins the current plan position');
    near(velocity(state), h.planCache().result.velocity, 'recovery rejoins the current plan velocity');
}

for (const preset of presets) for (const movementMode of modes) for (const rate of rates) {
    test(`Follow recovery stays smooth on either side of an arrival: ${preset}, ${movementMode}, ${rate}x`, () => {
        // The 10.05 arrival must not turn an otherwise 700 ms recovery into a
        // full-neck jump merely because Follow is enabled 10 ms earlier.
        for (const resumeAt of [10.04, 10.05, 10.06]) {
            const { h, held } = heldCamera(preset, movementMode, rate, resumeAt);
            h.settings({ follow: true });
            const resumed = h.frame(resumeAt, 0);
            near(resumed.x, held.x, 'Follow resumes at its held position');
            near(velocity(resumed), 0, 'Follow resumes from rest');
            const nextTime = resumeAt + rate / 60;
            const next = h.frame(nextTime, 1 / 60);
            assert.ok(Math.abs(next.x - resumed.x) < 2,
                `first 60 Hz frame must not jump across the neck: ${resumed.x} -> ${next.x}`);
            let previousX = next.x;
            const settled = advance(h, nextTime, resumeAt + .71 * rate, rate, state => {
                assert.ok(Number.isFinite(state.x) && Number.isFinite(velocity(state)));
                assert.ok(Math.abs(state.x - previousX) < 12,
                    `recovery must travel over multiple frames: ${previousX} -> ${state.x}`);
                previousX = state.x;
            });
            assertRejoined(h, settled);
            near(settled.x, 220, 'recovery reaches the new lane');
        }
    });
}

test('resuming halfway through a forward pan never moves away from the new lane', () => {
    for (const preset of presets) for (const movementMode of modes) for (const rate of rates) {
        const resumeAt = 9.9, { h, held } = heldCamera(preset, movementMode, rate, resumeAt);
        h.settings({ follow: true });
        const resumed = h.frame(resumeAt, 0);
        near(resumed.x, held.x); near(velocity(resumed), 0);
        let previousX = resumed.x;
        const settled = advance(h, resumeAt, resumeAt + .71 * rate, rate, state => {
            assert.ok(state.x >= previousX - 1e-7,
                `rejoining a forward-only path must not backtrack: ${previousX} -> ${state.x}`);
            assert.ok(state.x <= 220 + 1e-7, 'recovery does not pass a resting destination');
            previousX = state.x;
        });
        assertRejoined(h, settled);
    }
});

test('speed and timing revisions near the deadline cannot compress an active Follow recovery', () => {
    for (const preset of presets) for (const movementMode of modes) for (const edit of ['speed', 'timing']) {
        const { h } = heldCamera(preset, movementMode, 1, 10.04);
        h.settings({ follow: true }); h.frame(10.04, 0);
        const before = advance(h, 10.04, 10.045, 1);
        const rate = edit === 'speed' ? 2 : 1;
        h.settings(edit === 'speed' ? { rate } : { arriveAfterMs: 60 });
        const changed = h.frame(10.045, 0);
        near(changed.x, before.x, 'live revision preserves recovery position');
        near(velocity(changed), velocity(before), 'live revision preserves actual velocity');
        const nextTime = 10.045 + rate / 60;
        const next = h.frame(nextTime, 1 / 60);
        assert.ok(Math.abs(next.x - changed.x) < 2,
            'a revision must not restore the imminent arrival deadline');
        assertRejoined(h, advance(h, nextTime, 10.045 + .71 * rate, rate));
    }
});

test('Follow resumption retains smooth recovery through resize or enabling Follow while paused', () => {
    for (const preset of presets) for (const movementMode of modes) for (const interruption of ['resize', 'pause']) {
        const resumeAt = 10.04, { h, held } = heldCamera(preset, movementMode, 1, resumeAt);
        if (interruption === 'resize') {
            h.settings({ aspect: 1.2 });
            near(h.frame(resumeAt, 0).x, held.x, 'resize while Follow is disabled preserves its position');
            h.settings({ follow: true });
        } else {
            h.frame(resumeAt, 0, false);
            h.settings({ follow: true });
            for (let frame = 0; frame < 12; frame++) {
                near(h.frame(resumeAt, 1 / 60, false).x, held.x, 'enabling Follow while paused holds the pose');
            }
        }
        const resumed = h.frame(resumeAt, 0, true);
        near(resumed.x, held.x); near(velocity(resumed), 0);
        const next = h.frame(resumeAt + 1 / 60, 1 / 60);
        assert.ok(Math.abs(next.x - resumed.x) < 2, 'intervening lifecycle changes cannot restore a one-frame pan');
        assertRejoined(h, advance(h, resumeAt + 1 / 60, resumeAt + .71, 1));
    }
});

test('Follow recovery rejoins subsequent waypoints instead of keeping an obsolete destination', () => {
    const rows = [...timeline, { time: 10.2, minX: 100, maxX: 140 },
        { time: 10.45, minX: 160, maxX: 200 }, { time: 11.5, minX: 40, maxX: 80 }];
    for (const preset of presets) for (const movementMode of modes) for (const rate of [.5, 1, 2]) {
        const resumeAt = 10.04, { h, held } = heldCamera(preset, movementMode, rate, resumeAt, rows);
        h.settings({ follow: true });
        const resumed = h.frame(resumeAt, 0);
        near(resumed.x, held.x); near(velocity(resumed), 0);
        let previousX = resumed.x;
        const settled = advance(h, resumeAt, resumeAt + .71 * rate, rate, state => {
            assert.ok(Math.abs(state.x - previousX) < 25, 'a later waypoint must not cause a positional jump');
            previousX = state.x;
        });
        assertRejoined(h, settled);
        const end = advance(h, resumeAt + .71 * rate, 12, rate);
        near(end.x, 60, 'later ordinary destination remains active');
    }
});

test('repeated Follow toggles start from each held pose and still finish locally', () => {
    for (const preset of presets) for (const movementMode of modes) {
        const { h } = heldCamera(preset, movementMode, 1, 10.04);
        let time = 10.04;
        for (let toggle = 0; toggle < 3; toggle++) {
            const held = h.frame(time, 0);
            h.settings({ follow: true });
            const resumed = h.frame(time, 0);
            near(resumed.x, held.x); near(velocity(resumed), 0);
            const moving = advance(h, time, time + .1, 1);
            time += .1;
            h.settings({ follow: false });
            const off = h.frame(time, 0);
            near(off.x, moving.x);
            const waiting = advance(h, time, time + .04, 1);
            near(waiting.x, off.x, 'disabled Follow holds an interrupted recovery');
            time += .04;
        }
        h.settings({ follow: true }); h.frame(time, 0);
        assertRejoined(h, advance(h, time, time + .71, 1));
    }
});

test('pausing and changing speed during Follow recovery preserve the actual pose', () => {
    for (const preset of presets) for (const movementMode of modes) {
        const { h } = heldCamera(preset, movementMode, 1, 10.04);
        h.settings({ follow: true }); h.frame(10.04, 0);
        const beforePause = advance(h, 10.04, 10.14, 1);
        for (let frame = 0; frame < 30; frame++) {
            const paused = h.frame(10.14, 1 / 60, false);
            near(paused.x, beforePause.x, 'pause freezes an active recovery');
        }
        const resumed = h.frame(10.14, 0, true);
        near(resumed.x, beforePause.x); near(velocity(resumed), 0, 'pause resumes from rest');
        let rate = 1, time = 10.24, state = advance(h, 10.14, time, rate);
        for (const nextRate of [.5, 2, 1]) {
            const before = state;
            h.settings({ rate: nextRate });
            state = h.frame(time, 0);
            near(state.x, before.x, 'speed edit preserves recovery position');
            near(velocity(state), velocity(before), 'speed edit preserves actual real-time velocity');
            rate = nextRate;
            state = advance(h, time, time + .04 * rate, rate);
            time += .04 * rate;
        }
        assertRejoined(h, advance(h, time, time + .71 * rate, rate));
    }
});

test('seek and loop wrap discard Follow recovery and frame the new song position', () => {
    for (const preset of presets) for (const movementMode of modes) for (const destination of [2, 12]) {
        const { h } = heldCamera(preset, movementMode, 1, 10.04);
        h.settings({ follow: true }); h.frame(10.04, 0);
        advance(h, 10.04, 10.14, 1);
        const sought = h.frame(destination, 1 / 60);
        const fresh = harness();
        fresh.settings({ preset, movementMode, rate: 1, startBeforeMs: 400, arriveAfterMs: 50,
            excursionThreshold: 0, autoZoom: false });
        fresh.setRegionTimeline(timeline);
        const expected = fresh.frame(destination, 0);
        near(sought.x, expected.x, 'a seek starts at the newly selected position');
        assertRejoined(h, advance(h, destination, destination + .1, 1));
    }
});

test('Follow recovery visibility preview follows its actual moving path and keeps near geometry visible', () => {
    const instrumented = source
        .replace('const futurePlanX = future.x;',
            'const futurePlanX = future.x; _stableCam.previewNominalVelocity = future.velocity;')
        .replace('const panDistance = stableSolve(futureX,',
            '_stableCam.previewX = futureX; _stableCam.previewTime = futureTime;\n'
            + '                _stableCam.previewVelocity = _stableCam.previewNominalVelocity + future.velocity;\n'
            + '                const panDistance = stableSolve(futureX,');
    assert.notEqual(instrumented, source);
    const points = [[0, 11, 0], [0, 34, 0], [240, 11, 0], [240, 34, 0]];
    const rows = [...timeline, { time: 10.3, minX: 100, maxX: 140 },
        { time: 12, minX: 40, maxX: 80 }];
    for (const preset of presets) for (const movementMode of modes) {
        const h = harness(instrumented);
        h.settings({ preset, movementMode, rate: 1, startBeforeMs: 400, arriveAfterMs: 50,
            excursionThreshold: 0, autoZoom: true });
        h.setPoints(points); h.setRegionTimeline(rows); h.frame(9.5, 0);
        h.settings({ follow: false }); h.frame(9.5, 0);
        advance(h, 9.5, 10.04, 1);
        h.settings({ follow: true });
        let state = h.frame(10.04, 0), time = 10.04;
        for (const expectedPreviewTime of [10.3, 10.7]) {
            const preview = { x: state.previewX, velocity: state.previewVelocity, time: state.previewTime };
            near(preview.time, expectedPreviewTime, 'preview stops at the next lane, then uses its full horizon');
            assert.ok(Math.abs(preview.x - state.x) > 1, 'fixture must exercise movement during the preview');
            state = advance(h, time, preview.time, 1, frame => {
                for (const point of points) assert.ok(h.viewFits(point, frame),
                    'near geometry remains visible while the held camera rejoins');
            });
            near(state.x, preview.x, 'predicted recovery position matches later playback');
            near(velocity(state), preview.velocity, 'predicted recovery velocity matches later playback');
            time = preview.time;
        }
    }
});

test('reverse Follow recovery remains monotone and reuses all chart and motion caches', () => {
    const rows = [{ time: 0, minX: 200, maxX: 240 }, { time: 10, minX: 0, maxX: 40 }];
    for (const preset of presets) for (const movementMode of modes) for (const rate of [.1, 1, 4]) {
        for (const resumeAt of [9.9, 10.04, 10.06]) {
            const { h, held } = heldCamera(preset, movementMode, rate, resumeAt, rows);
            const cache = h.planCache();
            const references = { cameraEvidence: cache.cameraEvidence, tappingAreas: cache.tappingAreas,
                semanticStops: cache.semanticStops, stops: cache.stops, motion: cache.motion };
            const revision = cache.motionRevision;
            const assertCached = () => {
                for (const [key, value] of Object.entries(references)) {
                    assert.ok(value, `${key} is already built before Follow resumes`);
                    assert.equal(h.planCache()[key], value, `${key} must be reused during Follow recovery`);
                }
                assert.equal(h.planCache().motionRevision, revision, 'recovery does not revise the cached trajectory');
            };
            h.settings({ follow: true });
            const resumed = h.frame(resumeAt, 0);
            near(resumed.x, held.x); near(velocity(resumed), 0); assertCached();
            let previousX = resumed.x;
            const settled = advance(h, resumeAt, resumeAt + .71 * rate, rate, state => {
                assert.ok(state.x <= previousX + 1e-7,
                    `rejoining a descending path must not backtrack: ${previousX} -> ${state.x}`);
                assert.ok(state.x >= 20 - 1e-7, 'recovery does not pass the resting destination');
                previousX = state.x; assertCached();
            });
            assertRejoined(h, settled);
        }
    }
});

test('Follow retains an interrupted direct destination but later edits cannot compress its recovery', () => {
    for (const preset of presets) for (const movementMode of modes) for (const edit of ['speed', 'timing'])
        for (const resumeAt of [1.3, 1.301, 1.4]) {
        const h = harness();
        h.settings({ preset, movementMode, rate: 2, startBeforeMs: 1100, arriveAfterMs: 0,
            excursionThreshold: 0, autoZoom: false });
        h.setRegionTimeline([{ time: 0, minX: 20, maxX: 60 }, { time: 2, minX: 100, maxX: 140 }]);
        h.frame(0, 0); advance(h, 0, 1.1, 2);
        h.settings({ rate: 1, startBeforeMs: 250 }); h.frame(1.1, 0);
        const beforeHold = advance(h, 1.1, 1.2, 1);
        assert.ok(velocity(beforeHold) > 0 && beforeHold.x > h.planCache().result.x,
            'fixture needs an actual moving camera ahead of its newly delayed nominal path');
        assert.equal(h.planCache().result.moving, false);
        h.settings({ follow: false }); h.frame(1.2, 0);
        const held = advance(h, 1.2, resumeAt, 1);
        near(held.x, beforeHold.x);
        h.settings({ follow: true });
        const resumed = h.frame(resumeAt, 0);
        near(resumed.x, held.x); near(velocity(resumed), 0);
        let previousX = resumed.x;
        const beforeEdit = advance(h, resumeAt, 1.99, 1, state => {
            assert.ok(state.x >= previousX - 1e-7, 'the interrupted direct destination must not cause backtracking');
            assert.ok(state.x <= 120 + 1e-7, 'the retained destination must not be overshot');
            previousX = state.x;
        });
        assert.ok(velocity(beforeEdit) > 1e-5, 'the direct recovery is still moving just before arrival');
        const rate = edit === 'speed' ? 2 : 1;
        h.settings(edit === 'speed' ? { rate } : { arriveAfterMs: 25 });
        const changed = h.frame(1.99, 0);
        near(changed.x, beforeEdit.x, 'late revision preserves actual position');
        near(velocity(changed), velocity(beforeEdit), 'late revision preserves real velocity');
        const nextTime = 1.99 + rate / 60, next = h.frame(nextTime, 1 / 60);
        assert.ok(Math.abs(next.x - changed.x) < 1, 'a late revision cannot jump the camera');
        assert.ok(next.x >= changed.x - 1e-7 && next.x <= 120 + 1e-7,
            'a camera already near arrival may brake early, but must not reverse or overshoot');
        previousX = next.x;
        const settled = advance(h, nextTime, 1.99 + .71 * rate, rate, state => {
            assert.ok(state.x >= previousX - 1e-7, 'late revisions must not introduce artificial backtracking');
            assert.ok(state.x <= 120 + 1e-7, 'late revisions must not overshoot the resting destination');
            previousX = state.x;
        });
        assertRejoined(h, settled); near(settled.x, 120);
    }
});

test('an upcoming movement inside recovery prevents holding an obsolete interrupted destination', () => {
    for (const preset of presets) for (const movementMode of modes) {
        const h = harness();
        const rows = [{ time: 0, minX: 20, maxX: 60 }, { time: 2, minX: 100, maxX: 140 }];
        h.settings({ preset, movementMode, rate: 2, startBeforeMs: 1100, arriveAfterMs: 0,
            excursionThreshold: 0, autoZoom: false });
        h.setRegionTimeline(rows); h.frame(0, 0); advance(h, 0, 1.1, 2);
        h.settings({ rate: 1, startBeforeMs: 250 }); h.frame(1.1, 0);
        const beforeHold = advance(h, 1.1, 1.2, 1);
        assert.ok(velocity(beforeHold) > 0 && beforeHold.x > h.planCache().result.x);
        h.settings({ follow: false }); h.frame(1.2, 0);
        // Add a later movement while Follow is off. It starts at 2.05,
        // before the 1.4 resumption's 700 ms recovery is complete.
        h.setRegionTimeline([...rows, { time: 2.3, minX: 200, maxX: 240 }]);
        h.frame(1.2, 0);
        const held = advance(h, 1.2, 1.4, 1);
        h.settings({ follow: true });
        const resumed = h.frame(1.4, 0);
        near(resumed.x, held.x); near(velocity(resumed), 0);
        const before = advance(h, 1.4, 2.1 - 1e-6, 1);
        const at = h.frame(2.1, 1e-6), after = h.frame(2.1 + 1e-6, 1e-6);
        near(before.x, at.x, 'rejoining a newer movement has no position jump', 1e-3);
        near(at.x, after.x, 'recovery end has no delayed positional jump', 1e-3);
        near(velocity(before), velocity(at), 'recovery end preserves velocity', .01);
        near(velocity(at), velocity(after), 'ordinary movement continues with the same velocity', .01);
        const joined = advance(h, 2.1 + 1e-6, 2.11, 1);
        assertRejoined(h, joined);
        assert.ok(joined.x > 120 && velocity(joined) > 0,
            'the current plan already advances toward the subsequent lane');
        near(advance(h, 2.11, 2.4, 1).x, 220, 'the subsequent destination remains on schedule');
    }
});

test('slowing playback during a pending Follow recovery brakes without passing the destination', () => {
    for (const preset of presets) for (const movementMode of modes) for (const editAt of [1.8, 1.9]) {
        const h = harness();
        h.settings({ preset, movementMode, rate: 2, startBeforeMs: 1100, arriveAfterMs: 0,
            excursionThreshold: 0, autoZoom: false });
        h.setRegionTimeline([{ time: 0, minX: 20, maxX: 60 }, { time: 2, minX: 100, maxX: 140 }]);
        h.frame(0, 0); advance(h, 0, 1.1, 2);
        h.settings({ rate: 1, startBeforeMs: 250 }); h.frame(1.1, 0);
        advance(h, 1.1, 1.2, 1);
        h.settings({ follow: false }); h.frame(1.2, 0);
        advance(h, 1.2, 1.301, 1);
        h.settings({ follow: true }); h.frame(1.301, 0);
        const before = advance(h, 1.301, editAt, 1);
        assert.ok(velocity(before) > 0 && before.x < 120, 'fixture is travelling toward a resting destination');
        h.settings({ rate: .5 });
        const changed = h.frame(editAt, 0);
        near(changed.x, before.x, 'slowdown preserves actual position');
        near(velocity(changed), velocity(before), 'slowdown preserves actual real-time velocity');
        let previousX = changed.x;
        const settled = advance(h, editAt, editAt + .71 * .5, .5, state => {
            assert.ok(state.x >= previousX - 1e-7, 'braking cannot reverse away from the destination');
            assert.ok(state.x <= 120 + 1e-7, 'existing momentum must not overshoot the resting destination');
            assert.ok(velocity(state) >= -1e-7, 'braking and holding keep nonnegative velocity');
            previousX = state.x;
        });
        assertRejoined(h, settled); near(settled.x, 120);
    }
});
