/**
 * Phrase composition for held tapping riffs and proven single-lane figures.
 * Compilation reads the chart once;
 * threshold edits only select already-proven areas. Playback samples the normal
 * camera path, including its normal entry/exit timing and movement policy.
 */
export function createCameraTapping({ NFRETS, isRenderableNote, isUnpitchedMute }) {
    const lowerBound = (rows, time) => {
        let low = 0, high = rows.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (rows[middle].time < time) low = middle + 1; else high = middle;
        }
        return low;
    };
    // Match the chart's anchor coincidence tolerance. Use the same shifted
    // boundary on both sides of each half-open cycle so an attack belongs to
    // exactly one cycle, even when its timestamp rounds just before the lane.
    // Stop sampling below stays exact; this only assigns chart evidence.
    const eventBoundary = (events, time) => lowerBound(events, time - 0.000501);

    // A tap closes a figure. Comparing adjacent figures is linear in attacks;
    // there is no arbitrary period search or per-frame chart work. A figure
    // must repeat before it can own any camera interval.
    function compileSingleLaneAreas(evidence, events, sections, beats, protectedSpans) {
        const areas = [];
        const sectionRows = [...new Set(sections.map(row => row?.time).filter(Number.isFinite))]
            .sort((a, b) => a - b).map(time => ({ time }));
        const beatRows = beats.filter(row => Number.isFinite(row?.time)).slice().sort((a, b) => a.time - b.time);
        const rounding = .000501 * 2;
        const pitchKey = note => `${note.string}/${note.fret}`;
        for (const span of evidence.spans || []) {
            if (!(span.lastFret - span.firstFret > 3) || protectedSpans.has(span.sourceIndex)) continue;
            const boundaries = [span.time];
            for (let index = lowerBound(sectionRows, span.time); index < sectionRows.length
                && sectionRows[index].time < span.end; index++) {
                if (sectionRows[index].time > span.time) boundaries.push(sectionRows[index].time);
            }
            boundaries.push(span.end);
            for (let part = 0; part + 1 < boundaries.length; part++) {
                const start = boundaries[part], end = boundaries[part + 1];
                const first = eventBoundary(events, start), last = eventBoundary(events, end), units = [];
                let begin = first;
                for (let cursor = first; cursor < last; cursor++) {
                    if (!events[cursor].hasTap) continue;
                    const unit = { first: begin, last: cursor + 1, firstFret: Infinity, lastFret: -Infinity,
                        maxGap: 0, pitches: new Set(), signature: '' };
                    const shape = [];
                    for (let index = begin; index <= cursor; index++) {
                        const event = events[index];
                        shape.push(event.shape);
                        unit.firstFret = Math.min(unit.firstFret, event.firstFret);
                        unit.lastFret = Math.max(unit.lastFret, event.lastFret);
                        if (index > begin) unit.maxGap = Math.max(unit.maxGap, event.time - events[index - 1].time);
                        event.shape.forEach(note => unit.pitches.add(pitchKey(note)));
                    }
                    unit.signature = JSON.stringify(shape);
                    unit.valid = unit.last - unit.first >= 2 && unit.lastFret - unit.firstFret > 3
                        && unit.firstFret >= span.firstFret && unit.lastFret <= span.lastFret;
                    units.push(unit); begin = cursor + 1;
                }
                const same = (a, b) => a.valid && b.valid && a.signature === b.signature
                    && events[b.first].time - events[a.last - 1].time <= Math.max(a.maxGap, b.maxGap) + rounding;
                const groups = [];
                for (let index = 0; index < units.length;) {
                    const initial = index;
                    while (index + 1 < units.length && same(units[index], units[index + 1])) index++;
                    if (index > initial) {
                        const firstUnit = units[initial], lastUnit = units[index];
                        let tail = lastUnit.last, offset = 0;
                        // The final partial return belongs to the proven figure,
                        // but a new ordinary attack ends its ownership exactly.
                        while (tail < last && offset < lastUnit.last - lastUnit.first
                            && events[tail].key === events[lastUnit.first + offset].key
                            && events[tail].time - events[tail - 1].time <= lastUnit.maxGap + rounding) {
                            tail++; offset++;
                        }
                        groups.push({ firstUnit: initial, lastUnit: index, first: firstUnit.first, last: tail,
                            firstFret: firstUnit.firstFret, lastFret: firstUnit.lastFret,
                            signatures: [firstUnit.signature] });
                    }
                    index++;
                }
                const joined = [];
                for (const group of groups) {
                    const previous = joined[joined.length - 1];
                    let merge = !!previous && group.firstUnit - previous.lastUnit <= 2;
                    if (merge) {
                        const a = units[previous.lastUnit], b = units[group.firstUnit];
                        const maxGap = Math.max(a.maxGap, b.maxGap) + rounding;
                        // At most one connecting tapped figure may bridge two
                        // proven variants. It can change legato technique, but
                        // every string/fret must already occur in either proof,
                        // and its cadence cannot be slower than those proofs.
                        for (let index = a.last; merge && index <= b.first; index++) {
                            merge = events[index].time - events[index - 1].time <= maxGap;
                            if (index < b.first) merge &&= events[index].shape.every(note =>
                                a.pitches.has(pitchKey(note)) || b.pitches.has(pitchKey(note)));
                        }
                    }
                    if (merge) {
                        previous.last = group.last; previous.lastUnit = group.lastUnit;
                        previous.firstFret = Math.min(previous.firstFret, group.firstFret);
                        previous.lastFret = Math.max(previous.lastFret, group.lastFret);
                        previous.signatures.push(...group.signatures);
                    } else joined.push({ ...group });
                }
                for (const group of joined) {
                    const areaStart = Math.max(start, events[group.first].time);
                    let areaEnd = group.last < last ? Math.min(end, events[group.last].time) : end;
                    if (!Number.isFinite(areaEnd)) {
                        const final = events[group.last - 1];
                        areaEnd = final.time;
                        for (let index = group.first; index < group.last; index++) areaEnd = Math.max(areaEnd, events[index].end);
                        const nextBeat = beatRows[lowerBound(beatRows, final.time + rounding)];
                        if (nextBeat) areaEnd = Math.max(areaEnd, nextBeat.time);
                    }
                    if (!(areaEnd > areaStart)) continue;
                    areas.push({ id: `single/${span.sourceIndex}/${group.first}`, kind: 'single-lane',
                        startIndex: span.sourceIndex, endIndex: span.sourceIndex, sourceBase: span.base,
                        start: areaStart, end: areaEnd, firstFret: group.firstFret, lastFret: group.lastFret,
                        signatures: group.signatures, cycles: [] });
                }
            }
        }
        return areas;
    }

    function hwyCompileTappingAreas(evidence, { notes = [], chords = [], stringCount = 6, sections = [], beats = [] } = {}) {
        const spans = evidence?.spans || [], patterns = evidence?.patterns || [];
        if (!spans.length) return [];
        const protectedSpans = new Set(evidence.protectedIndices || []);
        const hasSingleLaneCandidate = spans.some(span => span.lastFret - span.firstFret > 3
            && !protectedSpans.has(span.sourceIndex));
        // Ordinary charts retain the old cheap exit: do not collect, inspect,
        // or sort attacks when neither kind of tapping area can exist.
        if (!patterns.length && !hasSingleLaneCandidate) return [];
        const count = Number.isInteger(stringCount) && stringCount > 0 ? stringCount : 6;
        const events = [];
        // Only attacks with a meaningful fret position participate in tapping
        // evidence. Open/unpitched-only attacks cannot prove or widen an area
        // or interrupt its matching final return; pitched palm mutes still count.
        const valid = note => note && Number.isInteger(note.s) && note.s >= 0 && note.s < count
            && Number.isFinite(note.f) && note.f > 0 && note.f <= NFRETS
            && isRenderableNote(note) && !isUnpitchedMute(note);
        const add = (time, members) => {
            if (!Number.isFinite(time)) return;
            const fretted = members.filter(valid);
            if (!fretted.length) return;
            const shape = fretted.map(note => ({
                string: note.s, fret: note.f, tap: !!(note.tp || note.tap),
                hammer: !!note.ho, pull: !!note.po,
            })).sort((a, b) => a.string - b.string || a.fret - b.fret);
            events.push({ time, end: time + Math.max(0, ...fretted.map(note =>
                Number.isFinite(Number(note.sus)) ? Number(note.sus) : 0)),
                shape, key: JSON.stringify(shape), hasTap: shape.some(note => note.tap),
                firstFret: Math.min(...shape.map(note => note.fret)),
                lastFret: Math.max(...shape.map(note => note.fret)) });
        };
        for (const note of notes) add(note?.t, [note]);
        for (const chord of chords) if (chord && !chord.h3dSynth) add(chord.t, chord.notes || []);
        events.sort((a, b) => a.time - b.time || a.firstFret - b.firstFret);

        const areas = [];
        for (const pattern of patterns) {
            let group = null;
            const finish = () => {
                if (group && group.cycles.length >= 2) {
                    const endIndex = group.cycles[group.cycles.length - 1].endIndex;
                    // Include the final return's dwell, but never the next
                    // relocation. This avoids a gratuitous visit to the old
                    // four-fret home between the area and its successor.
                    group.endIndex = endIndex;
                    const home = spans[endIndex];
                    let tailEnd = home?.time;
                    let cursor = eventBoundary(events, home?.time ?? Infinity);
                    const last = eventBoundary(events, home?.end ?? Infinity);
                    const shape = JSON.parse(group.signature);
                    for (let offset = 0; offset < shape.length && cursor < events.length
                        && cursor < last; offset++, cursor++) {
                        if (JSON.stringify(events[cursor].shape) !== JSON.stringify(shape[offset])) break;
                        // A next attack owned by the relocation ends this dwell
                        // at its lane boundary, without a rounding-sized stop.
                        tailEnd = cursor + 1 < last
                            ? Math.max(home.time, events[cursor + 1].time) : home.end;
                    }
                    group.end = tailEnd;
                    if (group.end > group.start) areas.push(group);
                }
                group = null;
            };
            for (const cycle of pattern.cycles || []) {
                const start = spans[cycle.startIndex]?.time, end = spans[cycle.endIndex]?.time;
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { finish(); continue; }
                const first = eventBoundary(events, start), last = eventBoundary(events, end);
                let firstFret = Infinity, lastFret = -Infinity, hasTap = false;
                const signature = [];
                for (let index = first; index < last; index++) {
                    const event = events[index];
                    firstFret = Math.min(firstFret, event.firstFret);
                    lastFret = Math.max(lastFret, event.lastFret);
                    hasTap ||= event.hasTap;
                    signature.push(event.shape);
                }
                const key = JSON.stringify(signature);
                if (!hasTap || last - first < 2 || !(lastFret > firstFret)) { finish(); continue; }
                if (group && (group.signature !== key
                    || group.cycles[group.cycles.length - 1].endIndex !== cycle.startIndex)) finish();
                if (!group) group = {
                    id: `${pattern.id}/${cycle.startIndex}`, patternId: pattern.id,
                    startIndex: cycle.startIndex, start, firstFret, lastFret, signature: key, cycles: [],
                };
                group.cycles.push(cycle);
            }
            finish();
        }
        // Ownership is established by the semantic plan. A shared return may
        // end one area and begin another; its new pattern wins that boundary.
        areas.sort((a, b) => a.start - b.start || a.end - b.end);
        for (let index = 0; index + 1 < areas.length; index++) {
            if (areas[index].end > areas[index + 1].start) areas[index].end = areas[index + 1].start;
        }
        // Existing multi-lane evidence keeps ownership even when the current
        // threshold does not activate it. This extension cannot change that
        // established threshold policy or progressively travelling lanes.
        const singleAreas = [], multiLaneAreas = areas.length;
        let existingIndex = 0;
        const candidates = hasSingleLaneCandidate
            ? compileSingleLaneAreas(evidence, events, sections, beats, protectedSpans) : [];
        for (const area of candidates) {
            while (existingIndex < multiLaneAreas && areas[existingIndex].end <= area.start) existingIndex++;
            if (existingIndex >= multiLaneAreas || areas[existingIndex].start >= area.end) singleAreas.push(area);
        }
        areas.push(...singleAreas);
        areas.sort((a, b) => a.start - b.start || a.end - b.end);
        return areas;
    }

    function hwyApplyTappingAreas(stops, areas, { xFret }) {
        if (!stops.length || !areas?.length) return stops;
        const patterns = new Map((stops.patterns || []).map(pattern => [pattern.id,
            new Set((pattern.activeCycles || []).map(cycle => `${cycle.startIndex}/${cycle.endIndex}`))]));
        const active = [];
        for (const area of areas) {
            if (area.kind === 'single-lane') {
                const host = stops.timeline?.[area.startIndex];
                if (!host || host.base !== area.sourceBase || host.explanation?.decision === 'hold'
                    || host.explanation?.reason === 'return-home') continue;
            } else {
                const cycles = patterns.get(area.patternId);
                if (!cycles) continue;
                if (!area.cycles.every(cycle => cycles.has(`${cycle.startIndex}/${cycle.endIndex}`))) continue;
            }
            const left = xFret(area.firstFret - 1), right = xFret(area.lastFret);
            if (!Number.isFinite(left) || !Number.isFinite(right) || !(area.end > area.start)) continue;
            active.push({ ...area, x: (left + right) / 2, minX: Math.min(left, right), maxX: Math.max(left, right) });
        }
        if (!active.length) return stops;
        const at = time => {
            let index = lowerBound(stops, time);
            if (stops[index]?.time !== time) index--;
            return stops[Math.max(0, index)];
        };
        const events = [];
        let areaIndex = 0;
        for (const stop of stops) {
            while (areaIndex < active.length && active[areaIndex].end <= stop.time) areaIndex++;
            const area = active[areaIndex];
            if (!area || stop.time < area.start) events.push({ stop, priority: 0 });
        }
        for (const area of active) {
            const original = at(area.start);
            const focus = {
                ...original, time: area.start, end: area.end, duration: area.end - area.start,
                base: `tapping/${area.id}`, x: area.x, preferred: area.x, cameraX: area.x,
                minX: area.minX, maxX: area.maxX, firstFret: area.firstFret, lastFret: area.lastFret,
                kind: 'tapping-area', reason: 'tapping-area', localHome: true, focusArea: area,
                explanation: { decision: 'hold', reason: 'tapping-area', home: null,
                    firstFret: area.firstFret, lastFret: area.lastFret,
                    interval: { start: area.start, end: area.end } },
            };
            events.push({ stop: focus, priority: 2 });
            if (Number.isFinite(area.end)) {
                const originalEnd = at(area.end);
                events.push({ stop: { ...originalEnd, time: area.end }, priority: 1 });
            }
        }
        events.sort((a, b) => a.stop.time - b.stop.time || a.priority - b.priority);
        const output = [];
        for (const event of events) {
            const previous = output[output.length - 1];
            if (previous?.time === event.stop.time) output.pop();
            output.push({ ...event.stop });
        }
        for (let index = 0; index < output.length; index++) {
            output[index].end = output[index + 1]?.time ?? Infinity;
            output[index].duration = output[index].end - output[index].time;
        }
        // Keep the source classifications for diagnostics. Split only at area
        // boundaries so a binary search can select its explanation per frame.
        const timeline = [];
        areaIndex = 0;
        for (const span of stops.timeline || []) {
            let time = span.time;
            while (time < span.end) {
                while (areaIndex < active.length && active[areaIndex].end <= time) areaIndex++;
                const area = active[areaIndex];
                const inside = area && area.start <= time && time < area.end;
                const end = Math.min(span.end, area ? inside ? area.end : area.start : Infinity);
                if (!(end > time)) break;
                timeline.push({ ...span, time, end, duration: end - time,
                    ...(inside ? { cameraX: area.x, focusArea: area,
                        explanation: { decision: 'hold', reason: 'tapping-area', home: null,
                            firstFret: area.firstFret, lastFret: area.lastFret,
                            interval: { start: area.start, end: area.end } } } : {}) });
                time = end;
            }
        }
        output.timeline = timeline;
        output.evidence = stops.evidence;
        output.patterns = stops.patterns;
        output.tappingAreas = active;
        return output;
    }
    return { hwyCompileTappingAreas, hwyApplyTappingAreas };
}
