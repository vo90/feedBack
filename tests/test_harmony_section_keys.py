"""Cadence evidence distinguishes articulation from missing harmonic context."""

import copy

import pytest

from harmony_analysis import (_beat_coordinates, _estimate_key, _tonic_quality_matches,
                              analyse_harmony, parse_chord)


def event(label, start, end):
    parsed = parse_chord(label)
    return {**parsed, "t": start, "end": end, "confidence": "high",
            "grounded_chord_tones": parsed["chord_tones"]}


def sequence(labels, *, gap=0):
    return [event(label, index * 4, (index + 1) * 4 - gap)
            for index, label in enumerate(labels)]


def estimate(events, *, observations=(), position=lambda t: t, start=0, end=None):
    return _estimate_key(list(observations), events, start,
                         max(e["end"] for e in events) if end is None else end, position)


@pytest.mark.parametrize("tonic,mode", [("C", "major"), ("Cm", "minor")])
def test_cadence_arrival_requires_observed_matching_mode(tonic, mode):
    tonic_event = event(tonic, 0, 4)
    assert _tonic_quality_matches(tonic_event, mode)
    assert not _tonic_quality_matches(tonic_event, "minor" if mode == "major" else "major")
    tonic_event["grounded_chord_tones"] = [0, 7]
    assert not _tonic_quality_matches(tonic_event, mode)


@pytest.mark.parametrize("tonic,other", [("C", "Cm"), ("Cm", "C")])
def test_cadence_to_parallel_tonic_does_not_count_for_preferred_mode(tonic, other):
    events, cursor = [], 0
    for label, duration in [(tonic, 12), ("F", 2), ("G7", 2), (other, 1)] * 2:
        events.append(event(label, cursor, cursor + duration))
        cursor += duration
    result = estimate(events)
    assert result["evidence"]["candidates"][0]["key"] == ("C major" if tonic == "C" else "C minor")
    assert result["evidence"]["dominant_cadences"] == 0


@pytest.mark.parametrize("gap,expected", [(0, 3), (.01, 3), (.25, 3), (.5, 3), (.50001, 0), (2, 0)])
def test_articulation_is_bounded_in_authored_beats(gap, expected):
    events = sequence(["C", "F", "G7", "C"] * 3, gap=gap)
    result = estimate(events)
    assert result["evidence"]["dominant_cadences"] == expected
    if gap > 0 and expected:
        assert result["evidence"]["articulated_chord_connections"] > 0


def test_direct_estimate_without_beat_clock_retains_exact_adjacency():
    result = estimate(sequence(["C", "F", "G7", "C"] * 3, gap=.01), position=None)
    assert result["evidence"]["dominant_cadences"] == 0


@pytest.mark.parametrize("barrier", ["C5", "Csus4", "single_root", "conflicting_note", "held_note"])
def test_articulation_cannot_skip_harmonic_barriers(barrier):
    events = sequence(["C", "F", "G7", "C"] * 3, gap=.5)
    observations = []
    for start in (11.5, 27.5, 43.5):
        if barrier in ("conflicting_note", "held_note"):
            observations.append({"t": start - .5 if barrier == "held_note" else start + .1, "end": start + .2,
                                 "pcs": {6}, "weight": 1, "group": "lead"})
        else:
            middle = event("C" if barrier == "single_root" else barrier, start + .1, start + .2)
            if barrier == "single_root":
                middle.update(quality="", chord_tones=[0], grounded_chord_tones=[0])
            events.append(middle)
    events.sort(key=lambda e: e["t"])
    result = estimate(events, observations=observations)
    assert result["evidence"]["dominant_cadences"] == 0


@pytest.mark.parametrize("reason,expected", [("no_chart_evidence", 3),
                                           ("conflicting_arrangements", 0),
                                           ("conflicting_chord_quality", 0),
                                           ("insufficient_evidence", 0)])
def test_unknown_gap_requires_absence_of_harmonic_evidence(reason, expected):
    events = sequence(["C", "F", "G7", "C"] * 3, gap=.5)
    for start in (11.5, 27.5, 43.5):
        events.append({"t": start, "end": start + .5, "unknown": True,
                       "confidence": "low", "evidence": {"reason": reason}})
    events.sort(key=lambda e: e["t"])
    assert estimate(events)["evidence"]["dominant_cadences"] == expected


@pytest.mark.parametrize("transpose", range(12))
def test_articulated_cadence_is_transposition_invariant(transpose):
    names = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    labels = [names[(pc + transpose) % 12] + suffix for pc, suffix in
              [(0, ""), (5, ""), (7, "7"), (0, "")] * 3]
    result = estimate(sequence(labels, gap=.5))
    assert result["key"] == names[transpose] + " major"
    assert result["evidence"]["dominant_cadences"] == 3


def test_cadence_arrival_outside_context_is_not_counted():
    events = sequence(["C", "F", "G7", "C"], gap=.5)
    result = estimate(events, end=12)
    assert result["evidence"]["dominant_cadences"] == 0


@pytest.mark.parametrize("variable_tempo", [False, True])
def test_articulation_never_extends_chord_or_scale_lifetime(variable_tempo):
    events = sequence(["C", "F", "G7", "C"] * 4, gap=.5)
    seconds = (lambda t: t if t <= 8 else 8 + (t - 8) * .4) if variable_tempo else (lambda t: t)
    source = {"version": 1, "normalization_version": "test-v1", "revision": "test",
              "duration": seconds(64), "beats": [seconds(t) for t in range(65)],
              "arrangements": [{"id": "rhythm", "role": "rhythm", "chords": [
                  {"label": e["display_label"], "t": seconds(e["t"]), "end": seconds(e["end"]),
                   "pcs": e["chord_tones"], "pitches": [48 + pc for pc in e["chord_tones"]]}
                  for e in events]}]}
    original = copy.deepcopy(source)
    result = analyse_harmony(source)
    assert source == original
    for track in ("harmony", "scales"):
        gap = next(e for e in result[track]["events"] if e["t"] <= seconds(11.75) < e["end"])
        assert gap["unknown"]
    keys = [e for e in result["keys"]["events"] if not e.get("unknown")]
    assert keys and all(e["key"] == "C major" for e in keys)
    assert any(e["evidence"]["dominant_cadences"] > 0 for e in keys)


def test_half_beat_bound_survives_tempo_change():
    events = sequence(["C", "F", "G7", "C"] * 3, gap=.5)
    seconds = lambda t: t if t <= 8 else 8 + (t - 8) * 2
    transformed = [{**e, "t": seconds(e["t"]), "end": seconds(e["end"])} for e in events]
    position, _ = _beat_coordinates([seconds(t) for t in range(49)], 1)
    regular = estimate(events)
    changed = estimate(transformed, position=position)
    assert regular["evidence"]["dominant_cadences"] == changed["evidence"]["dominant_cadences"] == 3
