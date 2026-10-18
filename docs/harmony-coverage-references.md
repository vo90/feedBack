# Fresh reference cohort, frozen before v5 predictions

The reference and alignment manifest were frozen at **2026-10-18 16:07:07 UTC**.
No v5 predictor was invoked or its outputs inspected during preparation. Only
cohort readiness, broad scope and hashes were shared until the engine was frozen.
After its first evaluation this cohort must become development data if it informs
implementation changes.

The first frozen v5 comparison is reported in
[modulation validation](harmony-modulation-validation.md#first-v5-evaluation-on-three-fresh-songs).
Machine-specific alignment manifests and audit scripts are kept under the
workspace-relative `verification/songsterr-harmony-coverage-20261018` directory.

- Reference SHA-256: `bf881bed8fa2d2578a383a8b4264dd598147c66c2aa6a8ba8647b5bafdc132af`
- Alignment manifest SHA-256: `0b0fb685cac723280213e4e49660f881554d46c7c772bfc45762b9f6c12a9e55`
- Three packs, 453.242046 seconds on the external reference recordings, and three
  unambiguous key-change boundaries. Affine timing transforms mean scored chart
  seconds differ slightly from this reference-recording total.
- All three pack paths are absent from the prior 53-pack development manifest and
  six-song modulation manifest. Their original hashes are recorded in
  `reference-provenance.json`.

## Selected factual ranges

| Song | Selected external reference interval | Reference | Purpose |
|---|---|---|---|
| Queen — Bohemian Rhapsody | 49.160–169.860 s | Bb → Eb → Bb → Eb major | Ballad changes and return; sparse chart-quality evidence |
| Queen — Don't Stop Me Now | 0.563–187.365 s | F major | Stationary tonic with secondary/chromatic harmony |
| The Beatles — Hello, Goodbye | 3.059795–148.799841 s | C major | Stationary tonic with borrowed harmony |

The precise boundaries come from [Isophonics human reference annotations](https://isophonics.net/content/reference-annotations).
Queen key annotations are moderate-confidence curator judgments; Beatles files
can omit changes. Independent original musicological writing corroborates the
selected tonal interpretation:

- [Nick Braae, *Structural and Rhetorical Closure in 1970s Rock Songs*, March 2026, section 5.1](https://www.mtosmt.org/issues/mto.26.32.1/mto.26.32.1.braae.html)
  describes the Bohemian Rhapsody verses moving between Bb and Eb. This supplies
  no timestamp precision. Later opera, rock and coda regions are excluded.
- [Nick Braae, *Queen's Don't Stop Me Now*, 12 April 2013](https://nickbraaemusic.wordpress.com/2013/04/12/queens-dont-stop-me-now/)
  identifies F major and discusses chromatic departures within that framework.
  The final piano/fade region is excluded.
- [Alan W. Pollack, *Notes on Hello Goodbye*, number 120, 4 November 1996](https://www.icce.rug.nl/~soundscapes/DATABASES/AWP/hg.shtml)
  ([readable mirror](https://awpnoteson.info/notes/hg.html)) treats Ab/Bb chords as
  borrowed harmony within C. The opening chord ambiguity and later outro/coda
  are outside the selected, anchor-bracketed interval.

The original Isophonics redistribution license is unspecified. The private
verification folder contains the locally downloaded annotations for audit; no
archive, complete chord transcription, chart or audio is added to tracked
repository documentation. Per-file source URLs, members and hashes are in the
reference JSON and candidate metadata. This note paraphrases limited factual
observations and reproduces no song lyrics or score images.

## Independent timing and pitch checks

Raw chart data was read through `harmony_source.load_harmony_source`; no harmony
analyzer was imported. Manual published-chord/chart-event correspondences were
chosen before predictions. Five fit anchors per song establish
`chart_time = chart_offset + reference_time * rate`; three, two and one additional
check anchors, respectively, validate the fit without determining it.

| Song | Chart offset | Rate | Maximum residual, all anchors |
|---|---:|---:|---:|
| Bohemian Rhapsody | 12.652653788 | 0.9978037363 | 0.053644 s |
| Don't Stop Me Now | 12.115711398 | 0.9983421958 | 0.097808 s |
| Hello, Goodbye | 3.901081096 | 1.0003747810 | 0.027081 s |

The manifest records every reference chord, raw chart evidence ID, sounding pitch
classes, fit/check role and residual. All use zero pitch transposition. Declared
timing uncertainty is conservatively **0.5 seconds**. Affine rate differences
describe chart-to-annotation timing only; they do not establish an acoustic
mastering or playback-speed cause. No audio was decoded or listened to.

Bohemian Rhapsody alignment uses bass-root sequences because the selected chart
has sparse guitar-quality observations. These anchors establish timing and
pitch correspondence; they do not manufacture major/minor quality for the
analyzer. Legitimate abstention on missing accompaniment remains possible.

`prepare-reference-sources.py` reads source packs and extracts annotation members.
`freeze-reference-cohort.py` validates raw anchors and writes fresh files using
exclusive creation. The frozen source adapter and scripts, whole-pack hashes,
archive hashes and normalized sources support audit and reproduction. Raw chart
extraction files are not predictor outputs.

## Selection limits and reporting

This is a small purposively selected set of three songs from two artists, with
all modulation boundaries concentrated in one sparse chart. It is neither a
population sample nor an independent listening study. Play the Game was excluded
because its bridge interpretation and timing were less secure; Hey Jude lacked
a timestamped archive member; Somebody to Love was already development data;
We Will Rock You was unsuitable as a stationary whole-song control. No exclusion
used prediction performance.

Report reference agreement, incorrect known-key duration, abstention, transition
timing and rest visibility separately. Exact diatonic collection agreement is
not evidence of the correct tonic. A pentatonic subset agreement is weaker still:
it identifies set containment, not the best palette or safe sounding notes over
each recorded chord. Conversely, a contextually valid chromatic/harmonic-minor
palette may fall outside the reference's conventional diatonic collection.
Chord-fallback visibility is availability, not independently verified chord
accuracy. The stationary controls intentionally contain chromatic harmony, so
their conventional key cannot serve as per-chord scale-suitability ground truth.

Default lead-chart rests, maximum-difficulty event selection, four-beat minimum
and browser-model gating define the rest denominator; other arrangements,
difficulties, thresholds and loops can yield different visibility. Fade opacity
and an end-user's actual settings are not measured as rendered pixel visibility.
