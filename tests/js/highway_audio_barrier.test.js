// Pins the native-audio barrier ordering in static/highway.js
// (feedBack-desktop#117). The highway must await window.feedBackAudioBarrier
// before touching the JUCE backing engine, otherwise a NAM tone graph build
// that restarts the native audio device races the backing-track load.
//
// Execute the current barrier and serialized loader with controlled promises.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');

const HIGHWAY_JS = path.join(__dirname, '..', '..', 'static', 'highway.js');
const TRANSPORT_JS = path.join(__dirname, '..', '..', 'static', 'js', 'transport.js');
const source = fs.readFileSync(HIGHWAY_JS, 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

function barrierHarness(barrier) {
    const start = source.indexOf("if (typeof window.feedBackAudioBarrier === 'function')");
    const engineCall = 'const engineRunning = await juceApi.isAudioRunning();';
    const end = source.indexOf(engineCall, start);
    assert.ok(start >= 0 && end > start, 'current native routing must await its barrier before the engine check');
    const run = new AsyncFunction('window', 'gen', 'hwState', 'juceApi',
        '_reportAudioMonitoring', '_reportAudioBridge', 'setTimeout', 'clearTimeout',
        source.slice(start, end + engineCall.length) + '\nreturn engineRunning;');
    const calls = [], timers = new Map(), hwState = { _wsGen: 1 };
    const window = barrier ? { feedBackAudioBarrier() { calls.push('barrier'); return barrier(); } } : {};
    const api = { async isAudioRunning() { calls.push('engine'); return true; } };
    let nextTimer = 0;
    return {
        calls, timers, hwState,
        run: () => run(window, 1, hwState, api, () => {}, () => {},
            (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
            id => timers.delete(id)),
    };
}

test('highway awaits feedBackAudioBarrier before the JUCE backing path', () => {
    const barrierIdx = source.indexOf('window.feedBackAudioBarrier');
    const isRunningIdx = source.indexOf('juceApi.isAudioRunning()');
    const loadIdx = source.indexOf('await loadCoreBackingTrack(');

    assert.ok(barrierIdx !== -1, 'highway must reference window.feedBackAudioBarrier');
    assert.ok(isRunningIdx !== -1, 'highway must still call juceApi.isAudioRunning()');
    assert.ok(loadIdx !== -1, 'highway must load through the serialized core backing helper');
    assert.ok(barrierIdx < isRunningIdx,
        'the barrier await must precede the isAudioRunning() check');
    assert.ok(barrierIdx < loadIdx,
        'the barrier await must precede loadCoreBackingTrack');
});

test('a pending native-audio barrier blocks engine access and clears its timeout after release', async () => {
    const gate = deferred(), h = barrierHarness(() => gate.promise);
    const routing = h.run();
    await Promise.resolve();
    assert.deepEqual(h.calls, ['barrier']);
    assert.equal(h.timers.size, 1);
    gate.resolve();
    assert.equal(await routing, true);
    assert.deepEqual(h.calls, ['barrier', 'engine']);
    assert.equal(h.timers.size, 0);
});

test('the barrier timeout releases a stuck plugin after three seconds', async () => {
    const h = barrierHarness(() => new Promise(() => {}));
    const routing = h.run();
    await Promise.resolve();
    assert.deepEqual(h.calls, ['barrier']);
    assert.equal(h.timers.size, 1);
    const timer = [...h.timers.values()][0];
    assert.equal(timer.delay, 3000);
    timer.callback();
    assert.equal(await routing, true);
    assert.deepEqual(h.calls, ['barrier', 'engine']);
    assert.equal(h.timers.size, 0);
});

test('absent, throwing and rejected barriers do not prevent native routing', async () => {
    for (const barrier of [null, () => { throw Error('barrier'); }, () => Promise.reject(Error('barrier'))]) {
        const h = barrierHarness(barrier);
        assert.equal(await h.run(), true);
        assert.deepEqual(h.calls, barrier ? ['barrier', 'engine'] : ['engine']);
        assert.equal(h.timers.size, 0);
    }
});

test('navigation during the barrier cannot start the old song routing', async () => {
    const gate = deferred(), h = barrierHarness(() => gate.promise);
    const routing = h.run();
    await Promise.resolve();
    h.hwState._wsGen++;
    gate.resolve();
    assert.equal(await routing, undefined);
    assert.deepEqual(h.calls, ['barrier']);
    assert.equal(h.timers.size, 0);
});

test('the core backing helper waits for serialized commands and rechecks song ownership before loading', async () => {
    const transport = fs.readFileSync(TRANSPORT_JS, 'utf8');
    const create = new Function('window', `
        let _backingCommandChain = Promise.resolve();
        ${extractFunction(transport, 'function _queueBackingCommand')}
        ${extractFunction(transport, 'function loadCoreBackingTrack')}
        return { queue: _queueBackingCommand, load: loadCoreBackingTrack };
    `);
    for (const switchSong of [false, true]) {
        const gate = deferred(), calls = [];
        const h = create({ feedBack: { audioSession: { nativeBacking: {
            releaseCurrent(reason) { calls.push(['release', reason]); },
        } } } });
        let current = true;
        const api = { async loadBackingTrack(file) { calls.push(['load', file]); return true; } };
        const prior = h.queue(() => gate.promise);
        const loading = h.load(api, '/song.ogg', () => current);
        await Promise.resolve();
        assert.deepEqual(calls, [['release', 'core-takeover']], 'physical loading waits behind pending commands');
        if (switchSong) current = false;
        gate.resolve();
        await prior;
        assert.equal(await loading, !switchSong);
        assert.deepEqual(calls, switchSong ? [['release', 'core-takeover']]
            : [['release', 'core-takeover'], ['load', '/song.ogg']]);
    }
});
