/** Per-highway, display-only harmony state. No detected player input belongs here. */
import {
    createHarmonyTimeline, resolveHarmony, buildScaleFretboard,
    prepareRestWindows, resolveRest, prepareBeatClock,
} from './harmony-guide-model.js';

const PREF_KEY = 'feedback.harmonicGuide.preferences.v1';
const EDIT_PREFIX = 'feedback.harmonicGuide.song.v1:';
const EMPTY = Object.freeze([]);
export const GUIDE_DEFAULTS = Object.freeze({
    enabled: false, thresholdMode: 'beats', minimumBeats: 4, minimumSeconds: 3,
    showPositions: true, labelMode: 'degrees', showNoteNames: true,
});

export function normalizeGuideOptions(value = {}) {
    const bounded = (v, fallback, min, max) => Number.isFinite(Number(v))
        ? Math.max(min, Math.min(max, Number(v))) : fallback;
    const labelMode = ['degrees', 'notes', 'none'].includes(value.labelMode) ? value.labelMode
        : value.showNoteNames === false ? 'none' : 'degrees';
    return {
        enabled: value.enabled === true,
        thresholdMode: value.thresholdMode === 'seconds' ? 'seconds' : 'beats',
        minimumBeats: bounded(value.minimumBeats ?? 4, 4, 1, 64),
        minimumSeconds: bounded(value.minimumSeconds ?? 3, 3, 0.5, 60),
        showPositions: value.showPositions !== false,
        labelMode,
        showNoteNames: labelMode !== 'none',
    };
}

function read(storage, key) {
    try { return JSON.parse(storage?.getItem(key) || 'null'); } catch (_) { return null; }
}

/** Mirrors song.py's low-string-first pitch bases, plus the effective tuning. */
export function guideOpenMidi(info = {}, tuning = [], stringCount = 6, capo = 0) {
    tuning = Array.isArray(tuning) ? tuning : EMPTY;
    const count = Math.max(1, Math.min(8, Math.trunc(stringCount) || 6));
    const bass = /bass/i.test(info.instrument || info.arrangement || '');
    const six = [40, 45, 50, 55, 59, 64];
    const base = count === 8 ? [30, 35, ...six] : count === 7 ? [35, ...six]
        : bass && count === 4 ? [28, 33, 38, 43]
            : bass && count === 5 ? [23, 28, 33, 38, 43] : six.slice(0, count);
    return base.map((pitch, i) => pitch + (Number.isFinite(tuning[i]) ? tuning[i] : 0)
        + (Number.isFinite(capo) ? capo : 0));
}

export function parseGuideTime(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+(?::[0-5]\d)?(?:\.\d+)?$/.test(text)) return null;
    const parts = text.split(':').map(Number);
    const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
    return Number.isFinite(seconds) ? seconds : null;
}

export function formatGuideTime(seconds) {
    const value = Math.round(Math.max(0, Number(seconds) || 0) * 1000) / 1000;
    const minutes = Math.floor(value / 60);
    const rest = Number((value % 60).toFixed(3));
    return minutes ? `${minutes}:${String(rest).padStart(rest < 10 ? String(rest).length + 1 : 2, '0')}` : String(rest);
}

export function parseGuideChord(text, t) {
    const value = String(text || '').trim().replaceAll('♯', '#').replaceAll('♭', 'b');
    if (/^(n\.?c\.?|no chord)$/i.test(value)) return { t, root: null };
    if (/^(unknown|\?)$/i.test(value)) return { t, root: null, unknown: true };
    const target = /^([A-Ga-g][#b]?)\s+note(?:\/([A-Ga-g][#b]?))?$/i.exec(value);
    if (target) return { t, root: target[1][0].toUpperCase() + target[1].slice(1),
        ...(target[2] ? { bass: target[2][0].toUpperCase() + target[2].slice(1) } : {}) };
    const match = /^([A-Ga-g][#b]?)([^/]*)(?:\/([A-Ga-g][#b]?))?$/.exec(value);
    if (!match) return null;
    const note = n => n[0].toUpperCase() + n.slice(1);
    const quality = match[2].trim() || 'maj';
    return { t, root: note(match[1]), quality, ...(match[3] ? { bass: note(match[3]) } : {}) };
}

export function guideChordText(event) {
    if (event.unknown) return '?';
    if (event.root == null) return 'N.C.';
    if (!event.quality) return `${event.root} note${event.bass ? '/' + event.bass : ''}`;
    const quality = event.quality === 'maj' ? '' : event.quality || '';
    return `${event.root}${quality}${event.bass ? '/' + event.bass : ''}`;
}

export function createHarmonyGuideController(storage = null) {
    let options = normalizeGuideOptions(read(storage, PREF_KEY) || GUIDE_DEFAULTS);
    let song = {}, storageKey = null, keys = EMPTY, harmony = EMPTY, override = null;
    let timeline = null, rests = null, restInputs = null, fretSignature = '', fretboard = null;
    let beatSource = null, beatClock = null;
    let generation = 0;
    const output = {
        enabled: false, alpha: 0, markers: EMPTY, positions: EMPTY,
        state: null, rest: null, options, nextBeats: null, nextSeconds: null,
    };
    const rebuild = () => {
        timeline = createHarmonyTimeline({
            keys, harmony, overrides: override,
        });
        fretSignature = '';
        generation++;
    };
    const save = (key, value) => {
        if (!storage || !key) throw new Error('Local storage is unavailable. Your song has not been changed.');
        try { storage.setItem(key, JSON.stringify(value)); }
        catch (_) { throw new Error('Could not save locally. Check browser storage space or permissions.'); }
    };
    return {
        get options() { return options; },
        get generation() { return generation; },
        get song() { return song; },
        get songEnd() { return Math.max(0, (Number(song.duration) || 0) + (Number(song.offset) || 0)); },
        get canSave() { return !!storageKey; },
        get hasOverride() { return !!override; },
        reset() {
            song = {}; storageKey = null; keys = EMPTY; harmony = EMPTY; override = null;
            timeline = null; rests = null; restInputs = null; fretSignature = ''; fretboard = null;
            beatSource = null; beatClock = null;
            output.enabled = false; output.alpha = 0; output.state = null; output.rest = null;
            output.markers = EMPTY; output.positions = EMPTY; generation++;
        },
        setSong(info, identity) {
            song = info || {};
            const revision = song.harmonic_guide_revision;
            storageKey = identity && typeof revision === 'string' && revision
                ? EDIT_PREFIX + encodeURIComponent(identity) + ':' + revision : null;
            const saved = storageKey ? read(storage, storageKey) : null;
            override = saved?.version === 1 && Array.isArray(saved.keys) && Array.isArray(saved.harmony)
                ? saved : null;
            rebuild();
        },
        setKeys(events) { keys = Array.isArray(events) ? events : EMPTY; rebuild(); },
        setHarmony(events) { harmony = Array.isArray(events) ? events : EMPTY; rebuild(); },
        getData() { return { keys: override?.keys ?? keys, harmony: override?.harmony ?? harmony }; },
        setOptions(patch) {
            const input = { ...options, ...patch };
            // Preserve the prototype's label visibility flag for existing clients.
            if ('showNoteNames' in patch && !('labelMode' in patch)) {
                input.labelMode = patch.showNoteNames === false ? 'none'
                    : options.labelMode === 'none' ? 'degrees' : options.labelMode;
            }
            const next = normalizeGuideOptions(input);
            save(PREF_KEY, next);
            options = next; output.options = options; rests = null; fretSignature = ''; generation++;
        },
        saveOverride(data) {
            const value = { version: 1, keys: data.keys, harmony: data.harmony };
            save(storageKey, value); override = value; rebuild();
        },
        clearOverride() {
            if (!storageKey || !storage) return;
            try { storage.removeItem(storageKey); }
            catch (_) { throw new Error('Could not remove the local correction.'); }
            override = null; rebuild();
        },
        update(context) {
            const { supported, ready, notes = EMPTY, chords = EMPTY, beats = EMPTY,
                duration = 0, time = 0, visualTime = time, capo = 0,
                stringCount = 6, loop = null } = context;
            const tuning = Array.isArray(context.tuning) ? context.tuning : EMPTY;
            output.enabled = !!(supported && ready && options.enabled);
            output.options = options;
            if (!output.enabled) { output.alpha = 0; return output; }
            if (!timeline) rebuild();
            output.state = resolveHarmony(timeline, time, { upcomingCount: 4, loop });
            const next = output.state.upcoming?.[0];
            const nextTime = next ? (next.at ?? next.t) : null;
            if (!beatClock || beatSource !== beats) { beatSource = beats; beatClock = prepareBeatClock(beats); }
            output.nextBeats = nextTime == null ? null : beatClock.beatsToChange(time, nextTime, loop);
            output.nextSeconds = nextTime == null ? null : Math.max(0, nextTime - time);
            const loopKey = loop ? `${loop.start}:${loop.end}:${loop.hasWrapped === true}` : '';
            if (!rests || !restInputs || restInputs.notes !== notes || restInputs.chords !== chords
                || restInputs.beats !== beats || restInputs.duration !== duration || restInputs.loopKey !== loopKey) {
                rests = prepareRestWindows({ notes, chords, beats, duration, loop,
                    thresholdMode: options.thresholdMode, minimumBeats: options.minimumBeats,
                    minimumSeconds: options.minimumSeconds, fadeBeats: 1 });
                restInputs = { notes, chords, beats, duration, loopKey };
            }
            // A/V compensation gates decorations by the visible chart, while harmony
            // itself stays on the song clock. Apply neither offset a second time.
            output.rest = resolveRest(rests, visualTime);
            output.alpha = output.state.scale && output.rest.active ? output.rest.opacity : 0;
            const scale = output.state.scale;
            const signature = `${scale?.id}:${scale?.root}:${scale?.tonicPc}:${output.state.targetPc}:${tuning.join(',')}:${stringCount}:${capo}`;
            if (signature !== fretSignature) {
                fretSignature = signature;
                fretboard = scale ? buildScaleFretboard({ scale, targetPc: output.state.targetPc,
                    openMidi: guideOpenMidi(song, tuning, stringCount, capo), capo,
                    minFret: 0, maxFret: 24 }) : null;
            }
            output.markers = fretboard?.markers || EMPTY;
            output.positions = options.showPositions ? fretboard?.positions || EMPTY : EMPTY;
            return output;
        },
    };
}
