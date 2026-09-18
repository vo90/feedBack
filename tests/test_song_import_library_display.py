"""Pack loader, scanner and library contracts for named source arrangements."""
import json

import yaml

from metadata_db import MetadataDB
from scan_worker import _extract_meta_sloppak
from sloppak import extract_meta, load_song
from song import Arrangement, compute_smart_names


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
        (root / f"{i}.json").write_text(json.dumps({
            "notes": [{"t": 1.0, "s": 0, "f": i + 7}],
            "chords": [], "anchors": [], "templates": [], "handshapes": [],
        }), encoding="utf-8")
    (root / "manifest.yaml").write_text(yaml.safe_dump({
        "title": "Fixture", "artist": "Test", "duration": 5,
        "arrangements": entries, "stems": [],
    }), encoding="utf-8")
    return root


def test_pack_keeps_source_names_roles_and_tunings(tmp_path):
    root = _pack(tmp_path)
    loaded = load_song(root.name, root.parent, tmp_path / "cache")
    arrs = loaded.song.arrangements
    assert [a.name for a in arrs] == ["Rain", "Fire", "Aether"]
    assert [a.type for a in arrs] == ["bass", "lead", "rhythm"]
    assert compute_smart_names(arrs) == ["Bass", "Lead", "Rhythm"]
    assert [a.tuning for a in arrs] == [[-2] * 4, [-1] * 6, [-2, 0, 0, 0, 0, 0]]


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


def test_metadata_display_sort_preserves_playable_manifest_index(tmp_path):
    root = _pack(tmp_path)
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    manifest["arrangements"][1]["name"] = "Lead"
    (root / "manifest.yaml").write_text(yaml.safe_dump(manifest))
    arrs = extract_meta(root)["arrangements"]
    assert [(a["name"], a["index"]) for a in arrs] == [("Lead", 1), ("Rain", 0), ("Aether", 2)]
    loaded = load_song(root.name, root.parent, tmp_path / "cache")
    for meta in arrs:
        actual = loaded.song.arrangements[meta["index"]]
        assert actual.name == meta["name"]
        assert actual.type == meta["type"]
        assert actual.notes[0].fret == meta["index"] + 7


def test_authoritative_roles_and_legacy_names_are_distinct():
    assert compute_smart_names([
        Arrangement(name="Lead", type="bass"),
        Arrangement(name="Bass", type="piano"),
        Arrangement(name="Player", type="guitar"),
        Arrangement(name="Rhythm"),
    ]) == ["Bass", None, None, "Rhythm"]


def test_explicit_role_tuning_does_not_borrow_a_misleading_part_name(tmp_path):
    root = _pack(tmp_path)
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    manifest["arrangements"] = [
        {"id": "0", "name": "Rhythm", "type": "bass", "tuning": [-2] * 4, "file": "0.json"},
        {"id": "1", "name": "Bass", "type": "lead", "tuning": [-1] * 6, "file": "1.json"},
    ]
    (root / "manifest.yaml").write_text(yaml.safe_dump(manifest))
    raw = extract_meta(root)
    assert raw["bass_tuning_offsets"] == [-2] * 4
    assert raw["rhythm_tuning_offsets"] is None
    assert raw["tuning_offsets"] == [-1] * 6
