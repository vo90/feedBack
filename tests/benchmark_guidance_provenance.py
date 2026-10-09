"""Manual load benchmark: python tests/benchmark_guidance_provenance.py [--baseline PATH]."""
import argparse
import gc
import json
from pathlib import Path
import statistics
import sys
import time
import tracemalloc

parser = argparse.ArgumentParser()
parser.add_argument("--baseline")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from lib.guidance_provenance import stamp

data = {"name": "Dense benchmark", "tuning": [0] * 6, "capo": 0,
        "notes": [{"t": i * .03125, "s": i % 6, "f": 3 + i % 4, "sus": .03125} for i in range(10000)],
        "chords": [], "templates": [], "handshapes": [],
        "anchors": [{"time": i, "fret": 3, "width": 4} for i in range(315)]}
stamp(data, "anchors", "generated", producer="benchmark", policy="v1")
if args.baseline:
    sys.path.insert(0, args.baseline)
    import lib
    lib.__path__ = [str(Path(args.baseline) / "lib"), *lib.__path__]
from lib.song import arrangement_from_wire

arrangement_from_wire(data)  # imports/warmup are not steady load cost
times = []
for _ in range(7):
    gc.collect()
    start = time.perf_counter()
    arr = arrangement_from_wire(data)
    times.append((time.perf_counter() - start) * 1000)
    del arr
gc.collect()
tracemalloc.start()
arr = arrangement_from_wire(data)
retained, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()
print(json.dumps({"baseline": args.baseline, "notes": 10000, "loadMedianMs": statistics.median(times),
    "loadSamplesMs": times, "retainedMiB": retained / 2**20, "peakMiB": peak / 2**20,
    "receiptBytes": len(json.dumps(data["ext"]))}, indent=2))
