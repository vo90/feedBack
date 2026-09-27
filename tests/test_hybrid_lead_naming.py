from song import Arrangement, compute_smart_names
import json
import yaml
import sloppak
import pytest


@pytest.mark.parametrize('policy', ['hybrid-lead-v1','hybrid-lead-v2','hybrid-lead-v3'])
def test_hybrid_name_does_not_renumber_original_smart_names(policy):
    originals = [Arrangement(name="Guitar A", type="lead"), Arrangement(name="Guitar B", type="lead"),
                 Arrangement(name="Bass", type="bass")]
    before = compute_smart_names(originals)
    hybrid = Arrangement(name="Hybrid Lead", type="lead", derived_kind=policy)
    assert compute_smart_names(originals + [hybrid]) == before + ["Hybrid Lead"]


@pytest.mark.parametrize('policy', ['hybrid-lead-v1','hybrid-lead-v2','hybrid-lead-v3'])
def test_manifest_derived_identity_reaches_smart_naming(tmp_path,policy):
    pak = tmp_path / "hybrid.feedpak"
    pak.mkdir()
    (pak / "chart.json").write_text(json.dumps({"notes": [], "chords": [], "templates": [], "anchors": [], "handshapes": []}))
    (pak / "manifest.yaml").write_text(yaml.safe_dump({"title": "Test", "artist": "Test", "duration": 10,
        "arrangements": [{"id": "hybrid", "file": "chart.json", "name": "Hybrid Lead", "type": "lead", "derived": {"kind": policy, "receipt": "import/hybrid-lead.json"}}]}))
    loaded = sloppak.load_song(pak.name, pak.parent, tmp_path / "cache")
    assert compute_smart_names(loaded.song.arrangements) == ["Hybrid Lead"]
    assert loaded.song.arrangements[0].type == "lead"
    assert loaded.song.arrangements[0].derived_kind == policy
    from scan_worker import _extract_meta_sloppak
    assert _extract_meta_sloppak(pak)["arrangements"][0]["smart_name"] == "Hybrid Lead"
