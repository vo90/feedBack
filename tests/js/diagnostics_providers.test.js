const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWindow, ROOT } = require('./capabilities_test_harness');

function load({ capabilities = false, legacy = false } = {}) {
    const window = createWindow();
    window.feedBack.diagnostics = undefined;
    window.console = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, () => {}]));
    window.navigator = { userAgent: 'test' };
    const scheduled = [];
    window.queueMicrotask = callback => scheduled.push(callback);
    let builds = 0;
    window.JSON = {
        parse: JSON.parse,
        stringify(value, ...args) {
            if (value && value.schema === 'feedBack.capabilities.diagnostics.v1') builds++;
            return JSON.stringify(value, ...args);
        },
    };
    const context = vm.createContext(window);
    for (const file of ['diagnostics.js', ...(capabilities ? ['capabilities.js'] : [])]) {
        if (file === 'capabilities.js' && legacy) delete window.feedBack.diagnostics.contributeProvider;
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'static', file), 'utf8'), context, { filename: file });
    }
    return { window, diagnostics: window.feedBack.diagnostics, capabilities: window.feedBack.capabilities,
        builds: () => builds, flush: () => { while (scheduled.length) scheduled.shift()(); } };
}

test('providers are demand-only current-state snapshots; eager payload identity is unchanged', () => {
    const { diagnostics: d } = load();
    const eager = { value: 1 };
    let calls = 0, current = 2;
    d.contribute('eager', eager);
    d.contributeProvider('live', () => { calls++; return { current }; });
    current = 3;
    assert.equal(calls, 0);
    const a = d.snapshotContributions();
    assert.equal(a.eager, eager);
    assert.equal(a.live.current, 3);
    current = 4;
    const b = d.snapshotContributions();
    assert.equal(calls, 2);
    assert.equal(b.live.current, 4);
    assert.notEqual(a, b);
    assert.notEqual(a.live, b.live);
});

test('eager and provider registrations replace each other; invalid registrations do not replace', () => {
    const { diagnostics: d } = load();
    let calls = 0;
    d.contribute('same', 'old');
    d.contributeProvider('same', () => { calls++; return 'live'; });
    assert.equal(d.snapshotContributions().same, 'live');
    d.contributeProvider('same', null);
    d.contributeProvider('', () => 'invalid');
    d.contributeProvider(null, () => 'invalid');
    assert.equal(d.snapshotContributions().same, 'live');
    d.contribute('same', undefined);
    assert.equal(Object.hasOwn(d.snapshotContributions(), 'same'), true);
    assert.equal(calls, 2);
    assert.equal(d.snapshotContributions().same, undefined);
});

test('throwing providers are isolated, omitted, and retried without stale cache', () => {
    const { diagnostics: d } = load();
    let fail = false, good = 0;
    d.contributeProvider('bad', () => { if (fail) throw Error('private detail'); return 'first'; });
    d.contributeProvider('good', () => ++good);
    assert.equal(d.snapshotContributions().bad, 'first');
    fail = true;
    const failed = d.snapshotContributions();
    assert.equal(Object.hasOwn(failed, 'bad'), false);
    assert.equal(failed.good, 2);
    fail = false;
    assert.equal(d.snapshotContributions().bad, 'first');
});

test('reentrant reads include eager payloads only and do not invoke any providers', () => {
    const { diagnostics: d } = load();
    const nested = [];
    let a = 0, b = 0;
    d.contribute('eager', 9);
    d.contributeProvider('a', () => { a++; nested.push(d.snapshotContributions()); return 'a'; });
    d.contributeProvider('b', () => { b++; nested.push(d.snapshotContributions()); return 'b'; });
    assert.equal(d.snapshotContributions().b, 'b');
    assert.equal(a, 1); assert.equal(b, 1);
    for (const value of nested) assert.deepEqual(Object.keys(value), ['eager']);
    assert.equal(nested[0].eager, 9);
    d.snapshotContributions();
    assert.equal(a, 2); assert.equal(b, 2);
});

test('registration changes while reading apply to the next request, with a finite entry list', () => {
    const { diagnostics: d } = load();
    d.contribute('old', 1);
    d.contributeProvider('first', () => {
        d.contribute('second', 'replacement');
        d.contributeProvider('new', () => 'new');
        d.contributeProvider('old', () => 2);
        d.contribute('first', 'finished');
        return 'original';
    });
    d.contributeProvider('second', () => 'original-second');
    const initial = d.snapshotContributions();
    assert.equal(initial.old, 1);
    assert.equal(initial.first, 'original');
    assert.equal(initial.second, 'original-second');
    assert.equal(Object.hasOwn(initial, 'new'), false);
    const next = d.snapshotContributions();
    assert.equal(next.old, 2);
    assert.equal(next.first, 'finished');
    assert.equal(next.second, 'replacement');
    assert.equal(next.new, 'new');
});

test('async and broken thenable results are omitted without invoking arbitrary thenables', async () => {
    const { diagnostics: d } = load();
    let invoked = false;
    d.contributeProvider('thenable', () => ({ then() { invoked = true; } }));
    d.contributeProvider('broken', () => Object.defineProperty({}, 'then', { get() { throw Error('broken'); } }));
    d.contributeProvider('promise', () => {
        const promise = Promise.reject(Error('expected failure'));
        Object.defineProperty(promise, 'then', { get() { throw Error('must not read'); } });
        return promise;
    });
    d.contributeProvider('async', async () => { throw Error('expected async failure'); });
    d.contributeProvider('good', () => 7);
    const result = d.snapshotContributions();
    assert.deepEqual(Object.keys(result), ['good']);
    assert.equal(result.good, 7);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(invoked, false);
});

test('special provider IDs are own properties and separate diagnostics instances remain isolated', () => {
    const { diagnostics: a } = load(), { diagnostics: b } = load();
    const originalPrototype = Object.getPrototypeOf(a.snapshotContributions());
    a.contributeProvider('__proto__', () => ({ safe: true }));
    a.contributeProvider('constructor', () => 'data');
    const result = a.snapshotContributions();
    assert.equal(Object.getPrototypeOf(result), originalPrototype);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
    assert.equal(result.__proto__.safe, true);
    assert.equal(result.constructor, 'data');
    assert.equal(Object.hasOwn(b.snapshotContributions(), '__proto__'), false);
});

test('repeated capability updates build no full diagnostic snapshots until requested', () => {
    const { capabilities: api, diagnostics: d, builds, flush, window } = load({ capabilities: true });
    let changed = 0;
    window.addEventListener('feedBack:capabilities:changed', () => changed++);
    for (let i = 0; i < 50; i++) {
        api.registerParticipant('provider', { stems: { roles: ['provider'], commands: ['mute'], runtime: true } });
        api.recordLegacyHit({ capability: 'stems', legacySurface: 'test', source: 'test' });
        api.unregisterParticipant('provider', 'stems');
    }
    assert.equal(builds(), 0);
    flush(); assert.equal(changed, 1);
    const snapshot = d.snapshotContributions().capabilities;
    assert.ok(builds() > 0);
    assert.equal(snapshot.compatibilityShims.find(s => s.legacySurface === 'test').hitCount, 50);
    assert.equal(snapshot.participants.some(p => p.pluginId === 'provider'), false);
    assert.equal(JSON.stringify(snapshot), JSON.stringify(api.snapshotDiagnostics()));
});

test('current-state export inside a registered subscriber deliberately sees newly registered state', () => {
    const { capabilities: api, diagnostics: d } = load({ capabilities: true });
    let observed;
    api.subscribe('registered', event => {
        if (event.pluginId === 'new') observed = d.snapshotContributions().capabilities;
    });
    api.registerParticipant('new', { stems: { roles: ['provider'], commands: ['mute'], runtime: true } });
    assert.equal(observed.participants.some(p => p.pluginId === 'new'), true);
});

test('capability exports use current nested policies and preserve redaction, limits and detachment', async () => {
    const { capabilities: api, diagnostics: d } = load({ capabilities: true });
    const nested = { label: 'before', path: 'C:\\secret\\preset.nam', password: 'password=hidden' };
    api.registerParticipant('owner', { stems: { roles: ['owner'], commands: ['mute'], runtime: true,
        provider_policy: { nested, many: Array.from({ length: 80 }, (_, i) => i) },
        handlers: { mute: () => ({ outcome: 'failed', reason: 'token=secret /Users/private/tone ' + 'x'.repeat(2000) }) } } });
    nested.label = 'after';
    for (let i = 0; i < 120; i++) await api.dispatch({ capability: 'stems', command: 'mute', source: 'test', args: { target: { id: String(i) } } });
    const snap = d.snapshotContributions().capabilities;
    const owner = snap.participants.find(p => p.pluginId === 'owner');
    assert.equal(owner.providerPolicy.nested.label, 'after');
    assert.equal(owner.providerPolicy.many.length, 50);
    const encoded = JSON.stringify(snap);
    assert.ok(encoded.length <= 64 * 1024);
    assert.equal(encoded.includes('C:\\secret'), false);
    assert.equal(encoded.includes('password=hidden'), false);
    assert.equal(encoded.includes('token=secret'), false);
    assert.equal(encoded.includes('/Users/private'), false);
    owner.providerPolicy.nested.label = 'export changed';
    owner.roles.push('modified');
    snap.recentDecisions.length = 0;
    const next = d.snapshotContributions().capabilities;
    const currentOwner = next.participants.find(p => p.pluginId === 'owner');
    assert.equal(currentOwner.providerPolicy.nested.label, 'after');
    assert.equal(currentOwner.roles.includes('modified'), false);
    assert.ok(next.recentDecisions.length > 0);
    assert.equal(JSON.stringify(next), JSON.stringify(api.snapshotDiagnostics()));
});

test('older diagnostic hosts retain eager publication and latest-published subscriber timing', () => {
    const { capabilities: api, diagnostics: d, builds } = load({ capabilities: true, legacy: true });
    const initial = builds();
    let observed;
    api.subscribe('registered', event => {
        if (event.pluginId === 'new') observed = d.snapshotContributions().capabilities;
    });
    api.registerParticipant('new', { stems: { roles: ['provider'], runtime: true } });
    assert.ok(builds() > initial);
    assert.equal(observed.participants.some(p => p.pluginId === 'new'), false);
    assert.equal(d.snapshotContributions().capabilities.participants.some(p => p.pluginId === 'new'), true);
});

test('capability providers bind their own instance and recover when diagnostics host is replaced', () => {
    const first = load({ capabilities: true }), second = load({ capabilities: true });
    first.capabilities.registerParticipant('only-first', { stems: { roles: ['provider'], runtime: true } });
    assert.equal(second.diagnostics.snapshotContributions().capabilities.participants.some(p => p.pluginId === 'only-first'), false);
    const replacement = load().diagnostics;
    first.window.feedBack.diagnostics = replacement;
    first.capabilities.recordLegacyHit({ capability: 'stems', legacySurface: 'replacement', source: 'test' });
    assert.equal(replacement.snapshotContributions().capabilities.participants.some(p => p.pluginId === 'only-first'), true);
});
