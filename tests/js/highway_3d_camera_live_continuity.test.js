const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, harness } = require('../helpers/highway_camera_harness.cjs');

const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8,
    `${message}: expected ${expected}, got ${actual}`);
const velocity = state => state.planVelocity + state.rejoinVelocity;
const rows = [[0, 1], [4, 9], [4.6, 10], [5.8, 11], [6.4, 12], [7.6, 13],
    [8.2, 14], [9.4, 15], [10, 16], [11.2, 17]]
    .map(([time, fret]) => ({ time, minX: (fret - 1) * 10, maxX: (fret + 3) * 10 }));

function controller(threshold = 500, rate = 1, preset = 'straight', timeline = rows) {
    const h = harness();
    h.settings({ excursionThreshold: threshold, rate, preset });
    h.setRegionTimeline(timeline); h.frame(0, 0);
    return h;
}
function advance(h, from, to, rate = 1) {
    const steps = Math.max(1, Math.ceil((to - from) / rate * 120));
    let state, previous = from;
    for (let i = 1; i <= steps; i++) {
        const time = from + (to - from) * i / steps;
        state = h.frame(time, (time - previous) / rate); previous = time;
    }
    return state;
}
function assertContinuous(before, after) {
    near(after.x, before.x, 'live edit preserves actual position');
    near(velocity(after), velocity(before), 'live edit preserves actual velocity');
}
function assertRejoined(h, state) {
    near(state.x, h.planCache().result.x, 'local handoff rejoins the current trajectory');
    near(velocity(state), h.planCache().result.velocity, 'local handoff restores trajectory velocity');
}

test('threshold edits within a long transit run rejoin locally instead of skipping to the final lane', () => {
    for (const preset of ['straight', 'angled']) for (const rate of [.5, 1, 2]) {
        for (const [beforeThreshold, afterThreshold, time] of [[500, 1000, 4.2], [500, 3000, 4.2],
            [1000, 3000, 5.1], [3000, 1000, 4.2], [3000, 500, 4.2]]) {
            const h = controller(beforeThreshold, rate, preset), before = advance(h, 0, time, rate);
            h.settings({ excursionThreshold: afterThreshold });
            const changed = h.frame(time, 0);
            assertContinuous(before, changed);
            const plan = h.planCache().result;
            if (plan.transit) {
                assert.ok(changed.resumeUntil <= time, 'a transit chain must not get a final-destination resume');
                assert.ok(changed.rejoinEnd <= time + .7 * rate + 1e-8);
            }
            const settledTime = Math.max(time + .71 * rate,
                Number.isFinite(changed.resumeUntil) ? changed.resumeUntil + .01 * rate : time);
            const state = advance(h, time, settledTime, rate);
            assertRejoined(h, state);
            assert.ok(state.x < 180, 'intermediate lanes remain on the path before the final destination');
        }
    }
});

test('rapid threshold edits preserve pose and converge after the last edit without seeking', () => {
    const h = controller(); let time = 4.2, state = advance(h, 0, time);
    for (const threshold of [3000, 1000, 500, 3000, 1000, 3000]) {
        const before = state;
        h.settings({ excursionThreshold: threshold }); state = h.frame(time, 0);
        assertContinuous(before, state);
        state = advance(h, time, time + .04); time += .04;
    }
    state = advance(h, time, time + .71);
    assertRejoined(h, state);
    const atWaypoint = advance(h, time + .71, 6.4);
    near(atWaypoint.x, 130, 'later waypoint is reached without a loop reset');
});

test('live per-lane threshold changes settle repeated riffs at both presets and every playback speed', () => {
    const timeline=[{time:0,minX:40,maxX:80}];
    for (let i=0;i<64;i++) {
        const fret=[8,7,4,5][i%4];
        timeline.push({time:4+i*.3,minX:(fret-1)*10,maxX:(fret+3)*10});
    }
    timeline.push({time:24,minX:150,maxX:190});
    for (const preset of ['straight','angled']) for (const rate of [.5,1,2]) {
        const h=controller(250,rate,preset,timeline);
        let time=4.15,state=advance(h,0,time,rate);
        for (const threshold of [500,900,350,250,500,1000,3000]) {
            const before=state;
            h.settings({excursionThreshold:threshold});state=h.frame(time,0);
            assertContinuous(before,state);
            state=advance(h,time,time+.71*rate,rate);time+=.71*rate;
            assertRejoined(h,state);
            if (threshold>300) {
                near(state.x,60,`held riff at ${threshold}ms/${rate}x/${preset}`);
                near(velocity(state),0,'the effective home remains still');
            } else {
                assert.ok(h.planCache().stops.some(s=>s.x!==60&&s.time<23),
                    'lowering below individual lane duration must restore the riff movements');
            }
            state=advance(h,time,time+.1*rate,rate);time+=.1*rate;
        }
    }
});

test('an edit that removes the current move rejoins the held lane instead of departing for a far future move', () => {
    const timeline = [[0, 1], [4, 9], [4.6, 1], [10, 17]]
        .map(([time, fret]) => ({ time, minX: (fret - 1) * 10, maxX: (fret + 3) * 10 }));
    for (const threshold of [1000, 3000]) {
        const h = controller(500, 1, 'straight', timeline), before = advance(h, 0, 3.7);
        h.settings({ excursionThreshold: threshold });
        const changed = h.frame(3.7, 0);
        assertContinuous(before, changed);
        assert.equal(h.planCache().result.moving, false);
        assert.ok(changed.resumeUntil <= 3.7, 'an upcoming direct move is not the current resume destination');
        const state = advance(h, 3.7, 4.41);
        assertRejoined(h, state); near(state.x, 20);
    }
});

test('a future-path revision cancels an active direct resume even when the current nominal sample is unchanged', () => {
    const timeline = [[0, 1], [2, 9]]
        .map(([time, fret]) => ({ time, minX: (fret - 1) * 10, maxX: (fret + 3) * 10 }));
    const h = controller(500, 2, 'straight', timeline);
    // A rate change creates actual resume motion while the slower nominal
    // path still rests. New future waypoints then change the path without
    // changing that resting sample. Reach mode groups all overlapping moves,
    // so changing only the short-lane threshold no longer creates this case.
    h.settings({ startBeforeMs: 1100 });
    advance(h, 0, .5, 2);
    h.settings({ rate: 1 }); h.frame(.5, 0);
    const before = advance(h, .5, .6), nominal = { ...h.planCache().result };
    assert.ok(before.resumeUntil > 1.31, 'fixture starts with a longer direct resume');
    assert.ok(velocity(before)>0,'fixture is moving despite a resting nominal sample');
    h.setRegionTimeline([...timeline, {time:2.6,minX:120,maxX:160},{time:3.2,minX:160,maxX:200}]);
    const changed = h.frame(.6, 0), plan = h.planCache().result;
    near(plan.x, nominal.x); near(plan.velocity, nominal.velocity);
    assert.equal(plan.transit, true);
    assertContinuous(before, changed);
    assert.ok(changed.resumeUntil <= .6, 'future waypoints supersede the old direct resume');
    assertRejoined(h, advance(h, .6, 1.31));
});

test('equivalent metadata rebuilds cannot keep restarting a finite local handoff', () => {
    const timeline = [[0, 1], [4, 9], [4.6, 1], [10, 17]]
        .map(([time, fret]) => ({ time, minX: (fret - 1) * 10, maxX: (fret + 3) * 10 }));
    const h = controller(500, 1, 'straight', timeline); advance(h, 0, 3.7);
    h.settings({ excursionThreshold: 1000 }); const initial = h.frame(3.7, 0);
    const revision = h.planCache().result.motionRevision;
    let state;
    for (let i = 1; i <= 80; i++) {
        h.setRegionTimeline([...timeline, {time: i / 1000, minX: 0, maxX: 40}].sort((a, b) => a.time - b.time));
        state = h.frame(3.7 + i / 100, .01);
        assert.equal(h.planCache().result.motionRevision, revision, 'equivalent trajectory keeps its revision');
        assert.equal(state.rejoinEnd, initial.rejoinEnd, 'metadata does not extend the local handoff');
    }
    assertRejoined(h, state); near(state.x, 20);
});

test('visibility preview evaluates the actual local handoff and keeps nearby geometry in view', () => {
    const instrumented = source.replace('const panDistance = stableSolve(futureX,',
        '_stableCam.previewX = futureX;\n                const panDistance = stableSolve(futureX,');
    assert.notEqual(instrumented, source);
    const points = [[0, 11, 0], [0, 34, 0], [240, 11, 0], [240, 34, 0]];
    for (const preset of ['straight', 'angled']) {
        const h = harness(instrumented);
        h.settings({ excursionThreshold: 500, rate: 1, preset }); h.setPoints(points);
        h.setRegionTimeline([{time: 0, minX: 0, maxX: 40}, {time: 4, minX: 80, maxX: 120},
            {time: 4.6, minX: 0, maxX: 40}, {time: 10, minX: 160, maxX: 200}]);
        h.frame(0, 0); advance(h, 0, 3.7);
        h.settings({ excursionThreshold: 1000 });
        const changed = h.frame(3.7, 0), preview = changed.previewX;
        assert.ok(Math.abs(preview - changed.x) > 1, 'fixture requires the offset to evolve during preview');
        let state;
        for (let i = 1; i <= 30; i++) {
            state = h.frame(3.7 + i / 100, .01);
            for (const point of points) assert.ok(h.viewFits(point, state), 'near geometry remains visible during rejoin');
        }
        near(state.x, preview, 'preview matches the camera at its predicted time');
    }
});

test('transit follow and pause resumes use a bounded local handoff at the current playback rate', () => {
    for (const rate of [.5, 1, 2]) for (const hold of ['pause', 'follow']) {
        const h = controller(3000, rate), before = advance(h, 0, 5, rate);
        if (hold === 'follow') h.settings({ follow: false });
        const time = hold === 'follow' ? 5.1 : 5;
        const held = h.frame(time, .1 / rate, hold !== 'pause');
        near(held.x, before.x);
        h.settings({ follow: true });
        const resumed = h.frame(time, 0, true);
        near(resumed.x, held.x);
        near(velocity(resumed), 0, 'a held camera resumes at rest');
        assert.ok(resumed.resumeUntil <= time);
        assertRejoined(h, advance(h, time, time + .71 * rate, rate));
    }
});

test('speed edits during a transit rejoin preserve continuity and finish locally in real time', () => {
    const h = controller(), before = advance(h, 0, 4.2);
    h.settings({ excursionThreshold: 3000 });
    assertContinuous(before, h.frame(4.2, 0));
    let time = 4.3, state = advance(h, 4.2, time);
    for (const rate of [.5, 2, 1]) {
        const previous = state; h.settings({ rate }); state = h.frame(time, 0);
        assertContinuous(previous, state);
        state = advance(h, time, time + .04 * rate, rate); time += .04 * rate;
    }
    assertRejoined(h, advance(h, time, time + .71));
});

test('speed edits during an excursion rejoin cannot start an unrelated distant direct move', () => {
    const timeline = [[0, 5], [4, 13], [4.6, 5], [12, 2]]
        .map(([time, fret]) => ({ time, minX: (fret - 1) * 10, maxX: (fret + 3) * 10 }));
    for (const preset of ['straight', 'angled']) for (const [beforeRate, afterRate] of [[.5, 2], [2, .5], [1, 2]]) {
        const h = controller(500, beforeRate, preset, timeline);
        const time = 4 - .3 * beforeRate;
        advance(h, 0, time, beforeRate);
        h.settings({ excursionThreshold: 1000 }); h.frame(time, 0);
        const changedAt = time + .15 * beforeRate, before = advance(h, time, changedAt, beforeRate);
        assert.equal(before.planMoving, false, 'nominal lane is already held during the local correction');
        assert.ok(Math.abs(velocity(before)) > 1e-6, 'the actual camera is still rejoining');
        h.settings({ rate: afterRate }); const changed = h.frame(changedAt, 0);
        assertContinuous(before, changed);
        assert.ok(changed.resumeUntil <= changedAt, 'velocity from a local correction cannot claim the future direct destination');
        const settled = advance(h, changedAt, changedAt + .71 * afterRate, afterRate);
        assertRejoined(h, settled); near(settled.x, 60);
    }
});

test('loop wrap and explicit seek clear an active local correction and match a fresh camera at the same settings', () => {
    for (const target of [1, 7]) {
        const h = controller(); advance(h, 0, 4.2);
        h.settings({ excursionThreshold: 3000 }); h.frame(4.2, 0);
        advance(h, 4.2, 4.25);
        const sought = h.frame(target, .01);
        const fresh = controller(3000).frame(target, .01);
        near(sought.x, fresh.x); near(sought.distance, fresh.distance);
        assert.equal(sought.resumeUntil, -Infinity);
        assert.equal(sought.rejoinEnd, -Infinity);
    }
});
