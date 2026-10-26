"""Bounded evidence for verified input calibration; no audio is persisted.

These checks validate a completed measurement, not a client-supplied boolean.
Keep the acceptance contract aligned with the NoteDetect v2 capture model.
"""
import math


class CalibrationQualityError(ValueError):
    pass


def _require(condition):
    if not condition:
        raise CalibrationQualityError("Input verification is incomplete or invalid. Calibrate again.")


def _number(value, low, high, integer=False):
    _require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high)
    if integer:
        _require(value == int(value))
        return int(value)
    return float(value)


def _capture(value, noise=False):
    _require(isinstance(value, dict))
    result = {
        "frames": _number(value.get("frames"), 50, 10000, True),
        "durationMs": _number(value.get("durationMs"), 1000 if noise else 2000, 60000),
        "peakMax": _number(value.get("peakMax"), 0, 0.98),
        "clippedSamples": _number(value.get("clippedSamples"), 0, 0, True),
        "invalidSamples": _number(value.get("invalidSamples"), 0, 0, True),
    }
    _require(result["peakMax"] < 0.98)
    if noise:
        result["rmsP95"] = _number(value.get("rmsP95"), 0, result["peakMax"])
    else:
        result["activeFrames"] = _number(value.get("activeFrames"), 15, result["frames"], True)
        _require(result["activeFrames"] >= result["frames"] * 0.15)
        result["attackCount"] = _number(value.get("attackCount"), 3, result["activeFrames"], True)
        result["peakP95"] = _number(value.get("peakP95"), 0, result["peakMax"])
        result["rmsMedian"] = _number(value.get("rmsMedian"), 0, result["peakP95"])
        _require(result["rmsMedian"] > 0)
    return result


def verified_quality(value, gain, raw_peak, noise_peak):
    """Validate and return only supported summary fields (never arbitrary data)."""
    _require(isinstance(value, dict) and value.get("version") == 2)
    _require(value.get("status") == "verified" and value.get("engine") == "native-harmonic-v1")
    candidate = _number(value.get("candidateGain"), 0.1, 5)
    _require(abs(candidate - gain) <= 1e-8)
    candidate = float(gain)
    threshold = _number(value.get("silenceThreshold"), 0.002, 0.02)
    tuning = value.get("tuning")
    _require(isinstance(tuning, dict))
    instrument = tuning.get("instrument")
    _require(instrument in ("guitar", "bass"))
    count = _number(tuning.get("stringCount"), 4, 8, True)
    _require(count in ((6, 7, 8) if instrument == "guitar" else (4, 5, 6)))
    notes = tuning.get("openStringMidi")
    _require(isinstance(notes, list) and len(notes) == count)
    notes = [_number(note, 0, 127, True) for note in notes]
    reference = _number(tuning.get("referencePitchHz"), 430, 450)
    label = tuning.get("label", "Custom tuning")
    _require(isinstance(label, str) and 1 <= len(label) <= 100 and all(ord(c) >= 32 for c in label))
    captures = value.get("capture")
    _require(isinstance(captures, dict))
    captures = {kind: _capture(captures.get(kind), kind == "noise") for kind in ("noise", "normal", "strong")}
    _require(all(captures[kind]["peakMax"] * candidate < 0.98 for kind in ("normal", "strong")))
    _require(threshold + 1e-10 >= max(0.002, captures["noise"]["peakMax"] * candidate * 6))
    _require(abs(_number(raw_peak, 0, .98) - captures["strong"]["peakMax"]) <= 1e-8)
    _require(abs(_number(noise_peak, 0, .98) - captures["noise"]["peakMax"]) <= 1e-8)
    checks = value.get("checks")
    _require(isinstance(checks, list) and len(checks) == count * 2)
    found, cleaned = set(), []
    for check in checks:
        _require(isinstance(check, dict))
        string = _number(check.get("string"), 0, count - 1, True)
        mode = check.get("mode")
        _require(mode in ("normal", "soft") and (string, mode) not in found)
        found.add((string, mode))
        frames = _number(check.get("frames"), 6, 10000, True)
        passed = _number(check.get("passedFrames"), math.ceil(frames * 0.75), frames, True)
        span = _number(check.get("spanMs"), 600, 60000)
        cents = _number(check.get("medianCents"), -50, 50)
        margin = _number(check.get("softThresholdMargin"), 2 if mode == "soft" else 1, 10000)
        cleaned.append({"string": string, "mode": mode, "frames": frames, "passedFrames": passed,
                        "spanMs": span, "medianCents": cents, "softThresholdMargin": margin})
    return {"version": 2, "status": "verified", "engine": "native-harmonic-v1",
            "candidateGain": candidate, "silenceThreshold": threshold,
            "tuning": {"instrument": instrument, "stringCount": count, "openStringMidi": notes,
                       "referencePitchHz": reference, "label": label},
            "capture": captures, "checks": cleaned}
