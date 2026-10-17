"""An omitted chord hold must not become an explicitly authored zero on playback."""

from xml.etree.ElementTree import fromstring

from song import (
    Note, _parse_note, chord_from_wire, chord_note_to_wire, chord_to_wire,
    note_from_wire, note_to_wire, phrase_from_wire, phrase_to_wire,
)


def test_chord_duration_presence_survives_normalized_playback_defaults():
    raw = {"t": 30.393, "id": 15, "hd": True, "notes": [{"s": 1, "f": 5}, {"s": 2, "f": 7, "sus": 0}]}
    wire = chord_to_wire(chord_from_wire(raw))
    assert "sus" not in wire["notes"][0]
    assert wire["notes"][1]["sus"] == 0
    assert wire["notes"][0]["sl"] == -1
    assert wire["notes"][0]["ho"] is False
    assert chord_to_wire(chord_from_wire(wire)) == wire


def test_repaired_positive_duration_and_original_note_identity_are_preserved():
    source = {"s": 1, "f": 5, "sus": .442}
    note = note_from_wire(source, time=30.393)
    assert chord_note_to_wire(note)["sus"] == .442
    assert note.sustain == .442
    assert source == {"s": 1, "f": 5, "sus": .442}
    omitted = note_from_wire({"s": 1, "f": 5}, time=30.393)
    assert omitted == Note(30.393, 1, 5), "presence metadata is not musical equality"
    omitted.sustain = .442
    assert chord_note_to_wire(omitted)["sus"] == .442, "later authored duration wins"
    assert chord_note_to_wire(Note(30.393, 1, 5))["sus"] == 0, "unknown constructed notes stay conservative"
    assert note_to_wire(note_from_wire({"s": 1, "f": 5}))["sus"] == 0, "standalone wire defaults are unchanged"


def test_xml_absence_and_explicit_zero_remain_distinct():
    for attribute, expected in [("", None), (' sustain="0"', 0), (' sustain="0.442"', .442)]:
        note = _parse_note(fromstring(f'<chordNote time="30.393" string="1" fret="5"{attribute}/>'))
        wire = chord_note_to_wire(note)
        assert wire.get("sus") == expected
        assert ("sus" in wire) is (expected is not None)


def test_nearby_playback_onsets_retain_the_existing_millisecond_precision():
    note = note_from_wire({"t": 30.393, "s": 1, "f": 5, "sus": .442})
    chord = chord_from_wire({"t": 30.394, "id": 15, "notes": [{"s": 1, "f": 5}, {"s": 2, "f": 7}]})
    assert note_to_wire(note)["t"] != chord_to_wire(chord)["t"]
    # The presentation matcher receives the established wire precision. It
    # cannot recover sub-ms distinctions; only source repair has raw onsets.
    note.time, chord.time = 30.393001, 30.393002
    assert note.time != chord.time
    assert note_to_wire(note)["t"] == chord_to_wire(chord)["t"] == 30.393


def test_phrase_playback_and_saved_wire_preserve_the_same_missing_duration():
    raw = {"start_time": 20, "end_time": 34, "max_difficulty": 1, "levels": [
        {"difficulty": 1, "notes": [{"t": 30.393, "s": 1, "f": 5, "sus": .442}],
         "chords": [{"t": 30.393, "id": 15, "notes": [{"s": 1, "f": 5}, {"s": 2, "f": 7}]}]},
    ]}
    phrase = phrase_from_wire(raw)
    for playback in [False, True]:
        wire = phrase_to_wire(phrase, playback=playback)
        assert wire["levels"][0]["notes"][0]["sus"] == .442
        assert all("sus" not in note for note in wire["levels"][0]["chords"][0]["notes"])
        assert "_sustain_unspecified" not in str(wire)
