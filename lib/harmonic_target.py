"""Validated fretted-harmonic extension, separate from natural hn/hps."""
import math

NODES = {12:12, 7:19, 19:19, 5:24, 24:24, 4:28, 9:28, 16:28,
         3.2:31, 2.7:34, 5.8:34, 9.6:34, 14.7:34, 21.7:34,
         2.4:36, 8.2:36, 17:36}
POLICIES = {"pinch":"harmonic", "artificial":"harmonic", "tapped":"harmonic",
            "semi":"mixed", "feedback":"attack_either"}


def _valid_shape(value):
    if not isinstance(value, dict):
        return False
    if set(value) == {"kind", "node", "interval", "policy", "basis"}:
        # Playback can define a pitch without defining the player's touch fret.
        return (value["kind"] == "artificial" and value["node"] is None
                and type(value["interval"]) is int and value["interval"] == 24
                and value["policy"] == "harmonic"
                and value["basis"] == "source-playback-fallback")
    return (set(value) == {"kind", "node", "interval", "policy"}
            and isinstance(value["kind"], str) and value["kind"] in POLICIES
            and type(value["node"]) in (int, float) and math.isfinite(value["node"])
            and type(value["interval"]) is int
            and NODES.get(value["node"]) == value["interval"]
            and POLICIES[value["kind"]] == value["policy"])


def validate_target(note):
    if "harmonic_target" not in note:
        return None
    value = note["harmonic_target"]
    if (not _valid_shape(value)
            or type(note.get("f")) is not int or not 0 <= note["f"] <= 48
            or any(note.get(k) for k in ("hm", "mt", "fhm"))
            or any(k in note for k in ("hn", "hps", "harmonic_alias"))
            or type(note.get("hp", False)) is not bool
            or note.get("hp", False) != (value["kind"] in ("pinch", "semi"))):
        raise ValueError("Invalid fretted harmonic target or scoring policy")
    return dict(value)


def validate_alias(note):
    if "harmonic_alias" not in note:
        return None
    if (note["harmonic_alias"] != "songsterr-natural-15"
            or note.get("hm") is not True or note.get("hp")
            or note.get("mt") or note.get("fhm")
            or type(note.get("f")) is not int or note["f"] != 15
            or note.get("hn") != 14.7 or type(note.get("hps")) is not int
            or note["hps"] != 34 or "harmonic_target" in note):
        raise ValueError("Invalid verified natural harmonic alias")
    return note["harmonic_alias"]
