const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build, deferred } = require('./helpers/loop-transport-harness');
const { extractFunction } = require('./test_utils');

const ROOT = path.join(__dirname, '../..');
const APP = fs.readFileSync(path.join(ROOT, 'static/app.js'), 'utf8');

function buildApp(options) {
    const h = build(options);
    h.context.CustomEvent = class {
        constructor(type, init) { this.type = type; this.detail = init.detail; }
    };
    h.window.dispatchEvent = () => {};
    for (const file of ['static/capabilities.js', 'static/capabilities/playback.js']) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), h.context, { filename: file });
    }
    h.window.feedBack.currentSong = { filename: 'loop-fixture.feedpak', duration: 20 };
    h.audio.src = 'loop-fixture.wav';
    h.audio.duration = 20;
    h.api.jucePlayer._dur = 20;
    h.host.currentFilename = () => 'loop-fixture.feedpak';
    h.context._playbackApi = () => h.window.feedBack.playback;
    const mediaListeners = new Map();
    h.audio.addEventListener = (name, callback) => mediaListeners.set(name, callback);
    h.mediaEvent = name => mediaListeners.get(name)?.();
    vm.runInContext([
        APP.slice(APP.indexOf('setLoopPlayStartTargetResolver((requestedTime)'), APP.indexOf('// Demo analytics')),
        extractFunction(APP, 'function _currentPlaybackSnapshot()'),
        extractFunction(APP, 'function _installPlaybackTransportAdapter()'),
        extractFunction(APP, 'function _handlePlaybackEnded()'),
        APP.slice(APP.indexOf("audio.addEventListener('ended',"), APP.indexOf("audio.addEventListener('timeupdate',")),
        APP.slice(APP.indexOf("audio.addEventListener('play',"), APP.indexOf("window.feedBack.on('song:play', _acquireWakeLock)")),
        '_installPlaybackTransportAdapter(); globalThis.appEnded = _handlePlaybackEnded;',
    ].join('\n'), h.context);
    h.window.feedBack.playback.transportEvent('ready', {
        target: { filename: 'loop-fixture.feedpak' }, duration: 20, currentTime: 0,
    });
    h.dispatch = (command, args = {}) => h.window.feedBack.capabilities.dispatch({
        capability: 'playback', command, args, requester: 'plugin.loop-fixture',
    });
    h.events = name => {
        const events = [];
        h.window.feedBack.on(name, event => events.push(event.detail));
        return events;
    };
    h.position = time => {
        h.api.jucePlayer._pos = time;
        if (!h.window._juceMode) h.audio.currentTime = time;
    };
    return h;
}

for (const juce of [false, true]) {
    test(`app capability resume honors count-in beyond dispatch timeout (${juce ? 'JUCE' : 'HTML5'})`, async () => {
        const h = buildApp({ juce });
        await h.api.setLoop(10, 20);
        h.position(2);
        const resumed = h.events('playback:resumed');
        const started = h.events('playback:started');
        let settled = false;
        const completion = h.dispatch('resume').then(result => { settled = true; return result; });
        await h.advance(1000);
        assert.equal(settled, false, 'countdown remains pending after generic 250ms dispatch limit');
        assert.equal(h.backing(), false);
        assert.equal(resumed.length, 0);
        await h.advance(2000);
        assert.equal((await completion).status, 'playing');
        assert.equal(h.backing(), true);
        assert.equal(resumed.length, 1);
        assert.equal(started.length, 0);
        assert.equal(h.calls.filter(call => call === 'play').length, 1);
    });

    test(`app capability Pause cancels a pending count-in (${juce ? 'JUCE' : 'HTML5'})`, async () => {
        const h = buildApp({ juce });
        await h.api.setLoop(10, 20);
        h.position(2);
        const resumed = h.events('playback:resumed');
        const completion = h.dispatch('resume');
        await h.advance(750);
        await h.dispatch('pause', { priority: 'user' });
        assert.equal((await completion).status, 'cancelled');
        await h.advance(5000);
        assert.equal(h.backing(), false);
        assert.equal(h.S.isPlaying, false);
        assert.equal(resumed.length, 0);
    });

    for (const repeat of ['continuous', 'count-in']) {
        test(`app consumes duplicated end-of-media for ${repeat} (${juce ? 'JUCE' : 'HTML5'})`, async () => {
            const h = buildApp({ juce });
            h.api.updateLoopPreference('repeat', repeat);
            await h.api.setLoop(10, 20);
            await h.api.resumePlayback();
            h.position(20);
            const ended = h.events('song:ended');
            const restarts = h.events('loop:restart');
            h.context.appEnded();
            h.context.appEnded();
            await h.advance(3500);
            assert.equal(ended.length, 0);
            assert.equal(restarts.length, 1);
            assert.equal(h.backing(), true);
            assert.equal(h.S.isPlaying, true);
        });
    }
}

test('real app outside capability seek delivers exactly one legacy and canonical restart', async () => {
    const h = buildApp({ juce: true });
    h.api.updateLoopPreference('firstPass', 'immediate');
    await h.api.setLoop(10, 20);
    await h.api.resumePlayback();
    h.position(15);
    const legacy = h.events('loop:restart');
    const canonical = h.events('playback:loop-restarted');
    const seeked = h.events('playback:seeked');
    await h.dispatch('seek', { time: 40 });
    assert.equal(h.api.jucePlayer._pos, 10);
    assert.equal(legacy.length, 1);
    assert.equal(canonical.length, 1);
    assert.equal(seeked.length, 1);
});

test('normal end-of-song still emits ended once without a configured loop', async () => {
    const h = buildApp({ juce: true });
    await h.api.resumePlayback();
    h.position(20);
    const ended = h.events('song:ended');
    h.context.appEnded();
    h.context.appEnded();
    await h.flush();
    assert.equal(ended.length, 1);
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.backing(), false);
});

test('Stems end event finishes playback even though the native media ended flag is false', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    // Stems owns the element's clock and paused state, but its synthetic
    // ended event does not change HTMLMediaElement's native ended getter.
    h.position(20);
    h.audio.pause();
    h.audio.ended = false;
    const ended = h.events('song:ended');
    const canonicalEnded = h.events('playback:ended');
    h.mediaEvent('ended');
    h.mediaEvent('ended');
    await h.flush();
    assert.equal(ended.length, 1);
    assert.equal(ended[0].time, 20);
    assert.equal(canonicalEnded.length, 1);
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.window.feedBack.isPlaying, false);
    assert.equal(h.window.feedBack.playback.snapshot().state.state, 'ended');
});

test('native HTML5 ended events still finish playback once', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    h.position(20);
    h.audio.pause();
    h.audio.ended = true;
    const ended = h.events('song:ended');
    h.mediaEvent('ended');
    h.mediaEvent('ended');
    assert.equal(ended.length, 1);
    assert.equal(h.S.isPlaying, false);
});

for (const nativeEnded of [false, true]) {
    for (const repeat of ['continuous', 'count-in']) {
        test(`${nativeEnded ? 'HTML5' : 'Stems'} terminal event repeats an active ${repeat} loop without ending the song`, async () => {
            const h = buildApp({ juce: false });
            h.api.updateLoopPreference('repeat', repeat);
            await h.api.setLoop(10, 20);
            await h.api.resumePlayback();
            h.position(20);
            h.audio.pause();
            h.audio.ended = nativeEnded;
            const ended = h.events('song:ended');
            const restarts = h.events('loop:restart');
            h.mediaEvent('ended');
            h.mediaEvent('ended');
            // A real seek away from EOF clears HTMLMediaElement.ended.
            h.audio.ended = false;
            await h.advance(3500);
            assert.equal(ended.length, 0);
            assert.equal(restarts.length, 1);
            assert.equal(h.audio.currentTime, 10);
            assert.equal(h.backing(), true);
            assert.equal(h.S.isPlaying, true);
            // A trailing event after the loop has returned to A is stale.
            h.mediaEvent('ended');
            await h.flush();
            assert.equal(restarts.length, 1);
            assert.equal(ended.length, 0);
        });
    }
}

for (const [name, time, duration, paused] of [
    ['before the end', 19.999, 20, true],
    ['still playing', 20, 20, false],
    ['unknown duration', 20, NaN, true],
    ['infinite duration', 20, Infinity, true],
    ['zero duration', 0, 0, true],
    ['negative duration', 20, -1, true],
    ['missing duration', 20, undefined, true],
    ['null duration', 20, null, true],
    ['invalid time', NaN, 20, true],
    ['infinite time', Infinity, 20, true],
]) {
    test(`synthetic end event is ignored with ${name}`, async () => {
        const h = buildApp({ juce: false });
        await h.api.resumePlayback();
        if (paused) h.audio.pause();
        Object.defineProperty(h.audio, 'currentTime', { configurable: true, get: () => time });
        h.audio.duration = duration;
        h.audio.ended = false;
        const ended = h.events('song:ended');
        h.mediaEvent('ended');
        assert.equal(ended.length, 0);
        assert.equal(h.S.isPlaying, true);
    });
}

for (const [reason, target] of [['seek-by', 7], ['song-restart', 0]]) {
    test(`queued end event after ${reason} cannot finish the repositioned song`, async () => {
        const h = buildApp({ juce: false });
        await h.api.resumePlayback();
        h.position(20);
        h.audio.pause();
        h.audio.ended = false;
        await h.api._audioSeek(target, reason);
        const ended = h.events('song:ended');
        h.mediaEvent('ended');
        assert.equal(ended.length, 0);
        assert.equal(h.S.isPlaying, true);
        assert.equal(h.audio.currentTime, target);
    });
}

test('queued end event from a replaced source cannot finish the new song', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    h.position(20);
    h.audio.pause();
    h.api._resetAudioSeekState();
    h.audio.src = 'replacement.wav';
    h.audio.duration = 40;
    h.position(0);
    h.audio.ended = false;
    const ended = h.events('song:ended');
    h.mediaEvent('ended');
    assert.equal(ended.length, 0);
    assert.equal(h.S.isPlaying, true);
});

test('end event cannot finalize deliberately paused playback at EOF', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    await h.api.pausePlayback();
    h.position(20);
    h.audio.ended = false;
    const ended = h.events('song:ended');
    h.mediaEvent('ended');
    assert.equal(ended.length, 0);
    assert.equal(h.S.isPlaying, false);
});

test('element end event cannot finish a JUCE-owned song', async () => {
    const h = buildApp({ juce: true });
    await h.api.resumePlayback();
    h.audio.currentTime = 20;
    h.audio.ended = true;
    const ended = h.events('song:ended');
    h.mediaEvent('ended');
    assert.equal(ended.length, 0);
    assert.equal(h.S.isPlaying, true);
    assert.equal(h.backing(), true);
});

test('native Resume-Pause-Resume starts a new attempt after the pending start is cancelled', async () => {
    const h = buildApp({ juce: true });
    const start = deferred();
    h.io.play = () => start.promise;
    const resumed = h.events('playback:resumed');
    const first = h.dispatch('resume');
    await h.flush();
    const pause = h.dispatch('pause', { priority: 'user' });
    await h.flush();
    const second = h.dispatch('resume', { priority: 'user' });
    await h.flush();
    start.resolve();
    assert.equal((await first).status, 'cancelled');
    assert.equal((await pause).status, 'cancelled');
    assert.equal((await second).status, 'playing');
    assert.equal(h.backing(), true);
    assert.equal(h.S.isPlaying, true);
    assert.equal(h.window.feedBack.playback.snapshot().state.state, 'playing');
    assert.equal(resumed.length, 1);
});

for (const command of ['pause', 'stop']) {
    test(`capability ${command} cancels an outside-loop resume waiting for native seek`, async () => {
        const h = buildApp({ juce: true });
        h.api.updateLoopPreference('firstPass', 'immediate');
        await h.api.setLoop(10, 20);
        h.position(2);
        const seek = deferred();
        h.io.seek = () => seek.promise;
        const resume = h.dispatch('resume');
        await h.flush();
        const cancel = h.dispatch(command, { priority: 'user' });
        await h.flush();
        seek.resolve();
        await cancel;
        assert.equal((await resume).status, 'cancelled');
        await h.advance(5000);
        assert.equal(h.backing(), false);
        assert.equal(h.S.isPlaying, false);
        assert.equal(h.calls.filter(call => call === 'play').length, 0);
    });
}

test('queued HTML5 play event after Pause cannot resurrect playback', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    await h.dispatch('pause');
    const resumed = h.events('playback:resumed');
    const started = h.events('playback:started');
    h.mediaEvent('play');
    assert.equal(h.S.isPlaying, false);
    assert.equal(h.window.feedBack.isPlaying, false);
    assert.equal(resumed.length, 0);
    assert.equal(started.length, 0);
});

test('queued HTML5 pause event after Resume cannot pause current playback', async () => {
    const h = buildApp({ juce: false });
    await h.api.resumePlayback();
    const paused = h.events('playback:paused');
    h.mediaEvent('pause');
    assert.equal(h.S.isPlaying, true);
    assert.equal(h.window.feedBack.isPlaying, true);
    assert.equal(paused.length, 0);
});
