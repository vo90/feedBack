"""Controlled research: supplied section keys plus unchanged chart harmony.

This does not estimate key accuracy. Its key track is an explicit experimental
assumption, including unknown intervals. The ``existing`` control asks what v5
would display if those section keys were available. ``minor_context`` tests one
narrow policy for incomplete/suspended dominants under a supplied minor tonic.
Neither policy implies that a major/minor key proves every playable scale note.

Frozen evaluations load the sibling ``production-engine.py``; a repository run
loads lib/harmony_analysis.py. This module has no runtime/cache integration.
"""

from __future__ import annotations

from bisect import bisect_right
import copy
import importlib.util
import math
from pathlib import Path
import re


_DEPENDENCY = Path(__file__).with_name("production-engine.py")
if not _DEPENDENCY.is_file():
    _DEPENDENCY = Path(__file__).resolve().parents[1] / "lib" / "harmony_analysis.py"
_SPEC = importlib.util.spec_from_file_location("known_key_production_engine", _DEPENDENCY)
_BASE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_BASE)

ALGORITHM_VERSION = "chart-harmony-known-key-research-v1"
PRODUCTION_ALGORITHM_VERSION = _BASE.ALGORITHM_VERSION
SCALES = _BASE.SCALES
pitch_class = _BASE.pitch_class
AnalysisCancelled = _BASE.AnalysisCancelled
DOMINANT_CONTEXT_BEATS = 4.0
_EPS = 1e-7


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_key_events(events, duration, cancelled=None):
    """Require an explicit, ordered, complete research timeline, including gaps.

    Caller evidence is deliberately discarded: a supplied key is an assumption,
    not proof that chart observations establish its degrees. Ambiguous events
    are represented as unknown even if the caller also included a key label.
    """
    if not _finite(duration) or duration < 0 or not isinstance(events, list):
        raise ValueError("Key events require a finite nonnegative duration and a list")
    if not events:
        if duration == 0:
            return []
        raise ValueError("Key events must explicitly cover the full duration, including unknown gaps")
    result, previous = [], 0.0
    for event in events:
        _BASE._check(cancelled)
        if not isinstance(event, dict) or not _finite(event.get("t")) or not _finite(event.get("end")):
            raise ValueError("Each key event needs finite t and end values")
        start, end = float(event["t"]), float(event["end"])
        if (abs(start - previous) > _EPS or start < 0 or end > duration + _EPS
                or end <= start or round(end, 6) <= round(start, 6)):
            raise ValueError("Key events must be sorted, contiguous, positive and bounded by the duration")
        start, end = previous, min(float(duration), end)
        if event.get("unknown") is True or event.get("ambiguous") is True:
            value = _BASE._unknown(start, end, "supplied_key_ambiguous" if event.get("ambiguous") else "supplied_key_unknown")
            # A caller's shared_scale must never bridge a deliberately unknown
            # reference interval or manufacture an alternative accepted key.
            value["evidence"]["key_basis"] = "externally_supplied_section_key"
        else:
            label = event.get("key")
            match = re.fullmatch(r"([A-Ga-g][#b♯♭]{0,2})\s+(major|minor)", label) if isinstance(label, str) else None
            if not match:
                raise ValueError("Known key events need an explicit '<root> major|minor' key")
            root, mode = match.groups()
            root = root[0].upper() + root[1:].replace("♯", "#").replace("♭", "b")
            if (("root" in event and pitch_class(event["root"]) != pitch_class(root))
                    or ("mode" in event and event["mode"] != mode)):
                raise ValueError("Supplied key, root and mode disagree")
            confidence = event.get("confidence", "high")
            if confidence not in ("low", "medium", "high"):
                raise ValueError("Unsupported key confidence label")
            value = {"t": round(start, 6), "end": round(end, 6), "root": root, "mode": mode,
                     "key": root + " " + mode, "confidence": confidence,
                     "evidence": {"reason": "research_key_assumption",
                                  "key_basis": "externally_supplied_section_key",
                                  "degree_basis": "conventional_family_assumed_from_supplied_key"}}
        result.append(value)
        previous = end
    if abs(previous - duration) > _EPS:
        raise ValueError("Key events must explicitly cover the full duration, including unknown gaps")
    return result


def _at(events, starts, time):
    index = bisect_right(starts, time) - 1
    value = events[index] if index >= 0 else None
    return value if value and time < value["end"] else None


def _minor_overrides(keys, harmony, beats, cancelled):
    """Bounded V-root context; no new tonic and no invented chord pitches.

    A thirdless V is compatible with natural and harmonic minor. A nearby
    observed major third can select the latter over the same dominant run.
    Otherwise this policy abstains on that palette. A minor third, unknown
    harmony, another root, a chart gap or key boundary severs the run.
    """
    position, seconds = _BASE._beat_coordinates(beats, _BASE._beat_length(beats))
    overrides = []
    for key in keys:
        _BASE._check(cancelled)
        if key.get("unknown") or key["mode"] != "minor":
            continue
        tonic = pitch_class(key["root"])
        dominant, natural_seventh, raised_seventh = (tonic + 7) % 12, (tonic + 10) % 12, (tonic + 11) % 12
        harmonic = {(tonic + degree) % 12 for degree in SCALES["harmonic_minor"]}
        runs, run = [], []
        for chord in harmony:
            left, right = max(key["t"], chord["t"]), min(key["end"], chord["end"])
            if right <= left:
                continue
            tones = set(chord.get("grounded_chord_tones", chord.get("chord_tones", [])))
            eligible = (not chord.get("unknown") and chord.get("confidence") != "low"
                        and pitch_class(chord.get("root")) == dominant and dominant in tones
                        and len(tones) >= 2 and natural_seventh not in tones and tones <= harmonic)
            if not eligible or (run and abs(run[-1]["end"] - left) > _EPS):
                if run:
                    runs.append(run)
                    run = []
            if eligible:
                run.append({"t": left, "end": right, "tones": tones, "chord": chord,
                            "anchor": raised_seventh in tones and _BASE._quality_is_observed(chord)})
        if run:
            runs.append(run)
        for run in runs:
            anchors = [piece for piece in run if piece["anchor"]]
            for piece in run:
                _BASE._check(cancelled)
                if raised_seventh in piece["tones"]:
                    continue  # The existing mapper already sees the altered note.
                windows = []
                for anchor in anchors:
                    left = max(piece["t"], seconds(position(anchor["t"]) - DOMINANT_CONTEXT_BEATS))
                    right = min(piece["end"], seconds(position(anchor["end"]) + DOMINANT_CONTEXT_BEATS))
                    if right > left + _EPS:
                        windows.append((left, right, anchor))
                points = sorted({piece["t"], piece["end"], *(time for left, right, _ in windows for time in (left, right))})
                for left, right in zip(points, points[1:]):
                    support = [anchor for start, end, anchor in windows if start <= left + _EPS and end >= right - _EPS]
                    if not support:
                        event = _BASE._unknown(left, right, "minor_dominant_third_unresolved")
                    else:
                        event = {"t": round(left, 6), "end": round(right, 6), "root": key["root"],
                            "type": "harmonic_minor", "confidence": "medium", "evidence": {
                                "reason": "bounded_observed_minor_dominant_context",
                                "raised_leading_note_basis": "neighboring_grounded_dominant",
                                "context_limit_beats": DOMINANT_CONTEXT_BEATS,
                                "anchors": [{"t": round(anchor["t"], 6), "end": round(anchor["end"], 6),
                                             "observed_pcs": sorted(anchor["tones"])} for anchor in support]}}
                    if event["end"] > event["t"]:
                        overrides.append(event)
    return sorted(overrides, key=lambda event: event["t"])


def _overlay(scales, overrides, duration, cancelled):
    if not overrides:
        return scales
    points = sorted({0, duration, *(time for event in scales + overrides for time in (event["t"], event["end"]))})
    scale_starts, override_starts = [event["t"] for event in scales], [event["t"] for event in overrides]
    result = []
    for left, right in zip(points, points[1:]):
        _BASE._check(cancelled)
        if round(right, 6) <= round(left, 6):
            continue
        event = _at(overrides, override_starts, left) or _at(scales, scale_starts, left)
        if event is None:
            event = _BASE._unknown(left, right, "insufficient_scale_context")
        result.append({**copy.deepcopy(event), "t": round(left, 6), "end": round(right, 6)})
    return result


def analyse_harmony(source: dict, options=None, cancelled=None) -> dict:
    """Return a controlled experiment with required explicit ``key_events``.

    ``policy='existing'`` is the v5 mapping with assumed keys, not an inferred
    improvement. ``policy='minor_context'`` additionally withholds thirdless
    minor-key V palettes unless bounded observed dominant context resolves the
    natural/raised seventh. Chart harmony remains byte-for-byte identical.
    """
    _BASE._check(cancelled)
    if (not isinstance(options, dict) or "key_events" not in options
            or set(options) - {"key_events", "policy"}):
        raise ValueError("Research analysis requires key_events and an optional supported policy")
    policy = options.get("policy", "existing")
    if policy not in ("existing", "minor_context"):
        raise ValueError("Supported policies are existing and minor_context")
    keys = validate_key_events(options["key_events"], source.get("duration"), cancelled)
    result = _BASE.analyse_harmony(source, cancelled=cancelled)
    harmony, duration = result["harmony"]["events"], result["duration"]
    scales = _BASE._scale_timeline(keys, harmony, duration)
    overrides = []
    if policy == "minor_context":
        beats = sorted({float(time) for time in source.get("beats", []) if _finite(time)})
        overrides = _minor_overrides(keys, harmony, beats, cancelled)
        scales = _overlay(scales, overrides, duration, cancelled)
    for event in scales:
        _BASE._check(cancelled)
        details = event.setdefault("evidence", {})
        details["key_basis"] = "externally_supplied_section_key"
        details["policy"] = policy
        if not event.get("unknown"):
            details["family_basis"] = "conventional_family_assumed_from_supplied_key"
            if event["type"] == "harmonic_minor":
                details.setdefault("raised_leading_note_basis", "current_grounded_chord")
            # Production mapping merges adjacent equal scales; aggregate actual
            # compatible tones over the resulting span, not just its first chord.
            details["compatible_chord_tones"] = sorted(set().union(*(set(chord.get("grounded_chord_tones",
                chord.get("chord_tones", []))) for chord in harmony if not chord.get("unknown")
                and min(event["end"], chord["end"]) > max(event["t"], chord["t"]))))
    result["keys"] = {"version": 1, "events": keys}
    result["scales"] = {"version": 1, "events": scales}
    result["algorithm_version"] = ALGORITHM_VERSION
    result["source"] = "charts_with_supplied_section_keys"
    for track in ("keys", "scales"):
        result["summary"]["key_coverage" if track == "keys" else "scale_coverage"] = round(sum(
            event["end"] - event["t"] for event in result[track]["events"] if not event.get("unknown")) / duration, 4) if duration else 0
    if result["status"] != "unsupported":
        result["status"] = "complete" if min(result["summary"][name]
            for name in ("chord_coverage", "key_coverage", "scale_coverage")) >= .9 else "partial"
    result["research_assumptions"] = {"key_track": "externally_supplied_section_keys_not_inferred",
        "scale_family": "major_or_minor_key_does_not_prove_every_playable_degree",
        "production_algorithm_version": PRODUCTION_ALGORITHM_VERSION, "policy": policy,
        "harmony_unchanged": True, "key_accuracy_is_not_an_outcome": True,
        "dominant_context_beats": DOMINANT_CONTEXT_BEATS if policy == "minor_context" else None,
        "override_intervals": len(overrides)}
    result["summary"]["limitations"].append(
        "Section keys are supplied research assumptions; their accuracy is not measured by this experiment.")
    _BASE._check(cancelled)
    return result
