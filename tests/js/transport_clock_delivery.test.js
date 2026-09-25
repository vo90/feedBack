const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const transport = fs.readFileSync(path.join(__dirname, '../../static/js/transport.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

// Drive the actual transport poller and renderer clock against an independent
// native clock. Delays are asymmetric: a late request may return a fresh read,
// while a fast request may have a delayed reply. Frames continue in both cases.
async function simulate(rate, durationMs, streaming = false) {
    let now = 0, timerId = 0, requests = 0, inFlight = 0, maxInFlight = 0;
    const timers = new Map(), deliveries = [];
    const outbound = streaming ? [4, 120, 160, 20, 140, 80, 0, 170] : [4, 90, 145, 180, 5, 120];
    const inbound = streaming ? [4, 0, 0, 130, 0, 0, 80, 0] : [4, 4, 3, 5, 120, 8];
    let streamCallback = null, nextPush = 0;
    function snapshotAt(read) {
        const published = Math.floor(read / (256 / 48)) * (256 / 48);
        return {version: 1, valid: true, position: 10 + published * rate / 1000,
            ageMs: read - published, sequence: Math.floor(read / (256 / 48)), generation: 1, rate,
            playing: true, ended: false, clockId: 100, readAtMs: read + 12345, readUncertaintyMs: 0};
    }
    const api = {getBackingSnapshot() {
        const index = requests++ % outbound.length;
        const read = now + outbound[index], arrival = read + inbound[index];
        const snapshot = snapshotAt(read);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise(resolve => deliveries.push({arrival, resolve: () => {inFlight--; resolve(snapshot);}}));
    }};
    if (streaming) api.subscribeBackingSnapshots = callback => {
        streamCallback = callback; return () => {streamCallback = null;};
    };
    const context = vm.createContext({performance: {now: () => now}, console,
        setTimeout(fn, delay) {const id = ++timerId; timers.set(id, {fn, due: now + delay}); return id;},
        clearTimeout: id => timers.delete(id), _emitSongPositionChanged() {},
        window: {feedBackDesktop: {audio: api}}});
    const tStart = transport.indexOf('export const jucePlayer = {');
    const tEnd = transport.indexOf('\n};', tStart) + 4;
    vm.runInContext(transport.slice(tStart, tEnd).replace('export const', 'var'), context);
    const cStart = renderer.indexOf('    function createPresentationClock() {');
    const cEnd = renderer.indexOf('    // End presentation clock.', cStart);
    vm.runInContext(renderer.slice(cStart, cEnd), context);
    const j = context.jucePlayer, clock = context.createPresentationClock();
    j._pos = 10; j._dur = 10000; j._speed = rate; j._startPolling();
    const errors = []; let previous, negative = 0;
    for (now = 0; now <= durationMs; now += 5) {
        if (streamCallback && now >= nextPush) {
            nextPush = now + 50;
            const callback = streamCallback, snapshot = snapshotAt(now);
            // Some packets arrive after their successors; ordering must hold.
            deliveries.push({arrival: now + (now % 350 === 0 ? 130 : 5),
                resolve: () => callback(snapshot)});
        }
        for (let i = deliveries.length - 1; i >= 0; i--) if (deliveries[i].arrival <= now) {
            deliveries.splice(i, 1)[0].resolve();
        }
        await Promise.resolve();
        for (const [id, timer] of timers) if (timer.due <= now) {
            timers.delete(id); void timer.fn();
        }
        await Promise.resolve();
        if (now % 10 !== 0) continue;
        const sample = j.getClockSnapshot();
        const time = clock.sample(j.currentTime, now, {...sample, epoch: 1, state: 'playing'});
        if (previous !== undefined && time < previous - 1e-9) negative++;
        if (now > 2000) errors.push(Math.abs(time - (10 + now * rate / 1000)) * 1000);
        previous = time;
    }
    j._stopPolling(); errors.sort((a,b) => a-b);
    return {negative, maxInFlight, requests, p95: errors[Math.floor(errors.length*.95)], max: errors.at(-1)};
}

for (const rate of [.5, 1, 1.5, 2]) test(`real poller stays aligned through delayed IPC at ${rate}x`, async () => {
    const result = await simulate(rate, rate === 1 ? 600000 : 30000);
    assert.equal(result.negative, 0);
    assert.equal(result.maxInFlight, 1);
    assert.ok(result.p95 <= 20, JSON.stringify(result));
    assert.ok(result.max <= 50, JSON.stringify(result));
});

for (const rate of [.5, 1, 1.5, 2]) test(`stream stays aligned through delayed polls and reordered packets at ${rate}x`, async () => {
    const result = await simulate(rate, rate === 1 ? 600000 : 30000, true);
    assert.equal(result.negative, 0); assert.equal(result.maxInFlight, 1);
    assert.ok(result.p95 <= 20, JSON.stringify(result));
    assert.ok(result.max <= 50, JSON.stringify(result));
});
