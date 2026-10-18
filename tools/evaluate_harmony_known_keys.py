"""Controlled rest-guide experiment with supplied section keys, never key accuracy.

The reference keys are inputs. Independent chord annotations check containment,
not full scale suitability. Only a new evidence directory is written; no audio,
library, profile, cache or runtime is changed.
"""

import argparse
from collections import Counter
import copy
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
sys.path[:0] = [str(REPO), str(REPO / "lib")]
from harmony_source import load_harmony_source
from tools.evaluate_harmony import invariant_checks, lead_chart, load_engine, rest_metrics, write
from tools.evaluate_harmony_modulations import aligned_references, key_identity
from tools.evaluate_harmony_phrase_chords import aligned_chords, browser_guidance, score_guidance, _lookup

NAMES = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
ARMS = ("automatic", "automatic_family", "existing", "minor_context")


def assumed_family_control(base, original):
    """Hold detected keys fixed and isolate relaxing the observed-degree gate."""
    result = copy.deepcopy(original)
    mapper_keys = copy.deepcopy(result["keys"]["events"])
    for key in mapper_keys:
        if not key.get("unknown"):
            key.setdefault("evidence", {})["scale_degrees_resolved"] = True
    result["scales"]["events"] = base._scale_timeline(mapper_keys, result["harmony"]["events"], result["duration"])
    for scale in result["scales"]["events"]:
        scale.setdefault("evidence", {})["research_control_policy"] = "allow_conventional_family_for_known_detected_keys"
    duration = result["duration"]
    result["summary"]["scale_coverage"] = round(sum(e["end"] - e["t"] for e in result["scales"]["events"]
        if not e.get("unknown")) / duration, 4) if duration else 0
    if result["status"] != "unsupported":
        result["status"] = "complete" if min(result["summary"][k]
            for k in ("key_coverage", "scale_coverage", "chord_coverage")) >= .9 else "partial"
    result["algorithm_version"] += "+assumed-family-control"
    result["research_assumptions"] = {"detected_keys_unchanged": True, "harmony_unchanged": True,
        "family_basis": "conventional_family_assumed_for_known_detected_keys",
        "key_accuracy_is_not_an_outcome": True}
    return result


def supplied_keys(references, duration, uncertainty):
    """Only singleton reference interiors become inputs; all other time is unknown."""
    if not math.isfinite(uncertainty) or uncertainty < 0:
        raise ValueError("Explicit finite nonnegative alignment uncertainty is required")
    merged = []
    for event in references:
        identities = set(map(tuple, event["keys"]))
        identity = next(iter(identities)) if len(identities) == 1 else None
        if merged and merged[-1]["identity"] == identity and merged[-1]["end"] == event["t"]:
            merged[-1]["end"] = event["end"]
        else:
            merged.append({"t": event["t"], "end": event["end"], "identity": identity})
    events, cursor = [], 0.0

    def unknown(start, end):
        if end > start:
            events.append({"t": start, "end": end, "unknown": True, "confidence": "low",
                           "evidence": {"reason": "no_unambiguous_supplied_key"}})

    for event in merged:
        if event["identity"] is None:
            continue
        start, end = round(max(0, event["t"] + uncertainty), 6), round(min(duration, event["end"] - uncertainty), 6)
        if end <= start:
            continue
        unknown(cursor, start)
        pc, mode = event["identity"]
        root = NAMES[pc]
        events.append({"t": start, "end": end, "key": root + " " + mode,
                       "root": root, "mode": mode, "confidence": "high",
                       "evidence": {"reason": "supplied_section_key_for_controlled_test",
                                    "conventional_scale_family_is_assumed": True,
                                    "observed_scale_degrees_verified": False}})
        cursor = end
    unknown(cursor, duration)
    return events


def key_input_durations(references, keys, duration):
    annotated = sum(e["end"] - e["t"] for e in references if e["keys"])
    singleton = sum(e["end"] - e["t"] for e in references if len(set(map(tuple, e["keys"]))) == 1)
    supplied = sum(e["end"] - e["t"] for e in keys if not e.get("unknown"))
    return {"song_seconds": duration, "annotated_key_seconds": annotated,
            "ambiguous_key_seconds": annotated - singleton,
            "unlabelled_seconds": duration - annotated,
            "supplied_key_seconds": supplied, "trimmed_single_key_seconds": singleton - supplied}


def rest_diagnostic(result, keys, rests, guidance, baseline_guidance):
    """Common supplied-key rest mask; no scoring against the supplied key label."""
    windows = [{"t": w["start"], "end": w["end"]} for w in rests.get("qualifying_windows", [])
               if w["start"] > 0 and w.get("reentry")]
    scales = result["scales"]["events"]
    tracks = (keys, windows, guidance, baseline_guidance, scales)
    edges = sorted({x for events in tracks for e in events for x in (e["t"], e["end"])})
    key_at, window_at, guide_at, baseline_at, scale_at = map(_lookup, tracks)
    totals, reasons, paired = Counter(), Counter(), Counter()
    for start, end in zip(edges, edges[1:]):
        t, length = (start + end) / 2, end - start
        key = key_at(t)
        if not key or key.get("unknown") or not window_at(t):
            continue
        current, before = guide_at(t), baseline_at(t)
        kind, old_kind = (current or {}).get("kind", "none"), (before or {}).get("kind", "none")
        totals["common_rest_seconds"] += length
        totals[kind + "_seconds"] += length
        paired[old_kind + "_to_" + kind] += length
        if kind == "scale" and old_kind != "scale":
            totals["added_scale_seconds"] += length
        if kind != "scale" and old_kind == "scale":
            totals["lost_scale_seconds"] += length
        scale = scale_at(t)
        if kind == "scale":
            if key_identity(scale["root"] + " major")[0] != key_identity(key["key"])[0]:
                totals["scale_root_differs_from_supplied_tonic_seconds"] += length
            if scale["type"] == "harmonic_minor":
                totals["harmonic_minor_scale_seconds"] += length
        else:
            reasons[(scale or {}).get("evidence", {}).get("reason", "no_scale_event")] += length
    return {"totals": dict(totals), "no_scale_reasons_seconds": dict(reasons),
            "paired_guidance_seconds": dict(paired)}


def run(manifest_path, references_path, chord_directory, output, candidate_path, node):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    reference_text = references_path.read_text(encoding="utf-8-sig")
    hashes = {hashlib.sha256(references_path.read_bytes()).hexdigest(),
              hashlib.sha256(reference_text.encode("utf-8")).hexdigest()}
    if manifest.get("reference_sha256") not in hashes:
        raise ValueError("Reference file differs from its frozen selection manifest")
    references = json.loads(reference_text)
    by_id = {r["id"]: r for r in references["songs"]}
    if not manifest.get("songs"):
        raise ValueError("Manifest must contain songs")
    output.mkdir(parents=True, exist_ok=False)
    inputs = [(manifest_path, "manifest.json"), (references_path, "references.json"),
              (candidate_path, "candidate-engine.py"), (REPO / "lib/harmony_analysis.py", "production-engine.py"),
              (REPO / "lib/harmony_source.py", "source-adapter.py"),
              (REPO / "static/js/harmony-guide-model.js", "browser-model.mjs"),
              (Path(__file__), "evaluator.py"),
              (REPO / "tools/evaluate_harmony.py", "evaluation-helpers.py"),
              (REPO / "tools/evaluate_harmony_modulations.py", "reference-helpers.py"),
              (REPO / "tools/evaluate_harmony_phrase_chords.py", "chord-reference-helpers.py")]
    for entry in manifest["songs"]:
        if not re.fullmatch(r"[a-z0-9_-]+", entry["id"]):
            raise ValueError("Unsafe song ID")
        inputs.append((chord_directory / (entry["id"] + "-chordlab.txt"), entry["id"] + "-chordlab.txt"))
    for source, name in inputs:
        shutil.copyfile(source, output / name)
    definition = {"started_utc": datetime.now(timezone.utc).isoformat(),
        "classification": "controlled supplied-key experiment; not automatic-key accuracy",
        "audio_listened": False, "runtime_promoted": False,
        "method": "Reference keys are inputs. All arms use the same unambiguous, uncertainty-trimmed key scope and lead rests. Chord annotations are a separate comparison track, not full note-suitability ground truth.",
        "timing_limitation": "automatic_family records additional copy/remap time after automatic analysis; other arms include full v5 analysis. These timings are not directly comparable or calibrated performance measurements.",
        "arms": {"automatic": "Unchanged v5",
                 "automatic_family": "Detected keys unchanged; assume conventional family even with unresolved degrees",
                 "existing": "Supplied section key with existing v5 scale rules",
                 "minor_context": "Supplied key with bounded observed minor-dominant context"},
        "sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in output.iterdir() if p.is_file()}}
    write(output / "run-definition.json", definition)
    base = load_engine(output / "production-engine.py", "known_key_production")
    candidate = load_engine(output / "candidate-engine.py", "known_key_candidate")
    rows = []
    aggregates = {arm: {"rest": Counter(), "chord_reference": Counter(), "no_scale_reasons": Counter(),
                        "paired_guidance": Counter()} for arm in ARMS}
    for entry in manifest["songs"]:
        sid, path = entry["id"], Path(entry["path"])
        before_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if before_hash != entry.get("source_sha256"):
            raise ValueError("Source differs from frozen manifest: " + sid)
        source = load_harmony_source(path)
        refs = aligned_references(by_id[sid], entry["alignment"], source["duration"])
        keys = supplied_keys(refs, source["duration"], float(entry["alignment"].get("uncertainty_seconds", math.nan)))
        write(output / (sid + "-supplied-keys.json"), keys)
        scope = [{"t": e["t"], "end": e["end"]} for e in keys if not e.get("unknown")]
        chords = aligned_chords((output / (sid + "-chordlab.txt")).read_text(encoding="utf-8-sig"), entry["alignment"])
        lead = lead_chart(path, source, entry.get("arrangement_id"))
        row = {"id": sid, "title": source["title"], "path": str(path), "source_sha256": before_hash,
               "input_scope": key_input_durations(refs, keys, source["duration"]), "arms": {}}
        baseline_result, baseline_guidance, baseline_windows = None, None, None
        for arm in ARMS:
            started = time.perf_counter()
            if arm == "automatic":
                result = base.analyse_harmony(source)
            elif arm == "automatic_family":
                result = assumed_family_control(base, baseline_result)
            else:
                result = candidate.analyse_harmony(source, options={"key_events": keys, "policy": arm})
            engine_ms = round((time.perf_counter() - started) * 1000, 3)
            if arm == "automatic":
                baseline_result = result
            elif result["harmony"] != baseline_result["harmony"]:
                raise AssertionError("Supplied-key arm changed grounded harmony")
            write(output / f"{sid}-{arm}.json", result)
            rests = rest_metrics(node, output / "browser-model.mjs", lead, source, result)
            if not rests.get("available"):
                raise ValueError("No lead chart for controlled rest comparison: " + sid)
            guidance = browser_guidance(node, output / "browser-model.mjs", result)
            if arm == "automatic":
                baseline_guidance, baseline_windows = guidance, rests["qualifying_windows"]
            elif rests["qualifying_windows"] != baseline_windows:
                raise AssertionError("Comparison changed the common rest mask")
            diagnostic = rest_diagnostic(result, keys, rests, guidance, baseline_guidance)
            chord_metrics = score_guidance(chords, scope, rests["qualifying_windows"], guidance)
            checks = invariant_checks(base, result)
            if any(checks.values()):
                raise AssertionError(checks)
            row["arms"][arm] = {"engine_ms": engine_ms, "rests": rests, "diagnostic": diagnostic,
                                "timing_scope": "additional_copy_and_remap" if arm == "automatic_family" else "full_analysis_including_v5",
                                "chord_reference": chord_metrics, "checks": checks}
            aggregates[arm]["rest"].update(diagnostic["totals"])
            aggregates[arm]["chord_reference"].update(chord_metrics["totals"])
            aggregates[arm]["no_scale_reasons"].update(diagnostic["no_scale_reasons_seconds"])
            aggregates[arm]["paired_guidance"].update(diagnostic["paired_guidance_seconds"])
        if before_hash != hashlib.sha256(path.read_bytes()).hexdigest():
            raise RuntimeError("Source changed during evaluation: " + sid)
        rows.append(row)
        write(output / "songs-summary.json", rows)
        print(json.dumps({"complete": sid}), flush=True)
    # Imported helpers remain in the checkout; ensure their audit snapshots still match.
    for source, name in inputs:
        if hashlib.sha256(source.read_bytes()).hexdigest() != definition["sha256"][name]:
            raise RuntimeError("Evaluation source changed during run: " + name)
    summary = {"songs": len(rows), "classification": definition["classification"],
               "aggregate": {arm: {kind: dict(values) for kind, values in groups.items()}
                             for arm, groups in aggregates.items()}}
    write(output / "summary.json", summary)
    print(json.dumps({"output": str(output), "songs": len(rows)}))
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--chord-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidate-module", type=Path, default=REPO / "tools/harmony_known_key_prototype.py")
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    if not args.node:
        parser.error("Node is required for the actual browser guidance model")
    run(args.manifest, args.references, args.chord_directory, args.output, args.candidate_module, args.node)


if __name__ == "__main__":
    main()
