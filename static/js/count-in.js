// Count-in — the 1-2-3-4 click before playback, plus the song-credits overlay that
// shares its lifecycle and timers.
//
// The third slice out of app.js's strongly-connected core, and the first that had to
// WRITE shared state rather than just read it. It starts and stops playback, so it sets
// `isPlaying` and `lastAudioTime`. An imported binding is read-only — `isPlaying = true`
// throws — which is exactly why those two scalars were lifted onto the container in
// ./player-state.js. Every earlier slice only READ what it shared, so a getter hook
// sufficed; this one could not.
//
// Loop bounds are supplied as an immutable snapshot by the loop controller. A
// legacy direct caller may fall back to window.feedBack.getLoop(), but this
// module neither owns nor imports loop state, so the dependency graph stays
// acyclic.
//
// app.js's autoplay path used to reach IN and set the credits timers itself. It cannot
// now, and it should not have to — so the module exports the OPERATIONS instead
// (armCreditsHideOnPlay, scheduleCreditsHide, holdCreditsThen, isCountingIn) and owns
// its own timer invariants. Same reason section-practice grew resetSelection().
//
// See ./host.js: reading an unwired hook THROWS, and tests/js/host_contract.test.js
// fails CI if the hooks used here and the hooks app.js wires ever drift apart.
import { audio } from './audio-el.js';
import { _audioSeek, audioSeekGen, _markPlaybackPaused, jucePlayer, startPhysicalPlayback } from './transport.js';
import { S } from './player-state.js';

// ── Count-in click sound (Web Audio API) ────────────────────────────────
let _audioCtx = null;
export function playClick(high = false) {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = high ? 1200 : 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.5, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.08);
    osc.start(_audioCtx.currentTime);
    osc.stop(_audioCtx.currentTime + 0.08);
}

let _countingIn = false;
let _countInStart = null;

// Ownership begins before pause/seek, and survives the final asynchronous
// physical Play. A queued compatibility Play can join this promise safely.
export function getCountInStart() {
    return _countInStart;
}

function _newCountInStart() {
    let resolve;
    const owner = {
        session: audioSeekGen(),
        generation: _countInGen,
        completion: new Promise(done => { resolve = done; }),
        resolve: outcome => resolve(outcome),
        cancel: () => _cancelCountIn(),
    };
    _countInStart = owner;
    _countingIn = true;
    return owner;
}

function _currentCountIn(owner) {
    return _countInStart === owner && owner.generation === _countInGen
        && owner.session === audioSeekGen();
}

function _finishCountIn(owner, outcome) {
    if (!_currentCountIn(owner)) return;
    _countInStart = null;
    _countingIn = false;
    hideCountOverlay();
    if (!outcome.completed) _markPlaybackPaused();
    owner.resolve(outcome);
}
let _countOverlay = null;
// Generation token so teardown can cancel an in-progress count-in. Each
// startCountIn() captures the gen at entry; rewindStep, the loop-wrap
// then-callback, and beginCount's tick all bail when their captured gen
// no longer matches. Bumped by _cancelCountIn().
let _countInGen = 0;
let _countInTimer = null;
let _countInRaf = 0;
// Feedpak credits overlay (manifest `authors:`, spec §5.4): shown on the
// highway when a song is loaded, alongside the count-in. Torn down together
// with the count-in via _cancelCountIn().
let _creditsOverlay = null;
let _creditsTimer = null;
let _creditsHideOnPlay = null;
let _creditsMaxTimer = null;
const _CREDITS_HOLD_MS = 3000;
// Backstop: the overlay's primary dismiss is song:play, but playback can fail
// to start without emitting it (HTML5 autoplay rejection, JUCE start failure,
// a count-in handoff that never plays). This hard cap guarantees the credits
// never linger over the window.highway. Generous enough to outlast a normal count-in.
const _CREDITS_MAX_MS = 12000;
export function _cancelCountIn(options = {}) {
    const owner = _countInStart;
    _countInStart = null;
    _countInGen++;
    if (owner) {
        owner.resolve({ status: 'cancelled', completed: false });
        if (options.reconcile !== false && owner.session === audioSeekGen()) _markPlaybackPaused();
    }
    _countingIn = false;
    hideCountOverlay();
    // The credits overlay rides the count-in lifecycle (and its no-count-in
    // hold timer), so a teardown — leaving the player, loading another song —
    // must clear it too, or it lingers on the next screen.
    hideSongCreditsOverlay();
    if (_countInTimer) { clearTimeout(_countInTimer); _countInTimer = null; }
    if (_countInRaf) { cancelAnimationFrame(_countInRaf); _countInRaf = 0; }
}

export function showCountOverlay(n) {
    if (!_countOverlay) {
        _countOverlay = document.createElement('div');
        _countOverlay.className = 'fixed inset-0 z-[100] flex items-center justify-center pointer-events-none';
        document.body.appendChild(_countOverlay);
    }
    _countOverlay.innerHTML = `<span class="text-9xl font-black text-white/30">${n}</span>`;
}

export function hideCountOverlay() {
    if (_countOverlay) { _countOverlay.remove(); _countOverlay = null; }
}

// Map a feedpak author `role` to a friendly "<verb> by" credit line. The
// recommended vocabulary is from feedpak spec §5.4; unknown roles are
// title-cased ("foo" → "Foo by"); a missing role shows the bare name.
const _CREDIT_ROLE_VERBS = {
    charter: 'Charted by',
    transcriber: 'Transcribed by',
    arranger: 'Arranged by',
    editor: 'Edited by',
    mixer: 'Mixed by',
    engineer: 'Engineered by',
    proofreader: 'Proofread by',
};

function _creditLineLabel(role) {
    if (!role) return '';
    const key = String(role).trim().toLowerCase();
    if (_CREDIT_ROLE_VERBS[key]) return _CREDIT_ROLE_VERBS[key];
    return key.charAt(0).toUpperCase() + key.slice(1) + ' by';
}

// Show the feedpak contributor credits over the window.highway. `authors` is the
// sanitized [{name, role}] list from window.feedBack.currentSong.authors.
// Anchored to the lower third (bottom-center) so it never collides with the
// vertically-centered count-in number, and pointer-events-none so it never
// intercepts clicks. No-op when there are no contributors to show.
export function showSongCreditsOverlay(authors) {
    if (!Array.isArray(authors) || authors.length === 0) return;
    if (!_creditsOverlay) {
        _creditsOverlay = document.createElement('div');
        _creditsOverlay.className = 'song-credits-overlay';
        document.body.appendChild(_creditsOverlay);
    }
    // Build via DOM + textContent — author names are untrusted pack data and
    // must never be interpolated as HTML.
    _creditsOverlay.replaceChildren();
    const card = document.createElement('div');
    card.className = 'song-credits-card';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'song-credits-eyebrow';
    eyebrow.textContent = 'Credits';
    card.appendChild(eyebrow);

    const title = (window.feedBack && window.feedBack.currentSong
        && window.feedBack.currentSong.title) || '';
    if (title) {
        const heading = document.createElement('div');
        heading.className = 'song-credits-heading';
        heading.textContent = title;
        card.appendChild(heading);
    }

    for (const a of authors) {
        if (!a || !a.name) continue;
        const row = document.createElement('div');
        row.className = 'song-credits-line';
        const label = _creditLineLabel(a.role);
        if (label) {
            const lab = document.createElement('span');
            lab.className = 'song-credits-role';
            lab.textContent = label + ' ';
            row.appendChild(lab);
        }
        const nm = document.createElement('span');
        nm.className = 'song-credits-name';
        nm.textContent = a.name;
        row.appendChild(nm);
        card.appendChild(row);
    }
    _creditsOverlay.appendChild(card);
    // Arm the backstop so the overlay self-clears even if playback never starts
    // / never emits song:play. song:play (or any teardown) clears it earlier.
    if (_creditsMaxTimer) clearTimeout(_creditsMaxTimer);
    _creditsMaxTimer = setTimeout(hideSongCreditsOverlay, _CREDITS_MAX_MS);
}

export function hideSongCreditsOverlay() {
    if (_creditsTimer) { clearTimeout(_creditsTimer); _creditsTimer = null; }
    if (_creditsMaxTimer) { clearTimeout(_creditsMaxTimer); _creditsMaxTimer = null; }
    if (_creditsHideOnPlay) {
        window.feedBack.off('song:play', _creditsHideOnPlay);
        _creditsHideOnPlay = null;
    }
    if (_creditsOverlay) { _creditsOverlay.remove(); _creditsOverlay = null; }
}

// Stop the physical backing transport before an initial loop seek. Keeping
// this next to startCountIn makes the JUCE and HTML5 paths use the same pause
// semantics while allowing the loop controller to establish the important
// pause -> seek -> count-in order.
export async function pauseBackingForCountIn() {
    const owner = _countInStart || _newCountInStart();
    let paused = true;
    if (window._juceMode) paused = await jucePlayer.pause();
    else audio.pause();
    if (!_currentCountIn(owner)) return false;
    if (paused === false) {
        _finishCountIn(owner, { status: 'failed', completed: false });
        return false;
    }
    return true;
}

function _beginCount(owner, startTime) {
    let bpm = window.highway.getBPM(startTime);
    if (!Number.isFinite(bpm) || bpm <= 0) bpm = 120;
    let count = 0;
    const tick = async () => {
        if (!_currentCountIn(owner)) return;
        count++;
        if (count > 4) {
            hideCountOverlay();
            const outcome = await startPhysicalPlayback({ guard: () => _currentCountIn(owner) });
            _finishCountIn(owner, outcome);
            return;
        }
        showCountOverlay(count);
        playClick(count === 1);
        _countInTimer = setTimeout(tick, 60000 / bpm);
    };
    _countInTimer = setTimeout(tick, 500);
}

export async function startCountIn(opts = {}) {
    if (_countingIn && !opts.backingAlreadyPaused) return false;
    let requestedBounds = opts.bounds && typeof opts.bounds === 'object' ? opts.bounds : null;
    if (!requestedBounds && window.feedBack && typeof window.feedBack.getLoop === 'function') {
        try { requestedBounds = window.feedBack.getLoop(); } catch (_) { return false; }
    }
    const loopA = Number(requestedBounds && (requestedBounds.a ?? requestedBounds.loopA));
    const loopB = Number(requestedBounds && (requestedBounds.b ?? requestedBounds.loopB));
    if (!Number.isFinite(loopA) || !Number.isFinite(loopB) || loopB <= loopA) return false;
    const owner = _countInStart || _newCountInStart();
    if (!opts.backingAlreadyPaused && !await pauseBackingForCountIn()) return false;
    if (!_currentCountIn(owner)) return false;

    const begin = time => {
        S.lastAudioTime = time;
        if (typeof window.highway.freezeTime === 'function') window.highway.freezeTime(time);
        else window.highway.setTime(time);
        window.feedBack?.emit('loop:restart', { loopA, loopB, time: loopA });
        _beginCount(owner, loopA);
    };
    if (opts.immediate) {
        begin(loopA);
        return true;
    }

    const rewindStart = performance.now();
    const rewindStep = now => {
        if (!_currentCountIn(owner)) return;
        const t = Math.min((now - rewindStart) / 400, 1);
        const eased = 1 - (1 - t) * (1 - t);
        window.highway.setTime(loopB + (loopA - loopB) * eased);
        if (t < 1) {
            _countInRaf = requestAnimationFrame(rewindStep);
            return;
        }
        _countInRaf = 0;
        _audioSeek(loopA, 'loop-wrap', { guard: () => _currentCountIn(owner) }).then(result => {
            if (!_currentCountIn(owner)) return;
            if (!result.completed || Math.abs(result.to - loopA) > 0.05) {
                _finishCountIn(owner, { status: 'failed', completed: false });
                return;
            }
            begin(result.to);
        });
    };
    _countInRaf = requestAnimationFrame(rewindStep);
    return true;
}

// Song-load count-ins share the same start owner and cancellation semantics.
export async function startSongCountIn() {
    if (_countingIn) return;
    const owner = _newCountInStart();
    if (!await pauseBackingForCountIn() || !_currentCountIn(owner)) return;
    _beginCount(owner, S.lastAudioTime || 0);
}

// ── Operations app.js's autoplay path used to perform by reaching in ────────
// It used to assign _creditsTimer / _creditsHideOnPlay directly. Imported bindings are
// read-only, and the module should own its own timer invariants anyway.

/** Is a count-in running? app.js's timeupdate handler suppresses highway sync during one. */
export function isCountingIn() {
    return _countingIn;
}

/** Dismiss the credits the moment real playback begins. Fires once. */
export function armCreditsHideOnPlay() {
    _creditsHideOnPlay = () => { _creditsHideOnPlay = null; hideSongCreditsOverlay(); };
    window.feedBack.on('song:play', _creditsHideOnPlay, { once: true });
}

/** Let the credits dwell, then clear them. Used when autoplay-exit is disabled. */
export function scheduleCreditsHide() {
    _creditsTimer = setTimeout(hideSongCreditsOverlay, _CREDITS_HOLD_MS);
}

/** Let the credits dwell, then run `then` (the autoplay start). */
export function holdCreditsThen(then) {
    _creditsTimer = setTimeout(() => { _creditsTimer = null; then(); }, _CREDITS_HOLD_MS);
}
