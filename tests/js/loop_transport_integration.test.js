const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, deferred } = require('./helpers/loop-transport-harness');

for (const juce of [false, true]) {
    test(`Clear initial countdown reconciles public pause (${juce ? 'JUCE' : 'HTML5'})`, async () => {
        const h = build({ juce });
        await h.api.setLoop(10, 20);
        await h.api.togglePlay();
        await h.api.startLoop();
        h.api.clearLoop();
        assert.equal(h.S.isPlaying, false);
        assert.equal(h.window.feedBack.isPlaying, false);
        await h.advance(4000);
        assert.equal(h.backing(), false);
        await h.api.togglePlay();
        assert.equal(h.backing(), true);
    });

    for (const repeat of ['count-in', 'continuous']) {
        test(`media end is synchronously consumed once and resumes (${juce ? 'JUCE' : 'HTML5'}, ${repeat})`, async () => {
            const h = build({ juce });
            await h.api.setLoop(10, 20);
            h.api.updateLoopPreference('repeat', repeat);
            await h.api.togglePlay();
            await h.api._audioSeek(20);
            if (juce) await h.api.jucePlayer.pause(); else h.audio.pause();
            const first = h.api.handleLoopMediaEnded(20);
            assert.ok(first, 'active end must be reserved before the media listener publishes ended');
            const second = h.api.handleLoopMediaEnded(20);
            assert.ok(second, 'duplicate end remains consumed');
            await h.advance(3500);
            assert.equal(await first.completion, true);
            assert.equal(h.backing(), true);
            assert.equal(h.calls.filter(value => value === 'loop:restart').length, 1);
        });
    }
}

test('desktop pause/currentTime/play waits for the owned count-in without early or duplicate Play', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    h.calls.length = 0;
    h.audio.pause(); h.audio.currentTime = 2;
    let completed = false;
    const playback = h.audio.play().then(() => { completed = true; });
    await h.flush();
    assert.equal(h.calls.includes('play'), false);
    assert.equal(completed, false);
    await h.advance(2499);
    assert.equal(h.calls.includes('play'), false);
    await h.advance(1);
    await playback;
    assert.equal(h.calls.filter(value => value === 'play').length, 1);
});

test('overlapping failed legacy requests cannot restore starting', async () => {
    const h = build();
    const seek = deferred();
    h.io.seek = () => seek.promise;
    const first = h.api.setLoop(10, 20);
    await h.flush();
    const second = h.api.setLoop(30, 40);
    h.io.seek = () => { throw new Error('failed seek'); };
    seek.resolve();
    assert.equal(await first, false);
    assert.equal(await second, false);
    assert.equal(h.api.getLoopState().state, 'inactive');
});

test('failed first-pass seek after pause leaves valid bounds armed and playback paused', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    await h.api._audioSeek(15);
    h.io.seek = () => { throw new Error('failed seek'); };
    assert.equal(await h.api.startLoop(), false);
    assert.equal(h.api.getLoopState().state, 'armed');
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.window.feedBack.isPlaying, false);
    assert.equal(h.backing(), false);
});

test('Clear during pending native Play stops its late physical completion before a new resume', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.startLoop();
    const play = deferred();
    h.io.play = () => play.promise;
    await h.advance(2500);
    h.api.clearLoop();
    play.resolve();
    await h.flush();
    assert.equal(h.backing(), false);
    assert.equal(h.S.isPlaying, false);
    h.io.play = null;
    await h.api.togglePlay();
    assert.equal(h.backing(), true);
});



for (const juce of [false, true]) {
    for (const time of [2, 15, 20]) {
        for (const firstPass of ['immediate', 'count-in']) {
            test(`resume preserves inside position and applies outside policy (${juce}, ${time}, ${firstPass})`, async () => {
                const h = build({ juce });
                await h.api.setLoop(10, 20);
                h.api.updateLoopPreference('firstPass', firstPass);
                await h.api._audioSeek(time);
                h.calls.length = 0;
                const first = h.api.resumePlayback();
                const second = h.api.resumePlayback();
                await h.flush();
                const counts = time !== 15 && firstPass === 'count-in';
                assert.equal(h.api.isCountingIn(), counts);
                assert.equal(h.calls.includes('play'), !counts);
                await h.advance(counts ? 2500 : 0);
                assert.equal((await first).completed, true);
                assert.equal((await second).completed, true);
                assert.equal(h.calls.filter(value => value === 'play').length, 1);
                const position = juce ? h.api.jucePlayer._pos : h.audio.currentTime;
                assert.equal(position, time === 15 ? 15 : 10);
                await h.api.resumePlayback();
                assert.equal(h.backing(), true);
                assert.equal(h.calls.filter(value => value === 'play').length, 1);
            });
        }
    }
}

test('ordinary Clear preserves physically running playback', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    h.api.clearLoop();
    await h.flush();
    assert.equal(h.backing(), true);
    assert.equal(h.S.isPlaying, true);
});

for (const firstPass of ['immediate', 'count-in']) {
    test(`Pause during pending outside resume seek cannot restart (${firstPass})`, async () => {
        const h = build();
        await h.api.setLoop(10, 20);
        h.api.updateLoopPreference('firstPass', firstPass);
        await h.api._audioSeek(2);
        const seek = deferred();
        h.io.seek = () => seek.promise;
        const resume = h.api.resumePlayback();
        await h.flush();
        await h.api.pausePlayback();
        seek.resolve();
        await h.flush();
        assert.equal((await resume).completed, false);
        await h.advance(3500);
        assert.equal(h.backing(), false);
        assert.equal(h.S.isPlaying, false);
        assert.equal(h.api.getLoopState().state, 'armed');
    });
}

test('Clear while initial native pause is pending cannot start a countdown or strand starting', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    const pause = deferred();
    h.io.pause = () => pause.promise;
    const start = h.api.startLoop();
    await h.flush();
    assert.equal(h.api.isCountingIn(), true);
    h.api.clearLoop();
    pause.resolve();
    assert.equal(await start, false);
    await h.advance(3500);
    assert.equal(h.backing(), false);
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.api.getLoopState().state, 'inactive');
});

test('timer-owned continuous wrap is promoted when a media end arrives during its seek', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    h.api.updateLoopPreference('repeat', 'continuous');
    await h.api.togglePlay();
    await h.api._audioSeek(20);
    const seek = deferred();
    h.io.seek = () => seek.promise;
    const tick = h.api.handleLoopBoundary(20);
    await h.flush();
    await h.api.jucePlayer.pause();
    const end = h.api.handleLoopMediaEnded(20);
    assert.ok(end);
    seek.resolve();
    assert.equal(await tick, true);
    assert.equal(await end.completion, true);
    assert.equal(h.backing(), true);
    assert.equal(h.calls.filter(value => value === 'loop:restart').length, 1);
});

test('a canceled older wrap cannot release a newer wrap reservation', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    h.api.updateLoopPreference('repeat', 'continuous');
    await h.api.togglePlay();
    const oldSeek = deferred();
    h.io.seek = () => oldSeek.promise;
    const old = h.api.handleLoopBoundary(20);
    await h.flush();
    h.api.cancelLoopOperations();
    const nextSeek = deferred();
    h.io.seek = () => nextSeek.promise;
    const next = h.api.handleLoopBoundary(20);
    oldSeek.resolve();
    await h.flush();
    assert.equal(await old, false);
    assert.equal(await h.api.handleLoopBoundary(20), false);
    nextSeek.resolve();
    assert.equal(await next, true);
});

test('armed and deliberately paused loops do not consume end-of-media', async () => {
    const h = build();
    await h.api.setLoop(10, 20, { activation: 'preference' });
    assert.equal(h.api.handleLoopMediaEnded(20), null);
    await h.api.setLoop(10, 20);
    assert.equal(h.api.handleLoopMediaEnded(20), null);
});

test('a late canceled native Play settles before a new session starts', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.startLoop();
    const oldPlay = deferred();
    h.io.play = () => oldPlay.promise;
    await h.advance(2500);
    h.api.clearLoop();
    h.api._resetAudioSeekState();
    const stopped = h.api.jucePlayer.stop();
    oldPlay.resolve();
    await stopped;
    h.io.play = null;
    await h.api.resumePlayback();
    await h.flush();
    assert.equal(h.backing(), true);
    assert.equal(h.S.isPlaying, true);
});

test('song-load countdown shares completion and cancellation ownership', async () => {
    const h = build();
    await h.api.startSongCountIn();
    const waiting = h.api.resumePlayback();
    await h.advance(1000);
    assert.equal(h.backing(), false);
    h.api._cancelCountIn();
    assert.equal((await waiting).status, 'cancelled');
    await h.advance(4000);
    assert.equal(h.backing(), false);
    await h.api.resumePlayback();
    assert.equal(h.backing(), true);
});

test('Pause while the outside resume is still physically pausing leaves bounds retryable', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api._audioSeek(2);
    const pendingPause = deferred();
    h.io.pause = () => pendingPause.promise;
    const start = h.api.resumePlayback();
    await h.flush();
    const pause = h.api.pausePlayback();
    pendingPause.resolve();
    await pause;
    assert.equal((await start).completed, false);
    assert.equal(h.api.getLoopState().state, 'armed');
    assert.equal(h.backing(), false);
});

for (const seek of [false, true]) {
    test(`desktop compatibility Pause cancels the current countdown (seek=${seek})`, async () => {
        const h = build();
        await h.api.setLoop(10, 20);
        await h.api.startLoop();
        h.audio.pause();
        if (seek) h.audio.currentTime = 15;
        await h.flush();
        await h.advance(3500);
        assert.equal(h.backing(), false);
        assert.equal(h.api.isCountingIn(), false);
        assert.equal(h.S.isPlaying, false);
    });
}

test('compatibility Pause is not blocked behind queued Play waiting on countdown', async () => {
    const h = build();
    await h.api.setLoop(10, 20);
    await h.api.togglePlay();
    h.audio.pause(); h.audio.currentTime = 2;
    const playback = h.audio.play();
    await h.flush();
    assert.equal(h.api.isCountingIn(), true);
    h.audio.pause();
    await h.flush();
    assert.equal(h.api.isCountingIn(), false);
    await playback;
    await h.advance(3500);
    assert.equal(h.backing(), false);
});
