// Presentation-only hand positions. Musical events and source metadata remain intact.
const TIME_EPS = 0.000501;
const MAX_FRET = 24;
const flag = value => value === true || value === 1 || value === '1';
const fret = value => Number.isInteger(value) && value >= 0 && value <= MAX_FRET;

function lowerBound(rows, time) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid].time < time) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function slideTarget(note) {
    for (const key of ['sl', 'slu', 'su']) {
        if (fret(note[key])) return note[key];
    }
    return null;
}

function contact(note, time, count) {
    if (!note || !Number.isFinite(time)) return null;
    const string = note.s, value = note.f;
    if (!Number.isInteger(string) || string < 0 || string >= count) return null;
    const target = slideTarget(note);
    // A plain dead strike supplies no fretting evidence. A positioned motion or
    // harmonic retains its actual contact; palm/fret-hand mute is not a dead note.
    const dead = flag(note.mt) && (note.pick_scrape_marks?.length || (target === null
        && !note.slide_out && !note.slideOut && !note.slide_out_marks?.length && !note.slide_in_marks?.length
        && !note.vibrato_marks?.length && !note.bt && !note.vb && !note.vibrato && !note.whammy
        && !note.ho && !note.po && !flag(note.ln)
        && !note.hm && !note.hp && !note.hn && !note.harmonic_target
        && !note.harmonic_changes && !note.harmonic_alias && !note.bn && !note.bnv?.length));
    const evidence = fret(value) && !dead;
    const duration = Number.isFinite(note.sus) ? Math.max(0, note.sus) : 0;
    // Even an unpitched attack ends the preceding note's ownership of a string.
    return { time, string, fret: value, evidence, end: time + (evidence ? duration : 0),
        target: evidence && duration > 0 ? target : null, targetTime: time + duration,
        linked: evidence && flag(note.ln) };
}

function buildContacts(notes, chords, count) {
    const strings = Array.from({ length: count }, () => []), attacks = [];
    for (const note of notes) {
        const row = contact(note, note?.t, count);
        if (row) strings[row.string].push(row);
    }
    for (const chord of chords) {
        if (!chord || chord.h3dSynth || !Number.isFinite(chord.t)) continue;
        const members = [];
        for (const note of chord.notes || []) {
            const row = contact(note, chord.t, count);
            if (row) {
                strings[row.string].push(row);
                if (row.evidence) members.push(row);
            }
        }
        if (members.length) attacks.push({ time: chord.t, members });
    }
    for (const rows of strings) {
        rows.sort((a, b) => a.time - b.time);
        let next = Infinity;
        for (let end = rows.length; end > 0;) {
            let start = end - 1;
            while (start > 0 && rows[start - 1].time === rows[end - 1].time) start--;
            for (let i = start; i < end; i++) {
                const row = rows[i];
                // An old written sustain cannot claim a string after its next pick.
                row.end = Math.min(row.linked && Number.isFinite(next)
                    ? Math.max(row.end, next) : row.end, next);
                if (row.targetTime > row.end + TIME_EPS) row.target = null;
            }
            next = rows[start].time;
            end = start;
        }
    }
    attacks.sort((a, b) => a.time - b.time);
    return { strings, attacks };
}

function compatible(row, value, start, end) {
    if (!row.evidence) return false;
    const attackInside = row.time >= start - TIME_EPS && row.time < end - TIME_EPS;
    const carried = row.time < start - TIME_EPS && row.end > start + TIME_EPS;
    if (row.fret === value && (attackInside || (carried && row.target === null))) return true;
    return row.target === value && row.targetTime >= start - TIME_EPS
        && row.targetTime <= end + TIME_EPS && row.time < end - TIME_EPS;
}

function matchingStrings(index, members, start, end) {
    const matched = new Set();
    for (const [string, value] of members) {
        const rows = index.strings[string];
        let from = lowerBound(rows, start - TIME_EPS);
        // Only the immediately preceding attack group can still own this string.
        if (from > 0) {
            const previous = rows[from - 1].time;
            do { from--; } while (from > 0 && rows[from - 1].time === previous);
        }
        for (let i = from; i < rows.length && rows[i].time < end - TIME_EPS; i++) {
            if (compatible(rows[i], value, start, end)) { matched.add(string); break; }
        }
    }
    return matched;
}

function conflictingAttack(index, members, start, end) {
    for (let i = lowerBound(index.attacks, start - TIME_EPS);
        i < index.attacks.length && index.attacks[i].time < end - TIME_EPS; i++) {
        const attack = index.attacks[i];
        const conflicts = new Set(), matches = new Set();
        for (const row of attack.members) {
            if (!members.has(row.string)) continue;
            if (compatible(row, members.get(row.string), start, end)) matches.add(row.string);
            else conflicts.add(row.string);
        }
        // A partial chord or ornament sharing part of the grip is insufficient
        // to disprove it. A replacement on two of its strings, sharing no actual
        // contact, is direct evidence against keeping the old full grip.
        if (conflicts.size >= 2 && matches.size === 0) return attack.time;
    }
    return Infinity;
}

function eventGripsFromContacts(index) {
    const result = [];
    for (const rows of index.strings) {
        for (const row of rows) {
            if (!row.evidence) continue;
            const values = [row.fret, row.target].filter(value => value > 0);
            if (!values.length) continue;
            result.push({ start: row.time, end: Math.max(row.end, row.time + 2 * TIME_EPS),
                low: Math.min(...values), high: Math.max(...values) });
        }
    }
    return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Validate only the effective difficulty's presentation handshapes. */
export function buildHandshapeGuidance(input = {}) {
    let { notes = [], chords = [], handShapes = [], templates = [], stringCount = 6 } = input || {};
    notes = Array.isArray(notes) ? notes : [];
    chords = Array.isArray(chords) ? chords : [];
    handShapes = Array.isArray(handShapes) ? handShapes : [];
    templates = templates && typeof templates === 'object' ? templates : [];
    const count = Number.isInteger(stringCount) && stringCount >= 1 && stringCount <= 8 ? stringCount : 6;
    const index = buildContacts(notes, chords, count);
    const accepted = [], grips = [], decisions = [], templateCache = new Map();
    for (const [shapeIndex, shape] of handShapes.entries()) {
        const start = Number(shape?.start_time ?? shape?.startTime);
        const end = Number(shape?.end_time ?? shape?.endTime);
        const id = shape?.chord_id ?? shape?.chordId;
        const decision = { shape, index: shapeIndex, status: 'unresolved', reason: 'invalid-shape',
            matchedStrings: [], unmatchedStrings: [] };
        decisions.push(decision);
        if (!shape || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || id == null) continue;
        if (!templateCache.has(id)) {
            const values = templates[id]?.frets;
            const members = new Map();
            if (Array.isArray(values)) {
                for (let s = 0; s < Math.min(count, values.length); s++) if (fret(values[s])) members.set(s, values[s]);
            }
            templateCache.set(id, members);
        }
        const members = templateCache.get(id);
        if (members.size < 2) { decision.reason = 'insufficient-template-contacts'; continue; }
        const conflict = conflictingAttack(index, members, start, end);
        const supportedEnd = Math.min(end, conflict);
        const matched = matchingStrings(index, members, start, supportedEnd);
        decision.matchedStrings = [...matched];
        decision.unmatchedStrings = [...members.keys()].filter(s => !matched.has(s));
        if (conflict <= start + TIME_EPS) {
            decision.status = 'contradicted'; decision.reason = 'replacement-chord'; continue;
        }
        if (matched.size < 2) {
            decision.status = Number.isFinite(conflict) ? 'contradicted' : 'unresolved';
            decision.reason = Number.isFinite(conflict) ? 'replacement-chord' : 'insufficient-musical-support';
            continue;
        }
        // Only the display interval is clipped. Original metadata and all
        // source attacks, sustains, IDs and timing remain untouched.
        let display = shape;
        if (supportedEnd < end) {
            display = { ...shape };
            if ('end_time' in display || !('endTime' in display)) display.end_time = supportedEnd;
            if ('endTime' in display) display.endTime = supportedEnd;
        }
        accepted.push(display);
        decision.status = 'supported';
        decision.reason = supportedEnd < end ? 'supported-until-replacement' : 'matching-musical-contacts';
        decision.handShape = display;
        const positive = [...members.values()].filter(value => value > 0);
        if (positive.length) grips.push({ start, end: supportedEnd,
            low: Math.min(...positive), high: Math.max(...positive), shape: display, index: shapeIndex });
    }
    return { handShapes: accepted, grips, eventGrips: eventGripsFromContacts(index), decisions };
}

function validPosition(row, maxFret) {
    const first = Math.max(1, Number(row?.fret)), width = Number(row?.width ?? 4);
    return row?.fret != null && Number.isInteger(first) && Number.isInteger(width)
        && width > 0 && first + width - 1 <= maxFret ? { first, last: first + width - 1 } : null;
}

function samePosition(a, b) {
    if (!a || !b) return false;
    const keys = Object.keys(a).filter(key => key !== 'time');
    return keys.length === Object.keys(b).filter(key => key !== 'time').length
        && keys.every(key => a[key] === b[key]);
}

/** Compose full-grip context into one lane, never a second competing rectangle. */
export function composeHandPositionLanes(anchors = [], grips = [], options = {}) {
    let { maxFret = 24, eventGrips = [] } = options || {};
    anchors = Array.isArray(anchors) ? anchors : [];
    grips = Array.isArray(grips) ? grips : [];
    eventGrips = Array.isArray(eventGrips) ? eventGrips : [];
    maxFret = Number.isInteger(maxFret) && maxFret >= 1 ? maxFret : 24;
    const validGrip = g => g && Number.isFinite(g.start) && Number.isFinite(g.end)
        && g.end > g.start && Number.isInteger(g.low) && Number.isInteger(g.high)
        && g.low > 0 && g.high >= g.low && g.high <= maxFret;
    const demands = grips.filter(validGrip);
    if (!demands.length) return anchors;
    const events = eventGrips.filter(validGrip);
    const positions = anchors.filter(a => a && Number.isFinite(a.time)).slice().sort((a, b) => a.time - b.time);
    const starts = new Map(), ends = new Map(), times = new Set(positions.map(a => a.time));
    const eventStarts = new Map(), eventEnds = new Map();
    const add = (g, startsAt, endsAt) => {
        times.add(g.start); times.add(g.end);
        if (!startsAt.has(g.start)) startsAt.set(g.start, []);
        if (!endsAt.has(g.end)) endsAt.set(g.end, []);
        startsAt.get(g.start).push(g); endsAt.get(g.end).push(g);
    };
    for (const g of demands) add(g, starts, ends);
    for (const g of events) add(g, eventStarts, eventEnds);
    if (!positions.length) {
        let firstTime = 0;
        for (const g of demands) firstTime = Math.min(firstTime, g.start);
        positions.push({ time: firstTime, fret: 1, width: Math.min(4, maxFret) });
    }
    times.add(positions[0].time);
    const active = new Set(), activeEvents = new Set(), output = [];
    let p = 0, base = positions[0];
    for (const time of [...times].sort((a, b) => a - b)) {
        while (p < positions.length && positions[p].time <= time) base = positions[p++];
        for (const g of ends.get(time) || []) active.delete(g);
        for (const g of starts.get(time) || []) active.add(g);
        for (const g of eventEnds.get(time) || []) activeEvents.delete(g);
        for (const g of eventStarts.get(time) || []) activeEvents.add(g);
        let row = base.time === time ? base : { ...base, time };
        if (active.size) {
            let low = Infinity, high = -Infinity;
            for (const g of active) { low = Math.min(low, g.low); high = Math.max(high, g.high); }
            const span = validPosition(base, maxFret);
            const gripOverlapsBase = span && [...active].some(g => g.low <= span.last && g.high >= span.first);
            // The inherited anchor can describe a chord that has already ended.
            // Only timed musical contacts require simultaneous remote frets.
            for (const g of activeEvents) { low = Math.min(low, g.low); high = Math.max(high, g.high); }
            if (!span || low < span.first || high > span.last) {
                // Retain a useful overlapping authored hand position. A wholly
                // remote position is not a reason to invent a long empty lane.
                if (gripOverlapsBase) {
                    low = Math.min(low, span.first); high = Math.max(high, span.last);
                }
                const width = Math.min(maxFret, Math.max(Math.min(4, maxFret), high - low + 1));
                const first = Math.max(1, Math.min(low, maxFret - width + 1));
                row = { ...base, time, fret: first, width,
                    h3dUnifiedHandPosition: true, h3dResolvedChordLane: true };
            }
        }
        if (!samePosition(output.at(-1), row)) output.push(row);
    }
    return output;
}
