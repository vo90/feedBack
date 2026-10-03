"""Refresh older, intact FeedForge position hints in memory during loading.

The archive remains the authority for music and authored guidance. Hash checks
run against its raw JSON before wire parsing can normalize musical fields.
"""
import hashlib
import json
from bisect import bisect_right

from lib.generated_hand_positions import generate_positions


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def _anchors(chart):
    proof = chart.get("ext", {}).get("chartGuidance")
    if not isinstance(proof, dict) or proof.get("policy") != "feedforge-chart-guidance-v2":
        return None
    if proof.get("sourceAuthored") is not False or proof.get("positionPolicy") is not None:
        return None  # Current and unknown future position policies remain intact.
    fields = proof.get("fields")
    if (not isinstance(fields, list) or "anchors" not in fields
            or any(k not in ("anchors", "handshapes") for k in fields)
            or len(fields) != len(set(fields))):
        return None
    music = {k: chart[k] for k in ("tuning", "capo", "centOffset", "notes", "chords", "templates") if k in chart}
    if (proof.get("musicSha256") != _digest(music)
            or proof.get("guidanceSha256") != _digest({k: chart.get(k) for k in fields})
            or proof.get("slidePolicy") != "known-corridor"
            or proof.get("legatoPolicy") != "compact-explicit-hopo"
            or proof.get("fingeringAssessed") is not False):
        return None
    anchors = generate_positions(chart)
    window = proof.get("window")
    if window is not None:
        left, right = window
        if not 0 <= left < right:
            return None
        initial = anchors[bisect_right([a["time"] for a in anchors], left) - 1]
        anchors = [{**initial, "time": left}, *[a for a in anchors if left < a["time"] < right]]
    return anchors


def refresh_generated_positions(data):
    """Copy only changed display fields; never mutate the source arrangement."""
    result = data
    try:
        anchors = _anchors(data)
        if anchors is not None and anchors != data.get("anchors"):
            result = {**result, "anchors": anchors}
    except (ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError):
        # Unsupported or malformed guidance must not prevent ordinary playback.
        pass
    if isinstance(data.get("phrases"), list):
        phrases = []
        inherited = {k: data[k] for k in ("tuning", "capo", "centOffset", "templates") if k in data}
        for phrase in data["phrases"]:
            levels = []
            for level in phrase.get("levels", []):
                try:
                    anchors = _anchors({**inherited, **level})
                except (ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError):
                    anchors = None
                levels.append({**level, "anchors": anchors} if anchors is not None else level)
            phrases.append({**phrase, "levels": levels})
        result = {**result, "phrases": phrases}
    return result
