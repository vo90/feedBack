// Pure, prepared musical data for the 3D harmonic guide. No DOM, renderer,
// microphone or scoring dependencies. All times are song-timeline seconds.
const mod12 = n => ((n % 12) + 12) % 12;
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const STANDARD = [40, 45, 50, 55, 59, 64];
const EPS = 1e-7;

export const SCALE_DEFINITIONS = Object.freeze({
    major: { name: 'major', intervals: [0, 2, 4, 5, 7, 9, 11], degrees: [0, 1, 2, 3, 4, 5, 6] },
    natural_minor: { name: 'natural minor', intervals: [0, 2, 3, 5, 7, 8, 10], degrees: [0, 1, 2, 3, 4, 5, 6] },
    dorian: { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10], degrees: [0, 1, 2, 3, 4, 5, 6] },
    phrygian: { name: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10], degrees: [0, 1, 2, 3, 4, 5, 6] },
    lydian: { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11], degrees: [0, 1, 2, 3, 4, 5, 6] },
    mixolydian: { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10], degrees: [0, 1, 2, 3, 4, 5, 6] },
    locrian: { name: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10], degrees: [0, 1, 2, 3, 4, 5, 6] },
    harmonic_minor: { name: 'harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11], degrees: [0, 1, 2, 3, 4, 5, 6] },
    melodic_minor: { name: 'melodic minor', intervals: [0, 2, 3, 5, 7, 9, 11], degrees: [0, 1, 2, 3, 4, 5, 6] },
    major_pentatonic: { name: 'major pentatonic', intervals: [0, 2, 4, 7, 9], degrees: [0, 1, 2, 4, 5] },
    minor_pentatonic: { name: 'minor pentatonic', intervals: [0, 3, 5, 7, 10], degrees: [0, 2, 3, 4, 6] },
});
const SCALE_ALIASES = {
    ionian: 'major', minor: 'natural_minor', aeolian: 'natural_minor',
    pentatonic_major: 'major_pentatonic', pentatonic_minor: 'minor_pentatonic',
};
const CHORD_INTERVALS = {
    maj: [0, 4, 7], min: [0, 3, 7], '5': [0, 7], dim: [0, 3, 6], aug: [0, 4, 8],
    sus2: [0, 2, 7], sus4: [0, 5, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10], dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10],
    minmaj7: [0, 3, 7, 11], '6': [0, 4, 7, 9], min6: [0, 3, 7, 9],
    add9: [0, 2, 4, 7], minadd9: [0, 2, 3, 7], '9': [0, 2, 4, 7, 10],
    maj9: [0, 2, 4, 7, 11], min9: [0, 2, 3, 7, 10],
    '7sus2': [0, 2, 7, 10], '7sus4': [0, 5, 7, 10],
    add11: [0, 4, 5, 7], minadd11: [0, 3, 5, 7],
    '11': [0, 2, 4, 5, 7, 10], min11: [0, 2, 3, 5, 7, 10],
    '13': [0, 2, 4, 7, 9, 10], maj13: [0, 2, 4, 7, 9, 11], min13: [0, 2, 3, 7, 9, 10],
    '13#11': [0, 2, 4, 6, 7, 9, 10], '7#11': [0, 4, 6, 7, 10], '7#9': [0, 3, 4, 7, 10],
    sus2sus4: [0, 2, 5, 7],
};
const QUALITY_ALIASES = {
    major: 'maj', minor: 'min', m: 'min', power: '5', power_chord: '5',
    dominant: '7', dominant7: '7', major7: 'maj7', minor7: 'min7', m7: 'min7',
    diminished: 'dim', diminished7: 'dim7', augmented: 'aug', sus: 'sus4',
    'm7b5': 'hdim7', half_diminished: 'hdim7', half_diminished7: 'hdim7',
    'ø7': 'hdim7', 'o': 'dim', 'o7': 'dim7', '°': 'dim', '°7': 'dim7',
    major6: '6', minor6: 'min6', m6: 'min6', major9: 'maj9', minor9: 'min9', m9: 'min9',
    m11: 'min11', m13: 'min13', madd9: 'minadd9', madd11: 'minadd11',
    mmaj7: 'minmaj7', 'm(maj7)': 'minmaj7', add6: '6', madd6: 'min6',
};
const QUALITY_SUFFIX = { maj: '', min: 'm', min7: 'm7', min6: 'm6', min9: 'm9', min11: 'm11',
    min13: 'm13', minadd9: 'madd9', minadd11: 'madd11', minmaj7: 'm(maj7)', hdim7: 'm7b5' };

/** Exact pitch class; accepts spelling including double accidentals or 0..11. */
export function pitchClass(note) {
    if (Number.isInteger(note) && note >= 0 && note < 12) return note;
    if (typeof note !== 'string') return null;
    const match = /^([A-Ga-g])([#b♯♭]{0,2})$/.exec(note.trim());
    if (!match) return null;
    const base = NATURAL[LETTERS.indexOf(match[1].toUpperCase())];
    return mod12(base + [...match[2]].reduce((n, a) => n + (a === '#' || a === '♯' ? 1 : -1), 0));
}

function cleanNote(value) {
    if (Number.isInteger(value)) return SHARPS[mod12(value)];
    if (typeof value !== 'string') return '';
    return value.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/^[a-g]/, c => c.toUpperCase());
}

function parseKey(value) {
    if (typeof value !== 'string') return null;
    const match = /^([A-Ga-g][#b♯♭]{0,2})(?:[\s:_-]*(maj(?:or)?|min(?:or)?|m))?$/.exec(value.trim());
    if (!match) return null;
    const root = cleanNote(match[1]);
    const mode = match[2] && ['min', 'minor', 'm'].includes(match[2]) ? 'minor' : 'major';
    return { root, rootPc: pitchClass(root), mode, label: `${root} ${mode}` };
}

/** Unsupported explicit IDs return null, never an implicit fallback. */
export function makeScale(root, scaleId = 'major') {
    const tonicPc = pitchClass(root);
    if (tonicPc === null || typeof scaleId !== 'string') return null;
    let id = scaleId.toLowerCase().trim().replace(/[\s-]+/g, '_');
    id = SCALE_ALIASES[id] || id;
    const definition = SCALE_DEFINITIONS[id];
    if (!definition) return null;
    const rootName = cleanNote(root);
    const letterIndex = LETTERS.indexOf(rootName[0]);
    const pitchClasses = definition.intervals.map(n => mod12(tonicPc + n));
    const noteNames = {};
    const degreeLabels = {};
    pitchClasses.forEach((pc, index) => {
        const degree = definition.degrees[index];
        const letter = (letterIndex + degree) % 7;
        let accidental = mod12(pc - NATURAL[letter]);
        if (accidental > 6) accidental -= 12;
        noteNames[pc] = Math.abs(accidental) <= 2
            ? LETTERS[letter] + (accidental < 0 ? 'b'.repeat(-accidental) : '#'.repeat(accidental))
            : (rootName.includes('b') ? FLATS : SHARPS)[pc];
        // Interval numbers keep their diatonic identity relative to the
        // tonic's major scale: minor pentatonic is R, ♭3, 4, 5, ♭7, never
        // R, 2, 3, 4, 5. The current chord target does not change this label.
        const alteration = definition.intervals[index] - NATURAL[degree];
        degreeLabels[pc] = pc === tonicPc ? 'R'
            : (alteration < 0 ? '♭'.repeat(-alteration) : '♯'.repeat(alteration)) + String(degree + 1);
    });
    return { id, label: `${rootName} ${definition.name}`, tonicPc, root: rootName, pitchClasses, noteNames, degreeLabels };
}

function eventsOf(value) {
    return Array.isArray(value) ? value : Array.isArray(value?.events) ? value.events : [];
}

function normalizeEvents(value, source, parse) {
    const byTime = new Map();
    for (const event of eventsOf(value)) {
        if (!event || !Number.isFinite(event.t) || event.t < 0) continue;
        if (Number.isFinite(event.end) && event.end <= event.t) continue;
        byTime.set(event.t, parse({ ...event, source }));
    }
    // Explicit expiry is a real boundary. Missing evidence must never inherit
    // the preceding estimate, including when seeking or wrapping a loop.
    const original = [...byTime.values()].sort((a, b) => a.t - b.t);
    for (let index = 0; index < original.length; index++) {
        const event = original[index];
        if (Number.isFinite(event.end) && !byTime.has(event.end)
            && (!original[index + 1] || original[index + 1].t > event.end)) {
            byTime.set(event.end, parse({ t: event.end, unknown: true, source }));
        }
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function prepareKey(event) {
    const key = event.unknown ? null : parseKey(event.key);
    const explicitScale = typeof event.scale === 'string' && event.scale.trim() !== '';
    const scaleId = explicitScale ? event.scale : key?.mode === 'minor' ? 'natural_minor' : 'major';
    const scale = key ? makeScale(key.root, scaleId) : null;
    const oppositeThird = key ? mod12(key.rootPc + (key.mode === 'minor' ? 4 : 3)) : null;
    const conflictingMode = scale?.pitchClasses.includes(oppositeThird);
    return {
        ...event, key, scale: conflictingMode ? null : scale,
        scaleStatus: !key || !scale ? 'unsupported' : conflictingMode ? 'conflict' : 'available',
    };
}

function prepareChord(event) {
    if (event.unknown === true) return { ...event, label: 'Unknown', rootPc: null, bassPc: null,
        quality: null, pitchClasses: [], status: 'unknown', supported: false };
    const nc = typeof event.root === 'string' && /^(?:n\.?c\.?|no[ _-]?chord)$/i.test(event.root.trim());
    // In feedpak an event with null/omitted root explicitly means N.C.; an
    // absent event (or an invalid non-null root) represents unknown harmony.
    if (nc || event.root == null || event.no_chord === true) {
        return { ...event, label: 'N.C.', rootPc: null, bassPc: null, quality: null, pitchClasses: [], status: 'no-chord' };
    }
    const rootPc = pitchClass(event.root);
    const bassPc = pitchClass(event.bass);
    const root = cleanNote(event.root);
    const rawQuality = typeof event.quality === 'string' ? event.quality.trim() : '';
    const normalizedQuality = rawQuality.replace(/[\s-]+/g, '_');
    // Preserve case-sensitive M7 and M: blindly lowercasing would turn major into minor.
    const quality = normalizedQuality === 'M' ? 'maj' : normalizedQuality === 'M7' ? 'maj7'
        : QUALITY_ALIASES[normalizedQuality.toLowerCase()] || normalizedQuality.toLowerCase();
    const intervals = quality ? CHORD_INTERVALS[quality] : [0];
    const chartTones = ['charts', 'local'].includes(event.source) && Array.isArray(event.chord_tones)
        && event.chord_tones.length > 0 && event.chord_tones.length <= 12
        && event.chord_tones.every(pc => Number.isInteger(pc) && pc >= 0 && pc < 12)
        ? [...new Set(event.chord_tones)] : null;
    const pitchClasses = rootPc === null ? [] : chartTones || (intervals || [0]).map(n => mod12(rootPc + n));
    if (bassPc !== null && !pitchClasses.includes(bassPc)) pitchClasses.push(bassPc);
    const suffix = Object.prototype.hasOwnProperty.call(QUALITY_SUFFIX, quality) ? QUALITY_SUFFIX[quality]
        : intervals ? quality : rawQuality;
    return {
        ...event, root, rootPc, bassPc, quality: quality || null, pitchClasses,
        label: rootPc === null ? 'Unknown' : chartTones && typeof event.display_label === 'string'
            ? event.display_label.slice(0, 60) : `${root}${suffix}${bassPc !== null ? '/' + cleanNote(event.bass) : ''}`,
        status: rootPc === null ? 'unknown' : !quality ? 'note' : 'chord',
        supported: rootPc !== null && !!(intervals || chartTones),
    };
}

/** Overrides replace the specified track (even [] clears it); absent tracks use pack data. */
export function createHarmonyTimeline({ keys = null, harmony = null, scales = null, overrides = null, generated = null } = {}) {
    const owns = (object, name) => object && Object.prototype.hasOwnProperty.call(object, name);
    const select = (name, authored) => owns(overrides, name) ? { events: overrides[name], source: 'local' }
        : authored != null ? { events: authored, source: 'feedpak' }
            : { events: generated?.[name], source: 'charts' };
    const keyTrack = select('keys', keys), chordTrack = select('harmony', harmony);
    // Legacy keys combine two tracks. Only an explicit scale takes precedence
    // over generated scale suggestions; a known key alone does not block them.
    const legacy = (value, explicitOnly = true) => eventsOf(value).map(event => ({
        ...event, root: parseKey(event.key)?.root,
        type: event.scale || (parseKey(event.key)?.mode === 'minor' ? 'natural_minor' : 'major'),
        unknown: event.unknown === true || (explicitOnly && !event.scale),
    }));
    let scaleTrack;
    if (owns(overrides, 'scales')) scaleTrack = { events: overrides.scales, source: 'local' };
    else if (eventsOf(overrides?.keys).some(event => event.scale)) scaleTrack = { events: legacy(overrides.keys), source: 'local' };
    else if (scales != null) scaleTrack = { events: scales, source: 'feedpak' };
    else if (eventsOf(keys).some(event => event.scale)) scaleTrack = { events: legacy(keys), source: 'feedpak' };
    else if (generated?.scales != null) scaleTrack = { events: generated.scales, source: 'charts' };
    else scaleTrack = { events: legacy(keyTrack.events, false), source: keyTrack.source };
    const prepareScale = event => {
        const scale = event.unknown ? null : makeScale(event.root, event.type);
        return { ...event, scale, scaleStatus: event.unknown ? 'unknown' : scale ? 'available' : 'unsupported' };
    };
    return {
        keys: normalizeEvents(keyTrack.events, keyTrack.source, prepareKey),
        harmony: normalizeEvents(chordTrack.events, chordTrack.source, prepareChord),
        scales: normalizeEvents(scaleTrack.events, scaleTrack.source, prepareScale),
    };
}

function upperBound(events, time, accessor = event => event.t) {
    let lo = 0, hi = events.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (accessor(events[mid]) <= time) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function validLoop(loop) {
    // Audio loop positions are nonnegative, but chart offsets can move their
    // derived timeline positions below zero without making the loop invalid.
    return loop && Number.isFinite(loop.start) && Number.isFinite(loop.end) && loop.end > loop.start;
}

/** Current target is the chord ROOT, not bass, scale tonic or microphone pitch. */
export function resolveHarmony(timeline, time, { upcomingCount = 4, loop = null } = {}) {
    const keyEvent = timeline.keys[upperBound(timeline.keys, time) - 1] || null;
    const scaleEvent = timeline.scales?.[upperBound(timeline.scales, time) - 1] || null;
    const currentIndex = upperBound(timeline.harmony, time) - 1;
    const current = timeline.harmony[currentIndex] || null;
    const count = Math.max(0, Math.min(12, Math.floor(upcomingCount)));
    let upcoming;
    if (validLoop(loop) && time >= loop.start && time < loop.end) {
        upcoming = timeline.harmony.filter(event => event.t > time && event.t < loop.end)
            .map(event => ({ ...event, timelineT: event.t, secondsUntil: event.t - time }));
        // Rewind restores the last authored state at loop.start, even if no
        // chord event happens precisely there. Include that boundary explicitly.
        const atStart = timeline.harmony[upperBound(timeline.harmony, loop.start) - 1];
        const cycle = [
            ...(atStart ? [{ ...atStart, t: loop.start }] : [{ t: loop.start, label: 'Unknown', rootPc: null, status: 'unknown' }]),
            ...timeline.harmony.filter(event => event.t > loop.start && event.t < loop.end),
        ];
        for (let lap = 0; upcoming.length < count && lap <= count; lap++) {
            for (const event of cycle) {
                const secondsUntil = loop.end - time + event.t - loop.start + lap * (loop.end - loop.start);
                upcoming.push({ ...event, timelineT: event.t, t: time + secondsUntil, secondsUntil, wrapsLoop: true });
                if (upcoming.length >= count) break;
            }
        }
        upcoming = upcoming.slice(0, count);
    } else {
        upcoming = timeline.harmony.slice(currentIndex + 1, currentIndex + 1 + count)
            .map(event => ({ ...event, timelineT: event.t, secondsUntil: event.t - time }));
    }
    let scale = scaleEvent?.scale || null;
    let scaleStatus = scaleEvent?.scaleStatus || 'missing';
    // Preserve validation of legacy combined key/scale annotations, while an
    // independent scale may intentionally use a different tonic from the key.
    if (scaleEvent?.key && keyEvent?.scaleStatus === 'conflict') {
        scale = null; scaleStatus = 'conflict';
    }
    // Validate every known chord tone, not merely the root. Unsupported
    // quality cannot claim harmonic agreement and keeps the scale unavailable.
    if (scale && current && current.status !== 'no-chord' && current.status !== 'unknown') {
        if (!current.supported) {
            scale = null;
            scaleStatus = 'unsupported';
        } else if (current.pitchClasses.some(pc => !scale.pitchClasses.includes(pc))) {
            scale = null;
            scaleStatus = 'conflict';
        }
    }
    return {
        key: keyEvent?.key || null, scale, scaleStatus, current,
        targetPc: current?.rootPc ?? null, upcoming,
        source: { key: keyEvent?.source || null, harmony: current?.source || null, scale: scaleEvent?.source || null },
        confidence: { key: keyEvent?.confidence ?? null, harmony: current?.confidence ?? null, scale: scaleEvent?.confidence ?? null },
    };
}

// Fixed, overlapping six-string fingering vocabulary. Frets are relative
// to the minor tonic on string 0 for pentatonic, and relative-major tonic
// on string 0 for CAGED. These arrays are playable shape definitions, not
// a generic moving four-fret box invented for arbitrary tunings.
const MINOR_PENTATONIC_SHAPES = [
    [[0, 3], [0, 2], [0, 2], [0, 2], [0, 3], [0, 3]],
    [[3, 5], [2, 5], [2, 5], [2, 4], [3, 5], [3, 5]],
    [[5, 7], [5, 7], [5, 7], [4, 7], [5, 8], [5, 7]],
    [[7, 10], [7, 10], [7, 9], [7, 9], [8, 10], [7, 10]],
    [[10, 12], [10, 12], [9, 12], [9, 12], [10, 12], [10, 12]],
];
const CAGED_MAJOR_SHAPES = [
    { name: 'E', notes: [[-1, 0, 2], [-1, 0, 2], [-1, 1, 2], [-1, 1, 2], [0, 2], [-1, 0, 2]] },
    { name: 'D', notes: [[2, 4, 5], [2, 4], [1, 2, 4], [1, 2, 4], [2, 4, 5], [2, 4, 5]] },
    { name: 'C', notes: [[4, 5, 7], [4, 6, 7], [4, 6, 7], [4, 6], [4, 5, 7], [4, 5, 7]] },
    { name: 'A', notes: [[7, 9], [6, 7, 9], [6, 7, 9], [6, 8, 9], [7, 9, 10], [7, 9]] },
    { name: 'G', notes: [[9, 11, 12], [9, 11, 12], [9, 11], [8, 9, 11], [9, 10, 12], [9, 11, 12]] },
];

/** openMidi includes tuning/capo/transposition. Fret 0 means that effective open pitch. */
export function buildScaleFretboard({ scale, targetPc = null, openMidi = [], minFret = 0, maxFret = 24, focusFret = 5, capo = 0, fretSemantics = 'relative' } = {}) {
    if (!scale || !Array.isArray(scale.pitchClasses) || !Array.isArray(openMidi)) return { markers: [], positions: [] };
    const lo = Math.max(0, Math.ceil(minFret));
    const hi = Math.min(36, Math.floor(maxFret));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return { markers: [], positions: [] };
    const markers = [];
    openMidi.forEach((open, string) => {
        if (!Number.isInteger(open)) return;
        for (let fret = lo; fret <= hi; fret++) {
            if (fretSemantics === 'physical' && fret > 0 && fret <= capo) continue;
            const midi = open + fret - (fretSemantics === 'physical' && fret > 0 ? capo : 0);
            const pc = mod12(midi);
            if (!scale.pitchClasses.includes(pc)) continue;
            const label = scale.noteNames?.[pc] || SHARPS[pc];
            const degreeLabel = scale.degreeLabels?.[pc] || (pc === scale.tonicPc ? 'R' : '');
            markers.push({ string, fret, midi, pc, label, note: label, degreeLabel, isTonic: pc === scale.tonicPc, isTarget: pc === targetPc });
        }
    });
    const standard = openMidi.length === 6 && openMidi.every((n, i) => Number.isInteger(n) && n - STANDARD[i] === openMidi[0] - STANDARD[0]);
    if (!standard) return { markers, positions: [] };
    let shapes, shapeTonic, family;
    if (scale.id === 'minor_pentatonic' || scale.id === 'major_pentatonic') {
        shapeTonic = scale.tonicPc;
        const patterns = scale.id === 'minor_pentatonic' ? MINOR_PENTATONIC_SHAPES
            : [...MINOR_PENTATONIC_SHAPES.slice(1), MINOR_PENTATONIC_SHAPES[0]]
                .map((notes, i) => notes.map(frets => frets.map(fret => fret - 3 + (i === 4 ? 12 : 0))));
        shapes = patterns.map((notes, i) => ({ name: String(i + 1), notes }));
        family = 'Pentatonic';
    } else if (scale.id === 'major' || scale.id === 'natural_minor') {
        shapeTonic = scale.id === 'major' ? scale.tonicPc : mod12(scale.tonicPc + 3);
        shapes = CAGED_MAJOR_SHAPES;
        family = scale.id === 'major' ? 'CAGED' : 'Relative-major CAGED';
    } else return { markers, positions: [] };
    const base = mod12(shapeTonic - openMidi[0] + (fretSemantics === 'physical' ? capo : 0));
    const positions = [];
    for (let octave = -2; octave <= 3; octave++) {
        shapes.forEach(shape => {
            const offset = base + octave * 12;
            const all = shape.notes.flat().map(fret => fret + offset);
            const start = Math.min(...all), end = Math.max(...all);
            if (end < lo || start > hi) return;
            const spans = shape.notes.map((frets, string) => {
                const playable = frets.map(fret => fret + offset).filter(fret => fret >= lo && fret <= hi
                    && (fretSemantics !== 'physical' || fret > capo));
                return playable.length ? { string, minFret: Math.min(...playable), maxFret: Math.max(...playable) } : null;
            }).filter(Boolean);
            if (!spans.length) return;
            positions.push({
                id: `${scale.id}:${shape.name}:${offset}`, label: `${family} ${shape.name}`,
                minFret: Math.max(lo, start), maxFret: Math.min(hi, end), centerFret: (start + end) / 2,
                spans, active: false,
            });
        });
    }
    positions.sort((a, b) => a.centerFret - b.centerFret);
    if (positions.length) {
        const active = positions.reduce((best, position) => Math.abs(position.centerFret - focusFret) < Math.abs(best.centerFret - focusFret) ? position : best);
        active.active = true;
    }
    return { markers, positions };
}

function normalizeBeats(beats) {
    return [...new Set((Array.isArray(beats) ? beats : []).map(b => typeof b === 'number' ? b : b?.time ?? b?.t).filter(Number.isFinite))].sort((a, b) => a - b);
}

function beatAt(times, time) {
    if (times.length < 2 || !Number.isFinite(time)) return null;
    const i = Math.max(0, Math.min(times.length - 2, upperBound(times, time, n => n) - 1));
    return i + (time - times[i]) / (times[i + 1] - times[i]);
}

/** Fractional ordinal of a beat, interpolated through real tempo changes. */
export function beatPosition(beats, time) {
    return beatAt(normalizeBeats(beats), time);
}

function beatsUntil(times, time, nextT, loop) {
    if (times.length < 2) return null;
    if (validLoop(loop) && nextT >= loop.end && time >= loop.start && time < loop.end) {
        const period = loop.end - loop.start;
        const laps = Math.floor((nextT - loop.end) / period);
        const nextInLoop = loop.start + ((nextT - loop.end) % period);
        return beatAt(times, loop.end) - beatAt(times, time)
            + laps * (beatAt(times, loop.end) - beatAt(times, loop.start))
            + beatAt(times, nextInLoop) - beatAt(times, loop.start);
    }
    return beatAt(times, nextT) - beatAt(times, time);
}

export function beatsToChange(beats, time, nextT, loop = null) {
    return beatsUntil(normalizeBeats(beats), time, nextT, loop);
}

/** Prepare after the beat-list reference changes; countdown calls then only
 * binary-search the immutable beat times instead of parsing/sorting each frame. */
export function prepareBeatClock(beats) {
    const times = Object.freeze(normalizeBeats(beats));
    return Object.freeze({
        times,
        position: time => beatAt(times, time),
        beatsToChange: (time, nextT, loop = null) => beatsUntil(times, time, nextT, loop),
    });
}

function occupiedIntervals(notes, chords) {
    const events = [];
    for (const note of Array.isArray(notes) ? notes : []) {
        if (note && Number.isFinite(note.t)) events.push({ note, start: note.t, end: note.t + Math.max(0, Number(note.sus) || 0) });
    }
    for (const chord of Array.isArray(chords) ? chords : []) {
        if (!chord || !Number.isFinite(chord.t)) continue;
        const members = Array.isArray(chord.notes) ? chord.notes : [];
        // Chords without expanded members still occupy their authored sustain.
        events.push({ note: chord, start: chord.t, end: chord.t + Math.max(0, Number(chord.sus) || 0) });
        for (const note of members) {
            if (note) events.push({ note, start: chord.t, end: chord.t + Math.max(0, Number(note.sus) || 0, Number(chord.sus) || 0) });
        }
    }
    const lanes = new Map();
    for (const event of events) {
        if (!Number.isInteger(event.note.s) || !Number.isFinite(event.note.f) || event.note.f < 0) continue;
        if (!lanes.has(event.note.s)) lanes.set(event.note.s, []);
        lanes.get(event.note.s).push(event);
    }
    // Match the highway's authored-link semantics: same string, immediate
    // next onset, matching fret/slide target, and a non-expired positive hold.
    for (const lane of lanes.values()) {
        lane.sort((a, b) => a.start - b.start);
        lane.forEach((event, index) => {
            if (event.note.ln !== true) return;
            let nextIndex = index + 1;
            while (nextIndex < lane.length && Math.abs(lane[nextIndex].start - event.start) < EPS) nextIndex++;
            if (nextIndex >= lane.length) return;
            const nextTime = lane[nextIndex].start;
            if (event.note.sus > 0 && nextTime > event.end + 0.06) return;
            const target = Number.isFinite(event.note.sl) && event.note.sl >= 0 ? event.note.sl
                : Number.isFinite(event.note.slu) && event.note.slu >= 0 ? event.note.slu : event.note.f;
            for (let j = nextIndex; j < lane.length && Math.abs(lane[j].start - nextTime) < EPS; j++) {
                if (lane[j].note.f === target) event.end = Math.max(event.end, nextTime);
            }
        });
    }
    return mergeIntervals(events.map(({ start, end }) => ({ start, end })));
}

function mergeIntervals(intervals) {
    const merged = [];
    intervals.sort((a, b) => a.start - b.start || b.end - a.end);
    for (const interval of intervals) {
        const last = merged[merged.length - 1];
        if (last && interval.start <= last.end + EPS) last.end = Math.max(last.end, interval.end);
        else merged.push({ ...interval });
    }
    return merged;
}

/** Prepare once after chart, difficulty, thresholds or loop bounds change. */
export function prepareRestWindows({ notes = [], chords = [], beats = [], duration = null, thresholdMode = 'beats', minimumBeats = 4, minimumSeconds = 3, fadeBeats = 1, loop = null } = {}) {
    const times = normalizeBeats(beats);
    const occupied = occupiedIntervals(notes, chords);
    const songEnd = Number.isFinite(duration) && duration > 0 ? duration : occupied[occupied.length - 1]?.end || 0;
    const cyclic = validLoop(loop) ? { start: loop.start, end: loop.end, hasWrapped: loop.hasWrapped === true } : null;
    const mode = thresholdMode === 'seconds' || times.length < 2 ? 'seconds' : 'beats';
    const required = mode === 'beats' ? Math.max(0, minimumBeats) : Math.max(0, minimumSeconds);
    const beatCoordinate = t => {
        if (!cyclic) return beatAt(times, t);
        const length = cyclic.end - cyclic.start;
        const lap = Math.floor((t - cyclic.start) / length);
        return lap * (beatAt(times, cyclic.end) - beatAt(times, cyclic.start))
            + beatAt(times, cyclic.start + (t - cyclic.start - lap * length));
    };
    // Keep the real song windows as well: while a seek/count-in is settling,
    // the visual clock can sit outside A..B (including an A/V offset). Virtual
    // copies of a loop must never overwrite real notes at those times.
    const ordinaryGaps = [];
    let songGapStart = 0;
    for (const n of occupied) {
        if (n.start > songGapStart + EPS) ordinaryGaps.push({ start: songGapStart, end: n.start, reentry: true });
        songGapStart = Math.max(songGapStart, n.end);
    }
    if (songEnd > songGapStart + EPS) ordinaryGaps.push({ start: songGapStart, end: songEnd, reentry: false });
    let gaps = ordinaryGaps;
    if (cyclic) {
        gaps = [];
        const length = cyclic.end - cyclic.start;
        const inside = occupied.filter(n => n.end >= cyclic.start && n.start < cyclic.end)
            .map(n => ({ start: Math.max(cyclic.start, n.start), end: Math.min(cyclic.end, n.end) }));
        if (!inside.length) gaps = [{ start: cyclic.start, end: cyclic.end, reentry: false }];
        else {
            const repeated = mergeIntervals([-1, 0, 1].flatMap(lap => inside.map(n => ({ start: n.start + lap * length, end: n.end + lap * length }))));
            for (let i = 1; i < repeated.length; i++) {
                // On first entry there was no preceding cycle to contribute
                // silence. After an actual continuous wrap, join head+tail.
                const start = cyclic.hasWrapped ? repeated[i - 1].end : Math.max(cyclic.start, repeated[i - 1].end);
                const end = repeated[i].start;
                if (end > cyclic.start && start < cyclic.end && end > start + EPS) gaps.push({ start, end, reentry: true });
            }
        }
    }
    const makeWindows = (input, coordinate) => input.filter(gap => {
        const length = mode === 'beats' ? coordinate(gap.end) - coordinate(gap.start) : gap.end - gap.start;
        return length + EPS >= required;
    }).map(gap => ({ ...gap, beats: times.length >= 2 ? coordinate(gap.end) - coordinate(gap.start) : null }));
    const windows = makeWindows(gaps, beatCoordinate);
    const ordinaryBeatCoordinate = t => beatAt(times, t);
    return {
        windows, ordinaryWindows: cyclic ? makeWindows(ordinaryGaps, ordinaryBeatCoordinate) : windows,
        beats: times, loop: cyclic, mode, fadeBeats: Math.max(0, fadeBeats), beatCoordinate, ordinaryBeatCoordinate,
    };
}

export function resolveRest(prepared, time) {
    const inactive = { active: false, opacity: 0, start: null, end: null, reentryInBeats: null, reentryInSeconds: null };
    if (!prepared || !Number.isFinite(time)) return inactive;
    const outsideLoop = prepared.loop && (time < prepared.loop.start || time >= prepared.loop.end);
    const windows = outsideLoop ? prepared.ordinaryWindows : prepared.windows;
    const coordinate = outsideLoop ? prepared.ordinaryBeatCoordinate : prepared.beatCoordinate;
    const window = windows[upperBound(windows, time, w => w.start) - 1];
    if (!window || time >= window.end - EPS || time < window.start) return inactive;
    const seconds = window.reentry ? Math.max(0, window.end - time) : null;
    const remainingBeats = window.reentry && prepared.beats.length >= 2
        ? Math.max(0, coordinate(window.end) - coordinate(time)) : null;
    const fadeIn = Math.min(1, Math.max(0, (time - window.start) / 0.18));
    const fadeOut = !window.reentry || prepared.fadeBeats === 0 ? 1
        : remainingBeats === null ? Math.min(1, seconds / 0.5)
            : Math.min(1, remainingBeats / prepared.fadeBeats);
    return { active: true, opacity: Math.min(fadeIn, fadeOut), start: window.start, end: window.end, reentryInBeats: remainingBeats, reentryInSeconds: seconds };
}
