"""Compare eligible rest guidance with independent, aligned chord annotations.

This is annotation agreement, not an audio listening or scale-suitability test.
The input comparison must be a frozen evaluate_harmony_modulations.py result.
Only a new JSON output and its new sibling .inputs directory are written.
"""

import argparse
from bisect import bisect_right
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess


QUALITIES = {
    "": ("1", "3", "5"), "maj": ("1", "3", "5"),
    "min": ("1", "b3", "5"), "dim": ("1", "b3", "b5"),
    "aug": ("1", "3", "#5"), "sus2": ("1", "2", "5"),
    "sus4": ("1", "4", "5"), "7": ("1", "3", "5", "b7"),
    "maj7": ("1", "3", "5", "7"), "min7": ("1", "b3", "5", "b7"),
    "minmaj7": ("1", "b3", "5", "7"), "dim7": ("1", "b3", "b5", "bb7"),
    "hdim7": ("1", "b3", "b5", "b7"), "maj6": ("1", "3", "5", "6"),
    "min6": ("1", "b3", "5", "6"), "9": ("1", "3", "5", "b7", "9"),
    "maj9": ("1", "3", "5", "7", "9"), "min9": ("1", "b3", "5", "b7", "9"),
    "11": ("1", "3", "5", "b7", "9", "11"),
    "min11": ("1", "b3", "5", "b7", "9", "11"),
    "13": ("1", "3", "5", "b7", "9", "11", "13"),
    "min13": ("1", "b3", "5", "b7", "9", "11", "13"),
}


def degree_pc(degree):
    match = re.fullmatch(r"([b#]*)([1-9]|1[0-3])", degree)
    if not match or ("b" in match[1] and "#" in match[1]):
        raise ValueError("unsupported interval")
    return ((0, 2, 4, 5, 7, 9, 11)[(int(match[2]) - 1) % 7]
            + match[1].count("#") - match[1].count("b")) % 12


def parse_chord(label, transposition=0):
    """Strict Harte subset; unknown syntax never silently becomes a triad."""
    if label in ("N", "N.C.", "NC"):
        return {"status": "no_chord", "label": label}
    if label in ("X", "?", "UNK"):
        return {"status": "unknown", "label": label}
    match = re.fullmatch(r"([A-G])([b#]*)(?::([^/]*))?(?:/([^/]+))?", label)
    if not match or ("b" in match[2] and "#" in match[2]):
        return {"status": "unsupported", "label": label}
    root = (dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[match[1]]
            + match[2].count("#") - match[2].count("b") + transposition) % 12
    suffix = match[3]
    try:
        if suffix is None:
            intervals = {0, 4, 7}
        else:
            parts = re.fullmatch(r"([^()]*)(?:\(([^()]*)\))?", suffix)
            if not parts or (not parts[1] and parts[2] is None):
                raise ValueError("empty or malformed chord quality")
            quality, alterations = parts.groups()
            if quality not in QUALITIES:
                raise ValueError("unsupported quality")
            # C:(1,b3,5) is an explicit set; C:7(b9,*5) modifies a shorthand.
            intervals = set() if not quality and alterations is not None else {
                degree_pc(value) for value in QUALITIES[quality]}
            if alterations is not None:
                if not alterations:
                    raise ValueError("empty interval list")
                for value in alterations.split(","):
                    if value.startswith("*"):
                        intervals.discard(degree_pc(value[1:]))
                    else:
                        intervals.add(degree_pc(value))
        if match[4] is not None:
            intervals.add(degree_pc(match[4]))
        if not intervals:
            raise ValueError("empty pitch collection")
    except ValueError:
        return {"status": "unsupported", "label": label}
    return {"status": "supported", "label": label, "root_pc": root,
            "pitch_classes": sorted((root + value) % 12 for value in intervals)}


def alignment_values(alignment):
    if alignment.get("verified") is not True or not alignment.get("method"):
        raise ValueError("A verified alignment and method are required")
    values = [float(alignment.get(name, default)) for name, default in
              (("chart_offset", 0), ("reference_offset", 0), ("rate", 1),
               ("uncertainty_seconds", float("nan")))]
    transpose = alignment.get("pitch_transposition_semitones")
    if (not all(math.isfinite(v) for v in values) or values[2] <= 0 or values[3] < 0
            or not isinstance(transpose, int) or isinstance(transpose, bool)):
        raise ValueError("Explicit finite timing uncertainty and integer transposition are required")
    return (*values, transpose)


def aligned_chords(text, alignment):
    offset, origin, rate, uncertainty, transpose = alignment_values(alignment)
    events, previous = [], -math.inf
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        fields = line.split()
        if len(fields) != 3:
            raise ValueError(f"Malformed chord annotation line {line_number}")
        start, end = map(float, fields[:2])
        if not all(map(math.isfinite, (start, end))) or start < previous or end <= start:
            raise ValueError(f"Unordered or invalid chord annotation line {line_number}")
        previous = end
        start, end = offset + (start - origin) * rate, offset + (end - origin) * rate
        events.append({**parse_chord(fields[2], transpose), "t": start, "end": end,
                       "safe_start": start + uncertainty, "safe_end": end - uncertainty})
    return events


def aligned_scope(song, alignment):
    offset, origin, rate, _, _ = alignment_values(alignment)
    events, previous = [], -math.inf
    for segment in song["segments"]:
        start, end = float(segment["start"]), float(segment["end"])
        if not all(map(math.isfinite, (start, end))) or start < previous or end <= start:
            raise ValueError("Invalid reference scope")
        previous = end
        if segment["keys"]:
            events.append({"t": offset + (start - origin) * rate,
                           "end": offset + (end - origin) * rate})
    return events


def _lookup(events):
    starts = [e["t"] for e in events]

    def find(t):
        index = bisect_right(starts, t) - 1
        event = events[index] if index >= 0 else None
        return event if event and t < event["end"] else None
    return find


def _append_passage(passages, passage):
    if (passages and abs(passages[-1]["end"] - passage["t"]) < 1e-8
            and {k: v for k, v in passages[-1].items() if k not in ("t", "end")}
            == {k: v for k, v in passage.items() if k not in ("t", "end")}):
        passages[-1]["end"] = passage["end"]
    else:
        passages.append(passage)


def score_guidance(chords, scope, windows, guidance):
    """Duration-weighted independent chord agreement on eligible interior rests."""
    windows = [{"t": w["start"], "end": w["end"]} for w in windows
               if w["start"] > 0 and w.get("reentry")]
    tracks = [chords, scope, windows, guidance]
    edges = {v for events in tracks for e in events for v in (e["t"], e["end"])}
    edges.update(v for e in chords for v in (e["safe_start"], e["safe_end"]))
    edges = sorted(edges)
    chord_at, scope_at, window_at, guide_at = map(_lookup, tracks)
    totals, passages, unsupported = Counter(), [], Counter()
    for start, end in zip(edges, edges[1:]):
        t, length = (start + end) / 2, end - start
        if not scope_at(t) or not window_at(t):
            continue
        totals["reference_rest_seconds"] += length
        chord = chord_at(t)
        if chord is None:
            totals["discarded_no_annotation_seconds"] += length
            continue
        if not chord["safe_start"] <= t < chord["safe_end"]:
            totals["discarded_boundary_uncertainty_seconds"] += length
            continue
        if chord["status"] != "supported":
            totals[f"discarded_{chord['status']}_seconds"] += length
            if chord["status"] == "unsupported":
                unsupported[chord["label"]] += length
            continue
        totals["scorable_rest_seconds"] += length
        guide = guide_at(t)
        if not guide or guide["kind"] == "none":
            totals["no_guidance_seconds"] += length
            continue
        kind = guide["kind"]
        if kind not in ("scale", "chord_tones"):
            raise ValueError("Unsupported guidance kind")
        pcs, reference = set(guide["pitch_classes"]), set(chord["pitch_classes"])
        totals["guidance_seconds"] += length
        totals[kind + "_seconds"] += length
        target = guide.get("target_pc")
        if target is not None:
            totals["target_seconds"] += length
            if target == chord["root_pc"]:
                totals["target_root_agreement_seconds"] += length
            if target in reference:
                totals["target_in_chord_seconds"] += length
            else:
                totals["target_outside_chord_seconds"] += length
        missing = sorted(reference - pcs) if kind == "scale" else []
        outside = sorted(pcs - reference) if kind == "chord_tones" else []
        chart_pcs = guide.get("chart_grounded_pitch_classes")
        absent_from_chart = sorted(reference - set(chart_pcs)) if chart_pcs is not None else None
        if absent_from_chart:
            totals["annotated_chord_tones_absent_from_chart_seconds"] += length
        if kind == "scale":
            totals["scale_annotated_chord_tone_seconds"] += length * len(reference)
            totals["scale_missing_annotated_chord_tone_seconds"] += length * len(missing)
            totals["scale_missing_chord_tones_seconds" if missing else
                   "scale_contains_annotated_chord_seconds"] += length
        else:
            totals["fallback_tone_seconds"] += length * len(pcs)
            totals["fallback_outside_chord_tone_seconds"] += length * len(outside)
            totals["fallback_outside_chord_seconds" if outside else
                   "fallback_subset_of_annotated_chord_seconds"] += length
        _append_passage(passages, {"t": start, "end": end, "reference_chord": chord["label"],
            "reference_pitch_classes": sorted(reference), "kind": kind,
            "pitch_classes": sorted(pcs), "target_pc": target,
            "target_is_reference_root": target == chord["root_pc"],
            "target_in_reference_chord": target in reference,
            "missing_annotated_chord_tones": missing, "fallback_outside_annotated_chord": outside,
            "chart_chord_label": guide.get("chart_chord_label"),
            "chart_chord_quality": guide.get("chart_chord_quality"),
            "chart_grounded_pitch_classes": chart_pcs,
            "annotated_chord_tones_absent_from_chart": absent_from_chart})
    return {"totals": dict(totals), "rates": rates(totals), "passages": passages,
            "unsupported_labels_scored_seconds": dict(unsupported),
            "scored_guidance_passage_count": len(passages)}


def rates(totals):
    pairs = {"guidance_coverage": ("guidance_seconds", "scorable_rest_seconds"),
        "scale_missing_chord_tones_fraction": ("scale_missing_chord_tones_seconds", "scale_seconds"),
        "target_root_agreement_fraction": ("target_root_agreement_seconds", "target_seconds"),
        "target_chord_containment_fraction": ("target_in_chord_seconds", "target_seconds"),
        "fallback_outside_chord_fraction": ("fallback_outside_chord_seconds", "chord_tones_seconds")}
    return {name: totals.get(a, 0) / totals[b] if totals.get(b) else None
            for name, (a, b) in pairs.items()}


NODE_GUIDANCE = r"""
const fs=require('fs'); const {pathToFileURL}=require('url');
(async()=>{
 const input=JSON.parse(fs.readFileSync(0,'utf8'));
 const model=await import(pathToFileURL(input.model).href);
 const timeline=model.createHarmonyTimeline({generated:input.result});
 const edges=[...new Set([0,input.result.duration,...['keys','harmony','scales']
   .flatMap(k=>input.result[k].events.flatMap(e=>[e.t,e.end]))])].sort((a,b)=>a-b);
 const rows=[];
 for(let i=0;i<edges.length-1;i++){
   const s=model.resolveHarmony(timeline,(edges[i]+edges[i+1])/2);
   let kind='none', pcs=[];
   if(s.scale && s.targetPc!==null && s.confidence.harmony!=='low') {
     kind='scale'; pcs=s.guidance.pitchClasses;
   } else if(s.guidance?.kind==='chord_tones') {kind='chord_tones'; pcs=s.guidance.pitchClasses;}
   rows.push({t:edges[i],end:edges[i+1],kind,pitch_classes:pcs,target_pc:s.targetPc,
     chart_chord_label:s.current?.label??null, chart_chord_quality:s.current?.quality??null,
     chart_grounded_pitch_classes:s.current?.groundedPitchClasses??null});
 }
 process.stdout.write(JSON.stringify(rows));
})().catch(e=>{process.stderr.write(e.stack);process.exit(1)});
"""


def browser_guidance(node, model, result):
    completed = subprocess.run([node, "-e", NODE_GUIDANCE],
        input=json.dumps({"model": str(model.resolve()), "result": result}),
        capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(completed.stdout)


def changed_passages(baseline, current):
    edges = sorted({v for rows in (baseline, current) for e in rows for v in (e["t"], e["end"])})
    before_at, after_at = _lookup(baseline), _lookup(current)
    rows = []
    for start, end in zip(edges, edges[1:]):
        before, after = before_at((start + end) / 2), after_at((start + end) / 2)
        before = {k: v for k, v in before.items() if k not in ("t", "end")} if before else None
        after = {k: v for k, v in after.items() if k not in ("t", "end")} if after else None
        if before != after:
            _append_passage(rows, {"t": start, "end": end, "baseline": before, "current": after})
    return rows


def run(comparison, chord_directory, output, node):
    inputs = output.with_name(output.name + ".inputs")
    if output.exists() or inputs.exists():
        raise FileExistsError("Output and its .inputs directory must both be new")
    frozen = {}

    def read(path, name):
        data = path.read_bytes()
        frozen[name] = data
        return data.decode("utf-8-sig")

    manifest = json.loads(read(comparison / "manifest.json", "manifest.json"))
    references = json.loads(read(comparison / "references.json", "references.json"))
    summaries = json.loads(read(comparison / "songs-summary.json", "songs-summary.json"))
    read(comparison / "browser-model.mjs", "browser-model.mjs")
    read(Path(__file__), "chord-evaluator.py")
    ref_by_id, summary_by_id = ({s["id"]: s for s in rows} for rows in
                                (references["songs"], summaries))
    songs, aggregate = [], {label: Counter() for label in ("baseline", "current")}
    for entry in manifest["songs"]:
        sid = entry["id"]
        if not re.fullmatch(r"[a-z0-9_-]+", sid):
            raise ValueError("Unsafe song ID")
        text = read(chord_directory / (sid + "-chordlab.txt"), sid + "-chordlab.txt")
        chords = aligned_chords(text, entry["alignment"])
        scope = aligned_scope(ref_by_id[sid], entry["alignment"])
        summary = summary_by_id[sid]
        song = {"id": sid, "title": summary["title"], "alignment": entry["alignment"],
                "chord_label_status_counts": dict(Counter(e["status"] for e in chords)),
                "engines": {}}
        for label in ("baseline", "current"):
            name = f"{sid}-{label}.json"
            result = json.loads(read(comparison / name, name))
            rest = summary["engines"][label]["rests"]
            if not rest.get("available"):
                raise ValueError("Rest data is unavailable: " + sid)
            guidance = browser_guidance(node, comparison / "browser-model.mjs", result)
            metrics = score_guidance(chords, scope, rest["qualifying_windows"], guidance)
            song["engines"][label] = metrics
            aggregate[label].update(metrics["totals"])
        song["changed_passages"] = changed_passages(
            song["engines"]["baseline"]["passages"], song["engines"]["current"]["passages"])
        songs.append(song)
    result = {"created_utc": datetime.now(timezone.utc).isoformat(), "audio_listened": False,
        "method": "Independent chord annotation agreement, duration weighted on reference-covered interior lead rests; frozen browser eligibility and pitch sets; declared chart-time alignment uncertainty excluded at every chord boundary.",
        "limitations": "Chord containment does not establish scale suitability. Reference disagreement is not confirmed error: coarse annotations may omit suspensions, reference chord tones can be absent from a chart, and arrangements may differ. Review the chart chord quality and grounded notes beside every disagreement. Unsupported, unknown and no-chord annotations are unscored. Coverage is model eligibility before fades, not rendered pixels. These songs are development data.",
        "comparison": str(comparison.resolve()), "frozen_inputs_directory": inputs.name,
        "input_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in frozen.items()},
        "aggregate": {label: {"totals": dict(totals), "rates": rates(totals)}
                      for label, totals in aggregate.items()}, "songs": songs}
    output.parent.mkdir(parents=True, exist_ok=True)
    inputs.mkdir(exist_ok=False)
    for name, data in frozen.items():
        with (inputs / name).open("xb") as handle:
            handle.write(data)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=False, allow_nan=False)
        handle.write("\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comparison", type=Path, required=True)
    parser.add_argument("--chord-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    if not args.node:
        parser.error("Node is required to read actual guidance from the frozen browser model")
    result = run(args.comparison, args.chord_directory, args.output, args.node)
    print(json.dumps({"output": str(args.output), "aggregate": result["aggregate"]}))


if __name__ == "__main__":
    main()
