"""Recurrent played notes can disprove a scale without proving a new tonic."""

import copy
from collections import Counter

import pytest

from harmony_analysis import (_estimate_key, _repeated_collection_conflict,
                              parse_chord)


NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
MINOR_COLLECTION = (11, 1, 2, 4, 6, 7, 9)


def event(label, start, end, *, pcs=None, confidence="high"):
    parsed = parse_chord(label)
    tones = parsed["chord_tones"] if pcs is None else pcs
    return {**parsed, "t": start, "end": end, "confidence": confidence,
            "chord_tones": tones, "grounded_chord_tones": tones,
            "evidence": {"root_observed": parsed["pc"] in tones}}


def sequence(chords, shift=0):
    events, cursor = [], 0
    for label, duration in chords:
        e = event(label, cursor, cursor + duration)
        if e["quality"] == "5":
            e["confidence"] = "medium"
        if shift:
            e["root"] = NAMES[(e["pc"] + shift) % 12]
            e["pc"] = (e["pc"] + shift) % 12
            e["chord_tones"] = [(pc + shift) % 12 for pc in e["chord_tones"]]
            e["grounded_chord_tones"] = e["chord_tones"]
        events.append(e)
        cursor += duration
    return events


def note_observations(events):
    return [{"t": e["t"], "end": e["end"], "pcs": e["grounded_chord_tones"],
             "weight": 1, "group": "rhythm"} for e in events]


def estimate(chords, shift=0):
    events = sequence(chords, shift)
    return _estimate_key(note_observations(events), events, 0, events[-1]["end"], lambda t: t)


def conflict_fixture(repetitions=3):
    best = {"pc": 9, "mode": "major", "fit": .9, "tonic_supported": True}
    alternative = {"pc": 11, "mode": "minor", "fit": 1, "tonic_supported": True}
    observations = Counter({pc: 1 for pc in MINOR_COLLECTION})
    events = sequence([("Bm", 3), ("G5", 2), ("A", 5)] * repetitions)
    return best, [best, alternative], observations, events


@pytest.mark.parametrize("shift", range(12))
def test_repeated_flat_seven_does_not_authorize_its_unsupported_major_scale(shift):
    # The longest chord is the flat seventh of the minor home. Its major
    # scale adds a pitch opposed by every recurring flat-sixth power chord.
    result = estimate([("Bm", 3), ("G5", 2), ("A", 5)] * 4, shift)
    assert result["unknown"]
    details = result["evidence"]
    assert details["reason"] == "recurrent_grounded_collection_conflict"
    assert "shared_scale" not in details
    assert not any(key in result for key in ("root", "mode", "key"))
    conflict = details["collection_conflict"]
    assert conflict["opposing_regions"] == 4
    assert conflict["opposing_pcs"] == [(7 + shift) % 12]
    assert conflict["alternative_collection"]["pcs"] == sorted((pc + shift) % 12 for pc in MINOR_COLLECTION)


@pytest.mark.parametrize("missing_pc", MINOR_COLLECTION)
def test_every_alternative_degree_needs_independent_note_support(missing_pc):
    best, candidates, notes, events = conflict_fixture()
    notes[missing_pc] = 0
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_trace_note_below_existing_support_threshold_cannot_complete_collection():
    best, candidates, notes, events = conflict_fixture()
    notes[1] = .001
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_chord_templates_alone_do_not_supply_independent_degree_evidence():
    best, candidates, _, events = conflict_fixture()
    assert _repeated_collection_conflict(best, candidates, Counter(), events) is None


def test_independently_played_preferred_replacement_degree_prevents_veto():
    best, candidates, notes, events = conflict_fixture()
    notes[8] = 1  # G-sharp genuinely supports the proposed A-major collection.
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_all_grounded_chords_must_fit_the_alternative_including_internal_chords():
    best, candidates, notes, events = conflict_fixture()
    events.insert(2, event("F", 4.5, 4.9))  # F/C cannot be explained by B natural minor.
    events.sort(key=lambda e: e["t"])
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_changed_actual_voicing_is_not_hidden_by_an_unchanged_chord_label():
    events = sequence([("Bm", 3), ("G5", 2), ("A", 5)] * 4)
    notes = note_observations(events)
    original = _estimate_key(notes, events, 0, 40, lambda time: time)
    assert original["evidence"]["reason"] == "recurrent_grounded_collection_conflict"
    chord = events[2]
    # A brief played G-sharp does not change the A label, but disproves the
    # otherwise complete B-minor palette. Keep note-profile inputs identical.
    extra = sorted(set(chord["grounded_chord_tones"]) | {8})
    events[2:3] = [{**chord, "end": 9.99},
                   {**chord, "t": 9.99, "chord_tones": extra,
                    "grounded_chord_tones": extra}]
    result = _estimate_key(notes, events, 0, 40, lambda time: time)
    assert result["evidence"].get("reason") != "recurrent_grounded_collection_conflict"


@pytest.mark.parametrize("change", ["root_only", "rootless", "low_confidence"])
def test_inadequate_opposing_chord_evidence_cannot_veto_a_key(change):
    best, candidates, notes, events = conflict_fixture()
    for e in events:
        if e["root"] != "G":
            continue
        if change == "low_confidence":
            e["confidence"] = "low"
        else:
            e["grounded_chord_tones"] = e["chord_tones"] = [7] if change == "root_only" else [2, 9]
            e["evidence"]["root_observed"] = change == "root_only"
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_an_alternative_tonic_requires_its_observed_quality():
    best, candidates, notes, events = conflict_fixture()
    candidates[1]["tonic_supported"] = False
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_an_alternative_with_poor_overall_pitch_fit_cannot_veto():
    best, candidates, notes, events = conflict_fixture()
    candidates[1]["fit"] = .9
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_relative_names_for_one_collection_do_not_create_two_alternatives():
    best, candidates, notes, events = conflict_fixture()
    expected = _repeated_collection_conflict(best, candidates, notes, events)
    candidates.append({"pc": 2, "mode": "major", "fit": 1, "tonic_supported": True})
    actual = _repeated_collection_conflict(best, candidates, notes, events)
    assert actual == expected


@pytest.mark.parametrize("gaps", [False, True])
def test_repeated_strums_and_releases_are_one_opposing_harmonic_visit(gaps):
    best, candidates, notes, _ = conflict_fixture()
    events = [event("Bm", 0, 2)]
    events.extend(event("G5", 2 + i * .5, 2 + (i + 1) * .5 - (.1 if gaps else 0))
                  for i in range(8))
    events.append(event("A", 6, 10))
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_filling_in_one_borrowed_voicing_does_not_create_repeated_harmonic_visits():
    best, candidates, notes, _ = conflict_fixture()
    events = sequence([("A", 5), ("Bm", 1), ("G5", .5), ("G", .5),
                       ("Gsus2", .5), ("G5", .5), ("A", 6)])
    assert _repeated_collection_conflict(best, candidates, notes, events) is None


def test_fragmentation_and_duplicate_descriptions_cannot_multiply_visits():
    best, candidates, notes, events = conflict_fixture()
    expected = _repeated_collection_conflict(best, candidates, notes, events)
    original = copy.deepcopy((best, candidates, notes, events))
    split = []
    for e in events:
        midpoint = (e["t"] + e["end"]) / 2
        split.extend([{**e, "end": midpoint}, {**e, "t": midpoint}])
    duplicated = sorted(split + copy.deepcopy(split), key=lambda e: (e["t"], e["end"]))
    assert _repeated_collection_conflict(best, candidates, notes, duplicated) == expected
    assert (best, candidates, notes, events) == original


def test_provenance_is_bounded_without_hiding_total_opposing_visit_count():
    best, candidates, notes, events = conflict_fixture(repetitions=10)
    conflict = _repeated_collection_conflict(best, candidates, notes, events)
    assert conflict["opposing_regions"] == 10
    assert len(conflict["opposing_windows"]) == 6
    assert [w["start"] for w in conflict["opposing_windows"]] == [3, 13, 23, 33, 43, 53]


@pytest.mark.parametrize("chords,expected", [
    ([("A", 4), ("D", 2), ("E", 2), ("A", 4), ("G5", 2), ("A", 8)], "A major"),
    ([("A", 5), ("G5", 2), ("B5", 1), ("A", 4)] * 3, "A major"),
    ([("C", 4), ("F", 2), ("G", 2), ("C", 4), ("E7", 2), ("Am", 2), ("G", 2), ("C", 4)], "C major"),
    ([("C", 4), ("F", 2), ("G", 2), ("C", 4), ("E7", 2), ("Am", 2)] * 3, "C major"),
    ([("D", 2), ("G5", 2), ("A", 6), ("D", 2), ("Bm", 1)] * 3, "D major"),
])
def test_isolated_borrowing_secondary_dominants_and_grounded_cadences_survive(chords, expected):
    assert estimate(chords)["key"] == expected


def test_modal_progression_with_supported_alternative_collection_remains_uncertain():
    result = estimate([("A", 5), ("G5", 2), ("Bm", 1), ("A", 4)] * 3)
    assert result["unknown"]
    assert result["evidence"]["reason"] == "recurrent_grounded_collection_conflict"
    assert "shared_scale" not in result["evidence"]
