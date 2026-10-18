"""Independent chord-reference evaluation must preserve uncertainty and exposure."""

import json
from pathlib import Path
import shutil

import pytest

from tools.evaluate_harmony_phrase_chords import (
    aligned_chords, aligned_scope, browser_guidance, changed_passages,
    parse_chord, run, score_guidance,
)


def alignment(**changes):
    return {"verified": True, "method": "independent anchor fit", "chart_offset": 0,
            "reference_offset": 0, "rate": 1, "uncertainty_seconds": .5,
            "pitch_transposition_semitones": 0, **changes}


def guide(start=1, end=9, kind="scale", pcs=(0, 2, 4, 5, 7, 9, 11), target=0, **extra):
    return {"t": start, "end": end, "kind": kind, "pitch_classes": list(pcs),
            "target_pc": target, **extra}


def score(chords, guidance, start=1, end=9):
    return score_guidance(chords, [{"t": 0, "end": 10}],
                          [{"start": start, "end": end, "reentry": True}], guidance)


def test_explicit_intervals_alterations_and_slash_degree_are_not_guessed_triads():
    assert parse_chord("C:(1,b3,5)")["pitch_classes"] == [0, 3, 7]
    assert parse_chord("C:7(b9,*5)/3")["pitch_classes"] == [0, 1, 4, 10]
    assert parse_chord("B:(5)")["pitch_classes"] == [6]
    assert parse_chord("F:min/6")["pitch_classes"] == [0, 2, 5, 8]
    assert parse_chord("Bb/3")["pitch_classes"] == [2, 5, 10]
    assert parse_chord("A:dim7")["pitch_classes"] == [0, 3, 6, 9]


@pytest.mark.parametrize("label", ["C:quartal", "C:foo(3)", "C:", "C:()", "C:maj/E", "C:(0)"])
def test_unsupported_syntax_is_not_invented(label):
    assert parse_chord(label)["status"] == "unsupported"


def test_affine_alignment_transposition_and_chart_time_uncertainty():
    transform = alignment(chart_offset=3, reference_offset=10, rate=2,
                          pitch_transposition_semitones=2)
    chords = aligned_chords("10 14 C:maj\n", transform)
    assert chords[0]["t"] == 3
    assert chords[0]["end"] == 11
    assert chords[0]["safe_start"] == 3.5
    assert chords[0]["safe_end"] == 10.5
    assert chords[0]["pitch_classes"] == [2, 6, 9]
    assert aligned_scope({"segments": [{"start": 11, "end": 13, "keys": ["C major"]}]},
                         transform) == [{"t": 5, "end": 9}]


def test_every_chord_boundary_is_masked_and_discarded_time_is_reported():
    chords = aligned_chords("0 5 C\n5 10 G\n", alignment())
    result = score(chords, [guide()])
    totals = result["totals"]
    assert totals["reference_rest_seconds"] == 8
    assert totals["discarded_boundary_uncertainty_seconds"] == 1
    assert totals["scorable_rest_seconds"] == 7
    assert totals["target_root_agreement_seconds"] == 3.5
    assert totals["target_outside_chord_seconds"] == 3.5
    assert totals["scale_contains_annotated_chord_seconds"] == 7


def test_missing_reference_tone_is_disagreement_even_when_chart_has_suspension():
    chords = aligned_chords("0 10 D:7\n", alignment())
    result = score(chords, [guide(pcs=(0, 2, 3, 5, 7, 9, 10), target=2,
        chart_chord_label="D7sus4", chart_chord_quality="7sus4",
        chart_grounded_pitch_classes=[0, 2, 7, 9])])
    assert result["totals"]["scale_missing_chord_tones_seconds"] == 8
    assert result["passages"][0]["missing_annotated_chord_tones"] == [6]
    assert result["passages"][0]["annotated_chord_tones_absent_from_chart"] == [6]
    assert result["passages"][0]["chart_chord_quality"] == "7sus4"


def test_unknown_no_chord_unsupported_and_unannotated_are_unscored():
    chords = aligned_chords("0 2 N\n2 4 X\n4 6 C:quartal\n", alignment(uncertainty_seconds=0))
    totals = score(chords, [guide()])["totals"]
    assert totals["reference_rest_seconds"] == 8
    assert totals["discarded_no_chord_seconds"] == 1
    assert totals["discarded_unknown_seconds"] == 2
    assert totals["discarded_unsupported_seconds"] == 2
    assert totals["discarded_no_annotation_seconds"] == 3
    assert totals.get("guidance_seconds", 0) == 0


def test_no_credit_for_unshown_guidance_or_intro_outro_or_reference_gaps():
    chords = aligned_chords("0 10 C\n", alignment())
    result = score_guidance(chords, [{"t": 3, "end": 5}],
        [{"start": 0, "end": 2, "reentry": True},
         {"start": 2, "end": 7, "reentry": True},
         {"start": 7, "end": 10, "reentry": False}],
        [guide(2, 3), guide(3, 5, "none", ()), guide(5, 7)])
    assert result["totals"]["scorable_rest_seconds"] == 2
    assert result["totals"]["no_guidance_seconds"] == 2
    assert result["totals"].get("scale_seconds", 0) == 0


def test_fallback_uses_shown_notes_and_target_containment_differs_from_root():
    chords = aligned_chords("0 10 C\n", alignment())
    result = score(chords, [guide(kind="chord_tones", pcs=(4, 7, 9), target=4)])
    totals = result["totals"]
    assert totals["target_in_chord_seconds"] == 8
    assert totals.get("target_root_agreement_seconds", 0) == 0
    assert totals["fallback_outside_chord_seconds"] == 8
    assert totals["fallback_outside_chord_tone_seconds"] == 8
    assert totals["fallback_tone_seconds"] == 24
    assert result["passages"][0]["fallback_outside_annotated_chord"] == [9]


def test_changed_passages_include_new_guidance_and_merge_equivalent_edges():
    baseline = [{"t": 2, "end": 4, "kind": "chord_tones", "pitch_classes": [0, 4, 7]}]
    current = [{"t": 2, "end": 3, "kind": "scale", "pitch_classes": [0, 2, 4, 5, 7, 9, 11]},
               {"t": 3, "end": 5, "kind": "scale", "pitch_classes": [0, 2, 4, 5, 7, 9, 11]}]
    changed = changed_passages(baseline, current)
    assert [(x["t"], x["end"]) for x in changed] == [(2, 4), (4, 5)]
    assert changed[1]["baseline"] is None


def test_rejects_unverified_alignment_overlap_and_output_overwrite(tmp_path):
    with pytest.raises(ValueError, match="verified"):
        aligned_chords("0 1 C", alignment(verified=False))
    with pytest.raises(ValueError, match="Unordered"):
        aligned_chords("0 2 C\n1 3 G", alignment())
    output = tmp_path / "evidence.json"
    output.write_text("preserve")
    with pytest.raises(FileExistsError):
        run(tmp_path, tmp_path, output, "node")
    assert output.read_text() == "preserve"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node required for browser-model contract")
def test_real_browser_model_uses_grounded_fallback_and_withholds_conflicting_scale():
    model = Path(__file__).resolve().parents[1] / "static/js/harmony-guide-model.js"
    # The actual browser fallback shows only grounded observations, even when
    # the inferred label's wider pitch set contains an ungrounded third.
    result = {"duration": 10, "keys": {"events": []}, "scales": {"events": []},
        "harmony": {"events": [{"t": 0, "end": 10, "root": "C", "quality": "maj",
            "confidence": "high", "chord_tones": [0, 4, 7], "grounded_chord_tones": [0, 7],
            "evidence": {"root_observed": True}}]}}
    values = browser_guidance(shutil.which("node"), model, result)
    assert values[0]["kind"] == "chord_tones"
    assert values[0]["pitch_classes"] == [0, 7]
    result["scales"]["events"] = [{"t": 0, "end": 10, "root": "C", "type": "natural_minor"}]
    values = browser_guidance(shutil.which("node"), model, result)
    assert values[0]["kind"] == "none"
