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
    assert state["activeId"] == "default-guitar"
    assert state["profiles"][0]["name"] == "Guitar"
    assert not store.exists()
    command(store, "save-gain", gain=2.5, routeKey="interface-input-1")
    assert gp.read(store)["profiles"][0]["calibrations"]["interface-input-1"]["gain"] == 2.5
    with pytest.raises(gp.ProfileError, match="cannot be deleted"):
        command(store, "delete", profileId="default-guitar")


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
    state = command(store, "create", type="guitar", name="Les Paul")
    guitar = state["activeId"]
    command(store, "save-gain", gain=0.5, routeKey="cable")
    command(store, "save-gain", gain=1.4, routeKey="interface")
    state = command(store, "select", profileId="default-guitar")
    assert state["profiles"][0]["calibrations"]["cable"]["gain"] == 2
    state = command(store, "select", profileId=guitar)
    assert state == json.loads(store.read_text())
    assert state["profiles"][2]["calibrations"]["interface"]["gain"] == 1.4


def test_delete_active_returns_to_default_and_duplicate_is_independent(store):
    command(store, "save-gain", gain=2, routeKey="input")
    state = command(store, "duplicate", name="Copy")
    copied = state["activeId"]
    command(store, "save-gain", gain=4, routeKey="input")
    state = command(store, "delete", profileId=copied)
    assert state["activeId"] == "default-guitar"
    assert state["profiles"][0]["calibrations"]["input"]["gain"] == 2


@pytest.mark.parametrize("gain", [0, -1, True, 5.01, float("nan"), float("inf"), "2"])
def test_invalid_gain_cannot_overwrite_saved_calibration(store, gain):
    command(store, "save-gain", gain=2, routeKey="input")
    previous = store.read_bytes()
    with pytest.raises(gp.ProfileError):
        command(store, "save-gain", gain=gain, routeKey="input")
    assert store.read_bytes() == previous


def test_old_calibration_cannot_save_into_a_different_selected_guitar(store):
    command(store, "create", type="guitar", name="Strat")
    before = store.read_bytes()
    with pytest.raises(gp.ProfileError, match="selected instrument changed"):
        command(store, "save-gain", profileId="default-guitar", routeKey="input", gain=2)
    assert store.read_bytes() == before


def test_concurrent_writers_cannot_lose_each_others_changes(store):
    request = {"action": "create", "type": "guitar", "name": "One", "expectedRevision": 0}
    def write(name):
        try:
            return gp.update(store, {**request, "name": name})
        except gp.ProfileError as error:
            return error.status
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["One", "Two"]))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 409 in results
    assert len(gp.read(store)["profiles"]) == 3


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
        command(store, "create", type="guitar", name="Unsaved guitar")
    assert store.read_bytes() == previous


def test_settings_directory_failure_returns_a_profile_error(store, monkeypatch):
    def fail(*_, **__):
        raise OSError("settings directory unavailable")
    monkeypatch.setattr(Path, "mkdir", fail)
    with pytest.raises(gp.ProfileError, match="Could not save") as error:
        command(store, "create", type="guitar", name="Unsaved guitar")
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
        command(store, "create", type="guitar", name="Unsaved guitar")
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
    assert client.get('/api/guitar-profiles').json()["activeId"] == "default-guitar"
    assert client.post('/api/guitar-profiles', json={"action": "create", "type": "guitar", "name": "Strat", "expectedRevision": 0}).status_code == 200
    assert client.post('/api/guitar-profiles', json={"action": "create", "type": "guitar", "name": "Stale", "expectedRevision": 0}).status_code == 409
    assert client.post('/api/guitar-profiles', json={"action": "delete", "profileId": "default-guitar", "expectedRevision": 1}).status_code == 400


def test_bass_first_start_and_defaults_have_separate_gains(store):
    state = gp.read(store, "bass")
    assert state["activeId"] == "default-bass"
    assert [(p["name"], p["type"]) for p in state["profiles"]] == [("Guitar", "guitar"), ("Bass", "bass")]
    gp.update(store, {"action": "migrate", "expectedRevision": 0, "gain": 3, "routeKey": "input"}, "bass")
    command(store, "save-gain", gain=4, routeKey="input")
    state = command(store, "select", profileId="default-guitar")
    assert state["currentType"] == "guitar"
    assert state["profiles"][0]["calibrations"] == {}
    assert state["profiles"][1]["calibrations"]["input"]["gain"] == 4


def test_new_instrument_can_skip_or_atomically_save_measured_level(store):
    state = command(store, "create", name="Jazz Bass", type="bass")
    skipped = next(p for p in state["profiles"] if p["id"] == state["activeId"])
    assert skipped["calibrations"] == {} and skipped["type"] == "bass"
    assert state["lastSelectedByType"]["bass"] == skipped["id"]
    state = command(store, "create", name="Strat", type="guitar", calibration={
        "gain": 2.5, "routeKey": "interface", "metadata": {"method": "guided-level-v1", "rawPeak": .1}})
    selected = next(p for p in state["profiles"] if p["id"] == state["activeId"])
    assert selected["calibrations"]["interface"]["calibrated"]
    assert selected["calibrations"]["interface"]["gain"] == 2.5
    before = store.read_bytes()
    with pytest.raises(gp.ProfileError):
        command(store, "create", name="Invalid", type="bass", calibration={"gain": 9, "routeKey": "input"})
    assert store.read_bytes() == before


def test_legacy_store_migration_preserves_levels_and_classifies_named_instruments_once(store):
    levels = {"input": {"gain": 2.4, "calibrated": True, "method": "manual"}}
    old = {"version": 1, "revision": 5, "migrated": True, "activeId": "custom", "profiles": [
        {"id": "default", "name": "Default guitar", "calibrations": copy.deepcopy(levels)},
        {"id": "custom", "name": "My bass", "calibrations": copy.deepcopy(levels)},
    ]}
    store.write_text(json.dumps(old), encoding="utf-8")
    state = gp.read(store, "bass")
    assert state["version"] == 2 and state["revision"] == 6
    assert state["activeId"] == "custom" and state["currentType"] == "bass"
    assert state["profiles"][0]["id"] == "default-bass"
    assert state["profiles"][0]["name"] == "Bass"
    assert state["profiles"][1]["type"] is None
    assert gp.read(store, "guitar") == state  # Migration is durable, never repeated.
    with pytest.raises(gp.ProfileError, match="Choose Guitar or Bass"):
        command(store, "select", profileId="custom")
    state = command(store, "classify", profileId="custom", type="bass")
    assert state["profiles"][1]["calibrations"] == levels
    with pytest.raises(gp.ProfileError, match="already has a type"):
        command(store, "classify", profileId="custom", type="guitar")
    state = command(store, "delete", profileId="custom")
    assert state["activeId"] == "default-bass"
    assert state["lastSelectedByType"]["bass"] == "default-bass"


@pytest.mark.parametrize("kind", [None, "drums", "", 1, True])
def test_add_requires_explicit_supported_instrument_type(store, kind):
    with pytest.raises(gp.ProfileError, match="Choose Guitar or Bass"):
        command(store, "create", name="Unknown", type=kind)
    assert not store.exists()


def test_api_migrates_default_using_existing_bass_settings(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import appstate
    from routers.guitar_profiles import router
    monkeypatch.setattr(appstate, "config_dir", tmp_path)
    (tmp_path / "config.json").write_text(json.dumps({"instrument": "bass", "active_instrument_profile": "bass"}))
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    assert client.get('/api/guitar-profiles').json()["activeId"] == "default-bass"


def test_full_legacy_store_keeps_every_profile_when_second_default_is_added(store):
    store.write_text(json.dumps({"version": 1, "revision": 1, "migrated": True, "activeId": "default",
        "profiles": [{"id": "default", "name": "Default guitar", "calibrations": {}}] + [
            {"id": str(i), "name": "Instrument " + str(i), "calibrations": {}} for i in range(31)]}))
    state = gp.read(store)
    assert len(state["profiles"]) == 33
    assert gp.read(store) == state
    with pytest.raises(gp.ProfileError, match="up to 32"):
        command(store, "create", name="Extra", type="guitar")
