"""Read-only archive audit; compare load-time anchors with FeedForge's policy."""
import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.generated_guidance_compat import refresh_generated_positions
from lib.generated_hand_positions import POSITION_POLICY, generate_positions


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--feedforge-source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    source = args.feedforge_source / "src/feedback_converter"
    local = Path(__file__).resolve().parents[1] / "lib/generated_hand_positions.py"
    assert local.read_bytes() == (source / local.name).read_bytes(), "Policy copies diverged"
    spec = importlib.util.spec_from_file_location("independent_checks", source / "verify_chart_guidance.py")
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    results = []
    for path in sorted(args.library.glob("*.feedpak")):
        before = sha(path)
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if not name.startswith("arrangements/") or not name.endswith(".json"):
                    continue
                chart = json.loads(archive.read(name))
                original = deepcopy(chart)
                start = time.perf_counter()
                refreshed = refresh_generated_positions(chart)
                elapsed = (time.perf_counter() - start) * 1000
                assert chart == original, "Loader mutated source"
                proof = chart.get("ext", {}).get("chartGuidance", {})
                if proof.get("sourceAuthored") is not False or "anchors" not in proof.get("fields", []):
                    continue
                expected = generate_positions(chart)
                assert refreshed["anchors"] == expected, (path.name, name, "Policy mismatch")
                checked = deepcopy(chart)
                checked["anchors"] = expected
                proof = checked["ext"]["chartGuidance"]
                proof["positionPolicy"] = POSITION_POLICY
                proof["slidePolicy"] = "timed-known-slides"
                proof["guidanceSha256"] = digest({k: checked[k] for k in proof["fields"]})
                proof["wideAnchorCount"] = sum(a["width"] > 4 for a in expected)
                errors = checker.validate(checked)
                assert not errors, (path.name, name, errors)
                results.append({"song":path.name,"arrangement":name,"loadMs":round(elapsed,3),
                    "oldAnchors":len(chart["anchors"]),"newAnchors":len(expected),
                    "changed":chart["anchors"] != expected})
                if path.stem in ("Ghost - Rats", "Ghost - Cirice") and chart.get("name") == "Hybrid Lead":
                    stem = path.stem.removeprefix("Ghost - ").lower()
                    (args.out / (stem + "-before.json")).write_text(json.dumps(chart), encoding="utf-8")
                    (args.out / (stem + "-after.json")).write_text(json.dumps(checked), encoding="utf-8")
        assert sha(path) == before, "Library archive changed"
    (args.out / "audit.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({"songs":len(set(r["song"] for r in results)),"arrangements":len(results),
        "changed":sum(r["changed"] for r in results),"maxLoadMs":max(r["loadMs"] for r in results),
        "independentCoverageChecks":"passed","musicAndArchives":"unchanged"}))


if __name__ == "__main__":
    main()
