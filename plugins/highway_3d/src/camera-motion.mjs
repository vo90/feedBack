/** Cached stable-camera scheduling and numerical motion helpers.
 * Chart predicates are the only outside dependencies. All timing inputs keep
 * their legacy units: stop times are song seconds; controls use real ms.
 * Camera paths are rebuilt on input changes, then sampled without chart scans.
 */
export function createCameraMotion({ isRenderableNote, isUnpitchedMute }) {
    if (typeof isRenderableNote !== 'function' || typeof isUnpitchedMute !== 'function') {
        throw new TypeError('Camera motion requires renderable-note and unpitched-mute predicates');
    }
    const normalizePreparation = value => value == null || !Number.isFinite(Number(value))
        ? null : Math.max(25, Math.min(3000, Number(value)));
    const directStartBefore = value => Math.max(25, Math.min(3000,
        value != null && Number.isFinite(Number(value)) ? Number(value) : 700));
    const directArriveAfter = value => Math.max(0, Math.min(3000,
        value != null && Number.isFinite(Number(value)) ? Number(value) : 0));
    // Attack/technique timing depends on the chart, not camera rate or framing.
    // Keep this index reusable when only the composition plan changes.
    function hwyBuildCameraAttackIndex(notes, chords, stringCount = 6) {
        const eps = 0.000501, events = [];
        const expressive = n => ['bn', 'bnv', 'vb', 'v', 'vibrato', 'vibrato_marks', 'tr', 'whammy', 'hm', 'hp',
            'harmonic_target', 'harmonic_changes', 'ho', 'po', 'ln', 'mt', 'fhm',
            'slide_in_marks', 'pick_scrape_marks']
            .some(k => Array.isArray(n[k]) ? n[k].length > 0 : !!n[k])
            || ['sl', 'slu', 'su'].some(k => Number.isFinite(n[k]) && n[k] >= 0);
        const valid = n => n && Number.isInteger(n.s) && n.s >= 0 && n.s < stringCount
            && isRenderableNote(n);
        // A directional slide-out is a finishing gesture, not a new target.
        // Known fret-target slides and other active techniques still need focus.
        const add = (time, members) => {
            if (!Number.isFinite(time)) return;
            members = members.filter(valid);
            if (!members.length) return;
            const end = n => time + Math.max(0, Number(n.sus) || 0);
            events.push({ time, members, end });
        };
        for (const n of notes || []) add(n?.t, [n]);
        for (const c of chords || []) if (c && !c.h3dSynth) add(c.t, c.notes || []);
        events.sort((a, b) => a.time - b.time);
        // Written tails can overlap their replacement on the same string.
        // Only that string's next attack ends its earlier focus constraint.
        const nextByString = new Float64Array(stringCount); nextByString.fill(Infinity);
        for (let i = events.length - 1; i >= 0;) {
            let first = i;
            while (first > 0 && events[i].time - events[first - 1].time <= eps) first--;
            for (let j = first; j <= i; j++) {
                const event = events[j];
                const end = n => Math.min(event.end(n), nextByString[n.s]);
                event.busy = Math.max(-Infinity, ...event.members.filter(expressive).map(end));
            }
            for (let j = first; j <= i; j++) for (const n of events[j].members) nextByString[n.s] = events[j].time;
            i = first - 1;
        }
        const attacks = [];
        let busyUntil = -Infinity;
        for (const event of events) {
            busyUntil = Math.max(busyUntil, event.busy);
            let group = attacks[attacks.length - 1];
            if (!group || event.time - group.time > eps) {
                group = { time: event.time, busy: busyUntil, frets: 0 };
                attacks.push(group);
            }
            group.busy = busyUntil;
            for (const note of event.members) {
                if (note.f > 0 && !isUnpitchedMute(note)) group.frets |= 1 << note.f;
            }
        }
        return attacks;
    }

    /** Prepare during quiet sustains or silence after the preceding attack.
     * Built with the cached stop plan, never by scanning the song each frame.
     * The lane/notes remain authoritative; this changes only camera timing. */
    function hwyPrepareCameraStops(stops, notes, chords, rate, stringCount = 6, attacks = null) {
        if (stops.length < 2) return stops.map(stop => ({ ...stop, lead: 0.6 }));
        rate = Math.max(0.1, Math.min(4, Number(rate) || 1));
        const eps = 0.000501;
        if (attacks === null) attacks = hwyBuildCameraAttackIndex(notes, chords, stringCount);
        let index = 0;
        return stops.map(stop => {
            while (index < attacks.length && attacks[index].time < stop.time - eps) index++;
            const next = attacks[index], previous = attacks[index - 1];
            let lead = 0.6;
            // The interval since the last attack may contain ordinary holds,
            // slide-outs, silence, or a mixture across strings. Their visible
            // geometry remains protected by the existing camera fit. Only an
            // active significant technique can delay the extra preparation.
            if (next && Math.abs(next.time - stop.time) <= eps) {
                const start = Math.max(stop.time - 1.2 * rate,
                    previous ? previous.time + 0.3 * rate : 0,
                    previous?.busy ?? -Infinity);
                lead = Math.max(lead, Math.min(1.2, (stop.time - start) / rate));
            }
            return { ...stop, lead };
        });
    }

    // Timed Hermite segments share position, velocity and zero acceleration.
    // Lasting lanes are arrival constraints; short waypoints are traversed
    // without stopping. Bounded tangents prevent overshoot between waypoints.
    function hwyBuildCameraMotion(stops, rate, smoothing, departureDelay = 0, travelExtra = 0, settleLimit = 250, preparationMs = null, directTiming = null) {
        const segments = [], journeys = [];
        const manualPreparationMs = normalizePreparation(preparationMs);
        const base = 0.6 + Math.max(0, Math.min(1, smoothing)) * 0.2;
        let first = 0;
        while (first + 1 < stops.length) {
            let last = first + 1;
            while (last + 1 < stops.length && stops[last].lasting === false) last++;
            const from = stops[first], entry = stops[first + 1];
            const width = Math.max(1e-8, from.maxX - from.minX, entry.maxX - entry.minX);
            const extra = Math.min(0.4, Math.max(0, Math.abs(entry.x - from.x) / width - 1) * 0.8);
            const lead = manualPreparationMs === null
                ? Math.max(entry.lead || 0.6, base + extra) : manualPreparationMs / 1000;
            const start = Math.max(from.time, entry.time - lead * rate);
            const points = [{ time: start, x: from.x, velocity: 0 }];
            for (let i = first + 1; i <= last; i++) points.push({ time: stops[i].time, x: stops[i].x, velocity: 0 });
            for (let i = 1; i + 1 < points.length; i++) {
                const left = (points[i].x - points[i - 1].x) / Math.max(1e-9, points[i].time - points[i - 1].time);
                const right = (points[i + 1].x - points[i].x) / Math.max(1e-9, points[i + 1].time - points[i].time);
                if (left * right > 0) points[i].velocity = Math.sign(left) * Math.min(Math.abs(left), Math.abs(right));
            }
            const groupStart = segments.length;
            const transit = last !== first + 1 || from.lasting === false || entry.lasting === false;
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i];
                if (b.time > a.time) segments.push({ start: a.time, end: b.time,
                    nominalStart: a.time, nominalEnd: b.time, transit,
                    from: a.x, to: b.x, v0: a.velocity, v1: b.velocity, lasting: i === points.length - 1 });
            }
            for (let i = groupStart; i < segments.length; i++) segments[i].arrivalIndex = segments.length - 1;
            if (segments.length > groupStart) journeys.push({
                first: groupStart, last: segments.length - 1,
                fromStop: first, toStop: last, firstLaneTime: entry.time,
                preparationRequestedMs: lead * 1000,
                preparationReason: manualPreparationMs !== null ? 'manual'
                    : (entry.lead || 0.6) >= base + extra && (entry.lead || 0.6) > 0.6
                        ? 'quiet-passage' : extra > 0 ? 'large-move' : 'ordinary',
                preparationLimitReason: from.time > entry.time - lead * rate ? 'previous-lane' : 'none',
                waypointCount: segments.length - groupStart,
            });
            first = last;
        }
        const delay = Math.max(0, Math.min(1000, Number(departureDelay) || 0)) / 1000 * rate;
        const extraFraction = Math.max(0, Math.min(200, Number(travelExtra) || 0)) / 100;
        const lateLimit = Math.max(0, Math.min(3000, Number(settleLimit) || 0)) / 1000 * rate;
        // Retime complete journeys, including every short progressive waypoint.
        // Reserve extra travel before departure delay: increasing delay must
        // never take away an already granted slower pan. Both requests remain
        // bounded by settling and the next journey's original departure.
        for (const journey of journeys) {
            const firstSegment = segments[journey.first], lastSegment = segments[journey.last];
            const start = firstSegment.nominalStart, end = lastSegment.nominalEnd;
            const duration = end - start, requestedExtra = duration * extraFraction;
            const nextRoom = Math.max(0, (segments[journey.last + 1]?.nominalStart ?? Infinity) - end);
            const room = Math.min(lateLimit, nextRoom);
            const appliedExtra = Math.min(requestedExtra, room);
            const appliedDelay = Math.min(delay, Math.max(0, room - appliedExtra));
            const stretch = 1 + appliedExtra / duration;
            const limited = appliedDelay + appliedExtra < delay + requestedExtra - 1e-9;
            const budgetReason = nextRoom < lateLimit ? 'next-journey' : 'settling-limit';
            const timing = {
                requestedDelayMs: delay / rate * 1000, appliedDelayMs: appliedDelay / rate * 1000,
                requestedExtraMs: requestedExtra / rate * 1000, appliedExtraMs: appliedExtra / rate * 1000,
                limitingReason: limited ? budgetReason : 'none',
                extraLimitingReason: appliedExtra < requestedExtra - 1e-9 ? budgetReason : 'none',
                delayLimitingReason: appliedDelay < delay - 1e-9
                    ? appliedExtra > 0 && room - appliedExtra <= 1e-9 ? 'extra-travel-budget' : budgetReason
                    : 'none',
                nominalStart: start, start: start + appliedDelay,
                nominalEnd: end, end: end + appliedDelay + appliedExtra,
                // Leads refer to the first lane's original onset, not the
                // final destination or its permitted settling tail.
                firstLaneTime: journey.firstLaneTime,
                preparationReason: journey.preparationReason,
                preparationLimitReason: journey.preparationLimitReason,
                preparationRequestedMs: journey.preparationRequestedMs,
                preparationAppliedMs: (journey.firstLaneTime - start) / rate * 1000,
                preparedLeadMs: (journey.firstLaneTime - start) / rate * 1000,
                appliedLeadMs: (journey.firstLaneTime - start - appliedDelay) / rate * 1000,
                nominalDurationMs: duration / rate * 1000,
                appliedDurationMs: (duration + appliedExtra) / rate * 1000,
                appliedLatenessMs: (appliedDelay + appliedExtra) / rate * 1000,
                settleLimitMs: lateLimit / rate * 1000,
                nextJourneyRoomMs: nextRoom / rate * 1000,
                availableRoomMs: room / rate * 1000,
                delayRoomMs: Math.max(0, room - appliedExtra) / rate * 1000,
                waypointCount: journey.waypointCount,
            };
            journey.timing = timing;
            for (let i = journey.first; i <= journey.last; i++) {
                const segment = segments[i];
                segment.timing = timing;
                segment.journey = journey;
                // Keep the untuned path bit-identical. The uniform time map
                // and inverse tangent scaling preserve shape and continuity.
                if (appliedDelay > 0 || appliedExtra > 0) {
                    segment.start = start + appliedDelay + (segment.nominalStart - start) * stretch;
                    segment.end = start + appliedDelay + (segment.nominalEnd - start) * stretch;
                    segment.v0 /= stretch; segment.v1 /= stretch;
                }
            }
        }
        // Keep the legacy segment-array interface and enumeration intact.
        // Journey records are created only when this cached schedule rebuilds.
        Object.defineProperty(segments, 'journeys', { value: journeys });
        if (directTiming && typeof directTiming === 'object') {
            applyDirectCameraTiming(stops, segments, rate,
                directStartBefore(directTiming.startBeforeMs), directArriveAfter(directTiming.arriveAfterMs));
        }
        return segments;
    }

    /**
     * Exact endpoints are an opt-in overlay on the unchanged cached schedule.
     * A direct move must fit between its neighbours' LEGACY intervals, so
     * replacing or reverting any neighbour cannot create a new conflict.
     * Progressive and conflicting moves retain that legacy schedule exactly;
     * their diagnostics state that the direct controls were not applied.
     */
    function applyDirectCameraTiming(stops, segments, rate, startBeforeMs, arriveAfterMs) {
        const journeys = segments.journeys;
        // Collect all candidates before changing any segment or timing object.
        // This prevents traversal order from deciding which move wins a gap.
        for (let index = 0; index < journeys.length; index++) {
            const journey = journeys[index];
            const first = segments[journey.first], last = segments[journey.last];
            const requestedStart = journey.firstLaneTime - startBeforeMs / 1000 * rate;
            const requestedEnd = journey.firstLaneTime + arriveAfterMs / 1000 * rate;
            let fallbackReason = 'none';
            if (journey.first !== journey.last || first.transit) {
                fallbackReason = 'progressive-journey';
            } else if (requestedStart < stops[journey.fromStop].time) {
                fallbackReason = 'previous-lane';
            } else if (index > 0 && requestedStart < segments[journeys[index - 1].last].end
                || index + 1 < journeys.length && requestedEnd > segments[journeys[index + 1].first].start) {
                fallbackReason = 'adjacent-journey-overlap';
            }
            journey.directCandidate = {
                requestedStart, requestedEnd, fallbackReason,
                fitsLegacyGap: fallbackReason === 'none',
                legacyStart: first.start, legacyEnd: last.end,
            };
        }
        // Even when both candidates fit the original free gap, their exact
        // requests can overlap each other. Neither receives hidden priority.
        for (let index = 0; index + 1 < journeys.length; index++) {
            const left = journeys[index].directCandidate, right = journeys[index + 1].directCandidate;
            if (left.fitsLegacyGap && right.fitsLegacyGap
                && left.requestedEnd > right.requestedStart) {
                left.fallbackReason = right.fallbackReason = 'adjacent-journey-overlap';
            }
        }
        for (const journey of journeys) {
            const candidate = journey.directCandidate, legacyTiming = journey.timing;
            const direct = candidate.fallbackReason === 'none';
            const first = segments[journey.first], last = segments[journey.last];
            if (direct) {
                // This is one lasting-to-lasting segment, with zero endpoint
                // velocity/acceleration. Its implicit duration is before+after.
                first.start = candidate.requestedStart;
                first.end = candidate.requestedEnd;
                first.nominalStart = first.start;
            }
            const timing = {
                ...legacyTiming,
                mode: direct ? 'direct' : 'chart-paced-fallback',
                fallbackReason: candidate.fallbackReason,
                requestedStartBeforeMs: startBeforeMs, requestedArriveAfterMs: arriveAfterMs,
                requestedStart: candidate.requestedStart, requestedEnd: candidate.requestedEnd,
                actualFirstLaneArrivalTime: first.end,
                actualArriveAfterMs: (first.end - journey.firstLaneTime) / rate * 1000,
                finalLaneTime: stops[journey.toStop].time,
            };
            if (direct) Object.assign(timing, {
                legacyTiming,
                nominalStart: first.start, start: first.start,
                nominalEnd: journey.firstLaneTime, end: first.end,
                preparedLeadMs: startBeforeMs, appliedLeadMs: startBeforeMs,
                nominalDurationMs: startBeforeMs, appliedDurationMs: startBeforeMs + arriveAfterMs,
                appliedLatenessMs: arriveAfterMs,
                preparationReason: 'direct', preparationLimitReason: 'none',
                preparationRequestedMs: startBeforeMs, preparationAppliedMs: startBeforeMs,
                // Legacy modifiers do not contribute to an exact direct move.
                requestedDelayMs: 0, appliedDelayMs: 0, requestedExtraMs: 0, appliedExtraMs: 0,
                limitingReason: 'none', extraLimitingReason: 'none', delayLimitingReason: 'none',
            });
            journey.timing = timing;
            for (let index = journey.first; index <= journey.last; index++) segments[index].timing = timing;
        }
    }

    // Quintic Hermite with zero endpoint acceleration. Velocities use the
    // same units as duration (song time for paths, real time for corrections).
    function hwyCameraSegmentAt(from, to, v0, v1, duration, u, out) {
        u = Math.max(0, Math.min(1, u));
        const delta = to - from, a = v0 * duration, b = v1 * duration;
        const c3 = 10 * delta - 6 * a - 4 * b;
        const c4 = -15 * delta + 8 * a + 7 * b;
        const c5 = 6 * delta - 3 * a - 3 * b;
        out.x = from + u * (a + u * u * (c3 + u * (c4 + u * c5)));
        out.velocity = (a + u * u * (3 * c3 + u * (4 * c4 + u * 5 * c5))) / duration;
        if (u === 1) { out.x = to; out.velocity = v1; }
        return out;
    }

    // Evaluate a cached, non-overlapping trajectory. Lasting stops use their
    // scheduled arrival, independent of frame rate or seek history.
    function hwyCameraPlanAt(stops, now, rate, smoothing, out, departureDelay = 0, travelExtra = 0, settleLimit = 250, preparationMs = null, directTiming = null) {
        out = out || {};
        rate = Math.max(0.1, Math.min(4, Number(rate) || 1));
        preparationMs = normalizePreparation(preparationMs);
        const direct = directTiming && typeof directTiming === 'object';
        const startBeforeMs = direct ? directStartBefore(directTiming.startBeforeMs) : null;
        const arriveAfterMs = direct ? directArriveAfter(directTiming.arriveAfterMs) : null;
        if (!stops.motion || stops.motionRate !== rate || stops.motionSmoothing !== smoothing
            || stops.motionDepartureDelay !== departureDelay || stops.motionTravelExtra !== travelExtra
            || stops.motionSettleLimit !== settleLimit || stops.motionPreparationMs !== preparationMs
            || stops.motionDirectStartBeforeMs !== startBeforeMs || stops.motionDirectArriveAfterMs !== arriveAfterMs) {
            stops.motion = hwyBuildCameraMotion(stops, rate, smoothing, departureDelay, travelExtra, settleLimit, preparationMs, directTiming);
            stops.motionRate = rate; stops.motionSmoothing = smoothing;
            stops.motionDepartureDelay = departureDelay; stops.motionTravelExtra = travelExtra;
            stops.motionSettleLimit = settleLimit;
            stops.motionPreparationMs = preparationMs;
            stops.motionDirectStartBeforeMs = startBeforeMs;
            stops.motionDirectArriveAfterMs = arriveAfterMs;
        }
        const motion = stops.motion;
        let lo = 0, hi = motion.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (motion[mid].end <= now) lo = mid + 1;
            else hi = mid;
        }
        const segment = motion[lo];
        out.timing = segment?.timing ?? null;
        out.journey = segment?.journey ?? null;
        out.moving = !!segment && now >= segment.start;
        if (out.moving) {
            const duration = segment.end - segment.start;
            hwyCameraSegmentAt(segment.from, segment.to, segment.v0, segment.v1,
                duration, (now - segment.start) / duration, out);
            out.velocity *= rate;
        } else {
            out.x = motion[lo - 1]?.to ?? stops[0]?.x ?? 0;
            out.velocity = 0;
        }
        const arrival = segment ? motion[segment.arrivalIndex] : null;
        out.arrivalTime = arrival?.end ?? Infinity;
        out.arrivalX = arrival?.to ?? out.x;
        out.arrivalLaneTime = arrival?.nominalEnd ?? Infinity;
        out.transit = !!segment?.transit;
        out.valid = stops.length > 0;
        return out;
    }

    // Analytic damped response used by outward zoom; lateral movement samples
    // its scheduled curve directly, without stacking another lag filter on it.
    function hwyCameraRejoin(offset, velocity, dt, omega = 16) {
        const c = velocity + omega * offset;
        const decay = Math.exp(-omega * dt);
        return { offset: (offset + c * dt) * decay,
            velocity: (velocity - omega * c * dt) * decay };
    }

    // A lifecycle correction must disappear by the next lasting arrival,
    // rather than leaving an exponentially decaying position error there.
    function hwyCameraJoinAt(offset, velocity, start, end, now, rate, out) {
        out = out || {};
        if (end <= start || now >= end) { out.x = out.velocity = 0; return out; }
        return hwyCameraSegmentAt(offset, 0, velocity, 0, (end - start) / rate,
            (now - start) / (end - start), out);
    }

    // A speed change during travel resumes from the actual pose. Returning to
    // a newly delayed nominal curve would otherwise briefly move backwards.
    function hwyCameraResumeAt(state, now, out) {
        out = out || {};
        const duration = state.resumeEnd - state.resumeStart;
        if (duration <= 0 || now >= state.resumeEnd) {
            out.x = state.resumeTarget; out.velocity = 0; return out;
        }
        return hwyCameraSegmentAt(state.resumeFrom, state.resumeTarget, state.resumeVelocity, 0,
            duration / state.resumeRate, (now - state.resumeStart) / duration, out);
    }

    // A finite zoom return, with a quiet period before narrowing. Keep its
    // original start while the requirement relaxes; restarting every frame
    // would turn the return into an endless asymptote. Rising requirements
    // cancel it immediately, including the anticipated next playing area.
    function hwyCameraZoom(state, required, dt, smoothing = 0.5) {
        if (required > (state.zoomRequired ?? required) + Math.max(1e-8, required * 0.00001)) {
            state.quietZoomTime = 0;
        }
        state.zoomRequired = required;
        if (required >= state.distance - 1e-8) {
            state.quietZoomTime = 0;
            state.zoomReturnFrom = state.distance;
            const motion = hwyCameraRejoin(state.distance - required, state.zoomVelocity || 0, dt, 10);
            state.distance = required + motion.offset;
            state.zoomVelocity = motion.velocity;
        } else {
            if (!state.quietZoomTime) state.zoomReturnFrom = state.distance;
            state.quietZoomTime += dt;
            const calm = Math.max(0, Math.min(1, smoothing));
            const wait = 0.4 + calm * 0.2;
            // An outward visibility correction must come to rest smoothly
            // when its geometry disappears, rather than stop in one frame.
            const velocity = state.zoomVelocity || 0;
            if (state.quietZoomTime <= wait + 1e-9 && Math.abs(velocity) > 1e-10) {
                const decay = Math.exp(-dt / .12);
                const distance = state.distance + velocity * .12 * (1 - decay);
                state.distance = Math.max(required, distance);
                state.zoomVelocity = distance > required ? velocity * decay : 0;
                state.zoomReturnFrom = state.distance;
                return;
            }
            const duration = 0.6 + calm * 0.4;
            const u = Math.max(0, Math.min(1, (state.quietZoomTime - wait) / duration));
            const eased = u * u * u * (10 + u * (-15 + 6 * u));
            state.distance = state.zoomReturnFrom + (required - state.zoomReturnFrom) * eased;
            state.zoomVelocity = (required - state.zoomReturnFrom) * 30 * u * u * (1 - u) * (1 - u) / duration;
        }
        if (Math.abs(state.distance - required) < 1e-8) state.distance = required;
    }

    return {
        hwyBuildCameraAttackIndex, hwyPrepareCameraStops, hwyBuildCameraMotion,
        hwyCameraSegmentAt, hwyCameraPlanAt, hwyCameraRejoin,
        hwyCameraJoinAt, hwyCameraResumeAt, hwyCameraZoom,
    };
}
