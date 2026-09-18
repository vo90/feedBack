"""Ghost transport is independent of pitched/dead notes and tied sustain."""
import json

import pytest
import yaml

from sloppak import load_song
from song import Note, arrangement_from_wire, arrangement_to_wire, note_from_wire, note_to_wire


@pytest.mark.parametrize("value", [None, False, 0, 1, "true", "(12)", {}, []])
def test_ghost_requires_explicit_boolean_true(value):
    note = note_from_wire({"t": 1, "s": 0, "f": 12, "ghost": value})
    assert not note.ghost
    assert "ghost" not in note_to_wire(note)
    assert note.fret == 12 and not note.mute and not note.link_next


def test_ghost_is_not_a_mute_and_dead_ghost_keeps_both_flags():
    pitched = note_from_wire({"t": 1, "s": 2, "f": 12, "ghost": True})
    dead = note_from_wire({"t": 2, "s": 0, "f": 7, "ghost": True, "mt": True})
    assert pitched.ghost and not pitched.mute
    assert dead.ghost and dead.mute
    assert note_to_wire(pitched)["ghost"] is True
    assert note_to_wire(dead)["ghost"] is True
    assert note_to_wire(dead)["mt"] is True
    assert "ghost" not in note_to_wire(Note(0, 0, 12))


def test_note_and_chord_round_trip_preserve_flags_without_creating_attacks():
    data = {
        "notes": [
            {"t": 1, "s": 2, "f": 12, "ghost": True},
            {"t": 2, "s": 0, "f": 17, "sus": 1.5, "ln": True},
            {"t": 3.5, "s": 0, "f": 17, "sus": 0.5},
        ],
        "chords": [{"t": 4, "id": 0, "notes": [
            {"s": 0, "f": 7, "ghost": True, "mt": True},
            {"s": 1, "f": 9},
        ]}],
    }
    result = arrangement_to_wire(arrangement_from_wire(data))
    assert len(result["notes"]) == 3
    assert result["notes"][0]["ghost"] is True
    assert result["notes"][1]["ln"] is True
    assert result["notes"][1]["sus"] == 1.5
    assert "ghost" not in result["notes"][1] and "ghost" not in result["notes"][2]
    members = result["chords"][0]["notes"]
    assert len(members) == 2 and members[0]["ghost"] and members[0]["mt"]
    assert "ghost" not in members[1]


def test_actual_feedpak_loader_retains_rats_ghost_dead_and_tie_distinctions(tmp_path):
    # Minimal semantic fixtures for Rats: Rain bar 2 pitched ghost, Fire bar 33
    # dead+ghost, Fire bar 50 a tied sustain with no ghost and no second attack.
    root = tmp_path / "ghost-fixture.feedpak"
    root.mkdir()
    notes = [
        {"t": 1, "s": 2, "f": 12, "ghost": True},
        {"t": 2, "s": 0, "f": 7, "ghost": True, "mt": True},
        {"t": 3, "s": 1, "f": 17, "sus": 1.5},
    ]
    (root / "part.json").write_text(json.dumps({"notes": notes, "chords": [
        {"t": 5, "id": 0, "notes": [notes[0], {"s": 1, "f": 5}]}
    ], "anchors": [], "templates": [], "handshapes": []}), encoding="utf-8")
    (root / "manifest.yaml").write_text(yaml.safe_dump({
        "title": "Ghost semantic fixture", "artist": "Test", "duration": 7,
        "arrangements": [{"id": "lead", "name": "Lead", "type": "lead",
                          "tuning": [0] * 6, "file": "part.json"}], "stems": [],
    }), encoding="utf-8")
    loaded = load_song(root.name, root.parent, tmp_path / "cache")
    arr = loaded.song.arrangements[0]
    assert len(arr.notes) == 3 and len(arr.chords[0].notes) == 2
    assert arr.notes[0].ghost and not arr.notes[0].mute
    assert arr.notes[1].ghost and arr.notes[1].mute
    assert not arr.notes[2].ghost and arr.notes[2].sustain == 1.5
    assert arr.chords[0].notes[0].ghost and not arr.chords[0].notes[1].ghost
