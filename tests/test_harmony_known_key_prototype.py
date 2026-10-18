"""Controlled-key experiment contracts, not evidence of musical accuracy."""

import copy
import importlib.util
import json
from pathlib import Path
import shutil

import pytest

from tools import harmony_known_key_prototype as prototype


def song(labels, length=4):
    duration = len(labels) * length
    chords = []
    for index, label in enumerate(labels):
        tones = prototype._BASE.parse_chord(label)["chord_tones"]
        chords.append({"t": index * length, "end": (index + 1) * length, "label": label,
                       "pcs": tones, "pitches": [48 + pc for pc in tones]})
    return {"duration": duration, "beats": list(range(duration + 1)), "revision": "known-key-fixture",
            "arrangements": [{"id": "rhythm", "role": "rhythm", "chords": chords}]}


def analyse(data, key="A minor", policy="minor_context", keys=None):
    return prototype.analyse_harmony(data, {"key_events": keys if keys is not None else [
        {"t": 0, "end": data["duration"], "key": key}], "policy": policy})


def at(result, track, time):
    return next(event for event in result[track]["events"] if event["t"] <= time < event["end"])


def palette_signature(events):
    return [(event["t"], event["end"], event.get("root"), event.get("type"), event.get("unknown", False))
            for event in events]


def test_existing_control_is_production_mapping_with_explicit_assumed_keys():
    data = song(["Am", "Dm", "E7", "Am"] * 2)
    keys = [{"t": 0, "end": data["duration"], "key": "A minor"}]
    baseline = prototype._BASE.analyse_harmony(data)
    expected = prototype._BASE._scale_timeline(prototype.validate_key_events(keys, data["duration"]),
                                             baseline["harmony"]["events"], data["duration"])
    result = analyse(data, policy="existing", keys=keys)
    assert palette_signature(result["scales"]["events"]) == palette_signature(expected)
    assert result["research_assumptions"]["key_accuracy_is_not_an_outcome"] is True
    assert result["keys"]["events"][0]["evidence"]["reason"] == "research_key_assumption"
    assert "scale_degrees_resolved" not in result["keys"]["events"][0]["evidence"]
    assert "observed_pcs" not in result["keys"]["events"][0]["evidence"]
    assert all(event["evidence"]["key_basis"] == "externally_supplied_section_key"
               for event in result["scales"]["events"])


@pytest.mark.parametrize("policy", ["existing", "minor_context"])
def test_unknown_and_ambiguous_key_intervals_cannot_be_filled_from_neighbours(policy):
    data = song(["C", "F", "G7", "C"] * 2)
    keys = [{"t": 0, "end": 8, "key": "C major"},
            {"t": 8, "end": 16, "unknown": True, "key": "C major",
             "evidence": {"shared_scale": {"root": "C", "type": "major"}}},
            {"t": 16, "end": 24, "ambiguous": True, "key": "C major"},
            {"t": 24, "end": 32, "key": "C major"}]
    result = analyse(data, policy=policy, keys=keys)
    assert not at(result, "scales", 4).get("unknown")
    assert at(result, "scales", 10)["unknown"]
    assert at(result, "scales", 20)["unknown"]
    assert not at(result, "scales", 28).get("unknown")
    assert all("shared_scale" not in event["evidence"] for event in result["keys"]["events"])


def test_observed_dominant_and_suspended_resolution_keep_the_supplied_minor_tonic():
    result = analyse(song(["Am", "E7sus4", "E7", "Am"]))
    assert {event["key"] for event in result["keys"]["events"]} == {"A minor"}
    assert at(result, "scales", 2)["type"] == "natural_minor"
    suspension = at(result, "scales", 6)
    assert (suspension["root"], suspension["type"]) == ("A", "harmonic_minor")
    assert suspension["evidence"]["raised_leading_note_basis"] == "neighboring_grounded_dominant"
    assert suspension["evidence"]["anchors"] == [{"t": 8.0, "end": 12.0, "observed_pcs": [2, 4, 8, 11]}]
    assert at(result, "scales", 10)["type"] == "harmonic_minor"
    assert at(result, "scales", 14)["type"] == "natural_minor"
    # The context selects a scale degree but does not add it to the suspended chord.
    assert at(result, "harmony", 6)["chord_tones"] == [2, 4, 9, 11]


def test_minor_context_withholds_thirdless_dominant_without_an_observed_anchor():
    data = song(["Am", "E5", "Am", "E7sus4"])
    existing = analyse(data, policy="existing")
    result = analyse(data)
    assert at(existing, "scales", 6)["type"] == "natural_minor"
    assert at(result, "scales", 6)["evidence"]["reason"] == "minor_dominant_third_unresolved"
    assert at(result, "scales", 14)["unknown"]
    assert at(result, "harmony", 6)["chord_tones"] == [4, 11]


def test_unobserved_label_third_cannot_be_a_dominant_anchor():
    data = song(["Am", "E", "E7sus4", "Am"])
    data["arrangements"][0]["chords"][1].update(pcs=[4, 11], pitches=[52, 59])
    result = analyse(data)
    assert at(result, "scales", 6)["unknown"]
    assert at(result, "scales", 10)["unknown"]
    assert at(result, "harmony", 6)["evidence"]["label_implied_pcs"] == [8]


def test_context_expires_four_beats_from_observed_dominant_end():
    data = song(["E7", "E7sus4", "E7sus4", "E7sus4"])
    result = analyse(data)
    assert at(result, "scales", 7.999)["type"] == "harmonic_minor"
    assert at(result, "scales", 8.001)["unknown"]
    assert at(result, "scales", 15)["unknown"]


@pytest.mark.parametrize("barrier", ["Am", "Em"])
def test_another_root_or_observed_natural_seventh_blocks_context(barrier):
    result = analyse(song(["E7", barrier, "E5", "Am"], length=1))
    assert at(result, "scales", 2.5)["unknown"]
    if barrier == "Em":
        assert at(result, "scales", 1.5)["type"] == "natural_minor"


def test_uncharted_gap_blocks_context_even_within_four_beats():
    data = song(["E7", "E7sus4"], length=2)
    data["arrangements"][0]["chords"][1].update(t=3, end=5)
    data.update(duration=5, beats=list(range(6)))
    result = analyse(data)
    assert at(result, "harmony", 2.5)["unknown"]
    assert at(result, "scales", 3.5)["unknown"]


def test_key_boundary_blocks_context_even_if_both_labels_happen_to_match():
    data = song(["E7", "E7sus4", "Am"])
    keys = [{"t": 0, "end": 4, "key": "A minor"}, {"t": 4, "end": 12, "key": "A minor"}]
    result = analyse(data, keys=keys)
    assert at(result, "scales", 6)["unknown"]


def test_borrowed_chord_cannot_relabel_supplied_key_or_get_incompatible_scale():
    result = analyse(song(["C", "F", "Fm", "C"]), key="C major")
    assert {event["key"] for event in result["keys"]["events"]} == {"C major"}
    assert at(result, "scales", 10)["unknown"]
    assert at(result, "harmony", 10)["chord_tones"] == [0, 5, 8]


def test_fully_observed_minor_and_major_dominants_keep_existing_behavior():
    data = song(["Am", "Dm", "E7", "Am", "Em", "Am"])
    existing, changed = analyse(data, policy="existing"), analyse(data)
    assert palette_signature(existing["scales"]["events"]) == palette_signature(changed["scales"]["events"])


def test_input_and_production_harmony_are_unchanged_and_tracks_are_bounded():
    data = song(["Am", "E7sus4", "E7", "Am"])
    keys = [{"t": 0, "end": 16, "key": "A minor", "root": "A", "mode": "minor", "confidence": "high"}]
    before, original_keys = copy.deepcopy(data), copy.deepcopy(keys)
    baseline = prototype._BASE.analyse_harmony(data)
    result = analyse(data, keys=keys)
    assert data == before and keys == original_keys
    assert json.dumps(result["harmony"], sort_keys=True) == json.dumps(baseline["harmony"], sort_keys=True)
    assert result["summary"]["chord_coverage"] == baseline["summary"]["chord_coverage"]
    for track in ("keys", "harmony", "scales"):
        events = result[track]["events"]
        assert events[0]["t"] == 0 and events[-1]["end"] == data["duration"]
        assert all(left["end"] == right["t"] for left, right in zip(events, events[1:]))
        assert all(event["end"] > event["t"] for event in events)
    json.dumps(result, allow_nan=False)


def test_context_uses_authored_beats_across_tempo_change():
    data = song(["E7", "E7sus4", "E7sus4", "E7sus4"])
    transform = lambda time: time if time <= 4 else 4 + (time - 4) * .5
    data["beats"] = list(map(transform, data["beats"]))
    data["duration"] = transform(data["duration"])
    for event in data["arrangements"][0]["chords"]:
        event["t"], event["end"] = transform(event["t"]), transform(event["end"])
    result = analyse(data)
    assert at(result, "scales", 5.999)["type"] == "harmonic_minor"
    assert at(result, "scales", 6.001)["unknown"]


def test_overlay_does_not_emit_zero_length_event_at_submicrosecond_duration_remainder():
    data = song(["Am", "E7sus4", "E7", "Am"])
    data["duration"] += .0000004
    data["arrangements"][0]["chords"][-1]["end"] = data["duration"]
    result = analyse(data)
    assert all(event["end"] > event["t"] for event in result["scales"]["events"])
    assert result["scales"]["events"][-1]["end"] == pytest.approx(data["duration"], abs=1e-6)


@pytest.mark.parametrize("events", [
    [], [{"t": 1, "end": 8, "key": "C major"}], [{"t": 0, "end": 7, "key": "C major"}],
    [{"t": 0, "end": 4, "key": "C major"}, {"t": 3, "end": 8, "unknown": True}],
    [{"t": 0, "end": 4, "key": "C major"}, {"t": 5, "end": 8, "unknown": True}],
    [{"t": 4, "end": 8, "key": "C major"}, {"t": 0, "end": 4, "unknown": True}],
    [{"t": 0, "end": float("inf"), "key": "C major"}],
    [{"t": float("nan"), "end": 8, "key": "C major"}],
    [{"t": 0, "end": 9, "key": "C major"}], [{"t": -1, "end": 8, "key": "C major"}],
    [{"t": 0, "end": 8, "key": "C dorian"}], [{"t": 0, "end": 8, "key": 2}],
    [{"t": 0, "end": 8, "key": "C major", "root": "D"}],
    [{"t": 0, "end": 8, "key": "C major", "mode": "minor"}],
])
def test_invalid_or_incomplete_key_timeline_is_rejected(events):
    with pytest.raises(ValueError):
        prototype.validate_key_events(events, 8)


@pytest.mark.parametrize("options", [None, {}, {"policy": "existing"}, {"key_events": [], "policy": "surprise"},
                                    {"key_events": [], "unexpected": True}])
def test_missing_explicit_key_timeline_or_unknown_options_fail(options):
    with pytest.raises(ValueError):
        prototype.analyse_harmony(song(["C", "F"]), options)


def test_cancelled_analysis_and_context_never_return_partial_result():
    with pytest.raises(prototype.AnalysisCancelled):
        prototype.analyse_harmony(song(["C", "F"]), {"key_events": []}, cancelled=lambda: True)
    with pytest.raises(prototype.AnalysisCancelled):
        prototype.validate_key_events([{"t": 0, "end": 8, "key": "C major"}], 8, cancelled=lambda: True)


def test_empty_duration_is_supported_only_with_explicit_empty_key_timeline():
    for policy in ("existing", "minor_context"):
        result = prototype.analyse_harmony({"duration": 0, "arrangements": []}, {"key_events": [], "policy": policy})
        assert result["keys"]["events"] == [] and result["scales"]["events"] == []
        assert result["status"] == "unsupported"
        json.dumps(result, allow_nan=False)


def test_frozen_module_loads_sibling_production_dependency_without_repository(tmp_path):
    target = tmp_path / "candidate-engine.py"
    shutil.copyfile(Path(prototype.__file__), target)
    shutil.copyfile(prototype._DEPENDENCY, tmp_path / "production-engine.py")
    spec = importlib.util.spec_from_file_location("frozen_known_key_candidate", target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.analyse_harmony(song(["Am", "E7sus4", "E7", "Am"]),
                                   {"key_events": [{"t": 0, "end": 16, "key": "A minor"}], "policy": "minor_context"})
    assert module._DEPENDENCY.parent == tmp_path
    assert result["algorithm_version"] == prototype.ALGORITHM_VERSION
    assert at(result, "scales", 6)["type"] == "harmonic_minor"
