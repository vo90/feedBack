const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../static/js/transport.js'), 'utf8');
const start = src.indexOf('export const jucePlayer = {');
const end = src.indexOf('\n};', start) + 4;
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return {promise, resolve, reject};
}
function harness(stream = false) {
    let now = 0, serial = 0;
    const timers = new Map(), replies = [], delays = [];
    const api = {getBackingPosition() { const d = deferred(); replies.push(d); return d.promise; },
        seekBacking: async () => {}, stopBacking: async () => {}, startBacking: async () => {}};
    const subscriptions = [];
    if (stream) api.subscribeBackingSnapshots = callback => {
        const subscription = {callback, stops: 0}; subscriptions.push(subscription);
        return () => subscription.stops++;
    };
    const state = {performance: {now: () => now}, console: {warn() {}},
        setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, fn); delays.push(delay); return id; },
        clearTimeout: id => timers.delete(id), audioSeekGen: () => 1,
        _queueBackingCommand: fn => Promise.resolve().then(fn), _emitSongPositionChanged() {},
        window: {feedBackDesktop: {audio: api}}};
    vm.createContext(state);
    vm.runInContext(src.slice(start, end).replace('export const jucePlayer', 'var jucePlayer'), state);
    const j = state.jucePlayer;
    j._pos = 10; j._dur = 300; j._startPolling();
    return {j, api, timers, replies, delays, subscriptions, setNow: v => { now = v; },
        fire() { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); }};
}
test('a pre-seek reply cannot overwrite the completed seek', async () => {
    const h = harness(); h.setNow(100); const pending = h.fire();
    await h.j.seek(20); h.setNow(120); h.replies[0].resolve(10.1); await pending;
    assert.ok(h.j.currentTime >= 20 && h.j.currentTime < 20.1);
    assert.equal(h.timers.size, 1);
});

function packet(sequence, position, read = 100) {
    return {version: 1, valid: true, position, ageMs: 0, sequence, generation: 1,
        rate: 1, playing: true, clockId: 123, readAtMs: read + 7000, readUncertaintyMs: 0};
}
async function calibratedStream() {
    const h = harness(true); h.setNow(100);
    h.api.getBackingSnapshot = async () => packet(1, 10.1);
    await h.fire(); return h;
}
test('stream and poll share ordering, but superseded polls still calibrate clocks', async () => {
    const h = await calibratedStream(), callback = h.subscriptions[0].callback;
    h.setNow(200); const reply = deferred(); h.api.getBackingSnapshot = () => reply.promise;
    const pending = h.fire(); h.setNow(250); callback(packet(3, 10.25, 250));
    h.setNow(300); reply.resolve(packet(2, 10.21, 210)); await pending;
    assert.equal(h.j._sampleSequence, 3); assert.equal(h.j._pos, 10.25);
    assert.equal(h.j._clockMapping.at, 300);
    callback(packet(2, 10.21, 210)); assert.equal(h.j._pos, 10.25);
});
test('pause and seek remove subscriptions and reject queued packets from their old owner', async () => {
    const h = await calibratedStream(), old = h.subscriptions[0];
    await h.j.seek(20); old.callback(packet(99, 10.3, 300));
    assert.equal(old.stops, 1); assert.equal(h.j._pos, 20);
    const current = h.subscriptions.at(-1); await h.j.pause();
    const frozen = h.j.currentTime; current.callback(packet(100, 21, 1000));
    assert.equal(current.stops, 1); assert.equal(h.j.currentTime, frozen);
});
test('ongoing stream progresses through a hung poll and expires without clock calibration', async () => {
    const h = await calibratedStream(), callback = h.subscriptions[0].callback;
    h.setNow(200); h.api.getBackingSnapshot = () => new Promise(() => {}); void h.fire();
    h.setNow(300); callback(packet(3, 10.3, 300));
    h.setNow(500); callback(packet(4, 10.5, 500)); assert.equal(h.j.currentTime, 10.5);
    h.setNow(800); callback(packet(5, 10.5, 800));
    assert.equal(h.j.getClockSnapshot().freshAt, 500, 'stationary audio cannot renew freshness');
    h.setNow(30101); callback(packet(1000, 40.101, 30101));
    assert.equal(h.j._sampleSequence, 5, 'expired calibration must not extrapolate indefinitely');
    h.j._stopPolling();
});
test('a late reply cannot move a paused playhead', async () => {
    const h = harness(); h.setNow(100); const pending = h.fire();
    h.setNow(150); await h.j.pause(); const frozen = h.j.currentTime;
    h.setNow(170); h.replies[0].resolve(10.1); await pending;
    assert.equal(h.j.currentTime, frozen); assert.equal(h.timers.size, 0);
});
test('an old completion cannot create a second polling chain after restart', async () => {
    const h = harness(); const pending = h.fire(); h.j._stopPolling(); h.j._startPolling();
    h.replies[0].resolve(10.1); await pending; assert.equal(h.timers.size, 1);
});
test('an old rejection cannot create a second polling chain after restart', async () => {
    const h = harness(); const pending = h.fire(); h.j._stopPolling(); h.j._startPolling();
    h.replies[0].reject(Error('late rejection')); await pending; assert.equal(h.timers.size, 1);
});
test('rate changes invalidate positions measured at the previous rate', async () => {
    const h = harness(); h.setNow(100); const pending = h.fire(); h.j.setRate(0.5);
    h.setNow(120); h.replies[0].resolve(10); await pending;
    assert.ok(Math.abs(h.j.currentTime - 10.11) < 1e-8); assert.equal(h.timers.size, 1);
});
test('failure of an older seek cannot roll back a newer seek', async () => {
    const h = harness(), old = deferred();
    h.api.seekBacking = () => old.promise;
    const a = h.j.seek(20); h.api.seekBacking = async () => {}; await h.j.seek(30);
    old.reject(Error('old seek failed')); await a.catch(() => {});
    assert.ok(h.j.currentTime >= 30); assert.equal(h.timers.size, 1);
});

test('native timestamp uses sample age and request bracket instead of receipt time', async () => {
    const h = harness(), reply = deferred();
    h.api.getBackingSnapshot = () => reply.promise;
    h.setNow(100); const pending = h.fire(); h.setNow(120);
    reply.resolve({version: 1, valid: true, position: 10.1, ageMs: 5,
        sequence: 1, generation: 1, rate: 1, playing: true});
    await pending;
    assert.equal(h.j._pollAt, 105);
    assert.ok(Math.abs(h.j.currentTime - 10.115) < 1e-8);
    assert.equal(h.j.getClockSnapshot().freshAt, 105);
});
test('old native addon falls back to the number API once', async () => {
    const h = harness(); let calls = 0;
    h.api.getBackingSnapshot = async () => { calls++; return null; };
    h.api.getBackingPosition = async () => 10.1;
    await h.fire(); await h.fire();
    assert.equal(calls, 1); assert.equal(h.j._pos, 10.1);
});
test('invalid, out-of-order and excessively delayed snapshots cannot re-anchor', async () => {
    const h = harness(); let value = {version: 1, valid: true, position: 10.1, ageMs: 2,
        sequence: 5, generation: 2, rate: 1, playing: true};
    h.api.getBackingSnapshot = async () => value; await h.fire();
    const baseline = value;
    for (const change of [{sequence: 4}, {generation: 1, sequence: 6}, {valid: false, sequence: 6},
        {position: NaN, sequence: 6}, {ageMs: -1, sequence: 6}, {rate: 2, sequence: 6}]) {
        value = {...baseline, ...change, position: Number.isNaN(change.position) ? NaN : 30};
        await h.fire(); assert.equal(h.j._pos, 10.1);
    }
    const late = deferred(); h.api.getBackingSnapshot = () => late.promise;
    const pending = h.fire(); h.setNow(150);
    late.resolve({version: 1, valid: true, position: 20, ageMs: 0,
        sequence: 20, generation: 20, rate: 1, playing: true}); await pending;
    assert.equal(h.j._pos, 10.1); assert.equal(h.timers.size, 1);
});
test('fresh replies with a non-advancing source do not renew extrapolation', async () => {
    const h = harness(); let sequence = 0;
    h.api.getBackingSnapshot = async () => ({version: 1, valid: true, position: 10,
        ageMs: 0, sequence: ++sequence, generation: 1, rate: 1, playing: true});
    h.setNow(100); await h.fire(); const fresh = h.j.getClockSnapshot().freshAt;
    h.setNow(300); await h.fire(); assert.equal(h.j.getClockSnapshot().freshAt, fresh);
});
test('a snapshot requested before a seek is discarded', async () => {
    const h = harness(), reply = deferred(); h.api.getBackingSnapshot = () => reply.promise;
    const pending = h.fire(); await h.j.seek(20);
    reply.resolve({version: 1, valid: true, position: 10, ageMs: 0,
        sequence: 3, generation: 1, rate: 1, playing: true}); await pending;
    assert.equal(h.j.currentTime, 20); assert.equal(h.timers.size, 1);
});

test('timestamped source stall and native stop bound authoritative interpolation', async () => {
    const h = harness(); let playing = true, sequence = 0;
    h.api.getBackingSnapshot = async () => ({version: 1, valid: true, position: 10,
        ageMs: 0, sequence: ++sequence, generation: 1, rate: 1, playing});
    await h.fire(); h.setNow(500); assert.equal(h.j.currentTime, 10.25);
    await h.fire(); assert.equal(h.j.currentTime, 10);
    playing = false; h.setNow(600); await h.fire(); h.setNow(1000);
    assert.equal(h.j.currentTime, 10);
});

test('calibrated main timestamps preserve alignment through asymmetric IPC delays', async () => {
    const h = harness(); let sequence = 0;
    async function poll(sent, mainRead, received) {
        const reply = deferred(); h.api.getBackingSnapshot = () => reply.promise;
        h.setNow(sent); const pending = h.fire(); h.setNow(received);
        reply.resolve({version: 1, valid: true, position: 10 + (mainRead - 5) / 1000,
            ageMs: 5, sequence: ++sequence, generation: 1, rate: 1, playing: true,
            clockId: 123, readAtMs: mainRead + 7000, readUncertaintyMs: 0});
        await pending;
        assert.equal(h.j._sampleSequence, sequence, 'a useful late observation must not be discarded');
        assert.ok(Math.abs(h.j.currentTime - (10 + received / 1000)) < .006,
            `clock phase at ${received}ms: ${h.j.currentTime}`);
    }
    await poll(100, 105, 110); // Establish the cross-process offset to +/- 5 ms.
    await poll(200, 368, 370); // Delayed outbound request, fresh native read.
    await poll(380, 382, 550); // Delayed return, older read needs extrapolation.
    await poll(560, 695, 700);
    assert.equal(h.timers.size, 1);
});

test('poll cadence accounts for request time and never creates a catch-up burst', async () => {
    const h = harness(), reply = deferred(); h.api.getBackingSnapshot = () => reply.promise;
    h.setNow(100); const pending = h.fire(); h.setNow(180);
    reply.resolve({version: 1, valid: true, position: 10.15, ageMs: 0,
        sequence: 1, generation: 1, rate: 1, playing: true}); await pending;
    assert.equal(h.delays.at(-1), 20, 'next request is due 100ms after the previous start');
    h.setNow(200); const next = deferred(); h.api.getBackingSnapshot = () => next.promise;
    const delayed = h.fire(); h.setNow(450); next.resolve(null); h.api.getBackingPosition = async () => 10.45;
    await delayed; assert.equal(h.delays.at(-1), 0); assert.equal(h.timers.size, 1);
    await h.fire(); assert.equal(h.delays.at(-1), 100); assert.equal(h.timers.size, 1);
});
