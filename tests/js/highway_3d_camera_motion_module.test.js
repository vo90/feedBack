const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');

const dependencies = {
    isRenderableNote: note => Number.isFinite(note.f) && !note.hidden,
    isUnpitchedMute: note => !!note.unpitched,
};
const motion = createCameraMotion(dependencies);
const stop = (time, x, lasting = true, lead = .6) => ({
    time, x, lasting, lead, minX: x - 2, maxX: x + 2,
});
const close = (actual, expected, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

// These lateral curves were originally captured from dd9ed24 before extraction.
// The lateral-only fingerprint was verified against dc4c037 before changing
// zoom recovery; dynamic zoom has separate regression tests. This still covers
// complete curves, real speed conversion, capped timing and reversals.
function numericalTrace(api) {
    const values = [];
    for (const rate of [.5, 1, 1.75]) {
        for (const smoothing of [0, .5, 1]) {
            for (const delay of [0, 350, 1000]) {
                for (const extra of [0, 10, 200]) {
                    for (const settling of [0, 250, 1500]) {
                        const stops = [
                            stop(0, 0), stop(2, 9, true, 1.2),
                            stop(4, 6, false), stop(4.3, 3, false), stop(4.6, 0),
                            stop(6, 3, false), stop(6.3, 8, false), stop(6.6, 5, false),
                            stop(6.9, 11, false), stop(7.2, 7), stop(9, 8), stop(12, -2),
                        ];
                        const out = {};
                        for (let sample = 0; sample <= 416; sample++) {
                            api.hwyCameraPlanAt(stops, sample / 32, rate, smoothing, out, delay, extra, settling);
                            values.push(out.x, out.velocity, out.arrivalTime, out.arrivalX,
                                out.arrivalLaneTime, out.moving, out.transit);
                        }
                    }
                }
            }
        }
    }
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

test('extracted lateral motion retains the frozen numerical trajectory', () => {
    assert.equal(numericalTrace(motion), 'c30ea1f6b7b03db571bb9a482490176e62f3681ba0cd65420ef6d9929f5258c3');
});

test('journey diagnostics distinguish first-lane lead from complete travel', () => {
    const stops = [stop(0, 0), stop(2, 3, false), stop(2.3, 6, false), stop(2.6, 9)];
    const segments = motion.hwyBuildCameraMotion(stops, 1, .5, 1000, 10, 500);
    assert.equal(segments.journeys.length, 1);
    assert.equal(Object.keys(segments).includes('journeys'), false);
    const journey = segments.journeys[0], timing = journey.timing;
    assert.equal(journey.fromStop, 0);
    assert.equal(journey.toStop, 3);
    assert.equal(timing.firstLaneTime, 2);
    assert.equal(timing.waypointCount, 3);
    close(timing.preparedLeadMs, 700);
    close(timing.nominalDurationMs, 1300);
    close(timing.appliedExtraMs, 130);
    close(timing.appliedDelayMs, 370);
    close(timing.appliedLeadMs, 330);
    close(timing.appliedDurationMs, 1430);
    close(timing.appliedLatenessMs, 500);
    assert.equal(timing.nextJourneyRoomMs, Infinity);
    assert.equal(timing.limitingReason, 'settling-limit');
    assert.ok(segments.every(segment => segment.journey === journey && segment.timing === timing));
});

test('extra travel reserves room before delay, and delay never shortens travel', () => {
    const stops = [stop(0, 0), stop(2, 3), stop(3, 5)];
    let duration = null;
    for (const delay of [0, 100, 500, 1000]) {
        const first = motion.hwyBuildCameraMotion(stops, 1, .5, delay, 100, 1000)[0].timing;
        if (duration !== null) close(first.appliedDurationMs, duration);
        duration = first.appliedDurationMs;
        close(first.appliedDelayMs, 0);
        close(first.appliedExtraMs, 300);
        assert.equal(first.extraLimitingReason, 'next-journey');
        assert.equal(first.delayLimitingReason, delay ? 'extra-travel-budget' : 'none');
        close(first.delayRoomMs, 0);
    }
});

test('tuned waypoints retain their positions and shared velocities', () => {
    const stops = [stop(0, 0), stop(2, 2, false), stop(2.4, 4, false), stop(3, 8)];
    const segments = motion.hwyBuildCameraMotion(stops, .75, .5, 300, 20, 1000);
    const out = {};
    for (let index = 0; index + 1 < segments.length; index++) {
        const left = segments[index], right = segments[index + 1];
        close(left.end, right.start);
        close(left.to, right.from);
        close(left.v1, right.v0);
        motion.hwyCameraSegmentAt(left.from, left.to, left.v0, left.v1,
            left.end - left.start, 1, out);
        close(out.x, right.from);
        close(out.velocity, right.v0);
        const epsilon = 1e-6;
        const a = motion.hwyCameraSegmentAt(left.from, left.to, left.v0, left.v1,
            left.end - left.start, 1 - epsilon, {});
        const b = motion.hwyCameraSegmentAt(right.from, right.to, right.v0, right.v1,
            right.end - right.start, epsilon, {});
        close(a.velocity, b.velocity, 1e-8);
    }
});

test('preparation diagnostics explain quiet windows, large moves and preceding-lane limits', () => {
    const quiet = motion.hwyBuildCameraMotion([stop(0, 0), stop(2, 2, true, 1.2)], 1, .5)[0].timing;
    assert.equal(quiet.preparationReason, 'quiet-passage');
    close(quiet.preparationRequestedMs, 1200);
    close(quiet.preparationAppliedMs, 1200);
    const large = motion.hwyBuildCameraMotion([stop(0, 0), stop(2, 20)], 1, .5)[0].timing;
    assert.equal(large.preparationReason, 'large-move');
    const clipped = motion.hwyBuildCameraMotion([stop(1.9, 0), stop(2, 2)], 1, .5)[0].timing;
    assert.equal(clipped.preparationReason, 'ordinary');
    assert.equal(clipped.preparationLimitReason, 'previous-lane');
    close(clipped.preparationRequestedMs, 700);
    close(clipped.preparationAppliedMs, 100);
});

test('attack preparation respects meaningful techniques and same-string replacement', () => {
    const notes = [
        { t: 0, s: 0, f: 3, sus: 4, vb: true },
        { t: 1, s: 0, f: 5, sus: 2 },
        { t: 2, s: 1, f: 7, sus: 0 },
        { t: 3, s: 6, f: 9, sus: 0 }, // Invalid string.
        { t: 4, s: 1, f: 4, hidden: true },
    ];
    const attacks = motion.hwyBuildCameraAttackIndex(notes, [], 6);
    assert.deepEqual(attacks.map(attack => [attack.time, attack.busy]), [[0, 1], [1, 1], [2, 1]]);
    const prepared = motion.hwyPrepareCameraStops([stop(0, 0), stop(2, 4)], notes, [], 1, 6, attacks);
    close(prepared[1].lead, .7);
    assert.equal(notes[0].sus, 4);
});

test('plan sampling reuses cached journeys and caller output until a timing input changes', () => {
    const stops = [stop(0, 0), stop(2, 5), stop(4, 1)], out = {};
    assert.equal(motion.hwyCameraPlanAt(stops, 1.4, 1, .5, out), out);
    const cached = stops.motion, journeys = cached.journeys, timing = out.timing;
    for (let frame = 0; frame < 100; frame++) {
        assert.equal(motion.hwyCameraPlanAt(stops, 1.4 + frame / 1000, 1, .5, out), out);
        assert.equal(stops.motion, cached);
        assert.equal(stops.motion.journeys, journeys);
        assert.equal(out.timing, timing);
        assert.equal(out.journey, journeys[0]);
    }
    motion.hwyCameraPlanAt(stops, 1.5, 1, .5, out, 100);
    assert.notEqual(stops.motion, cached);
    motion.hwyCameraPlanAt(stops, 100, 1, .5, out, 100);
    assert.equal(out.timing, null);
    assert.equal(out.journey, null);
});

test('empty and rejected-duration plans expose honest empty journey records', () => {
    assert.deepEqual(motion.hwyBuildCameraMotion([], 1, .5).journeys, []);
    assert.deepEqual(motion.hwyBuildCameraMotion([stop(2, 0), stop(2, 4)], 1, .5).journeys, []);
    const out = motion.hwyCameraPlanAt([], 0, 1, .5, {});
    assert.equal(out.valid, false);
    assert.equal(out.x, 0);
    assert.equal(out.journey, null);
});

test('manual preparation sets exact real-time first-lane lead across playback rates', () => {
    for (const rate of [.1, .5, 1, 1.75, 4]) {
        for (const preparationMs of [25, 100, 500, 1000, 3000]) {
            for (const x of [2, 20]) {
                const stops = [stop(0, 0), stop(20, x, true, 1.2)];
                const first = motion.hwyBuildCameraMotion(stops, rate, 1, 0, 0, 250, preparationMs)[0];
                close(first.start, 20 - preparationMs / 1000 * rate);
                close(first.timing.preparedLeadMs, preparationMs);
                close(first.timing.appliedLeadMs, preparationMs);
                close(first.timing.appliedDurationMs, preparationMs);
                assert.equal(first.timing.preparationReason, 'manual');
                assert.equal(first.timing.preparationLimitReason, 'none');
            }
        }
    }
});

test('manual preparation exposes the preceding-lane bound and keeps complete journey retiming', () => {
    const stops = [stop(1.9, 0), stop(2, 3, false), stop(2.3, 5, false), stop(2.6, 7)];
    for (const rate of [.5, 1, 2]) {
        const segments = motion.hwyBuildCameraMotion(stops, rate, .5, 100, 10, 500, 1000);
        const timing = segments[0].timing;
        assert.equal(timing.preparationLimitReason, 'previous-lane');
        close(timing.preparationRequestedMs, 1000);
        close(timing.preparationAppliedMs, 100 / rate);
        close(timing.nominalDurationMs, 700 / rate);
        close(timing.appliedDurationMs, 770 / rate);
        close(timing.appliedLatenessMs, 100 + 70 / rate);
        close(timing.appliedLeadMs, 100 / rate - 100);
        assert.equal(timing.waypointCount, 3);
        for (let index = 0; index + 1 < segments.length; index++) {
            close(segments[index].end, segments[index + 1].start);
            close(segments[index].v1, segments[index + 1].v0);
        }
    }
});

test('manual preparation changes invalidate the cache, normalized equivalents reuse it', () => {
    const stops = [stop(0, 0), stop(4, 9)], out = {};
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out);
    const automatic = stops.motion;
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, undefined);
    assert.equal(stops.motion, automatic);
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, 500);
    assert.notEqual(stops.motion, automatic);
    const manual = stops.motion;
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, '500');
    assert.equal(stops.motion, manual);
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, 0);
    assert.equal(out.timing.preparationRequestedMs, 25);
    const shortest = stops.motion;
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, 10);
    assert.equal(stops.motion, shortest);
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, 9999);
    assert.equal(out.timing.preparationRequestedMs, 3000);
    motion.hwyCameraPlanAt(stops, 1, 1, .5, out, 0, 0, 250, NaN);
    assert.equal(stops.motionPreparationMs, null);
    assert.equal(out.timing.preparationReason, 'large-move');
});

test('manual lead and timing controls have separate monotonic effects within hard budgets', () => {
    const stops = [stop(0, 0), stop(10, 8), stop(11, 2)];
    for (const preparationMs of [25, 100, 500, 1000]) {
        let previousStart = -Infinity, duration = null;
        for (const delay of [0, 100, 500, 1000]) {
            const segments = motion.hwyBuildCameraMotion(stops, 1, .5, delay, 10, 750, preparationMs);
            const timing = segments[0].timing;
            assert.ok(timing.start >= previousStart);
            assert.ok(timing.appliedLatenessMs <= timing.availableRoomMs + 1e-9);
            assert.ok(timing.end <= segments[1].nominalStart + 1e-9);
            if (duration !== null) close(timing.appliedDurationMs, duration);
            duration = timing.appliedDurationMs;
            previousStart = timing.start;
        }
    }
});

module.exports = { numericalTrace, dependencies, stop };
