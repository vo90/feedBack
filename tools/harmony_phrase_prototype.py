"""Research-only phrase collection decoder; never imported by the runtime.

This isolates collection inference from tonic inference: production v5 supplies
the unchanged key/chord tracks, while a whole-sequence decoder supplies scale
collections. Relative major/minor labels are one state, not competing keys.
The score is an experimental objective, not a calibrated probability.

Frozen evaluations put ``production-engine.py`` beside this file. Otherwise the
repository's production module is loaded explicitly. No chart or cache is read
or written here; the input is the existing normalized chart contract.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import Counter, defaultdict
import importlib.util
import math
from pathlib import Path


_DEPENDENCY = Path(__file__).with_name("production-engine.py")
if not _DEPENDENCY.is_file():
    _DEPENDENCY = Path(__file__).resolve().parents[1] / "lib" / "harmony_analysis.py"
_SPEC = importlib.util.spec_from_file_location("phrase_production_engine", _DEPENDENCY)
_BASE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_BASE)

ALGORITHM_VERSION = "chart-harmony-phrase-research-v1"
PRODUCTION_ALGORITHM_VERSION = _BASE.ALGORITHM_VERSION
SCALES = _BASE.SCALES
pitch_class = _BASE.pitch_class
AnalysisCancelled = _BASE.AnalysisCancelled
DEFAULT_OPTIONS = {"phrase_beats": 8.0, "switch_cost": 1.0, "minimum_margin": .15}


def _options(options):
    result = dict(DEFAULT_OPTIONS)
    options = options or {}
    if not isinstance(options, dict) or set(options) - set(result):
        raise ValueError("Unknown phrase-prototype options")
    result.update(options)
    for name, value in result.items():
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value < 0
                or (name == "phrase_beats" and value < 1)):
            raise ValueError(f"Invalid phrase-prototype option: {name}")
    return result


def _candidates():
    # Natural minor duplicates its relative major pitch set. Represent that
    # state once; an independently known minor tonic chooses its display later.
    return [{"root": _BASE._NAMES[root], "type": family,
             "pcs": frozenset((root + note) % 12 for note in SCALES[family])}
            for family in ("major", "harmonic_minor") for root in range(12)]


def decode_collections(costs, switch_cost, cancelled=None):
    """Return the globally cheapest state path and per-position alternative gap.

    A gap compares the full best path through the chosen collection against
    the best full path through any different collection at that position.
    It is an objective-cost difference, not a posterior probability. Infinite
    emission costs disable individual candidates. Call separately across gaps.
    """
    if not costs:
        return [], []
    states = len(costs[0])
    if not states or any(len(row) != states for row in costs):
        raise ValueError("Collection costs must be a nonempty rectangular matrix")
    if any(not any(math.isfinite(value) for value in row) for row in costs):
        raise ValueError("Each phrase must have an admissible collection")
    forward, pointers = [list(costs[0])], [[-1] * states]
    for row in costs[1:]:
        _BASE._check(cancelled)
        current, links = [], []
        for state, emission in enumerate(row):
            previous = min(range(states), key=lambda prior:
                           forward[-1][prior] + (switch_cost if prior != state else 0))
            links.append(previous)
            current.append(emission + forward[-1][previous]
                           + (switch_cost if previous != state else 0))
        forward.append(current)
        pointers.append(links)
    path = [min(range(states), key=lambda state: forward[-1][state])]
    for index in range(len(costs) - 1, 0, -1):
        path.append(pointers[index][path[-1]])
    path.reverse()
    backward = [[0.0] * states for _ in costs]
    for index in range(len(costs) - 2, -1, -1):
        _BASE._check(cancelled)
        for state in range(states):
            backward[index][state] = min(
                costs[index + 1][following] + backward[index + 1][following]
                + (switch_cost if following != state else 0)
                for following in range(states))
    margins = []
    for index, chosen in enumerate(path):
        totals = [forward[index][state] + backward[index][state] for state in range(states)]
        alternative = min((value for state, value in enumerate(totals) if state != chosen),
                          default=math.inf)
        margins.append(max(0.0, alternative - totals[chosen]))
    return path, margins


def _regions(observations, harmony, position):
    intervals = [(event["t"], event["end"]) for event in observations if event["weight"] > 0]
    intervals += [(event["t"], event["end"]) for event in harmony if not event.get("unknown")]
    regions = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        # A four-beat unobserved break severs continuity. Smaller spaces may
        # support context, but the display still needs its own bounded chord.
        if regions and position(start) - position(regions[-1][1]) < 4:
            regions[-1][1] = max(regions[-1][1], end)
        else:
            regions.append([start, end])
    return regions


def _features(observations, harmony, start, end, position):
    chord_weights, note_weights = Counter(), Counter()
    quality_regions, quality_roots, minor_roots = 0, set(), set()
    for event in harmony:
        left, right = max(start, event["t"]), min(end, event["end"])
        if right <= left or event.get("unknown"):
            continue
        tones = event.get("grounded_chord_tones", event.get("chord_tones", []))
        if not tones:
            continue
        weight = (position(right) - position(left)) * (1 if event["confidence"] == "high" else .55)
        for pc in tones:
            chord_weights[pc] += weight / len(tones)
        if _BASE._quality_is_observed(event):
            quality_regions += 1
            root = pitch_class(event["root"])
            quality_roots.add(root)
            if event.get("quality", "").startswith("min"):
                minor_roots.add(root)
    slots = defaultdict(dict)
    for observation in observations:
        left, right = max(start, observation["t"]), min(end, observation["end"])
        if right <= left or observation["weight"] <= 0:
            continue
        weight = min(2, position(right) - position(left)) * observation["weight"]
        for pc in observation["pcs"]:
            slot = (round(position(observation["t"]) * 4), pc)
            value = weight / len(observation["pcs"])
            group = observation["group"]
            slots[slot][group] = max(slots[slot].get(group, 0), value)
    for (_, pc), groups in slots.items():
        note_weights[pc] += max(groups.values())
    total_chords, total_notes = sum(chord_weights.values()), sum(note_weights.values())
    if total_notes:
        factor = total_chords * .35 / total_notes if total_chords else 1
        for pc, value in note_weights.items():
            chord_weights[pc] += value * factor
    total = sum(chord_weights.values())
    # Ignore tiny approach/bend evidence when establishing missing degrees.
    observed = {pc for pc, weight in chord_weights.items() if total and weight / total >= .005}
    return {"weights": chord_weights, "total": total, "observed": observed,
            "quality_regions": quality_regions, "quality_roots": quality_roots,
            "minor_roots": minor_roots}


def _fit(feature, candidate):
    if not feature["total"]:
        return 0.0
    return sum(weight for pc, weight in feature["weights"].items()
               if pc in candidate["pcs"]) / feature["total"]


def _phrase_sequence(source, observations, harmony, options, cancelled):
    duration = source["duration"]
    position, seconds = _BASE._beat_coordinates(source["beats"], _BASE._beat_length(source["beats"]))
    candidates, cells = _candidates(), []
    length = options["phrase_beats"] * max(1, math.ceil(
        (position(duration) - position(0)) / (options["phrase_beats"] * 512)))
    sections = {float(event[name]) for event in source.get("sections", [])
                for name in ("t", "end") if isinstance(event.get(name), (int, float))
                and math.isfinite(event[name])}
    for start, end in _regions(observations, harmony, position):
        _BASE._check(cancelled)
        points = {start, end, *(time for time in sections if start < time < end)}
        for beat in range(math.floor(position(start) / length) + 1, math.ceil(position(end) / length)):
            time = seconds(beat * length)
            if start < time < end:
                points.add(time)
        points = sorted(points)
        region_cells = []
        for index, (left, right) in enumerate(zip(points, points[1:])):
            _BASE._check(cancelled)
            local = _features(observations, harmony, left, right, position)
            context = _features(observations, harmony, points[max(0, index - 1)],
                                points[min(len(points) - 1, index + 2)], position)
            enough = (local["total"] > 0 and len(context["observed"]) >= 5
                      and context["quality_regions"] >= 3 and len(context["quality_roots"]) >= 2)
            row = []
            beats = position(right) - position(left)
            for candidate in candidates:
                harmonic_allowed = (candidate["type"] != "harmonic_minor"
                    or (pitch_class(candidate["root"]) in context["minor_roots"]
                        and (pitch_class(candidate["root"]) + 11) % 12 in context["observed"]))
                row.append(beats * ((1 - _fit(local, candidate)) + .25 * (1 - _fit(context, candidate)))
                           if harmonic_allowed else math.inf)
            region_cells.append({"t": left, "end": right, "local": local, "context": context,
                                 "enough": enough, "costs": row})
        # Unsupported phrase contexts are hard boundaries, not free bridges
        # by which a distant confident collection can colonise sparse material.
        offset = 0
        while offset < len(region_cells):
            if not region_cells[offset]["enough"]:
                cells.append({**region_cells[offset], "candidate": None, "margin": 0.0})
                offset += 1
                continue
            stop = offset + 1
            while stop < len(region_cells) and region_cells[stop]["enough"]:
                stop += 1
            block = region_cells[offset:stop]
            path, margins = decode_collections([cell["costs"] for cell in block],
                                               options["switch_cost"], cancelled)
            for cell, state, margin in zip(block, path, margins):
                candidate = candidates[state]
                # Sequence support cannot rescue a locally incompatible phrase.
                known = (margin > 1e-9 and margin >= options["minimum_margin"]
                         and _fit(cell["local"], candidate) >= .80)
                cells.append({**cell, "candidate": candidate if known else None,
                              "chosen": candidate, "margin": margin})
            offset = stop
    return cells, length


def _at(events, starts, time):
    index = bisect_right(starts, time) - 1
    event = events[index] if index >= 0 else None
    return event if event and time < event["end"] else None


def _scales(cells, keys, harmony, duration, cancelled):
    points = sorted({0, duration, *(time for event in cells + keys + harmony
                                  for time in (event["t"], event["end"]))})
    starts = [[event["t"] for event in track] for track in (cells, keys, harmony)]
    result = []
    for index, (start, end) in enumerate(zip(points, points[1:])):
        if index % 128 == 0:
            _BASE._check(cancelled)
        cell, key, chord = [_at(track, times, start) for track, times in zip((cells, keys, harmony), starts)]
        candidate = cell.get("candidate") if cell else None
        tones = set(chord.get("grounded_chord_tones", chord.get("chord_tones", []))) if chord else set()
        if not candidate:
            event = _BASE._unknown(start, end, "phrase_collection_unresolved")
        elif (not chord or chord.get("unknown") or chord.get("confidence") == "low"
              or chord.get("evidence", {}).get("root_observed") is False or len(tones) < 2):
            event = _BASE._unknown(start, end, "insufficient_scale_context")
        elif not tones <= candidate["pcs"]:
            event = _BASE._unknown(start, end, "chromatic_harmony_no_supported_scale")
        else:
            root, family = candidate["root"], candidate["type"]
            tonic_known = False
            if key and not key.get("unknown"):
                key_family = "natural_minor" if key["mode"] == "minor" else "major"
                key_pcs = {(pitch_class(key["root"]) + note) % 12 for note in SCALES[key_family]}
                if key_pcs == candidate["pcs"]:
                    root, family, tonic_known = key["root"], key_family, True
                elif family == "harmonic_minor" and key.get("mode") == "minor" and key["root"] == root:
                    tonic_known = True
            event = {"t": round(start, 6), "end": round(end, 6), "root": root, "type": family,
                     "confidence": "medium", "evidence": {"reason": "phrase_collection_sequence",
                         "compatible_chord_tones": sorted(tones), "tonic_independently_known": tonic_known,
                         "path_cost_margin": round(cell["margin"], 6)}}
        if event.get("unknown"):
            _BASE._append_event(result, event)
        elif (result and not result[-1].get("unknown")
              and abs(result[-1]["end"] - event["t"]) < 1e-5
              and (result[-1]["root"], result[-1]["type"], result[-1]["evidence"]["tonic_independently_known"])
                  == (event["root"], event["type"], event["evidence"]["tonic_independently_known"])):
            result[-1]["end"] = event["end"]
            prior = result[-1]["evidence"]
            prior["path_cost_margin"] = min(prior["path_cost_margin"], event["evidence"]["path_cost_margin"])
            prior["compatible_chord_tones"] = sorted(set(prior["compatible_chord_tones"]) | tones)
        else:
            result.append(event)
    return result


def analyse_harmony(source: dict, options=None, cancelled=None) -> dict:
    """Benchmarkable alternative; production keys and harmony remain unchanged.

    ``switch_cost=0`` is the continuity ablation. ``phrase_beats`` controls the
    base cell size; authored section edges also split cells. ``minimum_margin``
    is a cost-gap threshold, not a confidence percentage. Defaults are frozen
    research constants and are not production or user-facing settings.
    """
    settings = _options(options)
    _BASE._check(cancelled)
    result = _BASE.analyse_harmony(source, cancelled=cancelled)
    source = {**source, "duration": result["duration"], "beats": sorted({float(time)
        for time in source.get("beats", []) if isinstance(time, (int, float)) and math.isfinite(time)})}
    _, observations, _ = _BASE._evidence(source, _BASE._beat_length(source["beats"]), cancelled)
    cells, phrase_beats = _phrase_sequence(source, observations, result["harmony"]["events"], settings, cancelled)
    result["scales"]["events"] = _scales(cells, result["keys"]["events"], result["harmony"]["events"],
                                       source["duration"], cancelled)
    result["algorithm_version"] = ALGORITHM_VERSION
    duration = source["duration"]
    result["summary"]["scale_coverage"] = round(sum(event["end"] - event["t"]
        for event in result["scales"]["events"] if not event.get("unknown")) / duration, 4) if duration else 0
    if result["status"] != "unsupported":
        result["status"] = "complete" if min(result["summary"][name]
            for name in ("chord_coverage", "key_coverage", "scale_coverage")) >= .9 else "partial"
    result["phrase_analysis"] = {"production_algorithm_version": PRODUCTION_ALGORITHM_VERSION,
        "options": settings, "effective_phrase_beats": phrase_beats,
        "keys_unchanged": True, "harmony_unchanged": True, "phrases": [{
            "t": round(cell["t"], 6), "end": round(cell["end"], 6),
            "collection_known": bool(cell.get("candidate")),
            "candidate": {name: cell["chosen"][name] for name in ("root", "type")} if cell.get("chosen") else None,
            "local_fit": round(_fit(cell["local"], cell["chosen"]), 6) if cell.get("chosen") else None,
            "path_cost_margin": round(cell["margin"], 6),
            "context_pcs": sorted(cell["context"]["observed"])} for cell in cells]}
    result["summary"]["limitations"].append(
        "Research collection decoder; unchanged production keys; path cost is not calibrated confidence.")
    _BASE._check(cancelled)
    return result
