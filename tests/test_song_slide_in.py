"""Destination-only slide-ins survive FeedPak loading without extra attacks."""
import json
import math

import pytest
import yaml

from song import Note, note_from_wire, note_to_wire, chord_from_wire, chord_to_wire
from sloppak import load_song


MARKS = [{"direction": "up", "time": 0}, {"direction": "down", "time": 1.25}]


def test_note_round_trip_keeps_only_known_destination_endpoints():
    original = Note(time=10, string=2, fret=19, sustain=1.75,
                    slide_in_marks=MARKS, link_next=True)
    wire = note_to_wire(original)
    assert wire["t"] == 10
    assert wire["sus"] == 1.75
    assert wire["sl"] == wire["slu"] == -1
    assert wire["ln"] is True
    assert wire["slide_in_marks"] == MARKS
    assert note_from_wire(wire) == original


def test_zero_sustain_and_absent_or_empty_arrays():
    for onset in (0, 10):
        n = note_from_wire({"t": onset, "f": 7, "slide_in_marks": MARKS[:1]})
        assert n.time == onset and n.sustain == 0
        assert note_to_wire(n)["slide_in_marks"] == MARKS[:1]
    assert "slide_in_marks" not in note_to_wire(Note(0, 0, 0))
    assert note_to_wire(note_from_wire({"slide_in_marks": []}))["slide_in_marks"] == []
    # There is no scalar fallback: an old/unknown scalar cannot invent timing.
    assert "slide_in_marks" not in note_to_wire(note_from_wire({"slide_in": "up"}))


@pytest.mark.parametrize("bad", [None, {}, "up", 1, [None], [[]],
    [{"direction": "up", "time": True}], [{"direction": "up", "time": "0"}],
    [{"direction": "up"}], [{"time": 0}], [{"direction": "UP", "time": 0}],
    [{"direction": "sideways", "time": 0}], [{"direction": "up", "time": -0.001}],
    [{"direction": "up", "time": math.nan}], [{"direction": "up", "time": math.inf}],
    [{"direction": "up", "time": 10 ** 400}],
    [{"direction": "up", "time": 2.000502}],
])
def test_bad_present_arrays_stay_empty_without_scalar_fallback(bad):
    n = note_from_wire({"f": 12, "sus": 2, "slide_in": "up", "slide_in_marks": bad})
    assert note_to_wire(n)["slide_in_marks"] == []


def test_strict_source_order_and_precision_survive_wire_rounding():
    marks = [
        {"direction": "up", "time": 0},
        {"direction": "down", "time": 0},  # duplicate
        {"direction": "down", "time": 1},
        {"direction": "up", "time": 0.5},  # backwards
        {"direction": "down", "time": "1.5"},
        {"direction": "up", "time": 1.7504},
        {"direction": "down", "time": 1.7503},  # backwards before clipping
        {"direction": "down", "time": 1.750501},
        {"direction": "up", "time": 1.750502},  # too far past sustain
    ]
    expected = [marks[i] for i in (0, 2, 5, 7)]
    n = note_from_wire({"sus": 1.75, "slide_in_marks": marks})
    assert n.slide_in_marks == expected
    assert note_to_wire(n)["slide_in_marks"] == expected


@pytest.mark.parametrize("sustain", [-1, math.nan, math.inf])
def test_invalid_sustain_does_not_create_display_marks(sustain):
    n = note_from_wire({"sus": sustain, "slide_in_marks": MARKS})
    assert n.slide_in_marks == []


def test_direct_model_emit_validates_and_does_not_add_start_or_duration():
    mark = {"direction": "up", "time": 0, "start": -10, "duration": 10, "fret": 1}
    n = Note(time=4, string=0, fret=7, slide_in_marks=[mark, {"direction": "down", "time": True}])
    assert note_to_wire(n)["slide_in_marks"] == MARKS[:1]
    assert n.slide_in_marks[0] == mark  # emit does not mutate source


def test_incoming_and_both_outgoing_forms_remain_independent():
    wire = {"t": 10, "s": 0, "f": 7, "sus": 2, "sl": 12, "slu": 15,
            "slide_in_marks": MARKS, "slide_out": "up",
            "slide_out_marks": [{"direction": "up", "start": 1.5, "end": 2}]}
    out = note_to_wire(note_from_wire(wire))
    for field in wire:
        assert out[field] == wire[field]


def test_chord_member_times_remain_relative_and_do_not_leak_to_siblings():
    chord = chord_from_wire({"t": 20, "id": 0, "notes": [
        {"s": 1, "f": 19, "sus": 1.75, "slide_in_marks": MARKS},
        {"s": 2, "f": 7, "sus": 1.75},
    ]})
    out = chord_to_wire(chord)
    assert chord.notes[0].time == 20
    assert out["notes"][0]["slide_in_marks"] == MARKS
    assert "t" not in out["notes"][0]
    assert "slide_in_marks" not in out["notes"][1]
    assert len(chord.notes) == 2


def test_real_feedpak_loader_keeps_tied_marks_on_one_note_and_chord_member(tmp_path):
    pak = tmp_path / "slide-in.feedpak"
    pak.mkdir()
    (pak / "arrangements").mkdir()
    chart = {"name": "Lead", "tuning": [0] * 6, "notes": [
        {"t": 10, "s": 0, "f": 19, "sus": 1.75, "ln": True, "slide_in_marks": MARKS}],
        "chords": [{"t": 20, "id": 0, "notes": [
            {"s": 1, "f": 12, "sus": 1.75, "slide_in_marks": MARKS}]}],
        "templates": [], "anchors": [], "handshapes": []}
    (pak / "arrangements" / "lead.json").write_text(json.dumps(chart), encoding="utf-8")
    (pak / "manifest.yaml").write_text(yaml.safe_dump({
        "title": "Slide in test", "artist": "Fixture", "duration": 30,
        "arrangements": [{"id": "lead", "name": "Lead", "file": "arrangements/lead.json"}],
        "stems": []}), encoding="utf-8")
    loaded = load_song(pak.name, pak.parent, tmp_path / "cache")
    arr = loaded.song.arrangements[0]
    assert len(arr.notes) == len(arr.chords) == len(arr.chords[0].notes) == 1
    assert (arr.notes[0].time, arr.notes[0].sustain, arr.notes[0].link_next) == (10, 1.75, True)
    assert note_to_wire(arr.notes[0])["slide_in_marks"] == MARKS
    assert chord_to_wire(arr.chords[0])["notes"][0]["slide_in_marks"] == MARKS
