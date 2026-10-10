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
