"""Independent harmony metrics must separate extra notes, missing notes and roots."""
import hashlib
import json

import pytest

from tools import evaluate_harmony_chord_evidence as evaluator
from tools.evaluate_harmony_phrase_chords import aligned_chords


ALIGNMENT = {"verified":True,"method":"synthetic hand-aligned fixture",
             "uncertainty_seconds":.5,"pitch_transposition_semitones":0}


def event(start, end, pcs=None, root="C", **extra):
    return {"t":start,"end":end, **({"unknown":True} if pcs is None else
            {"root":root,"grounded_chord_tones":pcs,"quality":"","confidence":"medium"}), **extra}


def score(text, before, after=None, duration=10, scope=None):
    return evaluator.score_harmony(aligned_chords(text, ALIGNMENT),
        scope or [{"t":0,"end":duration}], before, after or before, duration)


def test_common_mask_clips_outside_song_and_excludes_boundary_and_no_chord():
    result=score("-3 3 C\n3 6 N\n6 13 G", [event(0,10,[0,4,7])], scope=[{"t":-2,"end":12}])
    common=result["common"]
    assert common["annotated_scope_seconds"] == 10
    assert common["discarded_boundary_uncertainty_seconds"] == 2
    assert common["discarded_no_chord_seconds"] == 2
    assert common["scorable_seconds"] == 6
    assert result["engines"]["baseline"]["totals"]["scorable_seconds"] == result["engines"]["current"]["totals"]["scorable_seconds"]


def test_partial_voicing_has_perfect_precision_without_complete_recall():
    result=score("0 10 C:7", [event(0,10,[0,4,10])])
    values=result["engines"]["baseline"]
    assert values["totals"]["subset_of_annotation_seconds"] == 9
    assert values["rates"]["grounded_tone_precision"] == 1
    assert values["rates"]["annotated_tone_recall"] == .75
    assert values["totals"]["multi_note_root_agreement_seconds"] == 9


def test_extra_note_and_missing_note_have_separate_duration_metrics():
    result=score("0 10 C", [event(0,10,[0,4,10])])
    values=result["engines"]["baseline"]
    assert values["totals"]["outside_annotation_seconds"] == 9
    assert values["totals"]["outside_annotation_tone_seconds"] == 9
    assert values["totals"]["missing_annotation_tone_seconds"] == 9
    assert values["rates"]["grounded_tone_precision"] == pytest.approx(2/3)


def test_ungrounded_root_does_not_count_as_agreement():
    before=[event(0,5,[4,7],root="C"),event(5,10,[0],root="C")]
    values=score("0 10 C",before)["engines"]["baseline"]["totals"]
    assert values["grounded_root_seconds"] == 4.5
    assert values["root_only_root_agreement_seconds"] == 4.5
    assert values.get("multi_note_root_agreement_seconds",0) == 0


def test_new_known_harmony_reports_compatible_and_disagreeing_exposure():
    before=[event(0,10)]
    after=[event(0,5,[0,4]),event(5,10,[0,4,10])]
    result=score("0 10 C",before,after)
    assert result["transitions"]["unknown_to_annotation_subset_seconds"] == 4.5
    assert result["transitions"]["unknown_to_annotation_disagreement_seconds"] == 4.5
    assert result["changed_passages"][1]["current"]["outside_annotation"] == [10]


def test_known_to_unknown_and_changed_root_are_separate():
    before=[event(0,10,[0,4,7])]
    after=[event(0,4),event(4,10,[0,4,7],root="E")]
    result=score("0 10 C",before,after)
    assert result["transitions"]["known_to_unknown_seconds"] == 3.5
    assert result["transitions"]["changed_root_seconds"] == 5.5
    assert result["transitions"].get("changed_pitch_set_seconds",0) == 0
    assert result["engines"]["current"]["totals"]["root_in_annotation_seconds"] == 5.5
    assert result["engines"]["current"]["totals"].get("root_agreement_seconds",0) == 0


@pytest.mark.parametrize("events", [[event(0,11,[0])],[event(0,5,[0]),event(4,10,[0])],
                                    [event(0,float('nan'),[0])],[event(0,10,[12])]])
def test_invalid_or_out_of_bounds_timeline_rejected(events):
    with pytest.raises(ValueError):score("0 10 C",events)


def test_unsupported_annotation_is_explicitly_unscored():
    result=score("0 10 C:unsupported",[event(0,10,[0])])
    assert result["common"]["discarded_unsupported_seconds"] == 9
    assert result["unsupported_labels_scored_seconds"] == {"C:unsupported":9}
    assert result["engines"]["baseline"]["rates"]["grounded_tone_precision"] is None


def test_run_freezes_helpers_and_inputs_without_overwriting(tmp_path):
    comparison=tmp_path/'comparison';comparison.mkdir()
    refs={"songs":[{"id":"song","title":"Synthetic", "segments":[{"start":0,"end":10,"keys":["C major"]}]}]}
    raw=json.dumps(refs).encode()
    (comparison/'references.json').write_bytes(raw)
    manifest={"reference_sha256":hashlib.sha256(raw).hexdigest(),"songs":[{"id":"song","alignment":ALIGNMENT}]}
    (comparison/'manifest.json').write_text(json.dumps(manifest))
    for name in ('run-definition.json','baseline-engine.py','current-engine.py','source-adapter.py'):
        (comparison/name).write_text('{}')
    prediction={"duration":10,"harmony":{"events":[event(0,10,[0,4,7])]}}
    for label in ('baseline','current'):(comparison/f'song-{label}.json').write_text(json.dumps(prediction))
    (tmp_path/'song-chordlab.txt').write_text('0 10 C')
    output=tmp_path/'result.json'
    result=evaluator.run(comparison,tmp_path,output)
    assert (tmp_path/'result.json.inputs/evaluate_harmony_phrase_chords.py').is_file()
    assert (tmp_path/'result.json.inputs/song-current.json').read_bytes() == (comparison/'song-current.json').read_bytes()
    assert result['aggregate']['current']['totals']['scorable_seconds'] == 9
    with pytest.raises(FileExistsError):evaluator.run(comparison,tmp_path,output)
