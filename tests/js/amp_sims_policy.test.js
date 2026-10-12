const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/capabilities/amp-sims.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ desktop = true, fetch } = {}) {
    const writes = [];
    let timers = 0;
    const window = { feedBack: {}, ...(desktop ? { feedBackDesktop: {} } : {}),
        fetch: fetch || (async (_, request) => { writes.push(JSON.parse(request.body)); return { ok: true, json: async () => ({ message: 'saved' }) }; }) };
    const context = vm.createContext({ window, AbortController, setTimeout: (...args) => { timers++; return setTimeout(...args); }, clearTimeout });
    vm.runInContext(source, context);
    return { policy: window.feedBack.ampSims, writes, window, context, timers: () => timers };
}

test('initial state is suspended; missing/false/nonboolean values cannot opt in; no polls', async () => {
    const h = harness();
    assert.equal(h.policy.snapshot().ready, false);
    assert.equal(h.policy.snapshot().enabled, false);
    for (const settings of [{}, { use_amp_sims: false }, { use_amp_sims: 'true' }, { use_amp_sims: 1 }]) {
        await h.policy.applySettings(settings);
        assert.equal(h.policy.snapshot().enabled, false);
    }
    await h.policy.applySettings({ use_amp_sims: true });
    assert.equal(h.policy.snapshot().enabled, true);
    assert.equal(h.writes.length, 0);
    assert.equal(h.timers(), 0);
});

test('pure-web is explicitly not applicable and install is idempotent', () => {
    const h = harness({ desktop: false });
    assert.equal(h.policy.snapshot().applicable, false);
    vm.runInContext(source, h.context);
    assert.equal(h.window.feedBack.ampSims, h.policy);
});

test('subscription is immediate, late subscribers see current state, unsubscribe works', async () => {
    const { policy } = harness(); const seen = [];
    const off = policy.subscribe(value => seen.push(value.enabled));
    assert.deepEqual(seen, [false]);
    await policy.applySettings({ use_amp_sims: true });
    assert.deepEqual(seen, [false, true]);
    let late; policy.subscribe(value => { late = value; });
    assert.equal(late.enabled, true);
    off(); await policy.setEnabled(false);
    assert.deepEqual(seen, [false, true]);
});

test('OFF synchronously invalidates every owner and waits for teardown', async () => {
    const h = harness(); await h.policy.applySettings({ use_amp_sims: true });
    const a = deferred(), b = deferred(), seen = [];
    h.policy.subscribe(value => { if (!value.enabled) { seen.push('a'); return a.promise; } });
    h.policy.subscribe(value => { if (!value.enabled) { seen.push('b'); return b.promise; } });
    const generation = h.policy.snapshot().generation;
    let complete = false; const stop = h.policy.setEnabled(false).then(() => { complete = true; });
    assert.equal(h.policy.snapshot().enabled, false);
    assert(h.policy.snapshot().generation > generation);
    assert.deepEqual(seen, ['a', 'b']);
    await tick(); assert.equal(complete, false);
    a.resolve(); await tick(); assert.equal(complete, false);
    b.resolve(); await stop; assert.equal(complete, true);
    assert.deepEqual(h.writes, [{ use_amp_sims: false }]);
});

test('ON waits for older teardown and successful persistence acknowledgement', async () => {
    const teardown = deferred(), ack = deferred(); let writes = 0;
    const h = harness({ fetch: async () => { writes++; await ack.promise; return { ok: true, json: async () => ({}) }; } });
    h.policy.subscribe(value => { if (!value.enabled) return teardown.promise; });
    const start = h.policy.setEnabled(true);
    await tick(); assert.equal(writes, 0); assert.equal(h.policy.snapshot().enabled, false);
    teardown.resolve(); await tick(); assert.equal(writes, 1); assert.equal(h.policy.snapshot().enabled, false);
    ack.resolve(); await start; assert.equal(h.policy.snapshot().enabled, true);
});

test('OFF supersedes an in-flight ON acknowledgement; late initial GET cannot restore', async () => {
    const ack = deferred(), writes = [];
    const h = harness({ fetch: async (_, request) => { const value = JSON.parse(request.body).use_amp_sims; writes.push(value); if (value) await ack.promise; return { ok: true, json: async () => ({}) }; } });
    const initialGeneration = h.policy.snapshot().generation;
    const on = h.policy.setEnabled(true); await tick();
    const off = h.policy.setEnabled(false);
    await h.policy.applySettings({ use_amp_sims: true }, { generation: initialGeneration });
    assert.equal(h.policy.snapshot().enabled, false);
    ack.resolve(); await Promise.all([on, off]);
    assert.deepEqual(writes, [true, false]);
    assert.equal(h.policy.snapshot().enabled, false);
});

test('ON following pending OFF cannot run while old restoration/teardown is unfinished', async () => {
    const h = harness(); await h.policy.applySettings({ use_amp_sims: true });
    const wait = deferred(); let disabledCalls = 0;
    h.policy.subscribe(value => { if (!value.enabled) { disabledCalls++; return wait.promise; } });
    const off = h.policy.setEnabled(false); const on = h.policy.setEnabled(true);
    await tick(); assert.equal(h.policy.snapshot().enabled, false); assert.equal(h.writes.length, 0);
    wait.resolve(); await Promise.all([off, on]);
    assert.equal(h.policy.snapshot().enabled, true); assert(disabledCalls >= 1);
    assert.deepEqual(h.writes, [{ use_amp_sims: true }]);
});

test('failed settings reads/writes surface an error and remain disabled', async () => {
    const h = harness({ fetch: async () => ({ ok: true, json: async () => ({ error: 'save failed' }) }) });
    await assert.rejects(h.policy.applySettings(null), /Could not read/);
    assert.equal(h.policy.snapshot().enabled, false);
    await assert.rejects(h.policy.setEnabled(true), /save failed/);
    assert.equal(h.policy.snapshot().enabled, false);
    assert.match(h.policy.snapshot().error, /save failed/);
    await assert.rejects(h.policy.setEnabled('true'), /boolean/);
});

test('throwing/rejecting subscribers cannot skip other owners or report enabled', async () => {
    const h = harness(); let other = 0;
    h.policy.subscribe(value => { if (value.enabled) throw new Error('restore failed'); });
    h.policy.subscribe(() => { other++; });
    await assert.rejects(h.policy.setEnabled(true), /restore failed/);
    assert.equal(h.policy.snapshot().enabled, false); assert(other >= 3);
});

test('fresh successful settings read recovers a prior failure only after new suspension settles', async () => {
    const h = harness();
    await assert.rejects(h.policy.applySettings(null), /Could not read/);
    const wait = deferred(); let block = false;
    h.policy.subscribe(value => { if (block && !value.enabled && !value.error) return wait.promise; });
    block = true;
    const retry = h.policy.applySettings({ use_amp_sims: true });
    await tick(); assert.equal(h.policy.snapshot().enabled, false);
    wait.resolve(); await retry;
    assert.equal(h.policy.snapshot().enabled, true); assert.equal(h.policy.snapshot().error, null);
});

test('fresh read cannot conceal a suspension failure or superseding OFF intent', async () => {
    const h = harness(); await assert.rejects(h.policy.applySettings(null));
    const unsubscribe = h.policy.subscribe(value => { if (!value.error) throw new Error('still cannot suspend'); });
    await assert.rejects(h.policy.applySettings({ use_amp_sims: true }), /still cannot suspend/);
    assert.equal(h.policy.snapshot().enabled, false); unsubscribe();
    const wait = deferred(); h.policy.subscribe(value => { if (!value.error) return wait.promise; });
    const retry = h.policy.applySettings({ use_amp_sims: true });
    await tick(); const off = h.policy.setEnabled(false); wait.resolve();
    await Promise.all([retry, off]); assert.equal(h.policy.snapshot().enabled, false);
});

test('ready OFF intent runs one final clear, without repeating it after persistence acknowledgement', async () => {
    const h = harness(); await h.policy.applySettings({ use_amp_sims: true });
    let clears = 0; h.policy.subscribe(() => { clears++; }, { phase: 'finalize' });
    const before = h.policy.snapshot().generation;
    await h.policy.setEnabled(false);
    assert.equal(clears, 1); assert.equal(h.policy.snapshot().generation, before + 1);
    assert.deepEqual(h.writes, [{ use_amp_sims: false }]);
});

test('failed suspension still persists OFF and refuses a following enable', async () => {
    const h = harness(); await h.policy.applySettings({ use_amp_sims: true });
    h.policy.subscribe(value => { if (!value.enabled) return Promise.reject(new Error('teardown failed')); });
    await assert.rejects(h.policy.setEnabled(false), /teardown failed/);
    assert.equal(h.policy.snapshot().enabled, false);
    assert.deepEqual(h.writes, [{ use_amp_sims: false }]);
    await assert.rejects(h.policy.setEnabled(true), /teardown failed/);
    assert.deepEqual(h.writes, [{ use_amp_sims: false }]);
});

test('all app entrypoints share policy boot before effects and plugin hydration', () => {
    const root = path.join(__dirname, '../..');
    const index = fs.readFileSync(path.join(root, 'static/v3/index.html'), 'utf8');
    assert(index.indexOf('capabilities/amp-sims.js') < index.indexOf('capabilities/audio-effects.js'));
    assert(index.indexOf('capabilities/amp-sims.js') < index.indexOf('/static/app.js'));
    const server = fs.readFileSync(path.join(root, 'server.py'), 'utf8');
    assert.equal((server.match(/FileResponse\(str\(STATIC_DIR \/ "v3" \/ "index.html"\)\)/g) || []).length, 2);
});

test('disabled finalizers run after all normal owners, including a late startup finalizer', async () => {
    const h = harness(), wait = deferred(), seen = [];
    h.policy.subscribe(() => { seen.push('owner'); return wait.promise; });
    h.policy.subscribe(() => { seen.push('clear'); }, { phase: 'finalize' });
    await tick(); assert.deepEqual(seen, ['owner']);
    wait.resolve(); await h.policy.whenSettled();
    assert.deepEqual(seen, ['owner', 'clear']);
    await h.policy.applySettings({ use_amp_sims: true });
    assert.deepEqual(seen, ['owner', 'clear', 'owner']);
    await h.policy.setEnabled(false);
    assert.equal(seen.at(-1), 'clear');
});

test('failed normal teardown still reaches final clear before rejection, without self-wait', async () => {
    const h = harness(); await h.policy.applySettings({ use_amp_sims: true });
    let clears = 0;
    h.policy.subscribe(value => { if (!value.enabled) throw new Error('owner failed'); });
    h.policy.subscribe(() => { clears++; }, { phase: 'finalize' });
    await assert.rejects(h.policy.setEnabled(false), /owner failed/);
    assert(clears >= 1); assert.equal(h.policy.snapshot().enabled, false);
});
