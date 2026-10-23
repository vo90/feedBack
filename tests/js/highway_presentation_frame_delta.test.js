// Frozen scalar-wall clock from 88e4b26: fallback and lifecycle compatibility.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const referenceSource = String.raw`function createPresentationClock() {
        let time = NaN, lastPerf = NaN, epoch = null;
        let gapRecovery = false;
        let trace = null, traceCount = 0;
        const fields = ['wallMs', 'time', 'target', 'raw', 'epoch', 'reason',
            'sampleAgeMs', 'sequence', 'generation', 'rate', 'deltaMs', 'frameTimestampMs'];
        const reasons = ['advance', 'epoch', 'hold', 'stale', 'rewind', 'frame-gap', 'end', 'source-recovery'];
        return {
            reset() { time = lastPerf = NaN; epoch = null; gapRecovery = false; traceCount = 0; },
            trace(enabled) { trace = enabled ? new Float64Array(4096 * fields.length) : null; traceCount = 0; },
            diagnostics() {
                if (!trace) return null;
                const count = Math.min(traceCount, 4096), rows = [];
                for (let i = traceCount - count; i < traceCount; i++) {
                    const at = (i % 4096) * fields.length;
                    rows.push(Array.from(trace.subarray(at, at + fields.length)));
                }
                return {fields, reasons, count: traceCount, rows};
            },
            sample(raw, now, transport, frameTimestampMs) {
                const t = transport;
                const rate = Number.isFinite(t.rate) && t.rate > 0 ? t.rate : 1;
                const position = Number.isFinite(t.position) ? t.position : raw;
                const sampledAt = Number.isFinite(t.sampledAt) ? t.sampledAt : now;
                const freshAt = Number.isFinite(t.freshAt) ? t.freshAt : sampledAt;
                const age = Math.max(0, now - freshAt);
                const end = Number.isFinite(t.endTime) ? t.endTime : Infinity;
                const playing = t.state === 'playing';
                const target = Math.min(end, position + (playing
                    ? Math.max(0, Math.min(now, freshAt + 250) - sampledAt) * rate / 1000 : 0));
                const previous = time;
                let reason = 0;
                if (!Number.isFinite(time) || epoch !== t.epoch) {
                    time = Math.min(end, playing ? target : raw); reason = 1; gapRecovery = false;
                } else if (t.state === 'rewind' || t.state === 'count-in') {
                    time = raw; reason = 4; gapRecovery = false;
                } else if (!playing) {
                    // Pause freezes the last displayed frame, even if it is
                    // slightly ahead of the most recent audio measurement.
                    reason = 2; gapRecovery = false;
                } else {
                    const dt = Math.max(0, now - lastPerf) / 1000;
                    // A long frame can resume before its queued audio update.
                    // Remember that gap until a fresh observation arrives, so
                    // clipping a stale frame cannot leave seconds of phase lag.
                    if (dt > 0.25) gapRecovery = 5;
                    // Permit finite extrapolation only while the SOURCE is
                    // fresh, not because its extrapolated getter keeps changing.
                    const usable = Math.max(0, Math.min(now, freshAt + 250) - lastPerf) / 1000;
                    if (age > 250) {
                        time += usable * rate; reason = 3;
                        // Complete observation loss can happen with regular
                        // frames too. Resume from fresh audio once available;
                        // never spend many seconds repaying accumulated lag.
                        if (!gapRecovery) gapRecovery = 7;
                    }
                    else if (gapRecovery) { time = Math.max(time, target); reason = gapRecovery; gapRecovery = false; }
                    else {
                        const advance = dt * rate;
                        const predicted = time + advance;
                        const correction = (target - predicted) * Math.min(1, dt / 0.12);
                        time = predicted + Math.max(-advance * 0.2, Math.min(advance * 0.2, correction));
                    }
                    if (time >= end) { time = end; reason = 6; }
                }
                epoch = t.epoch; lastPerf = now;
                if (trace) {
                    const at = (traceCount++ % 4096) * fields.length;
                    trace[at] = now; trace[at + 1] = time; trace[at + 2] = target;
                    trace[at + 3] = raw; trace[at + 4] = epoch; trace[at + 5] = reason;
                    trace[at + 6] = age; trace[at + 7] = t.sequence;
                    trace[at + 8] = t.generation; trace[at + 9] = rate;
                    trace[at + 10] = Number.isFinite(previous) ? (time - previous) * 1000 : 0;
                    trace[at + 11] = Number.isFinite(frameTimestampMs) ? frameTimestampMs : NaN;
                }
                return time;
            },
        };
    }`;

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = source.indexOf('    function createPresentationClock() {');
const currentSource = source.slice(start, source.indexOf('    // End presentation clock.', start)).trim();
const factory = text => vm.runInNewContext(`(${text})`);
const make = factory(currentSource), reference = factory(referenceSource);
function sample(clock, now, position, frameTimestampMs, options = {}) {
    return clock.sample(position, now, { epoch: 1, state: 'playing', rate: 1,
        position, sampledAt: now, freshAt: now, endTime: Infinity, generation: 1, ...options }, frameTimestampMs);
}
const rms = values => Math.sqrt(values.reduce((sum, n) => sum + n * n, 0) / values.length);

test('private camera interval is published only for a selected normal frame advance', () => {
    const cases = [
        ['absent', 20, undefined, {}], ['invalid', 20, NaN, {}],
        ['infinite', 20, Infinity, {}], ['repeated', 20, 110, {}],
        ['backward', 20, 100, {}], ['origin jump', 20, 220, {}],
        ['long frame', 20, 400, {}], ['wall gap', 300, 120, {}],
        ['rate', 20, 120, {rate: 2}], ['generation', 20, 120, {generation: 2}],
        ['epoch', 20, 120, {epoch: 2}], ['stale', 20, 120, {freshAt: -250}],
        ['end clamp', 20, 120, {endTime: 10.015}],
        ...['paused', 'buffering', 'seeking', 'ended', 'rewind', 'count-in']
            .map(state => [state, 20, 120, {state}]),
    ];
    for (const [name, wall, frame, options] of cases) {
        const clock = make();
        assert.ok(Number.isNaN(clock.frameMotionDelta()), `${name}: new`);
        sample(clock, 0, 10, 100);
        assert.ok(Number.isNaN(clock.frameMotionDelta()), `${name}: first`);
        const time = sample(clock, 10, 10.01, 110);
        assert.equal(typeof time, 'number');
        assert.equal(clock.frameMotionDelta(), .01, `${name}: prior normal`);
        sample(clock, wall, 10.02, frame, options);
        assert.ok(Number.isNaN(clock.frameMotionDelta()), name);
    }
});

test('camera interval is the selected frame delta, not the corrected time or wall delta', () => {
    const clock = make();
    sample(clock, 0, 10, 100);
    const time = sample(clock, 13, 10.013, 110);
    assert.equal(clock.frameMotionDelta(), .01);
    assert.notEqual(time - 10, .01, 'audio phase correction remains part of display time');
    sample(clock, 20, 10.02, 120);
    assert.equal(clock.frameMotionDelta(), .01);
    // The accepted delayed-callback catch-up is also a valid visual interval.
    sample(clock, 89, 10.089, 140.1);
    sample(clock, 98, 10.098, 200);
    assert.equal(clock.frameMotionDelta(), (200 - 140.1) / 1000);
});

test('camera interval clears on reset, failed samples, and stale recovery, independently per clock', () => {
    const a = make(), b = make();
    for (const clock of [a, b]) { sample(clock, 0, 10, 100); sample(clock, 10, 10.01, 110); }
    a.reset();
    assert.ok(Number.isNaN(a.frameMotionDelta()));
    assert.equal(b.frameMotionDelta(), .01);
    sample(a, 20, 10.02, 120);
    assert.ok(Number.isNaN(a.frameMotionDelta()), 'first sample after reset');
    sample(a, 30, 10.03, 130);
    assert.equal(a.frameMotionDelta(), .01);
    assert.throws(() => a.sample(10, 40, {get rate() { throw Error('fixture'); }}, 140), /fixture/);
    assert.ok(Number.isNaN(a.frameMotionDelta()));
    sample(b, 300, 10.3, 400, {freshAt: 0});
    assert.ok(Number.isNaN(b.frameMotionDelta()));
    sample(b, 310, 10.31, 410);
    assert.ok(Number.isNaN(b.frameMotionDelta()), 'source recovery');
    sample(b, 320, 10.32, 420);
    assert.equal(b.frameMotionDelta(), .01);
});

test('missing metadata preserves the complete old clock through transport transitions', () => {
    const a = make(), b = reference();
    const times = [0, 7, 22, 30, 51, 100, 150, 450, 460, 500, 520, 600];
    const states = ['playing', 'playing', 'paused', 'playing', 'buffering', 'playing',
        'seeking', 'playing', 'rewind', 'count-in', 'playing', 'ended'];
    for (const invalid of [undefined, NaN, Infinity, -Infinity, null, '100', {}]) {
        a.reset(); b.reset();
        for (let i = 0; i < times.length; i++) {
            const options = { state: states[i], epoch: i < 8 ? 1 : 2, rate: i < 4 ? 1 : .5,
                freshAt: i === 7 ? 150 : times[i], endTime: 12 };
            assert.equal(sample(a, times[i], 10 + i * .01, invalid, options),
                sample(b, times[i], 10 + i * .01, invalid, options));
        }
    }
});

test('matching frame and wall deltas preserve legacy output within roundoff at different origins and rates', () => {
    for (const origin of [0, 100, 100000]) for (const rate of [.25, 1, 2]) {
        const a = make(), b = reference();
        let wall = 1000;
        for (let i = 0; i < 240; i++) {
            wall += [10, 10, 20, 30, 10][i % 5];
            const raw = 10 + wall / 1000 * rate;
            const options = { rate, state: i >= 60 && i < 80 ? 'paused' : 'playing',
                epoch: i < 120 ? 1 : 2, freshAt: i >= 160 && i < 200 ? 2000 : wall };
            const actual = sample(a, wall, raw, wall + origin, options);
            const expected = sample(b, wall, raw, wall + origin, options);
            // Filtering tiny floating-point correction velocities can change
            // the final rounding. Missing-metadata paths remain exact above.
            assert.ok(Math.abs(actual - expected) <= 4 * Number.EPSILON * Math.max(1, Math.abs(expected)));
        }
    }
});

test('frame prediction and frame correction gain reject callback jitter without importing a +100ms origin', () => {
    for (const rate of [.25, 1, 2]) {
        const a = make(), shifted = make(), b = reference();
        const motion = [], oldMotion = [], phase = [];
        let previous, oldPrevious;
        for (let i = 0; i < 500; i++) {
            const wall = 1000 + i * 10 + (i % 2 ? 2 : -2), frame = 1000 + i * 10;
            const target = 10 + (wall - 1000) / 1000 * rate;
            const value = sample(a, wall, target, frame + 100, { rate });
            assert.equal(value, sample(shifted, wall, target, frame, { rate }));
            const oldValue = sample(b, wall, target, frame + 100, { rate });
            if (i > 100) {
                motion.push((value - previous) * 1000 / rate - 10);
                oldMotion.push((oldValue - oldPrevious) * 1000 / rate - 10);
                phase.push((value - target) * 1000 / rate);
                assert.ok(value > previous);
            }
            previous = value; oldPrevious = oldValue;
        }
        assert.ok(rms(motion) < .18, 'both prediction and correction gain must follow the frame interval');
        assert.ok(rms(oldMotion) > 3.9, 'fixture must expose the original wall-clock jitter');
        assert.ok(Math.abs(phase.reduce((a, b) => a + b, 0) / phase.length) < .006,
            'symmetric jitter must not create correction-weight phase bias');
        assert.ok(Math.max(...phase.map(Math.abs)) < 2.1);
    }
});

test('invalid pairs and gross offset steps use wall time, then establish a new frame baseline', () => {
    const a = make(), b = reference();
    const frames = [1100, 1110, 1110, 1105, 1215, 1225, undefined, 1245, 1255, '1265', 1275, Infinity, 1295];
    for (let i = 0; i < frames.length; i++) {
        assert.equal(sample(a, 1000 + i * 10, 10 + i * .01, frames[i]),
            sample(b, 1000 + i * 10, 10 + i * .01, frames[i]));
    }
    // Positive intervals alone are insufficient: 110ms animation advance
    // against 10ms wall time is a clock-origin change, not normal jitter.
    for (const delta of [60.001, 110, 260]) {
        const x = make(), y = reference();
        sample(x, 1000, 10, 1100); sample(y, 1000, 10, 1100);
        assert.equal(sample(x, 1010, 10.01, 1100 + delta), sample(y, 1010, 10.01, 1100 + delta));
        assert.equal(sample(x, 1020, 10.02, 1110 + delta), sample(y, 1020, 10.02, 1110 + delta));
    }
});

test('the recorded delayed callback retains its following animation catch-up', () => {
    // Frozen Twilight capture rows 1882-1885. The 69/20.1ms delayed callback
    // is followed by 9/59.9ms catch-up, straddling the 50ms offset-step guard.
    // Seed the exact previous visual time; the following targets retain their
    // independently observed audio values rather than assuming perfect audio.
    const rows = [
        [132784.60000000894, 140.22180112199135, 132874.9],
        [132853.60000000894, 140.299763333344, 132895],
        [132862.60000000894, 140.30909438333904, 132954.9],
        [132868.70000000298, 140.31519438333308, 132965],
    ];
    const a = make(), values = rows.map(([wall, target, frame]) => sample(a, wall, target, frame));
    assert.equal(values[0], rows[0][1]);
    assert.equal(values[1], 140.24592112199136, 'ordinary first half remains unchanged');
    assert.ok(Math.abs(values[2] - rows[2][1]) < .002, 'catch-up restores phase in the next frame');
    assert.ok(Math.abs(values[3] - rows[3][1]) < .003);
    const rejectedCatchUp = 140.25672112199135;
    assert.ok(rows[2][1] - rejectedCatchUp > .05, 'frozen old guard stranded over 50ms of debt');
    for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
});

test('phase-restoring gross deltas work at each rate without accepting aligned origin jumps', () => {
    for (const rate of [.25, 1, 2]) {
        const a = make();
        sample(a, 1000, 10, 1100, { rate });
        const delayed = sample(a, 1069, 10 + .069 * rate, 1120.1, { rate });
        const caughtUp = sample(a, 1078, 10 + .078 * rate, 1180, { rate });
        assert.ok((10 + .069 * rate - delayed) / rate > .04);
        assert.ok(Math.abs(caughtUp - (10 + .078 * rate)) / rate < .004);
        assert.ok(caughtUp > delayed);
        for (const [wallDt, frameDt] of [[10, 110], [120, 10], [10, 250], [10, 251]]) {
            const x = make(), y = reference();
            sample(x, 1000, 10, 1100, { rate }); sample(y, 1000, 10, 1100, { rate });
            const target = 10 + wallDt / 1000 * rate;
            assert.equal(sample(x, 1000 + wallDt, target, 1100 + frameDt, { rate }),
                sample(y, 1000 + wallDt, target, 1100 + frameDt, { rate }),
                'an origin change from alignment must retain the wall path');
        }
    }
});

test('gross-step phase selection keeps the interval bound and correction cannot cross its target', () => {
    for (const rate of [.25, 1, 2]) {
        // A frame prediction may cross the target while still being closer
        // than the wall prediction. Its correction moves only toward target,
        // never through it, and total advance retains the existing 20% cap.
        const a = make();
        sample(a, 1000, 10, 1100, { rate });
        const target = 10 + .13 * rate, framePrediction = 10 + .24 * rate;
        const actual = sample(a, 1010, target, 1340, { rate });
        assert.ok(actual > target && actual < framePrediction);
        assert.ok(Math.abs(actual - target) < .12 * rate);
        assert.ok(actual - 10 >= .24 * rate * .8 - 1e-14);
        assert.ok(actual - 10 <= .24 * rate * 1.2 + 1e-14);
        // Beyond 250ms is rejected even if it would perfectly repay phase debt.
        const x = make(), y = reference();
        sample(x, 1000, 10, 1100, { rate }); sample(y, 1000, 10, 1100, { rate });
        assert.equal(sample(x, 1010, 10 + .251 * rate, 1351, { rate }),
            sample(y, 1010, 10 + .251 * rate, 1351, { rate }));
        // Equal prediction errors do not establish a phase improvement.
        const tie = make(), legacy = reference();
        sample(tie, 0, 0, 0, { rate }); sample(legacy, 0, 0, 0, { rate });
        assert.equal(sample(tie, 0, .0625 * rate, 125, { rate }),
            sample(legacy, 0, .0625 * rate, 125, { rate }));
        // A shorter frame step can predict closer yet finish farther away:
        // at 1x, frame10ms predicts 40ms lag but corrects only to 38ms lag;
        // wall100ms predicts 50ms lead and corrects to 30ms lead. Keep wall.
        const shorter = make(), wall = reference();
        sample(shorter, 0, 0, 100, { rate }); sample(wall, 0, 0, 100, { rate });
        assert.equal(sample(shorter, 100, .05 * rate, 110, { rate }),
            sample(wall, 100, .05 * rate, 110, { rate }));
    }
});

test('pause, rate, generation and epoch changes do not bridge incompatible frame intervals', () => {
    const a = make(), b = reference();
    const rows = [
        [0, 10, 100, {}], [10, 10.01, 110, {}],
        [20, 9.99, 120, { state: 'paused' }], [30, 10.02, 150, {}],
        [40, 10.03, 180, { rate: .5 }], [50, 10.04, 210, { rate: .5, generation: 2 }],
        [60, 2, 240, { rate: .5, generation: 2, epoch: 2 }],
        [70, 1, 270, { state: 'rewind', epoch: 2 }],
        [80, .5, 300, { state: 'count-in', epoch: 3 }],
        [90, .51, 330, { epoch: 3 }],
    ];
    for (const [wall, raw, frame, options] of rows) {
        assert.equal(sample(a, wall, raw, frame, options), sample(b, wall, raw, frame, options));
    }
    a.reset(); b.reset();
    assert.equal(sample(a, 500, 20, 10000), sample(b, 500, 20, 10000));
    assert.equal(sample(a, 510, 20.01, 10010), sample(b, 510, 20.01, 10010));
});

test('stale budgets and long-frame recovery use wall time despite very different animation deltas', () => {
    const a = make(), b = reference();
    const rows = [
        [0, 10, 100, {}], [10, 10.01, 110, {}],
        [300, 10.01, 120, { sampledAt: 10, freshAt: 10 }],
        [400, 10.01, 1000, { sampledAt: 10, freshAt: 10 }],
        [410, 10.41, 1010, {}], [420, 10.42, 1020, {}],
        [1000, 11, 1030, {}], [1010, 11.01, 1040, {}],
    ];
    for (const [wall, raw, frame, options] of rows) {
        assert.equal(sample(a, wall, raw, frame, options), sample(b, wall, raw, frame, options));
    }
});

test('dropped frames retain their full interval, and end-of-track remains clamped', () => {
    const a = make();
    sample(a, 0, 10, 100);
    assert.equal(sample(a, 10, 10.01, 110), 10.01);
    assert.equal(sample(a, 40, 10.04, 140), 10.04, 'do not replace a missed interval with a fixed 10ms step');
    a.reset();
    assert.equal(sample(a, 0, 9.99, 100, { endTime: 10 }), 9.99);
    assert.equal(sample(a, 10, 10, 130, { endTime: 10 }), 10);
    assert.equal(sample(a, 20, 10, 140, { state: 'ended', endTime: 10 }), 10);
});

test('frame history is per clock and disabled diagnostics allocate no ring storage', () => {
    let arrays = 0;
    const create = vm.runInNewContext(`(${currentSource})`, {
        Float64Array: function (length) { arrays++; return new Float64Array(length); },
    });
    const a = create(), b = create(), isolated = make();
    for (let i = 0; i < 300; i++) {
        sample(a, i * 10, 10 + i * .01, i * 10 + (i % 2 ? 100 : 101));
        assert.equal(sample(b, i * 10, 20 + i * .01, i * 10 + 900),
            sample(isolated, i * 10, 20 + i * .01, i * 10 + 900));
    }
    assert.equal(arrays, 0); assert.equal(a.diagnostics(), null);
});

// Remove only correction-velocity filtering for the jitter comparison below.
// Validate this derived oracle against the independent frozen scalar-wall clock
// when the two input intervals match; retain newer zoom timing in both variants.
const velocitySource = currentSource.replace(/\r\n/g, '\n');
let unfilteredSource = velocitySource
    .replace('        let correctionVelocity = NaN;\n', '')
    .replace('                correctionVelocity = NaN;\n', '')
    .replace(/                        const boundedCorrection = [\s\S]*?                        time = predicted \+ appliedCorrection;/,
        '                        time = predicted + Math.max(-advance * 0.2, Math.min(advance * 0.2, correction));')
    .replace('                if (reason !== 0) { frameMotionDt = NaN; correctionVelocity = NaN; }',
        '                if (reason !== 0) frameMotionDt = NaN;');
const unfiltered = factory(unfilteredSource);
const inspectVelocity = factory(velocitySource.replace(
    '            frameMotionDelta() { return frameMotionDt; },',
    '            frameMotionDelta() { return frameMotionDt; },\n            testVelocity() { return correctionVelocity; },'));

test('unfiltered oracle retains independent scalar timing and transport lifecycle behavior', () => {
    assert.notEqual(unfilteredSource, velocitySource);
    assert.doesNotMatch(unfilteredSource, /\b(?:correctionVelocity|boundedCorrection|appliedCorrection)\b/,
        'the comparison clock must not retain any correction-velocity filtering');
    for (const rate of [.25, 1, 2]) {
        const clock = unfiltered(), legacy = reference();
        clock.trace(true); legacy.trace(true);
        const rows = [
            [0, 10, {}], [10, 10 + .034 * rate, {}],
            [20, 10 + .008 * rate, {}], [30, 10 + .051 * rate, {}],
            [40, 9, {state: 'paused'}], [50, 10 + .05 * rate, {}],
            [310, 10 + .05 * rate, {sampledAt: 50, freshAt: 50}],
            [400, 10 + .05 * rate, {sampledAt: 50, freshAt: 50}],
            [410, 10 + .41 * rate, {}],
            [420, 10 + .42 * rate, {generation: 2, rate: rate / 2}],
            [430, 10 + .43 * rate, {endTime: 10 + .415 * rate}],
            [440, 2, {epoch: 2}], [450, 1, {epoch: 2, state: 'rewind'}],
            [460, .5, {epoch: 3, state: 'count-in'}], [470, .51, {epoch: 3}],
        ];
        for (const [wall, position, options] of rows) {
            const args = [wall, position, wall + 10000, {rate, ...options}];
            assert.equal(sample(clock, ...args), sample(legacy, ...args),
                `unfiltered timing at ${wall}ms and ${rate}x`);
        }
        const currentTrace = clock.diagnostics(), legacyTrace = legacy.diagnostics();
        assert.deepEqual(Array.from(currentTrace.fields), Array.from(legacyTrace.fields));
        assert.deepEqual(Array.from(currentTrace.reasons), Array.from(legacyTrace.reasons));
        for (let i = 0; i < rows.length; i++)
            assert.deepEqual(Array.from(currentTrace.rows[i]), Array.from(legacyTrace.rows[i]));
        clock.reset(); legacy.reset();
        assert.equal(sample(clock, 1000, 20, 11000), sample(legacy, 1000, 20, 11000));
    }
});

test('filtering preserves camera intervals and zoom holds without spending recovery jumps', () => {
    const filtered = make(), plain = unfiltered();
    const rows = [
        [0, 10, {}, 0],
        [10, 10.013, {}, NaN], [20, 10.017, {}, NaN],
        [30, 9.9, {state: 'paused'}, 0], [40, 10.04, {}, NaN],
        [300, 10.04, {sampledAt: 40, freshAt: 40}, .25],
        [400, 10.04, {sampledAt: 40, freshAt: 40}, 0],
        [410, 10.41, {}, 0], [420, 10.42, {}, NaN],
        [430, 10.43, {endTime: 10.425}, 'remaining'],
        [440, 10.425, {state: 'ended', endTime: 10.425}, 0],
        [450, 2, {epoch: 2}, 0],
        [460, 1, {epoch: 2, state: 'rewind'}, 0],
        [470, .5, {epoch: 3, state: 'count-in'}, 0],
    ];
    const intervals = [];
    for (const clock of [filtered, plain]) {
        let previous;
        const frames = [];
        clock.trace(true);
        for (const [wall, position, options, expected] of rows) {
            const time = sample(clock, wall, position, wall + 100, options);
            if (Number.isNaN(expected)) assert.ok(Number.isNaN(clock.zoomSongDelta()), `${wall}: normal fallback`);
            else assert.equal(clock.zoomSongDelta(), expected === 'remaining' ? time - previous : expected,
                `${wall}: only usable song time may drive zoom`);
            if (expected === 'remaining') assert.ok(time > previous && time === 10.425);
            frames.push(clock.frameMotionDelta());
            previous = time;
        }
        intervals.push(frames);
    }
    // Filtering may change displayed time and its delta, but not the audio
    // target, transport metadata, or the chosen camera interval.
    const a = filtered.diagnostics(), b = plain.diagnostics();
    for (let i = 0; i < rows.length; i++) for (const column of [0, 2, 3, 4, 5, 6, 7, 8, 9, 11])
        assert.equal(a.rows[i][column], b.rows[i][column]);
    assert.deepEqual(intervals[0], intervals[1]);
    assert.deepEqual(intervals[0], [NaN, .01, .01, NaN, NaN, NaN, NaN, NaN, .01, NaN, NaN, NaN, NaN, NaN]);
    for (const clock of [filtered, plain]) {
        clock.reset();
        sample(clock, 0, 10, 100);
        sample(clock, 10, 10.01, 110);
        const held = sample(clock, 300, 10.01, 400, {sampledAt: 10, freshAt: 10});
        const end = sample(clock, 310, 11, 410, {endTime: 10.5});
        assert.equal(end, 10.5);
        assert.ok(end - held > .2, 'fixture must recover a real source gap at song end');
        assert.equal(clock.zoomSongDelta(), 0, 'recovery reaching the end must not spend the catch-up jump');
        clock.reset();
        assert.ok(Number.isNaN(clock.zoomSongDelta()));
        assert.ok(Number.isNaN(clock.frameMotionDelta()));
    }
});

test('a short correction-velocity filter reduces known-truth callback jitter without moving the audio target', () => {
    for (const rate of [.25, 1, 2]) {
        const a = make(), b = unfiltered();
        a.trace(true); b.trace(true);
        const filteredMotion = [], oldMotion = [], filteredSteps = [], oldSteps = [];
        const filteredPhase = [], oldPhase = [];
        let prior, oldPrior, priorSpeed, oldPriorSpeed;
        for (let i = 0; i <= 2000; i++) {
            const nominal = i * 10, jitter = 3 * Math.sin(i * .7) + 1.5 * Math.sin(i * 1.9);
            const wall = nominal + 5 + jitter, frame = nominal + 100;
            const target = 10 + wall * rate / 1000, truth = 10 + (nominal + 5) * rate / 1000;
            const actual = sample(a, wall, target, frame, {rate});
            const old = sample(b, wall, target, frame, {rate});
            if (i > 100) {
                const speed = (actual - prior) / rate / .01, oldSpeed = (old - oldPrior) / rate / .01;
                filteredMotion.push((actual - prior) / rate * 1000 - 10);
                oldMotion.push((old - oldPrior) / rate * 1000 - 10);
                filteredPhase.push((actual - truth) / rate * 1000);
                oldPhase.push((old - truth) / rate * 1000);
                if (priorSpeed != null) { filteredSteps.push(speed - priorSpeed); oldSteps.push(oldSpeed - oldPriorSpeed); }
                priorSpeed = speed; oldPriorSpeed = oldSpeed;
            }
            prior = actual; oldPrior = old;
        }
        assert.ok(rms(filteredMotion) < rms(oldMotion) * .6);
        assert.ok(rms(filteredSteps) < rms(oldSteps) * .5);
        assert.ok(rms(filteredPhase) < rms(oldPhase) * .75);
        assert.ok(Math.abs(filteredPhase.reduce((sum, n) => sum + n, 0) / filteredPhase.length) < .003);
        // Target/raw/source metadata are unchanged, including the independent
        // animation-clock origin. Only the returned visual time/delta may differ.
        const currentRows = a.diagnostics().rows, referenceRows = b.diagnostics().rows;
        for (let i = 0; i < currentRows.length; i++) for (const column of [0,2,3,4,5,6,7,8,9,11])
            assert.equal(currentRows[i][column], referenceRows[i][column]);
    }
});

test('true source steps retain bounded response, and clock drift gains no persistent filter bias', () => {
    for (const sign of [-1, 1]) {
        const a = make(), b = unfiltered();
        const halfResponse = [null, null];
        let maximumExtraError = 0;
        for (let i = 0; i <= 1000; i++) {
            const wall = i * 10 + 5, target = 10 + wall / 1000 + (i >= 500 ? sign * .01 : 0);
            const actual = sample(a, wall, target, i * 10 + 100);
            const old = sample(b, wall, target, i * 10 + 100);
            if (i >= 500) {
                const errors = [Math.abs(actual - target), Math.abs(old - target)];
                maximumExtraError = Math.max(maximumExtraError, errors[0] - errors[1]);
                errors.forEach((error, index) => { if (halfResponse[index] == null && error <= .005) halfResponse[index] = (i - 500) * 10; });
                assert.ok(errors[0] <= .01, 'source-step correction must not amplify the 10ms phase step');
            }
        }
        assert.equal(halfResponse[0], 80); assert.equal(halfResponse[1], 70);
        assert.ok(maximumExtraError < .0009, 'bound the additional transient source-step lag');
    }
    for (const kind of ['audio', 'frame']) {
        const a = make(), b = unfiltered();
        const errors = [], differences = [];
        for (let i = 0; i <= 2000; i++) {
            const nominal = i * 10, wall = nominal + 5;
            const target = 10 + wall / 1000 + (kind === 'audio' ? nominal * .000001 : 0);
            const frame = nominal + 100 + (kind === 'frame' ? nominal * .002 : 0);
            const actual = sample(a, wall, target, frame), old = sample(b, wall, target, frame);
            if (i > 1900) { errors.push(actual - target); differences.push(actual - old); }
        }
        assert.ok(Math.max(...errors.map(Math.abs)) < .0003);
        assert.ok(Math.max(...differences.map(Math.abs)) < 1e-10, 'no extra steady bias from the velocity pole');
    }
});

test('velocity state clears at all transport boundaries and wall fallbacks, independently per clock', () => {
    function warm() {
        const c = inspectVelocity();
        sample(c, 0, 10, 100); sample(c, 10, 10.013, 110); sample(c, 20, 10.017, 120);
        assert.ok(Number.isFinite(c.testVelocity())); return c;
    }
    const cases = [
        ['absent', 30, undefined, {}], ['invalid', 30, NaN, {}], ['infinite', 30, Infinity, {}],
        ['repeated', 30, 120, {}], ['backward', 30, 119, {}], ['origin jump', 30, 230, {}],
        ['long wall gap', 400, 500, {}], ['rate', 30, 130, {rate: 2}],
        ['generation', 30, 130, {generation: 2}], ['epoch', 30, 130, {epoch: 2}],
        ['stale', 30, 130, {freshAt: -230}], ['end', 30, 130, {endTime: 10.025}],
        ...['paused', 'buffering', 'seeking', 'ended', 'rewind', 'count-in']
            .map(state => [state, 30, 130, {state}]),
    ];
    for (const [name, wall, frame, options] of cases) {
        const c = warm(); sample(c, wall, 10.03, frame, options);
        assert.ok(Number.isNaN(c.testVelocity()), name);
    }
    const recovery = warm();
    sample(recovery, 30, 10.03, 130, {freshAt: -230}); sample(recovery, 40, 10.04, 140);
    assert.ok(Number.isNaN(recovery.testVelocity()), 'source recovery must not reuse an old velocity');
    sample(recovery, 50, 10.05, 150); assert.ok(Number.isFinite(recovery.testVelocity()));
    const a = warm(), b = warm(); a.reset();
    assert.ok(Number.isNaN(a.testVelocity())); assert.ok(Number.isFinite(b.testVelocity()));
});

test('accepted gross catch-up preserves its frame interval and leaves no correction-velocity impulse', () => {
    const rows = [
        [132784.60000000894, 140.22180112199135, 132874.9],
        [132853.60000000894, 140.299763333344, 132895],
        [132862.60000000894, 140.30909438333904, 132954.9],
        [132868.70000000298, 140.31519438333308, 132965],
    ];
    const c = inspectVelocity(), old = unfiltered();
    for (let i = 0; i < rows.length; i++) {
        const actual = sample(c, ...rows[i]), expected = sample(old, ...rows[i]);
        assert.equal(actual, expected, 'the catch-up and first following correction stay unfiltered');
        if (i === 1) assert.ok(c.testVelocity() > 0);
        if (i === 2) {
            assert.ok(Number.isNaN(c.testVelocity()));
            assert.equal(c.frameMotionDelta(), (rows[2][2] - rows[1][2]) / 1000);
            assert.ok(Math.abs(actual - rows[i][1]) < .002);
        }
        if (i === 3) { assert.ok(c.testVelocity() < 0); assert.ok(Math.abs(actual - rows[i][1]) < .003); }
    }
});

test('filtered correction remains rate-capped and monotonic across extreme target reversals', () => {
    for (const rate of [.25, 1, 2, 4]) {
        const c = make(); let previous = sample(c, 0, 10, 100, {rate});
        for (let i = 1; i < 400; i++) {
            const target = 10 + i * .01 * rate + (i % 7 < 3 ? 10 : -10);
            const actual = sample(c, i * 10, target, i * 10 + 100, {rate});
            const delta = actual - previous, advance = .01 * rate;
            assert.ok(delta >= advance * .8 - 1e-12 && delta <= advance * 1.2 + 1e-12);
            previous = actual;
        }
    }
});

test('retained correction velocity can briefly cross an aligned target, within the existing speed cap', () => {
    const c = inspectVelocity();
    sample(c, 0, 0, 100);
    const first = sample(c, 10, .034, 110);
    assert.equal(first, .012);
    assert.equal(c.testVelocity(), .2);
    const alignedTarget = first + .01;
    const actual = sample(c, 20, alignedTarget, 120);
    const expectedResidual = .002 * Math.exp(-.5);
    assert.ok(Math.abs(actual - alignedTarget - expectedResidual) < 1e-17);
    assert.ok(actual - alignedTarget < .001214);
    assert.ok(actual - first <= .012);
    // This is an explicit transient tradeoff, not a claim of exact instantaneous
    // target tracking. Subsequent corrections converge with no lasting offset.
    let last = actual;
    for (let i = 3; i <= 100; i++) last = sample(c, i * 10, alignedTarget + (i - 2) * .01, i * 10 + 100);
    assert.ok(Math.abs(last - (alignedTarget + .98)) < 1e-6);
});
