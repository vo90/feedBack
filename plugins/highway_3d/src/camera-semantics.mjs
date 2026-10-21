/**
 * Cached lane classification, independent of renderer state and playback speed.
 * Dependencies describe chart limits and note eligibility; this module neither
 * reads renderer state nor projects geometry.
 *
 * Musical evidence and ownership are compiled without the duration slider.
 * Applying that slider only activates fixed suppression candidates. It cannot
 * invent another home, change a pattern boundary, or restore a removed target.
 */
export function createCameraSemantics({ NFRETS, isRenderableNote }) {
    // Authored sections and playback attacks can differ at millisecond wire
    // precision. Assign coincident attacks to the resumed passage, consistently
    // with the existing chart-anchor coincidence tolerance.
    const boundaryEpsilon = 0.000501;
    function compileMusicalBreaks(context) {
        const sections = (context.sections || []).filter(row => Number.isFinite(row?.time))
            .slice().sort((a, b) => a.time - b.time);
        const quiet = row => /^(noguitar|silence)$/.test(String(row?.name || '').trim().toLowerCase());
        const intervals = [];
        for (let index = 0; index < sections.length;) {
            const start = sections[index].time;
            let allQuiet = true;
            while (index < sections.length && sections[index].time === start) allQuiet = quiet(sections[index++]) && allQuiet;
            if (!allQuiet) continue;
            // Adjacent quiet labels describe one break, not several resumptions.
            while (index < sections.length && quiet(sections[index])) {
                const time = sections[index].time;
                let end = index;
                while (end < sections.length && sections[end].time === time) end++;
                if (!sections.slice(index, end).every(quiet)) break;
                index = end;
            }
            const end = sections[index]?.time;
            // Overlapping coincidence windows cannot prove a distinct rest.
            if (Number.isFinite(end) && end - start > boundaryEpsilon * 2) intervals.push({start, end});
        }
        if (!intervals.length) return [];
        const count = Number.isInteger(context.stringCount) && context.stringCount > 0 ? context.stringCount : 6;
        // Open strings and muted/unpitched strikes are activity too. An
        // otherwise ambiguous note on a real string cannot prove silence.
        const valid = note => note && Number.isInteger(note.s) && note.s >= 0 && note.s < count;
        const sustain = value => value === undefined || value === null ? 0
            : Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : Infinity;
        const duration = note => Math.max(sustain(note?.sus), sustain(note?.let_ring_sus));
        const events = [];
        for (const note of context.notes || []) if (Number.isFinite(note?.t) && valid(note))
            events.push({time: note.t, end: note.t + duration(note)});
        for (const chord of context.chords || []) {
            if (!Number.isFinite(chord?.t) || chord.h3dSynth) continue;
            const members = (chord.notes || []).filter(valid);
            if (!members.length) continue;
            let length = duration(chord);
            for (const note of members) length = Math.max(length, duration(note));
            events.push({time: chord.t, end: chord.t + length});
        }
        events.sort((a, b) => a.time - b.time);
        const breaks = [];
        let cursor = 0, soundingUntil = -Infinity;
        for (const interval of intervals) {
            let occupied = soundingUntil > interval.start + boundaryEpsilon;
            while (cursor < events.length && events[cursor].time < interval.end - boundaryEpsilon) {
                const event = events[cursor++];
                if (event.time >= interval.start - boundaryEpsilon
                    || event.end > interval.start + boundaryEpsilon) occupied = true;
                soundingUntil = Math.max(soundingUntil, event.end);
            }
            if (!occupied) breaks.push(interval);
        }
        return breaks;
    }

    function compileBreakOwnership(spans, route, musicalBreaks) {
        const segments = new Int32Array(route.length), resets = new Int32Array(route.length).fill(-1);
        const sharedHomes = new Uint8Array(route.length);
        const segmentTimes = new Float64Array(route.length).fill(-Infinity);
        let boundary = 0, segment = 0, resumedAt = -Infinity;
        for (let index = 0; index < route.length; index++) {
            const span = spans[route[index]];
            while (boundary < musicalBreaks.length && musicalBreaks[boundary].end < span.end - boundaryEpsilon) {
                const resume = musicalBreaks[boundary++].end;
                resumedAt = resume;
                segment++;
                if (resume > span.time + boundaryEpsilon) {
                    // The unchanged lane is both the old run's endpoint and
                    // the new passage's initial home. Reset outgoing history.
                    if (index + 1 < route.length) resets[index + 1] = index;
                    sharedHomes[index] = 1;
                } else resets[index] = index;
            }
            segments[index] = segment;
            segmentTimes[index] = resumedAt;
        }
        return {segments, resets, sharedHomes, segmentTimes};
    }

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
            if (eventIndex - first !== 1 || previous.base !== next.base
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

    function coalesceCameraSpans(regions) {
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
            span.sourceIndex = i;
        }
        return spans;
    }

    function describeHome(home) {
        return { base: home.base, firstFret: home.firstFret, x: home.x, time: home.time };
    }

    function position(span) {
        return Number.isFinite(span.firstFret) ? span.firstFret : span.x;
    }

    function outside(value, a, b) {
        return value < Math.min(a, b) - 1e-8 || value > Math.max(a, b) + 1e-8;
    }

    function compileTravel(spans, route, resets) {
        const size = route.length, spike = new Uint8Array(size);
        const segmentStart = new Int32Array(size);
        for (let index = 0, start = 0; index < size; index++) {
            if (resets[index] >= 0) start = resets[index];
            segmentStart[index] = start;
        }
        // A single peak interrupting an otherwise continuing local direction
        // is not the end of that run. This decision uses original neighbours,
        // never the current threshold's surviving destinations.
        for (let i = 2; i + 2 < size; i++) {
            if (segmentStart[i + 2] > i - 2) continue;
            const p = position(spans[route[i - 2]]), a = position(spans[route[i - 1]]);
            const x = position(spans[route[i]]), b = position(spans[route[i + 1]]);
            const q = position(spans[route[i + 2]]), direction = Math.sign(b - a);
            if (direction && Math.sign(a - p) === direction && Math.sign(q - b) === direction
                && outside(x, a, b)) spike[i] = 1;
        }
        // Do not delete those peaks while recognizing other runs: doing so
        // could invent a new progression across the end of a genuine riff.
        const spine = Array.from({ length: size }, (_, i) => i);
        const protectedRoute = new Uint8Array(size), marks = new Int32Array(size + 1);
        const progressiveStart = new Int32Array(size).fill(-1);
        const peaks = [], troughs = [];
        let direction = 0, steps = 0, latest = -1, previousSpine = -1;
        const mark = (start, end) => { marks[start]++; marks[end + 1]--; };
        const turnDirection = turns => {
            if (turns.length < 3) return 0;
            const a = turns[turns.length - 3], b = turns[turns.length - 2], c = turns[turns.length - 1];
            const left = Math.sign(b.value - a.value), right = Math.sign(c.value - b.value);
            return left && left === right ? left : 0;
        };
        for (let k = 1; k < spine.length; k++) {
            const at = spine[k], before = spine[k - 1];
            if (resets[at] >= 0) {
                direction = steps = 0; latest = -1; peaks.length = troughs.length = 0;
                if (resets[at] === at) {
                    progressiveStart[at] = -1; previousSpine = at;
                    continue;
                }
            }
            for (let i = previousSpine + 1; i < at; i++) progressiveStart[i] = latest;
            const value = position(spans[route[at]]), previous = position(spans[route[before]]);
            const nextDirection = Math.sign(value - previous);
            steps = nextDirection && nextDirection === direction ? steps + 1 : nextDirection ? 1 : 0;
            if (steps >= 3) {
                const start = spine[k - 3];
                mark(start, at); latest = Math.max(latest, start);
            }
            if (nextDirection && direction && nextDirection !== direction) {
                const turns = direction > 0 ? peaks : troughs;
                turns.push({ index: before, value: previous });
                if (turns.length > 3) turns.shift();
                if (turnDirection(turns)) latest = Math.max(latest, turns[0].index);
                // A staircase advances both its highs and lows. Rising replies
                // around one fixed home are not a travelling staircase.
                const highDirection = turnDirection(peaks), lowDirection = turnDirection(troughs);
                if (highDirection && highDirection === lowDirection) {
                    mark(Math.min(peaks[0].index, troughs[0].index), before);
                }
            }
            progressiveStart[at] = latest;
            previousSpine = at; direction = nextDirection;
        }
        for (let i = previousSpine + 1; i < size; i++) progressiveStart[i] = latest;
        let active = 0;
        for (let i = 0; i < size; i++) {
            active += marks[i];
            protectedRoute[i] = active > 0 && !spike[i] ? 1 : 0;
        }
        return { spike, protectedRoute, progressiveStart, segmentStart };
    }

    function hwyCompileCameraEvidence(regions, { context = null } = {}) {
        context = context || {};
        const spans = coalesceCameraSpans(regions), candidates = [], patterns = [];
        const variations = collectRiffVariationEvidence(spans, context), route = [];
        for (let i = 0; i < spans.length; i++) {
            if (!variations.has(i)) route.push(i);
            else candidates.push({ kind: 'riff-variation', reason: 'proven-note-variation',
                indices: [i], homeIndex: i - 1, requiredDuration: -Infinity,
                interval: variations.get(i), patternId: null });
        }
        const musicalBreaks = compileMusicalBreaks(context);
        const {segments, resets, sharedHomes, segmentTimes} = compileBreakOwnership(spans, route, musicalBreaks);
        const count = route.length, travel = compileTravel(spans, route, resets);
        const nextSame = new Int32Array(count).fill(-1), seen = new Map();
        for (let i = count - 1; i >= 0; i--) {
            if (i + 1 < count && segments[i] !== segments[i + 1]) {
                seen.clear();
                // A straddling home may finish a real pre-break return as
                // well as begin the next passage, without lending later
                // destinations back across the break.
                if (sharedHomes[i + 1]) seen.set(spans[route[i + 1]].base, i + 1);
            }
            const base = spans[route[i]].base;
            nextSame[i] = seen.get(base) ?? -1; seen.set(base, i);
        }
        const cycleMax = new Float64Array(count), cycleBlocked = new Uint8Array(count);
        // Consecutive first-return intervals of each physical fret are disjoint:
        // these exact comparisons/interval scans cost O(rows * fret vocabulary).
        for (let i = 0; i < count; i++) {
            const end = nextSame[i], home = spans[route[i]];
            if (end <= i + 1) continue;
            if (end !== i + 2 && (!Number.isInteger(home.firstFret)
                || home.firstFret < 0 || home.firstFret > NFRETS)) {
                cycleBlocked[i] = 1; continue;
            }
            for (let j = i + 1; j < end; j++) {
                cycleMax[i] = Math.max(cycleMax[i], spans[route[j]].duration);
                if (travel.protectedRoute[j]) cycleBlocked[i] = 1;
            }
        }
        const repeated = new Uint8Array(count), proofEnd = new Int32Array(count).fill(-1);
        const localProofEnd = new Int32Array(count).fill(-1);
        const required = new Float64Array(count); required.fill(Infinity);
        const proofStart = new Int32Array(count).fill(-1);
        for (let i = 0; i < count; i++) {
            const middle = nextSame[i], end = middle >= 0 ? nextSame[middle] : -1;
            if (middle <= i + 1 || end <= middle + 1 || middle - i !== end - middle
                || segments[i] !== segments[middle]
                || cycleBlocked[i] || cycleBlocked[middle]
                || travel.progressiveStart[end] >= i) continue;
            let same = true;
            for (let j = 1; same && j < middle - i; j++)
                same = spans[route[i + j]].base === spans[route[middle + j]].base;
            if (!same) continue;
            localProofEnd[i] = end;
            const duration = Math.max(cycleMax[i], cycleMax[middle]);
            for (const start of [i, middle]) {
                repeated[start] = 1;
                if (duration < required[start]) {
                    required[start] = duration; proofStart[start] = i; proofEnd[start] = end;
                }
            }
        }
        const hasReturn = i => i >= 0 && nextSame[i] > i + 1 && !cycleBlocked[i]
            && (nextSame[i] === i + 2 || repeated[i]);
        const sectionHomes = new Set();
        const sections = [...new Set((context.sections || []).map(s => s?.time)
            .filter(Number.isFinite))].sort((a, b) => a - b);
        let section = 0;
        for (let i = 0; i < count; i++) {
            while (section < sections.length && sections[section] < spans[route[i]].time - 1e-6) section++;
            if (Math.abs(sections[section] - spans[route[i]].time) <= 1e-6 && hasReturn(i)
                && nextSame[i] > i + 2
                && spans[route[nextSame[i]]].time < (sections[section + 1] ?? Infinity) - 1e-6) sectionHomes.add(i);
        }
        const nextSectionHome = new Int32Array(count);
        let sectionHome = count;
        for (let i = count - 1; i >= 0; i--) {
            nextSectionHome[i] = sectionHome;
            if (sectionHomes.has(i)) sectionHome = i;
        }
        const takeover = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
            if (!hasReturn(i)) continue;
            // A new local home must complete two matching cycles before the
            // old home returns. A nested one-off reply cannot steal its riff.
            for (let j = i + 1; j < nextSame[i]; j++) {
                if (localProofEnd[j] >= 0 && localProofEnd[j] < nextSame[i]) {
                    takeover[i] = 1; break;
                }
            }
        }
        // A repeated outer route can begin on an occasional reply rather than
        // its recurring home. Change ownership only when both complete proof
        // cycles independently identify the same unambiguous home. Cache each
        // first-return vote and proof pair: their intervals are disjoint per
        // fret (pairs overlap at most twice), so this remains O(rows * frets).
        const cycleVotes = new Map(), pairHomes = new Map(), promotedHomes = new Map();
        const visitStart = new Int32Array(count);
        for (let at = 0; at < count; at++) visitStart[at] = at > 0
            && segments[at] === segments[at - 1] && spans[route[at]].base === spans[route[at - 1]].base
            ? visitStart[at - 1] : at;
        const voteStartTime = start => Math.max(spans[route[visitStart[start]]].time, segmentTimes[start]);
        const voteForHome = start => {
            if (cycleVotes.has(start)) return cycleVotes.get(start);
            const end = nextSame[start], votes = new Map();
            let total = 0, previous = null, valid = true;
            // A proof can start at the last alias left by a removed variation.
            // Include that whole initial semantic visit, not only its suffix.
            for (let at = visitStart[start]; at < end; at++) {
                const span = spans[route[at]], time = at === visitStart[start] ? voteStartTime(start) : span.time;
                // A coalesced home may straddle a verified musical break. Its
                // old time still owns the old run endpoint, but the new vote
                // must not borrow any pre-resume dwell.
                const dwell = spans[route[at + 1]].time - time;
                if (!Number.isFinite(dwell) || dwell < 0) { valid = false; break; }
                const vote = votes.get(span.base) || { visits: 0, dwell: 0 };
                // Removing a proven note variation can leave adjacent equal
                // homes. It is still one visit, and its removed duration stays
                // with that home rather than disappearing from the vote.
                if (span.base !== previous) vote.visits++;
                vote.dwell += dwell; total += dwell;
                votes.set(span.base, vote); previous = span.base;
            }
            let winner = null;
            if (valid && total > 0) {
                let visits = 0, tied = false;
                for (const [base, vote] of votes) {
                    if (vote.visits > visits) { winner = base; visits = vote.visits; tied = false; }
                    else if (vote.visits === visits) tied = true;
                }
                if (tied || votes.get(winner).dwell <= total - votes.get(winner).dwell + 1e-9) winner = null;
            }
            cycleVotes.set(start, winner);
            return winner;
        };
        const homeForPair = start => {
            if (pairHomes.has(start)) return pairHomes.get(start);
            const middle = nextSame[start], end = localProofEnd[start];
            let home = voteForHome(start);
            if (!home || home === spans[route[start]].base || home !== voteForHome(middle)) home = null;
            // Check the UNION of the two cycles, including a return across
            // their middle boundary. Every completed return of the proposed
            // home must already qualify; dropping a coherent parent cannot
            // expose an unproven multi-lane reply. An incomplete final tail
            // contributes neither proof nor a veto and must earn any later
            // continuation through the ordinary return rules.
            for (let at = start; home && at < end; at++) {
                if (spans[route[at]].base !== home) continue;
                const back = nextSame[at];
                if (back === at + 1 || back > end || back < 0) continue;
                if (!hasReturn(at) || takeover[at] || back > nextSectionHome[at]) home = null;
            }
            pairHomes.set(start, home);
            return home;
        };
        for (let i = 0; i < count; i++) {
            if (takeover[i] || !repeated[i] || nextSame[i] <= i + 2
                || nextSame[i] > nextSectionHome[i]) continue;
            const start = proofStart[i], end = proofEnd[i], home = homeForPair(start);
            if (!home) continue;
            for (let at = i + 1; at < nextSame[i]; at++) {
                if (spans[route[at]].base !== home || !hasReturn(at) || takeover[at]
                    || nextSame[at] >= nextSame[i] || nextSame[at] > nextSectionHome[at]) continue;
                // Store the actual winner, not just a skipped parent. Otherwise
                // an earlier eligible reply could accidentally win the scan.
                promotedHomes.set(i, { start: at, previousHomeIndex: route[i],
                    interval: { start: voteStartTime(start), end: spans[route[end]].time } });
                break;
            }
        }
        const owned = new Uint8Array(count);
        for (let i = 0; i < count;) {
            const promotion = promotedHomes.get(i);
            if (promotion) i = promotion.start;
            if (!hasReturn(i) || takeover[i] || nextSame[i] > nextSectionHome[i]) { i++; continue; }
            const first = i, length = nextSame[i] - i, single = length === 2;
            const homeIndex = route[first], home = describeHome(spans[homeIndex]);
            const pattern = { id: patterns.length, kind: single ? 'single-return' : 'repeated-cycle',
                homeIndex, home, startIndex: homeIndex, endIndex: homeIndex,
                start: spans[homeIndex].time, end: spans[homeIndex].time, cycles: [],
                proofStart: spans[route[single ? first : proofStart[first]]].time,
                proofEnd: spans[route[single ? nextSame[first] : proofEnd[first]]].time };
            if (promotion) pattern.homeSelection = { reason: 'recurring-majority-home',
                previousHomeIndex: promotion.previousHomeIndex, homeIndex,
                interval: promotion.interval };
            while (hasReturn(i) && segments[i] === segments[first]
                && !takeover[i] && !promotedHomes.has(i) && nextSame[i] <= nextSectionHome[i]) {
                const end = nextSame[i];
                if (end - i !== length) break;
                let same = true;
                if (!single) for (let j = 1; same && j < length; j++)
                    same = spans[route[first + j]].base === spans[route[i + j]].base;
                if (!same) break;
                const cycle = { startIndex: route[i], endIndex: route[end],
                    start: spans[route[i]].time, end: spans[route[end]].time,
                    maxAwayDuration: cycleMax[i], requiredDuration: single ? cycleMax[i] : required[i] };
                pattern.cycles.push(cycle);
                const indices = [];
                for (let j = i; j <= end; j++) {
                    owned[j] = 1;
                    if (j > i && j < end) indices.push(route[j]);
                }
                candidates.push({ kind: 'ignored-excursion', reason: pattern.kind,
                    indices, homeIndex, requiredDuration: cycle.requiredDuration,
                    // Cite this cycle's threshold proof, which may differ from
                    // the pair that first established the enclosing pattern.
                    interval: { start: spans[route[single ? i : proofStart[i]]].time,
                        end: spans[route[single ? end : proofEnd[i]]].time },
                    patternId: pattern.id, cycleIndex: pattern.cycles.length - 1 });
                i = end;
                pattern.endIndex = route[end]; pattern.end = spans[route[end]].time;
            }
            patterns.push(pattern);
            if (i === first) i++;
        }
        const uncertainReturn = new Int32Array(count + 1);
        for (let i = 0; i < count; i++) {
            if (nextSame[i] <= i + 2 || repeated[i]) continue;
            uncertainReturn[i]++; uncertainReturn[nextSame[i] + 1]--;
        }
        // Generic spike candidates use a fixed local route. Claimed homes,
        // genuine progression and its turning points cannot become spikes.
        // Reserve both neighbours so adjacent extrema never erase each other.
        const reserved = new Uint8Array(count);
        let uncertainty = uncertainReturn[0];
        for (let i = 1; i + 1 < count; i++) {
            uncertainty += uncertainReturn[i];
            if (owned[i] || reserved[i] || travel.protectedRoute[i] || uncertainty > 0
                || travel.segmentStart[i + 1] > i - 1) continue;
            const a = spans[route[i - 1]], x = spans[route[i]], b = spans[route[i + 1]];
            if (a.base === b.base || !outside(position(x), position(a), position(b))) continue;
            // The next step already reaches past this turn: it can be the
            // opening of an advancing zigzag, not an isolated excursion.
            if (!travel.spike[i] && i + 2 < count && travel.segmentStart[i + 2] <= i - 1) {
                const turn = position(x) - position(b), following = position(spans[route[i + 2]]) - position(b);
                if (turn * following > 0 && Math.abs(following) >= Math.abs(turn)) {
                    reserved[i] = reserved[i + 1] = 1;
                    continue;
                }
            }
            // A neighbouring outlier would make the proposed home/target
            // ambiguous. The continuing-trend prepass is positive evidence.
            if (!travel.spike[i] && ((i > 1 && travel.segmentStart[i + 1] <= i - 2 && !owned[i - 1]
                && outside(position(a), position(spans[route[i - 2]]), position(b)))
                || (i + 2 < count && travel.segmentStart[i + 2] <= i - 1 && !owned[i + 1]
                    && outside(position(b), position(a), position(spans[route[i + 2]]))))) continue;
            candidates.push({ kind: 'ignored-overshoot', reason: 'isolated-off-route-spike',
                indices: [route[i]], homeIndex: route[i - 1], requiredDuration: x.duration,
                interval: { start: a.time, end: b.time }, patternId: null });
            reserved[i - 1] = reserved[i + 1] = 1;
        }
        const protectedIndices = [];
        for (let i = 0; i < count; i++) if (travel.protectedRoute[i]) protectedIndices.push(route[i]);
        return { spans, patterns, candidates, protectedIndices, musicalBreaks };
    }

    // Reattach a compiled chart's decisions to a new view of the same ordered
    // musical rows. Coalescing refreshes bounds and the initial preferred centre
    // through same-base extensions; it does not inspect notes or classify routes.
    // Callers must compile again when the musical rows or note evidence change.
    function hwyProjectCameraEvidence(evidence, regions) {
        const spans = coalesceCameraSpans(regions);
        return { ...evidence, spans, patterns: evidence.patterns.map(pattern => ({
            ...pattern, home: describeHome(spans[pattern.homeIndex]),
        })) };
    }

    function hwyApplyCameraThreshold(evidence, { excursionThreshold = 500 } = {}) {
        const brief = thresholdSeconds(excursionThreshold);
        const timeline = evidence.spans.map(span => {
            // Equality remains lasting; the epsilon only compensates source
            // timestamp subtraction roundoff, in original song seconds.
            const lasting = span.duration > 0 && span.duration >= brief - 1e-9;
            return { ...span, lasting, kind: lasting ? 'lasting' : 'transit', cameraX: span.x,
                explanation: { decision: 'follow', reason: lasting ? 'lasting-lane' : 'short-waypoint',
                    home: null, interval: { start: span.time, end: span.end } } };
        });
        const patterns = evidence.patterns.map(pattern => ({ ...pattern, activeCycles: [], held: false }));
        for (const index of evidence.protectedIndices)
            timeline[index].explanation.reason = 'progressive-run';
        for (const candidate of evidence.candidates) {
            if (!(candidate.requiredDuration < brief - 1e-9)) continue;
            const home = timeline[candidate.homeIndex];
            const explanation = { decision: 'hold', reason: candidate.reason,
                home: describeHome(home), interval: candidate.interval };
            for (const index of candidate.indices) {
                const span = timeline[index];
                span.kind = candidate.kind; span.lasting = false;
                span.homeX = span.cameraX = home.x; span.explanation = explanation;
            }
            if (candidate.patternId !== null) {
                const pattern = patterns[candidate.patternId], cycle = pattern.cycles[candidate.cycleIndex];
                pattern.activeCycles.push(cycle);
                for (const index of [cycle.startIndex, cycle.endIndex]) {
                    timeline[index].localHome = true;
                    timeline[index].explanation = { ...explanation, decision: 'follow', reason: 'return-home' };
                }
            }
        }
        for (const pattern of patterns) pattern.held = pattern.activeCycles.length === pattern.cycles.length;
        const stops = [];
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
        stops.evidence = evidence;
        stops.patterns = patterns;
        return stops;
    }

    function hwyBuildCameraTimeline(regions, options = {}) {
        return hwyApplyCameraThreshold(hwyCompileCameraEvidence(regions, options), options).timeline;
    }

    function hwyBuildCameraStops(regions, options = {}) {
        return hwyApplyCameraThreshold(hwyCompileCameraEvidence(regions, options), options);
    }

    return { hwyCameraRiffVariationCandidates, hwyCompileCameraEvidence, hwyProjectCameraEvidence, hwyApplyCameraThreshold,
        hwyBuildCameraTimeline, hwyBuildCameraStops };
}
