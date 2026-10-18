"""Real worker/cache lifecycle, with deterministic blocked work for races."""

import json
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import appstate
from harmony_analysis import ALGORITHM_VERSION
from harmony_jobs import HarmonyJobs
from routers.harmony import router


def result(source):
    return {"version": 1, "algorithm_version": ALGORITHM_VERSION,
            "revision": source["revision"], "status": "partial", "source": "charts", "duration": 10,
            **{track: {"version": 1, "events": []} for track in ("keys", "harmony", "scales")}}


def wait_done(manager, job_id):
    deadline = time.monotonic() + 5
    with manager._condition:
        while manager.snapshot(job_id, include_results=False)["status"] not in {"complete", "failed", "cancelled"}:
            remaining = deadline - time.monotonic()
            assert remaining > 0, "worker did not finish"
            manager._condition.wait(timeout=remaining)
    return manager.snapshot(job_id)


@pytest.fixture
def manager(tmp_path):
    def loader(path, cancelled=None):
        revision = Path(path).read_text()
        return {"revision": revision, "fingerprint": revision, "normalization_version": "test"}
    manager = HarmonyJobs(tmp_path / "profile", loader=loader,
                          analyser=lambda source, cancelled=None: result(source),
                          revision_check=lambda path, *_: Path(path).read_text())
    yield manager
    manager.close()


def test_cache_reused_and_invalidated_without_library_writes(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    calls = []
    manager._analyse = lambda source, **kw: calls.append(source["revision"]) or result(source)
    first = wait_done(manager, manager.submit([("song", song)])["id"])
    assert first["items"][0]["cached"] is False
    second = wait_done(manager, manager.submit([("song", song)])["id"])
    assert second["items"][0]["cached"] is True
    assert calls == ["r1"]
    assert song.read_text() == "r1"
    song.write_text("r2")
    third = wait_done(manager, manager.submit([("song", song)])["id"])
    assert third["items"][0]["result"]["revision"] == "r2"
    assert calls == ["r1", "r2"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["profile", "song.feedpak"]


def test_force_recomputes_and_corrupt_cache_is_recoverable(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    wait_done(manager, manager.submit([("song", song)])["id"])
    path = next(manager.cache_dir.glob("*.json"))
    path.write_text("{bad")
    refreshed = wait_done(manager, manager.submit([("song", song)])["id"])
    assert refreshed["items"][0]["cached"] is False
    assert json.loads(path.read_text())["revision"] == "r1"
    forced = wait_done(manager, manager.submit([("song", song)], force=True)["id"])
    assert forced["items"][0]["cached"] is False


def test_unbounded_cached_events_are_recomputed(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    wait_done(manager, manager.submit([("song", song)])["id"])
    path = next(manager.cache_dir.glob("*.json"))
    bad = json.loads(path.read_text())
    bad["harmony"]["events"] = [{"t": 0, "root": "A", "quality": "min"}]
    path.write_text(json.dumps(bad))
    refreshed = wait_done(manager, manager.submit([("song", song)])["id"])
    assert refreshed["items"][0]["cached"] is False
    assert refreshed["items"][0]["result"]["harmony"]["events"] == []


def test_source_change_during_analysis_rejects_result(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    def analyse(source, **kw):
        song.write_text("r2")
        return result(source)
    manager._analyse = analyse
    finished = wait_done(manager, manager.submit([("song", song)])["id"])
    assert finished["status"] == "failed"
    assert "changed during analysis" in finished["items"][0]["error"]
    assert not manager.cache_dir.exists()


def test_cancel_running_and_queued_never_publishes_or_caches(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    entered = threading.Event()
    observed = threading.Event()
    def analyse(source, cancelled):
        entered.set()
        assert observed.wait(3)
        assert cancelled()
        return result(source)
    manager._analyse = analyse
    job = manager.submit([("first", song), ("second", song)])
    assert entered.wait(3)
    manager.cancel(job["id"])
    observed.set()
    manager.close()
    snapshot = manager.snapshot(job["id"])
    assert snapshot["status"] == "cancelled"
    assert all(item["status"] == "cancelled" and "result" not in item for item in snapshot["items"])
    assert not manager.cache_dir.exists()


def test_current_song_precedes_remaining_batch_and_failure_does_not_abort_batch(manager, tmp_path):
    files = []
    for name in ("first", "second", "current"):
        path = tmp_path / name
        path.write_text(name)
        files.append((name, path))
    entered, release = threading.Event(), threading.Event()
    order = []
    def analyse(source, **kw):
        order.append(source["revision"])
        if source["revision"] == "first":
            entered.set()
            assert release.wait(3)
            raise ValueError("unsupported fixture")
        return result(source)
    manager._analyse = analyse
    batch = manager.submit(files[:2])
    assert entered.wait(3)
    current = manager.submit(files[2:], priority="current")
    release.set()
    assert wait_done(manager, current["id"])["status"] == "complete"
    batch_result = wait_done(manager, batch["id"])
    assert order == ["first", "current", "second"]
    assert [i["status"] for i in batch_result["items"]] == ["failed", "complete"]


def test_unwritable_cache_keeps_result_available_in_session(manager, tmp_path):
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    manager.cache_dir.parent.mkdir()
    manager.cache_dir.write_text("not a directory")
    snapshot = wait_done(manager, manager.submit([("song", song)])["id"])
    assert snapshot["status"] == "complete"
    assert snapshot["items"][0]["result"]["revision"] == "r1"
    assert "cache_warning" in snapshot["items"][0]


def test_oversize_cache_result_remains_retrievable(manager, tmp_path, monkeypatch):
    monkeypatch.setattr("harmony_jobs._MAX_CACHE_BYTES", 10)
    song = tmp_path / "song.feedpak"
    song.write_text("r1")
    snapshot = wait_done(manager, manager.submit([("song", song)])["id"])
    assert snapshot["status"] == "complete"
    assert snapshot["items"][0]["result"]["revision"] == "r1"
    assert not list(manager.cache_dir.glob("*.json"))
    assert not list(manager.cache_dir.glob("*.tmp"))


@pytest.fixture
def client(manager, tmp_path, monkeypatch):
    monkeypatch.setattr(appstate, "harmony_jobs", manager)
    monkeypatch.setattr(appstate, "dlc_dir", tmp_path)
    monkeypatch.setattr(appstate, "dlc_dir_env", str(tmp_path))
    monkeypatch.setattr(appstate, "config_dir", tmp_path / "profile")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("name", ["../secret.feedpak", "C:/secret.feedpak", "/tmp/secret.feedpak", "..\\secret.feedpak", ""])
def test_api_rejects_paths_before_reading(client, name):
    assert client.post("/api/harmony/analyse", json={"filenames": [name]}).status_code == 403


def test_api_jobs_are_pollable_deduplicated_and_cancellable(client, manager, tmp_path):
    (tmp_path / "song.feedpak").write_text("r1")
    response = client.post("/api/harmony/analyse", json={"filenames": ["song.feedpak", "song.feedpak"]})
    assert response.status_code == 202
    job_id = response.json()["id"]
    wait_done(manager, job_id)
    snapshot = client.get(f"/api/harmony/jobs/{job_id}").json()
    assert snapshot["total"] == 1
    assert snapshot["items"][0]["result"]["revision"] == "r1"
    assert "result" not in client.get(f"/api/harmony/jobs/{job_id}?include_results=false").json()["items"][0]
    assert client.delete(f"/api/harmony/jobs/{job_id}").status_code == 200
    assert client.get("/api/harmony/jobs/not-a-job").status_code == 404
    assert client.post("/api/harmony/analyse", json={"filenames": []}).status_code == 422
    assert client.post("/api/harmony/analyse", json={"filenames": ["missing.feedpak"]}).status_code == 404
