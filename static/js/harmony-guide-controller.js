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
    const originalTuning = Array.isArray(info.tuning) ? info.tuning : EMPTY;
    const sourceBase = Array.isArray(info.guide_open_midi) && info.guide_open_midi.length >= count
        && info.guide_open_midi.slice(0, count).every(Number.isFinite)
        ? info.guide_open_midi.slice(0, count).map((pitch, i) => pitch - (originalTuning[i] || 0)) : null;
    const base = sourceBase || (count === 8 ? [30, 35, ...six] : count === 7 ? [35, ...six]
        : bass && count === 4 ? [28, 33, 38, 43]
            : bass && count === 5 ? [23, 28, 33, 38, 43] : six.slice(0, count));
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

export function createHarmonyGuideController(storage = null, services = {}) {
    let options = normalizeGuideOptions(read(storage, PREF_KEY) || GUIDE_DEFAULTS);
    let song = {}, identity = '', storageKey = null, keys = null, harmony = null, scales = null, override = null, generated = null;
    let timeline = null, rests = null, restInputs = null, fretSignature = '', fretboard = null;
    let beatSource = null, beatClock = null;
    let generation = 0;
    let playback = { supported: false, ready: false }, analysis = { status: 'idle' };
    let requestToken = 0, jobId = null, pollTimer = null, attempted = false;
    const fetcher = services.fetch || globalThis.fetch?.bind(globalThis);
    const schedule = services.setTimeout || globalThis.setTimeout;
    const unschedule = services.clearTimeout || globalThis.clearTimeout;
    const owns = (object, name) => object && Object.prototype.hasOwnProperty.call(object, name);
    const output = {
        enabled: false, alpha: 0, markers: EMPTY, positions: EMPTY,
        state: null, rest: null, options, nextBeats: null, nextSeconds: null,
    };
    const rebuild = () => {
        timeline = createHarmonyTimeline({
            keys, harmony, scales, overrides: override, generated,
        });
        fretSignature = '';
        generation++;
    };
    const save = (key, value) => {
        if (!storage || !key) throw new Error('Local storage is unavailable. Your song has not been changed.');
        try { storage.setItem(key, JSON.stringify(value)); }
        catch (_) { throw new Error('Could not save locally. Check browser storage space or permissions.'); }
    };
    const setAnalysis = value => { analysis = value; generation++; };
    const removeJob = id => {
        if (id && fetcher) Promise.resolve(fetcher(`/api/harmony/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })).catch(() => {});
    };
    const cancel = () => {
        requestToken++;
        if (pollTimer != null) { unschedule(pollTimer); pollTimer = null; }
        if (jobId) removeJob(jobId);
        jobId = null;
        if (['queued', 'running'].includes(analysis.status)) {
            attempted = false; setAnalysis({ status: 'cancelled' });
        }
    };
    const needsAnalysis = () => !['keys', 'harmony', 'scales'].every(name => {
        if (owns(override, name)) return true;
        if (name === 'scales') return scales != null || eventsOf(override?.keys).some(e => e.scale)
            || eventsOf(keys).some(e => e.scale);
        return (name === 'keys' ? keys : harmony) != null;
    });
    const accept = value => {
        if (!value || value.version !== 1 || value.source !== 'charts'
            || value.revision !== song.harmonic_guide_revision) return false;
        if (!['keys', 'harmony', 'scales'].every(name => value[name] != null
            && (Array.isArray(value[name]) || Array.isArray(value[name]?.events))
            && eventsOf(value[name]).every(event => event && Number.isFinite(event.t) && event.t >= 0
                && Number.isFinite(event.end) && event.end > event.t))) return false;
        generated = value;
        const anyData = ['keys', 'harmony', 'scales'].some(name => eventsOf(value[name]).some(e => !e.unknown));
        const partial = ['keys', 'harmony', 'scales'].some(name => !eventsOf(value[name]).length || eventsOf(value[name]).some(e => e.unknown));
        setAnalysis({ status: anyData ? partial ? 'partial' : 'complete' : 'unavailable' });
        attempted = true; rebuild(); return true;
    };
    async function runAnalysis(force = false) {
        if (!fetcher || !playback.supported || !playback.ready || !options.enabled
            || !identity || !song.harmonic_guide_revision || !/\.(?:feedpak|sloppak)$/i.test(identity)
            || (!force && (attempted || !needsAnalysis()))) return;
        cancel(); attempted = true;
        const token = requestToken, filename = identity, revision = song.harmonic_guide_revision;
        const current = () => token === requestToken && filename === identity && revision === song.harmonic_guide_revision;
        setAnalysis({ status: 'queued' });
        const consume = async job => {
            if (!current()) { removeJob(job?.id); return; }
            jobId = job?.id || jobId;
            const item = job?.items?.find(entry => entry.filename === filename);
            if (item?.result) {
                if (!accept(item.result)) throw new Error('This chart analysis does not match the song or is incomplete. Try again.');
                jobId = null; return;
            }
            if (['failed', 'cancelled'].includes(job?.status) || ['failed', 'cancelled'].includes(item?.status)) {
                throw new Error(item?.error || job?.error || 'Chart analysis could not finish.');
            }
            if (job?.status === 'complete') { jobId = null; setAnalysis({ status: 'unavailable' }); return; }
            if (!jobId) throw new Error('Chart analysis did not return a job.');
            setAnalysis({ status: job.status === 'running' ? 'running' : 'queued' });
            pollTimer = schedule(async () => {
                pollTimer = null;
                if (!current()) return;
                try {
                    const response = await fetcher(`/api/harmony/jobs/${encodeURIComponent(jobId)}`);
                    if (!response.ok) throw new Error('Could not check chart analysis. Try again.');
                    await consume(await response.json());
                } catch (error) { if (current()) setAnalysis({ status: 'failed', error: error.message }); }
            }, services.pollInterval ?? 800);
        };
        try {
            const response = await fetcher('/api/harmony/analyse', { method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: [filename], force, priority: 'current' }) });
            if (!response.ok) throw new Error('Chart analysis is unavailable. Try again.');
            await consume(await response.json());
        } catch (error) { if (current()) setAnalysis({ status: 'failed', error: error.message }); }
    }
    const eventsOf = value => Array.isArray(value) ? value : Array.isArray(value?.events) ? value.events : EMPTY;
    const api = {
        get options() { return options; },
        get generation() { return generation; },
        get song() { return song; },
        get songIdentity() { return `${identity}:${song.harmonic_guide_revision || ''}`; },
        get songEnd() { return Math.max(0, (Number(song.duration) || 0) + (Number(song.offset) || 0)); },
        get canSave() { return !!storageKey; },
        get hasOverride() { return !!override; },
        get analysis() { return analysis; },
        get needsAnalysis() { return needsAnalysis(); },
        setPlaybackState(value) {
            playback = { ...playback, ...value };
            if (!playback.supported || !playback.ready) cancel();
            else void runAnalysis();
        },
        setGenerated(value) { return accept(value); },
        retryAnalysis() { return runAnalysis(true); },
        cancelAnalysis() { cancel(); },
        reset() {
            cancel(); playback.ready = false; attempted = false; analysis = { status: 'idle' };
            song = {}; identity = ''; storageKey = null; keys = null; harmony = null; scales = null; override = null; generated = null;
            timeline = null; rests = null; restInputs = null; fretSignature = ''; fretboard = null;
            beatSource = null; beatClock = null;
            output.enabled = false; output.alpha = 0; output.state = null; output.rest = null;
            output.markers = EMPTY; output.positions = EMPTY; generation++;
        },
        setSong(info, sourceIdentity) {
            const changed = identity !== sourceIdentity || song.harmonic_guide_revision !== info?.harmonic_guide_revision;
            if (changed) { cancel(); attempted = false; generated = null; analysis = { status: 'idle' }; }
            identity = sourceIdentity || '';
            song = info || {};
            const revision = song.harmonic_guide_revision;
            storageKey = identity && typeof revision === 'string' && revision
                ? EDIT_PREFIX + encodeURIComponent(identity) + ':' + revision : null;
            const saved = storageKey ? read(storage, storageKey) : null;
            override = saved?.version === 1 && ['keys', 'harmony', 'scales'].some(name => Array.isArray(saved[name])) ? saved : null;
            if (changed) {
                keys = song.has_keys ? EMPTY : null; harmony = song.has_harmony ? EMPTY : null; scales = song.has_scales ? EMPTY : null;
            }
            rebuild();
        },
        setKeys(events) { keys = Array.isArray(events) ? events : EMPTY; rebuild(); },
        setHarmony(events) { harmony = Array.isArray(events) ? events : EMPTY; rebuild(); },
        setScales(events) { scales = Array.isArray(events) ? events : EMPTY; rebuild(); },
        getData() {
            const data = { sources: {} };
            for (const [name, authored] of [['keys', keys], ['harmony', harmony], ['scales', scales]]) {
                data[name] = eventsOf(owns(override, name) ? override[name] : authored ?? generated?.[name]);
                data.sources[name] = owns(override, name) ? 'local' : authored != null ? 'feedpak' : 'charts';
            }
            return data;
        },
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
            if (!options.enabled) cancel(); else void runAnalysis();
        },
        saveOverride(data) {
            const value = { version: 1, ...override };
            for (const name of ['keys', 'harmony', 'scales']) if (owns(data, name)) value[name] = data[name];
            save(storageKey, value); override = value; rebuild();
        },
        clearOverride() {
            if (!storageKey || !storage) return;
            try { storage.removeItem(storageKey); }
            catch (_) { throw new Error('Could not remove the local correction.'); }
            override = null; rebuild(); void runAnalysis();
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
            const fretSemantics = song.guide_fret_semantics || 'relative';
            const signature = `${scale?.id}:${scale?.root}:${scale?.tonicPc}:${output.state.targetPc}:${tuning.join(',')}:${stringCount}:${capo}:${fretSemantics}`;
            if (signature !== fretSignature) {
                fretSignature = signature;
                fretboard = scale ? buildScaleFretboard({ scale, targetPc: output.state.targetPc,
                    openMidi: guideOpenMidi(song, tuning, stringCount, capo), capo, fretSemantics,
                    minFret: 0, maxFret: 24 }) : null;
            }
            output.markers = fretboard?.markers || EMPTY;
            output.positions = options.showPositions ? fretboard?.positions || EMPTY : EMPTY;
            return output;
        },
    };
    return api;
}
