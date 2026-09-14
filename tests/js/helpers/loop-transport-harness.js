// Exercise the actual loop, countdown, transport and desktop compatibility
// modules together. Only browser/native I/O and the clock are replaced.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function build({ juce = true } = {}) {
    const calls = [];
    const events = [];
    const timers = new Map();
    let timer = 0;
    let now = 0;
    let backing = false;
    const io = { seek: null, play: null, pause: null };
    class Media {
        get currentTime() { return this._t || 0; }
        set currentTime(time) { this._t = time; }
        get paused() { return !backing; }
        async play() { calls.push('play'); if (io.play) await io.play(); backing = true; }
        pause() { calls.push('pause'); backing = false; }
        dispatchEvent(event) { calls.push(event.type); }
    }
    const context = {
        console, Promise, queueMicrotask, Event, HTMLMediaElement: Media,
        audio: new Media(), S: { isPlaying: false, lastAudioTime: 0 },
        performance: { now: () => now },
        setTimeout(fn, ms) { const id = ++timer; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        requestAnimationFrame(fn) { return context.setTimeout(() => fn(now), 400); },
        cancelAnimationFrame(id) { timers.delete(id); },
        document: { getElementById() { return null; }, body: { appendChild() {} }, createElement() { return { remove() {} }; } },
        loadLoopPreferences: () => ({ activation: 'arm', firstPass: 'count-in', repeat: 'count-in' }),
        saveLoopPreferences: value => value, normalizeLoopPreferences: value => value,
        _setSectionPracticeMode() {}, _syncSectionPracticeFromLoop() {},
        _updateSectionPracticeHighlight() {}, resetSelection() {}, formatTime: String,
        host: { _updateEditRegionBtn() {} },
        window: {
            _juceMode: juce,
            highway: { setTime(time) { calls.push(`chart:${time}`); }, freezeTime(time) { calls.push(`freeze:${time}`); }, getTime: () => 0, getBPM: () => 120 },
            feedBack: { isPlaying: false, emit(name, detail) { calls.push(name); events.push({ name, detail }); } },
            feedBackDesktop: { audio: {
                async startBacking() { calls.push('play'); if (io.play) await io.play(); backing = true; },
                async stopBacking() { calls.push('pause'); if (io.pause) await io.pause(); backing = false; },
                async seekBacking(time) { calls.push(`seek:${time}`); if (io.seek) await io.seek(time); },
                async getBackingPosition() { return context.api.jucePlayer._pos; },
            } },
        },
    };
    vm.createContext(context);
    const read = name => fs.readFileSync(path.join(__dirname, '../../../static/js', name), 'utf8');
    const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
    const shim = read('juce-audio.js').slice(read('juce-audio.js').indexOf('export let _resetJuceAudioShimChain'));
    vm.runInContext([
        ...['transport.js', 'count-in.js', 'loops.js'].map(name => strip(read(name))), strip(shim),
        `playClick = () => {};
        setLoopPlayStartTargetResolver(time => {
            const loop = getLoopState();
            return loop.active && (time < loop.loopA || time >= loop.loopB) ? loop.loopA : time;
        });
        setLoopRestartHandler(async ({guard}) => ({completed: await startLoop({guard}), to: _audioTime()}));
        if (typeof setPlaybackStartOwnerResolver === 'function') setPlaybackStartOwnerResolver(getCountInStart);
        globalThis.api = {setLoop, startLoop, clearLoop, handleLoopBoundary, getLoopState,
            isCountingIn, updateLoopPreference, jucePlayer, togglePlay, _audioSeek,
            _resetAudioSeekState, _cancelCountIn, startCountIn, startSongCountIn, pausePlayback, cancelLoopOperations,
            resumePlayback: typeof resumePlayback === 'function' ? resumePlayback : null,
            getCountInStart: typeof getCountInStart === 'function' ? getCountInStart : () => null,
            handleLoopMediaEnded: typeof handleLoopMediaEnded === 'function' ? handleLoopMediaEnded : () => null};`,
    ].join('\n'), context);
    const flush = async () => { for (let index = 0; index < 50; index++) await Promise.resolve(); };
    const advance = async ms => {
        const end = now + ms;
        await flush();
        for (;;) {
            const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            timers.delete(next[0]); now = next[1].at; next[1].fn(); await flush();
        }
        now = end;
        await flush();
    };
    return { ...context, context, api: context.api, calls, events, io, backing: () => backing, flush, advance };
}


module.exports = { build, deferred };
