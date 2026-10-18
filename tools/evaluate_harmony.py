"""Read-only chart-harmony development evaluation; never an accuracy benchmark.

Adapted from the frozen September 2026 evaluator. Only the output directory is
written. Audio members are never opened. Use a new output path for every run.
"""

import argparse
from bisect import bisect_right
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "lib"))
from harmony_source import load_harmony_source
from jsonc import parse_jsonc
import sloppak

NODE_HELPER = r"""
const fs = require('fs');
const { pathToFileURL } = require('url');
(async () => {
 const input = JSON.parse(fs.readFileSync(0, 'utf8'));
 const model = await import(pathToFileURL(input.modelPath).href);
 const prepared = model.prepareRestWindows({...input.lead, beats:input.beats,
   duration:input.duration, minimumBeats:4, minimumSeconds:3, thresholdMode:'beats'});
 const timeline = model.createHarmonyTimeline({generated:input.result});
 const edges = [...new Set([0,input.duration,...['keys','harmony','scales']
   .flatMap(k=>input.result[k].events.flatMap(e=>[e.t,e.end]))])].sort((a,b)=>a-b);
 const spans = {scale:[],chord_tones:[],full_guide:[]};
 for(let i=0;i<edges.length-1;i++) {
   const state=model.resolveHarmony(timeline,(edges[i]+edges[i+1])/2);
   const span={start:edges[i],end:edges[i+1]};
   if(state.scale && state.targetPc!==null && state.confidence.harmony!=='low') {
     spans.scale.push(span);
     if(state.key) spans.full_guide.push(span);
   }
   if(state.guidance?.kind==='chord_tones') spans.chord_tones.push(span);
 }
 process.stdout.write(JSON.stringify({windows:prepared.windows,spans,mode:prepared.mode}));
})().catch(error=>{process.stderr.write(error.stack);process.exit(1);});
"""


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_engine(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def lead_chart(path, source, arrangement_id=None):
    candidates = [a for a in source["arrangements"] if a["role"] == "lead"]
    if arrangement_id:
        selected = next((a for a in source["arrangements"] if a["id"] == arrangement_id), None)
    else:
        selected = next((a for a in candidates if a["id"] == "lead"), candidates[0] if candidates else None)
    if selected is None:
        return None
    manifest = sloppak.load_manifest(path)
    entry = next(e for e in manifest["arrangements"] if str(e.get("id")) == selected["id"])
    raw = parse_jsonc(sloppak.read_member_bytes(path, entry["file"]).decode("utf-8"))
    phrases = raw.get("phrases") or []
    levels = [next((level for level in p.get("levels", [])
                    if level.get("difficulty") == p.get("max_difficulty")), None) for p in phrases]
    complete = bool(phrases) and all(level is not None for level in levels)
    return {"id": selected["id"], "representation": "phrase_maximum" if complete else "flat",
            **{field: [event for level in levels for event in level.get(field, [])] if complete
               else raw.get(field, []) for field in ("notes", "chords")}}


def beat_at(beats, t):
    if len(beats) < 2:
        return t
    index = max(0, min(len(beats) - 2, bisect_right(beats, t) - 1))
    return index + (t - beats[index]) / (beats[index + 1] - beats[index])


def rest_metrics(node, model, lead, source, result):
    if lead is None:
        return {"available": False, "reason": "no_lead_chart"}
    payload = {"modelPath": str(model), "lead": lead, "beats": source["beats"],
               "duration": source["duration"], "result": result}
    completed = subprocess.run([node, "-e", NODE_HELPER], input=json.dumps(payload),
                               capture_output=True, text=True, encoding="utf-8", check=True)
    rendered = json.loads(completed.stdout)
    coordinate = lambda t: beat_at(source["beats"], t)
    metrics = {"available": True, "arrangement_id": lead["id"], "mode": rendered["mode"],
               "qualifying_windows": rendered["windows"], "guidance_spans": rendered["spans"]}
    for category, windows in (("all", rendered["windows"]), ("interior", [w for w in rendered["windows"]
                               if w["start"] > 0 and w.get("reentry")])):
        total = sum(coordinate(w["end"]) - coordinate(w["start"]) for w in windows)
        item = {"rest_beats": round(total, 4)}
        for kind, spans in rendered["spans"].items():
            covered = sum(coordinate(min(w["end"], s["end"])) - coordinate(max(w["start"], s["start"]))
                          for w in windows for s in spans if min(w["end"], s["end"]) > max(w["start"], s["start"]))
            item[kind + "_beats"] = round(covered, 4)
            item[kind + "_coverage"] = round(covered / total, 4) if total else None
        item["any_guide_coverage"] = round((item["scale_beats"] + item["chord_tones_beats"]) / total, 4) if total else None
        metrics[category] = item
    return metrics


def invariant_checks(engine, result):
    bounds, invented, conflicts = [], [], []
    for track in ("keys", "harmony", "scales"):
        previous = 0
        for event in result[track]["events"]:
            if abs(event["t"] - previous) > 1e-5 or event["end"] <= event["t"] or event["end"] > result["duration"] + 1e-5:
                bounds.append({"track": track, "t": event["t"]})
            previous = event["end"]
        if abs(previous - result["duration"]) > 1e-5:
            bounds.append({"track": track, "missing_end": previous})
    for event in result["harmony"]["events"]:
        if event.get("unknown"):
            continue
        missing = set(event.get("chord_tones", [])) - set(event.get("evidence", {}).get("observed_pcs", []))
        if missing:
            invented.append({"t": event["t"], "end": event["end"], "unobserved_pcs": sorted(missing)})
    for scale in result["scales"]["events"]:
        if scale.get("unknown"):
            continue
        tones = {(engine.pitch_class(scale["root"]) + i) % 12 for i in engine.SCALES[scale["type"]]}
        for chord in result["harmony"]["events"]:
            if chord.get("unknown") or min(scale["end"], chord["end"]) <= max(scale["t"], chord["t"]):
                continue
            if not set(chord["chord_tones"]) <= tones:
                conflicts.append({"t": max(scale["t"], chord["t"])})
    return {"bounds": bounds, "unobserved_chord_tones": invented, "scale_chord_conflicts": conflicts}


def reference_checks(engine, source, result, references):
    rows = []
    for reference in references:
        if reference["title"] != source["title"]:
            continue
        t = reference["t"]
        exact = lambda event: (not event.get("unknown") and engine.pitch_class(event.get("root")) == engine.pitch_class(reference["root"])
                               and event.get("quality") == reference["quality"] and (not reference.get("bass")
                               or engine.pitch_class(event.get("bass")) == engine.pitch_class(reference["bass"])))
        current = next((e for e in result["harmony"]["events"] if e["t"] <= t + .01 < e["end"]), {})
        matching = [e for e in result["harmony"]["events"] if exact(e)]
        nearest = min(matching, key=lambda e: abs(e["t"] - t)) if matching else None
        error = abs(beat_at(source["beats"], nearest["t"]) - beat_at(source["beats"], t)) if nearest and reference.get("boundary") else None
        rows.append({**reference, "full_chord_match": exact(current), "boundary_error_beats": error})
    return rows


def aggregate_metrics(rows, engines):
    aggregate = {}
    for label in engines:
        selected = [r["engines"][label] for r in rows]
        aggregate[label] = {"version": engines[label].ALGORITHM_VERSION, "songs": len(rows),
            "cold_median_ms": statistics.median(r["cold_ms"] for r in selected),
            "engine_median_ms": statistics.median(r["engine_ms"] for r in selected),
            "invariants": {kind: sum(len(r["checks"][kind]) for r in selected)
                           for kind in ("bounds", "unobserved_chord_tones", "scale_chord_conflicts")},
            "references": {"points": sum(len(r["references"]) for r in selected),
                           "full_chord_matches": sum(p["full_chord_match"] for r in selected for p in r["references"])}}
        for category in ("all", "interior"):
            rests = [r["rests"][category] for r in selected if r["rests"]["available"]]
            total = sum(r["rest_beats"] for r in rests)
            aggregate[label][category] = {"rest_beats": total, **{kind + "_coverage":
                sum(r[kind + "_beats"] for r in rests) / total if total else None
                for kind in ("scale", "chord_tones", "full_guide")}}
            aggregate[label][category]["any_guide_coverage"] = (
                sum(r["scale_beats"] + r["chord_tones_beats"] for r in rests) / total if total else None)
    return aggregate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="JSON with songs: [{path, cohort, arrangement_id?}]")
    parser.add_argument("--output", type=Path, required=True, help="New directory; existing output is never overwritten")
    parser.add_argument("--baseline-module", type=Path, help="Frozen old harmony_analysis.py, e.g. v2")
    parser.add_argument("--candidate-module", type=Path, default=REPO / "lib/harmony_analysis.py",
                        help="Optional isolated research engine; production is the default")
    parser.add_argument("--candidate-options", type=json.loads, default={},
                        help="JSON object of research options, recorded with the frozen run")
    parser.add_argument("--references", type=Path, default=REPO / "tools/harmony_reference_points.json")
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    if not isinstance(args.candidate_options, dict):
        parser.error("--candidate-options must be a JSON object")
    if not args.node:
        parser.error("Node is required for the real browser rest/guidance model")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    args.output.mkdir(parents=True, exist_ok=False)
    references = json.loads(args.references.read_text(encoding="utf-8"))
    if not manifest.get("songs"):
        parser.error("Manifest must contain at least one song")
    current_path = args.output / "current-engine.py"
    model_path = args.output / "browser-model.mjs"
    shutil.copyfile(REPO / "lib/harmony_analysis.py", args.output / "production-engine.py")
    shutil.copyfile(args.candidate_module, current_path)
    shutil.copyfile(REPO / "static/js/harmony-guide-model.js", model_path)
    shutil.copyfile(REPO / "lib/harmony_source.py", args.output / "source-adapter.py")
    shutil.copyfile(Path(__file__), args.output / "evaluator.py")
    engines = {"current": load_engine(current_path, "evaluation_current")}
    if args.baseline_module:
        baseline_path = args.output / "baseline-engine.py"
        shutil.copyfile(args.baseline_module, baseline_path)
        engines = {"baseline": load_engine(baseline_path, "evaluation_baseline"), **engines}
    definition = {"started_utc": datetime.now(timezone.utc).isoformat(), "classification": "development/regression only",
                  "candidate_options": args.candidate_options,
                  "accuracy_claim": False, "audio_read_or_listened": False, "manifest": manifest,
                  "code_sha256": {p.name: digest(p) for p in args.output.iterdir() if p.is_file()},
                  "method": "Same normalized input and frozen current browser model for both engines; coverage is not correctness. No OS-cache flush. Cold timings exclude browser, writes and queue wait."}
    write(args.output / "run-definition.json", definition)
    write(args.output / "reference-points.json", references)
    rows = []
    for index, entry in enumerate(manifest["songs"]):
        path = Path(entry["path"])
        stat_before = (path.stat().st_size, path.stat().st_mtime_ns)
        started = time.perf_counter()
        source = load_harmony_source(path)
        source_ms = (time.perf_counter() - started) * 1000
        lead = lead_chart(path, source, entry.get("arrangement_id"))
        row = {"path": str(path), "song": source["artist"] + " — " + source["title"],
               "cohort": entry.get("cohort", "development"), "duration": source["duration"],
               "revision": source["revision"], "fingerprint": source["fingerprint"], "source_ms": round(source_ms, 2), "engines": {}}
        for label, engine in engines.items():
            started = time.perf_counter()
            result = engine.analyse_harmony(source, options=args.candidate_options) if label == "current" else engine.analyse_harmony(source)
            engine_ms = (time.perf_counter() - started) * 1000
            write(args.output / f"{index + 1:03d}-{label}.json", result)
            row["engines"][label] = {"version": engine.ALGORITHM_VERSION, "engine_ms": round(engine_ms, 2),
                "cold_ms": round(source_ms + engine_ms, 2), "summary": result["summary"],
                "keys": result["keys"]["events"], "checks": invariant_checks(engine, result),
                "references": reference_checks(engine, source, result, references),
                "rests": rest_metrics(args.node, model_path, lead, source, result)}
        if stat_before != (path.stat().st_size, path.stat().st_mtime_ns):
            raise RuntimeError(f"Source changed during evaluation: {path}")
        rows.append(row)
        write(args.output / "songs-summary.json", rows)
        print(json.dumps({"completed": index + 1, "song": row["song"]}), flush=True)
    aggregate = aggregate_metrics(rows, engines)
    cohorts = {cohort: aggregate_metrics([r for r in rows if r["cohort"] == cohort], engines)
               for cohort in sorted({r["cohort"] for r in rows})}
    if digest(REPO / "lib/harmony_source.py") != definition["code_sha256"]["source-adapter.py"]:
        raise RuntimeError("Source adapter changed during evaluation; results are incomplete")
    write(args.output / "summary.json", {"songs": len(rows), "classification": definition["classification"],
                                         "engines": aggregate, "cohorts": cohorts})
    lines = ["# Chart harmony development comparison", "", "Coverage is availability, not musical accuracy. No audio was read or listened to.", "",
             "Both engines use identical normalized charts and the frozen current browser model. Baseline chord fallback therefore represents the new UI applied to the old engine, not the old UI.", "",
             "| Song | Version | Unobserved chord-tone windows | Interior scale coverage | Interior chord fallback coverage |", "|---|---|---:|---:|---:|"]
    for row in rows:
        for label, value in row["engines"].items():
            rests = value["rests"].get("interior", {})
            pct = lambda name: "n/a" if rests.get(name) is None else f"{rests[name] * 100:.1f}%"
            lines.append(f"| {row['song']} | {value['version']} | {len(value['checks']['unobserved_chord_tones'])} | {pct('scale_coverage')} | {pct('chord_tones_coverage')} |")
    lines.extend(["", "See summary.json for aggregate coverage and invariant counts; songs-summary.json for references, timelines, denominators and timing. New independently reviewed references are required for musical-accuracy claims.", ""])
    (args.output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"complete": str(args.output), "aggregate": aggregate}), flush=True)


if __name__ == "__main__":
    main()
