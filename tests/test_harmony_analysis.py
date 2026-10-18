"""Musical contract regressions for the chart-only analysis prototype."""

import copy
import json

import pytest

from harmony_analysis import AnalysisCancelled, SCALES, analyse_harmony, parse_chord, pitch_class


def chord(label, t, end=None, pcs=None):
    parsed = parse_chord(label)
    tones = pcs if pcs is not None else parsed["chord_tones"]
    return {"t": t, "end": t if end is None else end, "label": label,
            "pcs": tones, "pitches": [48 + pc for pc in tones], "evidence_id": f"rhythm:{t}"}


def source(chords=(), duration=32, **arrangement_fields):
    return {"version": 1, "normalization_version": "test-v1", "revision": "song-r1",
            "duration": duration, "beats": list(range(duration + 1)),
            "arrangements": [{"id": "rhythm", "role": "rhythm", "correlation_group": "rhythm",
                              "chords": list(chords), **arrangement_fields}]}


def progression(labels, length=4):
    return source([chord(label, i * length, (i + 1) * length) for i, label in enumerate(labels)],
                  duration=len(labels) * length)


def at(result, track, time):
    return next(event for event in result[track]["events"] if event["t"] <= time < event["end"])


@pytest.mark.parametrize("label,root,quality,bass", [
    (" D ", "D", "maj", None), ("Dbm7", "Db", "min7", None),
    ("F♯m11", "F#", "min11", None), ("Esus4/B", "E", "sus4", "B"),
    ("B7sus4", "B", "7sus4", None), ("F13(#11)", "F", "13#11", None),
    ("Dsus2/4", "D", "sus2sus4", None), ("CM7", "C", "maj7", None),
    ("Cm7", "C", "min7", None), ("Cm(maj7)", "C", "minmaj7", None),
    ("C5/F", "C", "5", "F"),
    ("Am(add 6)", "A", "min6", None),
])
def test_chord_parser_preserves_quality_spelling_and_slash_bass(label, root, quality, bass):
    parsed = parse_chord(label)
    assert (parsed["root"], parsed["quality"], parsed["bass"]) == (root, quality, bass)
    if bass:
        assert pitch_class(bass) in parsed["chord_tones"]


@pytest.mark.parametrize("label", ["", "N.C.", "Csomething", "H7", "C7b9#5", None])
def test_unsupported_label_never_silently_becomes_major(label):
    assert parse_chord(label) is None


def test_analysis_preserves_input_revision_and_json_contract():
    data = progression(["C", "F", "G", "C"] * 2)
    original = copy.deepcopy(data)
    result = analyse_harmony(data)
    assert data == original
    assert result["revision"] == "song-r1"
    assert result["source"] == "charts"
    assert result["algorithm_version"] == "chart-harmony-v4"
    json.dumps(result, allow_nan=False)
    for track in ("keys", "harmony", "scales"):
        events = result[track]["events"]
        assert events[0]["t"] == 0
        assert events[-1]["end"] == data["duration"]
        assert all(a["end"] == b["t"] for a, b in zip(events, events[1:]))
        assert all(event["end"] > event["t"] for event in events)


def test_named_voicing_drives_exact_changes_and_cadence_key():
    result = analyse_harmony(progression(["C", "F", "G7", "C"] * 3))
    assert at(result, "harmony", 4.01)["root"] == "F"
    assert at(result, "harmony", 8.01)["quality"] == "7"
    assert at(result, "keys", 10)["key"] == "C major"
    assert at(result, "scales", 10)["type"] == "major"


def test_evidence_expires_across_long_uncharted_pause_without_no_chord():
    data = source([chord("", 11, pcs=[3, 10]), chord("", 44, pcs=[3, 10])], duration=50)
    result = analyse_harmony(data)
    assert not at(result, "harmony", 11.1).get("unknown")
    assert at(result, "harmony", 20)["unknown"]
    assert at(result, "harmony", 43)["unknown"]
    assert "root" not in at(result, "harmony", 20)
    assert all(event.get("no_chord") is not True for event in result["harmony"]["events"])


def test_explicit_sustain_preserves_evidence_but_new_chord_ends_it():
    result = analyse_harmony(source([chord("C", 0, 20), chord("F", 12, 24)]))
    assert at(result, "harmony", 10)["root"] == "C"
    assert at(result, "harmony", 13)["root"] == "F"
    assert at(result, "harmony", 26)["unknown"]


def test_power_chord_and_octave_never_invent_major_minor_quality():
    data = source([chord("", 0, 4, [0, 7]), chord("", 4, 8, [9])], duration=8)
    result = analyse_harmony(data)
    assert at(result, "harmony", 1)["quality"] == "5"
    assert at(result, "harmony", 5)["quality"] == ""
    assert at(result, "keys", 1)["unknown"]
    assert at(result, "scales", 1)["unknown"]


def test_bad_named_chord_is_rejected_in_favour_of_actual_voicing():
    result = analyse_harmony(source([chord("C", 0, 4, [0, 3, 7])]))
    assert at(result, "harmony", 1)["quality"] == "min"
    assert any(d["code"] == "label_voicing_conflict" for d in result["diagnostics"])


def test_unused_handshape_does_not_create_harmony():
    data = source(handshapes=[chord("G", 0, 20)])
    result = analyse_harmony(data)
    assert all(event.get("unknown") for event in result["harmony"]["events"])


def test_arpeggio_corroborates_handshape_and_sparse_region_expires():
    notes = [{"t": t, "end": t, "midi": 48 + pc, "pc": pc} for t, pc in [(2, 7), (3, 11), (4, 2), (17, 7)]]
    data = source(handshapes=[chord("G", 0, 20)], notes=notes)
    result = analyse_harmony(data)
    assert at(result, "harmony", 3)["root"] == "G"
    assert at(result, "harmony", 3)["evidence"]["kind"] == "handshape"
    assert at(result, "harmony", 10)["unknown"]
    assert at(result, "harmony", 18)["unknown"]  # one isolated note cannot validate a triad


def test_bass_repetition_is_tentative_root_only_and_walking_line_stays_unknown():
    notes = [{"t": t / 4, "end": t / 4, "pc": 9, "midi": 33} for t in range(8)]
    result = analyse_harmony(source(duration=8, role="bass", notes=notes))
    event = at(result, "harmony", .5)
    assert (event["root"], event["quality"], event["confidence"]) == ("A", "", "low")
    assert at(result, "harmony", 6)["unknown"]
    for i, note in enumerate(notes):
        note["pc"] = [0, 2, 4, 7][i % 4]
    result = analyse_harmony(source(duration=8, role="bass", notes=notes))
    assert at(result, "harmony", .5)["unknown"]


def test_duplicate_alternate_arrangements_do_not_multiply_support():
    data = progression(["C", "F", "G", "C"])
    data["arrangements"][0]["correlation_group"] = "rhythm"
    other = {"id": "lead", "role": "lead", "correlation_group": "lead", "chords": [chord("Dm", 0, 16)]}
    one = analyse_harmony({**data, "arrangements": data["arrangements"] + [other]})
    many = analyse_harmony({**data, "arrangements": data["arrangements"] + [copy.deepcopy(other) for _ in range(20)]})
    assert [e.get("root") for e in one["harmony"]["events"]] == [e.get("root") for e in many["harmony"]["events"]]


def test_complementary_power_and_suspended_voicings_keep_named_full_harmony():
    data = source([chord("F", 0, 4)])
    data["arrangements"].append({"id": "lead", "role": "lead", "chords": [chord("F5", 0, 4)]})
    result = analyse_harmony(data)
    assert at(result, "harmony", 1)["quality"] == "maj"


def test_borrowed_chords_do_not_relabel_key_or_get_incompatible_scales():
    result = analyse_harmony(progression(["G", "B", "C", "Cm"] * 4))
    assert {e.get("key") for e in result["keys"]["events"]} == {"G major"}
    assert at(result, "scales", 1)["type"] == "major"
    assert at(result, "scales", 5)["unknown"]
    assert at(result, "scales", 13)["unknown"]
    assert at(result, "harmony", 13)["quality"] == "min"


def test_minor_dominant_selects_harmonic_minor_without_changing_song_key():
    result = analyse_harmony(progression(["Am", "Dm", "E7", "Am"] * 3))
    assert at(result, "keys", 9)["key"] == "A minor"
    assert at(result, "scales", 1)["type"] == "natural_minor"
    assert at(result, "scales", 9)["type"] == "harmonic_minor"
    assert at(result, "scales", 9)["root"] == "A"


def test_relative_major_minor_loop_ambiguity_is_not_high_confidence_key():
    result = analyse_harmony(progression(["Am", "F", "C", "G"] * 4))
    assert at(result, "keys", 1)["unknown"]
    assert at(result, "keys", 1)["evidence"]["reason"] == "relative_major_minor_ambiguity"
    scale = at(result, "scales", 1)
    assert not scale.get("unknown")
    assert scale["evidence"]["reason"] == "relative_keys_share_pitch_collection"
    assert scale["root"] == "C"


@pytest.mark.parametrize("labels,unique_pitches", [
    (["C", "Am", "C", "Am"], 4),
    (["Cadd9", "Am", "Cadd9", "Am"], 5),
    (["B", "F#", "G#m", "G#m7"], 6),
])
def test_missing_distinguishing_degree_withholds_full_scale(labels, unique_pitches):
    assert len({pc for label in labels for pc in parse_chord(label)["chord_tones"]}) == unique_pitches
    result = analyse_harmony(progression(labels * 5))
    key = at(result, "keys", 1)
    assert key["unknown"]
    assert key["evidence"]["reason"] == "unresolved_scale_degrees"
    assert key["evidence"]["ambiguous_collections"]
    assert "shared_scale" not in key["evidence"]
    assert all(event.get("unknown") for event in result["scales"]["events"])
    assert result["summary"]["chord_coverage"] == 1


def test_a_cadence_does_not_establish_unplayed_scale_degrees():
    result = analyse_harmony(progression(["G", "C", "Em", "C"] * 5))
    assert at(result, "keys", 1)["evidence"]["reason"] == "unresolved_scale_degrees"
    assert at(result, "scales", 1)["unknown"]


def test_trace_uncertain_pitch_does_not_resolve_collection_ambiguity():
    data = progression(["B", "F#", "G#m", "G#m7"] * 5)
    data["arrangements"][0]["notes"] = [{"t": 1, "end": 1, "pc": 5, "midi": 65,
                                         "weight": .001, "uncertain": True}]
    result = analyse_harmony(data)
    assert at(result, "keys", 1)["evidence"]["reason"] == "unresolved_scale_degrees"
    assert at(result, "scales", 1)["unknown"]


def test_complete_seven_pitch_cadence_remains_available():
    result = analyse_harmony(progression(["C", "F", "G7", "C"] * 5))
    assert at(result, "keys", 1)["key"] == "C major"
    assert at(result, "scales", 1)["type"] == "major"


def test_unlabelled_extension_is_preserved_in_supported_tones():
    result = analyse_harmony(source([chord("C/B", 0, 4, [0, 2, 7, 11])]))
    event = at(result, "harmony", 1)
    assert event["root"] == "C"
    assert event["bass"] == "B"
    assert 2 in event["chord_tones"]
    assert event["display_label"] == "C/B"


def test_brief_dominant_section_does_not_relabel_the_song_key():
    data = progression(["C", "F", "G", "C"] * 3 + ["G", "C", "D", "G"] + ["C", "F", "G", "C"] * 3)
    data["sections"] = [{"t": 0, "end": 48, "name": "verse"},
                        {"t": 48, "end": 64, "name": "fill"},
                        {"t": 64, "end": 112, "name": "verse"}]
    result = analyse_harmony(data)
    assert {e.get("key") for e in result["keys"]["events"] if not e.get("unknown")} == {"C major"}
    assert all(e.get("key") != "G major" for e in result["keys"]["events"])


def test_sustained_modulation_can_change_section_key():
    data = progression(["C", "F", "G", "C"] * 5 + ["D", "G", "A", "D"] * 5)
    data["sections"] = [{"t": 0, "end": 80, "name": "first"},
                        {"t": 80, "end": 160, "name": "second"}]
    result = analyse_harmony(data)
    assert at(result, "keys", 10)["key"] == "C major"
    assert at(result, "keys", 100)["key"] == "D major"


def test_every_displayed_scale_contains_every_supported_current_chord_tone():
    result = analyse_harmony(progression(["Am", "Dm", "E7", "Am", "C", "F", "B", "Cm"] * 3))
    for event in result["scales"]["events"]:
        if event.get("unknown"):
            continue
        pcs = {(pitch_class(event["root"]) + n) % 12 for n in SCALES[event["type"]]}
        for harmony in result["harmony"]["events"]:
            if harmony["t"] < event["end"] and harmony["end"] > event["t"] and not harmony.get("unknown"):
                assert set(harmony["chord_tones"]) <= pcs


def test_cancellation_is_propagated_and_never_returns_cacheable_partial_result():
    with pytest.raises(AnalysisCancelled):
        analyse_harmony(progression(["C", "F", "G", "C"]), cancelled=lambda: True)
    calls = 0

    def stop_during_work():
        nonlocal calls
        calls += 1
        return calls >= 3

    with pytest.raises(AnalysisCancelled):
        analyse_harmony(progression(["C", "F", "G", "C"] * 100), cancelled=stop_during_work)


def test_empty_source_is_supported_as_explicit_unknown():
    result = analyse_harmony({"duration": 20, "arrangements": []})
    assert result["status"] == "unsupported"
    assert result["summary"]["chord_coverage"] == 0
    assert at(result, "harmony", 5)["unknown"]


def test_named_dyad_keeps_unplayed_third_and_slash_bass_as_label_only():
    result = analyse_harmony(source([chord("C/E", 0, 4, pcs=[0, 7])]))
    event = at(result, "harmony", 1)
    assert event["quality"] == "maj"  # a chart-label hypothesis, not a played third
    assert event["grounded_chord_tones"] == event["chord_tones"] == [0, 7]
    assert event["evidence"]["observed_pcs"] == [0, 7]
    assert event["evidence"]["label_implied_pcs"] == [4]
    assert event["evidence"]["quality_basis"] == "label"
    assert event["confidence"] == "medium"
    assert "bass" not in event
    assert at(result, "keys", 1)["unknown"]
    assert at(result, "scales", 1)["unknown"]


def test_observed_quality_beats_incomplete_conflicting_label_for_same_root():
    data = source([chord("C", 0, 4, pcs=[0, 7])])
    data["arrangements"].append({"id": "lead", "role": "lead", "chords": [
        chord("", 0, 4, pcs=[0, 3, 7])]})
    event = at(analyse_harmony(data), "harmony", 1)
    assert event["quality"] == "min"
    assert event["grounded_chord_tones"] == [0, 3, 7]


def test_handshape_template_does_not_turn_unplayed_third_into_observation():
    notes = [{"t": t, "end": t, "midi": 48 + pc, "pc": pc}
             for t, pc in [(0, 0), (1, 7), (2, 0), (3, 7)]]
    data = source(handshapes=[chord("C", 0, 8, pcs=[0, 4, 7])], notes=notes)
    event = at(analyse_harmony(data), "harmony", 1)
    assert event["grounded_chord_tones"] == [0, 7]
    assert event["evidence"]["label_implied_pcs"] == [4]
    assert event["confidence"] == "medium"


def test_adjacent_same_label_keeps_distinct_observed_evidence_windows():
    data = source([chord("C", 0, 4, pcs=[0, 7]), chord("C", 4, 8, pcs=[0, 4, 7])])
    result = analyse_harmony(data)
    assert at(result, "harmony", 1)["grounded_chord_tones"] == [0, 7]
    assert at(result, "harmony", 5)["grounded_chord_tones"] == [0, 4, 7]
    assert at(result, "harmony", 1)["end"] == 4


def test_rootless_label_reports_missing_root_without_scale_target():
    data = progression(["C", "F", "G7", "C"] * 3)
    data["arrangements"][0]["chords"][0] = chord("C", 0, 4, pcs=[4, 7])
    result = analyse_harmony(data)
    event = at(result, "harmony", 1)
    assert event["evidence"]["root_observed"] is False
    assert event["evidence"]["label_implied_pcs"] == [0]
    assert at(result, "scales", 1)["unknown"]


def test_single_bass_pitch_encoded_as_chord_stays_tentative():
    result = analyse_harmony(source([chord("", 0, 4, pcs=[9])], role="bass"))
    event = at(result, "harmony", 1)
    assert event["quality"] == ""
    assert event["confidence"] == "low"
    assert event["evidence"]["kind"] == "bass_root_candidate"
    assert at(result, "scales", 1)["unknown"]


def test_label_only_thirds_do_not_establish_major_key_or_scale():
    labels_and_pcs = [("C", [0, 7]), ("F", [0, 5]), ("G7", [2, 7, 5]), ("C", [0, 7])]
    data = source([chord(label, i * 4, (i + 1) * 4, pcs=pcs)
                   for i, (label, pcs) in enumerate(labels_and_pcs * 4)], duration=64)
    result = analyse_harmony(data)
    assert all(event.get("unknown") for event in result["keys"]["events"])
    assert all(event.get("unknown") for event in result["scales"]["events"])
    assert all(set(event["chord_tones"]) <= {0, 2, 5, 7}
               for event in result["harmony"]["events"] if not event.get("unknown"))


def test_power_chord_context_and_loose_scale_pitches_do_not_establish_tonic_quality():
    pcs = ([0, 7], [0, 5], [2, 7], [0, 7])
    data = source([chord("", i * 4, (i + 1) * 4, pcs=notes)
                   for i, notes in enumerate(pcs * 5)], duration=80)
    data["arrangements"][0]["notes"] = [
        {"t": t, "end": t + 1, "pc": pc, "midi": 48 + pc}
        for t, pc in [(1, 4), (5, 9), (9, 11), (17, 4), (21, 9), (25, 11)]]
    result = analyse_harmony(data)
    assert at(result, "keys", 1)["unknown"]
    assert at(result, "keys", 1)["evidence"]["tonic_quality_observed"] is False
    assert at(result, "keys", 1)["evidence"]["observed_quality_regions"] == 0
    assert all(event.get("unknown") for event in result["scales"]["events"])


def test_uncharted_gaps_do_not_join_chords_into_observed_cadences():
    played = [("C", [0, 4, 7]), ("F", [0, 5, 9]), ("G7", [2, 5, 7, 11]), ("C", [0, 4, 7])]
    sparse = source([chord(label, i * 8, i * 8 + 1, pcs=pcs)
                     for i, (label, pcs) in enumerate(played * 4)], duration=128)
    contiguous = source([chord(label, i * 8, (i + 1) * 8, pcs=pcs)
                         for i, (label, pcs) in enumerate(played * 4)], duration=128)
    assert at(analyse_harmony(sparse), "keys", 1)["evidence"]["dominant_cadences"] == 0
    assert at(analyse_harmony(contiguous), "keys", 1)["evidence"]["dominant_cadences"] == 4


@pytest.mark.parametrize("bass_as_chord", [False, True])
def test_tentative_bass_root_cannot_erase_grounded_partial_chord(bass_as_chord):
    data = source([chord("C", 0, 4, pcs=[0, 7])], duration=4)
    bass = {"id": "bass", "role": "bass", "correlation_group": "bass"}
    if bass_as_chord:
        bass["chords"] = [chord("", 0, 4, pcs=[0])]
    else:
        bass["notes"] = [{"t": 0, "end": 4, "pc": 0, "midi": 36}]
    data["arrangements"].append(bass)
    event = at(analyse_harmony(data), "harmony", 1)
    assert event["root"] == "C"
    assert event["quality"] == "maj"
    assert event["confidence"] == "medium"
    assert event["grounded_chord_tones"] == [0, 7]
    assert event["evidence"]["kind"] == "named_chord"
    assert event["evidence"]["label_implied_pcs"] == [4]


# Explicit played voicings: labels do not supply the pitches for these local
# tonality regressions. One progression takes sixteen authored beats.
_C_PHRASE = [("C", [0, 4, 7]), ("F", [0, 5, 9]),
             ("G7", [2, 5, 7, 11]), ("C", [0, 4, 7])]
_D_PHRASE = [("D", [2, 6, 9]), ("G", [2, 7, 11]),
             ("A7", [1, 4, 7, 9]), ("D", [2, 6, 9])]


def local_progression(voicings):
    return source([chord(label, index * 4, (index + 1) * 4, pcs=pcs)
                   for index, (label, pcs) in enumerate(voicings)], duration=len(voicings) * 4)


def test_sustained_key_change_without_authored_sections_uses_local_contexts():
    result = analyse_harmony(local_progression(_C_PHRASE * 4 + _D_PHRASE * 4))
    first, second = at(result, "keys", 20), at(result, "keys", 100)
    assert first["key"] == "C major"
    assert second["key"] == "D major"
    assert first["end"] == second["t"] == 64
    assert first["evidence"]["context_end"] <= 64
    assert second["evidence"]["context_start"] >= 64
    assert second["evidence"]["scope"] == "local"
    assert second["evidence"]["stability_is_independent_votes"] is False
    assert at(result, "scales", 100)["root"] == "D"


def test_tempo_change_uses_authored_beats_for_context_size_and_boundary():
    data = local_progression(_C_PHRASE * 4 + _D_PHRASE * 4)
    beats = [index * .5 if index <= 64 else 32 + index - 64 for index in range(129)]
    for event in data["arrangements"][0]["chords"]:
        event["t"], event["end"] = beats[int(event["t"])], beats[int(event["end"])]
    data["beats"], data["duration"] = beats, beats[-1]
    result = analyse_harmony(data)
    assert at(result, "keys", 20)["key"] == "C major"
    changed = at(result, "keys", 70)
    assert changed["key"] == "D major"
    assert changed["t"] == 32
    assert changed["evidence"]["context_beats"] == 64
    assert changed["end"] == 96


def test_long_uncharted_gap_bounds_local_keys_on_both_sides():
    data = local_progression(_C_PHRASE * 4 + _D_PHRASE * 4)
    for event in data["arrangements"][0]["chords"][16:]:
        event["t"] += 40
        event["end"] += 40
    data["duration"], data["beats"] = 168, list(range(169))
    result = analyse_harmony(data)
    assert at(result, "keys", 20)["key"] == "C major"
    assert at(result, "keys", 84)["unknown"]
    assert at(result, "scales", 84)["unknown"]
    last = at(result, "keys", 140)
    assert last["key"] == "D major"
    assert last["evidence"]["context_start"] >= 104


def test_known_song_context_does_not_fill_unsupported_power_chord_section():
    power_only = [("E5", [4, 11])] * 16
    result = analyse_harmony(local_progression(_C_PHRASE * 4 + power_only + _D_PHRASE * 4))
    assert at(result, "keys", 20)["key"] == "C major"
    assert at(result, "keys", 96)["unknown"]
    assert at(result, "scales", 96)["unknown"]
    assert at(result, "keys", 172)["key"] == "D major"


@pytest.mark.parametrize("phase", range(4))
def test_relative_loop_phase_does_not_turn_window_bookends_into_key_changes(phase):
    phrase = [("Am", [0, 4, 9]), ("F", [0, 5, 9]),
              ("C", [0, 4, 7]), ("G", [2, 7, 11])]
    rotated = phrase[phase:] + phrase[:phase]
    result = analyse_harmony(local_progression(rotated * 8))
    assert all(e.get("unknown") for e in result["keys"]["events"])
    scales = [e for e in result["scales"]["events"] if not e.get("unknown")]
    assert scales
    for event in scales:
        pcs = {(pitch_class(event["root"]) + n) % 12 for n in SCALES[event["type"]]}
        assert pcs == {0, 2, 4, 5, 7, 9, 11}


def test_short_final_section_is_not_discarded_or_extended_past_song_end():
    result = analyse_harmony(local_progression(_C_PHRASE * 4 + _D_PHRASE * 2))
    assert at(result, "keys", 20)["key"] == "C major"
    final = at(result, "keys", 92)
    assert final["key"] == "D major"
    assert final["t"] == 64
    assert final["end"] == final["evidence"]["context_end"] == 96


def test_local_evidence_does_not_fill_uncharted_intro_and_outro():
    data = local_progression(_C_PHRASE * 4)
    for event in data["arrangements"][0]["chords"]:
        event["t"] += 16
        event["end"] += 16
    data["duration"], data["beats"] = 96, list(range(97))
    result = analyse_harmony(data)
    assert at(result, "keys", 8)["unknown"]
    assert at(result, "keys", 40)["key"] == "C major"
    assert at(result, "keys", 88)["unknown"]
    assert at(result, "keys", 40)["evidence"]["context_start"] == 16
    assert at(result, "keys", 40)["evidence"]["context_end"] == 80


def test_brief_bridge_does_not_move_confirmed_modulation_backwards():
    bridge = [("G", [2, 7, 11]), ("C", [0, 4, 7]),
              ("D7", [0, 2, 6, 9]), ("G", [2, 7, 11])]
    result = analyse_harmony(local_progression(_C_PHRASE * 4 + bridge + _D_PHRASE * 4))
    assert at(result, "keys", 20)["key"] == "C major"
    assert at(result, "keys", 112)["key"] == "D major"
    assert all(e.get("key") != "G major" for e in result["keys"]["events"])
    assert all(e["t"] >= 80 for e in result["keys"]["events"] if e.get("key") == "D major")


def test_cancellation_is_checked_between_local_contexts(monkeypatch):
    import harmony_analysis
    original = harmony_analysis._estimate_key
    calls = 0

    def counted(*args):
        nonlocal calls
        calls += 1
        return original(*args)

    monkeypatch.setattr(harmony_analysis, "_estimate_key", counted)
    with pytest.raises(AnalysisCancelled):
        analyse_harmony(local_progression(_C_PHRASE * 20 + _D_PHRASE * 20),
                        cancelled=lambda: calls >= 2)
    assert calls == 2


def test_sustained_center_with_brief_relative_chord_does_not_require_authentic_cadence():
    phrase = [("Cmaj7", [0, 4, 7, 11]), ("C", [0, 4, 7]),
              ("Am", [0, 4, 9]), ("Dm", [2, 5, 9]),
              ("F", [0, 5, 9]), ("C", [0, 4, 7])]
    result = analyse_harmony(local_progression(phrase * 4))
    key = at(result, "keys", 36)
    assert key["key"] == "C major"
    assert key["evidence"]["dominant_cadences"] == 0
    assert key["evidence"]["tonic_duration_share"] >= 2 * key["evidence"]["relative_tonic_duration_share"]
    assert at(result, "scales", 36)["root"] == "C"


def test_two_chord_context_does_not_supply_missing_scale_degrees():
    result = analyse_harmony(local_progression([("Em", [4, 7, 11]), ("Am", [0, 4, 9])] * 8))
    assert all(e.get("unknown") for e in result["keys"]["events"])
    assert at(result, "keys", 12)["evidence"]["reason"] == "unresolved_scale_degrees"
    assert at(result, "keys", 12)["evidence"]["observed_quality_roots"] == 2
    assert all(e.get("unknown") for e in result["scales"]["events"])


def test_distinct_root_evidence_is_invariant_under_enharmonic_spelling():
    data = local_progression([("C", [0, 4, 7]), ("F", [0, 5, 9])] * 8)
    data["arrangements"][0]["notes"] = [
        {"t": t, "end": t + 1, "midi": 48 + pc, "pc": pc}
        for t in range(0, 64, 4) for pc in (2, 11)]
    respelled = copy.deepcopy(data)
    for event in respelled["arrangements"][0]["chords"][::4]:
        event["label"] = "B#"
    original = analyse_harmony(data)
    alternate = analyse_harmony(respelled)
    assert original["keys"] == alternate["keys"]
    assert at(original, "keys", 12)["evidence"]["observed_quality_roots"] == 2


def test_authored_short_phrase_context_excludes_neighbouring_keys_and_pickup():
    a_phrase = [("A", [1, 4, 9]), ("F#m", [1, 6, 9]), ("D", [2, 6, 9]),
                ("A", [1, 4, 9]), ("E7", [2, 4, 8, 11]), ("A", [1, 4, 9])]
    data = local_progression(_C_PHRASE * 4 + a_phrase + _C_PHRASE * 4)
    # The phrase marker includes a preceding C pickup; the A key cannot begin
    # until its distinguishing played voicing. Its actual span is only 24 beats.
    data["sections"] = [{"t": 0, "end": 60}, {"t": 60, "end": 88},
                        {"t": 88, "end": 152}]
    result = analyse_harmony(data)
    key = at(result, "keys", 76)
    assert key["key"] == "A major"
    assert key["t"] >= 64 and key["end"] <= 88
    assert key["evidence"]["context_start"] >= 64
    assert key["evidence"]["context_end"] <= 88
    assert at(result, "keys", 20)["key"] == "C major"
    assert at(result, "keys", 120)["key"] == "C major"


def test_long_dominant_durations_do_not_override_repeated_tonic_cadences():
    voicings = [("G", [2, 7, 11], 2), ("C", [0, 4, 7], 2),
                ("D", [2, 6, 9], 8)] * 8
    events, cursor = [], 0
    for label, pcs, length in voicings:
        events.append(chord(label, cursor, cursor + length, pcs))
        cursor += length
    result = analyse_harmony(source(events, duration=cursor))
    assert all(e.get("key") != "D major" for e in result["keys"]["events"])
    scales = [e for e in result["scales"]["events"] if not e.get("unknown")]
    assert scales
    for scale in scales:
        assert {(pitch_class(scale["root"]) + degree) % 12 for degree in SCALES[scale["type"]]} == {0, 2, 4, 6, 7, 9, 11}


@pytest.mark.parametrize("isolated_tonic", [False, True])
def test_section_proposals_do_not_extend_a_key_through_power_only_tails(isolated_tonic):
    power = [("C5", [0, 7])] * 16
    if isolated_tonic:
        power[7] = ("C", [0, 4, 7])
    data = local_progression(_C_PHRASE * 4 + power + _D_PHRASE * 4)
    data["sections"] = [{"t": t, "end": t + 16} for t in range(0, 192, 16)]
    result = analyse_harmony(data)
    assert at(result, "keys", 20)["key"] == "C major"
    assert all(e["end"] <= 64 for e in result["keys"]["events"] if e.get("key") == "C major")
    assert at(result, "keys", 80)["unknown"]
    assert at(result, "keys", 100)["unknown"]
    assert at(result, "scales", 80)["unknown"]
    assert at(result, "keys", 172)["key"] == "D major"


def test_phrase_proposals_do_not_promote_compatible_fourth_degree_to_modulation():
    # A repeated D center includes suspended attacks and borrowed C/Bb chords.
    # A short G-C-G fragment fits G very well; that alone cannot supersede the
    # preceding supported D context when it lacks a distinguishing tonic or
    # repeated clear dominant cadence.
    played = {"D": [2, 6, 9], "Dsus4": [2, 7, 9], "G": [2, 7, 11],
              "C": [0, 4, 7], "Bb": [2, 5, 10]}
    phrase = [("D", 2), ("Dsus4", 1), ("D", 3), ("G", 2), ("C", 2), ("G", 2)]
    voicings = phrase * 3 + [("D", 4), ("Bb", 2), ("C", 2), ("D", 6),
                             ("G", 4), ("C", 2), ("G", 2), ("Bb", 4)]
    events, cursor = [], 0
    for label, length in voicings:
        events.append(chord(label, cursor, cursor + length, pcs=played[label]))
        cursor += length
    data = source(events, duration=cursor)
    data["sections"] = [{"t": t, "end": min(t + 16, cursor)} for t in range(0, cursor, 16)]
    result = analyse_harmony(data)
    assert at(result, "keys", 20)["key"] == "D major"
    assert all(e.get("key") != "G major" for e in result["keys"]["events"])
    assert at(result, "scales", 41)["unknown"]  # played Bb contradicts D major
