# Stable camera passage planning

> Historical behavior and validation. Current Stable lane selection, arrival
> timing and fixed-centre fitting are specified in [Stable camera lane following](highway-camera-lane-follow.md).

## Objective

Keep the Straight and Angled presets close to the current playing area without
following every small lane change. Reduce both the size and frequency of zoom
excursions, preserve playable geometry and fixed preset orientations, and keep
camera work from causing playback stalls.

The preferred composition remains the midpoint of the first four fret columns.
It is a preference with a readable tolerance, not an instruction to recenter on
every anchor. Chart data, visible lane bounds, audio and scoring stay unchanged.

## Implementation sequence

1. Make visibility fitting cheaper: solve fixed-centre distance directly from
   the frustum inequalities, with numerical equivalence and projection tests.
2. Separate chart-static attack preparation, reusable region geometry and
   transition timing caches. Repeated lane shapes must not repeat projection
   solves; smoothing changes must not rebuild chart analysis.
3. Select camera compositions across neighboring regions. Hold through small
   readable shifts; share a composition through short reversals when both
   areas remain readable; retain necessary sustained and remote changes.
4. Coordinate anticipated distance with the same lateral trajectory. Expire
   outgoing region constraints at their boundary while preserving actual
   continuing sustains. Merge nearby widening requirements and settle before
   returning to a close view.
5. Validate the production renderer in both presets using synthetic public
   fixtures and the privately supplied Back In Black passage. Keep diagnostic
   observations read-only so they cannot invalidate camera caches.

## Acceptance

- Fixed areas and small neighboring adjustments do not cause repeated pans.
- Brief excursions reduce lateral travel/reversals where a shared view fits;
  distant sustained playing positions still receive their own composition.
- Required notes, labels, slides and holds remain visible throughout moves.
- Straight and Angled retain their own fixed projection and framing.
- Check zoom peak, number of excursions, total variation, return speed, note
  size and clipping across frame rates, playback speeds and viewports.
- Normal playback keeps stable plan identities. Measure warm camera CPU and
  expensive invalidation separately, including a dense synthetic chart.
- Run relevant JS regressions, renderer acceptance, syntax and lint checks.
  Record limitations; isolated CPU timings do not prove native GPU/audio frame
  pacing. No live runtime/library changes are part of these isolated tests.

## Baseline

The starting Songsterr core revision is `5faaf14`. In the reported passage the
Straight camera reached 2.35 times its normal distance. The investigation's
boundary-limited forecast prototype reached 1.86 times, but left the lateral
excursion unchanged. Routine camera CPU was about 0.2 ms in either preset;
forced full projection-plan rebuilds on a 50,000-note synthetic chart were
215-608 ms. These are local diagnostic results, not universal budgets.

## Delivery

Implement and review on `fix/stable-camera-passage-plan`. Keep private chart
data and generated diagnostic output outside the repository. Record final
changes, validation results and remaining limitations here before delivery.

## Implemented behavior

- Hold a readable centre through changes within 30% of a playing-area width
  (about 1.2 frets for a four-fret lane). Accumulated migration still causes a
  move; persistent distant positions retain their own stops.
- Inspect at most 32 neighbouring regions / 1.5 real seconds for a brief
  reversal. Where the actual Straight or Angled projection permits it, use a
  shared composition with at most 25% extra standalone framing distance. This
  is an admission budget, not a cap on essential visibility corrections.
- Keep the first-four-fret midpoint as the preferred composition. Shared
  passages must also satisfy the accumulated focus bounds of every shared
  member and full-region visibility tests.
  A late flourish creates a local preparation stop instead of changing a
  long-held camera position throughout the earlier song.
- Prepare the distance needed at the chosen shared centre, including local
  preparation stops inserted inside a long region. Anticipate lateral
  movement by 400 ms, capped at the outgoing region's boundary. Actual notes,
  slides and surviving sustains remain protected by live geometry fitting.
- Preserve the existing quiet period and finite zoom return, including its
  nearby-region return floor. A safety correction preserves controller
  velocity rather than converting a corrective displacement into velocity;
  the old division by frame delta caused cadence-dependent zoom overshoot.
- Fixed-centre visibility fitting takes one pass over the support points.
  Chart attack analysis is cached separately from geometry and timing. Fit
  repeated fret spans once; reuse timed region objects on projection changes.
  Smoothing adjustments do not rebuild chart analysis or projected geometry.

## Validation record

The reported passage was replayed against baseline `5faaf14`. At 60 FPS:

| Measurement | Straight: before -> after | Angled: before -> after |
| --- | --- | --- |
| Lateral travel, fret widths | 37.02 -> 27.01 | 38.02 -> 29.66 |
| Peak distance / initial close distance | 2.35 -> 1.77 | 2.76 -> 2.22 |
| Minimum imminent fretted-gem width at 1920 x 1032 | 16.1 -> 20.0 px | 15.1 -> 17.7 px |

The passage retains one zoom excursion, with less total zoom movement; it does
not alternate between closing and widening through the rapid lane changes.
At 30/60/120 FPS the Straight peaks were 1.760/1.769/1.786 and Angled
2.217/2.219/2.246. The isolated camera CPU remained around 0.2 ms for this chart.
These are measurements of this fixture and machine, not universal guarantees.

Final validation after both review fixes:

- 1,081 highway JavaScript tests passed, including exact-fit equivalence,
  cache invalidation, repeated-share focus and local zoom preparation.
- 78 existing playing-area browser cases passed.
- 42 paired before/after scenarios (84 runs, 39,804 frames) passed motion,
  visibility, cache and cadence checks. Coverage includes both presets,
  30/60/120 FPS, left-handed/wide layouts, and half/double-speed reversals.
- Selected overlap and return captures were visually inspected in both presets.
- Independent source review found no remaining actionable issue. All 10 changed
  JavaScript/CJS files pass syntax checks; `git diff --check` passes. ESLint
  was unavailable in the installed dependencies, so no lint result is claimed.

The existing browser audit was corrected to read the renderer's cached region
without changing chart identity. Its floor-selection and width-preparation
checks were also corrected: the same 63 failures reproduced on the unmodified
baseline, and the corrected checks passed on baseline and candidate.
The renderer harness disables GPU submissions during deterministic sampling;
selected captures use the real renderer. CPU diagnostics are separate from
visibility and motion assertions. Private chart fixtures and recordings are
kept outside the checkout and are not part of the change.

## Remaining performance boundary

Normal playback performs bounded visibility work and does not rebuild the
whole chart. The dense stress fixture contains 50,000 notes and 56,935 regions;
its projection settings and playback-rate changes can still exceed a 16.7 ms
frame despite large improvements. A true chart replacement also rebuilds
musical regions and attacks. Guaranteed sub-frame invalidation for arbitrary
chart sizes would require incremental/background planning and is not claimed
by this change. Native runtime GPU/audio frame pacing needs a live play test.

## Dominant playing-area refinement

The Enter Sandman example at about 4:44 exposed a different composition issue:
a readable held view can remain biased toward a previous position even when a
repeating riff spends more time elsewhere. Chord-lane metadata can split an
unchanged playing area into short rows, hiding its true duration from the
detour policy.

The refinement belongs in cached passage preparation. Consecutive equivalent
geometry contributes continuous dwell time; repeated or sustained playing
positions establish the preferred resting view. Lower fret numbers are not an
unconditional preference. A main riff at frets 5–8 with a brief downward slide
must retain its main position just as a lower riff with a brief higher reach
should favour its lower position. A slide endpoint alone must not win focus.

The preferred view must fit the passage at its existing distance, respect the
playing-area focus bounds, and preserve essential note/slide visibility. A
local correction must not rewrite distant earlier camera history. Warm frames
must reuse the prepared plan without repeating the dominance analysis.

Acceptance includes the private reported passage, symmetric inherited-position
cases, short downward slides, equivalent metadata fragmentation, balanced
alternation, sustained relocation, mirrored layouts, speeds and viewports.
Compare absolute distance as well as zoom excursions, resting-centre error,
pan travel/reversals, label/note visibility and cached-plan identity.

The implementation scores up to four real seconds / 32 compacted spans. A
position needs at least 2.4 seconds and 60% of the window to establish a
preference; spans shorter than 300 ms and slide destinations without a new
pick cannot vote. They still constrain visibility. A retained preference loses
support below 50%, giving it a separate release threshold.

This pass only corrects an inherited held view. Existing deliberate camera
stops retain their timing, and an upcoming original stop bounds the correction.
The new centre must offer a meaningful improvement and fit every member's own
existing distance budget. It cannot spend extra zoom to reach its ideal centre.
Equivalent metadata rows are compacted before scoring, and prepared attack
evidence, shape fits and camera plans are reused during normal playback.

Review added regressions for slow playback where the original camera already
follows correctly, loss of dominant evidence without a competing winner, and
an original stop inside the final compacted span. The final span must retain
its explicit end even when no later span exists to close it.
The support denominator ends at the last picked span in the bounded window;
an empty future tail must not dilute a continuing riff and trigger an early
return. Unpicked gaps inside the evidence window, explicit position changes
and all visibility constraints remain effective.
Support-loss release also needs at least 2.4 seconds of observed evidence,
so a final short reply cannot undo the established composition by itself.

The isolated Node planner diagnostic with picked notes measured warm evaluation
at approximately 0.003–0.016 ms for baseline and candidate, with no plan rebuilds.
Median cold preparation for 1,000 synthetic rows was about 7–12 ms before and
9–16 ms after. At 50,000 rows it was about 337–395 ms before and 443–513 ms after.
The additional analysis runs only during preparation; these CPU diagnostics
do not measure native rendering/audio frame pacing or guarantee sub-frame
rebuilds for large charts. The final boundary cap does not change that workload.

Validation against the current Songsterr baseline, including its optional
let-ring trail policy:

- 1,099 highway JavaScript tests and 78 existing playing-area browser cases
  passed. Independent review found no remaining actionable issue.
- Final acceptance compared 98 newly replayed candidate scenarios with 98
  unchanged baseline scenarios, covering 162,916 frames. All visibility,
  composition, provenance and frame-cadence checks passed, with no added pan
  reversals or zoom events. Maximum added distance was only the solver's
  1e-7 tolerance. Short finishing slides produced zero pan.
- The original Back In Black interval and public high-slide regression passed
  eight paired runs with exactly unchanged sampled camera positions/distances.
- The reported Enter Sandman interval and short downward slide passed 24
  targeted paired runs across both presets and half/normal/double playback
  rates. The finishing-slide check includes actual rendered path vertices.
- At normal speed, the reported interval's mean lower-area centre error fell
  from 3 to 0.168 frets in Straight and from 3 to 1.941 in Angled. Each made one
  correction with no added pan reversal or zoom event. Angled stops short of
  the ideal centre to retain its existing zoom budget. Half-speed following
  remains unchanged; double-speed Angled avoids a needless correction.
