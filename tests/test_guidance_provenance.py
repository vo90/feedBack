from copy import deepcopy

import pytest

from lib.guidance_provenance import edited, origins, record, resolve, stamp
from lib.song import arrangement_from_wire, arrangement_to_wire, phrase_to_wire, anchor_to_wire


def chart():
    return {"name": "Mixed", "tuning": [0] * 6, "capo": 0, "notes": [],
            "chords": [{"t": 1.123456, "id": 0, "notes": [{"s": 0, "f": 3}, {"s": 1, "f": 5}]}],
            "templates": [{"name": "G5", "frets": [3, 5, -1, -1, -1, -1]}],
            "anchors": [{"time": 0, "fret": 2, "width": 4}, {"time": 3, "fret": 5, "width": 4}],
            "handshapes": []}


def test_independent_fields_and_stale_origin():
    data = chart()
    stamp(data, "anchors", "generated", producer="test", policy="v1")
    stamp(data, "handshapes", "source", producer="test", intentional_empty=True)
    data["handshapes"].append({"chord_id": 0})
    assert resolve(data, "anchors")["integrity"] == "valid"
    data["notes"].append({"t": 2, "s": 0, "f": 20})
    assert resolve(data, "anchors") == {"origin": "generated", "integrity": "valid", "applicability": "stale"}


def test_beat_edits_stale_only_guidance_that_depends_on_beats():
    data = chart()
    data["beats"] = [{"time": 0}, {"time": .5}]
    stamp(data, "anchors", "generated", producer="test", policy="v1")
    stamp(data, "handshapes", "generated", producer="test", policy="v1")
    wire = arrangement_to_wire(arrangement_from_wire(data))
    assert resolve(wire, "anchors")["applicability"] == "current"
    wire["beats"][1]["time"] = .8
    assert resolve(wire, "anchors")["applicability"] == "stale"
    assert resolve(wire, "handshapes")["applicability"] == "current"


def test_single_edit_preserves_other_generated_rows_and_input_age():
    before = chart()
    stamp(before, "anchors", "generated", producer="test", policy="v1")
    after = deepcopy(before)
    after["anchors"][1]["fret"] = 7
    after["notes"].append({"t": 2, "s": 0, "f": 20})
    edited(before, after)
    assert origins(after, "anchors") == ["generated", "user"]
    assert resolve(after, "anchors")["applicability"] == "stale"
    assert record(after, "anchors")["policy"] == "v1"


def test_roundtrip_keeps_raw_music_receipts_and_effective_level_origin():
    data = chart()
    stamp(data, "anchors", "source", producer="test")
    level = {k: deepcopy(v) for k, v in data.items() if k not in ("ext", "name", "tuning", "capo", "templates")}
    context = {**data, **level, "ext": {}}
    context["anchors"] = [{"time": 0, "fret": 3, "width": 4}]
    stamp(context, "anchors", "generated", producer="test", policy="v1")
    level.update(anchors=context["anchors"], ext=context["ext"], difficulty=0)
    data["phrases"] = [{"start_time": 0, "end_time": 5, "max_difficulty": 0, "levels": [level]}]
    before = deepcopy(data)
    arr = arrangement_from_wire(data)
    wire = arrangement_to_wire(arr)
    for key in ("notes", "chords", "templates", "anchors", "ext"):
        assert wire[key] == data[key]
    assert wire["phrases"][0]["levels"][0]["ext"] == level["ext"]
    assert anchor_to_wire(arr.anchors[0], playback=True)["guidanceOrigin"] == "source"
    assert phrase_to_wire(arr.phrases[0], playback=True)["levels"][0]["anchors"][0]["guidanceOrigin"] == "generated"
    assert "guidanceOrigin" not in wire["anchors"][0]
    assert data == before
    assert origins(arrangement_to_wire(arrangement_from_wire(wire)), "anchors") == ["source", "source"]


@pytest.mark.parametrize("fault", ["future", "edit", "missing", "malformed"])
def test_unsupported_or_modified_evidence_never_becomes_authored(fault):
    data = chart()
    stamp(data, "anchors", "source", producer="test")
    if fault == "future": data["ext"]["guidanceProvenance"]["version"] = 99
    if fault == "edit": data["anchors"][0]["fret"] = 12
    if fault == "missing": data.pop("ext")
    if fault == "malformed": data["ext"]["guidanceProvenance"]["fields"] = []
    assert origins(data, "anchors") == ["unknown", "unknown"]
    assert arrangement_from_wire(data).anchors[0].guidance_origin == "unknown"


def test_duplicate_and_reordered_rows_cannot_swap_ownership():
    data = chart()
    stamp(data, "anchors", "mixed", producer="test", row_origins=["source", "generated"])
    data["anchors"].reverse()
    assert origins(data, "anchors") == ["unknown", "unknown"]


def test_legacy_receipt_owns_only_its_fields_and_source_tags_are_not_proof():
    import hashlib
    import json
    data = chart()
    def raw_hash(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
            allow_nan=False, separators=(",", ":")).encode()).hexdigest()
    data["ext"] = {"source": {"format": "psarc-manifest2014"}, "chartGuidance": {
        "policy": "feedforge-chart-guidance-v2", "sourceAuthored": False, "fields": ["handshapes"],
        "positionPolicy": "positionless-preparation-v1", "guidanceSha256": raw_hash({"handshapes": []}),
        "musicSha256": raw_hash({k: data[k] for k in ("tuning", "capo", "notes", "chords", "templates")})}}
    assert origins(data, "anchors") == ["unknown", "unknown"]
    assert resolve(data, "handshapes")["origin"] == "generated"
    assert resolve(data, "handshapes")["integrity"] == "valid"
