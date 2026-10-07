import { installDesktopOutput } from './desktop-output.js';
import { selectionLifecycle } from './screen-selection.js';
// Desktop integration: migrate eligible songs between native and browser
// transports, route the complete browser mix through the selected output,
// and mirror media-element controls while the native transport owns a song.
// Installation runs before the app host is wired, so host calls stay deferred.
import { audio } from './audio-el.js';
import { _audioSeek, _songEventPayload, jucePlayer, setPlayButtonState, resumePlayback, pausePlayback, cancelPlaybackStart } from './transport.js';
import { setSpeed } from './player-controls.js';
import { S } from './player-state.js';

(function _installJuceEngineRoutingWatcher() {
    const juceApi = window.feedBackDesktop?.audio;
    if (!juceApi || typeof juceApi.isAudioRunning !== 'function') {
        // Desktop bridge present but audio API incomplete — the whole
        // exclusive reroute chain is dead and this line is the only witness.
        // (Docker sphere has no bridge at all: stay silent, nothing to
        // diagnose there and no debug flag to gate on.)
        if (window.feedBackDesktop) {
            console.log('[asio-diag] routing watcher NOT installed (audio api incomplete)');
        }
        return;
    }

    let _rerouteInFlight = false;
    // URL that JUCE's loadBackingTrack *explicitly rejected* (ok === false —
    // e.g. a codec it can't read). The poll below would otherwise retry the
    // same doomed track every 350 ms; remember it and skip until the song
    // changes. Only a hard JUCE reject is memoised here — transient failures
    // (a network blip on /api/audio-local-path, an isAudioRunning() race
    // during a device restart) are deliberately NOT memoised so they retry.
    let _rerouteRejectedUrl = null;
    // Exclusive-style output backends silence every other client on the
    // endpoint — including our own <audio> element. The share mode IS the
    // JUCE output device type: "Windows Audio (Exclusive Mode)" is a
    // hardcoded, unlocalised JUCE type name; ASIO drivers typically hold
    // the endpoint exclusively too. "Windows Audio (Low Latency Mode)" is
    // shared and must NOT match.
    function _isExclusiveOutputType(t) {
        return t === 'Windows Audio (Exclusive Mode)' || t === 'ASIO';
    }
    // [feedpak-route] diagnostics: log the raw outputType string once per
    // value change (this runs on a 350ms poll — logging every tick would
    // flood the diagnostics buffer).
    let _loggedOutputType;
    // [asio-diag] verbose diagnostics, gated on --debug (preload exposes
    // audio.debugEnabled). Resolved once at install; until it resolves the
    // flag stays false and verbose lines are skipped. Shared with the
    // renderer-bus feeder below via window._asioDiagEnabled.
    let _asioDiag = false;
    if (typeof juceApi.debugEnabled === 'function') {
        juceApi.debugEnabled().then((v) => {
            _asioDiag = !!v;
            // Deferred install line: the flag resolves async, so logging at
            // IIFE entry would race it. Change-detection isn't needed — this
            // runs once per page load.
            if (_asioDiag) console.log('[asio-diag] routing watcher installed');
        }).catch(() => {});
    }
    window._asioDiagEnabled = () => _asioDiag;
    async function _outputIsExclusive() {
        if (typeof juceApi.getCurrentDevice !== 'function') {
            if (_loggedOutputType !== '<no-getCurrentDevice>') {
                _loggedOutputType = '<no-getCurrentDevice>';
                console.warn('[feedpak-route] juceApi.getCurrentDevice missing — cannot detect exclusive output');
            }
            return false;
        }
        try {
            const dev = await juceApi.getCurrentDevice();
            const t = dev?.outputType || dev?.type || '';
            const excl = _isExclusiveOutputType(t);
            if (t !== _loggedOutputType) {
                _loggedOutputType = t;
                console.log('[feedpak-route] outputType=', JSON.stringify(t), '→ exclusive=', excl);
                // [asio-diag] full device object on every type change — shows
                // the exact strings the predicate saw (inputType vs outputType,
                // device names, duplex), so a driver reporting a non-'ASIO'
                // type name is visible in tester logs.
                if (_asioDiag) {
                    try {
                        console.log('[asio-diag] getCurrentDevice=', JSON.stringify(dev));
                    } catch (_) { /* circular/hostile object — skip */ }
                }
            }
            return excl;
        } catch (e) {
            if (_loggedOutputType !== '<getCurrentDevice-failed>') {
                _loggedOutputType = '<getCurrentDevice-failed>';
                console.warn('[feedpak-route] getCurrentDevice failed:', e);
            }
            return false;
        }
    }
    // window.highway.js's initial song-load routing consults this for the same
    // feedpak-under-exclusive decision the watcher makes below.
    window._juceOutputIsExclusive = _outputIsExclusive;
    // Returns true when window._currentSongAudio no longer references the exact
    // snapshot object captured at reroute entry — i.e. the song was swapped (or
    // cleared) mid-flight. Staleness is detected by object-reference identity,
    // not by URL value.
    function _isStale(songAudio) {
        return window._currentSongAudio !== songAudio;
    }

    // Migrates the loaded song from the HTML5 element onto the JUCE backing
    // transport. Throws only on transient/unexpected failures.
    // `songAudio` is the snapshot captured at reroute entry; if it stops being
    // the current song mid-flight we abort without mutating global routing.
    // Returns a distinct string outcome — the caller must NOT conflate them:
    //   'switched' — song now plays via JUCE.
    //   'rejected' — JUCE hard-rejected the track (codec). Caller memoises it.
    //   'stale'    — the loaded song changed mid-flight; aborted, NOT memoised.
    // (a transient transport-start failure throws instead — also not memoised.)
    async function _switchHtml5ToJuce(songAudio) {
        const url = songAudio.url;
        const wasPlaying = S.isPlaying;
        const pos = audio.currentTime || 0;
        window.feedBack?.playback?.recordRouteChange?.({
            routeKind: 'desktop-native',
            state: 'switching',
            preservedTime: true,
            safeReason: 'desktop audio engine became active',
            requesterId: 'core.juce-route',
        });
        // Mark a reroute in progress so the <audio> 'play'/'pause' listeners
        // suppress their song:play / song:pause emissions: the migration is
        // transparent — playback genuinely continues — so plugin state and
        // window.feedBack.isPlaying must NOT flip. This also silences the
        // "Audio paused unexpectedly" diagnostic. A REFCOUNT (not a boolean)
        // lets an overlapping reroute's deferred release coexist: each switch
        // increments on entry and decrements after its own timeout; listeners
        // treat any count > 0 as "reroute active".
        window._juceRerouteInProgress = (window._juceRerouteInProgress || 0) + 1;
        audio.pause();
        try {
            const res = await fetch(`/api/audio-local-path?url=${encodeURIComponent(url)}`);
            if (!res.ok) {
                console.warn('[feedpak-route] audio-local-path HTTP', res.status, 'for', url);
                throw new Error('HTTP ' + res.status);
            }
            const { path } = await res.json();
            console.log('[feedpak-route] audio-local-path resolved:', (typeof path === 'string' && path.split(/[\\/]/).pop()) || '<missing>');
            if (_isStale(songAudio)) return 'stale';   // song changed mid-fetch
            const ok = await juceApi.loadBackingTrack(path);
            if (ok === false) {
                // JUCE rejected the track — stay on HTML5, resume if needed.
                console.warn('[juce-reroute] loadBackingTrack rejected; staying on HTML5');
                // Only resume if the element still has a source. In the normal
                // flow audio.src is intact here, but a prior HTML5→JUCE switch
                // clears it — re-point + load before resuming so a bounced
                // reroute doesn't try to play() an empty element.
                if (S.isPlaying && !_isStale(songAudio)) {
                    if (!audio.src) { audio.src = url; audio.load(); }
                    try { selectionLifecycle().reconcileBeforePlayback(); await audio.play(); } catch (_) { /* ignore */ }
                }
                window.feedBack?.playback?.recordRouteChange?.({
                    routeKind: 'browser-media',
                    state: 'degraded',
                    preservedTime: true,
                    safeReason: 'desktop audio route rejected track; kept browser media route',
                    requesterId: 'core.juce-route',
                });
                return 'rejected';
            }
            if (_isStale(songAudio)) return 'stale';
            const dur = await juceApi.getBackingDuration();
            await juceApi.seekBacking(pos);
            // Start the new transport BEFORE committing global routing state, so
            // a play() failure can't leave us in "JUCE mode, nothing playing"
            // (the silent-song state this watcher exists to prevent).
            // jucePlayer.play() RETURNS false (it does not throw) when
            // startBacking fails — check the result, don't just await it.
            // A play() failure is a TRANSIENT transport-start issue, not a hard
            // codec reject: throw (rather than returning 'rejected') so the
            // caller's catch path handles it WITHOUT memoising the URL, leaving
            // it free to retry on the next poll. Only 'rejected' is memoised.
            // Re-read isPlaying as late as possible: the user can press Pause
            // during the multi-await fetch/IPC chain above. Starting the JUCE
            // transport off a stale `wasPlaying` snapshot would resume a song
            // the user just paused. Only start it if playback is still wanted.
            if (S.isPlaying) {
                const started = await jucePlayer.play();
                if (started === false) {
                    if (!_isStale(songAudio) && S.isPlaying) {
                        try { selectionLifecycle().reconcileBeforePlayback(); await audio.play(); } catch (_) { /* ignore */ }
                    }
                    throw new Error('jucePlayer.play() failed (transient transport start)');
                }
            }
            if (_isStale(songAudio)) {
                // Song changed while JUCE was spinning up — undo and bail.
                await jucePlayer.pause().catch(() => {});
                return 'stale';
            }
            if (window.jucePlayer) {
                jucePlayer._dur = dur;
                jucePlayer._pos = pos;
                jucePlayer._pollAt = performance.now();
            }
            window._juceMode = true;
            window._juceAudioUrl = url;
            const _spSlider = document.getElementById?.('speed-slider');
            if (_spSlider) setSpeed(_spSlider.value / 100);
            audio.src = '';
            try {
                const apply = window.feedBack?.audio?.applySongVolume;
                if (typeof apply === 'function') await apply();
            } catch (_) { /* best-effort */ }
            console.log('[juce-reroute] HTML5 → JUCE @', pos.toFixed(2), 's playing=', wasPlaying);
            window.feedBack?.playback?.recordRouteChange?.({
                routeKind: 'desktop-native',
                state: 'active',
                preservedTime: true,
                safeReason: 'desktop audio route active',
                requesterId: 'core.juce-route',
            });
            return 'switched';
        } catch (err) {
            // Path lookup, JSON parse, or a JUCE IPC call threw partway through.
            // audio.pause() already ran above; restore HTML5 playback so a
            // previously playing song isn't left silently paused, then re-throw
            // so the caller logs it. The caller does NOT memoise this URL —
            // transient failures must retry on the next poll.
            if (S.isPlaying && !window._juceMode && !_isStale(songAudio)) {
                if (!audio.src) { audio.src = url; audio.load(); }
                try { selectionLifecycle().reconcileBeforePlayback(); await audio.play(); } catch (_) { /* ignore */ }
            }
            window.feedBack?.playback?.recordRouteChange?.({
                routeKind: 'browser-media',
                state: 'degraded',
                preservedTime: true,
                safeReason: 'desktop audio route failed; kept browser media route',
                requesterId: 'core.juce-route',
            });
            throw err;
        } finally {
            // Clearing audio.src above dispatches a 'pause' event in a later
            // task, after this synchronous finally. Defer the refcount
            // decrement so that trailing event is still suppressed; a 0ms
            // timeout lands after the pending pause-event task. Decrementing
            // (rather than zeroing) leaves any overlapping reroute's own
            // suppression intact.
            setTimeout(() => {
                window._juceRerouteInProgress = Math.max(
                    0, (window._juceRerouteInProgress || 1) - 1);
            }, 0);
        }
    }

    async function _switchJuceToHtml5(songAudio) {
        const url = songAudio.url;
        const wasPlaying = S.isPlaying;
        const pos = (window.jucePlayer ? jucePlayer.currentTime : 0) || 0;
        window.feedBack?.playback?.recordRouteChange?.({
            routeKind: 'browser-media',
            state: 'switching',
            preservedTime: true,
            safeReason: 'desktop audio engine stopped',
            requesterId: 'core.juce-route',
        });
        // Mark a reroute in progress (refcount) so the <audio> 'play' listener
        // suppresses its song:play emission — the migration is transparent and
        // playback genuinely continues, so plugin state must not flip. Held
        // until after the (possibly deferred) audio.play() event has fired.
        window._juceRerouteInProgress = (window._juceRerouteInProgress || 0) + 1;
        let _suppressionReleased = false;
        const _releaseSuppression = () => {
            if (_suppressionReleased) return;
            _suppressionReleased = true;
            // Defer so the 'play' (or 'pause') event task fires while still
            // suppressed; a 0ms timeout lands after it.
            setTimeout(() => {
                window._juceRerouteInProgress = Math.max(
                    0, (window._juceRerouteInProgress || 1) - 1);
            }, 0);
        };
        let _resumeScheduled = false;
        try {
            await jucePlayer.pause().catch(() => {});
            if (_isStale(songAudio)) return;           // song changed mid-pause
            window._juceMode = false;
            window._juceAudioUrl = null;
            audio.src = url;
            audio.load();
            const _spSlider = document.getElementById?.('speed-slider');
            if (_spSlider) setSpeed(_spSlider.value / 100);
            // Resume only AFTER the seek so playback starts at `pos`, not at 0
            // with an audible jump once metadata arrives.
            const resumeAtPos = () => {
                try {
                    // The metadata event can land after a fast song switch —
                    // bail before touching currentTime so a stale callback
                    // doesn't seek the newly loaded song to the old position.
                    if (_isStale(songAudio)) return;
                    try { audio.currentTime = pos; } catch (_) { /* ignore */ }
                    // Re-read isPlaying (not the entry snapshot): the user may
                    // have pressed Pause during jucePlayer.pause()/metadata
                    // load — don't resume a song they just paused.
                    if (S.isPlaying) {
                        selectionLifecycle().reconcileBeforePlayback();
                        audio.play().catch(() => { /* ignore */ });
                    }
                } finally {
                    _releaseSuppression();
                }
            };
            _resumeScheduled = true;
            if (audio.readyState >= 1) {
                resumeAtPos();
            } else {
                // Wait for metadata to resume at `pos`. But metadata may never
                // arrive (bad URL, network error) — that would leak the
                // suppression refcount and permanently silence song:play /
                // song:pause. Guard with the element's 'error' event AND a
                // backstop timeout; whichever fires first wins, the others are
                // detached. _releaseSuppression is idempotent regardless.
                let _settled = false;
                const _onMeta = () => { finish(true); };
                const _onErr = () => { finish(false); };
                let _backstop;
                function finish(reachedMetadata) {
                    if (_settled) return;
                    _settled = true;
                    clearTimeout(_backstop);
                    audio.removeEventListener('loadedmetadata', _onMeta);
                    audio.removeEventListener('error', _onErr);
                    if (reachedMetadata) {
                        resumeAtPos();             // resumeAtPos releases suppression
                    } else {
                        _releaseSuppression();     // no resume — just release
                    }
                }
                audio.addEventListener('loadedmetadata', _onMeta, { once: true });
                audio.addEventListener('error', _onErr, { once: true });
                // 10s is well beyond a normal local-file metadata load.
                _backstop = setTimeout(() => { finish(false); }, 10000);
            }
        } finally {
            // resumeAtPos owns the release once scheduled; if we returned
            // early (stale, before scheduling) release here instead.
            // _releaseSuppression is idempotent so an overlap is harmless.
            if (!_resumeScheduled) _releaseSuppression();
        }
        try {
            const apply = window.feedBack?.audio?.applySongVolume;
            if (typeof apply === 'function') await apply();
        } catch (_) { /* best-effort */ }
        console.log('[juce-reroute] JUCE → HTML5 @', pos.toFixed(2), 's playing=', wasPlaying);
        window.feedBack?.playback?.recordRouteChange?.({
            routeKind: 'browser-media',
            state: 'active',
            preservedTime: true,
            safeReason: 'browser media route active',
            requesterId: 'core.juce-route',
        });
    }

    async function _reevaluateJuceRouting() {
        if (_rerouteInFlight) return;
        const songAudio = window._currentSongAudio;
        // /audio/ songs are always JUCE-routable. A feedpak full-mix
        // (single-mix pack, no stems) is routable ONLY under an
        // exclusive-style output — in shared mode it must stay on HTML5 so
        // the stem mixer / WebAudio path keeps working. Sloppak stem URLs
        // are never routable (per-stem mix can't ride a single transport).
        if (!songAudio || (!songAudio.juceEligible && !songAudio.feedpakFullMix)) return;
        // Don't race window.highway.js's own initial song-load routing: it owns
        // _juceMode until _juceRoutingPromise settles. Re-running our switch
        // concurrently would double-call loadBackingTrack for the same URL.
        if (window._highwayJuceRoutingPending) return;

        // Claim the in-flight guard SYNCHRONOUSLY, before the first await. The
        // watcher is driven by a 350ms setInterval; if isAudioRunning() (or any
        // later await) stalls past the poll period, a second tick would
        // otherwise pass the `if (_rerouteInFlight) return` check above and run
        // a concurrent switch — duplicate loadBackingTrack IPCs racing on
        // _juceMode / audio.src. Setting it here closes that window.
        _rerouteInFlight = true;
        try {
            let running;
            try { running = await juceApi.isAudioRunning(); }
            catch (_) { return; }
            if (_isStale(songAudio)) return;               // song changed during IPC
            // Eligibility is evaluated per tick, not snapshotted at song load:
            // the output share mode can change mid-song (device switch in the
            // Audio Engine panel), and a feedpak full-mix must follow it —
            // exclusive → ride the engine; back to shared → return to HTML5.
            let eligible = !!songAudio.juceEligible;
            if (!eligible && songAudio.feedpakFullMix && running) {
                eligible = await _outputIsExclusive();
                if (_isStale(songAudio)) return;           // song changed during IPC
            }
            const wantJuce = !!(running && eligible);
            // [feedpak-route] diagnostics: one line per decision change (the
            // watcher polls at 350ms; steady state must not spam the buffer).
            const _decision = 'running=' + running + ' eligible=' + eligible
                + ' feedpakFullMix=' + !!songAudio.feedpakFullMix
                + ' juceMode=' + !!window._juceMode + ' url=' + songAudio.url;
            if (_decision !== window._lastFeedpakRouteDecision) {
                window._lastFeedpakRouteDecision = _decision;
                console.log('[feedpak-route] watcher:', _decision);
            }
            if (wantJuce === !!window._juceMode) return;   // routing already consistent
            // Don't keep retrying a track JUCE explicitly rejected.
            if (wantJuce && songAudio.url === _rerouteRejectedUrl) return;

            if (wantJuce) {
                const outcome = await _switchHtml5ToJuce(songAudio);
                // Memoise ONLY an explicit hard JUCE reject. A successful
                // switch clears the memo; a 'stale' abort (song changed
                // mid-flight) leaves it untouched — it must never be
                // misclassified as a reject, even if the song object was
                // swapped and then restored before this point.
                if (outcome === 'rejected') {
                    _rerouteRejectedUrl = songAudio.url;
                } else if (outcome === 'switched') {
                    _rerouteRejectedUrl = null;
                }
                // outcome === 'stale': leave _rerouteRejectedUrl as-is.
            } else {
                await _switchJuceToHtml5(songAudio);
                // The engine stopped (or a feedpak's output left exclusive
                // mode). Clear any hard-reject memo so a later engine restart
                // or mode change re-evaluates the track at least once — the
                // rejection may have been a transient device/decoder state.
                _rerouteRejectedUrl = null;
            }
        } catch (e) {
            // Transient failure — log but do NOT memoise, so the next poll retries.
            console.warn('[juce-reroute] re-route failed (will retry):', e);
        } finally {
            _rerouteInFlight = false;
        }
    }
    window._reevaluateJuceRouting = _reevaluateJuceRouting;

    // Clears the hard-reject memo. Called from the song-teardown sites that
    // null window._currentSongAudio (showScreen, playSong) so that reloading
    // the same file later gets a fresh routing attempt — a prior reject may
    // have been a transient JUCE/device state, not a permanent codec issue.
    window._clearJuceRerouteMemo = function () { _rerouteRejectedUrl = null; };

    // The engine can be started/stopped from several places (the desktop Audio
    // Engine panel, the audio_engine plugin, note_detect) and via setDevice
    // restarts — and the contextBridge api object is frozen, so its methods
    // can't be wrapped. Poll isAudioRunning() while a song is loaded; the check
    // is a cheap IPC boolean and no-ops once routing is already consistent.
    // Skip the poll while the document is hidden (background tab / minimised
    // window) — engine toggles there will be reconciled on the first poll
    // after the tab is visible again.
    setInterval(() => {
        if (document.hidden) return;
        if (window._currentSongAudio) void _reevaluateJuceRouting();
    }, 350);
})();

// Route every browser playback surface through the selected desktop output.
installDesktopOutput();

// Desktop JUCE backing uses an empty <audio> element; plugins such as Section Map
// still seek via audio.currentTime / pause / play. Mirror those onto jucePlayer
// while _juceMode is active. Same-tick pause+seek coalesce into a single seek
// (no stopBacking before seek — HTML5 needed that for buffering; JUCE does not).
export let _resetJuceAudioShimChain = function () {};
(function _installJuceAudioElementShim() {
    if (!window.feedBackDesktop?.audio) return;

    const mediaProto = HTMLMediaElement.prototype;
    const ctDesc = Object.getOwnPropertyDescriptor(mediaProto, 'currentTime');
    const pausedDesc = Object.getOwnPropertyDescriptor(mediaProto, 'paused');
    if (!ctDesc?.get || !ctDesc?.set || !pausedDesc?.get) return;

    const nativePlay = mediaProto.play;
    const nativePause = mediaProto.pause;

    let chain = Promise.resolve();
    /** Same-tick pause + seek (Section Map): coalesce to one seek — no stopBacking before seek. */
    let _juceShimBatch = null;
    let _juceShimBatchFlushScheduled = false;
    let _juceShimGen = 0;
    function enqueue(fn) {
        const gen = _juceShimGen;
        const p = chain.then(async () => {
            if (gen !== _juceShimGen) return;
            return fn(gen);
        });
        chain = p.catch((e) => {
            console.warn('[juce-audio-shim]', e);
        });
        return p;
    }
    // forUpcomingPlay: caller will enqueue a play() right after, so don't
    // emit pause-state side effects for a wantsPause batch — play() will
    // overwrite them anyway.
    function flushJuceShimBatchNow({ forUpcomingPlay = false } = {}) {
        _juceShimBatchFlushScheduled = false;
        const batch = _juceShimBatch;
        _juceShimBatch = null;
        if (!batch || !window._juceMode) return;
        const wantsPause = !!batch.wantsPause;
        const seekTime = batch.seekTime;
        // A prior queued Play may be awaiting this countdown. Cancel ownership
        // before queuing Pause so the queue cannot hold Pause behind that Play.
        if (wantsPause && !forUpcomingPlay) cancelPlaybackStart();
        if (wantsPause && seekTime !== undefined) {
            enqueue(async (gen) => {
                if (!forUpcomingPlay) {
                    await pausePlayback();
                    if (gen !== _juceShimGen) return;
                }
                const r = await _audioSeek(seekTime, 'audio-element-shim', {
                    restartActiveLoopWhilePlaying: forUpcomingPlay,
                });
                if (!r.completed || gen !== _juceShimGen) return;
                audio.dispatchEvent(new Event('seeked'));
            });
            return;
        }
        if (wantsPause) {
            enqueue(async () => { await pausePlayback(); });
            return;
        }
        if (seekTime !== undefined) {
            enqueue(async (gen) => {
                const r = await _audioSeek(seekTime, 'audio-element-shim', {
                    restartActiveLoopWhilePlaying: true,
                });
                if (!r.completed) return; // seek cancelled by teardown
                if (gen !== _juceShimGen) return;
                audio.dispatchEvent(new Event('seeked'));
            });
        }
    }
    function scheduleJuceShimBatchFlush() {
        if (_juceShimBatchFlushScheduled) return;
        _juceShimBatchFlushScheduled = true;
        const flushGen = _juceShimGen;
        queueMicrotask(() => {
            if (flushGen !== _juceShimGen) {
                _juceShimBatchFlushScheduled = false;
                return;
            }
            flushJuceShimBatchNow();
        });
    }
    _resetJuceAudioShimChain = function () {
        chain = Promise.resolve();
        _juceShimBatch = null;
        _juceShimBatchFlushScheduled = false;
        _juceShimGen++;
    };

    Object.defineProperty(audio, 'currentTime', {
        get() {
            if (window._juceMode) return jucePlayer.currentTime;
            return ctDesc.get.call(this);
        },
        set(v) {
            if (window._juceMode) {
                const t = Math.max(0, Number(v) || 0);
                _juceShimBatch = _juceShimBatch || {};
                _juceShimBatch.seekTime = t;
                scheduleJuceShimBatchFlush();
                return;
            }
            ctDesc.set.call(this, v);
        },
        configurable: true,
    });

    Object.defineProperty(audio, 'paused', {
        get() {
            if (window._juceMode) return !S.isPlaying;
            return pausedDesc.get.call(this);
        },
        configurable: true,
    });

    audio.pause = function () {
        if (window._juceMode) {
            _juceShimBatch = _juceShimBatch || {};
            _juceShimBatch.wantsPause = true;
            scheduleJuceShimBatchFlush();
            return;
        }
        nativePause.call(audio);
    };

    audio.play = function () {
        if (window._juceMode) {
            if (_juceShimBatch != null) flushJuceShimBatchNow({ forUpcomingPlay: true });
            const p = enqueue(async (gen) => {
                // The preceding seek may already own a countdown. Join its
                // actual start instead of issuing a second physical Play.
                if (gen !== _juceShimGen) return;
                await resumePlayback();
            });
            return p.then(() => undefined);
        }
        return nativePlay.call(audio);
    };
})();
