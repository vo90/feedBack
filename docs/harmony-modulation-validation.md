# Local key changes: implementation and validation

The experimental harmony guide now estimates tonal context within a song.
It remains behind the existing persistent, default-off 3D Highway setting.
Inference runs in the background and uses the versioned profile cache; playback
selects prepared events. No recording or live instrument analysis is involved.

## Local analysis

The v4 baseline measures context in the authored beat clock, including
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

## v4 development comparison

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

## v5: shorter supported passages and separate tonic evidence

Version `chart-harmony-v5` retains the bounded local analysis and adds two
evidence checks. A repeated, dominant tonic with its played third can identify
the key while the full scale stays explicitly unknown. A shorter context can
pass from 16 beats when it has that repeated-tonic support or at least six
quality-bearing chord regions spanning three roots. A 15-beat isolated passage
still fails. Nearby continuous played notes may extend a short analysis context,
but never its published key span or supply of observed chord qualities.

Short proposals use the existing neighbour-change guards. Later observations
that resolve missing scale degrees cannot merge backward into an earlier
tonic-only passage. Constant-tempo and changing-tempo tests cover the 15, 16, 23
and 24-beat boundaries, short returns, power-only tails and borrowed chords.
Automatic scale families remain major, natural minor and harmonic minor.

The final v5 engine is frozen at SHA-256
`18937908178e1379b87e13111241ba4dc67cd7b68d5ca588ac99f1129c79475e`.
Evidence is under the workspace-relative directory
`verification/songsterr-harmony-coverage-20261018`. The original six songs are
development data; `development-comparison-02` compares v4 and final v5:

| Song | v4 correct key seconds | v5 correct key seconds | v5 wrong key seconds |
|---|---:|---:|---:|
| We Are the Champions | 45.099 | 62.205 | 0.007 |
| Something | 123.063 | 138.596 | 0.000 |
| Lucy in the Sky with Diamonds | 0.000 | 0.000 | 0.000 |
| Bicycle Race | 0.000 | 0.000 | 0.000 |
| Crazy Little Thing Called Love | 41.137 | 41.137 | 0.000 |
| Another One Bites the Dust | 0.000 | 16.375 | 0.000 |

Correct-key duration increases from 209.299 to 258.313 of 638.350 scored seconds
(32.8% to 40.5%). The 0.007-second mismatch in Champions is at a boundary and
is smaller than the declared 0.5-second alignment uncertainty; the raw score
still includes it. Something's C return now starts at 104.685 seconds, 0.447
beats after the aligned reference. Both its selected changes pass the four-beat
criterion, increasing total detected changes from 1/11 to 2/11. Nine still fail.
Dust's two recovered E-minor passages retain unknown scales and chord-only
fallback; tonic coverage is not presented as new full-scale coverage.

The evaluator now reports unknown-key duration by reason, exact versus subset
collection agreement, and guidance during actual lead-chart rests. It freezes
the production browser model as well as the engine. Rest metrics use maximum
authored lead difficulty and the default four-beat threshold, with a three-second
fallback. "Visible" means eligible in the model before fade opacity, not pixels
measured on screen or the user's current settings.

Across 79.576 reference-covered interior-rest seconds in the six-song set,
full-scale eligibility increases from 26.873 to 31.116 seconds. All of those
eligible scales match the reference diatonic collection; this remains weaker
than independent note-by-note suitability review. Chord-only eligibility falls
from 16.487 to 12.244 seconds as those moments gain scales. Total guide coverage
is unchanged. Raw timeline scale duration increases from 145.138 to 169.179
seconds; most timeline time is not a qualifying rest.

## First v5 evaluation on three fresh songs

References and alignments were frozen before v5 predictions, separately from
engine development. The first v5 candidate was frozen at SHA-256
`634ccf30aff7eef330a0213f141fde89c98c0cc069a9c7ae7da9d6713786ef87`.
See [fresh reference provenance](harmony-coverage-references.md)
and `tools/harmony_coverage_reference_points.json`. The selected regions total
452.722 chart seconds after timing alignment. `initial-reference-comparison-01`
is retained unchanged; these findings may inform future development, so the
cohort must not be called untouched in a later tuned run.

| Song | v4 reference match / disagreement seconds | Initial v5 reference match / disagreement seconds | Change result |
|---|---:|---:|---|
| Bohemian Rhapsody, selected early ballad | 0.000 / 0.000 | 0.000 / 0.000 | 0/3; all keys unknown |
| Don't Stop Me Now | 22.191 / 78.372 | 29.903 / 78.372 | Stationary F-major reference |
| Hello, Goodbye | 106.757 / 0.000 | 106.757 / 0.000 | Stationary C-major reference |

The fresh result exposes a substantial existing limitation. Local D-minor and
G-minor labels in Don't Stop Me Now disagree with its conventional F-major
reference. The first v5 candidate adds 7.712 correct-key seconds but does not fix those labels.
Sparse accompaniment in the selected Bohemian Rhapsody chart leaves all three
changes undetected. These are negative results, not evidence of general
modulation accuracy. Chromatic or tonicized passages also need more detailed
musical review than a conventional song-key annotation supplies.

Of the 78.372 seconds, 59.955 are G minor and 18.417 D minor. Repeated D7-to-Gm
motion makes temporary G-minor tonicization plausible, although some estimates
extend earlier into other harmony. The D-minor chorus estimates show a clearer
relative-tonic ambiguity. These figures measure exact reference disagreement,
not independently established seconds of perceptually wrong labels. D minor
also shares F major's diatonic pitch collection.

Across 49.990 scored interior-rest seconds, both engines offer 12.585 seconds
of scales and 8.249 seconds of chord-only guidance. Only 7.158 scale seconds
match the reference's conventional diatonic collection. The mismatch is not
automatically a wrong-sounding scale: a key label alone does not validate or
invalidate a palette over chromatic accompaniment. It does prevent claiming
that these suggestions have been independently musically validated.

## Relative-cadence correction after reviewing the fresh result

The first comparison revealed a general ambiguity-rule gap: a long preferred
tonic could outweigh an authentic cadence to its relative tonic when it had no
authentic cadence of its own. Final v5 now withholds that tonic identity. It
retains their shared collection only when independently supported; it does not
force the competing key. Four transpositions and two beat clocks test the rule.
Missing thirds, intervening power chords and evidence gaps cannot fabricate a
competing cadence.

`fresh-development-comparison-02` is explicitly a **development** evaluation,
since the initial result informed this correction. Don't Stop Me Now loses its
D-minor key labels; total reference disagreement falls from 78.372 to 63.018
seconds, while F-major agreement remains 29.903 seconds. Removing the D-minor
assignment also permits one neighbouring G-minor span to begin 3.062 seconds
earlier. The net reduction is therefore 15.355 seconds, not the original 18.417
D-minor seconds. Local G-minor versus overarching F-major interpretation remains
unresolved; this correction does not claim to solve tonal continuity.

All six earlier development-song gains remain. Raw scale availability in the
new three-song set is 203.082 seconds, versus 209.603 in the first candidate and
201.891 in v4. Some unresolved boundary context is withheld. Actual qualifying
rest eligibility and collection agreement remain unchanged. The initial frozen
comparison is preserved, and no tuned result is presented as a new holdout test.

## v5 regression, cost and interface checks

`regression-comparison-02` repeats all 53 existing packs. There are no per-song
rest-coverage losses; all 18 fixed chord references remain correct, with zero
timeline-bound, unobserved-chord-tone or scale/chord compatibility violations.
Interior-rest scale availability remains 6.55%, chord-only 48.94%, and any-guide
55.49%. These consistency checks do not measure musical accuracy.

In this final run, median inference takes 186.95 ms versus v4's 147.43 ms; chart
load plus inference takes 456.65 versus 417.72 ms. The earlier candidate run
measured 295.84 versus 225.35 ms, illustrating variability with desktop load.
These are local wall-clock timings
with an unflushed filesystem cache and other desktop work, not a calibrated
benchmark or an FPS measurement. The extra analysis happens in the background
and uses the versioned cache; the frame-time algorithm has not changed.

Validation passes 198 relevant Python tests, 95 JavaScript guide tests and eight
browser tests. A new browser test verifies that a known E-minor key with an
unknown palette shows only E/G/B chord tones, including after seeking back from
a full-scale passage. Independent code review, 20 short-context regressions and
14 relative-cadence regressions found no additional confirmed defect.
The feature stays default-off behind its
existing persistent 3D Highway setting.

## Remaining release work

This is a small selected set, not a population accuracy estimate. A fresh cohort,
independent recording-level review of suggested scales, and native renderer
on/off measurements are still needed. A convincing key label alone does not
justify every note of a scale, especially in modal, borrowed-chord or chromatic
passages. Unknown passages and the chord-tone fallback remain useful outcomes.

## Phrase collection investigation: research only, not deployed

The next investigation tested whether selecting a coherent sequence of note
collections could improve rest guidance without requiring an exact local key
name. It reads chart notes and chords only. No recording or live input is used.
The existing runtime remains on v5 with its persistent experimental toggle.

`tools/harmony_phrase_prototype.py` is an isolated research engine. It reuses
v5's grounded evidence and leaves its key and chord tracks unchanged. It scores
24 distinct collections: twelve diatonic collections (each shared by a major
and natural-minor pair) and twelve harmonic-minor collections. Eight-beat cells,
authored section edges and adjacent-cell context feed a whole-sequence decoder.
The objective combines observed pitch fit with a cost of changing collection.
Unsupported regions split the sequence; a published scale must still contain
the observed current chord. Harmonic-minor candidates require an observed minor
chord and leading note. A path-cost margin is not a calibrated probability.

This is a hand-scored experiment, not an imported or trained music model.
Related approaches exist: [music21 floating-key analysis](https://music21.org/music21docs/moduleReference/moduleAnalysisFloatingKey.html)
smooths measure-level estimates, with window size affecting sensitivity to
changes. [Uehara, Nakamura and Tojo (2019)](https://eita-nakamura.github.io/articles/Uehara_etal_ChordFunctionIdentificationWithModulationDetectionBasedOnHMM_2019.pdf)
investigate chord function and modulation through sequence models. Their
classical-music results do not establish accuracy on incomplete guitar charts.

### Frozen experiment and results

Evidence is in `verification/songsterr-harmony-phrases-20261018` under the
workspace. The six earlier songs and the three later songs are all development
data. No fresh holdout or listening review is claimed. The first candidate was
frozen at `76e9387c85efaf55fa3201030b5d3192b7a892ef7ded6035fd2ecbf260f12033`.
`development-first-01` and `additional-first-01` compare it to unchanged v5.
The corresponding `*-no-switch-01` runs set only `switch_cost` to zero, retaining
the same phrase scorer and neighbouring context. This isolates the switch
penalty, not all use of temporal context.

Across 129.566 seconds of reference-covered interior lead rests:

| Method | Scale eligible, seconds | Exact reference collection, seconds | Chord-only, seconds |
|---|---:|---:|---:|
| Production v5 | 43.701 | 38.274 | 20.493 |
| Phrase scorer, zero switch cost | 32.767 | 27.760 | 31.427 |
| Phrase sequence, default switch cost | 45.418 | 30.071 | 18.776 |

Any-guide availability remains 64.194 seconds: the prototype mainly exchanges
full scales and existing chord fallback. It does not create extra supported
chord coverage. The switch penalty helps its own scorer overall, but this
first prototype does not outperform production on reference collection
agreement. These columns measure model eligibility before fades and agreement
with a conventional diatonic reference, not the suitability of every note.
Key-change detection is unchanged by design; scale gains are not modulation
recall gains.

The results are mixed across songs. Hello, Goodbye gains reference-matching
scale availability from 7.158 to 14.251 rest seconds. Bicycle Race gains 1.460
seconds. Something retains 7.746 seconds. Champions drops from 18.061 to 6.035
matching seconds, and Crazy drops from 5.309 to zero. Don't Stop Me Now moves
mostly to chord fallback: scale eligibility drops from 5.427 to 0.579 seconds,
with the remaining 0.579 matching its conventional F collection. Dust and the
selected early Bohemian Rhapsody passages remain without full scales.

Inspection explains why pitch fit plus continuity is insufficient. Crazy has
a D-centred passage with D/Dsus4, G/G6, C and G/B. Those notes strongly fit the
G-major collection, also the D-Mixolydian collection. The prototype's canonical
G label does not establish a G tonic or invalidate the D tonal centre.
Champions mixes F-centred material with Eb, Ab, Bb and Cm7; an aggregate fit
favours Bb-major and suppresses conflicting Am moments. Keeping either choice
stable does not distinguish temporary mixture from a new key. Conversely, a
reference-key mismatch does not prove that all those local scale notes are bad.

### Independent chord annotation check

`tools/evaluate_harmony_phrase_chords.py` adds a separate check against the
available human chord annotations. It uses the frozen browser resolver's
actual eligible pitch sets, the previously verified affine timing/pitch
alignments, and reference-covered interior rests. It excludes the declared
alignment uncertainty around each chord boundary, unsupported labels, unknown
labels and N.C. It freezes its inputs and reports chart chord qualities beside
each disagreement. Its Harte-notation parser is independent of the predictor.

Only 47.521 of the 129.566 rest seconds remain scorable: boundary uncertainty
excludes 66.612 seconds and N.C. annotations exclude 15.433. Both engines offer
25.547 seconds of guidance in the remaining sample. All their highlighted
targets are within the annotated chords. Production scales contain all annotated
chord tones for 16.698 of 17.467 scale seconds; the prototype does so for all
18.308 of its scale seconds. This is a necessary consistency check, not evidence
that every additional scale note is suitable.

The production 0.769-second disagreement is specifically annotated D7 versus
fully observed chart D7sus4 in Don't Stop Me Now (167.681–168.065 and
170.712–171.097 chart seconds). The reference may omit the brief suspension.
It is not a confirmed analyser error. The prototype turns those moments into
chord fallback, where the same chart/reference suspension disagreement remains.
No listening review resolved which description best matches the recording.

### Regression, reproducibility and decision

`regression-first-01` covers the existing 53 packs, including duplicate songs
in different packs. All 18 fixed chord references remain correct, with zero
timeline-bound, unobserved-chord-tone or scale/chord containment violations.
Interior-rest scale availability falls from 6.55% to 6.32%; any-guide coverage
remains 55.49%. These are consistency and availability checks, not accuracy.

Median inference in that local run is 208.47 ms for v5 and 458.84 ms for the
prototype; chart load plus inference is 470.78 versus 743.61 ms. The research
wrapper runs v5 and extracts observations again, so it includes avoidable
duplicate work. The measurement is not a calibrated performance or FPS test.
Nothing runs on the playback frame or microphone path.

The final research source is
`fc419c074a8cd21c08a9e2e74db75f9083be962813d1d92c16f0a2e64cf50eb1`.
After the first freeze, audit metadata was corrected to retain the minimum
merged margin and union of supporting tones, and explicit zero-margin ties
were prevented from publishing when the research threshold is set to zero.
`final-semantic-verification.json` verifies identical key, chord and played
scale timelines for all 62 evaluated pack rows with default settings.
The final focused suite passes 165 tests; independent code review found no
remaining confirmed defect. Synthetic tests cover decoder optimality, ambiguity,
temporary chromatic chords, a sustained C-to-D change, gaps, missing degrees,
tempo changes, cancellation, frozen dependencies and annotation exclusions.

The prototype is retained as a benchmarkable alternative and is **not promoted
to the runtime**. The next experiment should represent the stable section tonic
and the current chord's harmonic role separately, while allowing local pitch
changes and preserving unknown results. A collection-equivalent label must not
silently change the guide's tonic. More detailed independent review of local
note guidance is needed before tuning that model. Increasing the continuity
penalty or choosing thresholds to fit these nine songs would not resolve the
demonstrated ambiguity.

Both existing evaluators accept `--candidate-module` and JSON
`--candidate-options`, recording the options and freezing a sibling
`production-engine.py` dependency. Reproduce from this checkout with the
original frozen manifests and a new output directory; the saved evaluator
sources are audit snapshots, not standalone installation bundles:

```powershell
python tools/evaluate_harmony_modulations.py `
  --manifest <coverage-evidence>/development-manifest.json `
  --references tools/harmony_modulation_reference_points.json `
  --baseline-module <phrase-evidence>/baseline-harmony-v5.py `
  --candidate-module tools/harmony_phrase_prototype.py `
  --output <new-comparison-directory>

python tools/evaluate_harmony_phrase_chords.py `
  --comparison <new-comparison-directory> `
  --chord-directory <modulation-evidence> --output <new-report.json>
```

## Controlled section-key experiment — 2026-10-18

This experiment separates two questions: whether the analyser knows the section
key, and whether the existing chord-aware mapper can choose a useful collection
given that key. It does **not** implement improved automatic key detection.
`tools/harmony_known_key_prototype.py` accepts an explicit complete key timeline,
including unknown intervals, and preserves v5's grounded harmony exactly.
There is no microphone input, audio decoding, runtime integration or toggle
change. Production remains `chart-harmony-v5`.

### Inputs and controls

`tools/evaluate_harmony_known_keys.py` compares four arms using the same lead
rests, supplied-key interior intervals and frozen browser guidance resolver:

| Arm | Key input and scale policy |
| --- | --- |
| Automatic | Unchanged production v5 |
| Automatic, assumed family | Original detected keys and chords; permits the conventional major/minor family without requiring every degree to be observed |
| Supplied keys, existing mapping | Reference section keys with the existing v5 chord-aware mapper |
| Supplied keys, minor context | Same keys plus a bounded rule for thirdless dominants in minor |

The last arm can use an actually observed raised-seventh dominant within four
authored beats to support harmonic minor over a thirdless dominant. It cannot
carry evidence across other roots, incompatible thirds/sevenths, harmony gaps
or key boundaries. Without support it retains chord-only guidance. This tests
a narrow missing-evidence case; v5 already handles a fully observed E7 in A
minor without this rule. No scales were added to the production catalogue.

Known input intervals are merged before trimming 0.5 seconds from their edges.
Ambiguous keys, unlabelled sections and trimmed boundaries remain unknown.
All arms are scored on the same remaining intervals, even if the automatic
analyser declines to name a key there. Agreement with the supplied key is not
reported as prediction accuracy: that would score an input against itself.

The six development songs and three previous additional songs are supplemented
by Play the Game and Yesterday. Their key ranges and raw chart/reference timing
anchors were frozen at `2026-10-18T17:09:44.206536Z`, before new predictions.
The references use [Isophonics human annotations](https://isophonics.net/content/reference-annotations).
Play the Game uses selected C-major regions, excluding the disputed bridge;
five fitting and four independent checking anchors have maximum residual
0.044 seconds. Yesterday uses an anchor-bracketed F-major region; four fitting
and three checking anchors have maximum residual 0.071 seconds. Both use zero
transposition and conservative 0.5-second uncertainty. These are additional-song
checks, not a perfectly blind sample: Play the Game was previously inspected
as a source candidate. The annotations are tonal interpretations, not proof
that every note in a key's scale fits every local chord. No listening review
was performed. Here Comes the Sun was excluded because its cached key label
conflicts with its major-triad evidence; it was not silently corrected.

Of 2,322.581 input song seconds, 1,280.374 have an unambiguous supplied key after
trimming. The common eligible-rest sample within those intervals is **150.354
seconds across 11 songs**. Lucy has no qualifying rests in its selected scope;
its zero contribution is not a successful musical validation.

### Results: availability with a supplied key

| Arm | Full scale (s) | Chord only (s) | Hidden (s) |
| --- | ---: | ---: | ---: |
| Automatic | 43.263 | 27.189 | 79.902 |
| Automatic, assumed family | 43.263 | 27.189 | 79.902 |
| Supplied keys, existing mapping | 64.555 | 5.897 | 79.902 |
| Supplied keys, minor context | 64.460 | 5.992 | 79.902 |

Supplying section keys converts 22.685 seconds of chord-only guidance to full
scales and 1.393 seconds in the opposite direction, a net gain of 21.292 scale
seconds. Any-guide availability stays at 70.452 seconds. This is increased
conditional availability, **not a measured increase in musical accuracy**.
Merely relaxing degree evidence on the automatically detected keys produces no
change in these rests; that finding need not generalize to other songs.

| Song | Automatic scale (s) | Supplied-key scale (s) |
| --- | ---: | ---: |
| We Are the Champions | 18.061 | 22.795 |
| Something | 7.665 | 7.665 |
| Bicycle Race | 0 | 1.693 |
| Crazy Little Thing Called Love | 4.952 | 4.952 |
| Another One Bites the Dust | 0 | 0.640 |
| Bohemian Rhapsody | 0 | 0 |
| Don't Stop Me Now | 5.427 | 4.419 |
| Hello, Goodbye | 7.158 | 14.251 |
| Play the Game | 0 | 1.526 |
| Yesterday | 0 | 6.614 |

Don't Stop Me Now illustrates why more scale exposure is not always better:
the supplied F section key makes the mapper fall back over chromatic D7 where
the automatic G-minor interpretation allowed harmonic minor. The extra minor
context rule provides no independently validated gain; it changes only 0.095
seconds in Dust from scale to chord fallback in the common rest sample.

The independent chord-annotation check excludes 75.431 seconds around uncertain
chord boundaries and 15.433 seconds marked N.C., leaving 59.490 scorable rest
seconds. Automatic scales contain all annotated chord tones for 16.341 of
17.110 scale seconds; supplied-key scales do so for 28.476 of 29.245 seconds.
Both retain the same 0.769-second D7 versus observed D7sus4 disagreement already
described above. All 30.054 seconds of highlighted targets are within annotated
chords in every arm. The minor-context arm has identical chord-check results.
The broader collections also absorb a chart/reference fallback disagreement
in Hello, Goodbye; that is not independent proof of a correction. Containment
does not establish that every additional suggested scale note sounds suitable.

### Why some rests remain hidden

With supplied keys, 45.109 seconds remain hidden because chart harmony is
unknown and 34.793 because it has low confidence. The current display requires
a supported current chord and target, even with a known key. Reliable section
keys alone therefore cannot fill all missing accompaniment evidence.

A separate **post-hoc, unimplemented** counterfactual asks what happens if those
hidden passages instead show only the supplied major/natural-minor collection,
without inventing a chord or highlighting a target. Of 29.436 independently
scorable hidden seconds, 26.013 contain every annotated chord tone and 3.422
miss at least one. The scorable hidden sample consists of 20.767 seconds of
low-confidence, root-only harmony and 8.669 seconds of unknown harmony; the
omissions occur in both groups. Examples include F minor in Champions (Ab absent from the
supplied section collection), and Bb/Bbmaj7 or F minor within Play the Game's
selected C-major sections. This does not prove every such scale note is wrong,
but it rules out treating a section key as a guarantee of chord compatibility.
An optional background collection needs further safeguards and validation.
It has not been added to the player.

### Reproducibility and decision

Evidence is saved under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-known-keys-20261018`.
`development-final-01`, `previous-additional-final-01` and
`new-additional-final-01` freeze inputs, source hashes, browser model, engines,
references and all four predictions. `study-summary.json` aggregates the study;
`background-counterfactual.json` and its adjacent script record the separate
hidden-passage diagnostic. First and final runs have identical musical metrics
on all 11 songs; intervening changes only fix input validation and reporting.
`final-verification.json` records the diagnostic script and helper hashes;
those checkout helpers were verified against the frozen comparison copies.
Additional reference manifests, raw annotations and source packs remain private
local evidence, not redistributable test fixtures.

The final prototype SHA256 is
`cad13769e571b9ff24cbc9290a35f4e9f8b0f263a34dbfdc4f771b741a3186a4`.
All four arms preserve grounded harmony and pass timeline, observed-chord-tone
and scale/chord invariants. **211 focused tests pass**, including 38 prototype
and 8 evaluator tests. Independent review found no remaining confirmed defect.
Timing fields identify their scope: the automatic-family control measures only
copy/remap work, while other arms include v5 analysis. They are not comparable
performance measurements or playback/FPS tests.

The research code is retained but **not promoted to runtime**. The experiment
supports prioritizing reliable section-key identification or trusted supplied
metadata, while retaining local chord checks and explicit unknown results.
The next automatic-key experiment should distinguish stable tonic evidence and
sustained key changes from temporary borrowed chords, using fixed reference
boundaries and additional songs selected before predictions. Adding more scale
types or carrying chord evidence farther is not supported by these results.
The existing 3D-highway toggle remains the user's control for runtime testing.

Reproduce each group with its frozen manifest, references and chord directory,
using a new output directory:

```powershell
python tools/evaluate_harmony_known_keys.py `
  --manifest <frozen-manifest.json> `
  --references <reference-points.json> `
  --chord-directory <frozen-chord-directory> `
  --output <new-comparison-directory>
```

## v6: cadence evidence across articulated chord releases

The follow-up implementation fixes two sources of biased local key evidence.
An authentic or plagal arrival must now contain the observed third of the
candidate major/minor tonic. A cadence into C minor cannot count as an arrival
into C major merely because a C-major chord occurred elsewhere in the context.
Separately, two grounded chords can have a harmonic connection across at most
half an authored beat of empty release time. Exact endpoint equality previously
made an articulated return disappear from the evidence while a legato secondary
cadence continued to count.

The half-beat allowance measures the authored tempo map, including tempo
changes. It applies only to cadence evidence: it does not extend a chord,
target or scale across the gap. An intervening chord, suspended/power chord,
root-only event, conflicting arrangement, conflicting chord quality or
incompatible held/new note blocks the connection. Only an explicit
`no_chart_evidence` gap is eligible. The tonic must actually arrive inside the
estimated context. The stable local-context and scale-degree checks remain in
place; this is not a new whole-song prior or a general modulation solution.

The initial diagnosis came from short C7-to-F gaps in Yesterday, but subsequent
inspection showed that **all eight of those gaps contain conflicting arrangement
evidence**, rather than empty articulation. The conservative fix therefore does
not change Yesterday's output. Rhythm C7 and a bonus-lead Gm6 interpretation of
the subset E/G/Bb, together with bass timing, create competing root evidence.
That requires separate investigation of how overlapping arrangements are
combined. Increasing the gap tolerance is not a supported solution.

### Frozen song comparison

The candidate was fixed before evaluating the merged 11-song reference set and
two newly prepared songs. The additional reference freeze was
`2026-10-18T17:28:32.226570Z`. I Want It All includes B-minor, relative D-major
and parallel B-major passages, with five fitting and six checking raw chart
anchors (maximum residual 0.032 seconds). Good Old Fashioned Lover Boy includes
Eb-to-Cb-and-back references, with four fitting and five checking anchors
(maximum residual 0.057 seconds). It is a bass-only sparse-notation control;
its empty rest sample is not successful scale-guidance validation. Both use
0.5-second alignment uncertainty and unchanged external Isophonics annotations.
No audio was decoded or listened to.

| Existing 11-song reference measure | v5 | v6 |
| --- | ---: | ---: |
| Reference duration (s) | 1,313.579 | 1,313.579 |
| Correct key duration (s) | 426.331 | 435.717 |
| Wrong known key duration (s) | 63.024 | 63.024 |
| Unknown key duration (s) | 824.223 | 814.837 |
| Key changes within four beats | 2 / 14 | 2 / 14 |
| Unmatched switches in annotated regions | 3 | 3 |
| Full-scale guidance in 155.675 reference-rest seconds | 43.701 | 44.431 |

The gain is Bicycle Race's F-major span at 67.451–76.837 chart seconds.
The observed C-to-F return has a 0.123-beat empty gap with no intervening
conflict. An ablation keeping the new mode check but restoring exact adjacency
loses that recovered span, identifying articulation handling as its cause.
The gain is 9.386 correct-key seconds and 0.730 seconds of full-scale rest
guidance. No additional wrong-key time appears in these selected regions.
The previous false G-minor detours in Don't Stop Me Now remain unresolved.

On the two new songs, musical outputs are unchanged. I Want It All still has
40.535 wrong-known seconds and 154.315 unknown seconds within 194.851 reference
seconds; it misses all eight changes. Its incorrect A-major spans reflect
A-heavy local evidence in B-minor/D-major reference context. It shows no full
scale in its 34.500 seconds of qualifying lead rests. Lover Boy leaves all
40.362 reference seconds unknown and misses both changes. Together the 13-song
study still detects only **2 of 24 annotated changes**. This is a modest
cadence-evidence correction, not evidence of generally reliable key tracking.

The independent chord check has 59.888 scorable rest seconds in the existing
set after boundary and N.C. exclusions. Scale exposure rises from 17.467 to
17.767 seconds, with all added exposure containing the annotated chord tones.
The old 0.769-second D7/D7sus4 disagreement is unchanged. All highlighted targets
remain inside annotated chords. The new-song chord check is also unchanged;
its 0.481-second fallback disagreement is chart Bsus2/F# against a coarser
B-minor annotation, not a demonstrated wrong note. Chord containment alone
does not establish the suitability of every additional scale tone.

### Regression and runtime contract

Across the separate 53-pack consistency corpus, all 18 fixed chord references
still match and all timeline-bound, unobserved-chord-tone and scale/chord
containment checks pass. Grounded harmony is byte-for-byte unchanged in every
evaluated result. Interior-rest full-scale coverage changes from 6.55% to 6.46%,
while any-guide coverage remains 55.49%; the difference becomes chord fallback.
The affected interior-rest sample is Pride and Joy, whose previously known
Eb-major context at 153.414–175.373 becomes uncertain. The newly counted
Ab7-to-Eb-minor arrival across a 38 ms empty gap strengthens the competing
minor interpretation in a passage containing both thirds. This converts 2.138
rest seconds from scale to chord-only guidance. There is no independent timed
key reference for that passage, so reduced scale exposure is not claimed as
either a confirmed correction or a musical regression.

The run's median backend inference was 359.58 ms for v5 and 388.49 ms for v6.
Other validation was running concurrently, and the filesystem cache was not
flushed; these are local observations, not calibrated performance or FPS
measurements. The work remains in the background analysis job, outside playback
rendering. `chart-harmony-v6` changes the versioned cache identity, so the first
enabled analysis recomputes and subsequent requests reuse the new result.
The existing persistent 3D Highway toggle and its default remain unchanged.

The Python verification passes **320 tests**, including 36 new musical
regressions and an algorithm-upgrade cache test. The focused JavaScript guide
suite passes **95 tests**. Independent source review found no remaining
confirmed defect. Seven browser tests pass with the full Songsterr plugin
composition. The eighth completes its harmony assertions but encounters an
unrelated Rig Builder startup error; the same test body passes with only the
highway plugin selected by a request-scoped fixture. Runtime and browser
verification receipts retain both results. Tests actively exercise the feature
enabled and disabled while preserving the user's saved preference.

Reproducible evidence is under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-section-keys-20261018`:
`existing-11-first-01`, `new-2-initial-01`, `regression-first-01`, their independent
chord checks, `study-summary.json`, the pre-prediction design and reference
freeze, and the raw cadence diagnosis. The final engine SHA256 is
`47c924a2c15bb2b2d83af916eacceb893e4c93de708eda410b5afca9ccd5e3d7`.
Use the existing modulation/chord evaluators with these manifests and a new
output directory. The additional songs become development data if their
failures inform later model changes.

## v7: compatible partial voicings across arrangements

The next investigation found that some cross-arrangement conflicts were caused
by different labels for compatible played notes. Yesterday's rhythm C7 contains
C/E/G/Bb, while another part labels E/G/Bb as Gm6 with its D missing. Similarly,
an observed Em7 can explain an incomplete G6 voicing. Previously these produced
competing root votes and an unknown chord, breaking useful tonal evidence.

The resolver runs only when the existing root scores already indicate a strong
conflict. It requires one unique, complete, actually observed chord, including
its root and defining tones. Every competing multi-note interpretation among
the strong roots must have missing label-implied notes and a strict subset of
the anchor's played notes. All observations associated with those strong roots,
including root-only evidence and correlated alternatives, must fit the anchor.
The normal root-score threshold still applies; this is not a claim that every
weak accompaniment note belongs to the selected chord.

Complete alternative chords, equal pitch collections such as C6/Am7, same-root
major/minor conflicts, and incompatible arriving chords remain uncertain. No
notes are combined to construct a new chord, no evidence lifetime is extended,
and partial parts do not add votes to the anchor. Resolved events have medium
confidence and explicit anchor/partial-voicing references. Provenance changes
preserve their exact boundaries; the key estimator still coalesces adjacent
equivalent musical regions before considering cadences.

### Paired results and limitations

The candidate was frozen before the comparisons. On the existing 13 reference
songs, only Yesterday and a 19 ms Am passage in Play the Game change grounded
harmony. Yesterday gains 2.720 seconds of grounded C7/Em7 evidence across 15
musical spans. Each of its 21 provenance intervals was checked against an active
complete anchor for the entire interval. Actual A7/Dm and C7/F overlaps, plus
expired-C7 fragments against the arriving F, still remain unknown.

| Existing 13-song reference measure | v6 | v7 |
| --- | ---: | ---: |
| Correct key duration (s) | 435.717 | 488.827 |
| Wrong known key duration (s) | 103.560 | 103.560 |
| Unknown key duration (s) | 1,009.514 | 956.404 |
| Key changes within four beats | 2 / 24 | 2 / 24 |
| Unmatched switches in annotated regions | 3 | 3 |
| Full-scale guidance in 190.175 reference-rest seconds | 44.431 | 50.236 |

The key gain is entirely Yesterday: 53.110 seconds now match the F-major
reference, producing 5.805 seconds of full-scale guidance in qualifying lead
rests. This replaces chord-only guidance; total guide availability is unchanged.
There is no added wrong-key time in these selected regions. The improvement
does not repair the missed modulations or the existing incorrect key passages.

Two additional full-band songs were selected and aligned before predictions:
Michelle and While My Guitar Gently Weeps. Their reference freeze is
`2026-10-18T17:56:20.067305Z`; nine and twelve raw sounding-pitch/onset anchors
have checking residuals at most 0.039 and 0.041 seconds, respectively, with
0.5-second declared uncertainty. Michelle's scope ends before later timing
drift. Neither song changes under v7. Across 298.931 reference seconds they
retain 157.418 correct-key seconds, 18.393 wrong-known seconds and 123.120
unknown seconds. They miss all seven annotated changes and have no qualifying
lead-rest sample. These are useful harmonic regression checks, not evidence of
successful visible-rest guidance. Across all 15 songs only **2 of 31 annotated
changes** are detected by the raw evaluator. One Michelle boundary is just
0.040 seconds after its selected scope begins and lacks useful preceding
context; the six fully bracketed changes in the two new songs are all missed.
Gently Weeps' 0.045 seconds of wrong-key exposure is within declared boundary
uncertainty. These caveats do not alter the frozen references after prediction.
No audio was decoded or listened to.

The new `tools/evaluate_harmony_chord_evidence.py` measures grounded harmony
throughout the independently selected annotation regions, alongside the
existing browser-rest check. Both versions share one bounded scoring mask;
boundary uncertainty, unsupported/unknown annotations and N.C. are excluded.
Root-only and multi-note results are separate, and root agreement requires an
actually observed root. Paired reports retain unknown-to-known, known-to-unknown,
changed-root and changed-pitch-set passages, with input and helper hashes.

In the existing 11-song group, 541.323 seconds are scorable for full-interval
chord agreement. The only newly resolved interval inside that mask is Play the
Game's 0.019 seconds: its grounded Am agrees with the reference. Yesterday's
new chord intervals fall outside the safe annotation mask, so their chart
grounding must not be presented as independently verified chord accuracy.
The previous two-song and new two-song groups provide 87.017 and 147.052
scorable seconds with unchanged results. Existing outside-annotation exposure
is 70.750, 4.251 and 10.210 seconds respectively; coarse annotations and chart
extensions can disagree, so these are not automatically wrong-note counts.

In the existing 11-song independent rest check, 3.556 additional seconds of
scale guidance contain the annotated chord tones. The prior 0.769-second
D7/D7sus4 disagreement and all highlighted target checks are unchanged.
The previous two-song rest check is unchanged, and the new songs provide no
rest sample. Chord containment alone does not establish that every extra scale
note is suitable.

### Regression, performance and runtime control

All musical outputs in the separate 53-pack regression corpus are unchanged,
all 18 fixed chord references still match, and timeline bounds, unobserved
chord-tone and scale/chord invariants pass in every comparison. Interior-rest
scale coverage remains 6.46% and any-guide coverage 55.49%. The run's median
backend inference was 244.10 ms for v6 and 238.85 ms for v7 while other validation
ran concurrently; this does not establish a speed improvement or an FPS result.
Inference stays in the existing background job, outside frame rendering.

An independent audit of all 68 pack rows checks all 22 resolved events, totaling
2.739 seconds, against the raw played chord voicings and the unchanged v6
extractor. Every selected anchor is complete and active for the emitted span;
every cited partial voicing is contained and label-incomplete. This establishes
chart grounding, separately from agreement with external annotations.

The focused Python suite passes **364 tests**, including 32 new musical
regressions and 12 independent-evaluator tests. The guide JavaScript suites
pass **95 tests**. Independent implementation review found no remaining
confirmed defect. `chart-harmony-v7` changes the cache identity, requiring one
new analysis before subsequent requests reuse the result. The existing
**3D Highway — Harmony guide (experimental)** setting remains the persistent
on/off control; no new scale configuration or audio analysis is required.

Frozen comparisons, manifests, raw annotations, alignment evidence, full chord
and rest reports, `study-summary.json`, `yesterday-diagnosis.json`, and runtime
verification receipts are retained locally under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-compatible-voicings-20261018`.
The final engine SHA256 is
`a269945bd5a64a2925e735811ce905f0c6b21eecbce3ea0b02464765f59d2642`.
Reproduce a full-interval chord check from a frozen modulation comparison:

```powershell
python tools/evaluate_harmony_chord_evidence.py `
  --comparison <frozen-comparison-directory> `
  --chord-directory <frozen-chord-directory> `
  --output <new-report.json>
```

## v8: grounded section changes and conflicting collections

Two targeted investigations identified different failures. Gently Weeps has
64-beat major sections whose long dominant and predominant chords outweigh
their tonic in the pitch profile. Their incoming dominant-to-tonic connection
was also outside the local analysis window. I Want It All has a repeated
played G natural that contradicts one accepted A-major collection, even though
its G power chord provides no major/minor quality vote.

The new collection override requires an observed tonic, repeated authentic
cadences and tonic returns, a complete played minor ii-V-I progression, strong
pitch fit, resolved distinguishing degrees, and one unique collection fitting
every grounded multi-note voicing. An incoming chord can complete that proof
across at most half an authored beat of empty release; conflicting notes and
uncertain intervening harmony block it. Only after that proof can its cadence
contribute to the selected collection's tonic score. Ordinary window scores
retain their original local cadence evidence. The original profile winner,
margin, constrained score basis and collection evidence remain in provenance;
confidence is capped at medium. Authored contexts beyond the former 48-beat
cap, up to 64 beats, require this explicit collection proof.

A separate conservative check withholds a known key when repeated harmonic
visits contradict its palette and one alternative collection explains all
grounded chords. All seven alternative degrees require independent chart-note
support, while the proposed replacement degrees must lack that support. This
check does not promote a replacement key or scale. Repeated strums, identical
fragments and changing voicings on one opposing root cannot multiply the
counterevidence. Changed actual pitch sets remain visible even when the chord
label does not change. Chord extraction, evidence lifetimes and rendering are
unchanged; no recording or microphone analysis is involved.

### Validation and rejected intermediate results

The first broad candidate incorrectly added 7.502 seconds of G-minor labeling
in Don't Stop Me Now. An isolated ablation traced this to a single incoming
cadence crossing the ordinary score threshold, rather than to the longer
section cap. The final design confines that contribution to the independently
proven collection override. It restores Don't Stop's exact v7 scored durations.
The early candidate and an intermediate version that lost the Gently Weeps
gain are retained as failed development evidence, not reported as final results.

The final frozen `b74f8976` engine was compared against v7 on the previous 15
reference songs plus Come Together. Come Together was selected and aligned
before its initial predictions: 3 fitting and 13 checking raw pitch/onset
anchors, maximum residual 0.0673 seconds, declared uncertainty 0.5 seconds.
Its initial result was unchanged, and final follow-up comparisons are explicitly
development runs. Its 191.344 annotated seconds remain entirely unknown and
all six changes are missed; mainly power-chord evidence remains insufficient.

| All 16 reference songs, 2,039.066 annotated seconds | v7 | v8 |
| --- | ---: | ---: |
| Correct key duration (s) | 646.245 | 713.333 |
| Wrong known key duration (s) | 121.953 | 101.322 |
| Unknown key duration (s) | 1,270.867 | 1,224.410 |
| Key changes within four beats | 2 / 37 | 6 / 37 |
| Unmatched switches in annotated regions | 3 | 3 |

Only the two development targets change scored key duration. Gently Weeps
gains 67.088 correct seconds and matches all four annotated changes. Its added
0.122 seconds of raw disagreement is confined to two major-section entrances,
each within the declared 0.5-second annotation uncertainty. No new wrong-key
span falls outside uncertainty. Major arrivals still follow 8.374- and
12.272-second unknown gaps: matching transition times does not imply continuous
key tracking. The legacy denominator retains Michelle's previously documented
0.040-second edge with insufficient preceding context.

I Want It All loses 20.753 seconds of incorrect A-major labeling by abstaining;
it does not gain a correct replacement key. A later wrong A-major passage
remains because actual G-sharp notes prevent the same veto. The rest of the
annotated songs' scored key durations are unchanged.

All 16 grounded harmony tracks and all eight independent whole-region/rest
chord comparison reports are unchanged. Gently Weeps provides no qualifying
scored interior lead rests; Want It All's removed label is outside its scored
interior rests. These key results therefore do not establish increased playable
rest guidance or general scale suitability. The evaluator now reports per-section
duration and descriptive transition neighborhoods, including unknown gaps and
uncertainty-limited evidence, alongside unchanged legacy metric definitions.

### Regression, performance and controls

The separate 53-pack comparison retains all 18 fixed chord references, with
zero timeline-bound, unobserved-chord-tone or scale/chord invariant failures.
All harmony tracks are unchanged. Two songs gain uncertainty: Everybody Hurts
loses 55.262 seconds previously labeled E minor; Don't Look Back loses 27.244
seconds labeled D or G major. These are regression observations, not independently
verified accuracy gains. Interior-rest scale coverage changes from 6.46% to
6.43%; 1.668 beats switch to chord-only guidance, and any-guide coverage stays
55.49%.

Median backend inference in this paired run was 203.88 ms for v7 and 242.60 ms
for v8; source loading plus inference was 486.89 and 533.24 ms. Other validation
ran concurrently, so these are observed run timings, not isolated benchmarks
or FPS measurements. Analysis remains in the background job and is cached per
song/source revision. `chart-harmony-v8` invalidates the older analysis identity.
There is no per-frame inference and no new scale configuration.

The focused Python checks cover 462 passing tests, including 92 new transition
and collection-conflict regressions and six new evaluator cases. The guide
JavaScript suites pass 95 tests. Independent source review and the final song
audit found no remaining confirmed defect. The persistent **Settings > Graphics
> 3D Highway > Harmony guide (experimental)** setting remains the on/off control;
runtime verification exercises both states and restores the saved preference.

Evidence is retained under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-transition-tracking-20261018`.
Use the `*-final-02` comparisons and
`independent-validation-final-02-summary.json` for final results. Earlier
`*-first-01`, `*-final-01`, and `new-1-initial-01` runs remain immutable.
The final engine SHA256 is
`b74f8976a9c71724373e7cc8e0cb8e9021a519663792aa7269302b7427418c0d`.

## First rest-acceptance study: six previously unused songs

This study evaluates the enabled guide at the place it is meant to help: actual
interior rests in the selected lead chart. The frozen v8 inference engine is
unchanged. The sample contains 47 rests, totaling 345.151 chart seconds, in six
previously unused Beatles/Queen packs. Selection excluded 79 prior pack paths
and 70 normalized titles before any new predictions were inspected.

Human chord/key annotations were aligned using three fitting anchors per song
and 12–19 independent raw pitch/onset checks. The largest check residual was
0.230 seconds; 0.5-second guards exclude uncertain chord boundaries. References,
accepted palette rules, scorer and controller sampler were frozen before the
first inference pass. The source packs and every frozen output are hashed.

The full rest denominator is retained, including unjudgeable passages. Only
216.680 seconds have guarded independent chord references. Of the remaining
128.471 seconds, 121.482 are boundary/missing-annotation uncertainty and 6.990
fall outside the verified alignment scope. This is a convenience sample of
stable conventional major-key labels, with no fresh minor-key or modulation
holdout and no listening validation of improvised notes.

### What the enabled guide supplies

The sampler runs the actual frozen controller, including rest thresholds,
0.18-second fade-in and final-beat fade-out, at 1x with zero A/V offset and no
loop. Availability below is any positive controller opacity; it is not a claim
that every marker is legible. The second profile requires opacity at least 0.5.

| Song | Rest seconds | Full-scale seconds | Chord-note seconds | Blank seconds |
| --- | ---: | ---: | ---: | ---: |
| And Your Bird Can Sing | 41.260 | 41.260 | 0 | 0 |
| Back in the U.S.S.R. | 75.600 | 0 | 67.214 | 8.386 |
| Can't Buy Me Love | 7.375 | 0 | 6.562 | 0.813 |
| Helter Skelter | 58.485 | 40.314 | 9.407 | 8.764 |
| Taxman | 15.534 | 0 | 11.653 | 3.881 |
| A Kind of Magic | 146.897 | 0 | 16.828 | 130.069 |
| Total | 345.151 | 81.574 | 111.664 | 151.913 |

At any positive opacity, full scales cover 23.63% of rest time, chord notes
32.35%, and no guidance 44.01%. Independent reference support covers 64.629
seconds (18.72%); 128.609 seconds remain unverified. At opacity at least 0.5,
the corresponding supported/unverified/blank durations are
63.235 / 120.928 / 160.988 seconds (18.32% / 35.04% / 46.64%).

Only 26.472 strongly visible seconds of the supported output are full scales,
all in And Your Bird Can Sing; the other 36.763 seconds are chord subsets.
Exact agreement with a predeclared palette means annotation compatibility,
not proof that every note will sound good over every voicing. References are
non-exhaustive, so zero explicit conflicts is not a measured accuracy result.
Unmatched scales and additional chord tones remain unverified.

### Concrete findings and development direction

- And Your Bird Can Sing is a positive full-scale example. Its 11.741–24.304
  second lead rest displays E major continuously; 9.525 seconds match the
  independently accepted palette, with the rest lost to boundary uncertainty.
  The chromatic bridges were excluded from palette acceptance in advance.
- A Kind of Magic contributes 85.6% of all blank time. During 70.494–87.781
  seconds, the lead rests and the rhythm chart contains no events, leaving
  76 bass notes as evidence. The analyzer offers tentative roots or unknown
  harmony rather than inventing chord quality. A known song title or lower
  confidence threshold would not supply the missing accompaniment evidence.
- Helter Skelter displays E-major scales for 40.314 rest seconds, but these
  remain musically unverified. Pollack describes a major-key framework with
  blues inflection and predominantly minor-pentatonic melody. Matching the
  conventional key and chord containment does not settle the best scale.
- At 49.706–51.516 and 96.010–97.820 seconds in Can't Buy Me Love, the guide
  includes B-flat from repeated authored C7 voicings, while the coarse reference
  says C. Removing that note merely to agree with the reference would discard
  actual chart evidence. The U.S.S.R. differences similarly need arrangement
  or listening adjudication, rather than automatic treatment as errors.

Musicological context: [And Your Bird Can Sing](https://awpnoteson.info/notes/aybcs.html),
[Helter Skelter](https://awpnoteson.info/notes/hs.html), and
[Taxman](https://awpnoteson.info/notes/t.html). These analyses support the frozen
exceptions; they are not timestamped expert approval of every suggested palette.

The feature is plausible as an optional practice aid, but this study does not
establish generally reliable automatic scale choice. The next inference work
should separate blues/modal palette choice from key naming and investigate
bounded section context or reviewed authored palettes where accompaniment is
missing. Globally relaxing confidence would obscure both problems. This study
makes no inference changes and keeps the persistent experimental toggle.

### Native acceptance and a separate seek correction

Native playback confirmed chord-note display, a full F-major scale in a Yesterday
interior rest, removal at note re-entry, and the on/off control. It also exposed
a paused backward-seek defect: chart time moved to 27.739 seconds, while the
native presentation snapshot still held 34.215 seconds. The panel followed the
new time but the rest highlights followed the stale screen time. Resuming
playback restored agreement, establishing a timing problem independent of
musical inference.

After a successful still-owned seek, transport now clears the preceding native
presentation snapshot and terminal flags, using the committed seek position
until fresh output arrives. Failed and superseded seeks preserve the current
owner's state. The focused transport/native-owner/highway/loop checks pass 214
tests, including forward/backward paused seeks and a transport-to-rest-gate
regression. The guide suites pass 95 tests. The private scorer passes 28 tests;
10 sampler fixtures match 2,847 direct controller observations. These are
software checks, not musical-accuracy measurements. The paused FPS counter is
throttled and is not used as a guide performance benchmark.

Evidence is retained under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-rest-acceptance-20261018`:
`study-summary.json`, immutable `frozen-v8-results`,
`independent-acceptance-audit.json`, `independent-frozen-v8-review.json`, frozen
references, native captures and the follow-up runtime acceptance record.


## Follow-up: blues vocabulary and missing accompaniment

The follow-up investigated both proposed directions against the same six-song
rest study and sixteen previously used modulation/control songs. These are
22 development/regression songs with 135 interior rests, not a new accuracy
holdout. Rules, code, source hashes and tests were frozen before each corpus
run. The guide was enabled in controller measurements; the user's saved toggle
was not changed. No audio was decoded, listened to, or analyzed in this study.
The v8 production engine and runtime remain unchanged.

### Bounded retention did not improve actual rests

The private bridge only filled gaps of at most two authored beats and two
seconds between identical supported scales, within one known key and canonical
section, with continuous compatible pitched sustains. It preserved all key and
chord tracks. Eighteen focused tests covered boundaries, conflicting evidence,
missing context and all twelve transpositions.

Across the 22 songs it admitted eight tiny gaps totaling 0.851 seconds, in
Something, Hello, Goodbye, and Michelle. Every gap fell outside an eligible
interior rest: **zero additional visible guidance**. Independent review compared
complete displayed state over rest intervals, not just aggregate coverage, and
re-ran the unchanged primary scorer for all six development songs. Their scores
are exactly unchanged. No thresholds were loosened after seeing this result.

A Kind of Magic has no supported v8 key or scale anywhere in the chart, leaving
no reliable scale to carry forward. The source audit found exactly bass, lead
and rhythm arrangements, with maximum-difficulty reconstruction and sustains
already included. There is no omitted piano, pitched vocal, or authored harmony
track to load. During 70.494-87.781 seconds there are 76 bass notes and no
sounding lead/rhythm notes, chords or handshapes. The preceding F#m ends at
67.728 seconds; independent annotations then pass through E, D6, A, D and A.
Carrying that chord would misdescribe the passage. The chart's coarse intro and
outro section markers supply no missing interior tonal structure.

### Lead-chart vocabulary does not recover the missing vocal evidence

The second private diagnostic searched selected lead notes on both sides of
each rest for minor-pentatonic, Dorian and Mixolydian vocabulary. It required a
single known v8 tonic across the entire context, repeated distinctive degrees,
at least twelve isolated attacks and four pitch classes on each side, and at
least 95% onset and articulation-weight fit independently on both sides.
Technique-marked or uncertain notes and simultaneous chord attacks were
excluded. The blues probe additionally required repeated other-arrangement
voicings containing the tonic, major third and fifth. This containment does not
prove a tonic-major chord root: for example, a vi7 voicing can contain that triad.
Sixteen focused tests verify the diagnostic mechanics, not musical correctness.

Only 12 of 135 rests have the required stable tonic context, 18 have adequate
lead-note evidence on both sides, and just three satisfy both conditions. No
rest passed a candidate vocabulary rule. This establishes no new usable
automatic palette; it does not prove that all melody-based analysis is impossible. The strict
isolated-note proxy also discards valid expressive notes and cannot establish
that a style continues through the intervening rest.

The five Beatles development packs contain empty vocal note/chord arrays and
lyrics with timing, duration and words only. They contain no pitched vocal
transcription; the Queen pack has neither vocal nor lyric data. The missing
melody is therefore absent from these source packs, not dropped by the adapter.
At the Helter Skelter rest around 61.666-84.212 seconds, nearby charted lead
notes fit E minor pentatonic at only 66.7% of attacks on each side and include
F-sharp, C-sharp and both kinds of third. Substituting this guitar part for the
vocal melody would conflate different musical roles.

[Pollack's Helter Skelter analysis](https://awpnoteson.info/notes/hs.html)
describes a major-key harmonic setting and a largely minor-pentatonic vocal
line, including an exception in the introduction. His
[Taxman analysis](https://awpnoteson.info/notes/t.html) leaves Dorian versus
Mixolydian unresolved. These are useful analytical constraints, not timestamped
approval of every suggested improvisation note.

### The current display policy also needs an explicit musical distinction

A separate characterization of the unchanged browser model passed 360 cases
(ten scenarios, twelve roots, three source origins), plus three editor cases.
Both local corrections and automatic scales must contain every known chord
tone. Consequently E minor pentatonic over E major is rejected, as is C major
pentatonic over F major. E Mixolydian over E7 is accepted. Adding a blues
candidate to the backend alone would not make it display through this policy.

An explicit compatible scale *does* display over tentative root-only harmony;
the backend's scale generation is stricter and requires at least two grounded
chord tones and non-low confidence. The first characterization probe incorrectly
expected root-only harmony to suppress an explicit scale. Its failed assertion
and source were retained, then the expectation was corrected without changing
production code. The sparse prototype's admitted gaps resolve successfully in
the controller; their zero visible gain is due to rest placement.

The decision is to promote neither prototype. Further progress needs an
explicit, reviewed per-section practice-scale contract that is distinct from
chord-contained guidance, with its source and chord-target behavior defined.
Blues cross-relations cannot be represented by merely removing all compatibility
checks. The existing local editor supports named scales but currently applies
the same containment policy; it is not yet a solution for these blues examples.
Automatic choice should be evaluated against independently reviewed audible
passages before being extended. No live audio listening is implied by this
recommendation. The experimental 3D Highway setting remains the feature gate.

Evidence is retained under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-palette-context-20261018`:
`independent-acceptance-protocol.json`, `sparse-conclusion.json`,
`sparse-frozen/protocol.json`, `sparse-results/summary.json`,
`independent-sparse-results-review.json`, `modal-freeze.json`,
`modal-results.json`, `modal-conclusion.json`, the per-song modal diagnostics,
`independent-modal-contract-review.json`, and
`contract-probe-output-02/report.json`. Earlier frozen acceptance references
were not changed. This is a documented negative result and source/contract
audit, not a claimed improvement to automatic musical accuracy.
