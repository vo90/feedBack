"""Compare grounded chart harmony against independent timed chord annotations.

Scores all previously selected annotation regions, not just lead rests. This is
annotation agreement, not an audio or musical-suitability test. Never use the
annotation to modify predictions. Inputs and evaluator helpers are frozen.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re

try:
    from . import evaluate_harmony_phrase_chords as chord_reference
except ImportError:
    import evaluate_harmony_phrase_chords as chord_reference


def validate_timeline(events, duration):
    previous = 0
    for event in events:
        start, end = event["t"], event["end"]
        if (not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                    and math.isfinite(value) for value in (start, end))
                or start < previous or end <= start or end > duration):
            raise ValueError("Harmony timeline must be finite, ordered and bounded")
        previous = end


def harmony_state(event, reference):
    if not event or event.get("unknown"):
        return {"known": False, "reason": (event or {}).get("evidence", {}).get("reason")}
    pcs = event.get("grounded_chord_tones", [])
    if (not pcs or any(not isinstance(pc, int) or isinstance(pc, bool)
                       or not 0 <= pc <= 11 for pc in pcs)):
        raise ValueError("Known harmony needs explicit grounded pitch classes")
    pcs, reference_pcs = set(pcs), set(reference["pitch_classes"])
    root = chord_reference.parse_chord(event.get("root", "?"))
    if root["status"] != "supported":
        raise ValueError("Known harmony needs a supported root spelling")
    root_pc = root["root_pc"]
    root_grounded = root_pc in pcs and event.get("evidence", {}).get("root_observed", True)
    return {"known": True, "root_pc": root_pc, "root_grounded": bool(root_grounded),
            "root_agrees": bool(root_grounded and root_pc == reference["root_pc"]),
            "root_in_reference": bool(root_grounded and root_pc in reference_pcs),
            "pitch_classes": sorted(pcs), "outside_annotation": sorted(pcs - reference_pcs),
            "missing_annotation": sorted(reference_pcs - pcs),
            "reference_root_pc": reference["root_pc"],
            "label": event.get("display_label"), "quality": event.get("quality"),
            "confidence": event.get("confidence"),
            "observed_pitch_classes": event.get("evidence", {}).get("observed_pcs"),
            "kind": "root_only" if len(pcs) == 1 else "multi_note"}


def add_state_metrics(totals, state, length, reference):
    if not state["known"]:
        totals["unknown_harmony_seconds"] += length
        return
    # Separate root-only candidates from informative multi-note harmony. Root
    # agreement is counted only if that root is actually grounded in the chart.
    for prefix in ("", state["kind"] + "_"):
        totals[prefix + "known_harmony_seconds"] += length
        totals[prefix + ("outside_annotation_seconds" if state["outside_annotation"]
                         else "subset_of_annotation_seconds")] += length
        if not state["missing_annotation"]:
            totals[prefix + "contains_annotated_chord_seconds"] += length
        if not state["outside_annotation"] and not state["missing_annotation"]:
            totals[prefix + "exact_pitch_set_seconds"] += length
        totals[prefix + "grounded_tone_seconds"] += length * len(state["pitch_classes"])
        totals[prefix + "outside_annotation_tone_seconds"] += length * len(state["outside_annotation"])
        totals[prefix + "annotated_tone_seconds"] += length * len(reference["pitch_classes"])
        totals[prefix + "missing_annotation_tone_seconds"] += length * len(state["missing_annotation"])
        if state["root_grounded"]:
            totals[prefix + "grounded_root_seconds"] += length
            if state["root_agrees"]:
                totals[prefix + "root_agreement_seconds"] += length
            totals[prefix + ("root_in_annotation_seconds" if state["root_in_reference"]
                             else "root_outside_annotation_seconds")] += length
    totals["confidence_" + str(state["confidence"]) + "_seconds"] += length


def rates(totals):
    pairs = {"known_harmony_fraction": ("known_harmony_seconds", "scorable_seconds"),
             "subset_fraction": ("subset_of_annotation_seconds", "known_harmony_seconds"),
             "root_agreement_fraction": ("root_agreement_seconds", "grounded_root_seconds"),
             "multi_note_root_agreement_fraction": ("multi_note_root_agreement_seconds", "multi_note_grounded_root_seconds")}
    result = {name: totals.get(a, 0) / totals[b] if totals.get(b) else None
              for name, (a, b) in pairs.items()}
    for name, outside, denominator in (
            ("grounded_tone_precision", "outside_annotation_tone_seconds", "grounded_tone_seconds"),
            ("annotated_tone_recall", "missing_annotation_tone_seconds", "annotated_tone_seconds")):
        result[name] = 1 - totals.get(outside, 0) / totals[denominator] if totals.get(denominator) else None
    return result


def score_harmony(chords, scope, baseline, current, duration):
    """Score two timelines on an identical externally selected time mask."""
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or duration <= 0:
        raise ValueError("Duration must be positive and finite")
    for events in (baseline, current):
        validate_timeline(events, duration)
    tracks = [chords, scope, baseline, current]
    edges = {0, duration}
    edges.update(v for events in tracks for e in events for v in (e["t"], e["end"]) if 0 <= v <= duration)
    edges.update(v for e in chords for v in (e["safe_start"], e["safe_end"]) if 0 <= v <= duration)
    chord_at, scope_at, before_at, after_at = map(chord_reference._lookup, tracks)
    totals = {label: Counter() for label in ("baseline", "current")}
    common, changes, transitions, unsupported = Counter(), [], Counter(), Counter()
    edges = sorted(edges)
    for start, end in zip(edges, edges[1:]):
        t, length = (start + end) / 2, end - start
        if not scope_at(t):
            continue
        common["annotated_scope_seconds"] += length
        chord = chord_at(t)
        if chord is None:
            common["discarded_no_annotation_seconds"] += length
            continue
        if not chord["safe_start"] <= t < chord["safe_end"]:
            common["discarded_boundary_uncertainty_seconds"] += length
            continue
        if chord["status"] != "supported":
            common[f"discarded_{chord['status']}_seconds"] += length
            if chord["status"] == "unsupported":
                unsupported[chord["label"]] += length
            continue
        common["scorable_seconds"] += length
        before, after = (harmony_state(finder(t), chord) for finder in (before_at, after_at))
        for label, state in (("baseline", before), ("current", after)):
            add_state_metrics(totals[label], state, length, chord)
        # Compare only musical/provenance states, so changes in diagnostic scores
        # cannot masquerade as changed harmony. Report low-confidence results too.
        if before == after:
            continue
        if not before["known"] and after["known"]:
            transition = "unknown_to_annotation_disagreement" if after["outside_annotation"] else "unknown_to_annotation_subset"
        elif before["known"] and not after["known"]:
            transition = "known_to_unknown"
        elif not before["known"]:
            continue
        else:
            transition = "known_to_known"
            if before["root_pc"] != after["root_pc"]:
                transitions["changed_root_seconds"] += length
            if before["pitch_classes"] != after["pitch_classes"]:
                transitions["changed_pitch_set_seconds"] += length
        transitions[transition + "_seconds"] += length
        chord_reference._append_passage(changes, {"t":start, "end":end,
            "reference_chord":chord["label"], "reference_pitch_classes":chord["pitch_classes"],
            "transition":transition, "baseline":before, "current":after})
    return {"common":dict(common),
            "engines":{label:{"totals":dict(common + values), "rates":rates(common + values)}
                       for label, values in totals.items()},
            "transitions":dict(transitions), "changed_passages":changes,
            "unsupported_labels_scored_seconds":dict(unsupported)}


def run(comparison, chord_directory, output):
    inputs = output.with_name(output.name + ".inputs")
    if output.exists() or inputs.exists():
        raise FileExistsError("Output and its .inputs directory must both be new")
    frozen = {}

    def read(path, name):
        frozen[name] = path.read_bytes()
        return frozen[name].decode("utf-8-sig")

    manifest = json.loads(read(comparison / "manifest.json", "manifest.json"))
    references_text = read(comparison / "references.json", "references.json")
    references = json.loads(references_text)
    hashes = {hashlib.sha256(frozen["references.json"]).hexdigest(),
              hashlib.sha256(references_text.encode("utf-8")).hexdigest()}
    if manifest.get("reference_sha256") not in hashes:
        raise ValueError("References differ from the frozen selection manifest")
    read(Path(__file__), "evaluate_harmony_chord_evidence.py")
    read(Path(chord_reference.__file__), "evaluate_harmony_phrase_chords.py")
    for name in ("run-definition.json", "baseline-engine.py", "current-engine.py", "source-adapter.py"):
        read(comparison / name, name)
    by_id = {song["id"]:song for song in references["songs"]}
    songs, aggregates, transitions = [], {label:Counter() for label in ("baseline", "current")}, Counter()
    for entry in manifest["songs"]:
        sid = entry["id"]
        if not re.fullmatch(r"[a-z0-9_-]+", sid):
            raise ValueError("Unsafe song ID")
        chords = chord_reference.aligned_chords(
            read(chord_directory / (sid + "-chordlab.txt"), sid + "-chordlab.txt"), entry["alignment"])
        scope = chord_reference.aligned_scope(by_id[sid], entry["alignment"])
        predictions = {label:json.loads(read(comparison / f"{sid}-{label}.json", f"{sid}-{label}.json"))
                       for label in ("baseline", "current")}
        if predictions["baseline"]["duration"] != predictions["current"]["duration"]:
            raise ValueError("Both engines must describe the same duration")
        scored = score_harmony(chords, scope, predictions["baseline"]["harmony"]["events"],
                               predictions["current"]["harmony"]["events"], predictions["baseline"]["duration"])
        for label in aggregates:
            aggregates[label].update(scored["engines"][label]["totals"])
        transitions.update(scored["transitions"])
        songs.append({"id":sid,"title":by_id[sid]["title"], **scored})
    result = {"created_utc":datetime.now(timezone.utc).isoformat(), "audio_listened":False,
        "method":"Grounded observed pitch sets and grounded roots against independent timed chords throughout the preselected key-reference regions. Both engines share one duration-bounded mask; declared chord-boundary uncertainty, unsupported labels, unknown and N.C. excluded. Root-only candidates reported separately from multi-note harmony.",
        "limitations":"Agreement is not definitive musical correctness: coarse annotations can omit extensions and suspensions; different arrangements may contain valid additional notes. Missing reference tones need not be erroneous in a partial voicing. No listening, and no claim that all suggested scale notes are suitable. Reference scopes may cover only part of a song. These results do not measure render eligibility.",
        "comparison":str(comparison.resolve()), "frozen_inputs_directory":inputs.name,
        "input_sha256":{name:hashlib.sha256(data).hexdigest() for name,data in frozen.items()},
        "aggregate":{label:{"totals":dict(values),"rates":rates(values)} for label,values in aggregates.items()},
        "transitions":dict(transitions), "songs":songs}
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
    args = parser.parse_args()
    result = run(args.comparison, args.chord_directory, args.output)
    print(json.dumps({"output":str(args.output),"aggregate":result["aggregate"],"transitions":result["transitions"]}))


if __name__ == "__main__":
    main()
