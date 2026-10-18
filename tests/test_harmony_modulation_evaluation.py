"""Guard reference alignment and honest key-agreement metrics."""

import pytest
from pathlib import Path
import subprocess
import sys

from tools.evaluate_harmony_modulations import aligned_references, timeline_metrics


def test_evaluator_cli_can_load_its_source_adapter_outside_the_repo(tmp_path):
    script = Path(__file__).resolve().parents[1] / "tools/evaluate_harmony_modulations.py"
    completed = subprocess.run([sys.executable, str(script), "--help"], cwd=tmp_path, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    assert "--references" in completed.stdout


def result(keys, scales=()):
    return {"keys": {"events": keys}, "scales": {"events": list(scales)}}


def reference(segments):
    return aligned_references({"segments": segments}, {"verified": True, "method": "reviewed anchors"}, 100)


def test_unknown_is_abstention_and_relative_key_is_not_exact_credit():
    refs = reference([{"start": 0, "end": 30, "keys": ["C major"]}])
    prediction = result([{"t": 0, "end": 10, "key": "C major"},
                         {"t": 10, "end": 20, "unknown": True},
                         {"t": 20, "end": 30, "key": "A minor"}])
    metrics = timeline_metrics(prediction, refs, list(range(31)))
    assert metrics["key_coverage"] == pytest.approx(2 / 3)
    assert metrics["key_accuracy_when_shown"] == .5
    assert metrics["correct_key_coverage"] == pytest.approx(1 / 3)
    assert metrics["key_collection_match_seconds"] == 20
    assert metrics["key_wrong_seconds"] == 10


def test_reference_transform_is_explicit_and_rejects_overlapping_intervals():
    song = {"segments": [{"start": 10, "end": 20, "keys": ["Db major", "Bb minor"]}]}
    aligned = aligned_references(song, {"verified": True, "method": "two chord anchors", "reference_offset": 10,
                                       "chart_offset": 5, "rate": 2}, 23)
    assert aligned == [{"t": 5, "end": 23, "keys": [(1, "major"), (10, "minor")]}]
    transposed = aligned_references(song, {"verified": True, "method": "pitch anchors",
                                          "pitch_transposition_semitones": -1}, 100)
    assert transposed[0]["keys"] == [(0, "major"), (9, "minor")]
    with pytest.raises(ValueError, match="verified"):
        aligned_references(song, {}, 100)
    with pytest.raises(ValueError, match="non-overlapping"):
        reference([{"start": 0, "end": 15, "keys": ["C major"]},
                   {"start": 10, "end": 20, "keys": ["G major"]}])


def test_boundaries_use_actual_beat_map_and_keep_unknown_gap_visible():
    refs = reference([{"start": 0, "end": 16, "keys": ["C major"]},
                      {"start": 16, "end": 40, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 15, "key": "C major"},
                         {"t": 15, "end": 20, "unknown": True},
                         {"t": 20, "end": 40, "key": "D major"}])
    # Tempo halves at the change; four song seconds are two beats, not four.
    beats = list(range(17)) + list(range(18, 42, 2))
    metrics = timeline_metrics(prediction, refs, beats)
    boundary = metrics["boundaries"][0]
    assert boundary["error_beats"] == 2
    assert boundary["within_tolerance"] is True
    assert boundary["nearest_transition"]["unknown_gap_seconds"] == 5
    assert not metrics["false_switches_in_annotated_regions"]


def test_false_switch_and_reference_unknown_are_not_hidden_in_average():
    refs = reference([{"start": 0, "end": 20, "keys": ["C major"]},
                      {"start": 20, "end": 30, "keys": []}])
    prediction = result([{"t": 0, "end": 10, "key": "C major"},
                         {"t": 10, "end": 25, "key": "D major"},
                         {"t": 25, "end": 30, "key": "E major"}])
    metrics = timeline_metrics(prediction, refs, list(range(31)))
    assert metrics["reference_seconds"] == 20
    assert metrics["key_wrong_seconds"] == 10
    assert len(metrics["false_switches_in_annotated_regions"]) == 1
    assert metrics["false_switches_in_annotated_regions"][0]["t"] == 10


def test_expired_predictions_do_not_fill_a_gap_and_scale_match_is_separate():
    refs = reference([{"start": 0, "end": 20, "keys": ["A minor"]}])
    prediction = result([{"t": 0, "end": 5, "key": "A minor"}],
                        [{"t": 0, "end": 10, "root": "A", "type": "natural_minor"},
                         {"t": 10, "end": 20, "root": "A", "type": "harmonic_minor"}])
    metrics = timeline_metrics(prediction, refs, list(range(21)))
    assert metrics["key_coverage"] == .25
    assert metrics["scale_shown_seconds"] == 20
    # Harmonic minor may be appropriate over V, but a key label alone is not
    # independent evidence for that. Do not count it as exact collection match.
    assert metrics["scale_diatonic_collection_match_seconds"] == 10


def test_a_reference_gap_is_not_an_annotated_modulation():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 15, "end": 30, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 12, "key": "C major"},
                         {"t": 12, "end": 30, "key": "D major"}])
    metrics = timeline_metrics(prediction, refs, list(range(31)))
    assert not metrics["boundaries"]
    assert not metrics["false_switches_in_annotated_regions"]


def test_switching_between_accepted_ambiguous_keys_is_not_a_false_change():
    refs = reference([{"start": 0, "end": 10, "keys": ["Bb major", "G major"]}])
    prediction = result([{"t": 0, "end": 5, "key": "Bb major"},
                         {"t": 5, "end": 10, "key": "G major"}])
    metrics = timeline_metrics(prediction, refs, list(range(11)))
    assert metrics["key_accuracy_when_shown"] == 1
    assert not metrics["false_switches_in_annotated_regions"]


def test_recovery_after_an_unscored_gap_is_not_called_a_false_switch():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 20, "end": 30, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 9, "key": "C major"},
                         {"t": 9, "end": 25, "unknown": True},
                         {"t": 25, "end": 30, "key": "D major"}])
    metrics = timeline_metrics(prediction, refs, list(range(31)))
    assert len(metrics["predicted_transitions"]) == 1
    assert not metrics["boundaries"]
    assert not metrics["false_switches_in_annotated_regions"]


def test_wrong_key_detour_near_a_true_boundary_remains_a_false_switch():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 10, "end": 20, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 9, "key": "C major"},
                         {"t": 9, "end": 11, "key": "E major"},
                         {"t": 11, "end": 20, "key": "D major"}])
    metrics = timeline_metrics(prediction, refs, list(range(21)))
    assert metrics["key_wrong_seconds"] == 2
    assert not metrics["boundaries"][0]["within_tolerance"]
    assert [event["t"] for event in metrics["false_switches_in_annotated_regions"]] == [9, 11]


@pytest.mark.parametrize("transition", [7, 10, 13])
def test_boundary_timing_tolerance_still_accepts_the_correct_key_pair(transition):
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 10, "end": 20, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": transition, "key": "C major"},
                         {"t": transition, "end": 20, "key": "D major"}])
    metrics = timeline_metrics(prediction, refs, list(range(21)))
    assert metrics["boundaries"][0]["within_tolerance"]
    assert metrics["boundaries"][0]["error_beats"] == transition - 10
    assert metrics["key_wrong_seconds"] == abs(transition - 10)
    assert not metrics["false_switches_in_annotated_regions"]
