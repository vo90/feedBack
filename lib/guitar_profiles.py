"""Physical instruments and input-level calibration, independent of musical roles.

All mutations use a revision check and atomic replacement. Missing storage exposes
a usable Default guitar; damaged storage is never silently replaced.
"""
import copy
import json
import math
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone

LOCK = threading.RLock()
MAX_PROFILES = 32
MAX_ROUTES = 64


class ProfileError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def initial_state():
    return {"version": 1, "revision": 0, "migrated": False, "activeId": "default",
            "profiles": [{"id": "default", "name": "Default guitar", "calibrations": {}}]}


def gain_value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.1 <= value <= 5:
        raise ProfileError("Input gain must be between 0.1 and 5 times.")
    return float(value)


def profile_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
        raise ProfileError("Enter a guitar name of 1–80 characters.")
    return value.strip()


def route_key(value):
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise ProfileError("Choose an audio input before saving its gain.")
    return value


def load(path):
    if not path.exists():
        return initial_state()
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        assert state["version"] == 1 and type(state["revision"]) is int and state["revision"] >= 0
        assert type(state["migrated"]) is bool
        profiles = state["profiles"]
        assert isinstance(profiles, list) and 1 <= len(profiles) <= MAX_PROFILES
        ids = set()
        for profile in profiles:
            pid = profile["id"]
            assert isinstance(pid, str) and 0 < len(pid) <= 80 and pid not in ids
            ids.add(pid)
            profile_name(profile["name"])
            if "legacyGain" in profile:
                gain_value(profile["legacyGain"])
            levels = profile["calibrations"]
            assert isinstance(levels, dict) and len(levels) <= MAX_ROUTES
            for key, level in levels.items():
                route_key(key)
                gain_value(level["gain"])
                assert type(level.get("calibrated")) is bool
        assert "default" in ids and state["activeId"] in ids
        return state
    except (ValueError, KeyError, TypeError, AssertionError, OSError) as error:
        raise ProfileError("Saved guitars could not be read. Your saved file has been kept unchanged.", 503) from error


def _persist(path, state):
    name = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".guitars-", suffix=".tmp", delete=False) as handle:
            name = handle.name
            json.dump(state, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    except OSError as error:
        raise ProfileError("Could not save guitar settings. Try again.", 503) from error
    finally:
        if name and os.path.exists(name):
            try:
                os.unlink(name)
            except OSError:
                # A locked temporary file must not mask the original save
                # failure or turn a completed replacement into a false error.
                pass


def read(path):
    with LOCK:
        return load(path)


def update(path, data):
    with LOCK:
        previous = load(path)
        if type(data.get("expectedRevision")) is not int or data["expectedRevision"] != previous["revision"]:
            raise ProfileError("Guitar settings changed. Refresh and try again.", 409)
        state = copy.deepcopy(previous)
        action = data.get("action")
        profile = next((p for p in state["profiles"] if p["id"] == data.get("profileId", state["activeId"])), None)
        if profile is None:
            raise ProfileError("That guitar is no longer available.", 409)
        if action == "migrate":
            if state["migrated"]:
                return previous
            default = next(p for p in state["profiles"] if p["id"] == "default")
            if data.get("gain") is not None:
                value = gain_value(data["gain"])
                if data.get("routeKey"):
                    default["calibrations"][route_key(data["routeKey"])] = {"gain": value, "calibrated": False, "method": "legacy"}
                else:
                    default["legacyGain"] = value
            state["migrated"] = True
        elif action == "bind-legacy":
            key = route_key(data.get("routeKey"))
            if "legacyGain" not in profile:
                return previous
            profile["calibrations"].setdefault(key, {"gain": profile.pop("legacyGain"), "calibrated": False, "method": "legacy"})
        elif action in ("create", "duplicate"):
            if len(state["profiles"]) >= MAX_PROFILES:
                raise ProfileError("You can save up to 32 guitars.")
            new_profile = {"id": uuid.uuid4().hex, "name": profile_name(data.get("name")),
                           "calibrations": copy.deepcopy(profile["calibrations"]) if action == "duplicate" else {}}
            state["profiles"].append(new_profile)
            state["activeId"] = new_profile["id"]
        elif action == "select":
            state["activeId"] = profile["id"]
        elif action == "rename":
            profile["name"] = profile_name(data.get("name"))
        elif action == "delete":
            if profile["id"] == "default":
                raise ProfileError("The Default guitar cannot be deleted. You can rename or calibrate it.")
            state["profiles"].remove(profile)
            if state["activeId"] == profile["id"]:
                state["activeId"] = "default"
        elif action == "save-gain":
            if profile["id"] != state["activeId"]:
                raise ProfileError("The selected guitar changed. Start calibration again.", 409)
            key = route_key(data.get("routeKey"))
            if key not in profile["calibrations"] and len(profile["calibrations"]) >= MAX_ROUTES:
                raise ProfileError("This guitar already has 64 saved input setups.")
            meta = data.get("metadata") or {}
            if not isinstance(meta, dict):
                raise ProfileError("Invalid calibration details.")
            level = {"gain": gain_value(data.get("gain")), "calibrated": True,
                     "savedAt": datetime.now(timezone.utc).isoformat(),
                     "method": "guided-level-v1" if meta.get("method") == "guided-level-v1" else "manual"}
            for field in ("rawPeak", "noisePeak"):
                value = meta.get(field)
                if value is not None:
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1000:
                        raise ProfileError("Invalid measured input level.")
                    level[field] = value
            profile["calibrations"][key] = level
            profile.pop("legacyGain", None)
        else:
            raise ProfileError("Unknown guitar operation.")
        if state == previous:
            return previous
        state["revision"] += 1
        _persist(path, state)
        return state
