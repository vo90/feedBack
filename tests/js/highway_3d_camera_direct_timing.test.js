const test = require('node:test');
const assert = require('node:assert/strict');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');

const motion = createCameraMotion({
    isRenderableNote: note => Number.isFinite(note.f),
    isUnpitchedMute: note => !!note.unpitched,
});
const stop = (time, x, lasting = true, lead = .6) => ({
    time, x, lasting, lead, minX: x - 2, maxX: x + 2,
});
const close = (actual, expected, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const fields = ['start', 'end', 'nominalStart', 'nominalEnd', 'from', 'to',
    'v0', 'v1', 'lasting', 'transit', 'arrivalIndex'];
const trajectory = segments => segments.map(segment =>
    Object.fromEntries(fields.map(field => [field, segment[field]])));
const legacySettings = [
    [.5, 0, 0, 250, null],
    [0, 1000, 200, 3000, null],
    [1, 200, 75, 900, 25],
    [.25, 600, 35, 1500, 2500],
];
const build = (stops, rate, legacy, direct) =>
    motion.hwyBuildCameraMotion(stops, rate, ...legacy, direct);
const sample = (stops, time, rate, legacy, direct, out = {}) =>
    motion.hwyCameraPlanAt(stops, time, rate, legacy[0], out, ...legacy.slice(1), direct);

test('isolated direct moves use exact start-before and arrive-after at every tested speed and distance', () => {
    for (const rate of [.5, 1, 1.5]) {
        for (const destination of [.25, 3, 20, -20]) {
            for (const startBeforeMs of [25, 100, 500, 700, 3000]) {
                for (const arriveAfterMs of [0, 200, 1000, 3000]) {
                    for (const legacy of legacySettings) {
                        const stops = [stop(0, 0), stop(10, destination, true, 1.2)];
                        const direct = { startBeforeMs, arriveAfterMs };
                        const [segment] = build(stops, rate, legacy, direct);
                        const timing = segment.timing;
                        assert.equal(timing.mode, 'direct');
                        assert.equal(timing.fallbackReason, 'none');
                        close(segment.start, 10 - startBeforeMs / 1000 * rate);
                        close(segment.end, 10 + arriveAfterMs / 1000 * rate);
                        close(timing.start, segment.start);
                        close(timing.end, segment.end);
                        close(timing.appliedLeadMs, startBeforeMs);
                        close(timing.appliedDurationMs, startBeforeMs + arriveAfterMs);
                        close(timing.appliedLatenessMs, arriveAfterMs);
                        close(timing.actualArriveAfterMs, arriveAfterMs);
                        const before = sample(stops, segment.start, rate, legacy, direct);
                        const after = sample(stops, segment.end, rate, legacy, direct);
                        close(before.x, 0); close(before.velocity, 0);
                        close(after.x, destination); close(after.velocity, 0);
                    }
                }
            }
        }
    }
});

test('quiet preparation, smoothing, distance and legacy modifiers cannot alter feasible direct timing', () => {
    const direct = { startBeforeMs: 500, arriveAfterMs: 200 };
    for (const rate of [.5, 1, 1.5]) {
        const traces = legacySettings.map(legacy => {
            const stops = [stop(0, 2), stop(10, 18, true, 1.2)];
            const segments = build(stops, rate, legacy, direct);
            const samples = [];
            for (const u of [0, .1, .25, .5, .75, .9, 1]) {
                const t = segments[0].start + (segments[0].end - segments[0].start) * u;
                const out = sample(stops, t, rate, legacy, direct);
                samples.push([out.x, out.velocity]);
            }
            assert.equal(segments[0].timing.requestedDelayMs, 0);
            assert.equal(segments[0].timing.requestedExtraMs, 0);
            return { trajectory: trajectory(segments), samples };
        });
        for (const trace of traces.slice(1)) assert.deepEqual(trace, traces[0]);
    }
});

test('progressive journeys preserve every legacy curve and first/final arrival distinction', () => {
    const direct = { startBeforeMs: 500, arriveAfterMs: 200 };
    const chart = [stop(0, 0), stop(5, 3, false), stop(5.3, 7, false),
        stop(5.6, 4, false), stop(5.9, 9, false), stop(7, 2)];
    for (const rate of [.5, 1, 1.5]) {
        for (const legacy of legacySettings) {
            const baseline = build(chart, rate, legacy);
            const candidate = build(chart, rate, legacy, direct);
            assert.deepEqual(trajectory(candidate), trajectory(baseline));
            const timing = candidate[0].timing;
            assert.equal(timing.mode, 'chart-paced-fallback');
            assert.equal(timing.fallbackReason, 'progressive-journey');
            for (const [key, value] of Object.entries(baseline[0].timing)) {
                assert.deepEqual(timing[key], value, `legacy timing ${key}`);
            }
            assert.equal(timing.firstLaneTime, 5);
            assert.equal(timing.finalLaneTime, 7);
            close(timing.requestedEnd, 5 + .2 * rate);
            close(timing.actualFirstLaneArrivalTime, baseline[0].end);
            close(timing.actualArriveAfterMs, (baseline[0].end - 5) / rate * 1000);
            const a = chart.map(row => ({ ...row })), b = chart.map(row => ({ ...row }));
            for (let i = 0; i <= 100; i++) {
                const original = sample(a, i / 10, rate, legacy);
                const current = sample(b, i / 10, rate, legacy, direct);
                assert.deepEqual([current.x, current.velocity], [original.x, original.velocity]);
            }
        }
    }
});

test('a requested departure before the source lane explicitly retains its legacy schedule', () => {
    const stops = [stop(1, 0), stop(1.2, 3)];
    const direct = { startBeforeMs: 700, arriveAfterMs: 200 };
    for (const legacy of legacySettings) {
        const baseline = build(stops, 1, legacy), candidate = build(stops, 1, legacy, direct);
        assert.deepEqual(trajectory(candidate), trajectory(baseline));
        assert.equal(candidate[0].timing.mode, 'chart-paced-fallback');
        assert.equal(candidate[0].timing.fallbackReason, 'previous-lane');
        close(candidate[0].timing.requestedStart, .5);
        close(candidate[0].timing.start, baseline[0].start);
    }
});

test('an exact arrival may not invade the following legacy journey', () => {
    const stops = [stop(0, 0), stop(5, 4), stop(6, 8), stop(12, 2)];
    const legacy = [.5, 0, 0, 250, null], direct = { startBeforeMs: 700, arriveAfterMs: 400 };
    const baseline = build(stops, 1, legacy), candidate = build(stops, 1, legacy, direct);
    assert.equal(candidate[0].timing.fallbackReason, 'adjacent-journey-overlap');
    assert.deepEqual(trajectory(candidate).slice(0, 1), trajectory(baseline).slice(0, 1));
    assert.equal(candidate[1].timing.mode, 'direct');
    close(candidate[1].start, 5.3);
    close(candidate[1].end, 6.4);
    for (let index = 0; index + 1 < candidate.length; index++) {
        assert.ok(candidate[index].end <= candidate[index + 1].start);
    }
});

test('the preceding legacy arrival remains a conservative boundary even when its direct replacement ends sooner', () => {
    const stops = [stop(0, 0), stop(5, 4), stop(9, 8)];
    const legacy = [.5, 1000, 200, 3000, null];
    const direct = { startBeforeMs: 3000, arriveAfterMs: 200 };
    const baseline = build(stops, 1, legacy), candidate = build(stops, 1, legacy, direct);
    assert.equal(candidate[0].timing.mode, 'direct');
    assert.equal(candidate[1].timing.fallbackReason, 'adjacent-journey-overlap');
    assert.deepEqual(trajectory(candidate).slice(1), trajectory(baseline).slice(1));
    assert.ok(candidate[0].end < candidate[1].start);
});

test('overlapping exact candidates all revert without iteration-order priority', () => {
    const stops = [stop(0, 0), stop(5, 4), stop(8, 8), stop(11, 2)];
    const legacy = [.5, 0, 0, 0, 25], direct = { startBeforeMs: 2000, arriveAfterMs: 2000 };
    const baseline = build(stops, 1, legacy), candidate = build(stops, 1, legacy, direct);
    assert.ok(candidate.journeys.every(journey => journey.directCandidate.fitsLegacyGap));
    assert.deepEqual(trajectory(candidate), trajectory(baseline));
    assert.ok(candidate.every(segment => segment.timing.mode === 'chart-paced-fallback'
        && segment.timing.fallbackReason === 'adjacent-journey-overlap'));
});

test('direct moves adjacent to a progressive journey preserve its C1 and C2 joins', () => {
    const stops = [stop(0, 0), stop(3, 4), stop(6, 6, false), stop(6.3, 8, false),
        stop(7, 10), stop(12, 2)];
    const legacy = [.5, 200, 20, 500, null], direct = { startBeforeMs: 500, arriveAfterMs: 200 };
    const baseline = build(stops, 1, legacy), candidate = build(stops, 1, legacy, direct);
    assert.equal(candidate[0].timing.mode, 'direct');
    assert.equal(candidate.at(-1).timing.mode, 'direct');
    assert.deepEqual(trajectory(candidate).slice(1, -1), trajectory(baseline).slice(1, -1));
    for (let i = 1; i < 3; i++) {
        close(candidate[i].end, candidate[i + 1].start);
        close(candidate[i].to, candidate[i + 1].from);
        close(candidate[i].v1, candidate[i + 1].v0);
        const left = candidate[i], right = candidate[i + 1], epsilon = 1e-6;
        const a = motion.hwyCameraSegmentAt(left.from, left.to, left.v0, left.v1,
            left.end - left.start, 1 - epsilon, {});
        const b = motion.hwyCameraSegmentAt(right.from, right.to, right.v0, right.v1,
            right.end - right.start, epsilon, {});
        close(a.velocity, b.velocity, 1e-8);
    }
});

test('direct-control cache keys use values, including mutation of a reused settings object', () => {
    const stops = [stop(0, 0), stop(10, 8)], legacy = legacySettings[0], out = {};
    const direct = { startBeforeMs: 500, arriveAfterMs: 200 };
    sample(stops, 9.75, 1, legacy, direct, out);
    const first = stops.motion, report = out.timing;
    sample(stops, 9.76, 1, legacy, { startBeforeMs: 500, arriveAfterMs: 200 }, out);
    assert.equal(stops.motion, first);
    assert.equal(out.timing, report);
    direct.startBeforeMs = 700;
    sample(stops, 9.76, 1, legacy, direct, out);
    assert.notEqual(stops.motion, first);
    close(stops.motion[0].start, 9.3);
    const second = stops.motion;
    direct.arriveAfterMs = 400;
    sample(stops, 9.76, 1, legacy, direct, out);
    assert.notEqual(stops.motion, second);
    close(stops.motion[0].end, 10.4);
    const third = stops.motion;
    sample(stops, 9.76, 1, legacy, null, out);
    assert.notEqual(stops.motion, third);
    assert.equal(out.timing.mode, undefined);
});

test('sampling cached direct motion does not inspect the chart or walk the stops again', () => {
    let reads = 0;
    const rows = Array.from({ length: 100 }, (_, index) => stop(index * 5, index % 13));
    const stops = new Proxy(rows, { get(target, key, receiver) {
        if (/^\d+$/.test(String(key))) reads++;
        return Reflect.get(target, key, receiver);
    } });
    const legacy = legacySettings[0], direct = { startBeforeMs: 500, arriveAfterMs: 200 }, out = {};
    sample(stops, 249.75, 1, legacy, direct, out);
    assert.ok(reads > 0, 'The initial cache build must actually read the supplied stops');
    const cached = stops.motion, cachedJourney = out.journey;
    reads = 0;
    for (let index = 0; index < 1000; index++) {
        assert.equal(sample(stops, 249.75 + index / 100000, 1, legacy, direct, out), out);
        assert.equal(stops.motion, cached);
        assert.equal(out.journey, cachedJourney);
    }
    assert.equal(reads, 0);
});

test('direct controls normalize their public bounds and keep missing controls at the declared defaults', () => {
    const legacy = legacySettings[0], stops = [stop(0, 0), stop(10, 4)];
    const defaults = build(stops, 1, legacy, {})[0].timing;
    assert.equal(defaults.requestedStartBeforeMs, 700);
    assert.equal(defaults.requestedArriveAfterMs, 0);
    const bounded = build(stops, 1, legacy, { startBeforeMs: 0, arriveAfterMs: 99999 })[0].timing;
    assert.equal(bounded.requestedStartBeforeMs, 25);
    assert.equal(bounded.requestedArriveAfterMs, 3000);
    const invalid = build(stops, 1, legacy, { startBeforeMs: NaN, arriveAfterMs: Infinity })[0].timing;
    assert.equal(invalid.requestedStartBeforeMs, 700);
    assert.equal(invalid.requestedArriveAfterMs, 0);
});

test('legacy mode retains its existing schedule and metadata when the new option is absent', () => {
    const stops = [stop(0, 0), stop(10, 4)];
    for (const legacy of legacySettings) {
        const a = build(stops, 1, legacy), b = build(stops, 1, legacy, null);
        assert.deepEqual(a, b);
        assert.equal(a[0].timing.mode, undefined);
        assert.equal(a[0].timing.legacyTiming, undefined);
    }
});
