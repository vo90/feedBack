"""Prevent circular key scoring and mismatched masks in the controlled study."""

import pytest

from tools.evaluate_harmony_known_keys import assumed_family_control, supplied_keys, key_input_durations, rest_diagnostic


def test_assumed_family_control_only_relaxes_known_key_degree_gate_and_preserves_input():
    import copy
    import harmony_analysis as base

    original = {"duration": 8, "algorithm_version": "fixture", "status": "partial",
        "summary": {"key_coverage": .5, "chord_coverage": 1, "scale_coverage": 0},
        "keys": {"events": [{"t": 0, "end": 4, "key": "E minor", "root": "E", "mode": "minor",
                             "evidence": {"scale_degrees_resolved": False}},
                            {"t": 4, "end": 8, "unknown": True, "evidence": {"scale_degrees_resolved": False}}]},
        "harmony": {"events": [{"t": 0, "end": 8, "root": "E", "quality": "min", "confidence": "high",
                                "chord_tones": [4, 7, 11], "grounded_chord_tones": [4, 7, 11]}]},
        "scales": {"events": [{"t": 0, "end": 8, "unknown": True}]}}
    saved = copy.deepcopy(original)
    control = assumed_family_control(base, original)
    assert original == saved
    assert control["keys"] == saved["keys"] and control["harmony"] == saved["harmony"]
    assert control["scales"]["events"][0]["type"] == "natural_minor"
    assert control["scales"]["events"][0]["end"] == 4
    assert control["scales"]["events"][1]["unknown"]
    assert control["summary"]["scale_coverage"] == .5


def test_supplied_keys_merge_equal_neighbours_but_preserve_ambiguity_and_trim_edges():
    refs = [{"t": 0, "end": 10, "keys": [(0, "major")]},
            {"t": 10, "end": 12, "keys": [(0, "major")]},
            {"t": 12, "end": 18, "keys": [(0, "major"), (7, "major")]},
            {"t": 18, "end": 24, "keys": [(2, "minor")]}]
    keys = supplied_keys(refs, 26, .5)
    known = [e for e in keys if not e.get("unknown")]
    assert [(e["t"], e["end"], e["key"]) for e in known] == [(.5, 11.5, "C major"), (18.5, 23.5, "D minor")]
    assert all(e["evidence"]["observed_scale_degrees_verified"] is False for e in known)
    assert keys[0]["t"] == 0 and keys[-1]["end"] == 26
    assert all(a["end"] == b["t"] for a, b in zip(keys, keys[1:]))
    assert key_input_durations(refs, keys, 26) == {
        "song_seconds": 26, "annotated_key_seconds": 24, "ambiguous_key_seconds": 6,
        "unlabelled_seconds": 2, "supplied_key_seconds": 16, "trimmed_single_key_seconds": 2}


def test_equal_keys_do_not_fill_an_unannotated_gap():
    refs = [{"t": 0, "end": 8, "keys": [(9, "minor")]},
            {"t": 12, "end": 20, "keys": [(9, "minor")]}]
    keys = supplied_keys(refs, 20, .5)
    assert next(e for e in keys if e["t"] <= 10 < e["end"])["unknown"]
    assert [(e["t"], e["end"]) for e in keys if not e.get("unknown")] == [(.5, 7.5), (12.5, 19.5)]


def test_short_and_ambiguous_references_never_become_supplied_keys():
    refs = [{"t": 0, "end": .5, "keys": [(0, "major")]},
            {"t": 1, "end": 10, "keys": [(0, "major"), (9, "minor")]}]
    assert supplied_keys(refs, 10, .5) == [{"t": 0, "end": 10, "unknown": True, "confidence": "low",
        "evidence": {"reason": "no_unambiguous_supplied_key"}}]
    assert supplied_keys([], 0, .5) == []


@pytest.mark.parametrize("uncertainty", [-1, float("nan"), float("inf")])
def test_invalid_boundary_uncertainty_is_rejected(uncertainty):
    with pytest.raises(ValueError):
        supplied_keys([], 10, uncertainty)


def test_all_arms_use_same_supplied_key_rest_scope_and_report_paired_changes():
    keys = supplied_keys([{"t": 2, "end": 9, "keys": [(9, "minor")]}], 12, .5)
    rests = {"qualifying_windows": [{"start": 0, "end": 1, "reentry": True},
                                    {"start": 1, "end": 10, "reentry": True},
                                    {"start": 10, "end": 12, "reentry": False}]}
    baseline = [{"t": 0, "end": 5, "kind": "scale"}, {"t": 5, "end": 12, "kind": "chord_tones"}]
    guidance = [{"t": 0, "end": 4, "kind": "chord_tones"}, {"t": 4, "end": 12, "kind": "scale"}]
    result = {"scales": {"events": [
        {"t": 0, "end": 4, "unknown": True, "evidence": {"reason": "ambiguous_dominant"}},
        {"t": 4, "end": 12, "root": "A", "type": "harmonic_minor"}]}}
    scored = rest_diagnostic(result, keys, rests, guidance, baseline)
    assert scored["totals"]["common_rest_seconds"] == 6
    assert scored["totals"]["scale_seconds"] == 4.5
    assert scored["totals"]["added_scale_seconds"] == 3.5
    assert scored["totals"]["lost_scale_seconds"] == 1.5
    assert scored["totals"]["harmonic_minor_scale_seconds"] == 4.5
    assert scored["no_scale_reasons_seconds"] == {"ambiguous_dominant": 1.5}
    assert scored["paired_guidance_seconds"] == {"scale_to_chord_tones": 1.5, "scale_to_scale": 1,
                                                 "chord_tones_to_scale": 3.5}
    assert not any("accuracy" in k or "correct" in k for k in scored["totals"])
