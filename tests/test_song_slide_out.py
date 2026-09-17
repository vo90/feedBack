"""Targetless gestures survive the real FeedPak/model/wire path without pitch targets."""
import json
import math

import pytest
import yaml

from song import Note, note_from_wire, note_to_wire, chord_from_wire, chord_to_wire
from sloppak import load_song


MARKS = [{"direction": "down", "start": 1.25, "end": 1.75}]


def test_note_round_trip_preserves_segment_without_inventing_pitch():
    original = Note(time=10, string=2, fret=19, sustain=1.75,
                    slide_out="down", slide_out_marks=MARKS)
    wire = note_to_wire(original)
    assert wire["sl"] == wire["slu"] == -1
    assert wire["slide_out_marks"] == MARKS
    assert note_from_wire(wire) == original


def test_chord_member_marks_remain_relative_to_chord_onset():
    wire = {"t": 20, "id": 0, "notes": [
        {"s": 1, "f": 19, "sus": 1.75, "slide_out_marks": MARKS},
        {"s": 2, "f": 7, "sus": 1.75},
    ]}
    chord = chord_from_wire(wire)
    output = chord_to_wire(chord)
    assert chord.notes[0].time == 20
    assert output["notes"][0]["slide_out_marks"] == MARKS
    assert "slide_out_marks" not in output["notes"][1]


@pytest.mark.parametrize("bad", [None, {}, "up", 1, [{"direction": "up", "start": True, "end": 1}],
    [{"direction": "down", "start": -1, "end": 1}],
    [{"direction": "down", "start": 1, "end": 1}],
    [{"direction": "sideways", "start": 0, "end": 1}],
    [{"direction": "up", "start": 0, "end": math.inf}],
    [{"direction": "up", "start": math.nan, "end": 1}],
    [{"direction": "up", "start": 0, "end": 2.1}],
])
def test_bad_present_array_cannot_turn_scalar_into_timed_data(bad):
    n = note_from_wire({"f": 12, "sus": 2, "slide_out": "down", "slide_out_marks": bad})
    assert note_to_wire(n)["slide_out_marks"] == []
    assert n.slide_out == "down"
    assert n.slide_to == n.slide_unpitch_to == -1


def test_arrays_are_ordered_nonoverlapping_and_tolerate_wire_rounding_only():
    marks = [
        {"direction": "up", "start": 0.2, "end": 0.5},
        {"direction": "down", "start": 0.3, "end": 0.8},
        {"direction": "down", "start": 1, "end": 1.7504},
    ]
    n = note_from_wire({"sus": 1.75, "slide_out_marks": marks})
    assert n.slide_out_marks == [marks[0], marks[2]]


def test_legacy_direction_has_no_synthetic_segment_and_defaults_are_omitted():
    assert "slide_out_marks" not in note_to_wire(note_from_wire({"slide_out": "up"}))
    assert "slide_out" not in note_to_wire(Note(0, 0, 0))
    assert note_to_wire(note_from_wire({"slide_out_marks": []}))["slide_out_marks"] == []


def test_real_feedpak_loader_and_wire_round_trip(tmp_path):
    pak = tmp_path / "slide-out.feedpak"
    pak.mkdir()
    (pak / "arrangements").mkdir()
    chart = {"name": "Lead", "tuning": [0] * 6, "notes": [
        {"t": 10, "s": 0, "f": 19, "sus": 1.75, "slide_out_marks": MARKS}],
        "chords": [{"t": 20, "id": 0, "notes": [
            {"s": 1, "f": 12, "sus": 1.75, "slide_out_marks": MARKS}]}],
        "templates": [], "anchors": [], "handshapes": []}
    (pak / "arrangements" / "lead.json").write_text(json.dumps(chart), encoding="utf-8")
    (pak / "manifest.yaml").write_text(yaml.safe_dump({
        "title": "Slide test", "artist": "Fixture", "duration": 30,
        "arrangements": [{"id": "lead", "name": "Lead", "file": "arrangements/lead.json"}],
        "stems": []}), encoding="utf-8")
    loaded = load_song(pak.name, pak.parent, tmp_path / "cache")
    arr = loaded.song.arrangements[0]
    assert note_to_wire(arr.notes[0])["slide_out_marks"] == MARKS
    assert chord_to_wire(arr.chords[0])["notes"][0]["slide_out_marks"] == MARKS
