"""Real pack loader/scanner contracts for named source arrangements and gestures."""
import json

import pytest
import yaml

from metadata_db import MetadataDB
from scan_worker import _extract_meta_sloppak
from sloppak import extract_meta, load_song
from song import (
    Arrangement, Note, arrangement_from_wire, arrangement_to_wire,
    compute_smart_names, note_from_wire, note_to_wire,
)


def _pack(tmp_path):
    root = tmp_path / "fixture.feedpak"
    root.mkdir()
    entries = []
    for i, (name, role, tuning) in enumerate([
        ("Rain", "bass", [-2] * 4),
        ("Fire", "lead", [-1] * 6),
        ("Aether", "rhythm", [-2, 0, 0, 0, 0, 0]),
    ]):
        entries.append({"id": str(i), "name": name, "type": role,
                        "tuning": tuning, "file": f"{i}.json"})
        wire = {"t": 1.0, "s": 0, "f": 7, "sus": 0.5,
                "ghost": True, "slide_out": "down", "bn": 2,
                "bnv": [{"t": 0, "v": 0}, {"t": 0.5, "v": 2}]}
        (root / f"{i}.json").write_text(json.dumps({
            "notes": [wire], "chords": [{"t": 2, "id": 0, "notes": [wire]}],
            "anchors": [], "templates": [], "handshapes": [],
        }), encoding="utf-8")
    (root / "manifest.yaml").write_text(yaml.safe_dump({
        "title": "Fixture", "artist": "Test", "duration": 5,
        "arrangements": entries, "stems": [],
    }), encoding="utf-8")
    return root


def test_pack_keeps_source_names_roles_tunings_and_pitched_gestures(tmp_path):
    root = _pack(tmp_path)
    loaded = load_song(root.name, root.parent, tmp_path / "cache")
    assert [a.name for a in loaded.song.arrangements] == ["Rain", "Fire", "Aether"]
    assert compute_smart_names(loaded.song.arrangements) == ["Bass", "Lead", "Rhythm"]
    for arrangement in loaded.song.arrangements:
        for note in [arrangement.notes[0], arrangement.chords[0].notes[0]]:
            assert note.ghost is True
            assert note.mute is False
            assert note.slide_out == "down"
            assert note.slide_to == note.slide_unpitch_to == -1
            assert note.bend == 2
            wire = note_to_wire(note)
            assert wire["ghost"] is True and wire["slide_out"] == "down"
            assert wire["bnv"][-1]["v"] == 2
    assert loaded.song.arrangements[0].tuning == [-2] * 4


def test_manifest_scanner_and_both_filter_modes_honor_explicit_types(tmp_path):
    root = _pack(tmp_path)
    raw = extract_meta(root)
    assert raw["bass_tuning_offsets"] == [-2] * 4
    assert raw["rhythm_tuning_offsets"] == [-2, 0, 0, 0, 0, 0]
    assert raw["tuning_offsets"] == [-1] * 6
    meta = _extract_meta_sloppak(root)
    assert [a["smart_name"] for a in meta["arrangements"]] == ["Bass", "Lead", "Rhythm"]
    db = MetadataDB(tmp_path / "profile")
    try:
        db.put(root.name, 1, 1, meta)
        for mode in ("legacy", "smart"):
            for role in ("Lead", "Rhythm", "Bass"):
                rows, total = db.query_page(arrangements_has=[role], naming_mode=mode)
                assert total == 1 and rows[0]["title"] == "Fixture"
                assert db.query_page(arrangements_lacks=[role], naming_mode=mode)[1] == 0
    finally:
        db.conn.close()


def test_metadata_display_sort_preserves_manifest_index(tmp_path):
    root = _pack(tmp_path)
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    manifest["arrangements"][1]["name"] = "Lead"
    (root / "manifest.yaml").write_text(yaml.safe_dump(manifest))
    arrs = extract_meta(root)["arrangements"]
    assert arrs[0]["name"] == "Lead" and arrs[0]["index"] == 1


@pytest.mark.parametrize("value", [None, "", "left", "UP", True, 4])
def test_bad_slide_direction_and_ghost_do_not_change_pitch_or_mute(value):
    note = note_from_wire({"f": 4, "slide_out": value, "ghost": value})
    assert note.slide_out is None
    assert note.ghost is (value is True)
    assert not note.mute
    assert note.fret == 4 and note.slide_unpitch_to == -1


def test_plain_notes_omit_extension_keys_and_arrangement_roundtrip_keeps_them():
    assert "ghost" not in note_to_wire(Note(0, 0, 3))
    assert "slide_out" not in note_to_wire(Note(0, 0, 3))
    arr = Arrangement(name="Fire", type="lead", notes=[Note(1, 0, 7, ghost=True, slide_out="up")])
    assert arrangement_from_wire(arrangement_to_wire(arr)).notes == arr.notes


def test_authoritative_roles_and_legacy_names_are_distinct():
    assert compute_smart_names([
        Arrangement(name="Lead", type="bass"),
        Arrangement(name="Bass", type="piano"),
        Arrangement(name="Player", type="guitar"),
        Arrangement(name="Rhythm"),
    ]) == ["Bass", None, None, "Rhythm"]
