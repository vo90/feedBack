"""Guard reference alignment and honest key-agreement metrics."""

import pytest
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from tools.evaluate_harmony_modulations import aligned_references, rest_reference_metrics, timeline_metrics


def test_research_candidate_and_options_are_frozen_without_changing_production(tmp_path, monkeypatch):
    from tools import evaluate_harmony_modulations as evaluator

    pack = tmp_path / "song.feedpak"
    pack.write_bytes(b"read-only source fixture")
    references = tmp_path / "references.json"
    references.write_text(json.dumps({"songs": [{"id": "song", "segments": [
        {"start": 0, "end": 10, "keys": ["C major"]}]}]}))
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"reference_sha256": hashlib.sha256(references.read_bytes()).hexdigest(),
        "songs": [{"id": "song", "path": str(pack),
                   "source_sha256": hashlib.sha256(pack.read_bytes()).hexdigest(),
                   "alignment": {"verified": True, "method": "fixture"}}]}))
    engine_source = '''ALGORITHM_VERSION = "fixture"
def analyse_harmony(source, options=None):
    return {"duration": 10, "options_received": options,
            **{track: {"events": [{"t": 0, "end": 10, "unknown": True}]}
               for track in ("keys", "harmony", "scales")}}
'''
    baseline, candidate = tmp_path / "baseline.py", tmp_path / "candidate.py"
    baseline.write_text(engine_source)
    candidate.write_text(engine_source.replace('"fixture"', '"candidate-fixture"'))
    candidate_bytes = candidate.read_bytes()
    production = evaluator.REPO / "lib/harmony_analysis.py"
    production_bytes = production.read_bytes()
    output = tmp_path / "comparison"
    monkeypatch.setattr(evaluator, "load_harmony_source", lambda path: {
        "duration": 10, "beats": list(range(11)), "title": "Fixture", "revision": "fixture"})
    monkeypatch.setattr(evaluator, "lead_chart", lambda *args: None)
    monkeypatch.setattr(sys, "argv", [str(evaluator.__file__), "--manifest", str(manifest),
        "--references", str(references), "--baseline-module", str(baseline),
        "--candidate-module", str(candidate), "--candidate-options", '{"switch_cost":0}',
        "--node", "unused-without-lead-chart", "--output", str(output)])
    evaluator.main()
    assert json.loads((output / "song-current.json").read_text())["options_received"] == {"switch_cost": 0}
    assert json.loads((output / "song-baseline.json").read_text())["options_received"] is None
    assert (output / "current-engine.py").read_bytes() == candidate_bytes
    assert (output / "production-engine.py").read_bytes() == production_bytes
    assert production.read_bytes() == production_bytes
    definition = json.loads((output / "run-definition.json").read_text())
    assert definition["candidate_options"] == {"switch_cost": 0}
    assert definition["sha256"]["production-engine.py"] == hashlib.sha256(production_bytes).hexdigest()


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


def test_unknown_reasons_and_missing_events_account_for_all_abstention():
    refs = reference([{"start": 0, "end": 20, "keys": ["C major"]}])
    metrics = timeline_metrics(result([
        {"t": 0, "end": 5, "unknown": True, "evidence": {"reason": "missing_degrees"}},
        {"t": 5, "end": 10, "unknown": True},
        {"t": 15, "end": 20, "key": "C major"},
    ]), refs, list(range(21)))
    assert metrics["key_unknown_seconds_by_reason"] == {
        "missing_degrees": 5, "unspecified": 5, "missing_event": 5}
    assert sum(metrics["key_unknown_seconds_by_reason"].values()) + metrics["key_known_seconds"] == 20


def test_subset_collection_is_separate_from_exact_scale_and_tonic_agreement():
    refs = reference([{"start": 0, "end": 20, "keys": ["C major"]}])
    metrics = timeline_metrics(result([], [
        {"t": 0, "end": 10, "root": "A", "type": "minor_pentatonic"},
        {"t": 10, "end": 20, "root": "D", "type": "dorian"},
    ]), refs, list(range(21)))
    assert metrics["scale_diatonic_collection_match_seconds"] == 10
    assert metrics["scale_diatonic_collection_subset_seconds"] == 20
    assert metrics["key_correct_seconds"] == 0
    with pytest.raises(ValueError, match="Unsupported predicted scale"):
        timeline_metrics(result([], [{"t": 0, "end": 20, "root": "C", "type": "typo"}]), refs, [])


def test_rest_agreement_requires_rendered_guidance_scored_reference_and_actual_rest():
    refs = reference([{"start": 0, "end": 14, "keys": ["C major"]},
                      {"start": 14, "end": 20, "keys": []}])
    prediction = result([], [{"t": 0, "end": 10, "root": "C", "type": "major"},
                             {"t": 10, "end": 20, "root": "A", "type": "minor_pentatonic"}])
    rests = {"available": True, "arrangement_id": "lead", "qualifying_windows": [
        {"start": 0, "end": 2, "reentry": True}, {"start": 4, "end": 14, "reentry": True},
        {"start": 16, "end": 20, "reentry": False}], "guidance_spans": {
        "scale": [{"start": 0, "end": 6}, {"start": 10, "end": 20}],
        "chord_tones": [{"start": 6, "end": 10}]}}
    # A tempo change at10: beats must not be inferred from song seconds.
    metrics = rest_reference_metrics(prediction, refs, list(range(11)) + [12, 14, 16, 18, 20], rests)
    assert metrics["all"]["reference_rest_seconds"] == 12
    assert metrics["interior"]["reference_rest_seconds"] == 10
    assert metrics["interior"]["reference_rest_beats"] == 8
    assert metrics["interior"]["scale_visible_seconds"] == 6
    assert metrics["interior"]["scale_visible_beats"] == 4
    assert metrics["interior"]["scale_exact_collection_seconds"] == 2
    assert metrics["interior"]["scale_subset_collection_seconds"] == 6
    assert metrics["interior"]["chord_tones_visible_seconds"] == 4
    assert metrics["all"]["scale_exact_collection_seconds"] == 4


def test_unknown_palette_with_known_tonic_never_gets_scale_credit_in_rests():
    refs = reference([{"start": 0, "end": 10, "keys": ["E minor"]}])
    prediction = result([{"t": 0, "end": 10, "key": "E minor"}],
                        [{"t": 0, "end": 10, "unknown": True}])
    rests = {"available": True, "qualifying_windows": [{"start": 1, "end": 9, "reentry": True}],
             "guidance_spans": {"scale": [], "chord_tones": [{"start": 0, "end": 10}]}}
    metrics = rest_reference_metrics(prediction, refs, list(range(11)), rests)
    assert metrics["interior"]["scale_visible_seconds"] == 0
    assert metrics["interior"]["chord_tones_visible_seconds"] == 8
    assert rest_reference_metrics(prediction, refs, [], {"available": False, "reason": "no_lead_chart"}) == {
        "available": False, "reason": "no_lead_chart"}


def test_section_diagnostics_keep_late_recovery_separate_from_boundary_success():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 10, "end": 30, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 9, "key": "C major"},
                         {"t": 9, "end": 17, "unknown": True},
                         {"t": 17, "end": 30, "key": "D major"}])
    metrics = timeline_metrics(prediction, refs, list(range(31)))
    assert not metrics["boundaries"][0]["within_tolerance"]
    assert len(metrics["false_switches_in_annotated_regions"]) == 1
    diagnostics = metrics["section_transition_diagnostics"]
    section = diagnostics["sections"][1]
    assert section["correct_seconds"] == 13
    assert section["unknown_seconds"] == 7
    assert section["wrong_seconds"] == 0
    assert section["first_correct_span"]["t"] == 17
    assert section["last_correct_span"]["end"] == 30
    assert not diagnostics["boundaries"][0]["two_sided_correct_evidence"]


@pytest.mark.parametrize("gap_key,unknown_seconds,wrong_seconds", [
    (None, 3, 0), ("E major", 0, 3),
])
def test_near_boundary_correct_fragments_do_not_hide_wrong_key_detours(gap_key, unknown_seconds, wrong_seconds):
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 10, "end": 20, "keys": ["D major"]}])
    prediction = result([{"t": 0, "end": 9, "key": "C major"},
                         {"t": 9, "end": 12, **({"key": gap_key} if gap_key else {"unknown": True})},
                         {"t": 12, "end": 20, "key": "D major"}])
    diagnostics = timeline_metrics(prediction, refs, list(range(21)))["section_transition_diagnostics"]
    boundary = diagnostics["boundaries"][0]
    assert boundary["two_sided_correct_evidence"]
    assert boundary["before"]["t"] == 6
    assert boundary["after"]["end"] == 14
    candidate = boundary["candidate_transition"]
    assert candidate["gap_seconds"] == 3
    assert candidate["unknown_gap_seconds"] == unknown_seconds
    assert candidate["intervening_wrong_key_seconds"] == wrong_seconds
    assert candidate["prediction_error_beats"] == 2


def test_tiny_clipped_reference_edge_is_flagged_without_changing_legacy_tally():
    refs = reference([{"start": 9.96, "end": 10, "keys": ["F minor"]},
                      {"start": 10, "end": 20, "keys": ["F major"]}])
    metrics = timeline_metrics(result([{"t": 0, "end": 20, "key": "F major"}]), refs,
                               list(range(21)), reference_uncertainty_seconds=.5)
    assert len(metrics["boundaries"]) == 1
    assert not metrics["boundaries"][0]["within_tolerance"]
    boundary = metrics["section_transition_diagnostics"]["boundaries"][0]
    assert boundary["before_reference_limited"]
    assert boundary["before_uncertainty_limited"]
    assert not boundary["after_reference_limited"]
    assert not boundary["after_uncertainty_limited"]
    assert boundary["before"]["wrong_seconds"] == pytest.approx(.04)


def test_section_diagnostics_use_actual_tempo_and_do_not_credit_relative_keys():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]},
                      {"start": 10, "end": 24, "keys": ["D major"]}])
    metrics = timeline_metrics(result([{"t": 0, "end": 10, "key": "A minor"},
                                      {"t": 10, "end": 24, "key": "D major"}]), refs,
                               list(range(11)) + list(range(12, 26, 2)))
    diagnostics = metrics["section_transition_diagnostics"]
    assert diagnostics["sections"][0]["wrong_seconds"] == 10
    assert diagnostics["sections"][0]["first_correct_span"] is None
    assert diagnostics["boundaries"][0]["after"]["end"] == 18
    assert not diagnostics["boundaries"][0]["two_sided_correct_evidence"]


def test_diagnostics_keep_expired_events_unknown_and_reject_invalid_uncertainty():
    refs = reference([{"start": 0, "end": 10, "keys": ["C major"]}])
    prediction = result([{"t": 0, "end": 2, "key": "C major"},
                         {"t": 6, "end": 8, "key": "C major"}])
    section = timeline_metrics(prediction, refs, [])["section_transition_diagnostics"]["sections"][0]
    assert section["correct_seconds"] == 4
    assert section["unknown_seconds"] == 6
    assert section["first_correct_span"]["end"] == 2
    assert section["last_correct_span"]["t"] == 6
    for uncertainty in [-1, float("inf"), float("nan")]:
        with pytest.raises(ValueError, match="uncertainty"):
            timeline_metrics(prediction, refs, [], reference_uncertainty_seconds=uncertainty)
