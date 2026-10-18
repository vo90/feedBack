"""Optional feedpak harmony stays independent of chart data and fails softly."""

import json
import os
import zipfile
from pathlib import Path

import pytest
import yaml

import sloppak
from harmony import source_revision


def write_pack(root: Path, *, harmony=None, reference="harmony.json") -> Path:
    pak = root / "guide.feedpak"
    (pak / "arrangements").mkdir(parents=True)
    (pak / "stems").mkdir()
    (pak / "arrangements/lead.json").write_text(json.dumps({
        "notes": [{"t": 1.0, "s": 0, "f": 5, "sus": 2.0}],
        "chords": [], "templates": [], "anchors": [], "handshapes": [],
        "beats": [{"time": 0, "measure": 0}],
    }), encoding="utf-8")
    (pak / "stems/full.ogg").write_bytes(b"audio-placeholder")
    manifest = {
        "title": "Guide", "artist": "Test", "duration": 24,
        "arrangements": [{"id": "lead", "name": "Lead", "file": "arrangements/lead.json"}],
        "stems": [{"id": "full", "file": "stems/full.ogg"}],
        "keys": "keys.json",
    }
    if reference is not None:
        manifest["harmony"] = reference
    (pak / "manifest.yaml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
    (pak / "keys.json").write_text(json.dumps({
        "version": 1, "events": [{"t": 0, "key": "Am", "scale": "natural_minor"}],
    }), encoding="utf-8")
    if harmony is not None:
        (pak / "harmony.json").write_text(json.dumps(harmony), encoding="utf-8")
    return pak


def load_pack(pak: Path, cache_name="cache"):
    return sloppak.load_song(pak.name, pak.parent, pak.parent / cache_name)


def test_progression_and_no_chord_do_not_change_played_notes(tmp_path):
    events = [
        {"t": 0, "root": "A", "quality": "m", "rn": "i"},
        {"t": 4, "root": "F", "quality": "maj", "rn": "VI"},
        {"t": 8, "root": "C", "quality": "maj", "bass": "E"},
        {"t": 12, "root": "G", "quality": "7sus4"},
        {"t": 16, "root": None},
        {"t": 20},  # omitted root means N.C., never inference from Roman numerals
    ]
    pak = write_pack(tmp_path, harmony={"version": 1, "events": events})
    loaded = load_pack(pak)
    assert loaded.harmony == {"version": 1, "events": events[:-1] + [{"t": 20, "root": None}]}
    assert loaded.keys == {"version": 1, "events": [{"t": 0, "key": "Am", "scale": "natural_minor"}]}
    arrangement = loaded.song.arrangements[0]
    assert len(arrangement.notes) == 1
    assert arrangement.notes[0].fret == 5
    assert arrangement.chords == []


@pytest.mark.parametrize("payload", [[], {}, {"events": None}, {"events": "bad"}])
def test_malformed_optional_harmony_does_not_prevent_playback(tmp_path, payload):
    loaded = load_pack(write_pack(tmp_path, harmony=payload))
    assert loaded.harmony is None
    assert loaded.keys is not None
    assert loaded.song.arrangements


@pytest.mark.parametrize("reference", [None, "missing.json", "../outside.json", "harmony.json"])
def test_missing_undeclared_escaping_or_invalid_json_is_ignored(tmp_path, reference):
    pak = write_pack(tmp_path, reference=reference)
    (pak / "harmony.json").write_text("{broken", encoding="utf-8")
    (tmp_path / "outside.json").write_text('{"events":[{"t":0,"root":"D"}]}', encoding="utf-8")
    loaded = load_pack(pak)
    assert loaded.harmony is None
    assert loaded.song.arrangements


def test_sanitization_drops_bad_events_without_inventing_roots(tmp_path):
    payload = {"version": float("nan"), "events": [
        {"t": 4, "root": " Bb ", "quality": " custom ", "bass": " F ", "rn": " IV "},
        {"t": 0, "root": "A", "quality": 7, "rn": None, "bass": []},
        {"t": 2, "rn": "V"},
        {"t": 3, "root": ""}, {"t": 3, "root": 5},
        {"t": True, "root": "A"}, {"t": "1", "root": "A"},
        {"t": float("nan"), "root": "A"}, {"t": float("inf"), "root": "A"},
        {"t": 10 ** 400, "root": "A"}, {"root": "A"}, [], "bad",
    ]}
    loaded = load_pack(write_pack(tmp_path, harmony=payload))
    assert loaded.harmony == {"version": 1, "events": [
        {"t": 0, "root": "A"},
        {"t": 2, "root": None, "rn": "V"},
        {"t": 4, "root": "Bb", "quality": "custom", "bass": "F", "rn": "IV"},
    ]}
    json.dumps(loaded.harmony, allow_nan=False)


def test_revision_stable_across_loads_and_has_source_identity(tmp_path):
    pak = write_pack(tmp_path)
    revision = load_pack(pak).harmonic_guide_revision
    assert revision and revision.startswith("hg1-")
    assert revision == load_pack(pak).harmonic_guide_revision
    # Different libraries must not share edits just because filenames match.
    other = write_pack(tmp_path / "other")
    assert revision != load_pack(other).harmonic_guide_revision


@pytest.mark.parametrize("relative", ["arrangements/lead.json", "keys.json", "harmony.json"])
def test_revision_tracks_chart_and_guide_content_even_with_preserved_stat(tmp_path, relative):
    pak = write_pack(tmp_path, harmony={"version": 1, "events": [{"t": 0, "root": "A"}]})
    before = load_pack(pak).harmonic_guide_revision
    file = pak / relative
    stamp = file.stat()
    text = file.read_text(encoding="utf-8")
    # Keep file length and mtime identical: chart/guide identity is content based.
    replacements = {"arrangements/lead.json": ('"f": 5', '"f": 7'),
                    "keys.json": ('"Am"', '"Em"'), "harmony.json": ('"A"', '"E"')}
    old, new = replacements[relative]
    file.write_text(text.replace(old, new), encoding="utf-8")
    os.utime(file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert file.stat().st_size == stamp.st_size
    assert before != load_pack(pak).harmonic_guide_revision


def test_revision_tracks_audio_stats_without_reading_audio(tmp_path, monkeypatch):
    pak = write_pack(tmp_path)
    original_open = Path.open

    def guarded_open(path, *args, **kwargs):
        assert path.suffix != ".ogg", "revision must not read large audio contents"
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    before = load_pack(pak).harmonic_guide_revision
    audio = pak / "stems/full.ogg"
    stamp = audio.stat()
    os.utime(audio, ns=(stamp.st_atime_ns, stamp.st_mtime_ns + 1_000_000))
    assert before != load_pack(pak).harmonic_guide_revision


def test_archive_revision_ignores_unpack_cache_timestamps_and_tracks_contents(tmp_path):
    pak = write_pack(tmp_path, harmony={"events": [{"t": 0, "root": "A"}]})
    archive = tmp_path / "packed.feedpak"

    def pack():
        with zipfile.ZipFile(archive, "w") as zipped:
            for file in sorted(pak.rglob("*")):
                if file.is_file():
                    zipped.write(file, file.relative_to(pak).as_posix())

    pack()
    before = load_pack(archive, "cache-a").harmonic_guide_revision
    assert before == load_pack(archive, "cache-b").harmonic_guide_revision
    pack()  # new archive timestamp, identical member contents
    assert before == source_revision(archive)
    (pak / "stems/full.ogg").write_bytes(b"changed-audio")
    pack()
    assert before != source_revision(archive)


def test_source_revision_refuses_escaping_reads_and_fails_softly(tmp_path, monkeypatch):
    root = tmp_path / "song"
    root.mkdir()
    outside = tmp_path / "secret.json"
    outside.write_text("private", encoding="utf-8")
    original_open = Path.open

    def guarded_open(path, *args, **kwargs):
        assert path != outside
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    assert source_revision(root, ["../secret.json"]) is not None
    assert source_revision(root, ["bad\0path"]) is None


def test_optional_revision_enumeration_failure_is_nonfatal(tmp_path):
    def unavailable_files():
        raise PermissionError("chart enumeration denied")
        yield

    assert source_revision(tmp_path, unavailable_files()) is None
