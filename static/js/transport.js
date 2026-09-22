// The playback transport — the play/pause/seek core, and the two clocks it reads.
//
// WHY THIS IS A MODULE AND NOT A HOOK BUNDLE. Every carve before this one ADDED host
// hooks: a module pulled out of app.js still had to call back into it. This one SUBTRACTS
// them. count-in, juce-audio, loops, and section-practice were all reaching through the
// seam for the same handful of names — _audioSeek, _audioTime, setPlayButtonState,
// _songEventPayload, jucePlayer. Those names have an owner, and it isn't app.js. Give
// them one and the four consumers import them directly:
//
//     count-in.js    5 hooks -> 0        juce-audio.js  4 hooks -> 0
//     loops.js       6 hooks -> 4        section-practice.js  10 hooks -> 7
//
// A hook is a cycle you agreed to live with. An import is a dependency you actually have.
// Prefer the import whenever the name has a real owner.
//
// TWO THINGS DELIBERATELY LEFT IN app.js, both for the same reason — they would close a
// cycle, and app.js is the root, so it can import from both sides for free:
//
//   * _currentPlaybackSnapshot  reads loopA/loopB from ./loops.js, and loops.js imports
//                               this module. The dependency scan MISSED this at first: it
//                               only walked app.js's own top-level decls, and loopA stopped
//                               being one the moment loops.js was carved out. Any scan of a
//                               partly-carved monolith has to resolve the imports too.
//   * restartCurrentSong        calls _cancelCountIn() from ./count-in.js, which imports
//                               this module.
//
// The seek generation (_audioSeekGen) stays PRIVATE. It has exactly one writer —
// _resetAudioSeekState(), right here — so readers get audioSeekGen() and nobody outside
// can desync it. That is strictly better than the host hook it replaces, which handed out
// a getter and left the writer in app.js.
import { audio } from './audio-el.js';
import { S } from './player-state.js';
import { selectionLifecycle } from './screen-selection.js';

// Sync the play/pause button's icon and accessible state in one place so
// screen readers, tooltips, and aria-pressed stay aligned with playback.
// Updates the existing <img> child's src in place rather than rewriting
// innerHTML, so any future children (fallback label, loading spinner, …)
// survive state changes.
export function setPlayButtonState(isPlaying) {
    const btn = document.getElementById('btn-play');
    if (!btn) return;
    const label = isPlaying ? 'Pause' : 'Play';
    const icon = isPlaying ? 'pause' : 'play';
    let img = btn.querySelector('img.button-icon-svg');
    if (!img) {
        img = document.createElement('img');
        img.className = 'button-icon-svg';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        btn.appendChild(img);
    }
    img.src = `/static/svg/${icon}.svg`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
    btn.title = label;
}

// ── Player ───────────────────────────────────────────────────────────────
// `audio` now lives in ./js/audio-el.js so carved-out modules can reach the
// player without importing app.js back (which would close a cycle). Same
// element, same handle, same lookup — just imported instead of declared here.
let _lastSongPositionEventAt = 0;

export function _emitSongPositionChanged(time, duration) {
    const now = Date.now();
    if (now - _lastSongPositionEventAt < 250) return;
    _lastSongPositionEventAt = now;
    const payload = (typeof _songEventPayload === 'function') ? _songEventPayload() : { time };
    window.feedBack.emit('song:position-changed', Object.assign(payload, { duration }));
}

// Native commands finish asynchronously. Keep stop behind an in-flight start
// so cancellation cannot be undone by a late physical startBacking completion.
let _backingCommandChain = Promise.resolve();
function _queueBackingCommand(command) {
    const result = _backingCommandChain.then(command);
    _backingCommandChain = result.catch(() => {});
    return result;
}

export const jucePlayer = {
    _timer: null,
    _pos: 0,
    _dur: 0,
    _pollAt: 0,    // performance.now() when _pos was last set
    _polling: false,
    _speed: 1,
    get currentTime() {
        if (!this._polling) return this._pos;
        // Interpolate between IPC polls so highway motion is smooth at 60fps
        // Scale by _speed so at 0.7x the interpolated clock advances 0.7s/s
        const elapsed = (performance.now() - this._pollAt) / 1000;
        return Math.min(this._pos + elapsed * this._speed, this._dur > 0 ? this._dur : Infinity);
    },
    get duration() { return this._dur; },
    async play(options = {}) {
        const session = audioSeekGen();
        const permitted = () => session === audioSeekGen() && (!options.guard || options.guard());
        return _queueBackingCommand(async () => {
            if (!permitted()) return false;
            try {
                selectionLifecycle().reconcileBeforePlayback();
                await window.feedBackDesktop.audio.startBacking();
                if (!permitted()) {
                    // A replacement song waits for stop() before loading its
                    // source. Finish this cleanup inside the same command queue.
                    await window.feedBackDesktop.audio.stopBacking();
                    return false;
                }
            } catch (err) {
                console.warn('[jucePlayer] startBacking failed:', err);
                return false;
            }
            this._startPolling();
            return true;
        });
    },
    async pause() {
        // Snapshot the interpolated position before stopping the poll so
        // _pos stays at the visible pause point rather than jumping back
        // to the last raw IPC sample (which can be up to 100ms behind).
        this._pos = this.currentTime;
        this._pollAt = performance.now();
        this._stopPolling();
        return _queueBackingCommand(async () => {
            this._stopPolling();
            try {
                await window.feedBackDesktop.audio.stopBacking();
                return true;
            } catch (err) {
                console.warn('[jucePlayer] stopBacking failed:', err);
                return false;
            }
        });
    },
    async seek(s) {
        const prev = this._pos;
        this._pos = s;
        this._pollAt = performance.now();
        try {
            await window.feedBackDesktop.audio.seekBacking(s);
        } catch (err) {
            console.warn('[jucePlayer] seekBacking failed:', err);
            this._pos = prev;
            this._pollAt = performance.now();
        }
    },
    _startPolling() {
        this._stopPolling();
        this._polling = true;
        this._pollAt = performance.now();
        const self = this;
        function scheduleNext() {
            self._timer = setTimeout(async () => {
                if (!self._polling) return;
                try {
                    self._pos = await window.feedBackDesktop.audio.getBackingPosition();
                    self._pollAt = performance.now();
                    _emitSongPositionChanged(self.currentTime, self.duration || null);
                } catch (err) {
                    console.warn('[jucePlayer] position poll failed:', err);
                } finally {
                    if (self._polling) scheduleNext();
                }
            }, 100);
        }
        scheduleNext();
    },
    _stopPolling() {
        this._polling = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },
    setRate(rate) {
        this._pos = this.currentTime;
        this._pollAt = performance.now();
        this._speed = rate;
    },
    async stop() {
        await this.pause();
        this._pos = 0;
        this._dur = 0;
        this._pollAt = 0;
        this._speed = 1;
    },
};

export function _audioTime() { return window._juceMode ? jucePlayer.currentTime : audio.currentTime; }

export function _audioDuration() { return window._juceMode ? jucePlayer.duration : audio.duration; }

// Validate an element's ended event against its current transport. Stems
// supplies currentTime/duration/paused through shims, but leaves the native
// ended flag false. Require the exact terminal position so a stale event
// after a seek or loop restart cannot finish the new playback position.
export function _audioElementEnded() {
    if (audio.ended) return true;
    const time = audio.currentTime;
    const duration = audio.duration;
    return audio.paused && Number.isFinite(time) && Number.isFinite(duration)
        && duration > 0 && time >= duration;
}

// Canonical payload for song:play/song:pause/song:ended. Plugins anchor
// their own clocks against `perfNow` (a monotonic timestamp at the same
// moment audio reports `audioT`) so they don't have to chase the chart
// clock with a follow-up call. `time` is kept as an alias for `audioT`
// because pre-existing plugins read e.detail.time.
export function _songEventPayload() {
    const audioT = _audioTime();
    return {
        time: audioT,
        audioT,
        chartT: window.highway.getTime(),
        perfNow: performance.now(),
    };
}

export function _markPlaybackPaused() {
    const changed = S.isPlaying || window.feedBack?.isPlaying;
    S.isPlaying = false;
    setPlayButtonState(false);
    if (window.feedBack) {
        window.feedBack.isPlaying = false;
        if (changed) window.feedBack.emit('song:pause', _songEventPayload());
    }
}

export function _markPlaybackResumed() {
    const changed = !window.feedBack?.isPlaying;
    S.isPlaying = true;
    setPlayButtonState(true);
    if (window.feedBack) {
        window.feedBack.isPlaying = true;
        if (changed) {
            const payload = _songEventPayload();
            window.feedBack.emit('song:play', payload);
            window.feedBack.emit('song:resume', payload);
        }
    }
}

export function _emitPlaybackStopped(time, screen = 'playback-command') {
    if (window.feedBack) window.feedBack.emit('song:stop', { time: time || 0, screen });
}

export function _waitForSongReady(expectedSeekGen, timeoutMs = 10000) {
    if (!window.feedBack || typeof window.feedBack.on !== 'function') return Promise.resolve(false);
    return new Promise(resolve => {
        let timer = null;
        const done = value => {
            if (timer !== null) clearTimeout(timer);
            window.feedBack.off('song:ready', onReady);
            resolve(value);
        };
        const onReady = () => done(expectedSeekGen == null || expectedSeekGen === _audioSeekGen);
        window.feedBack.on('song:ready', onReady);
        timer = setTimeout(() => done(false), timeoutMs);
    });
}

// Serializes seeks so concurrent callers (e.g. user ⏪ during a loop wrap)
// don't interleave their from/to reads — each call captures `from` only
// once the previous seek + emit have completed. The generation token
// lets session teardown invalidate queued seeks so they don't run against
// the new player and emit a stale song:seek.
let _audioSeekChain = Promise.resolve();

let _audioSeekGen = 0;

// The transport owns Play, but the loop controller owns the active A bound.
// app.js wires the two together without introducing a transport <-> loops
// import cycle. Timeline seeks remain unrestricted; this resolver is consulted
// only when paused playback is about to start.
let _loopPlayStartTargetResolver = null;
let _loopRestartHandler = null;
let _playbackStartOwnerResolver = null;

export function setPlaybackStartOwnerResolver(resolver) {
    _playbackStartOwnerResolver = typeof resolver === 'function' ? resolver : null;
}

function _playbackStartOwner() {
    return _playbackStartOwnerResolver?.() || null;
}

export function setLoopPlayStartTargetResolver(resolver) {
    _loopPlayStartTargetResolver = typeof resolver === 'function' ? resolver : null;
}

// app.js wires this to the loop controller without introducing a
// transport <-> loops module cycle. It is invoked only when the resolver
// changes an outside-loop position to A, so the controller can apply the
// configured first-pass policy instead of performing a bare seek.
export function setLoopRestartHandler(handler) {
    _loopRestartHandler = typeof handler === 'function' ? handler : null;
}

async function _restartLoopFromOutside(requestedTime, targetTime, trigger, guard = null) {
    if (!_loopRestartHandler) return null;
    try {
        const result = await _loopRestartHandler({
            requestedTime,
            targetTime,
            trigger,
            guard,
        });
        if (result && typeof result === 'object') return result;
        return {
            completed: result === true,
            from: NaN,
            to: result === true ? targetTime : NaN,
        };
    } catch (err) {
        console.warn('[loop] outside-position restart failed:', err);
        return { completed: false, from: NaN, to: NaN };
    }
}

export function _resetAudioSeekState() {
    // Bump the generation — in-flight chain callbacks see the mismatch on
    // their next guard check and short-circuit (no emit, no further state
    // mutation by us). Don't reset the chain head: new seeks must still
    // queue behind the in-flight old seek's IPC so two `jucePlayer.seek()`
    // calls can't race in the JUCE backing engine. The queue drains
    // quickly because each subsequent old-gen step bails on the first
    // guard the moment its predecessor resolves.
    _audioSeekGen++;
    _playAttemptGen++;
    _resumeRequestGen++;
    _resumeInFlight = null;
}

// Time-box the JUCE IPC so a single hung seek can't block the global
// _audioSeekChain forever (which would freeze every subsequent reposition
// path: seekBy, loop-wrap, jump-fix, shimmed audio.currentTime).
const _JUCE_SEEK_TIMEOUT_MS = 2000;

function _juceSeekWithTimeout(s) {
    let timer;
    const seekP = jucePlayer.seek(s);
    const timeoutP = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('JUCE seek timed out')), _JUCE_SEEK_TIMEOUT_MS);
    });
    // Clear the timer once the race settles either way; without this the
    // pending timeout keeps the event loop alive (and eventually rejects
    // an unawaited promise) even after a successful seek.
    return Promise.race([seekP, timeoutP]).finally(() => clearTimeout(timer));
}

// Resolves to `{ completed, from, to }`:
//   - completed: true if the seek ran to completion and emitted song:seek;
//                false if cancelled by a teardown gen bump (or threw).
//   - from: chart clock just before the seek (NaN on cancel before from-read).
//   - to:   verified post-seek clock (NaN on cancel/throw).
// Callers that fire follow-up work after the seek (count-in, arrangement
// restore, etc.) should check `completed` so they don't act on a torn-down
// session. Callers that need the actual landed position (because JUCE may
// clamp or HTML5 may snap to the seekable range) should read `to` rather
// than re-using the requested `s`.
export async function _audioSeek(s, reason, options = {}) {
    // Single funnel for every audio repositioning. Emits song:seek so
    // plugins (notedetect detection-suppression during seek transients,
    // practice-journal segment tracking) can react to any chart-time
    // jump regardless of which UI path triggered it. `reason` is a
    // free-form short string ('seek-by', 'loop-wrap', 'loop-set',
    // 'arrangement-restore', 'jump-fix') so subscribers can filter.
    // While playing, an outside-loop timeline request is a semantic loop
    // restart, not just a redirected seek. Let the loop controller apply its
    // first-pass policy (count-in or immediate). The controller's own seek
    // does not set restartActiveLoopWhilePlaying, so this cannot recurse.
    if (options.restartActiveLoopWhilePlaying
        && S.isPlaying
        && _loopPlayStartTargetResolver
        && _loopRestartHandler) {
        let resolved = s;
        try {
            resolved = _loopPlayStartTargetResolver(s);
        } catch (_) {
            resolved = s;
        }
        if (Number.isFinite(resolved) && Math.abs(resolved - s) > 0.01) {
            return _restartLoopFromOutside(s, resolved, 'seek');
        }
    }

    const gen = _audioSeekGen;
    const guard = typeof options.guard === 'function' ? options.guard : null;
    const permitted = () => {
        if (!guard) return true;
        try { return !!guard(); } catch (_) { return false; }
    };
    _audioSeekChain = _audioSeekChain.then(async () => {
        if (gen !== _audioSeekGen || !permitted()) {
            return { completed: false, from: NaN, to: NaN };
        }
        let target = s;
        if (options.restartActiveLoopWhilePlaying && S.isPlaying && _loopPlayStartTargetResolver) {
            try {
                const resolved = _loopPlayStartTargetResolver(s);
                if (Number.isFinite(resolved)) target = resolved;
            } catch (_) {
                // A UI policy hook must never poison the canonical seek queue.
            }
        }
        const from = _audioTime();
        if (window._juceMode) await _juceSeekWithTimeout(target);
        else audio.currentTime = target;
        if (gen !== _audioSeekGen || !permitted()) {
            return { completed: false, from, to: NaN };
        }
        // Read the verified post-seek position rather than the requested `s`
        // so plugins observe the actual clock — JUCE may clamp or roll back,
        // and HTML5 may snap to the nearest seekable range.
        const to = _audioTime();
        // Sync the jump-fix tracker so the next 60Hz tick doesn't see a
        // legitimate far seek (e.g. saved-loop jump > 30s) as a browser
        // bug and revert it.
        S.lastAudioTime = to;
        // Sync the chart clock too so any song:* emit fired right after
        // _audioSeek resolves (e.g. the auto-resume song:play in
        // changeArrangement) sees an in-sync chartT via _songEventPayload.
        // Without this, chartT lags by one 60Hz tick after a seek.
        if (window.highway && typeof window.highway.setTime === 'function') {
            window.highway.setTime(to);
        }
        window.feedBack.emit('song:seek', { from, to, reason: reason || null });
        return { completed: true, from, to };
    }).catch((err) => {
        // Don't let one failed seek poison subsequent ones.
        console.warn('[_audioSeek]', err);
        return { completed: false, from: NaN, to: NaN };
    });
    return _audioSeekChain;
}

// Physical start is separate from resume policy. A count-in uses this directly,
// avoiding the loop resolver and its own completion promise.
let _playAttemptGen = 0;
let _resumeInFlight = null;
let _resumeRequestGen = 0;

export async function startPhysicalPlayback(options = {}) {
    const session = audioSeekGen();
    const attempt = ++_playAttemptGen;
    const permitted = () => session === audioSeekGen()
        && attempt === _playAttemptGen && (!options.guard || options.guard());
    if (!permitted()) return { status: 'cancelled', completed: false };
    try {
        selectionLifecycle().reconcileBeforePlayback();
        if (window._juceMode) {
            const started = await jucePlayer.play({ guard: permitted });
            if (!permitted()) return { status: 'cancelled', completed: false };
            if (!started) {
                _markPlaybackPaused();
                return { status: 'failed', completed: false };
            }
        } else {
            // Preserve the responsive second-click Pause behavior while the
            // browser waits for buffering or an output device to wake.
            S.isPlaying = true;
            setPlayButtonState(true);
            await audio.play();
            if (!permitted()) {
                // Session replacement pauses the old element. Never pause a
                // newer session or a newer successful start here.
                if (session === audioSeekGen() && attempt === _playAttemptGen) audio.pause();
                return { status: 'cancelled', completed: false };
            }
        }
        _markPlaybackResumed();
        return { status: 'playing', completed: true };
    } catch (err) {
        if (!permitted()) return { status: 'cancelled', completed: false };
        if (!window._juceRerouteInProgress) _markPlaybackPaused();
        console.warn('[app] playback start failed:', err);
        return { status: 'failed', completed: false };
    }
}

export function cancelPlaybackStart() {
    _playAttemptGen++;
    _resumeRequestGen++;
    _resumeInFlight = null;
    _playbackStartOwner()?.cancel?.();
}

export async function pausePlayback() {
    cancelPlaybackStart();
    _markPlaybackPaused();
    if (window._juceMode) await jucePlayer.pause();
    else audio.pause();
}

export function resumePlayback() {
    const owner = _playbackStartOwner();
    if (owner) return owner.completion;
    if (_resumeInFlight) return _resumeInFlight;
    if (S.isPlaying) return Promise.resolve({ status: 'playing', completed: true });
    const session = audioSeekGen();
    const request = ++_resumeRequestGen;
    const permitted = () => session === audioSeekGen() && request === _resumeRequestGen;
    const pending = (async () => {
        if (_loopPlayStartTargetResolver) {
            const current = _audioTime();
            let target = current;
            try {
                const resolved = _loopPlayStartTargetResolver(current);
                if (Number.isFinite(resolved)) target = resolved;
            } catch (_) { /* A UI policy hook must not block ordinary playback. */ }
            if (Number.isFinite(target) && Math.abs(target - current) > 0.01) {
                const restarted = await _restartLoopFromOutside(current, target, 'play', permitted);
                if (!permitted()) return { status: 'cancelled', completed: false };
                if (restarted !== null) {
                    if (!restarted.completed || !Number.isFinite(restarted.to)
                        || Math.abs(restarted.to - target) > 0.05) {
                        return { status: 'failed', completed: false };
                    }
                    const owned = restarted.playbackStart || _playbackStartOwner();
                    if (owned) return owned.completion;
                    return { status: S.isPlaying ? 'playing' : 'failed', completed: !!S.isPlaying };
                }
                const seek = await _audioSeek(target, 'loop-play-start', { guard: permitted });
                if (!seek.completed || Math.abs(seek.to - target) > 0.05) {
                    return { status: 'failed', completed: false };
                }
            }
        }
        if (!permitted()) return { status: 'cancelled', completed: false };
        const owned = _playbackStartOwner();
        if (owned) return owned.completion;
        return startPhysicalPlayback({ guard: permitted });
    })();
    _resumeInFlight = pending;
    pending.finally(() => { if (_resumeInFlight === pending) _resumeInFlight = null; });
    return pending;
}

export async function togglePlay() {
    if (S.isPlaying || _resumeInFlight || _playbackStartOwner()) return pausePlayback();
    return resumePlayback();
}

export async function seekBy(s) {
    await _audioSeek(Math.max(0, _audioTime() + s), 'seek-by', {
        restartActiveLoopWhilePlaying: true,
    });
}

/**
 * Read-only view of the seek generation. Bumped by _resetAudioSeekState() on session
 * teardown; callers capture it before an await and compare after, so a resolution from a
 * torn-down session can't touch new-session state.
 */
export function audioSeekGen() { return _audioSeekGen; }
