// Audio mixer — registry + popover for per-channel volume control (feedBack#87).
//
// Plugins (or core) register a fader spec via window.feedBack.audio.registerFader(spec).
// Each spec is the source of truth for its own value: the popover only calls
// getValue() to render and setValue() to commit. Persistence is the plugin's
// responsibility — the registry doesn't store values.
//
// Spec shape:
//   { id, label, min, max, step, defaultValue, getValue, setValue }
(function () {
'use strict';

if (!window.feedBack) {
    console.warn('[mixer] window.feedBack missing — audio-mixer.js loaded too early');
    return;
}

const _faders = new Map();
let _popoverEl = null;
let _btnEl = null;
let _open = false;
let _openTimer = null;
let _lastSongRouteKey = '';
let _pendingPersistedSongVolume = null;
let _songVolumePersistTimer = null;
let _nativeSongGainPending = null;
let _nativeSongGainDrain = null;
const _recordedRealtimeBridges = new Set();
const SONG_VOLUME_PERSIST_DELAY_MS = 150;

function _audioEl() { return document.getElementById('audio'); }

function _audioSession() {
    return window.feedBack && window.feedBack.audioSession;
}

function _capabilities() {
    return window.feedBack && window.feedBack.capabilities;
}

async function _mixCommand(command, payload) {
    const api = _capabilities();
    if (api && typeof api.command === 'function') {
        return api.command('audio-mix', command, {
            requester: 'core.audio-mixer',
            origin: 'player-ui',
            payload: payload || {},
            timeoutMs: 2100,
        });
    }
    const session = _audioSession();
    if (!session) return { outcome: 'no-owner', reason: 'audio-mix is unavailable' };
    if (command === 'list-faders' && typeof session.listFaders === 'function') return session.listFaders();
    if (command === 'get-fader-value' && typeof session.getFaderValue === 'function') return session.getFaderValue(payload || {});
    if (command === 'set-fader-value' && typeof session.setFaderValue === 'function') return session.setFaderValue(payload || {});
    return { outcome: 'unsupported-command', reason: `Unsupported audio-mix command: ${command}` };
}

function _registerAudioSessionFader(spec, currentValue, compatibilitySource) {
    const session = _audioSession();
    if (!session || typeof session.registerMixParticipant !== 'function') return;
    const isSong = spec.id === 'song';
    session.registerMixParticipant({
        participantId: isSong ? 'core.song' : `fader.${spec.id}`,
        ownerPluginId: isSong ? 'core' : (spec.ownerPluginId || spec.id),
        label: spec.label || spec.id,
        kind: isSong ? 'song' : (spec.kind || 'plugin'),
        sourceMode: isSong ? 'core' : 'compatibility',
        logicalFaderKey: spec.logicalFaderKey || (isSong ? 'core.song:volume' : `${spec.id}:${spec.id}`),
        fader: {
            id: spec.id,
            label: spec.label || spec.id,
            unit: spec.unit || '',
            min: spec.min,
            max: spec.max,
            step: spec.step,
            defaultValue: spec.defaultValue,
            currentValue,
            getValue: spec.getValue,
            setValue: spec.setValue,
        },
        operations: ['fader.get-value', 'fader.set-value'],
        operationHandlers: {
            'fader.get-value': spec.getValue,
            'fader.set-value': spec.setValue,
        },
        availability: 'available',
        compatibilitySource,
    });
}

function _recordAudioBridge(bridgeId, legacySurface, participantId, outcome, reason) {
    const session = _audioSession();
    if (!session || typeof session.recordBridgeHit !== 'function') return;
    session.recordBridgeHit({
        domain: bridgeId && bridgeId.startsWith('stems.') ? 'stems' : 'audio-mix',
        bridgeId,
        legacySurface,
        participantId,
        outcome: outcome || 'handled',
        status: 'used',
        reason,
    });
}

function _reportSongRoute(routeKind, availability, reason) {
    const session = _audioSession();
    if (!session || typeof session.setRoute !== 'function') return;
    const route = {
        routeId: 'song-output',
        routeKind: routeKind || (window._juceMode ? 'juce' : 'html5'),
        availability: availability || 'available',
        selectedByUser: true,
        fallbackReason: reason || '',
    };
    // Volume changes do not change the route. Avoid re-emitting route events and
    // rebuilding audio-session diagnostics on every key-repeat tick.
    const routeKey = `${route.routeKind}\n${route.availability}\n${route.fallbackReason}`;
    if (routeKey === _lastSongRouteKey) return;
    session.setRoute(route);
    _lastSongRouteKey = routeKey;
}

function _recordRealtimeBridgeOnce(bridgeId, legacySurface, participantId, outcome, reason) {
    const key = `${bridgeId}\n${outcome || 'handled'}\n${reason || ''}`;
    if (_recordedRealtimeBridges.has(key)) return;
    const session = _audioSession();
    if (!session || typeof session.recordBridgeHit !== 'function') return;
    _recordedRealtimeBridges.add(key);
    _recordAudioBridge(bridgeId, legacySurface, participantId, outcome, reason);
}

function _resetSongVolumeTelemetry() {
    _lastSongRouteKey = '';
    _recordedRealtimeBridges.clear();
}

function _clampSongVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 80;
    return Math.min(100, Math.max(0, n));
}

// In-memory fallback so volume changes survive the session even when
// localStorage is blocked (private mode / sandboxed contexts).
// Initialized from the persisted value so the fallback starts correct.
let _songVolumeMemory = (() => {
    try {
        const stored = parseFloat(localStorage.getItem('volume'));
        return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 80;
    } catch (e) { return 80; }
})();

function _readSongVolume() {
    // Memory is authoritative while the page is alive. Reading localStorage on
    // every held-key repeat is synchronous and would also make debounced writes
    // return a stale value between ticks.
    return _songVolumeMemory;
}

function _syncSongFaderState(value) {
    const songFader = _faders.get('song');
    if (songFader) _registerAudioSessionFader(songFader, value, 'audio-mix.song-volume');
}

function _flushSongVolumePersistence() {
    if (_songVolumePersistTimer !== null) {
        clearTimeout(_songVolumePersistTimer);
        _songVolumePersistTimer = null;
    }
    if (_pendingPersistedSongVolume === null) return;
    const value = _pendingPersistedSongVolume;
    _pendingPersistedSongVolume = null;
    try {
        localStorage.setItem('volume', String(value));
    } catch (e) {
        // Ignore storage failures (for example in private mode or sandboxed contexts).
    }
    // Keep diagnostics accurate after the realtime burst has settled. This is
    // deliberately outside the key-repeat path because participant registration
    // emits topology events and rebuilds capability diagnostics.
    _syncSongFaderState(value);
}

function _scheduleSongVolumePersistence(value) {
    _pendingPersistedSongVolume = value;
    if (_songVolumePersistTimer !== null) clearTimeout(_songVolumePersistTimer);
    _songVolumePersistTimer = setTimeout(() => {
        _songVolumePersistTimer = null;
        _flushSongVolumePersistence();
    }, SONG_VOLUME_PERSIST_DELAY_MS);
}

function _queueNativeSongGain(setGain, linear) {
    // Electron IPC is asynchronous. Keep the first update immediate, but while
    // it is in flight retain only the newest requested value instead of building
    // an unbounded invoke()/Promise queue during keyboard auto-repeat.
    _nativeSongGainPending = { setGain, linear };
    if (!_nativeSongGainDrain) {
        _nativeSongGainDrain = (async function drainNativeSongGain() {
            while (_nativeSongGainPending) {
                const pending = _nativeSongGainPending;
                _nativeSongGainPending = null;
                try {
                    await pending.setGain('backing', pending.linear);
                } catch (_) { /* IPC unavailable */ }
            }
        })().finally(() => {
            _nativeSongGainDrain = null;
            // A new key event can land after the drain's final pending check but
            // before this continuation runs. Start another drain and chain it so
            // that narrow handoff cannot strand the newest requested value.
            if (_nativeSongGainPending) {
                const pending = _nativeSongGainPending;
                return _queueNativeSongGain(pending.setGain, pending.linear);
            }
        });
    }
    return _nativeSongGainDrain;
}

function _applySongVolume(v, deferCoordinatorSync) {
    const normalized = _clampSongVolume(v == null ? _readSongVolume() : v);
    _songVolumeMemory = normalized;
    const a = _audioEl();
    if (a) a.volume = normalized / 100;
    if (!deferCoordinatorSync) _syncSongFaderState(normalized);
    const linear = normalized / 100;
    // Multi-stem sloppak: the stems plugin mutes the core <audio> element and
    // routes every stem through its own master GainNode, so a.volume above is
    // dead. Drive that master instead when the stems plugin has published its
    // hook (it clears the hook on teardown for stem-less songs).
    const stemsSetMaster = window.feedBack?.stems?.setMasterVolume;
    if (typeof stemsSetMaster === 'function') {
        // A synchronous throw or a rejected Promise from the stems plugin hook
        // must not abort _applySongVolume before it returns / persists. The
        // try/catch covers a sync throw; the .catch() covers an async rejection.
        // The bridge hit is attributed by outcome (handled vs failed) so support
        // data reflects reality rather than always reporting success.
        try {
            const result = stemsSetMaster(linear);
            if (result && typeof result.then === 'function') {
                void Promise.resolve(result)
                    .then(function () {
                        _recordRealtimeBridgeOnce('stems.master-volume', 'window.feedBack.stems.setMasterVolume', 'core.song', 'handled');
                    })
                    .catch(function () {
                        _recordRealtimeBridgeOnce('stems.master-volume', 'window.feedBack.stems.setMasterVolume', 'core.song', 'failed', 'Stems master volume hook rejected');
                    });
            } else {
                _recordRealtimeBridgeOnce('stems.master-volume', 'window.feedBack.stems.setMasterVolume', 'core.song', 'handled');
            }
        } catch (_) {
            _recordRealtimeBridgeOnce('stems.master-volume', 'window.feedBack.stems.setMasterVolume', 'core.song', 'failed', 'Stems master volume hook threw');
        }
    }
    // The participant is registered once by _registerSongFader(). Re-registering
    // it here turned every 1% key-repeat step into topology events, duplicate
    // suppression, and full diagnostics snapshots on the gameplay thread.
    _recordRealtimeBridgeOnce('audio-mix.song-volume', 'applySongVolume', 'core.song', 'handled');
    // Desktop + JUCE: song audio is mixed in the native engine; HTML5 volume is ignored.
    if (window._juceMode) {
        const setGain = window.feedBackDesktop?.audio?.setGain;
        if (typeof setGain === 'function') {
            // Same dual guard as the stems hook above: the try/catch covers a
            // synchronous throw from setGain, the .catch() covers a rejected IPC.
            try {
                _reportSongRoute('juce', 'available');
                return _queueNativeSongGain(setGain, linear)
                    .then(function () { return normalized; });
            } catch (_) { /* IPC unavailable */ }
        }
    }
    _reportSongRoute(typeof stemsSetMaster === 'function' ? 'stems' : 'html5', 'available');
    return Promise.resolve(normalized);
}

function _writeSongVolume(v) {
    const normalized = _clampSongVolume(v);
    void _applySongVolume(normalized, true);
    _updateRenderedFaderValue('core.song', 'song', normalized, '%');
    _scheduleSongVolumePersistence(normalized);
    return normalized;
}

function registerFader(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id) {
        console.warn('[mixer] registerFader: spec.id required');
        return;
    }
    if (typeof spec.getValue !== 'function' || typeof spec.setValue !== 'function') {
        console.warn('[mixer] registerFader: spec.getValue and spec.setValue required', spec.id);
        return;
    }
    let min = Number.isFinite(spec.min) ? spec.min : 0;
    let max = Number.isFinite(spec.max) ? spec.max : 1;
    if (max <= min) {
        console.warn('[mixer] registerFader: max must be > min; correcting', spec.id);
        max = min + 1;
    }
    let step = Number.isFinite(spec.step) ? spec.step : (max - min) / 100;
    if (step <= 0) step = (max - min) / 100;
    const dv = Number.isFinite(spec.defaultValue) ? spec.defaultValue : min;
    const normalized = {
        id: spec.id,
        label: spec.label || spec.id,
        unit: typeof spec.unit === 'string' ? spec.unit : '',
        min,
        max,
        step,
        defaultValue: Math.min(max, Math.max(min, dv)),
        logicalFaderKey: typeof spec.logicalFaderKey === 'string' ? spec.logicalFaderKey : undefined,
        ownerPluginId: typeof spec.ownerPluginId === 'string' ? spec.ownerPluginId : undefined,
        kind: typeof spec.kind === 'string' ? spec.kind : undefined,
        getValue: spec.getValue,
        setValue: spec.setValue,
    };
    if (_faders.has(spec.id)) {
        console.warn('[mixer] registerFader: overwriting existing fader', spec.id);
    }
    _faders.set(spec.id, normalized);
    // Report the fader's live value (best-effort, clamped) rather than the
    // default, so diagnostics / Capability Inspector reflect persisted state.
    let currentValue = normalized.defaultValue;
    try {
        const live = Number(normalized.getValue());
        if (Number.isFinite(live)) currentValue = Math.min(max, Math.max(min, live));
    } catch (_) { /* fall back to the default value */ }
    _registerAudioSessionFader(normalized, currentValue, 'audio-mix.fader-registry');
    _recordAudioBridge('audio-mix.fader-registry', 'registerFader', spec.id === 'song' ? 'core.song' : `fader.${spec.id}`, 'handled');
    if (_open) _renderPopover();
}

function unregisterFader(id) {
    _faders.delete(id);
    const session = _audioSession();
    if (session && typeof session.unregisterMixParticipant === 'function') {
        session.unregisterMixParticipant(id === 'song' ? 'core.song' : `fader.${id}`);
    }
    if (_open) _renderPopover();
}

function getFaders() {
    return Array.from(_faders.values(), function (spec) {
        return Object.freeze({
            id: spec.id,
            label: spec.label,
            unit: spec.unit,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            defaultValue: spec.defaultValue,
            getValue: spec.getValue,
            setValue: spec.setValue,
        });
    });
}

function _formatValue(v, unit) {
    const s = v === Math.round(v) ? v.toFixed(0) : v.toFixed(2);
    return unit ? s + unit : s;
}

function _updateRenderedFaderValue(participantId, faderId, value, unit) {
    if (!_open || !_popoverEl || typeof _popoverEl.querySelectorAll !== 'function') return;
    const committed = Number(value);
    if (!Number.isFinite(committed)) return;
    const faderKey = `${participantId}:${faderId}`;
    const strips = _popoverEl.querySelectorAll('[data-fader-key]');
    for (const strip of strips) {
        if (!strip || strip.getAttribute('data-fader-key') !== faderKey) continue;
        const slider = strip.querySelector('.mixer-strip-fader');
        const valueEl = strip.querySelector('.mixer-strip-value');
        if (!slider || !valueEl) return;
        const min = Number(slider.min);
        const max = Number(slider.max);
        const displayed = Math.min(Number.isFinite(max) ? max : committed,
            Math.max(Number.isFinite(min) ? min : committed, committed));
        slider.value = String(displayed);
        window.handleSliderInput?.(slider);
        valueEl.textContent = _formatValue(displayed, unit || '');
        return;
    }
}

function _legacyFaderForSummary(summary) {
    if (!summary) return null;
    return _faders.get(summary.id) || _faders.get(summary.faderId) || null;
}

function _clampToSpec(v, spec) {
    return Math.min(spec.max, Math.max(spec.min, v));
}

function _strip(spec) {
    let cur = Number.isFinite(Number(spec.currentValue)) ? Number(spec.currentValue) : spec.defaultValue;
    cur = _clampToSpec(cur, spec);
    const faderKey = spec.faderKey || `${spec.participantId}:${spec.faderId || spec.id}`;
    const available = spec.availability === 'available' && spec.userAdjustable !== false;
    let writeSeq = 0; // guards against out-of-order set-fader-value responses reverting newer input

    const wrap = document.createElement('div');
    wrap.className = 'mixer-strip';
    wrap.setAttribute('data-fader-key', faderKey);

    const labelEl = document.createElement('span');
    labelEl.className = 'mixer-strip-label';
    labelEl.title = spec.label || spec.faderLabel;
    labelEl.textContent = spec.label || spec.faderLabel;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'mixer-strip-fader accent-accent';
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(cur);
    slider.disabled = !available;
    slider.setAttribute('aria-label', (spec.label || spec.faderLabel) + ' volume');
    if (!available) slider.setAttribute('aria-disabled', 'true');
    window.handleSliderInput?.(slider); //initialize the slider's background fill based on the initial value

    const valueEl = document.createElement('span');
    valueEl.className = 'mixer-strip-value';
    valueEl.textContent = available ? _formatValue(cur, spec.unit) : 'Unavailable';

    slider.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
            e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.stopPropagation();
            return;
        }
        if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    slider.addEventListener('input', () => {
        if (slider.disabled) return;
        const seq = ++writeSeq;
        const parsed = parseFloat(slider.value);
        const requested = Number.isFinite(parsed) ? parsed : cur;
        valueEl.textContent = 'Pending';
        _mixCommand('set-fader-value', {
            participantId: spec.participantId,
            faderId: spec.faderId || spec.id,
            value: requested,
        }).then(result => {
            if (seq !== writeSeq) return; // a newer input superseded this response
            const payload = result && result.payload ? result.payload : {};
            const actual = Number.isFinite(Number(payload.committedValue)) ? Number(payload.committedValue) : cur;
            cur = _clampToSpec(actual, spec);
            slider.value = String(cur);
            window.handleSliderInput?.(slider); //update the slider's background fill on input
            valueEl.textContent = result && result.outcome === 'handled' ? _formatValue(cur, spec.unit) : 'Failed';
            if (result && result.outcome !== 'handled') slider.classList.add('mixer-strip-fader-failed');
        }).catch(err => {
            if (seq !== writeSeq) return; // a newer input superseded this response
            console.error('[mixer] audio-mix set-fader-value failed', spec.id, err);
            slider.value = String(cur);
            window.handleSliderInput?.(slider);
            valueEl.textContent = 'Failed';
            slider.classList.add('mixer-strip-fader-failed');
        });
    });

    wrap.appendChild(labelEl);
    wrap.appendChild(slider);
    wrap.appendChild(valueEl);
    return wrap;
}

function _renderPopover() {
    if (!_popoverEl) return;
    _popoverEl.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'mixer-row';
    _popoverEl.appendChild(row);

    _mixCommand('list-faders').then(result => {
        row.innerHTML = '';
        const faders = result && result.payload && Array.isArray(result.payload.faders) ? result.payload.faders : [];
        if (faders.length === 0) {
            for (const legacy of _faders.values()) faders.push({ ...legacy, currentValue: legacy.defaultValue, participantId: legacy.id === 'song' ? 'core.song' : `fader.${legacy.id}`, faderId: legacy.id, availability: 'available', userAdjustable: true });
        }
        if (faders.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'text-xs text-gray-500';
            empty.textContent = 'No audio sources';
            row.appendChild(empty);
            return;
        }
        for (const fader of faders) {
            const legacy = _legacyFaderForSummary(fader);
            const spec = legacy ? { ...legacy, ...fader, id: fader.faderId || fader.id } : { ...fader, id: fader.faderId || fader.id, label: fader.label || fader.faderLabel };
            row.appendChild(_strip(spec));
            if (fader.availability === 'available') {
                _mixCommand('get-fader-value', { participantId: fader.participantId, faderId: fader.faderId || fader.id }).then(valueResult => {
                    if (!valueResult || valueResult.outcome !== 'handled' || !_open) return;
                    const fresh = valueResult.payload;
                    const strip = row.children && Array.from(row.children).find(child => child.getAttribute && child.getAttribute('data-fader-key') === (fresh.faderKey || `${fresh.participantId}:${fresh.faderId || fresh.id}`));
                    if (!strip || !strip.children || strip.children.length < 3) return;
                    const slider = strip.children[1];
                    const valueEl = strip.children[2];
                    const committed = Number(fresh.committedValue ?? fresh.currentValue);
                    if (!Number.isFinite(committed)) return;
                    slider.value = String(_clampToSpec(committed, spec));
                    window.handleSliderInput?.(slider);
                    valueEl.textContent = _formatValue(Number(slider.value), spec.unit);
                }).catch(() => {});
            }
        }
    }).catch(err => {
        console.error('[mixer] audio-mix list-faders failed', err);
        row.innerHTML = '';
        if (_faders.size === 0) {
            const empty = document.createElement('span');
            empty.className = 'text-xs text-gray-500';
            empty.textContent = 'No audio sources';
            row.appendChild(empty);
            return;
        }
        for (const spec of _faders.values()) row.appendChild(_strip({ ...spec, participantId: spec.id === 'song' ? 'core.song' : `fader.${spec.id}`, faderId: spec.id, currentValue: spec.defaultValue, availability: 'available', userAdjustable: true }));
    });
}

function _onDocKeydown(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMixer(true);
    }
}

function openMixer() {
    if (!_popoverEl) _init();
    if (!_popoverEl || _open) return;
    _renderPopover();
    _popoverEl.classList.remove('hidden');
    if (_btnEl) _btnEl.setAttribute('aria-expanded', 'true');
    _open = true;
    _openTimer = setTimeout(() => {
        _openTimer = null;
        if (_open) {
            document.addEventListener('click', _onDocClick, true);
            document.addEventListener('keydown', _onDocKeydown, true);
        }
    }, 0);
}

function closeMixer(restoreFocus) {
    if (!_popoverEl) return;
    if (_openTimer !== null) {
        clearTimeout(_openTimer);
        _openTimer = null;
    }
    window.feedBack?.selectionLifecycle?.prepareToHide(_popoverEl);
    _popoverEl.classList.add('hidden');
    window.feedBack?.selectionLifecycle?.finishVisibilityChange();
    if (_btnEl) _btnEl.setAttribute('aria-expanded', 'false');
    _open = false;
    document.removeEventListener('click', _onDocClick, true);
    document.removeEventListener('keydown', _onDocKeydown, true);
    // Restore focus to the toggle button when the popover was dismissed via
    // keyboard (Escape) so keyboard users don't lose their place.
    if (restoreFocus && _btnEl) _btnEl.focus();
}

function toggleMixer() { if (_open) closeMixer(); else openMixer(); }

function _onDocClick(e) {
    if (!_popoverEl) return;
    if (_popoverEl.contains(e.target)) return;
    if (_btnEl && _btnEl.contains(e.target)) return;
    closeMixer();
}

function _registerSongFader() {
    registerFader({
        id: 'song',
        label: 'Song',
        unit: '%',
        min: 0, max: 100, step: 1,
        defaultValue: _readSongVolume(),
        getValue: _readSongVolume,
        setValue: _writeSongVolume,
    });
}

function _onScreenChanged(e) {
    const screenId = e && e.detail ? e.detail.id : undefined;
    if (screenId !== 'player') closeMixer(false);
}

let _initialized = false;
function _init() {
    if (_initialized) return;
    _initialized = true;
    _btnEl = document.getElementById('btn-mixer');
    _popoverEl = document.getElementById('mixer-popover');
    _registerSongFader();
    if (window.feedBack && window.feedBack.on) {
        window.feedBack.on('screen:changed', _onScreenChanged);
        window.feedBack.on('song:loading', _resetSongVolumeTelemetry);
        window.feedBack.on('audio-mix:fader-value-changed', () => { if (_open) _renderPopover(); });
        window.feedBack.on('audio-mix:fader-unavailable', () => { if (_open) _renderPopover(); });
        window.feedBack.on('audio-mix:participant-registered', () => { if (_open) _renderPopover(); });
        window.feedBack.on('audio-mix:participant-removed', () => { if (_open) _renderPopover(); });
    }
    window.addEventListener('pagehide', _flushSongVolumePersistence);
    window.dispatchEvent(new Event('feedBack:audio:ready'));
}

window.feedBack.audio = Object.assign(window.feedBack.audio || {}, {
    registerFader, unregisterFader, getFaders,
    openMixer, closeMixer, toggleMixer,
    applySongVolume: _applySongVolume,
    readSongVolume: _readSongVolume,
});

// `defer` runs this at readyState 'interactive' — later scripts have not
// evaluated yet, so wait for DOMContentLoaded (see static/v3/index.html).
if (document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', _init);
} else {
    _init();
}
})();
