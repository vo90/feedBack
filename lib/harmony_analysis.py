"""Deterministic, chart-only harmony estimates over the normalized source contract.

This module deliberately has no filesystem, audio, playback or server dependencies.
It reports what the charts support, including bounded gaps and missing qualities;
the result is a suggestion, not a transcription of the recording.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
import math
import re
from statistics import median


ALGORITHM_VERSION = "chart-harmony-v8"
_NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_NATURAL = dict(zip("CDEFGAB", (0, 2, 4, 5, 7, 9, 11)))
_EPS = 1e-7
SCALES = {
    "major": (0, 2, 4, 5, 7, 9, 11),
    "natural_minor": (0, 2, 3, 5, 7, 8, 10),
    "dorian": (0, 2, 3, 5, 7, 9, 10),
    "phrygian": (0, 1, 3, 5, 7, 8, 10),
    "lydian": (0, 2, 4, 6, 7, 9, 11),
    "mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "locrian": (0, 1, 3, 5, 6, 8, 10),
    "harmonic_minor": (0, 2, 3, 5, 7, 8, 11),
    "melodic_minor": (0, 2, 3, 5, 7, 9, 11),
    "major_pentatonic": (0, 2, 4, 7, 9),
    "minor_pentatonic": (0, 3, 5, 7, 10),
}
CHORD_INTERVALS = {
    "maj": (0, 4, 7), "min": (0, 3, 7), "5": (0, 7),
    "dim": (0, 3, 6), "aug": (0, 4, 8), "sus2": (0, 2, 7), "sus4": (0, 5, 7),
    "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "min7": (0, 3, 7, 10),
    "dim7": (0, 3, 6, 9), "hdim7": (0, 3, 6, 10), "minmaj7": (0, 3, 7, 11),
    "6": (0, 4, 7, 9), "min6": (0, 3, 7, 9),
    "add9": (0, 2, 4, 7), "minadd9": (0, 2, 3, 7),
    "9": (0, 2, 4, 7, 10), "maj9": (0, 2, 4, 7, 11), "min9": (0, 2, 3, 7, 10),
    "7sus2": (0, 2, 7, 10), "7sus4": (0, 5, 7, 10),
    "add11": (0, 4, 5, 7), "minadd11": (0, 3, 5, 7),
    "11": (0, 2, 4, 5, 7, 10), "min11": (0, 2, 3, 5, 7, 10),
    "13": (0, 2, 4, 7, 9, 10), "maj13": (0, 2, 4, 7, 9, 11),
    "min13": (0, 2, 3, 7, 9, 10), "13#11": (0, 2, 4, 6, 7, 9, 10),
    "7#11": (0, 4, 6, 7, 10), "7#9": (0, 3, 4, 7, 10), "sus2sus4": (0, 2, 5, 7),
}
_ALIASES = {
    "": "maj", "M": "maj", "major": "maj", "m": "min", "minor": "min", "-": "min",
    "power": "5", "sus": "sus4", "o": "dim", "°": "dim", "+": "aug",
    "M7": "maj7", "m7": "min7", "m6": "min6", "M9": "maj9", "m9": "min9",
    "m11": "min11", "m13": "min13", "M13": "maj13", "madd9": "minadd9",
    "madd11": "minadd11", "mmaj7": "minmaj7", "m7b5": "hdim7", "ø7": "hdim7",
    "add6": "6", "madd6": "min6",
    "o7": "dim7", "°7": "dim7", "2": "sus2", "4": "sus4", "sus2/4": "sus2sus4",
}
_SUFFIX = {"maj": "", "min": "m", "min7": "m7", "min6": "m6", "min9": "m9",
           "min11": "m11", "min13": "m13", "minadd9": "madd9", "minadd11": "madd11",
           "minmaj7": "m(maj7)", "hdim7": "m7b5", "sus2sus4": "sus2/4"}


class AnalysisCancelled(RuntimeError):
    """The caller cancelled analysis; no partial result should enter the cache."""


def _check(cancelled):
    if cancelled is not None and cancelled():
        raise AnalysisCancelled("Chart harmony analysis cancelled")


def _number(value, default=0.0):
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else default


def pitch_class(name):
    """Parse an exact pitch class, preserving enharmonic spellings elsewhere."""
    if isinstance(name, int) and not isinstance(name, bool) and 0 <= name < 12:
        return name
    if not isinstance(name, str):
        return None
    match = re.fullmatch(r"([A-Ga-g])([#b♯♭]{0,2})", name.strip())
    if not match:
        return None
    return (_NATURAL[match[1].upper()] + sum(1 if c in "#♯" else -1 for c in match[2])) % 12


def parse_chord(label):
    """Parse the explicitly supported vocabulary; unknown suffixes never mean major."""
    if not isinstance(label, str) or not label.strip():
        return None
    label = re.sub(r"\s+", "", label.strip()).replace("♯", "#").replace("♭", "b")
    match = re.fullmatch(r"([A-Ga-g][#b]{0,2})(.*?)(?:/([A-Ga-g][#b]{0,2}))?", label)
    if not match:
        return None
    root, suffix, bass = match.groups()
    root = root[0].upper() + root[1:]
    suffix = suffix.replace("(", "").replace(")", "")
    quality = _ALIASES.get(suffix, suffix)
    intervals = CHORD_INTERVALS.get(quality)
    if intervals is None:
        return None
    pc = pitch_class(root)
    tones = {(pc + interval) % 12 for interval in intervals}
    bass = bass[0].upper() + bass[1:] if bass else None
    if bass:
        tones.add(pitch_class(bass))
    return {"root": root, "pc": pc, "quality": quality, "bass": bass,
            "chord_tones": sorted(tones),
            "display_label": root + _SUFFIX.get(quality, quality) + ("/" + bass if bass else "")}


def _voicing(event):
    values = event.get("pcs")
    if not isinstance(values, (list, tuple)):
        values = [round(n) % 12 for n in event.get("pitches", []) if isinstance(n, (int, float))]
    return {n for n in values if isinstance(n, int) and 0 <= n < 12}


def _corroborate(chord, pcs):
    if not chord or len(pcs & set(chord["chord_tones"])) < 2:
        return None
    extras = pcs - set(chord["chord_tones"])
    # Chart labels frequently omit a ninth/eleventh/sixth present in the
    # voicing. Preserve its pitch for compatibility rather than discard a
    # corroborated chord root or silently remove the extension.
    allowed_extensions = {(chord["pc"] + interval) % 12 for interval in (2, 5, 9)}
    if not extras <= allowed_extensions:
        return None
    # A label is a hypothesis about quality, not an observation. A C label on
    # C/G must never manufacture E (or a slash bass absent from the voicing).
    return {**chord, "chord_tones": sorted(pcs),
            "label_implied_pcs": sorted(set(chord["chord_tones"]) - pcs)}


def _infer_voicing(pcs, pitches):
    """A full exact voicing can imply quality; two notes never imply a third."""
    if not pcs:
        return None
    bass_pc = round(min(pitches)) % 12 if pitches else min(pcs)
    if len(pcs) == 1:
        pc = next(iter(pcs))
        return {"root": _NAMES[pc], "pc": pc, "quality": "", "bass": None,
                "chord_tones": [pc], "display_label": _NAMES[pc]}
    candidates = []
    for pc in pcs:
        for quality, intervals in CHORD_INTERVALS.items():
            if len(intervals) > 4 or quality in ("6", "min6"):
                continue  # sixth/seventh inversions are not resolved from a set alone
            if {(pc + interval) % 12 for interval in intervals} == pcs:
                candidates.append((pc == bass_pc, pc, quality))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    # Augmented/diminished seventh symmetries need additional root evidence.
    if len(candidates) > 1 and not candidates[0][0]:
        return None
    _, pc, quality = candidates[0]
    if quality in ("dim7", "aug") and len(candidates) > 1:
        return None
    root = _NAMES[pc]
    return {"root": root, "pc": pc, "quality": quality,
            "bass": _NAMES[bass_pc] if bass_pc != pc else None,
            "chord_tones": sorted(pcs),
            "display_label": root + _SUFFIX.get(quality, quality)
            + ("/" + _NAMES[bass_pc] if bass_pc != pc else "")}


def _beat_length(beats):
    differences = [b - a for a, b in zip(beats, beats[1:]) if .12 <= b - a <= 3]
    return median(differences) if differences else .5


def _evidence(source, beat, cancelled):
    """Build bounded musical evidence, capping correlated arrangements later."""
    evidence, observations, diagnostics = [], [], []
    seen_observations = set()
    duration = source["duration"]
    for arr_index, arrangement in enumerate(source.get("arrangements", [])):
        _check(cancelled)
        role = arrangement.get("role", "lead")
        group = str(arrangement.get("correlation_group") or arrangement.get("id") or arr_index)
        identity = str(arrangement.get("id", arr_index))
        notes = sorted(arrangement.get("notes", []), key=lambda n: _number(n.get("t")))
        chords = sorted(arrangement.get("chords", []), key=lambda n: _number(n.get("t")))
        local_observations = []
        for event in notes + chords:
            t = max(0, _number(event.get("t")))
            pcs = _voicing(event) if "pc" not in event else {event["pc"]}
            if not pcs or t >= duration:
                continue
            weight = max(0, _number(event.get("weight"), 1)) * (.3 if event.get("uncertain") else 1)
            end = min(duration, max(t + beat * .5, _number(event.get("end"))))
            observation = {"t": t, "end": end, "pcs": pcs, "weight": weight, "role": role,
                           "group": group, "id": event.get("evidence_id", identity)}
            local_observations.append(observation)
            signature = (round(t, 3), round(end, 3), tuple(sorted(pcs)), role == "bass")
            if signature not in seen_observations:
                observations.append(observation)
                seen_observations.add(signature)
        local_observations.sort(key=lambda n: n["t"])
        observation_times = [n["t"] for n in local_observations]
        for event_index, event in enumerate(chords):
            t = max(0, _number(event.get("t")))
            pcs = _voicing(event)
            if not pcs or event.get("uncertain") or t >= duration:
                continue
            label = event.get("label", "")
            chord = parse_chord(label)
            named = chord is not None
            if chord and not _corroborate(chord, pcs):
                diagnostics.append({"code": "label_voicing_conflict", "arrangement_id": identity,
                                    "t": t, "label": label, "pcs": sorted(pcs)})
                chord, named = None, False
            elif chord:
                chord = _corroborate(chord, pcs)
            if chord is None:
                chord = _infer_voicing(pcs, event.get("pitches", []))
                if label and parse_chord(label) is None:
                    diagnostics.append({"code": "unsupported_chord_label", "label": label})
            if chord is None:
                continue
            # Strums imply a short harmonic window, never an indefinite hold.
            end = max(t + beat * 2, _number(event.get("end")))
            if event_index + 1 < len(chords):
                next_t = _number(chords[event_index + 1].get("t"))
                if next_t > t + _EPS:
                    end = min(end, next_t)
            weight = (4.0 if named else 2.3 if chord["quality"] else .9)
            weight *= 1.15 if role == "rhythm" else .8 if role == "bass" else 1
            weight *= max(0, _number(event.get("weight"), 1))
            kind = "bass_root_candidate" if role == "bass" and not chord["quality"] else "named_chord" if named else "voicing"
            evidence.append({**chord, "t": t, "end": min(duration, end), "group": group,
                             "weight": weight, "named": named, "kind": kind,
                             "id": event.get("evidence_id", identity), "observed": sorted(pcs)})
        for event in arrangement.get("handshapes", []):
            _check(cancelled)
            t, end = max(0, _number(event.get("t"))), min(duration, _number(event.get("end")))
            if end <= t or event.get("uncertain"):
                continue
            chord = parse_chord(event.get("label", ""))
            pcs = _voicing(event)
            if chord is None:
                chord = _infer_voicing(pcs, event.get("pitches", []))
                named = False
            else:
                named = True
                chord = _corroborate(chord, pcs)
                if chord is None:
                    continue
            if chord is None or not chord["quality"]:
                continue
            # Templates only contribute where actual pitched chart attacks
            # corroborate them. Split sparse handshapes across evidence gaps.
            index = max(0, bisect_right(observation_times, t) - 1)
            matching = []
            while index < len(local_observations) and local_observations[index]["t"] < end:
                observation = local_observations[index]
                if observation["end"] > t and observation["pcs"] <= set(chord["chord_tones"]):
                    matching.append(observation)
                index += 1
            clusters = []
            for observation in matching:
                start = max(t, observation["t"])
                finish = min(end, max(observation["end"], observation["t"] + beat * 2))
                if clusters and start <= clusters[-1][1] + _EPS:
                    clusters[-1][1] = max(clusters[-1][1], finish)
                    clusters[-1][2].update(observation["pcs"])
                else:
                    clusters.append([start, finish, set(observation["pcs"])])
            for start, finish, observed in clusters:
                if len(observed) < 2:
                    continue
                # Handshape frets are a template; only the notes actually
                # played in this bounded cluster support the returned tones.
                implied = set(chord["chord_tones"]) | set(chord.get("label_implied_pcs", []))
                evidence.append({**chord, "chord_tones": sorted(observed),
                                 "label_implied_pcs": sorted(implied - observed) if named else [],
                                 "t": start, "end": finish, "group": group,
                                 "weight": (3.5 if named else 2.0) * (1.1 if role == "rhythm" else 1),
                                 "named": named, "kind": "handshape", "id": event.get("evidence_id", identity),
                                 "observed": sorted(observed)})
        # Root-only bass guidance uses beat windows and dominant/repeated tones.
        # It cannot synthesize a major/minor chord from a walking bass line.
        if role == "bass" and local_observations:
            window = 2 * beat
            bins = defaultdict(list)
            origin = source.get("beats", [0])[0] if source.get("beats") else 0
            for observation in local_observations:
                index = math.floor((observation["t"] - origin) / window)
                bins[index].append(observation)
            for index, items in bins.items():
                counts, attacks = Counter(), Counter()
                for item in items:
                    for pc in item["pcs"]:
                        counts[pc] += min(window, item["end"] - item["t"]) * item["weight"]
                        attacks[pc] += 1
                if not counts:
                    continue
                pc, value = counts.most_common(1)[0]
                if value / sum(counts.values()) < .52 or (attacks[pc] < 2 and value < beat * .9):
                    continue
                start = min(item["t"] for item in items)
                finish = min(duration, max(max(item["end"] for item in items), origin + (index + 1) * window))
                evidence.append({"root": _NAMES[pc], "pc": pc, "quality": "", "bass": None,
                                 "chord_tones": [pc], "display_label": _NAMES[pc],
                                 "t": start, "end": finish, "group": group, "weight": .65,
                                 "named": False, "kind": "bass_root_candidate", "id": identity,
                                 "observed": [pc]})
    # Diagnostics are counts with examples, not thousands of repeated strums.
    grouped = defaultdict(list)
    for diagnostic in diagnostics:
        grouped[diagnostic["code"]].append(diagnostic)
    compact = [{"code": code, "count": len(items), "examples": items[:8]} for code, items in grouped.items()]
    return evidence, observations, compact


def _unknown(t, end, reason="insufficient_evidence"):
    return {"t": round(t, 6), "end": round(end, 6), "unknown": True,
            "confidence": "low", "evidence": {"reason": reason}}


def _event_signature(event):
    return (event.get("unknown", False), event.get("root"), event.get("quality"), event.get("bass"),
            event.get("key"), event.get("mode"), event.get("type"), event.get("confidence"),
            tuple(event.get("chord_tones", [])),
            tuple(event.get("evidence", {}).get("observed_pcs", [])),
            tuple(event.get("evidence", {}).get("label_implied_pcs", [])),
            event.get("evidence", {}).get("kind"),
            event.get("evidence", {}).get("resolution"),
            event.get("evidence", {}).get("anchor_reference"),
            tuple(event.get("evidence", {}).get("partial_voicing_references", [])),
            event.get("evidence", {}).get("shared_scale", {}).get("root"),
            event.get("evidence", {}).get("shared_scale", {}).get("type"),
            event.get("evidence", {}).get("scale_degrees_resolved", True),
            event.get("evidence", {}).get("reason") if event.get("unknown") else None)


def _append_event(events, event):
    if event["end"] <= event["t"] + _EPS:
        return
    if events and abs(events[-1]["end"] - event["t"]) < 1e-5 and _event_signature(events[-1]) == _event_signature(event):
        events[-1]["end"] = event["end"]
        evidence = events[-1].get("evidence", {})
        evidence["support_windows"] = evidence.get("support_windows", 1) + 1
        return
    events.append(event)


def _quality_conflict(candidates, winner, pc):
    thirds = {(tone - pc) % 12 for c in candidates for tone in c["observed"]} & {3, 4}
    return len(thirds) == 2 and any(
        c["named"] and c["quality"] != winner["quality"] for c in candidates)


def _compatible_partial_voicings(active, scored):
    """Resolve only a complete chord versus contained, incomplete labels.

    Root scores still determine which interpretations are strong enough to
    compete. A weaker chord cannot acquire votes from parts it explains. Among
    those roots, inspect every active voicing, including correlated alternatives
    hidden by the per-group score cap. Complete smaller chords and equal pitch
    sets retain their independent interpretations; a superset alone is not
    evidence for preferring one root.
    """
    strong_roots = {pc for score, pc, _ in scored if score >= scored[0][0] * .84}
    contenders = [c for c in active if c["pc"] in strong_roots
                  and c["quality"] and len(c["observed"]) >= 2]
    solutions = []
    for anchor in contenders:
        pc, observed = anchor["pc"], set(anchor["observed"])
        expected = {(pc + interval) % 12 for interval in CHORD_INTERVALS.get(anchor["quality"], ())}
        if (len(observed) < 3 or anchor["quality"] == "5" or not expected
                or pc not in observed or not expected <= observed
                or anchor.get("label_implied_pcs")):
            continue
        same_root = [c for c in contenders if c["pc"] == pc]
        if _quality_conflict(same_root, anchor, pc):
            continue
        partials = [c for c in contenders if c["pc"] != pc]
        if not partials or any(
                not c.get("label_implied_pcs") or not set(c["observed"]) < observed
                for c in partials):
            continue
        if any(not set(c["observed"]) <= observed for c in active if c["pc"] in strong_roots):
            continue
        solutions.append((anchor, same_root, partials))
    # Multiple fully observed qualities/collections remain ambiguous even if
    # their labels happen to share a root. Duplicate charts cannot break a tie.
    identities = {(a["pc"], a["quality"], tuple(sorted(a["observed"])))
                  for a, _, _ in solutions}
    if len(identities) != 1:
        return None
    return max(solutions, key=lambda item: (
        item[0]["weight"], item[0]["named"], item[0].get("bass") or "",
        item[0]["display_label"], str(item[0]["id"])))


def _choose_chord(active, previous, t, end):
    if not active:
        return _unknown(t, end, "no_chart_evidence")
    roots = defaultdict(dict)
    for candidate in active:
        root_group = roots[candidate["pc"]]
        old = root_group.get(candidate["group"])
        if old is None or candidate["weight"] > old["weight"]:
            root_group[candidate["group"]] = candidate
    scored = []
    for pc, groups in roots.items():
        # Extra guitar charts can corroborate but never multiply a vote without
        # limit. The strongest voicing is the primary observation.
        weights = sorted((c["weight"] for c in groups.values()), reverse=True)
        score = weights[0] + min(weights[0] * .35, sum(weights[1:]) * .25)
        if previous and previous.get("root") and pitch_class(previous["root"]) == pc:
            score += .12
        scored.append((score, pc, list(groups.values())))
    scored.sort(key=lambda item: item[0], reverse=True)
    score, pc, candidates = scored[0]
    resolved = None
    if len(scored) > 1 and scored[1][0] >= score * .84:
        resolved = _compatible_partial_voicings(active, scored)
        if resolved is None:
            return _unknown(t, end, "conflicting_arrangements")
        winner, candidates, partials = resolved
        pc = winner["pc"]
    # A complete singleton is still only a root candidate. It must not erase
    # an observed dyad merely because the dyad's label implies an unplayed third.
    candidates.sort(key=lambda c: (bool(c["quality"]) and len(c["observed"]) >= 2,
                                   not c.get("label_implied_pcs"), c["named"],
                                   c["weight"], len(c["chord_tones"])), reverse=True)
    winner = resolved[0] if resolved else candidates[0]
    # Conflicting major/minor thirds cannot be resolved by chart count alone.
    if _quality_conflict(candidates, winner, pc):
        return _unknown(t, end, "conflicting_chord_quality")
    quality = winner["quality"]
    observed = sorted(set(winner["observed"]))
    implied = sorted(set(winner.get("label_implied_pcs", [])) - set(observed))
    confidence = "high" if winner["named"] and len(observed) >= 3 and not implied and not resolved else "medium"
    if not quality:
        confidence = "low" if winner["kind"] == "bass_root_candidate" else "medium"
    result = {"t": round(t, 6), "end": round(end, 6), "root": winner["root"],
              "quality": quality, "confidence": confidence,
              "display_label": winner["display_label"], "chord_tones": observed,
              "grounded_chord_tones": observed,
              "evidence": {"kind": winner["kind"], "references": [str(c["id"]) for c in candidates[:3]],
                           "support_windows": 1, "observed_pcs": observed,
                           "label_implied_pcs": implied, "root_observed": pc in observed,
                           "quality_basis": "label" if implied else "observed_voicing"}}
    if resolved:
        result["evidence"].update({
            "resolution": "compatible_partial_voicings",
            "anchor_reference": str(winner["id"]),
            "partial_voicing_references": sorted({str(c["id"]) for c in partials})[:3],
        })
    if winner.get("bass") and pitch_class(winner["bass"]) in observed:
        result["bass"] = winner["bass"]
    return result


def _chord_timeline(evidence, duration, cancelled):
    points = defaultdict(lambda: {"start": [], "end": []})
    points[0.0]
    points[duration]
    for index, candidate in enumerate(evidence):
        if candidate["end"] > candidate["t"] and candidate["weight"] > 0:
            points[candidate["t"]]["start"].append(index)
            points[candidate["end"]]["end"].append(index)
    times = sorted(points)
    active, events = {}, []
    for index, t in enumerate(times[:-1]):
        if index % 256 == 0:
            _check(cancelled)
        for number in points[t]["end"]:
            active.pop(number, None)
        for number in points[t]["start"]:
            active[number] = evidence[number]
        event = _choose_chord(list(active.values()), events[-1] if events else None, t, times[index + 1])
        _append_event(events, event)
    return events


_PROFILES = {
    "major": (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88),
    "minor": (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17),
}


def _correlation(left, right):
    a, b = sum(left) / 12, sum(right) / 12
    numerator = sum((x - a) * (y - b) for x, y in zip(left, right))
    denominator = math.sqrt(sum((x - a) ** 2 for x in left) * sum((y - b) ** 2 for y in right))
    return numerator / denominator if denominator else 0


def _ambiguous_collections(best, candidates, observed_weights):
    """Find scale collections whose distinguishing degrees are unsubstantiated.

    A cadence or pitch-profile score can suggest a tonic without establishing
    every degree of its major/minor scale. For example, six pitches can fit two
    keys differing only by one unplayed note. Ignore trace pitch contributions
    below 0.5% of weighted observations; a stray approach/bend must not resolve
    that ambiguity. Relative keys with identical pitch sets are not conflicts.
    """
    def collection(candidate):
        mode = "natural_minor" if candidate["mode"] == "minor" else "major"
        return frozenset((candidate["pc"] + interval) % 12 for interval in SCALES[mode])

    total = sum(observed_weights.values())
    if not total:
        return []
    preferred = collection(best)
    seen, ambiguous = {preferred}, []
    for candidate in candidates:
        alternative = collection(candidate)
        if alternative in seen:
            continue
        seen.add(alternative)
        preferred_support = sum(observed_weights[pc] for pc in preferred - alternative) / total
        alternative_support = sum(observed_weights[pc] for pc in alternative - preferred) / total
        if max(preferred_support, alternative_support) < .005:
            ambiguous.append({
                "key": _NAMES[candidate["pc"]] + " " + candidate["mode"],
                "distinguishing_pcs": sorted(preferred ^ alternative),
                "observed_support": round(preferred_support + alternative_support, 6),
            })
    return ambiguous


def _quality_is_observed(event):
    pc = pitch_class(event.get("root"))
    observed = set(event.get("grounded_chord_tones", event.get("chord_tones", [])))
    thirds = set(CHORD_INTERVALS.get(event.get("quality"), ())) & {3, 4}
    return pc in observed and bool(thirds) and all((pc + third) % 12 in observed for third in thirds)


def _tonic_quality_matches(event, mode):
    """A cadence to the parallel tonic cannot establish the candidate mode."""
    return (_quality_is_observed(event) and
            (event.get("quality", "").startswith("min") if mode == "minor" else
             event.get("quality") in ("maj", "maj7", "maj9", "6", "add9")))


def _repeated_collection_conflict(best, candidates, note_weights, chord_events):
    preferred = {(best["pc"] + i) % 12 for i in
                 SCALES["natural_minor" if best["mode"] == "minor" else "major"]}
    grounded = [e for e in chord_events if e.get("confidence") != "low"
                and len(e.get("grounded_chord_tones", [])) >= 2
                and pitch_class(e.get("root")) in e.get("grounded_chord_tones", [])]
    # Filling out or repeating one opposing root's voicing is still one visit.
    # A compatible chord or different root must intervene before another.
    visits = []
    for event in grounded:
        pcs = set(event["grounded_chord_tones"])
        signature = (pitch_class(event["root"]), not pcs <= preferred)
        if not visits or visits[-1][0] != signature:
            visits.append((signature, pcs, event["t"], event["end"]))
        else:
            visits[-1] = (signature, visits[-1][1] | pcs, visits[-1][2], event["end"])
    # These sets summarize notes across a visit; they are never emitted as a chord.
    opposing = [(tuple(sorted(pcs)), start, end) for signature, pcs, start, end in visits if signature[1]]
    total = sum(note_weights.values())
    if len(opposing) < 2 or total <= 0:
        return None
    seen, alternatives = {frozenset(preferred)}, []
    for candidate in candidates:
        collection = frozenset((candidate["pc"] + i) % 12 for i in
                              SCALES["natural_minor" if candidate["mode"] == "minor" else "major"])
        if collection in seen or not candidate["tonic_supported"] or candidate["fit"] < .97:
            continue
        if any(not set(event["grounded_chord_tones"]) <= collection for event in grounded):
            continue
        # Require independently observed degrees across the entire alternative
        # collection; a plausible but incomplete palette cannot veto a key.
        if any(note_weights[pc] / total < .005 for pc in collection):
            continue
        if any(note_weights[pc] / total >= .005 for pc in preferred - collection):
            continue
        seen.add(collection)
        alternatives.append({"root": _NAMES[candidate["pc"]], "mode": candidate["mode"],
                             "pcs": sorted(collection), "fit": round(candidate["fit"], 4)})
    if len(alternatives) != 1:
        return None
    return {"alternative_collection": alternatives[0], "opposing_regions": len(opposing),
            "opposing_pcs": sorted({pc for pcs, _, _ in opposing for pc in pcs if pc not in preferred}),
            "opposing_windows": [{"start": start, "end": end, "pcs": list(pcs)}
                                 for pcs, start, end in opposing[:6]]}


def _estimate_key(observations, harmony, start, end, position=None):
    pitch_weights, roots = Counter(), Counter()
    chord_events = []
    # Coalesced chord regions support cadence counting. Collection checks must
    # retain every actual voicing, including an extension added within a region.
    grounded_harmony = []
    for event in harmony:
        if (event["end"] <= start or event["t"] >= end or event.get("unknown")
                or event.get("confidence") == "low"
                or len(event.get("grounded_chord_tones", [])) < 2
                or pitch_class(event.get("root")) not in event.get("grounded_chord_tones", [])):
            continue
        previous = grounded_harmony[-1] if grounded_harmony else None
        if (previous and previous["root"] == event["root"]
                and set(previous["grounded_chord_tones"]) == set(event["grounded_chord_tones"])
                and abs(previous["end"] - event["t"]) <= _EPS):
            # Splitting an unchanged voicing supplies no independent evidence.
            # A changed pitch set remains separate, even with the same label.
            previous["end"] = event["end"]
        else:
            grounded_harmony.append(dict(event))
    for event_index, event in enumerate(harmony):
        overlap = min(event["end"], end) - max(event["t"], start)
        if overlap <= 0 or event.get("unknown") or not event.get("quality"):
            continue
        weight = overlap * (1 if event["confidence"] == "high" else .55)
        pc = pitch_class(event["root"])
        observed = set(event.get("grounded_chord_tones", event["chord_tones"]))
        # Root votes need a played root; quality/cadence votes additionally
        # need its defining third. A bass candidate cannot establish tonality.
        supports_quality = _quality_is_observed(event)
        if pc in observed:
            roots[pc] += weight
        for tone in event["chord_tones"]:
            pitch_weights[tone] += weight / len(event["chord_tones"])
        signature = (event["root"], event["quality"], supports_quality)
        if (not chord_events or (chord_events[-1]["root"], chord_events[-1]["quality"],
                                chord_events[-1]["_quality_observed"]) != signature
                or abs(chord_events[-1]["end"] - event["t"]) > _EPS):
            # Keep incomplete/power-chord regions in the sequence. Dropping
            # them would join unrelated triads into a fictitious cadence.
            chord_events.append({**event, "_quality_observed": supports_quality,
                                 "_first_index": event_index, "_last_index": event_index})
        else:
            chord_events[-1]["end"] = event["end"]
            chord_events[-1]["_last_index"] = event_index
    # Chart releases need not touch the next attack. A brief articulation gap
    # can still connect two grounded chords harmonically, without claiming
    # that either chord sounded throughout the gap. Use authored musical time
    # and never skip another chord or a conflicting played pitch. Direct
    # callers without a beat clock retain exact-adjacency behavior.
    onsets = sorted(observations, key=lambda event: event["t"])
    onset_times = [event["t"] for event in onsets]
    longest_observation = max((event["end"] - event["t"] for event in onsets), default=0)
    # A predecessor outside the interval supplies only the connection to an
    # arrival inside it, never pitch/root votes, duration, or region counts.
    connection_events = chord_events
    if chord_events and chord_events[0]["t"] >= start:
        previous_index = chord_events[0]["_first_index"] - 1
        while previous_index >= 0:
            gap_event = harmony[previous_index]
            if not gap_event.get("unknown") or gap_event.get("evidence", {}).get("reason") != "no_chart_evidence":
                break
            previous_index -= 1
        if previous_index >= 0:
            previous = harmony[previous_index]
            if not previous.get("unknown") and _quality_is_observed(previous):
                antecedent = {**previous, "_quality_observed": True,
                              "_first_index": previous_index, "_last_index": previous_index}
                connection_events = [antecedent] + chord_events
    cadence_pairs, articulated_pairs = [], 0
    for left, right in zip(connection_events, connection_events[1:]):
        if (not left["_quality_observed"] or not right["_quality_observed"]
                or not start <= right["t"] < end):
            continue
        gap = right["t"] - left["end"]
        if gap < -_EPS:
            continue
        if any(not event.get("unknown") or event.get("evidence", {}).get("reason") != "no_chart_evidence"
               for event in
               harmony[left["_last_index"] + 1:right["_first_index"]]):
            continue
        if gap > _EPS:
            if position is None or position(right["t"]) - position(left["end"]) > .5 + _EPS:
                continue
            allowed = set(left["chord_tones"]) | set(right["chord_tones"])
            first = bisect_left(onset_times, left["end"] - longest_observation)
            last = bisect_left(onset_times, right["t"])
            if any(event["end"] > left["end"] and event["weight"] >= .5
                   and not set(event["pcs"]) <= allowed
                   for event in onsets[first:last]):
                continue
            articulated_pairs += 1
        cadence_pairs.append((left, right))
    # An incoming cadence can complete repeated section evidence, but a single
    # resolution into a sliding window must not raise its ordinary key score.
    local_cadence_pairs = [(a, b) for a, b in cadence_pairs if a["end"] > start]
    # Pitch observations remain useful for riffs, but correlated chart density
    # is bounded by per-time/group occupancy and cannot drown out harmony.
    note_weights = Counter()
    slots = defaultdict(dict)
    for observation in observations:
        overlap = min(observation["end"], end) - max(observation["t"], start)
        if overlap <= 0:
            continue
        for pc in observation["pcs"]:
            slot = (round(observation["t"] * 4), pc)
            value = min(overlap, 2) * observation["weight"] / len(observation["pcs"])
            slots[slot][observation["group"]] = max(slots[slot].get(observation["group"], 0), value)
    for (_, pc), groups in slots.items():
        note_weights[pc] += max(groups.values())
    harmonic_total, note_total = sum(pitch_weights.values()), sum(note_weights.values())
    if note_total:
        factor = harmonic_total * .35 / note_total if harmonic_total else 1
        for pc, value in note_weights.items():
            pitch_weights[pc] += value * factor
    total = sum(pitch_weights.values())
    if total <= 0 or len(pitch_weights) < 4:
        return {"unknown": True, "confidence": "low", "evidence": {
            "reason": "insufficient_tonal_evidence", "dominant_cadences": 0,
            "observed_quality_regions": sum(e["_quality_observed"] for e in chord_events),
            "observed_quality_roots": len({pitch_class(e["root"]) for e in chord_events if e["_quality_observed"]})}}
    distribution = [pitch_weights[i] for i in range(12)]
    root_total = sum(roots.values()) or 1
    candidates = []
    for mode, profile in _PROFILES.items():
        scale_id = "major" if mode == "major" else "natural_minor"
        for pc in range(12):
            scale = {(pc + interval) % 12 for interval in SCALES[scale_id]}
            fit = sum(value for note, value in pitch_weights.items() if note in scale) / total
            corr = _correlation(distribution, [profile[(note - pc) % 12] for note in range(12)])
            tonic = roots[pc] / root_total
            cadences = sum(1 for a, b in local_cadence_pairs
                           if pitch_class(b["root"]) == pc and _tonic_quality_matches(b, mode)
                           and (pitch_class(a["root"]) - pc) % 12 in (7, 5))
            dominant_cadences = sum(1 for a, b in local_cadence_pairs
                                    if pitch_class(b["root"]) == pc and _tonic_quality_matches(b, mode)
                                    and (pitch_class(a["root"]) - pc) % 12 == 7
                                    and a["quality"] in ("maj", "7", "9", "7sus4"))
            connected_dominant_cadences = sum(1 for a, b in cadence_pairs
                                    if pitch_class(b["root"]) == pc and _tonic_quality_matches(b, mode)
                                    and (pitch_class(a["root"]) - pc) % 12 == 7
                                    and a["quality"] in ("maj", "7", "9", "7sus4"))
            # Repeated I-IV motion in a modal loop can look like V-I in a
            # neighbouring key. An observed minor ii before V supplies separate
            # evidence for a major-key arrival; IV-V-I alone has that same ambiguity.
            predominant_cadences = sum(1 for (a, b), (middle, c) in
                zip(cadence_pairs, cadence_pairs[1:])
                if b is middle and mode == "major"
                and pitch_class(c["root"]) == pc and _tonic_quality_matches(c, mode)
                and (pitch_class(b["root"]) - pc) % 12 == 7
                and b["quality"] in ("maj", "7", "9")
                and (pitch_class(a["root"]) - pc) % 12 == 2
                and a["quality"].startswith("min")
                and {(pc + interval) % 12 for interval in (2, 5, 9)} <=
                    set(a.get("grounded_chord_tones", a["chord_tones"])))
            cadence = min(1, cadences / max(1, len(chord_events) / 6))
            connected_cadences = sum(1 for a, b in cadence_pairs
                           if pitch_class(b["root"]) == pc and _tonic_quality_matches(b, mode)
                           and (pitch_class(a["root"]) - pc) % 12 in (7, 5))
            connected_cadence_bonus = .08 * (min(1, connected_cadences /
                                                 max(1, len(chord_events) / 6)) - cadence)
            bookends = sum(pitch_class(e["root"]) == pc for e in (chord_events[:1] + chord_events[-1:])) / 2
            # A major/minor tonic must be present with the corresponding third
            # before calling this conventional tonality, rather than a mode.
            supported_tonic = any(pitch_class(e["root"]) == pc and _tonic_quality_matches(e, mode)
                                  for e in chord_events)
            tonic_regions, previous_root = 0, None
            for event in chord_events:
                current_root = pitch_class(event["root"])
                if (current_root != previous_root and current_root == pc
                        and _tonic_quality_matches(event, mode)):
                    tonic_regions += 1
                previous_root = current_root
            score = fit * .38 + corr * .37 + tonic * .12 + cadence * .08 + bookends * .05
            candidates.append({"pc": pc, "mode": mode, "score": score, "fit": fit,
                               "correlation": corr, "tonic_supported": supported_tonic,
                               "dominant_cadences": dominant_cadences, "tonic_weight": tonic,
                               "connected_dominant_cadences": connected_dominant_cadences,
                               "connected_cadence_bonus": connected_cadence_bonus,
                               "predominant_dominant_cadences": predominant_cadences,
                               "observed_tonic_regions": tonic_regions,
                               "compatible_quality_regions": sum(e["_quality_observed"]
                                   and set(e["chord_tones"]) <= scale for e in chord_events)})
    candidates.sort(key=lambda c: c["score"], reverse=True)
    # A pitch-histogram winner with no authentic cadence must not defeat a grounded cadential home
    # whose collection explains every observed multi-note chord, including
    # power chords. Require repeated tonic returns and independently observed
    # scale distinctions; retain relative tonic uncertainty within collection.
    raw_best = candidates[0]
    histogram_margin = candidates[0]["score"] - candidates[1]["score"]
    multi_regions = grounded_harmony
    def candidate_collection(candidate):
        return {(candidate["pc"] + degree) % 12 for degree in
                SCALES["major" if candidate["mode"] == "major" else "natural_minor"]}
    def unexplained(candidate):
        palette = candidate_collection(candidate)
        count, previous = 0, None
        for event in multi_regions:
            signature = (pitch_class(event["root"]),
                         not set(event["grounded_chord_tones"]) <= palette)
            # Changing the voicing of one opposing root is still one visit.
            if signature != previous and signature[1]:
                count += 1
            previous = signature
        return count
    selected_collection = None
    if raw_best["dominant_cadences"] == 0 and unexplained(raw_best) >= 2:
        eligible = [c for c in candidates if c["tonic_supported"]
                    and c["connected_dominant_cadences"] >= 2 and c["observed_tonic_regions"] >= 2
                    and c["predominant_dominant_cadences"] >= 1
                    and c["fit"] >= .97 and c["correlation"] >= .45
                    and unexplained(c) == 0
                    and not _ambiguous_collections(c, candidates, note_weights)]
        palettes = {tuple(sorted(candidate_collection(c))) for c in eligible}
        if len(palettes) == 1:
            selected_collection = next(iter(palettes))
            for candidate in candidates:
                if tuple(sorted(candidate_collection(candidate))) == selected_collection:
                    candidate["dominant_cadences"] = candidate["connected_dominant_cadences"]
                    candidate["score"] += candidate["connected_cadence_bonus"]
            candidates.sort(key=lambda c: (tuple(sorted(candidate_collection(c))) == selected_collection,
                                            c["score"]), reverse=True)
    best, second = candidates[:2]
    margin = best["score"] - second["score"]
    enough = best["fit"] >= .80 and best["correlation"] >= .45 and margin >= .025
    # A note-only riff can suggest a tonic, but does not authorize a full scale
    # as a conventional major/minor key without its defining third/context.
    enough = enough and best["tonic_supported"]
    relative_pc = (best["pc"] + (9 if best["mode"] == "major" else 3)) % 12
    relative = next(c for c in candidates if c["pc"] == relative_pc and c["mode"] != best["mode"])
    # A brief vi/III chord does not make an otherwise sustained home ambiguous.
    # Comparable relative-tonic durations without a dominant cadence do: window
    # bookends/profile margins alone cannot resolve a balanced repeating loop.
    # Nor can a duration advantage override an observed authentic cadence to
    # the relative tonic when the preferred tonic has no such cadence itself.
    relative_ambiguous = (best["tonic_supported"] and relative["tonic_supported"]
                          and not best["dominant_cadences"]
                          and (best["tonic_weight"] < 2 * relative["tonic_weight"]
                               or relative["dominant_cadences"] > 0))
    ambiguous_collections = _ambiguous_collections(best, candidates, note_weights)
    # A long V can dominate a pitch histogram despite repeated V-I motion.
    # If another observed tonic has repeated authentic cadences and explains
    # every grounded quality chord, do not promote the long dominant to a key
    # whose scale contradicts multiple of those chords. Keep only the supported
    # collection when its distinguishing degrees are independently observed.
    quality_regions = sum(e["_quality_observed"] for e in chord_events)
    dominant_alternative = next((candidate for candidate in candidates
        if not best["dominant_cadences"] and candidate["tonic_supported"]
        and candidate["dominant_cadences"] >= 2
        and candidate["compatible_quality_regions"] == quality_regions
        and best["compatible_quality_regions"] <= quality_regions - 2), None)
    # A repeatedly played tonic with its third can establish a major/minor
    # home without establishing every scale degree (for example Em-Am-Em).
    # Keep that identity separate from permission to publish a seven-note scale.
    anchored_tonic = (best["tonic_supported"] and best["observed_tonic_regions"] >= 2
                      and best["tonic_weight"] >= .6 and quality_regions >= 4
                      and best["fit"] >= .94 and margin >= .09
                      and not relative_ambiguous and not dominant_alternative)
    enough = enough and not relative_ambiguous and not dominant_alternative
    enough = enough and (not ambiguous_collections or anchored_tonic)
    details = {"method": "pitch_chord_cadence", "pitch_fit": round(best["fit"], 4),
               "margin": round(margin, 4), "chord_regions": len(chord_events),
               "observed_quality_regions": sum(e["_quality_observed"] for e in chord_events),
               "observed_quality_roots": len({pitch_class(e["root"]) for e in chord_events if e["_quality_observed"]}),
               "tonic_quality_observed": best["tonic_supported"],
               "dominant_cadences": best["dominant_cadences"],
               "articulated_chord_connections": articulated_pairs,
               "tonic_duration_share": round(best["tonic_weight"], 4),
               "observed_tonic_regions": best["observed_tonic_regions"],
               "repeated_tonic_anchor": anchored_tonic,
               "scale_degrees_resolved": not bool(ambiguous_collections),
               "relative_tonic_duration_share": round(relative["tonic_weight"], 4),
               "relative_dominant_cadences": relative["dominant_cadences"],
               "candidates": [{"key": _NAMES[c["pc"]] + (" minor" if c["mode"] == "minor" else " major"),
                               "score": round(c["score"], 4)} for c in candidates[:3]]}
    if selected_collection:
        details["selection_basis"] = "grounded_collection_with_repeated_dominant_cadences"
        details["margin_scope"] = "within_supported_pitch_collection"
        details["score_basis"] = "local_profile_with_connected_cadences_in_supported_collection"
        details["collection_consistency"] = {
            "pitch_classes": list(selected_collection),
            "predominant_dominant_cadences": best["predominant_dominant_cadences"],
            "observed_multi_note_regions": len(multi_regions),
            "selected_collection_incompatible_regions": unexplained(best),
            "histogram_winner_incompatible_regions": unexplained(raw_best),
            "histogram_winner": {"key": _NAMES[raw_best["pc"]] + " " + raw_best["mode"],
                                 "score": round(raw_best["score"], 4)},
            "histogram_margin": round(histogram_margin, 4),
        }
    if enough:
        conflict = _repeated_collection_conflict(best, candidates, note_weights, grounded_harmony)
        if conflict:
            details["reason"] = "recurrent_grounded_collection_conflict"
            details["collection_conflict"] = conflict
            return {"unknown": True, "confidence": "low", "evidence": details}
    if not enough:
        details["reason"] = "unresolved_scale_degrees" if ambiguous_collections else (
            "dominant_tonic_ambiguity" if dominant_alternative else
            "relative_major_minor_ambiguity" if relative_ambiguous else "ambiguous_tonality")
        if ambiguous_collections:
            details["ambiguous_collections"] = ambiguous_collections[:3]
        # Relative major/minor keys share a pitch collection. Their uncertain
        # home can remain unknown while that supported collection is useful.
        if (not ambiguous_collections and best["fit"] >= .97
                and (relative_ambiguous or (second["pc"] == relative_pc and second["mode"] != best["mode"]))
                and len(chord_events) >= 4 and best["tonic_supported"]):
            details["shared_scale"] = {"root": _NAMES[best["pc"]],
                                       "type": "major" if best["mode"] == "major" else "natural_minor"}
        if (dominant_alternative and dominant_alternative["fit"] >= .97
                and not _ambiguous_collections(dominant_alternative, candidates, note_weights)):
            details["shared_scale"] = {"root": _NAMES[dominant_alternative["pc"]],
                "type": "major" if dominant_alternative["mode"] == "major" else "natural_minor"}
            details["collection_basis"] = "compatible_progression_with_repeated_dominant_cadences"
        return {"unknown": True, "confidence": "low", "evidence": details}
    root = _NAMES[best["pc"]]
    if ambiguous_collections:
        details["reason"] = "tonic_supported_palette_unresolved"
        details["ambiguous_collections"] = ambiguous_collections[:3]
    confidence = "high" if margin >= .09 and best["fit"] >= .94 and not ambiguous_collections and not selected_collection else "medium"
    return {"key": root + " " + best["mode"], "mode": best["mode"], "root": root,
            "confidence": confidence, "evidence": details}


def _beat_coordinates(beats, fallback):
    """Interpolate the authored beat clock, including tempo changes and ends."""
    if len(beats) < 2:
        return (lambda t: t / fallback), (lambda b: b * fallback)

    def position(t):
        index = max(0, min(len(beats) - 2, bisect_right(beats, t) - 1))
        return index + (t - beats[index]) / (beats[index + 1] - beats[index])

    def seconds(b):
        index = max(0, min(len(beats) - 2, math.floor(b)))
        return beats[index] + (b - index) * (beats[index + 1] - beats[index])

    return position, seconds


def _tonal_identity(estimate):
    if not estimate.get("unknown"):
        return ("key", estimate["key"], estimate.get("evidence", {}).get("scale_degrees_resolved", True))
    shared = estimate.get("evidence", {}).get("shared_scale")
    if shared:
        return ("collection", tuple(sorted((pitch_class(shared["root"]) + interval) % 12
                                            for interval in SCALES[shared["type"]])))
    return None


def _tonal_collection(estimate):
    shared = estimate.get("evidence", {}).get("shared_scale")
    if shared:
        root, scale = shared["root"], shared["type"]
    elif not estimate.get("unknown"):
        root = estimate["root"]
        scale = "natural_minor" if estimate["mode"] == "minor" else "major"
    else:
        return set()
    return {(pitch_class(root) + interval) % 12 for interval in SCALES[scale]}


def _key_timeline(source, observations, harmony, beat, cancelled):
    """Publish stable local contexts; never fill unresolved spans from a song key.

    Overlapping windows are a stability check, not independent votes. A final
    span must pass a fresh estimate of its own raw evidence. Long uncharted
    gaps bound all contexts. Authored phrase boundaries additionally propose
    bounded contexts, which must pass the same musical evidence checks.
    """
    duration = source["duration"]
    position, seconds = _beat_coordinates(source["beats"], beat)
    # Bound work on exceptionally long charts without turning beat counts into
    # median-tempo seconds. Ordinary songs use 8-beat cells / 32-beat contexts.
    step = 8 * max(1, math.ceil((position(duration) - position(0)) / (8 * 512)))
    width, minimum_span = 4 * step, 3 * step
    regions = []
    for event in harmony:
        if (event.get("unknown") or event.get("confidence") == "low"
                or len(event.get("grounded_chord_tones", [])) < 2
                or not event.get("evidence", {}).get("root_observed")):
            continue
        if regions and position(event["t"]) - position(regions[-1][1]) <= 4:
            regions[-1][1] = event["end"]
        else:
            regions.append([event["t"], event["end"]])
    observations = sorted(observations, key=lambda event: event["t"])
    observation_times = [event["t"] for event in observations]
    longest_observation = max((e["end"] - e["t"] for e in observations), default=0)
    harmony_times = [event["t"] for event in harmony]
    cache = {}

    def estimate(start, end):
        _check(cancelled)
        token = (round(start, 6), round(end, 6))
        if token in cache:
            return cache[token]
        if len(cache) >= 1024:
            return {"unknown": True, "confidence": "low", "evidence": {"reason": "local_context_budget"}}
        cadence_start = seconds(position(start) - .5)
        first = bisect_left(observation_times, cadence_start - longest_observation)
        last = bisect_left(observation_times, end)
        a = max(0, bisect_left(harmony_times, cadence_start) - 1)
        b = bisect_left(harmony_times, end)
        value = _estimate_key(observations[first:last], harmony[a:b], start, end, position)
        details = {**value["evidence"], "scope": "local", "context_start": round(start, 6),
                   "context_end": round(end, 6), "context_beats": round(position(end) - position(start), 4)}
        # Root and quality observations must span a progression, not a single
        # dyad/triad plus a few unrelated scale pitches elsewhere in the song.
        if (details.get("observed_quality_regions", 0) < 4
                or details.get("observed_quality_roots", 0) < 2):
            details.pop("shared_scale", None)
            if not value.get("unknown"):
                details["reason"] = "insufficient_local_progression"
            value = {"unknown": True, "confidence": "low"}
        value = {**value, "evidence": details}
        cache[token] = value
        return value

    def sufficient_span(start, end, value):
        size = position(end) - position(start)
        if size >= minimum_span - _EPS:
            return True
        details = value.get("evidence", {})
        rich_progression = (details.get("observed_quality_regions", 0) >= 6
                            and details.get("observed_quality_roots", 0) >= 3)
        return (size >= 2 * step - _EPS and not value.get("unknown")
                and (details.get("repeated_tonic_anchor") or rich_progression))

    def propose(start, end, region, context=None):
        value = estimate(*(context or (start, end)))
        identity = _tonal_identity(value)
        if not identity:
            return None
        collection = _tonal_collection(value)
        a = max(0, bisect_right(harmony_times, start) - 1)
        b = bisect_left(harmony_times, end)
        qualified = [e for e in harmony[a:b] if e["end"] > start
                     and not e.get("unknown") and e.get("confidence") != "low"
                     and _quality_is_observed(e)]
        compatible = [e for e in qualified if set(e["grounded_chord_tones"]) <= collection]
        if not compatible:
            return None
        start, end = max(start, compatible[0]["t"]), min(end, compatible[-1]["end"])
        local_quality = [e for e in qualified if e["end"] > start and e["t"] < end]
        if any(position(b["t"]) - position(a["end"]) > 4
               for a, b in zip(local_quality, local_quality[1:])):
            return None
        local = estimate(start, end)
        if _tonal_identity(local) != identity:
            return None
        if context:
            # Nearby played notes can lengthen the analysis context, never its
            # published key span or its supply of observed chord qualities.
            if (position(end) - position(start) < step - _EPS
                    or not local["evidence"].get("repeated_tonic_anchor")):
                return None
            value = estimate(*context)
        else:
            value = local
        context_start, context_end = context or (start, end)
        if not sufficient_span(context_start, context_end, value):
            return None
        if context:
            value = {**value, "evidence": {**value["evidence"], "context_basis": "continuous_played_notes",
                     "quality_start": round(start, 6), "quality_end": round(end, 6)}}
        return {"start": start, "end": end, "identity": identity, "value": value, "region": region}

    cells, accepted, proposals = [], [], []
    for region_start, region_end in regions:
        first, last = position(region_start), position(region_end)
        region_cells = []
        cursor = first
        while cursor < last - _EPS:
            stop = min(last, cursor + step)
            center = (cursor + stop) / 2
            context_start = max(first, min(center - width / 2, last - width))
            context_end = min(last, context_start + width)
            value = estimate(seconds(context_start), seconds(context_end))
            cell = {"start": seconds(cursor), "end": seconds(stop), "value": value,
                    "identity": _tonal_identity(value), "region": (region_start, region_end)}
            cells.append(cell)
            region_cells.append(cell)
            cursor = stop
        index = 0
        while index < len(region_cells):
            stop = index + 1
            identity = region_cells[index]["identity"]
            while stop < len(region_cells) and region_cells[stop]["identity"] == identity:
                stop += 1
            start, end = region_cells[index]["start"], region_cells[stop - 1]["end"]
            if identity and position(end) - position(start) >= 2 * step - _EPS:
                local = estimate(start, end)
                if _tonal_identity(local) == identity:
                    if position(end) - position(start) >= minimum_span - _EPS:
                        accepted.append({"start": start, "end": end, "identity": identity,
                                         "value": local, "region": (region_start, region_end)})
                    elif sufficient_span(start, end, local):
                        candidate = propose(start, end, (region_start, region_end))
                        if candidate and len(proposals) < 256:
                            proposals.append(candidate)
            index = stop

    activity = []
    for index, observation in enumerate(observations):
        if index % 256 == 0:
            _check(cancelled)
        if observation["weight"] < .5:
            continue
        if activity and position(observation["t"]) - position(activity[-1][1]) <= 2:
            activity[-1][1] = max(activity[-1][1], observation["end"])
        else:
            activity.append([observation["t"], observation["end"]])
    activity_times = [span[0] for span in activity]
    for region_index, (start, end) in enumerate(regions):
        if region_index % 64 == 0:
            _check(cancelled)
        if len(proposals) >= 256:
            break
        if not step <= position(end) - position(start) < minimum_span:
            continue
        index = bisect_right(activity_times, start + _EPS) - 1
        # Chart attacks can expire before their bounded two-beat chord hold.
        # Match that existing evidence lifetime without filling a longer gap.
        if index < 0 or position(end) - position(activity[index][1]) > 2:
            continue
        context = (min(start, max(0, activity[index][0], seconds(position(start) - step))),
                   max(end, min(duration, activity[index][1], seconds(position(end) + step))))
        candidate = propose(start, end, (start, end), context)
        if candidate:
            proposals.append(candidate)

    section_times = {_number(section.get("t")) for section in source.get("sections", [])}
    section_times.update(_number(section.get("end")) for section in source.get("sections", []))
    # Centered windows blur short phrases with both neighbouring keys. Authored
    # boundaries propose separate raw-evidence contexts; their names supply no
    # key information. Adjacent short phrases may form one tonal statement.
    # A proposal never overrules an already stable different local context.
    for region_start, region_end in regions:
        boundaries = sorted({region_start, region_end, *(t for t in section_times
                              if region_start < t < region_end)})
        for index, start in enumerate(boundaries[:-1]):
            if index % 64 == 0:
                _check(cancelled)
            for end in boundaries[index + 1:index + 5]:
                size = position(end) - position(start)
                if size < 2 * step - _EPS or size > width * 2:
                    continue
                candidate = propose(start, end, (region_start, region_end))
                if candidate and size > width * 1.5:
                    candidate_value = candidate["value"]
                    palette = _tonal_collection(candidate_value)
                    multi_chords = [e for e in harmony if e["end"] > candidate["start"]
                                    and e["t"] < candidate["end"] and not e.get("unknown")
                                    and len(e.get("grounded_chord_tones", [])) >= 2
                                    and pitch_class(e.get("root")) in e.get("grounded_chord_tones", [])]
                    if (candidate_value.get("unknown")
                            or candidate_value["evidence"].get("selection_basis") !=
                            "grounded_collection_with_repeated_dominant_cadences"
                            or candidate_value["evidence"].get("dominant_cadences", 0) < 2
                            or any(not set(e["grounded_chord_tones"]) <= palette for e in multi_chords)):
                        candidate = None
                if candidate:
                    proposals.append(candidate)
                if len(proposals) >= 256:
                    break
            if len(proposals) >= 256:
                break
        if len(proposals) >= 256:
            break
    # Process phrases in time order. Sorting solely by pitch fit lets a short
    # IV/pivot fragment claim space before the preceding tonic context can be
    # extended to its own supported boundary.
    proposals.sort(key=lambda span: (span["start"], -(span["end"] - span["start"])))
    for proposal in proposals:
        _check(cancelled)
        value = proposal["value"]
        if not value.get("unknown"):
            neighbouring = [span for span in accepted if span["identity"] != proposal["identity"]
                           and span["value"].get("key") != value.get("key")
                           and ((0 <= position(proposal["start"]) - position(span["end"]) <= width)
                                or (0 <= position(span["start"]) - position(proposal["end"]) <= width))]
            edge_index = bisect_right(harmony_times, proposal["start"] + _EPS) - 1
            edge = harmony[edge_index] if edge_index >= 0 else {}
            played = set(edge.get("grounded_chord_tones", []))
            details = value["evidence"]
            repeated_cadences = (details.get("dominant_cadences", 0) >= 2
                                 and details.get("pitch_fit", 0) >= .94
                                 and details.get("margin", 0) >= .065)
            # A compatible IV/pivot is not by itself a modulation. A shorter
            # phrase contradicting a stable neighbour must begin on an observed
            # distinguishing tonic, or independently repeat a clear cadence.
            if not repeated_cadences and any(
                    pitch_class(edge.get("root")) != pitch_class(value["root"])
                    or not _quality_is_observed(edge)
                    or not played & (_tonal_collection(value) - _tonal_collection(span["value"]))
                    for span in neighbouring):
                continue
        if any(span["identity"] != proposal["identity"]
               and span["start"] < proposal["end"] - _EPS
               and span["end"] > proposal["start"] + _EPS for span in accepted):
            continue
        neighbours = [span for span in accepted if span["region"] == proposal["region"]
                      and span["identity"] == proposal["identity"]
                      and span["start"] <= proposal["end"] + _EPS
                      and span["end"] >= proposal["start"] - _EPS]
        start = min([proposal["start"]] + [span["start"] for span in neighbours])
        end = max([proposal["end"]] + [span["end"] for span in neighbours])
        contexts = [proposal] + neighbours
        context_start = min([start] + [span["value"]["evidence"].get("context_start", span["start"]) for span in contexts])
        context_end = max([end] + [span["value"]["evidence"].get("context_end", span["end"]) for span in contexts])
        value = estimate(context_start, context_end)
        if _tonal_identity(value) != proposal["identity"]:
            continue
        if context_start < start - _EPS or context_end > end + _EPS:
            value = {**value, "evidence": {**value["evidence"], "context_basis": "continuous_played_notes",
                     "quality_start": round(start, 6), "quality_end": round(end, 6)}}
        accepted = [span for span in accepted if span not in neighbours]
        accepted.append({**proposal, "start": start, "end": end, "value": value})
    accepted.sort(key=lambda span: span["start"])
    for left, right in zip(accepted, accepted[1:]):
        if (left["region"] != right["region"] or left["identity"] == right["identity"]
                or position(right["start"]) - position(left["end"]) > width):
            continue
        boundaries = sorted({t for t in harmony_times + list(section_times)
                             if left["end"] - _EPS <= t <= right["start"] + _EPS})
        if len(boundaries) > 32:
            boundaries = [boundaries[round(i * (len(boundaries) - 1) / 31)] for i in range(32)]
        choices = []
        old_collection = _tonal_collection(left["value"])
        new_collection = _tonal_collection(right["value"])
        for boundary in boundaries:
            chord_index = bisect_right(harmony_times, boundary + _EPS) - 1
            chord = harmony[chord_index] if chord_index >= 0 else {}
            played = set(chord.get("grounded_chord_tones", []))
            # A shared pivot or a borrowed/secondary dominant is not evidence
            # that the new key already began. Refine only at compatible,
            # distinguishing played pitches; otherwise retain uncertainty.
            if (chord.get("unknown") or not played <= new_collection
                    or not played & (new_collection - old_collection)):
                continue
            before = max(left["start"], seconds(position(boundary) - width))
            after = min(right["end"], seconds(position(boundary) + width))
            if min(position(boundary) - position(before), position(after) - position(boundary)) < minimum_span:
                continue
            a, b = estimate(before, boundary), estimate(boundary, after)
            if _tonal_identity(a) != left["identity"] or _tonal_identity(b) != right["identity"]:
                continue
            fit = min(a["evidence"].get("pitch_fit", 0), b["evidence"].get("pitch_fit", 0))
            margin = min(a["evidence"].get("margin", 0), b["evidence"].get("margin", 0))
            if fit >= .94 and margin >= .065:
                choices.append((fit, margin, boundary in section_times, boundary))
        if choices:
            boundary = max(choices)[-1]
            # Verify the expanded spans as well; successful short boundary
            # probes are not permission to overrule their remaining context.
            a, b = estimate(left["start"], boundary), estimate(boundary, right["end"])
            if _tonal_identity(a) == left["identity"] and _tonal_identity(b) == right["identity"]:
                left["end"], left["value"] = boundary, a
                right["start"], right["value"] = boundary, b

    points = sorted({0, duration, *(t for c in cells + accepted for t in (c["start"], c["end"]))})
    cell_times = [cell["start"] for cell in cells]
    events = []
    for start, end in zip(points, points[1:]):
        stable = next((span for span in accepted if span["start"] <= start + _EPS < span["end"] - _EPS), None)
        if stable:
            value = stable["value"]
            value = {**value, "evidence": {**value["evidence"], "selection": "stable_local_context",
                                          "stability_is_independent_votes": False}}
        else:
            index = bisect_right(cell_times, start + _EPS) - 1
            cell = cells[index] if index >= 0 and start < cells[index]["end"] - _EPS else None
            value = cell["value"] if cell else _unknown(start, end, "no_local_chord_context")
            details = {**value["evidence"]}
            if _tonal_identity(value):
                details["reason"] = "unstable_local_tonality"
            details.pop("shared_scale", None)
            value = {"unknown": True, "confidence": "low", "evidence": details}
        _append_event(events, {**value, "t": round(start, 6), "end": round(end, 6)})
    return events


def _scale_timeline(keys, harmony, duration):
    points = sorted({0, duration, *(t for event in keys + harmony for t in (event["t"], event["end"]))})
    key_times, chord_times = [event["t"] for event in keys], [event["t"] for event in harmony]
    events = []
    for t, end in zip(points, points[1:]):
        key = keys[bisect_right(key_times, t) - 1] if keys and t >= key_times[0] else None
        chord = harmony[bisect_right(chord_times, t) - 1] if harmony and t >= chord_times[0] else None
        shared_scale = key.get("evidence", {}).get("shared_scale") if key else None
        if (not key or (key.get("unknown") and not shared_scale) or not chord
                or chord.get("unknown") or chord.get("confidence") == "low"
                or chord.get("evidence", {}).get("root_observed") is False
                or len(chord.get("grounded_chord_tones", chord.get("chord_tones", []))) < 2):
            _append_event(events, _unknown(t, end, "insufficient_scale_context"))
            continue
        if key.get("evidence", {}).get("scale_degrees_resolved") is False:
            _append_event(events, _unknown(t, end, "unresolved_scale_degrees"))
            continue
        root = shared_scale["root"] if shared_scale else key["root"]
        pc = pitch_class(root)
        scale_id = shared_scale["type"] if shared_scale else "natural_minor" if key["mode"] == "minor" else "major"
        tones = set(chord["chord_tones"])
        scale = {(pc + interval) % 12 for interval in SCALES[scale_id]}
        reason = ("supported_collection_with_uncertain_tonic"
                  if shared_scale and key.get("evidence", {}).get("collection_basis")
                  else "relative_keys_share_pitch_collection" if shared_scale else "key_and_chord_agree")
        if not tones <= scale and key.get("mode") == "minor":
            # Raised leading note over V/vii in minor has explicit functional
            # context; unrelated modal substitutions are withheld.
            relative_root = (pitch_class(chord["root"]) - pc) % 12
            harmonic = {(pc + interval) % 12 for interval in SCALES["harmonic_minor"]}
            if relative_root in (7, 11) and tones <= harmonic:
                scale_id, scale, reason = "harmonic_minor", harmonic, "minor_dominant"
        if not tones <= scale:
            _append_event(events, _unknown(t, end, "chromatic_harmony_no_supported_scale"))
            continue
        _append_event(events, {"t": round(t, 6), "end": round(end, 6), "root": root,
                               "type": scale_id, "confidence": "medium",
                               "evidence": {"reason": reason, "compatible_chord_tones": sorted(tones)}})
    return events


def analyse_harmony(source: dict, options=None, cancelled=None) -> dict:
    """Return JSON-safe bounded key, chord/target and independent scale tracks.

    Source must be the read-only adapter's normalized contract. ``options`` is
    reserved/versioned by the caller; this initial algorithm has no tuning knobs
    that can quietly convert uncertainty into certainty.
    """
    _check(cancelled)
    duration = max(0, _number(source.get("duration")))
    source = {**source, "duration": duration}
    beats = sorted({_number(t) for t in source.get("beats", []) if isinstance(t, (int, float)) and math.isfinite(t)})
    source["beats"] = beats
    beat = _beat_length(beats)
    evidence, observations, diagnostics = _evidence(source, beat, cancelled)
    harmony = _chord_timeline(evidence, duration, cancelled)
    _check(cancelled)
    keys = _key_timeline(source, observations, harmony, beat, cancelled)
    scales = _scale_timeline(keys, harmony, duration)
    _check(cancelled)
    coverage = lambda track: round(sum(event["end"] - event["t"] for event in track if not event.get("unknown")) / duration, 4) if duration else 0
    chord_coverage, key_coverage, scale_coverage = coverage(harmony), coverage(keys), coverage(scales)
    status = "unsupported" if not evidence else "complete" if min(chord_coverage, key_coverage, scale_coverage) >= .9 else "partial"
    return {"version": 1, "algorithm_version": ALGORITHM_VERSION,
            "normalization_version": source.get("normalization_version", "unknown"),
            "revision": source.get("revision"), "fingerprint": source.get("fingerprint"),
            "source": "charts", "status": status, "duration": duration,
            "keys": {"version": 1, "events": keys}, "harmony": {"version": 1, "events": harmony},
            "scales": {"version": 1, "events": scales},
            "diagnostics": list(source.get("diagnostics", [])) + diagnostics,
            "summary": {"arrangements": len(source.get("arrangements", [])),
                        "evidence_windows": len(evidence), "chord_coverage": chord_coverage,
                        "key_coverage": key_coverage, "scale_coverage": scale_coverage,
                        "root_only_coverage": round(sum(e["end"] - e["t"] for e in harmony if not e.get("unknown") and not e.get("quality")) / duration, 4) if duration else 0,
                        "limitations": ["Chart estimates have not been verified against the recording.",
                                        "Ambiguous keys, uncharted accompaniment and unsupported chromatic scales are withheld.",
                                        "Bass-only roots are tentative; no chord quality is inferred from them."]}}
