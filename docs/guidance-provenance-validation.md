# Guidance provenance implementation validation

Implementation branch: `feat/guidance-provenance` in each of Core, FeedForge and
Editor. Baselines: Core `94f477c`, FeedForge `4964880`, Editor `e6185e7`.
The earlier `fix/authored-chord-lane-alignment` prototype is not used.

## Coverage

- Core: 229 targeted Python cases passed (song parsing, raw round trips,
  historical position compatibility, FeedPak loading and actual WebSocket
  root/difficulty ownership). 928 highway/transform JavaScript cases passed.
- Full Core JavaScript run: 2,208 passed, three failed. The same three failures
  reproduce on the untouched baseline: one audio-barrier source assertion and
  two ghost-note tests. They are outside this change.
- Editor: 424 Python cases passed, five skipped; six selected JavaScript test
  files passed. Includes unchanged saves, individual lane edits, precision,
  stale generated inputs, preserved difficulty tiers and intentional empties.
- Broad FeedForge import/Hybrid/converter run: 7,813 passed, two skipped. Six
  YouTube-related tests fail because the existing test environment lacks
  `yt_dlp`. No dependencies were installed or changed.
- A separate paired-checkout test exercises the real Songsterr parser and
  package builder, then the Editor serializer and Core reload using their
  respective Python environments. Every musical/guidance field, extension
  receipt and difficulty ladder survives the unchanged save. Shared ownership
  modules are checked byte-for-byte across all three repositories.
- Subsequent converter tests verify both supplied-lane preservation and
  missing-lane generation without musical changes, including phrase windows.
  The final focused FeedForge/cross-component run passed 202 cases.
- Actual headless Chrome WebGL: 46 existing scenarios passed in both notation
  styles. Twenty provenance scenarios passed in each style, covering source,
  user, generated and unknown origins, both cameras, handedness, safe correction
  of an invalid authored lane, and rejection of a mismatched handshape. Captured
  authored alignment images were visually inspected as well as geometry checked.

## Performance

On this Windows machine, a synthetic 10,000-note chart loaded in a median 88 ms
versus 48 ms on the baseline: about 40 ms extra once per load. Retained Python
memory was 17.6 MiB versus 15.7 MiB. The source snapshot preserves precision on
save; its display projection is prepared lazily, not during ordinary playback.
The simple benchmark's ownership receipt occupied 288 JSON bytes.

After 100 warmup frames, dense WebGL samples (five sets of 100 frames) were
approximately 5.0–5.1 ms per draw for compatible geometry and 5.3–5.9 ms for the
authored case; baseline samples were approximately 5.5–6.1 and 5.5–6.9 ms.
These short local measurements are noisy and do not establish a speedup. They
show no observed rendering regression. Instrumentation confirms zero guidance
rebuilds during the 500 unchanged measured frames in either scenario. No hash
checks or generation run in the render loop.

Reproduce loading with `tests/benchmark_guidance_provenance.py`; pass
`--baseline <checkout>` for comparison. The actual-WebGL harness is
`tests/browser/highway-chord-hold-guidance.cjs`, with `--case provenance` or
`--perf --perf-only`, and `--style current` for the other notation style.
Use an existing Playwright module/browser through its documented environment
variables. FeedForge's cross-component test accepts `GUIDANCE_CORE_ROOT`,
`GUIDANCE_EDITOR_ROOT`, and optionally `GUIDANCE_EDITOR_PYTHON`.

## Boundaries

No user's library, active runtime, integration branch, dependency installation,
or running game was changed. The user has no existing Songsterr packs on this
machine; acceptance therefore uses disposable imports through the actual
pipeline rather than claiming coverage of a personal imported-song collection.

Legacy packs without recoverable ownership remain unknown. Their layout does
not silently change. A verified conversion or reviewed migration is needed to
enable authored-lane alignment for such packs. Mixed edited collections remain
protected from whole-field regeneration; regenerating only selected generated
segments is not exposed as a new operation. Unknown transforms cannot preserve
authorship just by copying a label onto replaced lane coordinates.

The Back In Black mismatched A5/G5 reference remains a separate chart defect.
Tests confirm the alignment change does not invent a connecting hold for it.
Live integration and any library migration are separate review steps.
