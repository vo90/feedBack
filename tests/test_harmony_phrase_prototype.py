"""Research decoder contracts; these examples do not establish corpus accuracy."""

import copy
import importlib.util
import itertools
import json
from pathlib import Path
import shutil

import pytest

from tools import harmony_phrase_prototype as prototype


def song(labels, length=4):
    duration = len(labels) * length
    chords = []
    for index, label in enumerate(labels):
        tones = prototype._BASE.parse_chord(label)["chord_tones"]
        chords.append({"t": index * length, "end": (index + 1) * length,
                       "label": label, "pcs": tones, "pitches": [48 + pc for pc in tones]})
    return {"duration": duration, "beats": list(range(duration + 1)), "revision": "research-fixture",
            "arrangements": [{"id": "rhythm", "role": "rhythm", "chords": chords}]}


def at(result, track, time):
    return next(event for event in result[track]["events"] if event["t"] <= time < event["end"])


def pcs(event):
    if event.get("unknown"):
        return None
    return {(prototype.pitch_class(event["root"]) + degree) % 12
            for degree in prototype.SCALES[event["type"]]}


def test_decoder_matches_exhaustive_sequence_objective_and_alternative_margins():
    costs = [[0, .4, .2], [.7, 0, .2], [.2, .1, 0], [0, .4, .3]]
    switch_cost = .25
    paths = []
    for path in itertools.product(range(3), repeat=len(costs)):
        value = sum(row[state] for row, state in zip(costs, path))
        value += sum(switch_cost for a, b in zip(path, path[1:]) if a != b)
        paths.append((value, path))
    selected, margins = prototype.decode_collections(costs, switch_cost)
    optimum = min(value for value, _ in paths)
    selected_value = next(value for value, path in paths if path == tuple(selected))
    assert selected_value == pytest.approx(optimum)
    for index, state in enumerate(selected):
        alternative = min(value for value, path in paths if path[index] != state)
        assert margins[index] == pytest.approx(alternative - optimum)


def test_switch_cost_rejects_temporary_detour_but_allows_sustained_change():
    detour = [[0, 2], [0, 2], [.25, 0], [0, 2], [0, 2]]
    assert prototype.decode_collections(detour, 0)[0] == [0, 0, 1, 0, 0]
    assert prototype.decode_collections(detour, 1)[0] == [0, 0, 0, 0, 0]
    sustained = [[0, 2]] * 4 + [[2, 0]] * 4
    assert prototype.decode_collections(sustained, 1)[0] == [0] * 4 + [1] * 4


def test_relative_key_ambiguity_keeps_key_unknown_but_shows_shared_collection():
    result = prototype.analyse_harmony(song(["Am", "F", "C", "G"] * 4))
    assert at(result, "keys", 16)["unknown"]
    scale = at(result, "scales", 16)
    assert pcs(scale) == {0, 2, 4, 5, 7, 9, 11}
    assert scale["evidence"]["tonic_independently_known"] is False


def test_temporary_chromatic_chord_keeps_collection_but_withholds_conflicting_notes():
    data = song(["C", "F", "G7", "C"] * 2 + ["C", "Fm", "G7", "C"]
                + ["C", "F", "G7", "C"] * 2)
    result = prototype.analyse_harmony(data)
    assert at(result, "scales", 35)["root"] == "C"
    assert at(result, "scales", 37)["unknown"]
    assert at(result, "scales", 41)["root"] == "C"
    assert at(result, "harmony", 37)["chord_tones"] == [0, 5, 8]
    assert {cell["candidate"]["root"] for cell in result["phrase_analysis"]["phrases"]} == {"C"}


def test_sustained_collection_change_uses_following_evidence_at_the_boundary():
    result = prototype.analyse_harmony(song(["C", "F", "G7", "C"] * 3 + ["D", "G", "A7", "D"] * 3))
    assert pcs(at(result, "scales", 47.9)) == {0, 2, 4, 5, 7, 9, 11}
    assert pcs(at(result, "scales", 48.1)) == {1, 2, 4, 6, 7, 9, 11}


def test_minor_dominant_uses_existing_family_with_observed_raised_leading_note():
    result = prototype.analyse_harmony(song(["Am", "Dm", "E7", "Am"] * 4))
    scale = at(result, "scales", 9)
    assert (scale["root"], scale["type"]) == ("A", "harmonic_minor")
    assert set(at(result, "harmony", 9)["chord_tones"]) <= pcs(scale)


@pytest.mark.parametrize("options", [None, {"minimum_margin": 0}, {"switch_cost": 0}])
def test_missing_degrees_are_unknown_even_with_a_repeated_minor_tonic(options):
    result = prototype.analyse_harmony(song(["Em", "Am", "Em", "Am"] * 4), options)
    assert all(event.get("unknown") for event in result["scales"]["events"])


def test_power_chords_and_implied_label_thirds_do_not_establish_collections():
    data = song(["C", "F", "G", "C"] * 4)
    for event in data["arrangements"][0]["chords"]:
        root = prototype._BASE.parse_chord(event["label"])["pc"]
        event["pcs"] = sorted({root, (root + 7) % 12})
        event["pitches"] = [48 + pc for pc in event["pcs"]]
    result = prototype.analyse_harmony(data)
    assert all(event.get("unknown") for event in result["scales"]["events"])
    assert all(len(event.get("chord_tones", [])) == 2 for event in result["harmony"]["events"])


def test_long_gap_severs_sequence_and_does_not_resolve_following_sparse_collection():
    data = song(["C", "F", "G7", "C"] * 2 + ["Em", "Am", "Em", "Am"] * 2)
    for event in data["arrangements"][0]["chords"][8:]:
        event["t"] += 16
        event["end"] += 16
    data["duration"] += 16
    data["beats"] = list(range(data["duration"] + 1))
    result = prototype.analyse_harmony(data)
    assert not at(result, "scales", 15).get("unknown")
    assert at(result, "scales", 40)["unknown"]
    assert at(result, "scales", 55)["unknown"]


def test_source_is_unchanged_and_production_keys_chords_are_identical():
    data = song(["Am", "F", "C", "G"] * 4)
    before = copy.deepcopy(data)
    baseline = prototype._BASE.analyse_harmony(data)
    result = prototype.analyse_harmony(data)
    assert data == before
    assert result["keys"] == baseline["keys"]
    assert result["harmony"] == baseline["harmony"]
    assert result["algorithm_version"] == prototype.ALGORITHM_VERSION
    json.dumps(result, allow_nan=False)
    for track in ("keys", "harmony", "scales"):
        events = result[track]["events"]
        assert events[0]["t"] == 0 and events[-1]["end"] == data["duration"]
        assert all(a["end"] == b["t"] for a, b in zip(events, events[1:]))
        assert all(event["end"] > event["t"] for event in events)


def test_merged_scale_evidence_uses_minimum_margin_and_all_compatible_chords():
    data = song(["C", "F", "G7", "C"] * 3)
    result = prototype.analyse_harmony(data)
    merged = next(event for event in result["scales"]["events"] if event["end"] - event["t"] > 8)
    overlaps = [cell for cell in result["phrase_analysis"]["phrases"]
                if cell["t"] < merged["end"] and cell["end"] > merged["t"]]
    assert merged["evidence"]["path_cost_margin"] == min(cell["path_cost_margin"] for cell in overlaps)
    observed = set().union(*(set(event.get("chord_tones", [])) for event in result["harmony"]["events"]
                           if event["t"] < merged["end"] and event["end"] > merged["t"]))
    assert set(merged["evidence"]["compatible_chord_tones"]) == observed
    assert "phrase_end" not in merged["evidence"]


def test_phrase_timing_uses_beat_map_and_is_invariant_under_tempo_transform():
    data = song(["C", "F", "G7", "C"] * 3 + ["D", "G", "A7", "D"] * 3)
    baseline = prototype.analyse_harmony(data)
    # Piecewise tempo change, not a single seconds-to-beats multiplier.
    transform = lambda time: time * .5 if time <= 32 else 16 + (time - 32) * 1.5
    data["duration"] = transform(data["duration"])
    data["beats"] = list(map(transform, data["beats"]))
    for event in data["arrangements"][0]["chords"]:
        event["t"], event["end"] = transform(event["t"]), transform(event["end"])
    changed = prototype.analyse_harmony(data)
    for time in (3, 19, 35, 47, 49, 65, 91):
        assert pcs(at(changed, "scales", transform(time))) == pcs(at(baseline, "scales", time))


def test_cancelled_analysis_and_sequence_never_return_partial_result():
    with pytest.raises(prototype.AnalysisCancelled):
        prototype.analyse_harmony(song(["C", "F", "G7", "C"] * 3), cancelled=lambda: True)
    with pytest.raises(prototype.AnalysisCancelled):
        prototype.decode_collections([[0, 1]] * 10, 1, cancelled=lambda: True)


@pytest.mark.parametrize("options", [{"unexpected": 1}, {"switch_cost": -1}, {"switch_cost": float("nan")},
                                    {"phrase_beats": 0}, {"minimum_margin": True}])
def test_invalid_research_options_fail_instead_of_silently_changing_method(options):
    with pytest.raises(ValueError):
        prototype.analyse_harmony(song(["C", "F", "G", "C"]), options)


def test_frozen_prototype_loads_sibling_dependency_without_a_repository(tmp_path):
    frozen = tmp_path / "candidate-engine.py"
    shutil.copyfile(Path(prototype.__file__), frozen)
    shutil.copyfile(prototype._DEPENDENCY, tmp_path / "production-engine.py")
    spec = importlib.util.spec_from_file_location("frozen_phrase_candidate", frozen)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.analyse_harmony(song(["C", "F", "G7", "C"] * 2))
    assert module._DEPENDENCY.parent == tmp_path
    assert result["algorithm_version"] == prototype.ALGORITHM_VERSION
    assert result["summary"]["scale_coverage"] > 0


def test_empty_input_and_absent_beat_map_are_bounded_json_safe():
    empty = prototype.analyse_harmony({"duration": 0, "arrangements": []})
    assert empty["scales"]["events"] == []
    assert empty["status"] == "unsupported"
    data = song(["C", "F", "G7", "C"] * 3)
    data.pop("beats")
    result = prototype.analyse_harmony(data)
    assert result["scales"]["events"][-1]["end"] == data["duration"]
    json.dumps(result, allow_nan=False)
