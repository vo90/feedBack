"""Compare chart-derived key timelines with independently prepared song references.

Reads local packs and a frozen alignment manifest; writes only a new output
directory. Reference agreement is not a recording-level listening evaluation.
"""

import argparse
from bisect import bisect_right
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys
import time

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "lib"))
from harmony_source import load_harmony_source

try:
    from .evaluate_harmony import beat_at, invariant_checks, load_engine, write
except ImportError:
    from evaluate_harmony import beat_at, invariant_checks, load_engine, write


def key_identity(label):
    match = re.fullmatch(r"([A-G])([#b]?)[ :]+(major|minor)", label or "")
    if not match:
        raise ValueError(f"Unsupported reference key: {label!r}")
    base = dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[match[1]]
    return ((base + (1 if match[2] == "#" else -1 if match[2] == "b" else 0)) % 12, match[3])


def collection(key):
    root, mode = key
    intervals = (0, 2, 4, 5, 7, 9, 11) if mode == "major" else (0, 2, 3, 5, 7, 8, 10)
    return frozenset((root + value) % 12 for value in intervals)


def aligned_references(song, alignment, duration):
    if alignment.get("verified") is not True or not alignment.get("method"):
        raise ValueError("Each pack needs independently verified timing alignment and its method")
    rate = float(alignment.get("rate", 1))
    reference_offset = float(alignment.get("reference_offset", 0))
    chart_offset = float(alignment.get("chart_offset", 0))
    transpose = alignment.get("pitch_transposition_semitones", 0)
    if not isinstance(transpose, int) or isinstance(transpose, bool):
        raise ValueError("Reference transposition must be an explicitly verified integer")
    if not math.isfinite(rate) or rate <= 0 or not all(map(math.isfinite, (reference_offset, chart_offset))):
        raise ValueError("Invalid alignment transform")
    spans, previous_end = [], -math.inf
    for segment in song["segments"]:
        start, end = float(segment["start"]), float(segment["end"])
        if not all(map(math.isfinite, (start, end))) or start < previous_end or end <= start:
            raise ValueError("Reference intervals must be finite, ordered and non-overlapping")
        previous_end = end
        keys = [((root + transpose) % 12, mode) for root, mode in map(key_identity, segment["keys"])]
        start = max(0, chart_offset + (start - reference_offset) * rate)
        end = min(duration, chart_offset + (end - reference_offset) * rate)
        if end > start:
            spans.append({"t": start, "end": end, "keys": keys})
    return spans


def _at(events, starts, t):
    index = bisect_right(starts, t) - 1
    event = events[index] if index >= 0 else None
    return event if event and t < event["end"] else None


def _known_key(event):
    return None if not event or event.get("unknown") else key_identity(event.get("key"))


def timeline_metrics(result, references, beats, boundary_tolerance_beats=4):
    keys, scales = result["keys"]["events"], result["scales"]["events"]
    key_starts, scale_starts = [e["t"] for e in keys], [e["t"] for e in scales]
    ref_starts = [e["t"] for e in references]
    edges = sorted({t for track in (keys, scales, references) for e in track for t in (e["t"], e["end"])})
    totals = dict(reference_seconds=0, key_known_seconds=0, key_correct_seconds=0,
                  key_wrong_seconds=0, key_collection_match_seconds=0,
                  scale_shown_seconds=0, scale_diatonic_collection_match_seconds=0)
    scale_intervals = {"major": (0, 2, 4, 5, 7, 9, 11), "natural_minor": (0, 2, 3, 5, 7, 8, 10),
                       "harmonic_minor": (0, 2, 3, 5, 7, 8, 11)}
    for start, end in zip(edges, edges[1:]):
        t, length = (start + end) / 2, end - start
        reference = _at(references, ref_starts, t)
        if not reference or not reference["keys"]:
            continue
        totals["reference_seconds"] += length
        allowed = {tuple(key) for key in reference["keys"]}
        current = _known_key(_at(keys, key_starts, t))
        if current:
            totals["key_known_seconds"] += length
            totals["key_correct_seconds" if current in allowed else "key_wrong_seconds"] += length
            if collection(current) in {collection(key) for key in allowed}:
                totals["key_collection_match_seconds"] += length
        scale = _at(scales, scale_starts, t)
        if scale and not scale.get("unknown"):
            totals["scale_shown_seconds"] += length
            intervals = scale_intervals.get(scale.get("type"))
            if intervals:
                root = key_identity(scale["root"] + " major")[0]
                pcs = frozenset((root + value) % 12 for value in intervals)
                if pcs in {collection(key) for key in allowed}:
                    totals["scale_diatonic_collection_match_seconds"] += length
    # Unknown spans remain explicit; bridging one does not imply a confident
    # boundary. Report its length alongside the eventual transition timing.
    transitions, previous = [], None
    for event in keys:
        key = _known_key(event)
        if key is None:
            continue
        if previous and key != previous["key"]:
            transitions.append({"t": event["t"], "from": previous["key"], "to": key,
                                "unknown_gap_seconds": max(0, event["t"] - previous["end"])})
        previous = {"key": key, "end": event["end"]}
    boundaries, matched_indices = [], set()
    for before, after in zip(references, references[1:]):
        if (not before["keys"] or not after["keys"] or before["end"] != after["t"]
                or set(before["keys"]) & set(after["keys"])):
            continue
        candidates = [(index, event) for index, event in enumerate(transitions)
                      if index not in matched_indices and event["from"] in before["keys"] and event["to"] in after["keys"]]
        nearest = min(candidates, key=lambda row: abs(row[1]["t"] - after["t"])) if candidates else None
        error = beat_at(beats, nearest[1]["t"]) - beat_at(beats, after["t"]) if nearest else None
        matched = error is not None and abs(error) <= boundary_tolerance_beats
        if matched:
            matched_indices.add(nearest[0])
        boundaries.append({"t": after["t"], "from": before["keys"], "to": after["keys"],
                           "nearest_transition": nearest[1] if nearest else None,
                           "error_beats": error, "within_tolerance": matched})
    # Only call an unmatched switch false where references cover both sides.
    # A reference gap or different recording arrangement is not a negative label.
    false_switches = []
    for index, event in enumerate(transitions):
        if index in matched_indices:
            continue
        left = _at(references, ref_starts, event["t"] - .001)
        right = _at(references, ref_starts, event["t"] + .001)
        gap = event["unknown_gap_seconds"]
        gap_start = event["t"] - gap
        covered_gap = sum(max(0, min(ref["end"], event["t"]) - max(ref["t"], gap_start))
                          for ref in references if ref["keys"])
        # Timing tolerance applies to the annotated key pair. An unrelated
        # detour remains a false switch even beside a real modulation.
        compatible_near_change = any(
            event["from"] in boundary["from"] and event["to"] in boundary["to"]
            and abs(beat_at(beats, event["t"]) - beat_at(beats, boundary["t"])) <= boundary_tolerance_beats
            for boundary in boundaries)
        accepted_ambiguity = (left and right and event["from"] in left["keys"] and event["to"] in right["keys"])
        if (left and right and left["keys"] and right["keys"] and not compatible_near_change
                and not accepted_ambiguity and covered_gap >= gap - 1e-6):
            false_switches.append(event)
    denominator = totals["reference_seconds"]
    known = totals["key_known_seconds"]
    return {**{name: round(value, 6) for name, value in totals.items()},
            "key_coverage": known / denominator if denominator else None,
            "key_accuracy_when_shown": totals["key_correct_seconds"] / known if known else None,
            "correct_key_coverage": totals["key_correct_seconds"] / denominator if denominator else None,
            "boundaries": boundaries, "predicted_transitions": transitions,
            "false_switches_in_annotated_regions": false_switches,
            "boundary_tolerance_beats": boundary_tolerance_beats}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--baseline-module", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--purpose", choices=("development", "initial_reference"), default="development",
                        help="Use initial_reference only before these songs influence implementation")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    references = json.loads(args.references.read_text(encoding="utf-8-sig"))
    reference_hashes = {hashlib.sha256(args.references.read_bytes()).hexdigest(),
                        hashlib.sha256(args.references.read_text(encoding="utf-8-sig").encode("utf-8")).hexdigest()}
    # Git's Windows newline conversion must not invalidate unchanged JSON.
    if manifest.get("reference_sha256") not in reference_hashes:
        raise ValueError("References differ from the independently frozen selection manifest")
    by_id = {song["id"]: song for song in references["songs"]}
    args.output.mkdir(parents=True, exist_ok=False)
    engines = {}
    for label, path in (("baseline", args.baseline_module), ("current", REPO / "lib/harmony_analysis.py")):
        frozen = args.output / f"{label}-engine.py"
        shutil.copyfile(path, frozen)
        engines[label] = load_engine(frozen, "modulation_evaluation_" + label)
    for source, name in ((args.manifest, "manifest.json"), (args.references, "references.json"),
                         (Path(__file__), "evaluator.py"), (REPO / "tools/evaluate_harmony.py", "evaluation-helpers.py"),
                         (REPO / "lib/harmony_source.py", "source-adapter.py")):
        shutil.copyfile(source, args.output / name)
    write(args.output / "run-definition.json", {"started_utc": datetime.now(timezone.utc).isoformat(),
          "evaluation_purpose": args.purpose,
          "audio_listened": False, "method": "Independent timed key annotations aligned before predictions; duration agreement and abstention reported separately. Diatonic collection match is not scale suitability.",
          "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in args.output.iterdir() if p.is_file()}})
    rows = []
    for entry in manifest["songs"]:
        if not re.fullmatch(r"[a-z0-9_-]+", entry["id"]):
            raise ValueError("Song IDs must be portable filename components")
        path = Path(entry["path"])
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        if before != entry.get("source_sha256"):
            raise ValueError(f"Pack differs from the independently frozen reference manifest: {path}")
        source = load_harmony_source(path)
        reference = aligned_references(by_id[entry["id"]], entry["alignment"], source["duration"])
        row = {"id": entry["id"], "title": source["title"], "path": str(path), "source_sha256": before,
               "revision": source["revision"], "cohort": entry.get("cohort", "independent_reference"), "engines": {}}
        for label, engine in engines.items():
            start = time.perf_counter()
            result = engine.analyse_harmony(source)
            row["engines"][label] = {"algorithm": engine.ALGORITHM_VERSION,
                "engine_ms": round((time.perf_counter() - start) * 1000, 3),
                "checks": invariant_checks(engine, result), "metrics": timeline_metrics(result, reference, source["beats"])}
            write(args.output / f"{entry['id']}-{label}.json", result)
        if before != hashlib.sha256(path.read_bytes()).hexdigest():
            raise RuntimeError(f"Source pack changed: {path}")
        rows.append(row)
        write(args.output / "songs-summary.json", rows)
        print(json.dumps({"complete": entry["id"], "title": source["title"]}), flush=True)
    print(json.dumps({"songs": len(rows), "output": str(args.output)}))


if __name__ == "__main__":
    main()
