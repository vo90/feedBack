const test = require('node:test');
const assert = require('node:assert/strict');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');
const motion = createCameraMotion({isRenderableNote: () => true, isUnpitchedMute: () => false});
const rates = [.1, .25, .5, .75, 1, 1.5, 2, 4];
const modes = ['reach-centres', 'latest-destination'];
const stop = ([time, x]) => ({time, x, lasting:true, lead:.6, minX:x-2, maxX:x+2});
const build = (rows, rate, options) => motion.hwyBuildCameraMotion(rows, rate, .5, 0, 0, 250, null, options);
const sample = (rows, time, rate, options, out = {}) =>
    motion.hwyCameraPlanAt(rows, time, rate, .5, out, 0, 0, 250, null, options);
const close = (actual, expected, tolerance = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('complete direct trajectories and diagnostics are song-time invariant across the supported speed range', () => {
    const charts = [
        [[0,0],[5,4],[5.3,8],[5.6,-2],[5.9,3],[9,6]], // Overlap, shared travel and reversal.
        [[1,0],[1.2,4],[1.5,8],[1.8,-2],[4,6]],       // Initial availability truncates the lead.
        [[0,0],[.1,4],[.2,8],[.3,-2],[2,5]],         // Several latest triggers share the initial instant.
    ];
    for (const movementMode of modes) for (const chart of charts)
        for (const [startBeforeMs, arriveAfterMs] of [[400,50],[25,0],[3000,0],[700,1000]]) {
            const options = {movementMode,startBeforeMs,arriveAfterMs};
            const rows = chart.map(stop), reference = build(rows,1,options);
            const times = new Set([chart[0][0]-.1, chart.at(-1)[0]+4]);
            for (let time=chart[0][0]; time<=chart.at(-1)[0]+3; time+=.037) times.add(time);
            for (const segment of reference) {
                for (const boundary of [segment.start,segment.end]) {
                    times.add(boundary-1e-7); times.add(boundary); times.add(boundary+1e-7);
                }
                times.add((segment.start+segment.end)/2);
            }
            const expected = [...times].map(time => sample(rows,time,1,options));
            for (const rate of rates) {
                const actual = build(rows,rate,options);
                assert.deepEqual(actual,reference);
                assert.deepEqual(actual.journeys,reference.journeys);
                for (const [index,time] of [...times].entries()) {
                    const point = sample(rows,time,rate,options), baseline = expected[index];
                    assert.deepEqual({...point,velocity:0,acceleration:0}, {...baseline,velocity:0,acceleration:0});
                    assert.equal(point.velocity,baseline.velocity*rate);
                    assert.equal(point.acceleration,baseline.acceleration*(rate*rate));
                    assert.ok([point.x,point.velocity,point.acceleration].every(Number.isFinite));
                }
            }
        }
});

test('400 song-ms retains the same departure distance and overlap decisions at every rate', () => {
    for (const movementMode of modes) for (const rate of rates) {
        const options = {movementMode,startBeforeMs:400,arriveAfterMs:50};
        const rows = [[0,0],[10,4],[10.3,8],[15,2]].map(stop);
        const segments = build(rows,rate,options);
        close(segments[0].start,9.6);
        assert.equal(segments.journeys.length,2);
        assert.equal(segments.journeys[0].waypointCount,2);
        close((10-segments[0].start)/rate*1000,400/rate);
        if (movementMode === 'latest-destination') {
            assert.equal(segments[0].timing.retargeted,true);
            close(segments[0].end,9.9);
            assert.equal(segments[0].timing.actualFirstLaneArrivalTime,null);
        } else {
            assert.equal(segments[0].timing.reachedCentre,true);
            close(segments[0].end,10.05);
            close(sample(rows,10.05,rate,options).x,4);
        }
        for (const segment of segments) {
            const timing = segment.timing;
            assert.equal(timing.timeBasis,'song');
            assert.equal(timing.requestedStartBeforeMs,400);
            assert.equal(timing.requestedArriveAfterMs,50);
            close(timing.appliedLeadMs,(timing.firstLaneTime-timing.start)*1000);
            close(timing.preparationAppliedMs,timing.appliedLeadMs);
            close(timing.appliedDurationMs,(timing.end-timing.start)*1000);
            close(timing.nominalDurationMs,450);
            if (timing.reachedCentre) {
                close(timing.actualArriveAfterMs,(timing.end-timing.firstLaneTime)*1000);
                close(timing.appliedLatenessMs,50);
            }
        }
    }
});

test('rate-only direct samples retain the same curve and timing objects without reading chart stops', () => {
    for (const movementMode of modes) {
        let reads = 0;
        const rows = Array.from({length:1000},(_,index) => stop([index*.1,index%13]));
        const stops = new Proxy(rows, {get(target,key,receiver) {
            if (/^\d+$/.test(String(key))) reads++;
            return Reflect.get(target,key,receiver);
        }});
        const options = {movementMode,startBeforeMs:400,arriveAfterMs:50}, out = {};
        sample(stops,49.05,1,options,out);
        assert.ok(reads>0);
        const cached = stops.motion, timing = out.timing, journey = out.journey;
        const x = out.x, velocity = out.velocity, acceleration = out.acceleration;
        reads = 0;
        for (let iteration=0; iteration<100; iteration++) for (const rate of rates) {
            assert.equal(sample(stops,49.05,rate,options,out),out);
            assert.equal(stops.motion,cached);
            assert.equal(stops.motionRate,rate);
            assert.equal(out.timing,timing);
            assert.equal(out.journey,journey);
            assert.equal(out.x,x);
            assert.equal(out.velocity,velocity*rate);
            assert.equal(out.acceleration,acceleration*(rate*rate));
        }
        assert.equal(reads,0);
        sample(stops,49.05,.01,options,out);
        assert.equal(stops.motion,cached); assert.equal(stops.motionRate,.1);
        sample(stops,49.05,10,options,out);
        assert.equal(stops.motion,cached); assert.equal(stops.motionRate,4);
    }
});

test('legacy schedules still rebuild for speed changes and switching timing APIs cannot reuse the wrong path', () => {
    const rows = [[0,0],[10,8],[15,2]].map(stop), options = {startBeforeMs:400,arriveAfterMs:50};
    sample(rows,9.8,1,null);
    const legacyFullSpeed = rows.motion;
    sample(rows,9.8,.5,null);
    const legacyHalfSpeed = rows.motion;
    assert.notEqual(legacyHalfSpeed,legacyFullSpeed);
    assert.notEqual(legacyHalfSpeed[0].start,legacyFullSpeed[0].start);
    assert.equal(legacyHalfSpeed[0].timing.timeBasis,undefined);
    sample(rows,9.8,.5,null);
    assert.equal(rows.motion,legacyHalfSpeed);
    sample(rows,9.8,.5,options);
    const direct = rows.motion;
    assert.notEqual(direct,legacyHalfSpeed);
    sample(rows,9.8,1,options);
    assert.equal(rows.motion,direct);
    sample(rows,9.8,1,null);
    assert.notEqual(rows.motion,direct);
    assert.deepEqual(rows.motion,legacyFullSpeed);
});

test('100% trajectories remain bit-identical to the pre-song-time scheduler for both movement modes', () => {
    // Captured from integration 7d9eabe before changing units: initial bound,
    // overlapping advancing/reversing targets, and an isolated final move.
    const expected = {
        'reach-centres': {
            segments:[[1,1.25,0,4,0,13.333333333333332,0,0],[1.25,1.55,4,8,13.333333333333332,0,0,0],[1.55,1.85,8,-2,0,0,0,0],[3.6,4.05,-2,6,0,0,0,0]],
            poses:[[0.9113600000000017,20.821333333333346,184.3199999999995],[4.72067901234568,16.203703703703706,86.41975308641973],[7.645061728395061,-19.290123456790145,-617.2839506172838],[-1.6450617283950617,-19.290123456790205,617.2839506172844],[-1.388711070466898,15.932530610171254,227.6075801453033]],
        },
        'latest-destination': {
            segments:[[1,1.1,0,1.2697600000000024,0,27.648000000000025,0,184.3199999999995],[1.1,1.4,1.2697600000000024,7.8162804938271595,27.648000000000025,4.749168724279812,184.3199999999995,-86.2744581618659],[1.4,1.85,7.8162804938271595,-2,4.749168724279812,0,-86.2744581618659,0],[3.6,4.05,-2,6,0,0,0,0]],
            poses:[[1.2697600000000024,27.648000000000025,184.3199999999995],[6.784006503073721,16.924899659604723,-146.2983488289388],[4.0064393476102325,-40.88013583194871,-76.30491537787456],[-1.8867037583726756,-6.39490431989006,224.33302401081716],[-1.388711070466898,15.932530610171254,227.6075801453033]],
        },
    };
    for (const movementMode of modes) {
        const rows = [[1,0],[1.2,4],[1.5,8],[1.8,-2],[4,6]].map(stop);
        const options = {movementMode,startBeforeMs:400,arriveAfterMs:50};
        const segments = build(rows,1,options);
        assert.deepEqual(segments.map(({start,end,from,to,v0,v1,a0,a1}) => [start,end,from,to,v0,v1,a0,a1]),expected[movementMode].segments);
        const poses = [1.1,1.3,1.6,1.8,3.7].map(time => {
            const point = sample(rows,time,1,options);
            return [point.x,point.velocity,point.acceleration];
        });
        assert.deepEqual(poses,expected[movementMode].poses);
    }
});
