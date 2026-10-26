"""Verified profile evidence and the boundary that enables a quieter gate."""
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import guitar_profiles as gp


def metadata(instrument="guitar", count=6):
    playing = {"frames": 200, "durationMs": 4000, "activeFrames": 120, "attackCount": 5,
               "rmsMedian": 0.025, "peakP95": 0.075, "peakMax": 0.1,
               "clippedSamples": 0, "invalidSamples": 0}
    return {"method": "guided-input-v2", "rawPeak": 0.1, "noisePeak": 0.0001,
            "quality": {"version": 2, "status": "verified", "engine": "native-harmonic-v1",
                        "candidateGain": 2.5, "silenceThreshold": 0.002,
                        "tuning": {"instrument": instrument, "stringCount": count,
                                   "openStringMidi": [40, 45, 50, 55, 59, 64][:count],
                                   "referencePitchHz": 440, "label": "Standard"},
                        "capture": {"noise": {"frames": 100, "durationMs": 2000,
                                              "rmsP95": 0.00005, "peakMax": 0.0001,
                                              "clippedSamples": 0, "invalidSamples": 0},
                                    "normal": copy.deepcopy(playing), "strong": copy.deepcopy(playing)},
                        "checks": [{"string": string, "mode": mode, "frames": 10,
                                    "passedFrames": 9, "spanMs": 900, "medianCents": 4,
                                    "softThresholdMargin": 3}
                                   for string in range(count) for mode in ("normal", "soft")]}}


def update(path, action="save-gain", **fields):
    return gp.update(path, {"action": action, "expectedRevision": gp.read(path)["revision"], **fields})


def test_verified_calibration_roundtrips_and_discards_arbitrary_payloads(tmp_path):
    path = tmp_path / "profiles.json"
    measured = metadata()
    measured["quality"]["rawAudio"] = [0.1] * 100
    state = update(path, gain=2.5, routeKey="helix-7", metadata=measured)
    saved = state["profiles"][0]["calibrations"]["helix-7"]
    assert saved["method"] == "guided-input-v2"
    assert saved["quality"]["silenceThreshold"] == .002
    assert len(saved["quality"]["checks"]) == 12
    assert "rawAudio" not in saved["quality"]
    assert gp.read(path) == state


def test_manual_edit_removes_verification_without_touching_other_routes(tmp_path):
    path = tmp_path / "profiles.json"
    for route in ("helix-7", "other"):
        update(path, gain=2.5, routeKey=route, metadata=metadata())
    state = update(path, gain=1.5, routeKey="helix-7")
    saved = state["profiles"][0]["calibrations"]
    assert saved["helix-7"]["method"] == "manual"
    assert "quality" not in saved["helix-7"]
    assert saved["other"]["quality"]["status"] == "verified"


@pytest.mark.parametrize("field,value", [
    ("candidateGain", 2), ("candidateGain", float("nan")),
    ("silenceThreshold", .001), ("silenceThreshold", .021), ("silenceThreshold", True),
    ("version", 1), ("status", "measured"), ("engine", "browser"),
])
def test_invalid_quality_cannot_replace_existing_settings(tmp_path, field, value):
    path = tmp_path / "profiles.json"
    update(path, gain=1, routeKey="helix-7")
    before = path.read_bytes()
    measured = metadata()
    measured["quality"][field] = value
    with pytest.raises(gp.ProfileError):
        update(path, gain=2.5, routeKey="helix-7", metadata=measured)
    assert path.read_bytes() == before


@pytest.mark.parametrize("fault", ["missing", "duplicate", "wrong-string", "wrong-note", "too-short",
                                  "few-frames", "few-passes", "weak-soft", "nonfinite"])
def test_incomplete_string_checks_are_rejected(tmp_path, fault):
    measured = metadata()
    checks = measured["quality"]["checks"]
    if fault == "missing": checks.pop()
    elif fault == "duplicate": checks[-1] = copy.deepcopy(checks[0])
    elif fault == "wrong-string": checks[0]["string"] = 6
    elif fault == "wrong-note": checks[0]["medianCents"] = 100
    elif fault == "too-short": checks[0]["spanMs"] = 100
    elif fault == "few-frames": checks[0]["frames"] = 3
    elif fault == "few-passes": checks[0]["passedFrames"] = 7
    elif fault == "weak-soft": checks[1]["softThresholdMargin"] = 1.5
    elif fault == "nonfinite": checks[0]["medianCents"] = float("inf")
    path = tmp_path / "profiles.json"
    with pytest.raises(gp.ProfileError):
        update(path, gain=2.5, routeKey="helix-7", metadata=measured)
    assert not path.exists()


@pytest.mark.parametrize("fault", ["clipped", "invalid", "insufficient", "one-attack", "noisy", "gain-clips", "normal-gain-clips", "peak-mismatch"])
def test_bad_measurements_cannot_be_marked_verified(tmp_path, fault):
    measured = metadata()
    quality = measured["quality"]
    if fault == "clipped": quality["capture"]["strong"]["clippedSamples"] = 1
    elif fault == "invalid": quality["capture"]["noise"]["invalidSamples"] = 1
    elif fault == "insufficient": quality["capture"]["normal"]["activeFrames"] = 3
    elif fault == "one-attack": quality["capture"]["strong"]["attackCount"] = 1
    elif fault == "noisy":
        quality["capture"]["noise"]["peakMax"] = measured["noisePeak"] = .002
    elif fault == "gain-clips":
        quality["capture"]["strong"]["peakMax"] = measured["rawPeak"] = .5
    elif fault == "normal-gain-clips": quality["capture"]["normal"]["peakMax"] = .7
    elif fault == "peak-mismatch": measured["rawPeak"] = .2
    with pytest.raises(gp.ProfileError):
        update(tmp_path / "profiles.json", gain=2.5, routeKey="helix-7", metadata=measured)


def test_draft_create_is_atomic_and_requires_matching_instrument_family(tmp_path):
    path = tmp_path / "profiles.json"
    measured = {"gain": 2.5, "routeKey": "helix-7", "metadata": metadata()}
    with pytest.raises(gp.ProfileError, match="instrument type changed"):
        update(path, "create", name="Bass", type="bass", calibration=measured)
    assert not path.exists()
    measured["metadata"] = metadata("bass", 4)
    state = update(path, "create", name="Bass", type="bass", calibration=measured)
    assert state["profiles"][-1]["calibrations"]["helix-7"]["quality"]["tuning"]["instrument"] == "bass"


def test_corrupted_persisted_verified_evidence_is_preserved(tmp_path):
    path = tmp_path / "profiles.json"
    state = update(path, gain=2.5, routeKey="helix-7", metadata=metadata())
    state["profiles"][0]["calibrations"]["helix-7"]["quality"]["checks"] = []
    path.write_text(json.dumps(state))
    before = path.read_bytes()
    with pytest.raises(gp.ProfileError, match="could not be read"):
        gp.read(path)
    assert path.read_bytes() == before


def test_missing_measurements_are_not_verified(tmp_path):
    measured = metadata()
    measured.pop("rawPeak")
    with pytest.raises(gp.ProfileError, match="measurements are missing"):
        update(tmp_path / "profiles.json", gain=2.5, routeKey="helix-7", metadata=measured)


@pytest.mark.parametrize("fault", ["missing-raw", "missing-noise", "false-calibrated", "family", "boolean-peak", "null-peak"])
def test_damaged_saved_evidence_cannot_restore_verification(tmp_path, fault):
    path = tmp_path / "profiles.json"
    state = update(path, gain=2.5, routeKey="helix-7", metadata=metadata())
    saved = state["profiles"][0]["calibrations"]["helix-7"]
    if fault == "missing-raw": saved.pop("rawPeak")
    elif fault == "missing-noise": saved.pop("noisePeak")
    elif fault == "false-calibrated": saved["calibrated"] = False
    elif fault == "family": state["profiles"][0]["type"] = "bass"
    elif fault == "boolean-peak": saved["rawPeak"] = True
    elif fault == "null-peak": saved["rawPeak"] = None
    path.write_text(json.dumps(state))
    before = path.read_bytes()
    with pytest.raises(gp.ProfileError, match="could not be read"):
        gp.read(path)
    assert path.read_bytes() == before


def test_duplicate_keeps_starting_gain_but_requires_its_own_note_checks(tmp_path):
    path = tmp_path / "profiles.json"
    update(path, gain=2.5, routeKey="helix-7", metadata=metadata())
    state = update(path, "duplicate", name="Another guitar")
    original = state["profiles"][0]["calibrations"]["helix-7"]
    copied = state["profiles"][-1]["calibrations"]["helix-7"]
    assert original["quality"]["status"] == "verified"
    assert copied == {"gain": 2.5, "calibrated": True, "method": "manual"}


def test_unclassified_instrument_rejects_verified_save_without_damaging_store(tmp_path):
    path = tmp_path / "profiles.json"
    state = gp.initial_state()
    state["profiles"].append({"id": "old", "name": "Imported", "type": None,
                              "builtin": False, "calibrations": {}})
    state["activeId"] = "old"
    path.write_text(json.dumps(state))
    before = path.read_bytes()
    with pytest.raises(gp.ProfileError, match="instrument type changed"):
        update(path, gain=2.5, routeKey="helix-7", metadata=metadata())
    assert path.read_bytes() == before
    assert gp.read(path) == state
