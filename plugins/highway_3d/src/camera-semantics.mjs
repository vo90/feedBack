/**
 * Cached lane classification, independent of renderer state and playback speed.
 * Dependencies describe chart limits and note eligibility; this module neither
 * reads renderer state nor projects geometry.
 *
 * Precedence is intentional: coalesce lanes, prove longer note variations,
 * collect short-return evidence, select homes, then bypass isolated spikes.
 * Decisions and their explanations are built together, once per semantic plan.
 */
export function createCameraSemantics({ NFRETS, isRenderableNote }) {
    function collectRiffVariationEvidence(spans, context = null) {
        context = context || {};
        const result = new Map(), beats = context.beats || [];
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
            if (match) proofs.set(match.note, { ...match, baseline: previous.events,
                interval: { start: previous.time, end: next.end } });
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
            result.set(i, proof.interval);
        }
        return result;
    }

    // Compatibility entry point: callers interested only in candidate indices
    // need not know about the cached supporting-measure evidence.
    function hwyCameraRiffVariationCandidates(spans, context = null) {
        return new Set(collectRiffVariationEvidence(spans, context).keys());
    }

    function thresholdSeconds(excursionThreshold) {
        const threshold = Number(excursionThreshold);
        return Math.max(0, Math.min(3000, Number.isFinite(threshold) ? threshold : 500)) / 1000;
    }

    function coalesceCameraSpans(regions, brief) {
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
            span.explanation = { decision: 'follow', reason: span.lasting ? 'lasting-lane' : 'short-waypoint',
                home: null, interval: { start: span.time, end: span.end } };
        }
        return spans;
    }

    function describeHome(home) {
        return { base: home.base, firstFret: home.firstFret, x: home.x, time: home.time };
    }

    function suppressSpan(span, kind, home, explanation) {
        if (span.kind !== 'transit' && kind !== 'riff-variation') return;
        span.kind = kind; span.lasting = false;
        span.homeX = span.cameraX = home.x;
        span.explanation = explanation;
    }

    function applyRiffVariationDecisions(spans, context) {
        for (const [i, interval] of collectRiffVariationEvidence(spans, context)) {
            const home = spans[i - 1];
            suppressSpan(spans[i], 'riff-variation', home, { decision: 'hold',
                reason: 'proven-note-variation', home: describeHome(home), interval });
        }
    }

    function collectReturnEvidence(spans) {
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
        const repeatedReturn = new Uint8Array(spans.length), repeatedIntervals = new Array(spans.length);
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
            if (same) {
                repeatedReturn[i] = repeatedReturn[middle] = 1;
                repeatedIntervals[i] = repeatedIntervals[middle] = { start: spans[i].time, end: spans[end].time };
            }
        }
        const hasReturn = i => shortReturn(i) && (nextSame[i] === i + 2 || repeatedReturn[i]);
        return { nextSame, nextLasting, repeatedReturn, repeatedIntervals, hasReturn };
    }

    function collectSectionHomes(spans, context, { nextSame, hasReturn }) {
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
        return { sectionHomes, nextSectionHome };
    }

    function applyReturnDecisions(spans, evidence, { sectionHomes, nextSectionHome }) {
        const { nextSame, nextLasting, repeatedReturn, repeatedIntervals, hasReturn } = evidence;
        const seen = new Map();
        let protectedHome = -1;
        const holdReturn = (start, end) => {
            const home = spans[start];
            home.localHome = spans[end].localHome = true;
            const interval = end === start + 2 ? { start: home.time, end: spans[end].time }
                : repeatedIntervals[start];
            const explanation = { decision: 'hold', reason: end === start + 2 ? 'single-return' : 'repeated-cycle',
                home: describeHome(home), interval };
            // The home remains a followed destination. This evidence explains
            // the hold around it without relabelling its arrival as suppressed.
            home.explanation = spans[end].explanation = { ...explanation, decision: 'follow', reason: 'return-home' };
            for (let i = start + 1; i < end; i++) {
                suppressSpan(spans[i], 'ignored-excursion', home, explanation);
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
    }

    function applyIsolatedSpikeDecisions(spans) {
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
                if (i === start + 1 && !spans[start].localHome) {
                    suppressSpan(spans[start], 'ignored-overshoot', home, { decision: 'hold',
                        reason: 'isolated-off-route-spike', home: describeHome(home),
                        interval: { start: home.time, end: target.time } });
                }
            }
        }
    }

    function hwyBuildCameraTimeline(regions, { context = null, excursionThreshold = 500 } = {}) {
        context = context || {};
        const spans = coalesceCameraSpans(regions, thresholdSeconds(excursionThreshold));
        applyRiffVariationDecisions(spans, context);
        // Long-note variation decisions remove their lasting barrier before
        // short-return evidence is collected, preserving the established order.
        const evidence = collectReturnEvidence(spans);
        const sectionHomes = collectSectionHomes(spans, context, evidence);
        applyReturnDecisions(spans, evidence, sectionHomes);
        applyIsolatedSpikeDecisions(spans);
        return spans;
    }

    function hwyBuildCameraStops(regions, { context = null, excursionThreshold = 500 } = {}) {
        const timeline = hwyBuildCameraTimeline(regions, { context, excursionThreshold }), stops = [];
        const brief = thresholdSeconds(excursionThreshold);
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
