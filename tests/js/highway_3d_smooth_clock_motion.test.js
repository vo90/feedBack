const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = source.indexOf('        function smoothNow(bundle) {');
const end = source.indexOf('\n        /* ── Per-frame rendering', start);
assert.ok(start >= 0 && end > start);

function clock() {
    let now = 0;
    const state = {
        performance: { now: () => now },
        _clkAudioT: NaN, _clkPerf: NaN, _clkRate: 1,
        _clkFramePerf: NaN, _clkRateAudioT: NaN, _clkRatePerf: NaN,
        _frameNow: 0,
    };
    vm.createContext(state);
    vm.runInContext(source.slice(start, end), state);
    return (p, raw, options = {}) => {
        now = p;
        return state.smoothNow({ currentTime: raw, ...options });
    };
}

for (const hz of [60, 144]) for (const rate of [0.5, 1, 1.5]) {
    test(`coarse audio samples scroll continuously at ${hz} Hz and ${rate}x`, () => {
        const sample = clock();
        let previous;
        for (let i = 0; i < hz * 4; i++) {
            const p = i * 1000 / hz;
            // A 60 Hz host reads an audio timestamp refreshed every 23 ms.
            const tick = Math.floor((p + 1e-7) / (1000 / 60)) * (1000 / 60);
            const raw = 10 + Math.floor(tick / 23) * 0.023 * rate;
            const rendered = sample(p, raw, { isPlaying: true, playbackRate: rate });
            if (i > hz / 2) {
                const travel = (rendered - previous) / (rate / hz);
                assert.ok(travel >= 0.8 - 1e-8 && travel <= 1.2 + 1e-8,
                    `frame ${i} moved by ${travel.toFixed(3)} normal frames`);
                assert.ok(Math.abs(rendered - (10 + p / 1000 * rate)) < 0.045 * rate,
                    'smoothing must stay aligned with audio');
            }
            previous = rendered;
        }
    });
}

test('pause, loop wrap, seek and long gaps snap directly to the transport', () => {
    const sample = clock();
    assert.equal(sample(0, 20, { isPlaying: true, playbackRate: 1 }), 20);
    sample(16, 20.021, { isPlaying: true, playbackRate: 1 });
    assert.equal(sample(32, 20.021, { isPlaying: false }), 20.021);
    assert.equal(sample(48, 20.021, { isPlaying: false }), 20.021);
    assert.equal(sample(64, 2, { isPlaying: true }), 2, 'loop/backward seek');
    assert.equal(sample(80, 40, { isPlaying: true }), 40, 'forward seek');
    assert.equal(sample(500, 40.3, { isPlaying: true }), 40.3, 'long frame/tab return');
});

test('a declared speed change changes travel immediately without a visual jump', () => {
    const sample = clock();
    let rendered;
    for (let i = 0; i <= 60; i++) rendered = sample(i * 1000 / 60, 5 + i / 60,
        { isPlaying: true, playbackRate: 1 });
    const next = sample(1000 + 1000 / 60, 6 + 0.5 / 60,
        { isPlaying: true, playbackRate: 0.5 });
    assert.ok(next - rendered >= 0.8 * 0.5 / 60);
    assert.ok(next - rendered <= 1.2 * 0.5 / 60);
});

test('hosts without rate metadata learn slow playback without long-term drift', () => {
    const sample = clock();
    let previous;
    for (let i = 0; i < 600; i++) {
        const p = i * 1000 / 60;
        const raw = 3 + Math.floor(p / 23) * 0.023 * 0.5;
        const value = sample(p, raw, { isPlaying: true });
        if (i > 60) {
            assert.ok(value > previous);
            assert.ok(Math.abs(value - (3 + p / 1000 * 0.5)) < 0.035);
        }
        previous = value;
    }
});

test('an unreported audio stall stops extrapolation and resumes at the new sample', () => {
    const sample = clock();
    sample(0, 2);
    sample(16, 2.02);
    assert.ok(sample(32, 2.02) > 2.02);
    assert.equal(sample(120, 2.02), 2.02);
    assert.equal(sample(136, 2.02), 2.02);
    assert.equal(sample(152, 2.06), 2.06);
});

test('each renderer has an independent clock', () => {
    const a = clock(), b = clock();
    assert.equal(a(0, 12, { playbackRate: 1 }), 12);
    assert.equal(b(0, 40, { playbackRate: 0.5 }), 40);
    assert.ok(a(16, 12.016, { playbackRate: 1 }) < 13);
    assert.ok(b(16, 40.008, { playbackRate: 0.5 }) > 40);
});
