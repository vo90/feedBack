# Local key changes: implementation and validation

The experimental harmony guide now estimates tonal context within a song.
It remains behind the existing persistent, default-off 3D Highway setting.
Inference runs in the background and uses the versioned profile cache; playback
selects prepared events. No recording or live instrument analysis is involved.

## Local analysis

Version `chart-harmony-v4` measures context in the authored beat clock, including
tempo changes. Ordinary songs use eight-beat cells with overlapping 32-beat
contexts and require a stable span of at least 24 beats. An accepted span must
also pass a fresh estimate of its own raw observations: overlapping windows are
not independent confidence votes. Uncharted gaps longer than four beats partition
the evidence; an unresolved interval no longer inherits a whole-song key.

Authored phrase boundaries can propose shorter contexts, including a short bridge
that a centered window mixes with neighbouring keys. Phrase names supply no key
information. Proposals must pass the same tonal checks and require observed
chord quality at their edges. A different key beside an established passage also
needs change evidence; a compatible borrowed or pivot chord alone is insufficient.

Relative major/minor ambiguity depends on balanced tonic evidence, so an
occasional relative chord does not veto a sustained center. A long dominant
cannot override repeated competing tonic cadences merely through duration.
Where tonic identity remains uncertain, a separately supported pitch collection
may still be usable. Missing distinguishing degrees and sparse note-only charts
remain limitations. Automatic scale families are unchanged: major, natural minor
and harmonic minor; all eleven editor types remain available for annotations.

## Reference method

Six local song packs were selected outside the previous 53-pack development
manifest. External human key annotations and their chart timing alignments were
frozen before inspecting predictions. See [reference provenance and exclusions](harmony-modulation-references.md).
The selected regions contain 638.35 scored seconds and eleven unambiguous key
changes. Unannotated regions and disputed interpretations are explicitly omitted
or admit more than one reference key. These references are imperfect and no audio
was listened to; this is chart-to-annotation validation, not listening validation.

`tools/evaluate_harmony_modulations.py` checks exact key agreement by duration,
the duration left unknown, same-diatonic-collection agreement, false switches in
annotated regions, and transition timing within four chart beats. A relative
major/minor label is not counted as an exact key match. Unknown spans cannot
improve correct-key coverage. Harmonic minor is not counted as the same seven
notes as a natural-minor reference merely because it might fit a dominant chord.
Key agreement does not establish whether a scale is suitable over every chord.

The evaluator freezes both engine sources, adapter, helpers, evaluator, manifest
and references in each new result folder. It checks whole-pack hashes before and
after reading and never writes to a music library. Windows newline conversion
of otherwise identical reference JSON is accepted. Alignment transforms include
explicit time offset/rate and verified pitch transposition.

Local evidence is stored under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-modulations-20261018`.
The original `independent-comparison-01` is retained unchanged. All subsequent
runs are **development evaluations** because their failures inform the fixes.
The evaluator defaults to that purpose and records it in `run-definition.json`.
Later runs also correct the original false-switch metric: the four-beat timing
tolerance applies only to the correct before/after key pair. A wrong-key detour
near a genuine modulation is counted, including its unmatched return transition;
proximity to a reference boundary does not hide it. Wrong-key duration is always
counted, including for a correctly paired but early or late transition.
The unmatched-switch count also includes a late recovery to a correct key;
inspect its timing and unknown-gap duration before interpreting it as a wrong
tonal label. The separate wrong-key-duration metric makes that distinction.

## First comparison, before tuning on these songs

The deployed v3 baseline detected none of the eleven selected transitions.
It assigned a wrong key to 89.76 of 638.35 scored seconds, including Something's
A-major bridge and the selected opening of Lucy in the Sky with Diamonds.
It assigned the correct key to 301.70 seconds and left the rest unknown.

The first local-window implementation also detected none of the eleven changes.
It removed those wrong labels but retained only 169.82 correct-key seconds.
That is excessive abstention, not a successful modulation detector. In particular,
a fixed 32-beat window contaminated a short bridge with its surroundings, and
an overly broad relative-key ambiguity rule rejected a clear center whenever
its relative chord appeared. Sparse chart evidence remained a separate problem.

These negative results are kept to distinguish an honest first test from later
development improvements. The songs must not be reused as an untouched holdout
when deciding whether the feature is ready to leave experimental status.

## Final development comparison

`development-comparison-03` uses engine SHA-256
`a2ac2669a4556737369cd60eb2d7deaa486c1e315da6a1c281207e1bffe81aeb`.
The intermediate `development-comparison-02` is also retained: it exposed a
premature F label over power chords in Champions and a false G label in Crazy.
Requiring quality-bearing phrase edges and validating changes against adjacent
stable contexts removed both. Synthetic regressions cover those structural
failures, including an isolated full triad inside a long power-chord passage.

| Song | v3 correct / wrong key seconds | v4 correct / wrong key seconds | v4 key coverage | Changes within four beats |
|---|---:|---:|---:|---:|
| We Are the Champions | 0.00 / 0.00 | 45.10 / 0.00 | 26.7% | 0/5 |
| Something | 127.49 / 27.44 | 123.06 / 0.00 | 79.4% | 1/2 |
| Lucy in the Sky with Diamonds | 0.00 / 62.32 | 0.00 / 0.00 | 0.0% | 0/1 |
| Bicycle Race | 0.00 / 0.00 | 0.00 / 0.00 | 0.0% | 0/3 |
| Crazy Little Thing Called Love | 60.47 / 0.00 | 41.14 / 0.00 | 68.0% | Control |
| Another One Bites the Dust | 113.75 / 0.00 | 0.00 / 0.00 | 0.0% | Control |

The Something bridge is recognised as A major from chart time 76.841 to 102.545
seconds. Its entry is within 0.015 beats of the aligned reference. C major only
returns at 132.237 seconds, about 29.82 beats late, after a 29.69-second unknown
gap. That recovery is the one unmatched switch; it is not a wrong C label.
The other ten reference changes still fail the timing criterion. This is not
a generally reliable modulation detector yet.

Across 638.35 scored seconds, wrong-key duration falls from 89.76 to zero, but
correct-key duration also falls from 301.70 to 209.30 seconds. Key coverage falls
from 61.3% to 32.8%; correct coverage falls from 47.3% to 32.8%. Sparse passages
are often withheld, including the stationary E-minor control. Do not present
zero observed wrong labels in this tuned sample as a general accuracy claim.

Scale events remain separate from tonic identity. Their duration in the scored
regions rises from 135.42 to 145.14 seconds; exact agreement with a reference
diatonic pitch collection rises from 114.24 to 145.14 seconds. This includes
shared collections with unknown tonic. It is **not** evidence that every shown
scale note suits every moment of the recording, nor a full-song result.

The tradeoff is deliberate for this opt-in prototype: fewer unsupported key
labels, explicit uncertainty, some local modulation capability, and retained
chord-note fallback. Further work must improve correct coverage and transition
recall without restoring the false labels found here.

## Regression, timing and interface checks

`regression-comparison-03` repeats the existing 53-pack corpus (30 Songsterr packs
and 23 historical-song reconversions). Both engines retain all 18 fixed chord
references and have zero timeline-bound, unobserved-chord-tone or scale/chord
compatibility violations. These checks assess internal consistency, not musical
accuracy. Interior-rest scale availability falls from 10.02% to 6.55%, with
chord-only availability rising from 45.47% to 48.94%; any-guide availability
remains 55.49%.

Measured median inference time rises from 79.69 to 153.92 ms; chart loading plus
inference rises from 360.40 to 428.57 ms. These are one-run local wall-clock
measurements with an unflushed filesystem cache. They exclude job queueing,
network, cache persistence and rendering, and are not an FPS test. Versioned
results are reused on subsequent loads. The local pass caps estimates at 1,024,
checks cancellation during analysis, and increases cell size for very long songs.
The cap does not impose a fixed maximum cost for arbitrarily large charts.

The final implementation passes 353 relevant Python tests, 94 JavaScript guide
tests and seven browser tests. The browser tests use deterministic song streams
with the production controller, settings and 3D renderer; they verify C/D scale
replacement while seeking, clearing uncertain intervals, chord-only fallback,
toggle persistence and layout. They do not assess the musical predictor.
An independent code review and targeted regressions found no additional defect
after the phrase-boundary fixes. The experimental toggle remains default-off.

## Reproduction

With the local frozen manifest and baseline available, run from the core checkout:

```powershell
python tools/evaluate_harmony_modulations.py `
  --manifest <evidence>/modulation-manifest.json `
  --references tools/harmony_modulation_reference_points.json `
  --baseline-module <evidence>/baseline-harmony-v3.py `
  --purpose development --output <new-result-directory>
```

Only use `--purpose initial_reference` before those songs have informed an
implementation decision. The manifest is machine-specific; charts and recordings
are not bundled. Use separately prepared timing/pitch alignments for other packs.

## Remaining release work

This is a small selected set, not a population accuracy estimate. A fresh cohort,
independent recording-level review of suggested scales, and native renderer
on/off measurements are still needed. A convincing key label alone does not
justify every note of a scale, especially in modal, borrowed-chord or chromatic
passages. Unknown passages and the chord-tone fallback remain useful outcomes.
