"""Pack loader, scanner and library contracts for named source arrangements."""
import json
import zipfile

import pytest
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


@pytest.mark.parametrize("zipped", [False, True])
def test_indices_follow_loader_skips_in_mixed_drum_guitar_and_keys_pack(tmp_path, zipped, monkeypatch):
    root = _pack(tmp_path)
    manifest = yaml.safe_load((root / "manifest.yaml").read_text())
    rain, fire, aether = manifest["arrangements"]
    fire["name"] = "Lead"  # force metadata's display sort to differ from load order
    fire["file"] = "./fire.jsonc"
    (root / "fire.jsonc").write_text('// Valid JSONC\n{"notes":[{"t":1,"s":0,"f":8}]}')
    (root / "bad.json").write_text('{not valid JSON')
    (root / "drums.json").write_text(json.dumps({
        "version": 1, "kit": [{"id": "kick", "name": "Kick"}],
        "hits": [{"t": 1, "p": "kick", "v": 100}],
    }))
    (root / "keys.json").write_text(json.dumps({"version": 1, "staves": [], "measures": []}))
    manifest["arrangements"] = [
        None,
        {"id": "drums", "name": "Drums", "type": " DRUMS ", "drum_tab": "drums.json"},
        rain,
        {"id": "empty", "name": "Empty", "file": " ", "notation": " "},
        {"id": "wrong-pointer", "name": "Wrong pointer", "type": "bass", "drum_tab": "drums.json"},
        {"id": "missing", "name": "Missing chart", "file": "missing.json", "notation": "keys.json"},
        {"id": "bad", "name": "Broken chart", "file": "bad.json"},
        {"id": "unsafe", "name": "Unsafe chart", "file": "../outside.json"},
        {"id": "keys", "name": "Keys", "type": "piano", "notation": "keys.json"},
        fire,
        {"id": "drum-note", "name": "Drum note file", "type": "drum", "file": "1.json"},
        aether,
        # The loader retains this placeholder even though notation is absent.
        {"id": "missing-notation", "name": "Missing notation", "type": "keys", "notation": "absent.json"},
    ]
    (root / "manifest.yaml").write_text(yaml.safe_dump(manifest))
    path = root
    if zipped:
        path = tmp_path / "mixed.feedpak"
        with zipfile.ZipFile(path, "w") as archive:
            for file in root.iterdir():
                archive.write(file, file.name)
    import sloppak
    reads = []
    original_read = sloppak.read_member_bytes
    def recording_read(path, rel):
        reads.append(rel)
        return original_read(path, rel)
    with monkeypatch.context() as scan_patch:
        scan_patch.setattr(sloppak, "read_member_bytes", recording_read)
        scan_patch.setattr(sloppak, "resolve_source_dir", lambda *args: pytest.fail("scanner must not unpack"))
        meta = _extract_meta_sloppak(path)
    assert reads == ["0.json", "missing.json", "bad.json", "../outside.json", "./fire.jsonc", "2.json"]
    loaded = load_song(path.name, path.parent, tmp_path / "cache")
    assert [a.name for a in loaded.song.arrangements] == ["Rain", "Keys", "Lead", "Aether", "Missing notation"]
    assert [(a["name"], a["index"]) for a in meta["arrangements"]] == [
        ("Lead", 2), ("Rain", 0), ("Keys", 1), ("Aether", 3), ("Missing notation", 4),
    ]
    for entry in meta["arrangements"]:
        actual = loaded.song.arrangements[entry["index"]]
        assert actual.name == entry["name"]
        assert actual.type == entry["type"]
    assert meta["arrangements"][1]["smart_name"] == "Bass"
