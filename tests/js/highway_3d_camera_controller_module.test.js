const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');
const { createCameraController } = require('../../plugins/highway_3d/src/camera-controller.mjs');

const motion = createCameraMotion({
    isRenderableNote: note => Number.isFinite(note.f),
    isUnpitchedMute: note => !!note.unpitched,
});
const close = (actual, expected, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const state = overrides => ({
    x: 2, following: true,
    planRevision: 1, planMotionRevision: 1, planTime: .9, planX: 1,
    planVelocity: 3, planMoving: true, planTransit: false,
    planArrivalTime: 2, planArrivalX: 8, planArrivalLaneTime: 2,
    rejoinOffset: 0, rejoinVelocity: 0, rejoinEnd: -Infinity, resumeUntil: -Infinity,
    ...overrides,
});
const plan = overrides => ({
    valid: true, x: 3, velocity: 4, moving: true, transit: false,
    revision: 2, motionRevision: 2,
    arrivalTime: 2.3, arrivalX: 8, arrivalLaneTime: 2,
    ...overrides,
});
function controller(samplePlan = (_time, out) => Object.assign(out, { x: 0, velocity: 0 })) {
    return createCameraController({ samplePlan, ...motion });
}
function remember(s, p, now) {
    s.planRevision = p.revision;
    s.planMotionRevision = p.motionRevision;
    s.planTime = now;
    s.planX = p.x;
    s.planVelocity = p.velocity;
    s.planMoving = p.moving;
    s.planTransit = p.transit;
    s.planArrivalTime = p.arrivalTime;
    s.planArrivalX = p.arrivalX;
    s.planArrivalLaneTime = p.arrivalLaneTime;
    s.following = true;
}

// Captured against dd9ed24's live lateral block, before moving it into this
// module. The trace includes direct and multi-waypoint journeys, rate/timing
// revisions during travel, Follow resumption and paused song time.
function lifecycleTrace(makeController, api) {
    const values = [];
    for (const initialRate of [.5, 1, 2]) {
        for (const transit of [false, true]) {
            const stops = [[0, 0], [2, 8], [4, 2], [4.3, 5], [4.6, 9], [6, 1], [8, 7], [12, 0]]
                .map(([time, x], index) => ({
                    time, x, minX: x - 2, maxX: x + 2, lead: .6,
                    lasting: !(transit && (index === 2 || index === 3)),
                }));
            let rate = initialRate, delay = 0, extra = 0, revision = 1, now = .1;
            const samplePlan = (time, out) => api.hwyCameraPlanAt(stops, time, rate, .5, out, delay, extra, 500);
            const live = makeController({ samplePlan, ...api });
            const s = state({ x: 0, following: false, planVelocity: 0, planRevision: 0 });
            const p = {};
            for (let frame = 0; frame < 640; frame++) {
                if (frame === 70) { rate = initialRate * .5; revision++; }
                if (frame === 140) { delay = 1000; extra = 100; revision++; }
                if (frame === 200) { rate = 2; revision++; }
                if (frame === 260) { delay = 350; revision++; }
                if (frame === 320) { delay = extra = 0; revision++; }
                samplePlan(now, p);
                p.revision = p.motionRevision = revision;
                const off = frame >= 360 && frame < 390;
                const paused = frame >= 450 && frame < 470;
                if (!off && !paused) {
                    live.update(s, p, now, rate, 0);
                    remember(s, p, now);
                } else s.following = false;
                values.push(s.x, s.targetX, s.rejoinOffset, s.rejoinVelocity,
                    s.rejoinStart, s.rejoinEnd, s.resumeStart, s.resumeEnd, s.resumeUntil,
                    s.resumeFrom, s.resumeTarget, s.resumeVelocity);
                if (!paused) now += rate / 60;
            }
        }
    }
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

test('controller extraction preserves the frozen live lifecycle trajectories', () => {
    assert.equal(lifecycleTrace(createCameraController, motion), '5a534388e19d2d427e6c7930cda91dfe72466977baaea2d92ae75473e09b84f3');
});

test('direct resumption starts at the actual pose and velocity', () => {
    const s = state(), p = plan(), live = controller();
    assert.equal(live.update(s, p, 1, 1, 0), s);
    close(s.x, 2);
    close(p.velocity + s.rejoinVelocity, 3);
    assert.equal(s.motionMode, 'direct-resume');
    close(s.resumeUntil, 2.3);
    assert.equal(s.motionDiagnostics.actualX, s.x);
    assert.equal(s.motionDiagnostics.actualVelocity, 3);
});

test('progressive journeys use local rejoining without replacing intermediate waypoints', () => {
    const s = state({ planTransit: true }), p = plan({ transit: true }), live = controller();
    live.update(s, p, 1, 1, 0);
    assert.equal(s.motionMode, 'local-rejoin');
    assert.equal(s.resumeUntil, -Infinity);
    close(s.x, 2);
    close(p.velocity + s.rejoinVelocity, 3);
    close(s.rejoinEnd, 1.7);
    remember(s, p, 1);
    p.x = 6; p.velocity = 2;
    live.update(s, p, 1.7, 1, 0);
    assert.equal(s.x, p.x);
    assert.equal(s.rejoinVelocity, 0);
    assert.equal(s.motionMode, 'following');
});

test('a rapid slowdown finishes a direct resume early and holds its arrival', () => {
    const s = state({ x: 6, planVelocity: 20 }), p = plan({ arrivalTime: 4 }), live = controller();
    live.update(s, p, 1, 1, 0);
    close(s.resumeEnd, 1.25);
    close(s.resumeUntil, 4);
    remember(s, p, 1);
    live.update(s, p, 1.3, 1, 0);
    assert.equal(s.motionMode, 'arrival-hold');
    assert.equal(s.x, 8);
    close(s.motionDiagnostics.actualVelocity, 0);
});

test('a held plan rejoins locally instead of chasing its distant next arrival', () => {
    const s = state({ planMoving: false, planVelocity: 0 });
    const p = plan({ moving: false, velocity: 0, arrivalTime: 10 });
    controller().update(s, p, 1, 1, 0);
    assert.equal(s.motionMode, 'local-rejoin');
    assert.equal(s.resumeUntil, -Infinity);
    close(s.rejoinEnd, 1.7);
});

test('removing a tuned settling tail retains its previous direct destination deadline', () => {
    const s = state(), p = plan({ x: 8, arrivalTime: 5, arrivalX: 1, arrivalLaneTime: 5 });
    controller().update(s, p, 1, 1, 0);
    close(s.resumeUntil, 2);
    close(s.resumeTarget, 8);
    close(s.resumeLaneTime, 2);
});

test('revision during an active correction rejoins even when the current plan sample matches', () => {
    const s = state({ rejoinEnd: 1.5, joinRate: 1, rejoinStart: .8,
        rejoinStartOffset: 1, rejoinStartVelocity: 0 });
    const p = plan({ revision: 1, motionRevision: 2, transit: true });
    controller((_time, out) => Object.assign(out, { x: s.planX, velocity: s.planVelocity }))
        .update(s, p, 1, 1, 0);
    close(s.rejoinStart, 1);
    close(s.x, 2);
});

test('ordinary samples allocate no new diagnostics or scratch outputs and do not resample history', () => {
    let historyCalls = 0;
    const outputs = [];
    const live = controller((_time, out) => {
        historyCalls++; outputs.push(out);
        return Object.assign(out, { x: 0, velocity: 0 });
    });
    const s = state(), p = plan();
    live.update(s, p, 1, 1, 0);
    const report = s.motionDiagnostics, scratch = s.rejoinSample;
    remember(s, p, 1);
    for (let frame = 1; frame < 30; frame++) {
        live.update(s, p, 1 + frame / 60, 1, 0);
        assert.equal(s.motionDiagnostics, report);
        assert.equal(s.rejoinSample, scratch);
    }
    assert.equal(historyCalls, 1);
    p.revision++; p.motionRevision++;
    live.update(s, p, 1.5, 1, 0);
    assert.equal(outputs[0], outputs[1]);
});

test('renderer-owned pause and Follow modes report held pose without changing correction state', () => {
    const live = controller(), s = state(), p = plan();
    live.update(s, p, 1, 1, 0);
    const before = [s.x, s.rejoinVelocity, s.resumeEnd, s.resumeUntil];
    const report = s.motionDiagnostics;
    for (const mode of ['paused', 'follow-off', 'seek']) {
        assert.equal(live.setMode(s, mode), s);
        assert.equal(s.motionMode, mode);
        assert.equal(s.motionDiagnostics, report);
        assert.equal(report.actualVelocity, 0);
        assert.deepEqual([s.x, s.rejoinVelocity, s.resumeEnd, s.resumeUntil], before);
    }
});

test('separate renderer controllers own separate history samples and diagnostics', () => {
    const outputs = [];
    const sampler = (_time, out) => {
        outputs.push(out);
        return Object.assign(out, { x: 0, velocity: 0 });
    };
    const left = controller(sampler), right = controller(sampler), a = state(), b = state();
    left.update(a, plan(), 1, 1, 0);
    right.update(b, plan(), 1, 1, 0);
    assert.notEqual(outputs[0], outputs[1]);
    assert.notEqual(a.motionDiagnostics, b.motionDiagnostics);
    assert.notEqual(a.rejoinSample, b.rejoinSample);
});

module.exports = { lifecycleTrace };
