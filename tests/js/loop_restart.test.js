// Legacy loop:restart contract, verified through the actual transport and countdown.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./helpers/loop-transport-harness');

test('loop:restart fires once after verified seek and frozen chart, before audible count', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    h.calls.length = 0;
    assert.equal(await h.api.handleLoopBoundary(20), true);
    await h.advance(400);
    const events = h.events.filter(event => event.name === 'loop:restart');
    assert.equal(events.length, 1);
    assert.equal(events[0].detail.loopA, 10);
    assert.equal(events[0].detail.loopB, 20);
    assert.equal(events[0].detail.time, 10);
    assert.ok(h.calls.indexOf('seek:10') < h.calls.indexOf('freeze:10'));
    assert.ok(h.calls.indexOf('freeze:10') < h.calls.indexOf('loop:restart'));
    assert.equal(h.backing(), false);
    await h.advance(2500);
    assert.equal(h.backing(), true);
    assert.equal(h.calls.filter(call => call === 'loop:restart').length, 1);
});

test('an initial count-in pauses backing exactly once before seeking A', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    h.calls.length = 0;
    await h.api.startLoop();
    assert.equal(h.calls.filter(call => call === 'pause').length, 1);
    assert.ok(h.calls.indexOf('pause') < h.calls.indexOf('seek:10'));
});

test('loop:restart aborts when repeat seek rolls back away from A', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    await h.api._audioSeek(20);
    h.io.seek = () => { throw new Error('rollback'); };
    await h.api.handleLoopBoundary(20);
    await h.advance(400);
    assert.equal(h.calls.includes('loop:restart'), false);
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.api.getLoopState().state, 'armed');
});

for (const elapsed of [0, 400, 900]) {
    test(`cancellation invalidates rewind and count callbacks at ${elapsed}ms`, async () => {
        const h = build();
        await h.api.setLoop(10, 20);
        await h.api.togglePlay();
        await h.api.handleLoopBoundary(20);
        await h.advance(elapsed);
        h.api.clearLoop();
        const restartCount = h.calls.filter(call => call === 'loop:restart').length;
        await h.advance(4000);
        assert.equal(h.backing(), false);
        assert.equal(h.api.isCountingIn(), false);
        assert.equal(h.calls.filter(call => call === 'loop:restart').length, restartCount);
    });
}
