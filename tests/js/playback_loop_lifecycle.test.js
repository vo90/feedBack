const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadPlayback, captureEvents, dispatch, makeTarget, makeAdapter } = require('./playback_test_harness');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

async function ready(adapter) {
    const window = loadPlayback();
    window.feedBack.playback.registerTransportAdapter(adapter);
    await dispatch(window, 'start', { authorization: 'user-action', target: makeTarget() });
    return window;
}

test('a deferred resume waits for real playback and emits resumed once without started', async () => {
    const start = deferred();
    const adapter = makeAdapter({ resumeResult: { completion: start.promise } });
    const window = await ready(adapter);
    const resumed = captureEvents(window, 'playback:resumed');
    const started = captureEvents(window, 'playback:started');
    let settled = false;
    const result = dispatch(window, 'resume').then(value => { settled = true; return value; });
    await new Promise(setImmediate);
    assert.equal(settled, false, 'scheduling count-in must not finish resume');
    assert.equal(resumed.length, 0);
    window.feedBack.emit('song:play', {});
    window.feedBack.emit('song:resume', {});
    start.resolve({ status: 'playing', completed: true });
    assert.equal((await result).status, 'playing');
    assert.equal(started.length, 0, 'resume is not a fresh song start');
    assert.equal(resumed.length, 1);
});

test('waiting for a count-in does not swallow pause or loop-restart events', async () => {
    const start = deferred();
    const window = await ready(makeAdapter({ resumeResult: { completion: start.promise } }));
    const paused = captureEvents(window, 'playback:paused');
    const resumed = captureEvents(window, 'playback:resumed');
    const restarts = captureEvents(window, 'playback:loop-restarted');
    const result = dispatch(window, 'resume');
    await new Promise(setImmediate);
    window.feedBack.emit('loop:restart', { loopA: 10, loopB: 20, time: 10 });
    window.feedBack.emit('song:pause', {});
    start.resolve({ status: 'cancelled', completed: false });
    assert.equal((await result).status, 'cancelled');
    assert.equal(paused.length, 1);
    assert.equal(restarts.length, 1);
    assert.equal(resumed.length, 0);
});

test('a capability outside seek preserves one loop restart while suppressing its seek echo', async () => {
    let window;
    const adapter = makeAdapter();
    adapter.seek = async () => {
        window.feedBack.emit('song:seek', { from: 15, to: 10 });
        window.feedBack.emit('loop:restart', { loopA: 10, loopB: 20, time: 10 });
        return { completed: true, from: 15, to: 10 };
    };
    window = await ready(adapter);
    const restarts = captureEvents(window, 'playback:loop-restarted');
    const seeks = captureEvents(window, 'playback:seeked');
    await dispatch(window, 'seek', { time: 40 });
    assert.equal(restarts.length, 1);
    assert.equal(seeks.length, 1);
});

test('a deferred resume cannot overwrite a later pause even if its adapter reports success', async () => {
    const start = deferred();
    const window = await ready(makeAdapter({ resumeResult: { completion: start.promise } }));
    const resumed = captureEvents(window, 'playback:resumed');
    const result = dispatch(window, 'resume');
    await new Promise(setImmediate);
    await dispatch(window, 'pause', { priority: 'user' });
    start.resolve({ status: 'playing', completed: true });
    assert.equal((await result).status, 'cancelled');
    assert.equal(resumed.length, 0);
    assert.equal(window.feedBack.playback.snapshot().state.state, 'paused');
});
