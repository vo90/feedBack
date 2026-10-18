# Chart harmony reliability and evaluation

The `chart-harmony-v3` prototype separates pitches observed in the chart from
pitches implied by a chord label. It supplies evidence for a conservative
chord-tone fallback when a full scale is unavailable. This is an engineering
improvement, not a claim of independently established musical accuracy.

## Evidence contract

For a generated harmony event:

- `chord_tones` and `grounded_chord_tones` contain the winning evidence window's
  actual observed pitch classes. `evidence.observed_pcs` preserves that provenance.
- `evidence.label_implied_pcs` records label-only pitches separately. For example,
  a chart labelled C/E that plays only C and G produces grounded `[0, 7]`, with E
  in the implied list. E is not added to the displayed chord-tone fallback or
  reported as a played slash bass.
- `evidence.root_observed` distinguishes a played root from a label-only root.
  The latter cannot authorize a scale target or chord-tone fallback.
- `evidence.quality_basis` is `label` when pitches required by the label are
  missing, otherwise `observed_voicing`. The chart's quality/display label may
  remain a hypothesis with medium confidence; it is not a transcription claim.
- Handshape template pitches are restricted to notes actually played in each
  bounded corroborating cluster. Adjacent events with different observed sets
  remain separate.
- Root-only bass candidates, including singleton bass pitches encoded as chord
  events, remain low confidence and cannot authorize a full scale or fallback.
  They also cannot displace a supported same-root partial chord merely because
  the chord label implies an unplayed third.

Key estimation counts a conventional tonic only when its defining third is
observed in that chord context. Cadences require observed quality on both
adjacent chords; incomplete/power-chord regions and uncharted gaps cannot be
silently removed to join unrelated triads into a cadence. These changes do not
introduce a new phrase segmentation or local modulation algorithm.

The algorithm version changes the cache identity, so v2 cached outputs cannot
silently acquire the v3 evidence contract.

## Reproducible command

Run from the repository with its Python dependencies and Node installed:

```powershell
python tools/evaluate_harmony.py `
  --manifest 'C:\path\development-manifest.json' `
  --output 'C:\path\new-comparison-directory' `
  --baseline-module 'C:\path\frozen-harmony-analysis-v2.py'
```

`--baseline-module` is optional. `--node` can identify a Node executable when it
is not on PATH. The output directory must not already exist. A manifest has this
shape; use an explicit `arrangement_id` when evaluating a particular arrangement:

```json
{
  "selection": "Describe selection before seeing the results",
  "songs": [
    {
      "path": "C:/library/Artist - Song.feedpak",
      "cohort": "development",
      "arrangement_id": "lead"
    }
  ]
}
```

The command reads chart metadata, not audio, and writes only its output folder.
It preserves source revisions/fingerprints, frozen engine/model source and code
hashes, per-pack result timelines, references, rest denominators, invariant
checks and timing. Both engines receive the same normalized charts and the same
frozen current browser model. Source size/mtime and adapter-code checks detect
changes during a run.

Rest windows use the actual browser `prepareRestWindows`, with maximum authored
difficulty, four-beat rests (three-second fallback), muted attacks, sustains and
links. The command then uses `createHarmonyTimeline` and `resolveHarmony` for
guide availability. It reports scale guidance and chord-tone fallback separately,
with both all-rest and interior-rest denominators. Cosmetic fades, manual local
corrections and authored harmony overrides are excluded.

The preserved 18 chart references in `tools/harmony_reference_points.json` came
from the September development evaluation. They check chord spelling/quality,
explicit slash bass and 17 change boundaries. They are sparse regressions, not
whole-song chord/key accuracy or scale suitability labels.

## October 18 development run

Artifacts are in
`C:/Dev/feedback-workspace/verification/songsterr-harmony-guide-20261018/`.
`development-manifest.json` selects all 30 packs in the current Songsterr
FeedForge test library and local converted counterparts of the 23 historical
development songs. Multiple packs of Enter Sandman are retained, so these are
53 pack evaluations, not 53 independent compositions. No fresh held-out cohort
or listening review was performed. Earlier comparisons remain preserved.

The final run is `comparison-04`. See its `report.md`, `summary.json` and
`songs-summary.json` for measured results. The baseline engine source is frozen
under `baseline/harmony_analysis_v2.py`.

| Development cohort | Baseline interior scale/guide availability | v3 interior scales | v3 interior chord fallback | v3 interior any guide |
|---|---:|---:|---:|---:|
| 30 Songsterr test packs | 13.0% | 5.4% | 52.9% | 58.3% |
| 23 historical-song reconversions | 37.3% | 35.2% | 5.2% | 40.4% |

Including intro/outro rests, any-guide availability changes from 13.0% to 39.5%
for the Songsterr cohort and 19.4% to 22.0% for the historical-song cohort. Full
scale availability decreases under the stricter evidence rules; the improvement
in total availability comes from the explicitly labelled chord-tone fallback.
These percentages say nothing about independent musical correctness.

The v2 baseline contains 121 harmony windows with reported chord tones absent
from its own observed-pitch evidence; v3 contains zero. All 121 occur in the
historical-song cohort. Both versions have zero bounded-timeline and
scale/chord-tone compatibility violations. The 18 fixed chord references and
17 applicable half-beat boundary checks pass in both versions. The 23 converted
packs have different source revisions from the September artifacts; those old
files/results are not overwritten or represented as the same frozen inputs.

Hysteria and Simple Man remain unknown in the final v3 run. La Villa Strangiato
still receives a whole-song C-major label, so that known musical-context issue
remains unresolved. The implementation does not claim to repair every key or
scale estimate.

All 102 focused analysis, source-adapter and job/cache tests pass. The new tests
use explicitly specified played pitch classes for absent thirds/slash bass,
rootless labels, incomplete handshapes, adjacent evidence changes, bass-only
chords, bass support beside a partial chord, power-chord tonality and uncharted
cadence gaps.

Timing called `cold_ms` is chart loading/normalization plus engine inference,
excluding browser processing, result saving, network/queue time and rendering.
The two engines share one source load; their engine times are measured separately.
The OS filesystem cache is not flushed. This is not an FPS or CPU-overhead test.

## What remains unverified

The subsequent v4 local-key investigation and timed external-song comparisons
are documented in [modulation validation](harmony-modulation-validation.md).
The v3 results above are retained as a historical baseline.

Availability is not accuracy. A compatible pitch set can still be musically
inappropriate, and a correctly withheld scale lowers coverage. The source
adapter also depends on the imported chart's pitches and tuning being correct.
The fallback is a bounded chart-derived note set, not a new scale or a promise
that every suggested note fits the recording.

The existing 23-song set is development/regression data: it already influenced
v2. The current local Songsterr sample is also development data. Further model
work must use independently reviewed timed chord, tonal-context and acceptable
scale references, prepared before exposing predictions. Score correctness of
displayed guidance separately from correct useful-rest coverage, retain unknown
and ambiguous sections, and report errors by musical category. Reviewing the
recording is necessary before making recording-level claims.

Broader local tonal interpretation, phrase/section segmentation, independent
musical validation, and a measured renderer-on/off performance comparison remain
follow-on work. The original proposed 90% accuracy and 80% useful-rest goals are
not established by this run.
