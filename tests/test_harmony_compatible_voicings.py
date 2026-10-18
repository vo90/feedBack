"""Grounded partial voicings must not become fictitious competing chords."""

import copy
from itertools import permutations

import pytest

from harmony_analysis import _choose_chord, analyse_harmony, parse_chord


NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def chord(label, pcs=None, start=0, end=4):
    return {"t": start, "end": end, "label": label,
            "pcs": parse_chord(label)["chord_tones"] if pcs is None else pcs}


def arrangement(identity, events, role="lead", group=None):
    return {"id": identity, "role": role, "correlation_group": group or identity,
            "chords": events}


def source(*arrangements, duration=6, beats=None):
    return {"version": 1, "duration": duration, "revision": "compatible-voicings",
            "beats": list(range(duration + 1)) if beats is None else beats,
            "arrangements": list(arrangements)}


def at(result, time):
    return next(e for e in result["harmony"]["events"] if e["t"] <= time < e["end"])


def pair(shift=0, anchor_role="rhythm", partial_role="lead"):
    observed = sorted((pc + shift) % 12 for pc in [0, 4, 7, 10])
    partial = sorted((pc + shift) % 12 for pc in [4, 7, 10])
    return source(
        arrangement("complete", [chord(NAMES[shift] + "7", observed)], role=anchor_role),
        arrangement("partial", [chord(NAMES[(7 + shift) % 12] + "m6", partial)], role=partial_role),
    )


@pytest.mark.parametrize("shift", range(12))
def test_contained_partial_label_resolves_to_complete_observed_chord_in_every_key(shift):
    data = pair(shift)
    before = copy.deepcopy(data)
    event = at(analyse_harmony(data), 1)
    expected = sorted((pc + shift) % 12 for pc in [0, 4, 7, 10])
    assert event["root"] == NAMES[shift]
    assert event["quality"] == "7"
    assert event["confidence"] == "medium"
    assert event["grounded_chord_tones"] == event["chord_tones"] == expected
    assert event["evidence"]["observed_pcs"] == expected
    assert event["evidence"]["label_implied_pcs"] == []
    assert event["evidence"]["root_observed"]
    assert event["evidence"]["quality_basis"] == "observed_voicing"
    assert event["evidence"]["resolution"] == "compatible_partial_voicings"
    assert event["evidence"]["anchor_reference"] == "complete"
    assert event["evidence"]["partial_voicing_references"] == ["partial"]
    assert data == before


def test_complete_anchor_can_be_second_strong_root_without_absorbing_partial_votes():
    event = at(analyse_harmony(pair(anchor_role="lead", partial_role="rhythm")), 1)
    assert (event["root"], event["quality"], event["confidence"]) == ("C", "7", "medium")


def musical_events(data):
    return [{k: event[k] for k in (
        "t", "end", "root", "quality", "confidence", "chord_tones", "unknown"
    ) if k in event} for event in analyse_harmony(data)["harmony"]["events"]]


def test_alternate_arrangements_and_order_cannot_add_confidence_or_outvote_anchor():
    data = pair()
    expected = musical_events(data)
    duplicate = copy.deepcopy(data["arrangements"][1])
    duplicate["id"] = "alternate"
    arrangements = data["arrangements"] + [duplicate]
    for order in permutations(arrangements):
        assert musical_events({**data, "arrangements": list(order)}) == expected
    assert musical_events({**data, "arrangements": arrangements + [duplicate] * 20}) == expected


@pytest.mark.parametrize("label,pcs", [
    ("Gm6", [2, 4, 7, 10]),  # the alternate sixth chord is actually complete
    ("F", [0, 5, 9]),  # next chord arriving before the previous hold ends
    ("Gm6", [2, 7, 10]),  # missing E, but the observed D is outside C7
])
def test_genuine_competing_observations_remain_unknown(label, pcs):
    data = pair()
    data["arrangements"][1]["chords"] = [chord(label, pcs)]
    event = at(analyse_harmony(data), 1)
    assert event["unknown"]
    assert event["evidence"]["reason"] == "conflicting_arrangements"


@pytest.mark.parametrize("first,second", [
    ("C6", "Am7"),  # identical pitch sets cannot decide their root
    ("Cmaj7", "Em"),  # an independently complete smaller chord is not a partial label
])
def test_complete_smaller_or_equal_collection_is_not_relabelled(first, second):
    data = source(arrangement("a", [chord(first)]), arrangement("b", [chord(second)]))
    assert at(analyse_harmony(data), 1)["unknown"]


def test_same_root_major_minor_conflict_blocks_otherwise_compatible_resolution():
    data = pair()
    data["arrangements"].append(arrangement("minor", [chord("Cm7")], group="complete"))
    assert at(analyse_harmony(data), 1)["unknown"]


def test_correlated_alternate_cannot_hide_a_genuine_conflict_behind_score_cap():
    data = pair()
    conflict = arrangement("different-partial", [chord("Gm6", [2, 7, 10])], group="partial")
    for order in permutations(data["arrangements"] + [conflict]):
        assert at(analyse_harmony({**data, "arrangements": list(order)}), 1)["unknown"]


@pytest.mark.parametrize("pcs", [[4, 7, 10], [0, 7, 10], [0, 4, 7]])
def test_incomplete_anchor_does_not_fill_missing_root_third_or_seventh(pcs):
    data = pair()
    data["arrangements"][0]["chords"] = [chord("C7", pcs)]
    assert at(analyse_harmony(data), 1)["unknown"]


def test_partial_parts_do_not_union_into_an_unplayed_complete_chord():
    data = source(
        arrangement("a", [chord("C7", [0, 4, 7])]),
        arrangement("b", [chord("Gm6", [4, 7, 10])]),
    )
    assert at(analyse_harmony(data), 1)["unknown"]


def test_unsupported_label_does_not_supply_missing_quality():
    data = pair()
    data["arrangements"][0]["chords"] = [chord("Cunsupported", [0, 7])]
    result = analyse_harmony(data)
    assert not any(e.get("evidence", {}).get("resolution") for e in result["harmony"]["events"])
    assert any(d["code"] == "unsupported_chord_label" for d in result["diagnostics"])


def candidate(label, observed, weight=4, group=None):
    parsed = parse_chord(label)
    return {**parsed, "observed": observed, "chord_tones": observed,
            "label_implied_pcs": sorted(set(parsed["chord_tones"]) - set(observed)),
            "group": group or label, "id": label, "weight": weight,
            "named": True, "kind": "named_chord"}


def test_root_only_or_power_anchor_cannot_establish_a_complete_quality():
    for anchor in [candidate("C5", [0, 7]), candidate("C", [0])]:
        partial = candidate("Gm6", [7])
        event = _choose_chord([anchor, partial], None, 0, 1)
        assert event["unknown"]


def test_strong_root_only_observation_outside_anchor_cannot_be_ignored():
    root_only = candidate("F", [5])
    root_only.update(quality="", named=False, kind="bass_root_candidate")
    event = _choose_chord([
        candidate("C7", [0, 4, 7, 10]), candidate("Gm6", [4, 7, 10]), root_only,
    ], None, 0, 1)
    assert event["unknown"]


def test_richer_same_root_chord_must_already_contain_every_observed_tone():
    active = [candidate("C7", [0, 4, 7, 10]),
              candidate("C9", [0, 2, 4, 7, 10], group="C7"),
              candidate("Gm6", [4, 7, 10])]
    # The already complete ninth is the only candidate explaining every tone.
    # No pitch-class union is constructed to complete the seventh's label.
    for order in permutations(active):
        event = _choose_chord(list(order), None, 0, 1)
        assert event.get("root") == "C"
        assert event["quality"] == "9"
        assert event["grounded_chord_tones"] == [0, 2, 4, 7, 10]


def test_small_attack_offsets_are_resolved_only_while_existing_evidence_overlaps():
    data = source(
        arrangement("complete", [chord("C7", start=0, end=1)], role="rhythm"),
        arrangement("partial", [chord("Gm6", [4, 7, 10], start=.03, end=1.05)]),
        arrangement("arriving", [chord("F", start=1.02, end=1.2)], role="rhythm"),
        duration=2, beats=[i / 5 for i in range(11)],
    )
    result = analyse_harmony(data)
    assert at(result, .02)["quality"] == "7"
    assert "resolution" not in at(result, .02)["evidence"]
    assert at(result, .031)["evidence"]["resolution"] == "compatible_partial_voicings"
    assert at(result, .999)["quality"] == "7"
    assert at(result, 1.01)["root"] == "G"  # C7 expired, never extended by the partial
    assert at(result, 1.03)["unknown"]  # overlapping C7-fragment/F is real disagreement
    assert at(result, 1.06)["root"] == "F"
    assert at(result, 1.5)["unknown"]  # the existing two-beat strum window expired
    assert not any(e.get("quality") == "7" and e["end"] > 1
                   for e in result["harmony"]["events"])


def test_supplied_sustain_and_true_chord_changes_keep_exact_boundaries():
    data = source(
        arrangement("complete", [chord("C7", start=0, end=2), chord("F", start=2, end=4)], role="rhythm"),
        arrangement("partial", [chord("Gm6", [4, 7, 10], start=.02, end=2)]),
        beats=[i / 2 for i in range(13)],
    )
    result = analyse_harmony(data)
    assert at(result, 1.999)["quality"] == "7"
    assert at(result, 2)["root"] == "F"
    assert at(result, 4)["unknown"]
    assert all(e["end"] <= 2 for e in result["harmony"]["events"] if e.get("quality") == "7")


def test_resolution_provenance_is_not_extended_over_a_different_anchor():
    data = pair()
    data["arrangements"][0]["chords"] = [
        {**chord("C7", start=0, end=2), "evidence_id": "first-anchor"},
        {**chord("C7", start=2, end=4), "evidence_id": "second-anchor"},
    ]
    result = analyse_harmony(data)
    assert at(result, 1)["end"] == 2
    assert at(result, 1)["evidence"]["anchor_reference"] == "first-anchor"
    assert at(result, 2)["evidence"]["anchor_reference"] == "second-anchor"
