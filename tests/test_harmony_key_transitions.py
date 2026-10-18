"""Grounded section changes without promoting a temporary or modal tonic."""

import copy

import pytest

from harmony_analysis import _estimate_key, analyse_harmony, parse_chord, pitch_class


NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def event(label, start, end, transpose=0):
    parsed = parse_chord(label)
    root = (parsed["pc"] + transpose) % 12
    tones = sorted((pc + transpose) % 12 for pc in parsed["chord_tones"])
    return {"t": start, "end": end, "root": NAMES[root], "quality": parsed["quality"],
            "confidence": "high", "chord_tones": tones, "grounded_chord_tones": tones,
            "evidence": {"root_observed": True}}


def major_section(transpose=0):
    events = [event("E", -4, 0, transpose)]
    cursor = 0
    for label, length in [("A", 4), ("C#m", 4), ("F#m", 4), ("C#m", 4),
                          ("Bm", 8), ("E", 8)] * 2:
        events.append(event(label, cursor, cursor + length, transpose))
        cursor += length
    return events


def observations(events):
    return [{"t": chord["t"], "end": chord["end"], "pcs": chord["chord_tones"],
             "weight": 1, "group": "rhythm"} for chord in events if not chord.get("unknown")]


def estimate(events, notes=None, start=0, end=64, clock=True):
    return _estimate_key(observations(events) if notes is None else notes, events,
                         start, end, (lambda time: time) if clock else None)


def with_entrance_gap(gap, reason="no_chart_evidence"):
    events = major_section()
    events[0]["end"] = -gap
    if gap:
        events.insert(1, {"t": -gap, "end": 0, "unknown": True, "confidence": "low",
                          "evidence": {"reason": reason}})
    return events


@pytest.mark.parametrize("transpose", range(12))
def test_repeated_cadences_select_grounded_collection_in_all_keys(transpose):
    result = estimate(major_section(transpose))
    details = result["evidence"]
    assert pitch_class(result["root"]) == (9 + transpose) % 12
    assert result["mode"] == "major"
    assert result["confidence"] == "medium"
    assert details["dominant_cadences"] == 2
    assert details["observed_tonic_regions"] == 2
    assert details["observed_quality_regions"] == 12
    assert details["tonic_duration_share"] == pytest.approx(.125, abs=.001)
    assert details["margin_scope"] == "within_supported_pitch_collection"
    consistency = details["collection_consistency"]
    assert consistency["selected_collection_incompatible_regions"] == 0
    assert consistency["histogram_winner_incompatible_regions"] == 2
    assert consistency["histogram_winner"]["score"] > details["candidates"][0]["score"]


@pytest.mark.parametrize("gap,recognized", [(0, True), (.25, True), (.5, True),
                                          (.5001, False), (2, False)])
def test_entrance_cadence_uses_bounded_authored_beat_gap(gap, recognized):
    result = estimate(with_entrance_gap(gap))
    assert bool(result["evidence"].get("collection_consistency")) == recognized


@pytest.mark.parametrize("reason", ["conflicting_arrangements", "insufficient_evidence"])
def test_entrance_cadence_does_not_cross_uncertain_harmony(reason):
    result = estimate(with_entrance_gap(.25, reason))
    assert not result["evidence"].get("collection_consistency")


def test_entrance_release_checks_played_notes_before_context_start():
    events = with_entrance_gap(.25)
    notes = observations(events) + [{"t": -.2, "end": -.1, "pcs": [2],
                                     "weight": 1, "group": "independent"}]
    result = estimate(events, notes)
    assert not result["evidence"].get("collection_consistency")


def test_entrance_release_requires_beat_clock():
    result = estimate(with_entrance_gap(.25), clock=False)
    assert not result["evidence"].get("collection_consistency")


def test_single_internal_cadence_does_not_select_new_tonic():
    result = estimate(major_section()[1:])
    assert not result["evidence"].get("collection_consistency")


def test_arrival_at_context_end_does_not_count_toward_repeated_cadences():
    result = estimate(major_section(), end=32)
    assert not result["evidence"].get("collection_consistency")


def test_arrival_before_context_start_does_not_count_toward_repeated_cadences():
    result = estimate(major_section(), start=.1)
    assert not result["evidence"].get("collection_consistency")


@pytest.mark.parametrize("lengths", [(8, 8, 4, 4), (4, 4, 4, 4), (12, 12, 4, 4)])
def test_single_incoming_cadence_does_not_resolve_ordinary_relative_ambiguity(lengths):
    events, cursor = [event("G", -4, 0)], 0
    for label, length in zip(("C", "Am", "F", "G"), lengths):
        events.append(event(label, cursor, cursor + length))
        cursor += length
    notes = observations(events)
    without_antecedent = estimate(events[1:], notes, end=cursor)
    with_antecedent = estimate(events, notes, end=cursor)
    assert without_antecedent.get("unknown")
    assert without_antecedent["evidence"]["reason"] == "relative_major_minor_ambiguity"
    assert with_antecedent == without_antecedent


def test_connected_cadence_can_resolve_margin_after_independent_collection_proof():
    events, cursor = [event("E", -4, 0)], 0
    # A shorter tonic and longer relative minor leave the unconnected profile
    # margin too small. Repeated arrivals plus the observed ii-V-I establish
    # the independent collection proof before the incoming cadence contributes.
    for label, length in [("A", 3), ("C#m", 4), ("F#m", 5), ("C#m", 4),
                          ("Bm", 8), ("E", 8)] * 2:
        events.append(event(label, cursor, cursor + length))
        cursor += length
    notes = observations(events)
    assert estimate(events[1:], notes).get("unknown")
    result = estimate(events, notes)
    assert result.get("key") == "A major"
    assert result["confidence"] == "medium"
    assert result["evidence"]["score_basis"] == (
        "local_profile_with_connected_cadences_in_supported_collection")
    assert result["evidence"]["collection_consistency"]["predominant_dominant_cadences"] == 1


@pytest.mark.parametrize("replacement,tones", [("G5", None), ("A", [1, 4]), ("Am", None)])
def test_incompatible_power_chord_or_unobserved_mode_blocks_promotion(replacement, tones):
    events = major_section()
    index = 3 if replacement == "G5" else 7
    previous = events[index]
    events[index] = event(replacement, previous["t"], previous["end"])
    if tones:
        events[index]["chord_tones"] = events[index]["grounded_chord_tones"] = tones
        events[index]["evidence"]["root_observed"] = False
    result = estimate(events)
    assert not result["evidence"].get("collection_consistency")


def test_splitting_identical_adjacent_chords_does_not_inflate_cadences():
    events = major_section()
    fragments = []
    for chord in events:
        midpoint = (chord["t"] + chord["end"]) / 2
        fragments.extend([{**chord, "end": midpoint}, {**chord, "t": midpoint}])
    assert estimate(fragments) == estimate(events)


def test_splitting_one_incompatible_voicing_does_not_create_repeated_counterevidence():
    events = major_section()
    second_predominant = events[11]
    events[11] = event("C#m", second_predominant["t"], second_predominant["end"])
    notes = observations(events)
    expected = estimate(events, notes)
    assert expected.get("unknown")
    assert not expected["evidence"].get("collection_consistency")
    first_predominant = events[5]
    midpoint = (first_predominant["t"] + first_predominant["end"]) / 2
    fragmented = copy.deepcopy(events)
    fragmented[5:6] = [{**first_predominant, "end": midpoint},
                       {**first_predominant, "t": midpoint}]
    assert estimate(fragmented, notes) == expected


def test_decorating_one_opposing_chord_does_not_create_a_second_visit():
    events = major_section()
    second_predominant = events[11]
    events[11] = event("C#m", second_predominant["t"], second_predominant["end"])
    notes = observations(events)
    assert estimate(events, notes).get("unknown")
    first_predominant = events[5]
    midpoint = (first_predominant["t"] + first_predominant["end"]) / 2
    decorated = copy.deepcopy(first_predominant)
    decorated["t"] = midpoint
    decorated["chord_tones"] = decorated["grounded_chord_tones"] = [2, 6, 9, 11]
    events[5:6] = [{**first_predominant, "end": midpoint}, decorated]
    result = estimate(events, notes)
    # The added A belongs to both competing palettes. It does not turn one
    # sustained B-minor visit with D natural into two independent visits.
    assert result.get("unknown")
    assert not result["evidence"].get("collection_consistency")


def test_brief_extra_pitch_in_same_quality_voicing_blocks_collection_override():
    events = major_section()
    original = events[2]
    extension = copy.deepcopy(original)
    extension.update(t=6, end=6.25)
    extension["chord_tones"] = extension["grounded_chord_tones"] = [1, 3, 4, 8]
    events[2:3] = [{**original, "end": 6}, extension, {**original, "t": 6.25}]
    result = estimate(events)
    # C# minor's fleeting played D# is outside the proposed A-major palette.
    # Coalescing the chord name must not hide that actual observed note.
    assert not result["evidence"].get("collection_consistency")
    assert result.get("key") != "A major"


def test_antecedent_duration_does_not_supply_context_root_or_pitch_weight():
    events = major_section()
    prolonged = copy.deepcopy(events)
    prolonged[0]["t"] = -1000
    assert estimate(prolonged) == estimate(events)


@pytest.mark.parametrize("missing_pitch", [11, 2, 6])
def test_predominant_proof_requires_observed_minor_triad(missing_pitch):
    events = major_section()
    predominant = events[5]
    tones = [pc for pc in predominant["grounded_chord_tones"] if pc != missing_pitch]
    predominant["chord_tones"] = predominant["grounded_chord_tones"] = tones
    result = estimate(events)
    assert not result["evidence"].get("collection_consistency")


def test_subdominant_dominant_tonic_alone_does_not_resolve_modal_interpretation():
    events = major_section()
    predominant = events[5]
    events[5] = event("D", predominant["t"], predominant["end"])
    result = estimate(events)
    assert not result["evidence"].get("collection_consistency")


@pytest.mark.parametrize("lengths", [(8, 2, 2), (12, 4, 4), (16, 2, 2)])
def test_repeated_major_i_iv_flat_vii_keeps_tonic_uncertain(lengths):
    # The same notes can be heard as C Mixolydian I-IV-bVII or F major V-I-IV.
    # Repeated C-F arrivals support the shared palette, not a unique F tonic.
    events, cursor = [], 0
    for _ in range(3):
        for label, length in zip(("C", "F", "Bb"), lengths):
            events.append(event(label, cursor, cursor + length))
            cursor += length
    result = estimate(events, end=cursor)
    assert result.get("unknown")
    assert result["evidence"].get("shared_scale") == {"root": "F", "type": "major"}


def section_source():
    home = [(label, 4) for label in ("Am", "Dm", "Am", "E")] * 4
    bridge = [("A", 4), ("C#m", 4), ("F#m", 4), ("C#m", 4), ("Bm", 8), ("E", 8)] * 2
    chords, cursor = [], 0
    for label, length in home + bridge + home:
        tones = parse_chord(label)["chord_tones"]
        chords.append({"t": cursor, "end": cursor + length, "label": label,
                       "pcs": tones, "pitches": [48 + pc for pc in tones],
                       "evidence_id": f"rhythm:{cursor}"})
        cursor += length
    return {"duration": cursor, "beats": list(range(cursor + 1)),
            "sections": [{"t": start, "end": end, "name": name} for start, end, name in
                         [(0, 64, "home"), (64, 128, "bridge"), (128, 192, "return")]],
            "arrangements": [{"id": "rhythm", "role": "rhythm", "correlation_group": "rhythm",
                              "chords": chords}]}


def test_authored_two_phrase_context_recognizes_parallel_section_and_return():
    result = analyse_harmony(section_source())
    keys = result["keys"]["events"]
    at = lambda time: next(e for e in keys if e["t"] <= time < e["end"])
    assert at(20).get("key") == "A minor"
    assert at(64).get("key") == "A major"
    assert at(127).get("key") == "A major"
    assert at(128).get("key") == "A minor"
    assert at(64)["evidence"]["context_beats"] == 64


def test_section_names_and_correlated_duplicate_parts_supply_no_tonal_votes():
    source = section_source()
    expected = analyse_harmony(source)
    changed = copy.deepcopy(source)
    for section in changed["sections"]:
        section["name"] = "unrelated author text F# major"
    duplicate = copy.deepcopy(changed["arrangements"][0])
    duplicate["id"] = "alternate_rhythm"
    changed["arrangements"].append(duplicate)
    actual = analyse_harmony(changed)
    assert actual["keys"] == expected["keys"]
    assert actual["scales"] == expected["scales"]


def test_authored_context_longer_than_64_beats_does_not_override_local_uncertainty():
    source = section_source()

    def expand(time):
        return time if time < 64 else 64 + (time - 64) * 1.25 if time <= 128 else time + 16

    for chord in source["arrangements"][0]["chords"]:
        chord["t"], chord["end"] = expand(chord["t"]), expand(chord["end"])
    for section in source["sections"]:
        section["t"], section["end"] = expand(section["t"]), expand(section["end"])
    source["duration"], source["beats"] = 208, list(range(209))
    result = analyse_harmony(source)
    assert all(e.get("unknown") for e in result["keys"]["events"]
               if e["end"] > 64 and e["t"] < 144)


def test_64_beat_authored_section_still_requires_repeated_cadence_proof():
    source = section_source()
    antecedent = next(c for c in source["arrangements"][0]["chords"] if c["t"] == 60)
    antecedent["label"] = "G"
    antecedent["pcs"] = parse_chord("G")["chord_tones"]
    antecedent["pitches"] = [48 + pc for pc in antecedent["pcs"]]
    result = analyse_harmony(source)
    assert all(e.get("unknown") for e in result["keys"]["events"]
               if e["end"] > 64 and e["t"] < 128)


@pytest.mark.parametrize("gap", [.25, .5])
@pytest.mark.parametrize("contradicting_gap_note", [False, True])
def test_context_lookup_includes_notes_in_entrance_release(contradicting_gap_note, gap):
    source = section_source()
    arrangement = source["arrangements"][0]
    next(c for c in arrangement["chords"] if c["t"] == 60)["end"] = 64 - gap
    if contradicting_gap_note:
        arrangement["notes"] = [{"t": 63.8, "end": 63.9, "midi": 62, "pc": 2,
                                  "weight": 1, "pitched": True, "evidence_id": "release-pitch"}]
    result = analyse_harmony(source)
    section = [e for e in result["keys"]["events"] if e["end"] > 64 and e["t"] < 128]
    if contradicting_gap_note:
        assert all(e.get("unknown") for e in section)
    else:
        assert all(e.get("key") == "A major" for e in section)
