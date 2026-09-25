const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = src.indexOf('    function createPresentationClock() {');
const end = src.indexOf('    // End presentation clock.', start);
const ctx = vm.createContext({});
vm.runInContext(src.slice(start, end), ctx);
const make = () => ctx.createPresentationClock();
const sample = (clock, now, position, options = {}) => clock.sample(position, now, {
    epoch: 1, state: 'playing', rate: 1, position, sampledAt: now, freshAt: now,
    endTime: Infinity, ...options,
});
test('small backward corrections never rewind but a 1ms explicit seek does', () => {
    const c = make(); let before = sample(c, 0, 10);
    for (let i = 1; i <= 100; i++) {
        const next = sample(c, i * 10, 10 + i / 100 - (i % 10 === 0 ? 0.03 : 0));
        assert.ok(next > before); before = next;
    }
    assert.equal(sample(c, 1010, before - 0.001, {epoch: 2}), before - 0.001);
});
test('pause immediately freezes presentation; resume never snaps backwards', () => {
    const c = make(); sample(c, 0, 10); const held = sample(c, 10, 10.01);
    assert.equal(sample(c, 20, 9.99, {state: 'paused'}), held);
    assert.equal(sample(c, 1000, 9.99, {state: 'paused'}), held);
    assert.ok(sample(c, 1010, 10) > held);
});
test('stale source freezes after a finite budget without creep and rewind', () => {
    const c = make(); sample(c, 0, 10); let previous = 10;
    for (let now = 10; now <= 2000; now += 10) {
        const value = sample(c, now, 10 + now / 1000, {freshAt: 0});
        assert.ok(value >= previous); assert.ok(value <= 10.3);
        if (now > 250) assert.equal(value, previous);
        previous = value;
    }
    assert.ok(sample(c, 2010, 10.1) >= previous);
});
test('end of track cannot overshoot and snap back', () => {
    const c = make(); sample(c, 0, 9.98, {endTime: 10});
    for (let now = 10; now <= 500; now += 10) {
        const value = sample(c, now, 9.98, {sampledAt: 0, endTime: 10});
        assert.ok(value <= 10);
    }
    assert.equal(sample(c, 510, 10, {state: 'ended', endTime: 10}), 10);
});
test('loop/count-in rewind is explicit and holds at the start', () => {
    const c = make(); sample(c, 0, 20);
    assert.equal(sample(c, 10, 15, {state: 'rewind'}), 15);
    assert.equal(sample(c, 20, 10, {state: 'count-in', epoch: 2}), 10);
    assert.equal(sample(c, 1020, 10, {state: 'count-in', epoch: 2}), 10);
    assert.ok(sample(c, 1030, 10.01, {epoch: 2}) >= 10);
});
test('long frames and tab return do not rewind the timeline', () => {
    const c = make(); sample(c, 0, 10); const prior = sample(c, 10, 10.01);
    assert.ok(sample(c, 310, 9.99) >= prior);
    assert.equal(sample(c, 1000, 11), 11);
});
for (const hz of [30, 40, 60, 100, 144]) for (const rate of [0.25, 0.5, 1, 1.5, 2]) {
    test(`timestamped coarse samples stay continuous and aligned at ${hz}Hz/${rate}x`, () => {
        const c = make(); let previous;
        for (let i = 0; i < hz * 10; i++) {
            const now = i * 1000 / hz, sampledAt = Math.floor(now / 113) * 113;
            const position = 10 + sampledAt * rate / 1000;
            const time = sample(c, now, position, {rate, sampledAt, freshAt: sampledAt});
            if (previous != null) assert.ok(time >= previous);
            assert.ok(Math.abs(time - (10 + now * rate / 1000)) < 1e-8);
            previous = time;
        }
    });
}
test('speed changes are continuous and follow the new rate', () => {
    const c = make(); sample(c, 0, 10); let before = sample(c, 1000, 11);
    for (let i = 1; i <= 100; i++) {
        const time = sample(c, 1000 + i * 10, 11 + i * .005, {rate: .5});
        assert.ok(time >= before); assert.ok(Math.abs(time - (11 + i * .005)) < 1e-8); before = time;
    }
});
test('bounded diagnostics are opt-in and record reasons', () => {
    const c = make(); assert.equal(c.diagnostics(), null); c.trace(true);
    for (let i = 0; i < 5000; i++) sample(c, i * 10, i / 100);
    const d = c.diagnostics(); assert.equal(d.count, 5000); assert.equal(d.rows.length, 4096);
    assert.ok(Math.abs(d.rows.at(-1)[1] - 49.99) < 1e-8); c.trace(false); assert.equal(c.diagnostics(), null);
});
test('captured native polling corrections do not reverse presentation', () => {
    const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/highway-clock-corrections.json')));
    for (const run of fixtures) {
        const c = make(); let previous;
        for (const [now, raw, nativePos, pollAt] of run.frames) {
            const time = sample(c, now, raw, {position: nativePos, sampledAt: pollAt, freshAt: pollAt});
            if (previous != null) assert.ok(time >= previous, `${run.name} reversed at ${now}`);
            previous = time;
        }
    }
});

test('ten minute timestamped run bounds phase error under quantization and jitter', () => {
    const c = make(); let previous, observed = 10, at = 0, nextPoll = 0;
    const errors = [];
    for (let now = 0, i = 0; now <= 600000; now += 10, i++) {
        if (now >= nextPoll) {
            at = Math.floor(now / (256 / 48)) * (256 / 48);
            // Arrival-time uncertainty changes each poll; unlike the old clock
            // this is measured around a coherent source position/timestamp.
            const uncertainty = [0, 3, -2, 8, -5][i % 5];
            observed = 10 + at / 1000;
            at += uncertainty; nextPoll = now + 100 + [0, 20, 10][i % 3];
        }
        const value = sample(c, now, observed, {position: observed, sampledAt: at, freshAt: at});
        if (previous != null) assert.ok(value >= previous);
        if (now > 1000) errors.push(Math.abs(value - (10 + now / 1000)));
        previous = value;
    }
    errors.sort((a, b) => a - b);
    assert.ok(errors[Math.floor(errors.length * .95)] < .02);
    assert.ok(errors.at(-1) < .05);
    assert.ok(Math.abs(previous - 610) < .02);
});
