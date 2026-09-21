"""End-to-end harmony frames remain optional and precede ready."""

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import WebSocketDisconnect

import appstate
import sloppak
from routers import ws_highway
from routers.ws_highway import highway_ws
from tests.test_sloppak_harmony_load import write_pack


class CollectWS:
    def __init__(self):
        self.messages = []

    async def accept(self):
        pass

    async def send_json(self, data):
        # Enforce actual network JSON constraints even with a lightweight WS.
        self.messages.append(json.loads(json.dumps(data, allow_nan=False)))

    async def receive_text(self):
        raise WebSocketDisconnect()

    async def close(self):
        pass


@pytest.fixture()
def stream(tmp_path, monkeypatch):
    for name, value in {
        "dlc_dir": tmp_path, "dlc_dir_env": str(tmp_path),
        "config_dir": tmp_path / "config", "sloppak_cache_dir": tmp_path / "cache",
        "audio_cache_dir": tmp_path / "audio", "static_dir": tmp_path / "static",
    }.items():
        monkeypatch.setattr(appstate, name, value)

    def run(pak):
        ws = CollectWS()
        asyncio.run(highway_ws(ws, pak.name, arrangement=0))
        assert not [msg for msg in ws.messages if msg.get("error")], ws.messages
        assert ws.messages[-1] == {"type": "ready"}
        return ws.messages

    return run


def test_stream_harmony_preserves_keys_and_song_revision(tmp_path, stream):
    pak = write_pack(tmp_path, harmony={"version": 1, "events": [
        {"t": 0, "root": "A", "quality": "m"}, {"t": 4, "root": None},
    ]})
    messages = stream(pak)
    info = next(msg for msg in messages if msg["type"] == "song_info")
    assert info["has_keys"] is True
    assert info["has_harmony"] is True
    assert info["harmonic_guide_revision"].startswith("hg1-")
    assert next(msg for msg in messages if msg["type"] == "keys") == {
        "type": "keys", "version": 1,
        "data": [{"t": 0, "key": "Am", "scale": "natural_minor"}],
    }
    assert next(msg for msg in messages if msg["type"] == "harmony") == {
        "type": "harmony", "version": 1,
        "data": [{"t": 0, "root": "A", "quality": "m"}, {"t": 4, "root": None}],
    }


@pytest.mark.parametrize("payload", [None, {"events": "bad"}])
def test_no_usable_harmony_frame_does_not_prevent_ready(tmp_path, stream, payload):
    messages = stream(write_pack(tmp_path, harmony=payload))
    info = next(msg for msg in messages if msg["type"] == "song_info")
    assert info["has_harmony"] is False
    assert info["harmonic_guide_revision"]
    assert not [msg for msg in messages if msg["type"] == "harmony"]


def test_empty_track_is_explicit_and_revision_changes_on_correction(tmp_path, stream):
    pak = write_pack(tmp_path, harmony={"version": 1, "events": []})
    messages = stream(pak)
    first = next(msg for msg in messages if msg["type"] == "song_info")
    assert first["has_harmony"] is True
    assert next(msg for msg in messages if msg["type"] == "harmony")["data"] == []
    (pak / "harmony.json").write_text('{"version":1,"events":[{"t":0,"root":"A"}]}', encoding="utf-8")
    messages = stream(pak)
    second = next(msg for msg in messages if msg["type"] == "song_info")
    assert first["harmonic_guide_revision"] != second["harmonic_guide_revision"]


def test_unavailable_revision_is_explicit_and_playback_continues(tmp_path, stream, monkeypatch):
    monkeypatch.setattr(sloppak, "source_revision", lambda *args: None)
    messages = stream(write_pack(tmp_path))
    info = next(msg for msg in messages if msg["type"] == "song_info")
    assert info["harmonic_guide_revision"] is None


def test_loose_song_local_edits_have_chart_and_audio_revision(tmp_path, stream, monkeypatch):
    from tests.test_loosefolder import _write_min_xml

    folder = tmp_path / "loose"
    folder.mkdir()
    _write_min_xml(folder / "lead.xml")
    (folder / "audio.wem").write_bytes(b"placeholder")

    def fake_convert(_source, target):
        output = Path(target + ".ogg")
        output.write_bytes(b"converted-placeholder")
        return str(output)

    monkeypatch.setattr(ws_highway, "convert_wem", fake_convert)
    first = next(msg for msg in stream(folder) if msg["type"] == "song_info")
    assert first["format"] == "loose"
    assert first["has_harmony"] is False
    assert first["harmonic_guide_revision"]
    _write_min_xml(folder / "lead.xml", duration="321")
    second = next(msg for msg in stream(folder) if msg["type"] == "song_info")
    assert second["harmonic_guide_revision"] != first["harmonic_guide_revision"]
    (folder / "audio.wem").write_bytes(b"changed-audio-source")
    third = next(msg for msg in stream(folder) if msg["type"] == "song_info")
    assert third["harmonic_guide_revision"] != second["harmonic_guide_revision"]
