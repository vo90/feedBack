"""Pitch/time correctness and strictly metadata-only chart analysis input."""

import json
from pathlib import Path
import zipfile

import pytest
import yaml

from harmony import source_revision
from harmony_source import SourceCancelled, arrangement_pitch_metadata, load_harmony_source
import sloppak


def chart(**changes):
    return {"name": "Lead", "tuning": [0] * 6, "notes": [], "chords": [],
            "templates": [], "handshapes": [], "beats": [{"time": t} for t in range(12)],
            "sections": [{"time": 0, "name": "Intro"}], **changes}


def pack(tmp_path, charts, *, manifest_changes=None, zipped=False):
    destination = tmp_path / ("test.feedpak" if not zipped else "source")
    destination.mkdir()
    arrangements = []
    for index, (entry, data) in enumerate(charts):
        filename = f"chart-{index}.json"
        (destination / filename).write_text(json.dumps(data), encoding="utf-8")
        arrangements.append({"id": f"arr-{index}", "file": filename, **entry})
    manifest = {"title": "Synthetic", "duration": 12, "arrangements": arrangements,
                "stems": [{"id": "full", "file": "audio.ogg"}], **(manifest_changes or {})}
    (destination / "manifest.yaml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
    (destination / "audio.ogg").write_bytes(b"do not open audio")
    if not zipped:
        return destination
    archive = tmp_path / "test.feedpak"
    with zipfile.ZipFile(archive, "w") as output:
        for member in destination.iterdir():
            output.write(member, member.name)
    return archive


def rs_chart(**changes):
    return chart(ext={"source": {"format": "psarc-manifest2014"}}, **changes)


@pytest.mark.parametrize("zipped", [False, True])
def test_only_metadata_is_read_and_revision_matches_playback_contract(tmp_path, monkeypatch, zipped):
    path = pack(tmp_path, [({}, chart(notes=[{"t": 1, "s": 0, "f": 5}]))], zipped=zipped)
    reader = sloppak.read_member_bytes
    reads = []

    def guarded_read(source, relative):
        assert relative.endswith(".json")
        reads.append(relative)
        return reader(source, relative)

    monkeypatch.setattr(sloppak, "read_member_bytes", guarded_read)
    monkeypatch.setattr(sloppak, "load_song", lambda *args: pytest.fail("Must not extract audio"))
    real_open = zipfile.ZipFile.open

    def archive_open(self, member, *args, **kwargs):
        name = member.filename if isinstance(member, zipfile.ZipInfo) else member
        assert not name.endswith(".ogg")
        return real_open(self, member, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "open", archive_open)
    original_read_bytes = Path.read_bytes

    def directory_read(self):
        assert self.suffix != ".ogg"
        return original_read_bytes(self)

    monkeypatch.setattr(Path, "read_bytes", directory_read)
    result = load_harmony_source(path)
    assert reads == ["chart-0.json"]
    assert result["revision"] == source_revision(path, ["manifest.yaml", "manifest.yml", "chart-0.json"], ["audio.ogg"])
    assert result["revision_content_files"] == ["manifest.yaml", "manifest.yml", "chart-0.json"]
    assert result["revision_audio_files"] == ["audio.ogg"]
    assert result["arrangements"][0]["notes"][0]["midi"] == 45
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("capo", [0, 1, 2, 3])
def test_verified_rs_capo_adds_only_to_open_fret(tmp_path, capo):
    path = pack(tmp_path, [({"capo": capo}, rs_chart(notes=[
        {"t": 1, "s": 0, "f": 0}, {"t": 2, "s": 0, "f": 5},
    ]))])
    result = load_harmony_source(path)["arrangements"][0]
    assert result["fret_semantics"] == "physical"
    assert result["open_midi"][0] == 40
    assert [note["midi"] for note in result["notes"]] == [40 + capo, 45]


def test_queen_capo_one_reference_voicing_and_bass_agree(tmp_path):
    # Independently reviewed compact reference: Somebody to Love rhythm Ab,
    # physical frets [4,3,0,0,0,4], capo1. Bass string2/fret6 sounds Ab too.
    frets = [4, 3, 0, 0, 0, 4]
    path = pack(tmp_path, [
        ({"capo": 1, "name": "Rhythm"}, rs_chart(
            templates=[{"name": "Ab", "frets": frets}],
            chords=[{"t": 1, "id": 0, "notes": [{"s": s, "f": f} for s, f in enumerate(frets)]}])),
        ({"type": "bass"}, rs_chart(notes=[{"t": 1, "s": 2, "f": 6}])),
    ])
    rhythm, bass = load_harmony_source(path)["arrangements"]
    assert rhythm["chords"][0]["pcs"] == [0, 3, 8]
    assert bass["string_count"] == 4
    assert bass["notes"][0]["midi"] == 44


def test_unknown_capo_source_keeps_legacy_semantics_and_diagnoses(tmp_path):
    path = pack(tmp_path, [({"capo": 2}, chart(notes=[{"t": 1, "s": 0, "f": 5}]))])
    result = load_harmony_source(path)
    assert result["arrangements"][0]["notes"][0]["midi"] == 47
    assert result["arrangements"][0]["notes"][0]["uncertain"]
    assert any(item["code"] == "legacy_capo_semantics" for item in result["diagnostics"])


def test_manifest_overrides_and_global_cents_are_separate(tmp_path):
    path = pack(tmp_path, [({"name": "Rhythm", "type": "guitar", "tuning": [-2, 0, 0, 0, 0, 0],
                           "capo": 0, "centOffset": 59},
                          rs_chart(name="Bass", capo=3, centOffset=-1200,
                                   notes=[{"t": 1, "s": 0, "f": 0}]))])
    arrangement = load_harmony_source(path)["arrangements"][0]
    assert arrangement["role"] == "rhythm"
    assert arrangement["notes"][0]["midi"] == 38
    assert arrangement["notes"][0]["pc"] == 2
    assert arrangement["cent_offset"] == 59


def test_full_phrase_difficulty_reconstructed_without_duplicate_levels(tmp_path):
    low = {"t": 1, "s": 0, "f": 0}
    high = {"t": 2, "s": 0, "f": 5}
    phrases = [{"start_time": 0, "end_time": 5, "max_difficulty": 2, "levels": [
        {"difficulty": 0, "notes": [low]}, {"difficulty": 2, "notes": [low, high]},
    ]}]
    path = pack(tmp_path, [({}, chart(notes=[low], phrases=phrases))])
    result = load_harmony_source(path)
    assert result["arrangements"][0]["representation"] == "phrase_maximum"
    assert [note["t"] for note in result["arrangements"][0]["notes"]] == [1, 2]


def test_missing_declared_level_does_not_invent_full_difficulty(tmp_path):
    path = pack(tmp_path, [({}, chart(notes=[{"t": 1, "s": 0, "f": 0}], phrases=[{
        "max_difficulty": 4, "levels": [{"difficulty": 0, "notes": []}],
    }]))])
    result = load_harmony_source(path)
    assert result["arrangements"][0]["representation"] == "flat_unverified"
    assert result["arrangements"][0]["notes"][0]["uncertain"]


def test_mutes_techniques_and_sustain_boundaries(tmp_path):
    path = pack(tmp_path, [({}, chart(notes=[
        {"t": 1, "s": 0, "f": 0, "mt": True},
        {"t": 2, "s": 0, "f": 0, "fhm": True},
        {"t": 3, "s": 0, "f": 0, "pm": True, "ig": True},
        {"t": 4, "s": 0, "f": 5, "bn": 1},
        {"t": 5, "s": 0, "f": 7, "sl": 9},
        {"t": 6, "s": 0, "f": 12, "hm": True},
        {"t": 7, "s": 0, "f": 3, "sus": 99},
        {"t": 13, "s": 0, "f": 3},
    ], templates=[{"name": "C", "frets": [-1, 3, 2, 0, 1, 0]}], chords=[
        {"t": 1, "id": 0, "notes": [{"s": 1, "f": 0, "mt": True}]},
        {"t": 2, "id": 0, "mt": True},
    ]))])
    arrangement = load_harmony_source(path)["arrangements"][0]
    assert arrangement["chords"] == []
    assert [note["t"] for note in arrangement["notes"]] == [3, 4, 5, 6, 7]
    assert not arrangement["notes"][0]["uncertain"]
    assert all(note["uncertain"] for note in arrangement["notes"][1:4])
    assert arrangement["notes"][-1]["end"] == 12
    assert arrangement["notes"][0]["end"] == 3


def test_handshape_is_timed_and_unused_templates_do_not_count(tmp_path):
    path = pack(tmp_path, [({}, chart(templates=[
        {"name": " G ", "frets": [3, 2, 0, 0, 0, 3]},
        {"name": "C", "frets": [-1, 3, 2, 0, 1, 0]},
    ], handshapes=[{"chord_id": 0, "start_time": 2, "end_time": 4}]))])
    arrangement = load_harmony_source(path)["arrangements"][0]
    assert arrangement["notes"] == arrangement["chords"] == []
    assert len(arrangement["handshapes"]) == 1
    shape = arrangement["handshapes"][0]
    assert (shape["t"], shape["end"], shape["label"]) == (2, 4, "G")
    assert shape["original_label"] == " G "
    assert shape["pcs"] == [2, 7, 11]


def test_malformed_templates_keep_positional_ids(tmp_path):
    path = pack(tmp_path, [({}, chart(templates=[None, {"name": "C", "frets": [-1, 3, 2, 0, 1, 0]}],
                                    handshapes=[{"chord_id": 1, "start_time": 2, "end_time": 4}]))])
    shape = load_harmony_source(path)["arrangements"][0]["handshapes"][0]
    assert shape["label"] == "C"
    assert shape["pcs"] == [0, 4, 7]


def test_linked_chord_hold_extends_its_bounded_evidence(tmp_path):
    path = pack(tmp_path, [({}, chart(chords=[
        {"t": 1, "notes": [{"s": 0, "f": 5, "sus": 1, "ln": True}]},
        {"t": 2, "notes": [{"s": 0, "f": 5, "sus": 1, "ln": True}]},
        {"t": 3, "notes": [{"s": 0, "f": 5, "sus": 1}]},
    ]))])
    chords = load_harmony_source(path)["arrangements"][0]["chords"]
    assert [chord["end"] for chord in chords] == [4, 4, 4]


def test_explicit_link_only_bridges_nearby_same_pitch(tmp_path):
    path = pack(tmp_path, [({}, chart(notes=[
        {"t": 1, "s": 0, "f": 5, "sus": 1, "ln": True},
        {"t": 2, "s": 0, "f": 5, "sus": 1, "ln": True},
        {"t": 8, "s": 0, "f": 5, "sus": 1},
    ]))])
    notes = load_harmony_source(path)["arrangements"][0]["notes"]
    assert notes[0]["end"] == 3
    assert notes[1]["end"] == 3
    assert notes[1]["linked_from"] == notes[0]["evidence_id"]


def test_correlated_alternatives_and_duplicate_evidence_ids(tmp_path):
    note = {"t": 1, "s": 0, "f": 5}
    path = pack(tmp_path, [({"name": "Lead"}, chart(notes=[note])),
                           ({"name": "Alt. Lead"}, chart(notes=[note])),
                           ({"name": "Rhythm"}, chart(notes=[note]))])
    first, alternate, rhythm = load_harmony_source(path)["arrangements"]
    assert first["correlation_group"] == alternate["correlation_group"]
    assert first["notes"][0]["evidence_id"] != alternate["notes"][0]["evidence_id"]
    assert first["notes"][0]["correlation_id"] == rhythm["notes"][0]["correlation_id"]


def test_timeline_authority_and_beat_disagreement_keep_original_seconds(tmp_path):
    path = pack(tmp_path, [({}, chart(notes=[{"t": 1.234, "s": 0, "f": 5}])),
                           ({}, chart(beats=[{"time": 0.25}, {"time": 0.75}]))],
                manifest_changes={"song_timeline": "timeline.json"})
    (path / "timeline.json").write_text(json.dumps({"beats": [{"time": 0.1}, {"time": 0.6}],
                                                   "sections": [{"time": 0.1, "name": "Verse"}]}))
    result = load_harmony_source(path)
    assert result["beats"] == [0.1, 0.6]
    assert result["sections"] == [{"t": 0.1, "end": 12, "name": "Verse"}]
    assert result["arrangements"][0]["notes"][0]["t"] == 1.234
    assert any(item["code"] == "beat_map_disagreement" for item in result["diagnostics"])


def test_cancel_before_read_and_between_arrangements(tmp_path):
    with pytest.raises(SourceCancelled):
        load_harmony_source(tmp_path / "missing", cancelled=lambda: True)
    path = pack(tmp_path, [({}, chart()), ({}, chart())])
    checks = 0

    def cancelled():
        nonlocal checks
        checks += 1
        return checks >= 4

    with pytest.raises(SourceCancelled):
        load_harmony_source(path, cancelled=cancelled)


def test_fingerprint_changes_on_chart_and_audio_identity(tmp_path):
    path = pack(tmp_path, [({}, chart())])
    initial = load_harmony_source(path)
    (path / "chart-0.json").write_text(json.dumps(chart(notes=[{"t": 1, "s": 0, "f": 0}])))
    chart_changed = load_harmony_source(path)
    assert initial["fingerprint"] != chart_changed["fingerprint"]
    (path / "audio.ogg").write_bytes(b"longer replacement audio identity")
    audio_changed = load_harmony_source(path)
    assert chart_changed["fingerprint"] != audio_changed["fingerprint"]


def test_jsonc_chart_uses_same_parser_as_playback(tmp_path):
    path = pack(tmp_path, [({}, chart())])
    (path / "commented.jsonc").write_text('{/* explanation */ "notes":[{"t":1,"s":0,"f":5}]}')
    manifest = yaml.safe_load((path / "manifest.yaml").read_text())
    manifest["arrangements"][0]["file"] = "commented.jsonc"
    (path / "manifest.yaml").write_text(yaml.safe_dump(manifest))
    assert load_harmony_source(path)["arrangements"][0]["notes"][0]["midi"] == 45


def test_excluded_vocals_and_malformed_pitch_do_not_become_guitar_evidence(tmp_path):
    path = pack(tmp_path, [({"type": "vocals"}, chart(notes=[{"t": 1, "s": 0, "f": 5}])),
                           ({}, chart(notes=[{"t": float("nan"), "s": 0, "f": 2},
                                             {"t": 1, "s": 99, "f": 2},
                                             {"t": 2, "s": 0, "f": -1}]))])
    result = load_harmony_source(path)
    assert len(result["arrangements"]) == 1
    assert result["arrangements"][0]["notes"] == []
    json.dumps(result, allow_nan=False)


def test_five_string_bass_and_seven_string_guitar_bases():
    bass = arrangement_pitch_metadata(chart(tuning=[0] * 5), {"type": "bass"})
    guitar = arrangement_pitch_metadata(chart(tuning=[0] * 7))
    assert bass["open_midi"] == [23, 28, 33, 38, 43]
    assert guitar["open_midi"] == [35, 40, 45, 50, 55, 59, 64]


@pytest.mark.parametrize("stems,legacy", [
    ([{"id": "full", "file": "audio.ogg"}], None),
    ([{"id": "full", "file": "audio.ogg"}, {"id": "guitar", "file": "guitar.ogg"}], None),
    ([{"id": "full", "file": "audio.ogg"}, {"id": "full", "file": "duplicate.ogg"},
      {"id": "guitar", "file": "guitar.ogg"}], None),
    ([{"id": "guitar", "file": "guitar.ogg"}], "audio.ogg"),
    ([{"id": "full", "file": "audio.ogg"}], "ignored.ogg"),
    ([{"id": "guitar", "file": "guitar.ogg"}], "missing.ogg"),
    ([{"id": 0, "file": "audio.ogg"}], None),
])
def test_directory_revision_matches_actual_playback_for_audio_layouts(tmp_path, stems, legacy):
    changes = {"stems": stems}
    if legacy:
        changes["original_audio"] = legacy
    path = pack(tmp_path, [({}, chart())], manifest_changes=changes)
    for name in ("guitar.ogg", "duplicate.ogg", "ignored.ogg"):
        (path / name).write_bytes(b"unused placeholder")
    source = load_harmony_source(path)
    loaded = sloppak.load_song(path.name, path.parent, tmp_path / "unused-cache")
    assert source["revision"] == loaded.harmonic_guide_revision


@pytest.mark.parametrize("zipped", [False, True])
def test_chart_replacement_after_read_is_not_blessed_with_new_revision(tmp_path, monkeypatch, zipped):
    path = pack(tmp_path, [({}, chart(notes=[{"t": 1, "s": 0, "f": 5}]))], zipped=zipped)
    original_read = sloppak.read_member_bytes

    def replacing_read(source, relative):
        payload = original_read(source, relative)
        if relative == "chart-0.json":
            replacement = json.dumps(chart(notes=[{"t": 1, "s": 0, "f": 7}]))
            if zipped:
                # Rebuild the disposable fixture instead of duplicate ZIP names.
                with zipfile.ZipFile(path) as archive:
                    members = {info.filename: archive.read(info) for info in archive.infolist()}
                members[relative] = replacement.encode()
                with zipfile.ZipFile(path, "w") as archive:
                    for name, value in members.items():
                        archive.writestr(name, value)
            else:
                (path / relative).write_text(replacement)
        return payload

    monkeypatch.setattr(sloppak, "read_member_bytes", replacing_read)
    with pytest.raises(ValueError, match="changed while reading its charts"):
        load_harmony_source(path)


def test_manifest_replacement_after_parse_is_rejected(tmp_path, monkeypatch):
    path = pack(tmp_path, [({}, chart())])
    original_load = sloppak.load_manifest

    def replacing_load(source):
        manifest = original_load(source)
        changed = {**manifest, "duration": 25}
        (path / "manifest.yaml").write_text(yaml.safe_dump(changed))
        return manifest

    monkeypatch.setattr(sloppak, "load_manifest", replacing_load)
    with pytest.raises(ValueError, match="changed while reading its manifest"):
        load_harmony_source(path)
