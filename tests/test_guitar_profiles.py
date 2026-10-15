"""Durable Default guitar, migration, route recall and concurrent update guards."""
import copy
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import guitar_profiles as gp


@pytest.fixture
def store(tmp_path):
    return tmp_path / "guitar-profiles.json"


def command(path, action, **fields):
    return gp.update(path, {"action": action, "expectedRevision": gp.read(path)["revision"], **fields})


def test_default_needs_no_creation_and_calibrates_normally(store):
    state = gp.read(store)
    assert state["activeId"] == "default"
    assert state["profiles"][0]["name"] == "Default guitar"
    assert not store.exists()
    command(store, "save-gain", gain=2.5, routeKey="interface-input-1")
    assert gp.read(store)["profiles"][0]["calibrations"]["interface-input-1"]["gain"] == 2.5
    with pytest.raises(gp.ProfileError, match="cannot be deleted"):
        command(store, "delete", profileId="default")


def test_legacy_gain_migrates_once_and_waits_for_an_input(store):
    command(store, "migrate", gain=3)
    assert gp.read(store)["profiles"][0]["legacyGain"] == 3
    command(store, "bind-legacy", routeKey="helix-dry-7")
    migrated = gp.read(store)
    assert "legacyGain" not in migrated["profiles"][0]
    assert migrated["profiles"][0]["calibrations"]["helix-dry-7"]["gain"] == 3
    assert command(store, "migrate", gain=1) == migrated


def test_guitars_and_inputs_recall_independently_across_reload(store):
    command(store, "migrate", gain=2, routeKey="cable")
    state = command(store, "create", name="Les Paul")
    guitar = state["activeId"]
    command(store, "save-gain", gain=0.5, routeKey="cable")
    command(store, "save-gain", gain=1.4, routeKey="interface")
    state = command(store, "select", profileId="default")
    assert state["profiles"][0]["calibrations"]["cable"]["gain"] == 2
    state = command(store, "select", profileId=guitar)
    assert state == json.loads(store.read_text())
    assert state["profiles"][1]["calibrations"]["interface"]["gain"] == 1.4


def test_delete_active_returns_to_default_and_duplicate_is_independent(store):
    command(store, "save-gain", gain=2, routeKey="input")
    state = command(store, "duplicate", name="Copy")
    copied = state["activeId"]
    command(store, "save-gain", gain=4, routeKey="input")
    state = command(store, "delete", profileId=copied)
    assert state["activeId"] == "default"
    assert state["profiles"][0]["calibrations"]["input"]["gain"] == 2


@pytest.mark.parametrize("gain", [0, -1, True, 5.01, float("nan"), float("inf"), "2"])
def test_invalid_gain_cannot_overwrite_saved_calibration(store, gain):
    command(store, "save-gain", gain=2, routeKey="input")
    previous = store.read_bytes()
    with pytest.raises(gp.ProfileError):
        command(store, "save-gain", gain=gain, routeKey="input")
    assert store.read_bytes() == previous


def test_old_calibration_cannot_save_into_a_different_selected_guitar(store):
    command(store, "create", name="Strat")
    before = store.read_bytes()
    with pytest.raises(gp.ProfileError, match="selected guitar changed"):
        command(store, "save-gain", profileId="default", routeKey="input", gain=2)
    assert store.read_bytes() == before


def test_concurrent_writers_cannot_lose_each_others_changes(store):
    request = {"action": "create", "name": "One", "expectedRevision": 0}
    def write(name):
        try:
            return gp.update(store, {**request, "name": name})
        except gp.ProfileError as error:
            return error.status
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["One", "Two"]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 409 in results
    assert len(gp.read(store)["profiles"]) == 2


def test_damaged_storage_is_kept_instead_of_resetting_user_guitars(store):
    store.write_text('{"version":1,"broken":', encoding="utf-8")
    previous = store.read_bytes()
    with pytest.raises(gp.ProfileError, match="kept unchanged"):
        command(store, "migrate", gain=1)
    assert store.read_bytes() == previous


def test_write_failure_retains_old_state(store, monkeypatch):
    command(store, "migrate", gain=2, routeKey="input")
    previous = store.read_bytes()
    def fail(*_):
        raise OSError("disk unavailable")
    monkeypatch.setattr(gp.os, "replace", fail)
    with pytest.raises(gp.ProfileError, match="Could not save"):
        command(store, "create", name="Unsaved guitar")
    assert store.read_bytes() == previous


def test_settings_directory_failure_returns_a_profile_error(store, monkeypatch):
    def fail(*_, **__):
        raise OSError("settings directory unavailable")
    monkeypatch.setattr(Path, "mkdir", fail)
    with pytest.raises(gp.ProfileError, match="Could not save") as error:
        command(store, "create", name="Unsaved guitar")
    assert error.value.status == 503
    assert not store.exists()


def test_locked_temporary_file_does_not_mask_write_failure(store, monkeypatch):
    command(store, "migrate", gain=2, routeKey="input")
    previous = store.read_bytes()
    def fail(*_, **__):
        raise OSError("file locked")
    monkeypatch.setattr(gp.os, "replace", fail)
    monkeypatch.setattr(gp.os, "unlink", fail)
    with pytest.raises(gp.ProfileError, match="Could not save") as error:
        command(store, "create", name="Unsaved guitar")
    assert error.value.status == 503
    assert store.read_bytes() == previous


def test_api_error_codes_and_default_get(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import appstate
    from routers.guitar_profiles import router
    monkeypatch.setattr(appstate, "config_dir", tmp_path)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert client.get('/api/guitar-profiles').json()["activeId"] == "default"
    assert client.post('/api/guitar-profiles', json={"action": "create", "name": "Strat", "expectedRevision": 0}).status_code == 200
    assert client.post('/api/guitar-profiles', json={"action": "create", "name": "Stale", "expectedRevision": 0}).status_code == 409
    assert client.post('/api/guitar-profiles', json={"action": "delete", "profileId": "default", "expectedRevision": 1}).status_code == 400
