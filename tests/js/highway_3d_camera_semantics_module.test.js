const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCameraSemantics } = require('../../plugins/highway_3d/src/camera-semantics.mjs');

// Frozen dd9ed24 classification oracle. Kept independent of the extracted module:
// matching it must not depend on renderer source names or Git history at test time.
function createBaseline({ NFRETS, isRenderableNote }) {
    function hwyCameraRiffVariationCandidates(spans, context = null) {
        context = context || {};
        const result = new Set(), beats = context.beats || [];
        const starts = [];
        for (const beat of beats) {
            if (Number.isFinite(beat?.time) && Number.isFinite(beat.measure) && beat.measure >= 0
                && (!starts.length || beat.time > starts[starts.length - 1])) starts.push(beat.time);
        }
        if (starts.length < 4) return result;
        const count = Number.isInteger(context.stringCount) && context.stringCount > 0 ? context.stringCount : 6;
        const valid = n => n && Number.isInteger(n.s) && n.s >= 0 && n.s < count && isRenderableNote(n);
        const detail = n => {
            const out = {};
            // Timing/identity and fingering metadata are not note techniques.
            for (const key of ['sl', 'slu', 'su', 'slide_interval', 'bn', 'bnv', 'bt', 'vb', 'v',
                'vibrato', 'vibrato_marks', 'tr', 'tremolo_marks', 'whammy', 'hm', 'hp', 'hn', 'hps',
                'harmonic_target', 'harmonic_changes', 'harmonic_alias', 'ho', 'po', 'ln', 'mt', 'fhm',
                'pm', 'tap', 'tp', 'accent', 'ac', 'ig', 'rh', 'pkd', 'sg', 'slp', 'plk', 'ghost',
                'lr', 'let_ring_sus', 'slide_out', 'slideOut', 'slide_out_marks', 'slide_in_marks', 'pick_scrape_marks']) {
                if (n[key] !== undefined) out[key] = n[key];
            }
            return JSON.stringify(out);
        };
        const events = [];
        for (const note of context.notes || []) {
            if (Number.isFinite(note?.t) && valid(note)) events.push({ time: note.t, note,
                members: [{ s: note.s, f: note.f, sus: Math.max(0, Number(note.sus) || 0), detail: detail(note) }] });
        }
        for (const chord of context.chords || []) {
            if (!Number.isFinite(chord?.t) || chord.h3dSynth) continue;
            const members = (chord.notes || []).filter(valid).map(n => ({ s: n.s, f: n.f,
                sus: Math.max(0, Number(n.sus) || 0), detail: detail(n) }))
                .sort((a, b) => a.s - b.s || a.f - b.f);
            if (members.length) events.push({ time: chord.t, note: null, members });
        }
        events.sort((a, b) => a.time - b.time || Number(!!a.note) - Number(!!b.note)
            || a.members[0].s - b.members[0].s || a.members[0].f - b.members[0].f);
        const units = starts.slice(0, -1).map((time, i) => ({ time, end: starts[i + 1], events: [] }));
        let unitIndex = 0;
        for (const event of events) {
            while (unitIndex < units.length && event.time >= units[unitIndex].end) unitIndex++;
            if (unitIndex < units.length && event.time >= units[unitIndex].time) units[unitIndex].events.push(event);
        }
        const sections = (context.sections || []).map(row => Number(row?.time)).filter(Number.isFinite)
            .sort((a, b) => a - b);
        const proofs = new Map();
        // Source timestamps are rounded to milliseconds. This is their existing
        // coincidence tolerance, not another gameplay duration threshold.
        const eps = 0.000501 * 2;
        const compare = (a, b, allowVariation) => {
            if (Math.abs((a.end - a.time) - (b.end - b.time)) > eps
                || a.events.length !== b.events.length || !a.events.length) return null;
            let variation = null;
            for (let i = 0; i < a.events.length; i++) {
                const x = a.events[i], y = b.events[i];
                if (Math.abs((x.time - a.time) - (y.time - b.time)) > eps
                    || !!x.note !== !!y.note || x.members.length !== y.members.length) return null;
                for (let j = 0; j < x.members.length; j++) {
                    const m = x.members[j], n = y.members[j];
                    if (m.s !== n.s || Math.abs(m.sus - n.sus) > eps || m.detail !== n.detail) return null;
                    if (m.f !== n.f) {
                        if (!allowVariation || variation || !y.note || x.members.length !== 1) return null;
                        variation = { note: y.note, homeFret: m.f };
                    }
                }
            }
            return { variation };
        };
        let sectionIndex = 0;
        for (let i = 1; i + 1 < units.length; i++) {
            const previous = units[i - 1], current = units[i], next = units[i + 1];
            while (sectionIndex < sections.length && sections[sectionIndex] <= previous.time) sectionIndex++;
            if (sectionIndex < sections.length && sections[sectionIndex] < next.end) continue;
            if (!compare(previous, next, false)) continue;
            const match = compare(previous, current, true)?.variation;
            if (match) proofs.set(match.note, { ...match, baseline: previous.events });
        }
        let eventIndex = 0;
        for (let i = 1; i + 1 < spans.length; i++) {
            const span = spans[i], previous = spans[i - 1], next = spans[i + 1];
            while (eventIndex < events.length && events[eventIndex].time < span.time) eventIndex++;
            const first = eventIndex;
            while (eventIndex < events.length && events[eventIndex].time < span.end) eventIndex++;
            if (!span.lasting || eventIndex - first !== 1 || previous.base !== next.base
                || previous.base === span.base || !Number.isFinite(previous.firstFret)
                || !Number.isFinite(previous.lastFret)) continue;
            const note = events[first].note, proof = proofs.get(note);
            if (!proof || !(Number(note.sus) > 0.5) || !(note.f > previous.lastFret)
                || proof.homeFret < previous.firstFret || proof.homeFret > previous.lastFret) continue;
            if (proof.baseline.some(event => event.members.some(n => n.f > 0
                && (n.f < previous.firstFret || n.f > previous.lastFret)))) continue;
            result.add(i);
        }
        return result;
    }

    function hwyBuildCameraTimeline(regions, context = null, excursionThreshold = 500) {
        context = context || {};
        const threshold = Number(excursionThreshold);
        const brief = Math.max(0, Math.min(3000, Number.isFinite(threshold) ? threshold : 500)) / 1000;
        const spans = [];
        for (let i = 0; i < (regions?.length || 0); i++) {
            const row = regions[i], preferred = Number.isFinite(row?.preferred) ? row.preferred : row?.x;
            if (!Number.isFinite(row?.time) || !Number.isFinite(preferred)) continue;
            const base = Number.isFinite(row.firstFret) ? 'f/' + row.firstFret : 'x/' + preferred;
            let previous = spans[spans.length - 1];
            if (previous?.time === row.time && previous.base !== base) {
                spans.pop(); previous = spans[spans.length - 1];
            }
            if (previous?.base === base) {
                previous.regionEnd = i + 1;
                // Retain the initial preferred centre through same-base width
                // extensions; their actual extents are still in `regions`.
                previous.minX = Math.min(previous.minX, row.minX);
                previous.maxX = Math.max(previous.maxX, row.maxX);
                previous.lastFret = Math.max(previous.lastFret ?? 0, row.lastFret ?? 0);
                continue;
            }
            spans.push({ ...row, x: preferred, preferred, base, time: row.time, end: Infinity,
                regionStart: i, regionEnd: i + 1 });
        }
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            span.end = spans[i + 1]?.time ?? Infinity;
            span.duration = span.end - span.time;
            // Compensate subtraction roundoff only at the chosen song-time threshold.
            span.lasting = span.duration > 0 && span.duration >= brief - 1e-9;
            span.kind = span.lasting ? 'lasting' : 'transit';
            span.cameraX = span.x;
        }
        const ignore = (span, kind, home) => {
            if (span.kind !== 'transit' && kind !== 'riff-variation') return;
            span.kind = kind; span.lasting = false;
            span.homeX = span.cameraX = home.x;
        };
        for (const i of hwyCameraRiffVariationCandidates(spans, context)) {
            ignore(spans[i], 'riff-variation', spans[i - 1]);
        }
        // A short home dwell can still own a complete local return. Index the
        // next matching lane and lasting barrier once, rather than searching
        // ahead from every row or inheriting a remote lasting lane forever.
        const nextSame = new Int32Array(spans.length), nextLasting = new Int32Array(spans.length);
        const seen = new Map();
        let lasting = spans.length;
        for (let i = spans.length - 1; i >= 0; i--) {
            nextSame[i] = seen.get(spans[i].base) ?? -1;
            seen.set(spans[i].base, i);
            nextLasting[i] = lasting;
            if (spans[i].lasting) lasting = i;
        }
        const shortReturn = i => {
            const end = nextSame[i];
            // The indexed barrier means EVERY intermediate lane is shorter
            // than the threshold. Total time around the cycle is irrelevant.
            return end > i + 1 && end <= nextLasting[i];
        };
        // Direct runs and successively advancing peaks/troughs are travelling
        // patterns, even when the larger phrase eventually repeats or returns.
        // Keep the latest complete pattern's start, making interval queries
        // constant time without rescanning a repeated cycle's interior.
        const progressiveStart = new Int32Array(spans.length).fill(-1);
        let direction = 0, directionalSteps = 0;
        let latestPatternStart = -1;
        const peaks = { firstIndex: -1, firstValue: NaN, secondIndex: -1, secondValue: NaN };
        const troughs = { firstIndex: -1, firstValue: NaN, secondIndex: -1, secondValue: NaN };
        for (let i = 1; i < spans.length; i++) {
            const previous = spans[i - 1], current = spans[i];
            const previousPosition = Number.isFinite(previous.firstFret) ? previous.firstFret : previous.x;
            const currentPosition = Number.isFinite(current.firstFret) ? current.firstFret : current.x;
            const nextDirection = Math.sign(currentPosition - previousPosition);
            directionalSteps = nextDirection && nextDirection === direction ? directionalSteps + 1 : nextDirection ? 1 : 0;
            if (directionalSteps >= 3) latestPatternStart = Math.max(latestPatternStart, i - 3);
            if (nextDirection && direction && nextDirection !== direction) {
                const turns = direction > 0 ? peaks : troughs;
                if (turns.firstIndex >= 0 && ((turns.firstValue < turns.secondValue && turns.secondValue < previousPosition)
                    || (turns.firstValue > turns.secondValue && turns.secondValue > previousPosition))) {
                    latestPatternStart = Math.max(latestPatternStart, turns.firstIndex);
                }
                turns.firstIndex = turns.secondIndex; turns.firstValue = turns.secondValue;
                turns.secondIndex = i - 1; turns.secondValue = previousPosition;
            }
            direction = nextDirection;
            progressiveStart[i] = latestPatternStart;
        }
        const hasProgressiveRun = (start, end) => progressiveStart[end] >= start;
        // A multi-lane return needs a repeated ordered cycle, rather than an
        // arbitrary eventual return after a climb or a different local riff.
        // Consecutive cycles for one fret are disjoint; exact comparisons are
        // bounded by the physical fret vocabulary, without hashing or slices.
        // Unknown geometry-only homes conservatively keep their waypoints.
        const repeatedReturn = new Uint8Array(spans.length);
        for (let i = 0; i < spans.length; i++) {
            if (!Number.isInteger(spans[i].firstFret) || spans[i].firstFret < 0
                || spans[i].firstFret > NFRETS || !shortReturn(i)) continue;
            const middle = nextSame[i];
            if (!shortReturn(middle)) continue;
            const end = nextSame[middle], length = middle - i;
            // Check the join as well: rotating the cycle's proposed home must
            // not hide a travelling run that crosses its first return.
            if (length !== end - middle || hasProgressiveRun(i, end)) continue;
            let same = true;
            for (let offset = 1; same && offset < length; offset++) {
                same = spans[i + offset].base === spans[middle + offset].base;
            }
            if (same) repeatedReturn[i] = repeatedReturn[middle] = 1;
        }
        const hasReturn = i => shortReturn(i) && (nextSame[i] === i + 2 || repeatedReturn[i]);
        // Overlapping cycles may support several homes. An authored section
        // can break that tie only when its incoming lane has a complete short
        // return inside the section. A marker alone never invents a home.
        const sections = [...new Set((context.sections || []).map(section => section?.time)
            .filter(Number.isFinite))].sort((a, b) => a - b);
        const sectionHomes = new Set();
        let section = 0;
        for (let i = 0; i < spans.length; i++) {
            while (section < sections.length && sections[section] < spans[i].time - 1e-6) section++;
            if (Math.abs(sections[section] - spans[i].time) <= 1e-6 && hasReturn(i)
                && spans[nextSame[i]].time < (sections[section + 1] ?? Infinity) - 1e-6) sectionHomes.add(i);
        }
        const nextSectionHome = new Int32Array(spans.length);
        let sectionHome = spans.length;
        for (let i = spans.length - 1; i >= 0; i--) {
            nextSectionHome[i] = sectionHome;
            if (sectionHomes.has(i)) sectionHome = i;
        }
        seen.clear();
        let protectedHome = -1;
        const holdReturn = (start, end) => {
            const home = spans[start];
            home.localHome = spans[end].localHome = true;
            for (let i = start + 1; i < end; i++) {
                ignore(spans[i], 'ignored-excursion', home);
                if (seen.get(spans[i].base) === i) seen.delete(spans[i].base);
            }
            protectedHome = end;
        };
        for (let i = 0; i < spans.length; i++) {
            if (spans[i].kind === 'riff-variation') continue;
            const previous = seen.get(spans[i].base);
            // A completed singleton reply or proven repeated cycle can
            // establish a local home. Never reach back across a lasting lane.
            if (previous !== undefined && previous >= protectedHome && i > previous + 1
                && i === nextSame[previous] && i <= nextLasting[previous]
                && i <= nextSectionHome[previous]
                && (i === previous + 2 || repeatedReturn[previous])) holdReturn(previous, i);
            if (!i || spans[i].lasting || spans[i].localHome || sectionHomes.has(i)) {
                protectedHome = i;
                // An established incoming home wins nested short returns.
                // Consumed intervals are disjoint, so this pass stays linear.
                while (hasReturn(i) && nextSame[i] <= nextSectionHome[i]) {
                    const end = nextSame[i];
                    holdReturn(i, end);
                    i = end;
                }
            }
            seen.set(spans[i].base, i);
        }
        const destinations = [];
        for (let i = 0; i < spans.length; i++) if (!i || spans[i].lasting) destinations.push(i);
        for (let k = 0; k + 1 < destinations.length; k++) {
            const a = destinations[k], b = destinations[k + 1], home = spans[a], target = spans[b];
            let away = a + 1;
            for (let i = away; i <= b; i++) {
                if (spans[i].base !== home.base) continue;
                away = i + 1;
            }
            if (away >= b || target.base === home.base) continue;
            const low = Math.min(home.x, target.x), high = Math.max(home.x, target.x);
            const outside = span => span.x < low - 1e-8 || span.x > high + 1e-8;
            for (let i = away; i < b;) {
                // Between ADJACENT lasting positions every intermediate lane
                // is individually short. Only isolated off-route spikes are
                // bypassed here; multi-lane holds require the cycle proof above.
                if (!outside(spans[i])) { i++; continue; }
                const start = i;
                while (i < b && outside(spans[i])) i++;
                // Alternating directions can still form a progressive climb.
                // Do not infer a hold from an unproven multi-lane group.
                if (i === start + 1 && !spans[start].localHome) ignore(spans[start], 'ignored-overshoot', home);
            }
        }
        return spans;
    }

    function hwyBuildCameraStops(regions, rate, canHold, sharedCentre = null, dominantInterval = null, attacks = null, context = null, excursionThreshold = 500) {
        const timeline = hwyBuildCameraTimeline(regions, context, excursionThreshold), stops = [];
        const threshold = Number(excursionThreshold);
        const brief = Math.max(0, Math.min(3000, Number.isFinite(threshold) ? threshold : 500)) / 1000;
        for (const span of timeline) {
            if (span.kind.startsWith('ignored-') || span.kind === 'riff-variation') continue;
            const previous = stops[stops.length - 1];
            if (previous && Math.abs(previous.x - span.x) <= 1e-8) {
                // An ignored excursion can return to the existing home without
                // another motion. A real transit to another x retains return.
                previous.end = span.end;
                previous.duration = previous.end - previous.time;
                previous.localHome = previous.localHome || span.localHome;
                previous.lasting = previous.lasting || span.lasting
                    || (previous.localHome && previous.duration >= brief - 1e-9);
                if (previous.lasting) previous.reason = 'lasting';
                continue;
            }
            stops.push({ ...span, reason: span.kind });
        }
        stops.timeline = timeline;
        return stops;
    }
    return { hwyCameraRiffVariationCandidates, hwyBuildCameraTimeline, hwyBuildCameraStops };
}

const dependencies = {
    NFRETS: 24,
    isRenderableNote: note => Number.isInteger(note.f) && note.f >= 0 && note.f <= 24 && !note.hidden,
};
const current = createCameraSemantics(dependencies);
const baseline = createBaseline(dependencies);
const row = (time, firstFret, width = 4, extra = {}) => ({ time, firstFret,
    lastFret: firstFret + width - 1, minX: (firstFret - 1) * 10, maxX: (firstFret + width - 1) * 10,
    x: (firstFret + 1) * 10, preferred: (firstFret + 1) * 10, normalWidth: 40, ...extra });
const path = (frets, step = .3) => frets.map((fret, i) => row(i ? 2 + (i - 1) * step : 0, fret));

function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

function withoutExplanation(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
        if (key !== 'explanation') copy[key] = withoutExplanation(value[key]);
    }
    return copy;
}

function assertParity(rows, context = null, excursionThreshold = 500) {
    freeze(rows); freeze(context);
    const options = { context, excursionThreshold };
    const expectedTimeline = baseline.hwyBuildCameraTimeline(rows, context, excursionThreshold);
    const actualTimeline = current.hwyBuildCameraTimeline(rows, options);
    assert.deepEqual(withoutExplanation(actualTimeline), expectedTimeline);
    const expectedStops = baseline.hwyBuildCameraStops(rows, 1, null, null, null, null, context, excursionThreshold);
    const actualStops = current.hwyBuildCameraStops(rows, options);
    assert.deepEqual(withoutExplanation(actualStops), expectedStops);
    // The public evidence collector takes coalesced spans before decisions.
    // Restore their duration classification because a successful variation in
    // the final timeline has already had its lasting flag cleared.
    const rawThreshold = Number(excursionThreshold);
    const brief = Math.max(0, Math.min(3000, Number.isFinite(rawThreshold) ? rawThreshold : 500)) / 1000;
    const candidates = expectedTimeline.map(span => ({ ...span,
        lasting: span.duration > 0 && span.duration >= brief - 1e-9 }));
    assert.deepEqual([...current.hwyCameraRiffVariationCandidates(candidates, context)],
        [...baseline.hwyCameraRiffVariationCandidates(candidates, context)]);
    return actualStops;
}

function variationFixture() {
    const notes = [];
    for (const start of [0, 4, 8]) {
        notes.push({ t: start + .2, s: 0, f: 5, sus: 0 },
            { t: start + 1, s: 1, f: start === 4 ? 13 : 7, sus: 1.2 },
            { t: start + 3, s: 0, f: 5, sus: 0 });
    }
    return { rows: [row(0, 5), row(5, 13), row(6.2, 5)],
        context: { notes, chords: [], beats: [0, 4, 8, 12].map((time, measure) => ({ time, measure })),
            sections: [{ time: 0, name: 'riff' }] } };
}

test('the module matches the frozen planner for threshold, repetition, progression and overlapping-home cases', () => {
    const cases = [
        [], [row(0, 5)],
        [row(0, 1), row(632.272, 7), row(633.499, 1)],
        ...[.499, .5, .501].map(duration => [row(0, 1), row(2, 24), row(2 + duration, 1)]),
        path([5, 8, 7, 4, 5, 8, 7, 4, 5]),
        path([5, 8, 7, 4, 5]),
        path([1, 3, 5, 7, 9, 7, 5, 3, 1]),
        path([1, 4, 2, 6, 3, 8, 1, 4, 2, 6, 3, 8, 1]),
        path([5, 8, 10, 8, 5, 8, 10, 8, 5, 6, 7, 6, 8, 9]),
        path([9, 13, 8]), path([9, 13, 14, 8]),
        path([5, 9, 5, 6, 7, 8]),
        [row(0, 5), row(2, 5, 8), row(3, 5, 4), row(4, 9)],
        [row(0, 5), row(2, 8), row(2, 5), row(3, 9)],
        [row(0, 5), row(NaN, 9), row(2, 8, 4, { preferred: NaN, x: NaN }), row(3, 9)],
        path([5, 8, 7, 5, 8, 7, 5]).map(({ firstFret, ...span }) => span),
    ];
    for (const rows of cases) for (const threshold of [0, 250, 350, 500, 900, 1000, 3000]) {
        assertParity(rows, null, threshold);
        if (rows.length > 2) assertParity(rows, { sections: [{ time: rows[1].time, name: 'entry' }] }, threshold);
    }
});

test('longer note variations preserve exact evidence requirements and precedence over lasting barriers', () => {
    for (const change of [
        () => {},
        context => { context.beats = []; },
        context => { context.sections = []; },
        context => { context.sections.push({ time: 4, name: 'new' }); },
        context => { context.notes[4].t += .1; },
        context => { context.notes[4].sus = .5; },
        context => { context.notes[4].sl = 15; },
        context => { context.notes[4].f = 2; },
        context => { context.notes.push({ t: 5.6, s: 2, f: 13, sus: 0 }); },
        context => { context.notes[7].f = 6; },
        context => {
            context.notes = context.notes.filter(note => note.t !== 5);
            context.chords = [{ t: 5, notes: [{ s: 1, f: 13, sus: 1.2 }, { s: 2, f: 15, sus: 1.2 }] }];
        },
    ]) {
        for (const threshold of [0, 500, 1000, 1500, 3000]) {
            const { rows, context } = variationFixture();
            change(context);
            assertParity(rows, context, threshold);
        }
    }
});

test('seeded generated lane sequences preserve every baseline decision and numerical field', () => {
    let seed = 0x5eedcab;
    const random = limit => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % limit;
    };
    for (let caseIndex = 0; caseIndex < 600; caseIndex++) {
        let time = random(100000) / 1000;
        const rows = [], sections = [];
        const length = 3 + random(70);
        const cycle = Array.from({ length: 2 + random(7) }, () => 1 + random(20));
        for (let i = 0; i < length; i++) {
            const fret = caseIndex % 3 === 0 ? cycle[i % cycle.length] : 1 + random(20);
            rows.push(row(time, fret, 1 + random(9), { h3dResolvedChordLane: !!random(2) }));
            if (random(15) === 0) sections.push({ time, name: 'section' });
            time += [0, .1, .25, .299, .3, .499, .5, .501, 1, 2][random(10)];
        }
        if (caseIndex % 5 === 0) rows.forEach(span => { span.x *= -1; span.preferred *= -1; });
        const threshold = [0, 100, 250, 300, 500, 1000, 3000][random(7)];
        assertParity(rows, { sections }, threshold);
    }
});

test('dense coalescing and repeated-return plans keep the same stops and source-span durations', () => {
    const metadata = Array.from({ length: 10000 }, (_, i) => row(i / 10000, 5, i % 2 ? 4 : 8));
    metadata.push(row(1, 9), row(2, 5));
    assertParity(metadata);
    const returns = Array.from({ length: 20000 }, (_, i) => row(i * .1, i % 2 ? 12 : 5));
    returns.push(row(2000, 5), row(2002, 9));
    const stops = assertParity(returns, null, 3000);
    assert.deepEqual(stops.map(stop => stop.firstFret), [5, 9]);
    assert.equal(stops[0].duration, 2002);
    assert.equal(stops.timeline[0].duration, .1);
});

test('held lanes explain their home and supporting evidence while kept lanes retain their arrival', () => {
    const single = assertParity(path([5, 12, 5]));
    const reply = single.timeline[1].explanation;
    assert.equal(reply.decision, 'hold'); assert.equal(reply.reason, 'single-return');
    assert.equal(reply.home.firstFret, 5); assert.equal(reply.home.x, 60);
    assert.deepEqual(reply.interval, { start: 0, end: 2.3 });
    assert.equal(single.timeline[0].explanation.decision, 'follow');
    assert.equal(single.timeline[0].explanation.reason, 'return-home');
    const repeated = assertParity(path([5, 8, 7, 4, 5, 8, 7, 4, 5]));
    const cycle = repeated.timeline[1].explanation;
    assert.equal(cycle.reason, 'repeated-cycle');
    assert.deepEqual(cycle.interval, { start: 0, end: repeated.timeline.at(-1).time });
    assert.equal(repeated.timeline[2].explanation, cycle, 'a hold shares its cached evidence object');
    const spike = assertParity(path([9, 13, 8])).timeline[1].explanation;
    assert.equal(spike.reason, 'isolated-off-route-spike'); assert.equal(spike.home.firstFret, 9);
    const { rows, context } = variationFixture();
    const variation = assertParity(rows, context).timeline[1].explanation;
    assert.equal(variation.reason, 'proven-note-variation');
    assert.deepEqual(variation.interval, { start: 0, end: 12 });
    const lasting = assertParity([row(0, 1), row(2, 7), row(3, 9)]);
    assert.equal(lasting.timeline[1].explanation.reason, 'lasting-lane');
    const run = assertParity(path([1, 3, 5, 7]));
    assert.equal(run.timeline[1].explanation.reason, 'short-waypoint');
});

test('independent factory instances use only their explicit chart dependencies', () => {
    const { rows, context } = variationFixture();
    let visits = 0;
    const muted = createCameraSemantics({ NFRETS: 24, isRenderableNote: () => { visits++; return false; } });
    const held = current.hwyBuildCameraStops(rows, { context });
    const followed = muted.hwyBuildCameraStops(rows, { context });
    assert.ok(visits > 0);
    assert.deepEqual(held.map(stop => stop.firstFret), [5]);
    assert.deepEqual(followed.map(stop => stop.firstFret), [5, 13, 5]);
    assert.deepEqual(current.hwyBuildCameraStops(rows, { context }), held);
});

test('the options API retains existing threshold defaults, coercion and bounds', () => {
    const rows = path([5, 8, 7, 4, 5, 8, 7, 4, 5]);
    assert.deepEqual(current.hwyBuildCameraStops(rows),
        current.hwyBuildCameraStops(rows, { excursionThreshold: 500 }));
    for (const threshold of [undefined, null, NaN, Infinity, -100, 4000, '350', 'invalid']) {
        assertParity(rows, null, threshold);
    }
});
