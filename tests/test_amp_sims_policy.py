import json
import threading

import pytest

import appstate
from amp_sims_policy import AmpSimsPolicy
from routers import settings


def test_cached_policy_strict_opt_in_and_subscriptions():
    policy = AmpSimsPolicy(applicable=True)
    seen = []
    unsubscribe = policy.subscribe(seen.append)
    assert seen[-1]["ready"] is False
    for value in ({}, {"use_amp_sims": False}, {"use_amp_sims": "true"}, None):
        policy.notify(policy.prepare(value))
        assert policy.snapshot()["enabled"] is False
    policy.notify(policy.prepare({"use_amp_sims": True}))
    assert seen[-1]["enabled"] is True
    old_generation = seen[-1]["generation"]
    assert policy.prepare({"use_amp_sims": True}) is None
    unsubscribe()
    policy.notify(policy.prepare({}))
    assert seen[-1]["generation"] == old_generation


def test_superseded_notification_is_not_delivered_and_callback_failure_isolated():
    policy = AmpSimsPolicy()
    seen = []
    policy.subscribe(lambda _: (_ for _ in ()).throw(RuntimeError("subscriber failure")))
    policy.subscribe(seen.append)
    old = policy.prepare({"use_amp_sims": True})
    latest = policy.prepare({"use_amp_sims": False})
    policy.notify(latest)
    count = len(seen)
    policy.notify(old)
    assert len(seen) == count
    assert seen[-1]["applicable"] is False
    assert policy.context()["snapshot"]()["enabled"] is False


def test_concurrent_commit_cannot_deliver_old_on_after_new_off():
    policy = AmpSimsPolicy(applicable=True)
    entered, release, off_started, off_committed, off_delivered = (threading.Event() for _ in range(5))
    seen = []

    def observe(value):
        # Snapshot calls remain available while delivery is serialized.
        assert policy.snapshot()["generation"] >= value["generation"]
        if value["enabled"]:
            entered.set()
            assert release.wait(1)
        seen.append(value["enabled"])
        if value["ready"] and not value["enabled"]:
            off_delivered.set()

    policy.subscribe(observe)
    on = policy.prepare({"use_amp_sims": True})
    old = threading.Thread(target=policy.notify, args=(on,))

    def turn_off():
        off_started.set()
        value = policy.prepare({"use_amp_sims": False})
        off_committed.set()
        policy.notify(value)

    newer = threading.Thread(target=turn_off)
    old.start()
    try:
        assert entered.wait(1)
        newer.start()
        assert off_started.wait(1)
        assert off_committed.wait(1), "callback must not hold the state lock across a settings commit"
        # The previous implementation delivered OFF here, then stale ON.
        off_delivered.wait(0.05)
    finally:
        release.set()
        old.join(1)
        if newer.ident is not None:
            newer.join(1)
    assert not old.is_alive() and not newer.is_alive()
    assert seen == [False, True, False]
    assert policy.snapshot()["enabled"] is False


@pytest.fixture
def policy_routes(tmp_path, monkeypatch):
    policy = AmpSimsPolicy(applicable=True)
    monkeypatch.setattr(appstate, "amp_sims_policy", policy)
    monkeypatch.setattr(appstate, "config_dir", tmp_path)
    monkeypatch.setattr(appstate, "default_settings", lambda: {"use_amp_sims": False})
    monkeypatch.setattr(appstate, "running_version", lambda: "test")
    return policy, tmp_path


def test_post_reset_import_notify_after_write_and_outside_settings_lock(policy_routes):
    policy, directory = policy_routes
    observations = []

    def observe(value):
        acquired = settings._settings_lock.acquire(blocking=False)
        assert acquired, "subscriber ran under settings write lock"
        settings._settings_lock.release()
        file = directory / "config.json"
        observations.append((value, json.loads(file.read_text()) if file.exists() else None))

    policy.subscribe(observe)
    assert settings.save_settings({"use_amp_sims": True}).get("error") is None
    assert observations[-1][0]["enabled"] is True
    assert observations[-1][1]["use_amp_sims"] is True
    count = len(observations)
    settings.save_settings({"use_amp_sims": None})
    settings.save_settings({"use_amp_sims": "false"})
    settings.save_settings({"default_arrangement": "Lead"})
    assert len(observations) == count
    settings.reset_settings({"keys": ["use_amp_sims"]})
    assert observations[-1][0]["enabled"] is False
    assert "use_amp_sims" not in observations[-1][1]
    result = settings.import_settings({"schema": 1, "server_config": {"use_amp_sims": True}})
    assert result["ok"] is True
    assert observations[-1][0]["enabled"] is True
    assert observations[-1][1]["use_amp_sims"] is True


def test_failed_import_or_write_cannot_publish_new_policy(policy_routes, monkeypatch):
    policy, directory = policy_routes
    settings.save_settings({"use_amp_sims": False})
    before = policy.snapshot()
    bad = settings.import_settings({"schema": 1, "server_config": {"use_amp_sims": "true"}})
    assert bad.status_code == 400
    assert policy.snapshot() == before
    monkeypatch.setattr(settings, "_atomic_write_file", lambda *args: (_ for _ in ()).throw(OSError("disk unavailable")))
    with pytest.raises(OSError):
        settings.save_settings({"use_amp_sims": True})
    assert policy.snapshot() == before
    assert json.loads((directory / "config.json").read_text())["use_amp_sims"] is False


def test_reset_without_file_keeps_missing_config_unchanged(policy_routes):
    policy, directory = policy_routes
    assert settings.reset_settings({"keys": ["use_amp_sims"]})["reset"] == []
    assert not (directory / "config.json").exists()
    assert policy.snapshot()["enabled"] is False
