"""Hybrid identity survives naming, indexing, filtering and default selection."""
import copy
import json

import pytest
import yaml

from metadata_db import MetadataDB, _ensure_smart_names
from routers.ws_highway import _pick_smart_arrangement
from scan_worker import _extract_meta_sloppak
from sloppak import load_song
from song import Arrangement, compute_smart_names


def test_hybrid_label_preserves_roles_and_existing_alternate_numbers():
    arrs = [Arrangement(name=name, type=role) for name, role in [
        ("Player", "lead"), ("Solo", "lead"), ("Hybrid Lead", "lead"),
        ("Other guitar", "lead"), ("Low end", "bass"),
        ("Hybrid Lead", "rhythm"), ("Hybrid Lead", "piano"),
    ]]
    before = copy.deepcopy(arrs)
    assert compute_smart_names(arrs) == [
        "Lead", "Alt. Lead 1", "Hybrid Lead", "Alt. Lead 3", "Bass", "Rhythm", None,
    ]
    assert arrs == before
    assert compute_smart_names([Arrangement(name="Hybrid Lead", path_bass=True)]) == ["Bass"]
    assert compute_smart_names([Arrangement(name="Hybrid Lead")]) == ["Hybrid Lead"]
    assert compute_smart_names([Arrangement(name="Hybrid Lead solo", type="lead")]) == ["Lead"]


@pytest.mark.parametrize("cached_label", ["Alt. Lead 5", None, "Hybrid Lead"])
def test_cached_label_correction_keeps_indices_roles_and_other_names(cached_label):
    entries = [
        {"index": 5, "name": "Hybrid Lead", "type": "lead", "smart_name": cached_label},
        {"index": 0, "name": "Player", "type": "lead", "smart_name": "Lead"},
        {"index": 3, "name": "Rhythm", "type": "rhythm", "smart_name": "Rhythm"},
    ]
    result = _ensure_smart_names(entries)
    assert [(a["index"], a["smart_name"]) for a in result] == [
        (0, "Lead"), (5, "Hybrid Lead"), (3, "Rhythm"),
    ]
    assert next(a for a in result if a["index"] == 5)["type"] == "lead"
    assert _ensure_smart_names(result) == result


def test_cached_authoritative_non_lead_is_not_relabelled():
    for role, label in [("bass", "Bass"), ("piano", None), ("", "Rhythm")]:
        entries = [{"name": "Hybrid Lead", "type": role, "smart_name": label}]
        assert _ensure_smart_names(entries)[0]["smart_name"] == label


@pytest.mark.parametrize("cache", ["fresh", "old", "missing"])
@pytest.mark.parametrize("mode", ["smart", "legacy"])
def test_hybrid_only_song_remains_a_lead_for_has_and_lacks_filters(tmp_path, cache, mode):
    arr = {"index": 0, "name": "Hybrid Lead", "type": "lead"}
    if cache != "missing":
        arr["smart_name"] = "Hybrid Lead" if cache == "fresh" else "Alt. Lead 5"
    db = MetadataDB(tmp_path / "profile")
    try:
        db.put("hybrid.feedpak", 1, 1, {"title": "Hybrid", "artist": "Test", "arrangements": [arr]})
        rows, total = db.query_page(arrangements_has=["Lead"], naming_mode=mode)
        assert total == 1
        assert rows[0]["arrangements"][0]["smart_name"] == "Hybrid Lead"
        assert db.query_page(arrangements_lacks=["Lead"], naming_mode=mode)[1] == 0
        assert db.query_page(arrangements_has=["Bass"], naming_mode=mode)[1] == 0
        assert db.query_page(arrangements_lacks=["Bass"], naming_mode=mode)[1] == 1
    finally:
        db.conn.close()


def test_scanner_and_playback_agree_without_rewriting_package(tmp_path):
    pak = tmp_path / "named.feedpak"
    pak.mkdir()
    names = ["Bass", "Lead", "Hybrid Lead"]
    entries = []
    for i, name in enumerate(names):
        entries.append({"id": str(i), "name": name, "type": "bass" if i == 0 else "lead",
                        "file": f"{i}.json", "tuning": [0] * (4 if i == 0 else 6)})
        (pak / f"{i}.json").write_text(json.dumps({"notes": [{"t": 1, "s": 0, "f": i + 3}]}))
    (pak / "manifest.yaml").write_text(yaml.safe_dump({"title": "Named", "artist": "Test",
                                                       "arrangements": entries, "duration": 5}))
    before = {p.name: p.read_bytes() for p in pak.iterdir()}
    scanned = _extract_meta_sloppak(pak)["arrangements"]
    loaded = load_song(pak.name, tmp_path, tmp_path / "cache").song.arrangements
    labels = compute_smart_names(loaded)
    for entry in scanned:
        assert entry["smart_name"] == labels[entry["index"]]
        assert entry["name"] == loaded[entry["index"]].name
    assert labels == ["Bass", "Lead", "Hybrid Lead"]
    assert {p.name: p.read_bytes() for p in pak.iterdir()} == before


@pytest.mark.parametrize("names,preferred,expected", [
    (["Bass", "Lead", "Hybrid Lead"], "Hybrid Lead", 2),
    (["Bass", "Lead", "Hybrid Lead"], "Lead", 1),
    (["Bass", "Lead", "Rhythm"], "Hybrid Lead", 1),
    (["Bass", "Alt. Lead", "Rhythm"], "Hybrid Lead", 1),
    (["Bass", "Bonus Lead", "Rhythm"], "Hybrid Lead", 1),
    (["Bass", "Hybrid Lead", "Alt. Lead"], "Lead", 2),
    (["Hybrid Lead"], "Lead", 0),
    (["Bass", "Rhythm"], "Hybrid Lead", 1),
    (["Bass", "Hybrid Lead"], "Bass", 0),
    ([], "Hybrid Lead", -1),
])
def test_default_selection_preserves_normal_lead_and_uses_hybrid_fallback(names, preferred, expected):
    assert _pick_smart_arrangement([Arrangement(name=n) for n in names], names, preferred) == expected
