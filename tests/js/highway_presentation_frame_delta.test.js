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

test('matching frame and wall deltas preserve exact legacy output at different origins and rates', () => {
    for (const origin of [0, 100, 100000]) for (const rate of [.25, 1, 2]) {
        const a = make(), b = reference();
        let wall = 1000;
        for (let i = 0; i < 240; i++) {
            wall += [10, 10, 20, 30, 10][i % 5];
            const raw = 10 + wall / 1000 * rate;
            const options = { rate, state: i >= 60 && i < 80 ? 'paused' : 'playing',
                epoch: i < 120 ? 1 : 2, freshAt: i >= 160 && i < 200 ? 2000 : wall };
            assert.equal(sample(a, wall, raw, wall + origin, options),
                sample(b, wall, raw, wall + origin, options));
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
