"""Versioned signed bar-expression wire data. Times are note-relative seconds."""
from copy import deepcopy
import math

EPSILON = 0.0000011


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def valid_whammy(value, sustain):
    if (not number(sustain) or sustain < 0 or not isinstance(value, dict)
            or set(value) != {"version", "policy", "segments"}
            or type(value["version"]) is not int or value["version"] != 1 or value["policy"] != "optional"
            or not isinstance(value["segments"], list) or not 1 <= len(value["segments"]) <= 20000):
        return False
    previous = 0
    for segment in value["segments"]:
        required = {"start", "end", "source_id", "group", "curve"}
        if (not isinstance(segment, dict) or not required <= set(segment) <= required | {"vibrato"}
                or not all(number(segment[k]) for k in ("start", "end"))
                or segment["start"] < -EPSILON or segment["start"] < previous - EPSILON
                or not segment["start"] < segment["end"] <= sustain + EPSILON
                or any(not isinstance(segment[k], str) or not 1 <= len(segment[k]) <= 256 for k in ("source_id", "group"))
                or segment.get("vibrato") not in (None, "slight", "wide")
                or not isinstance(segment["curve"], list) or len(segment["curve"]) > 2048
                or not segment["curve"] and not segment.get("vibrato")):
            return False
        previous = segment["end"]
        last = -math.inf
        for point in segment["curve"]:
            if (not isinstance(point, dict) or set(point) != {"t", "v"}
                    or not all(number(point[k]) for k in ("t", "v")) or not -16 <= point["v"] <= 8
                    or not segment["start"] - EPSILON <= point["t"] <= segment["end"] + EPSILON
                    or point["t"] <= last):
                return False
            last = point["t"]
    return True



def validate_whammy(note):
    if "whammy" not in note:
        return None
    value=note["whammy"]
    if not valid_whammy(value, note.get("sus", 0)):
        raise ValueError("Invalid whammy expression or unsupported policy")
    return deepcopy(value)
