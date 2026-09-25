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
function harness() {
    let now = 0, serial = 0;
    const timers = new Map(), replies = [];
    const api = {getBackingPosition() { const d = deferred(); replies.push(d); return d.promise; },
        seekBacking: async () => {}, stopBacking: async () => {}, startBacking: async () => {}};
    const state = {performance: {now: () => now}, console: {warn() {}},
        setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id), audioSeekGen: () => 1,
        _queueBackingCommand: fn => Promise.resolve().then(fn), _emitSongPositionChanged() {},
        window: {feedBackDesktop: {audio: api}}};
    vm.createContext(state);
    vm.runInContext(src.slice(start, end).replace('export const jucePlayer', 'var jucePlayer'), state);
    const j = state.jucePlayer;
    j._pos = 10; j._dur = 300; j._startPolling();
    return {j, api, timers, replies, setNow: v => { now = v; },
        fire() { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); }};
}
test('a pre-seek reply cannot overwrite the completed seek', async () => {
    const h = harness(); h.setNow(100); const pending = h.fire();
    await h.j.seek(20); h.setNow(120); h.replies[0].resolve(10.1); await pending;
    assert.ok(h.j.currentTime >= 20 && h.j.currentTime < 20.1);
    assert.equal(h.timers.size, 1);
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
