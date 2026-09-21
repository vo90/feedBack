# Stable camera: follow the marked playing area

The stable camera now centres on the current playing area: the highlighted
lane and gold fret range at the strike line. Individual notes within that area
do not retarget the camera. This replaces the note-driven policy described in
`highway-camera-current-note-priority.md`.

In Six, alternating open and fretted notes formerly moved the camera despite
an unchanged 2–5 position. Later, the chart changed to 10–13 during a rest, but
the camera waited for the next attack. Both cases now use the same chart
position as the visible lane, including during silence.

## Position data and fallback

`hwyBuildPlayingRegions` builds one deterministic sequence from the effective
chart arrays. Valid authored anchors take priority. Equal consecutive bounds
are coalesced; width changes remain meaningful. The preferred centre is the
midpoint of the outer fret wires, using the current spacing and handedness.

Missing widths default to four frets. Missing, invalid, out-of-neck or exact
whole-neck placeholder bounds use local inference. Genuine broad authored
positions, such as tapping passages, remain valid.

Inferred areas have a four-fret minimum. A simultaneous fretted group can
expand or move the area enough to contain it. Notes already inside the area,
open strings and silence retain it. Known slides can move inferred positions
as they cross fret centres; their final destination is not selected at attack
time. Targetless flourishes and synthetic chord previews do not establish
positions. An overlapping sustain cannot reclaim a string after its next
attack; this rule changes camera guidance only, never sustain or trail data.

Three consecutive out-of-area attack groups within one chart second identify
persistent disagreement with an authored position. An in-area fretted attack
resets that count. Inference then remains in use until a different valid
authored position arrives; duplicate stale anchors do not restart the process.
An isolated outlier remains a visibility constraint. An inferred wide region
can contract after at least three coherent local attacks spanning a chart
second, with no intervening attack gap over a second. These fallback rules
cannot recover a chart author's intent; they provide stable usable guidance.

The stable mode's lane, gold labels and fret-wire highlighting share this
sequence. Other camera modes and the authored anchors used for chord boxes,
techniques and hold guidance retain their existing behaviour. At the strike
line, the floor slice samples the current position rather than the midpoint
of a slice that may extend into the past. Camera targeting uses that same
interpolated display time; raw audio time still drives seek and rate detection.
This prevents a position handoff mismatch between coarse audio updates.

## Motion and visibility

A current-area change starts a damped lateral transition, even during a rest.
There is no preferred-centre anticipation of future anchors. Small overlapping
changes may wait up to 0.2 real seconds if the existing view comfortably fits
the geometry. Continuing shifts cannot keep restarting the delay. Disjoint
changes or threatened visibility bypass it. Pan damping uses elapsed time,
with a 0.3-second time constant at the default smoothing setting.

The current area's full strike-line width, string heights and gold label
extents contribute to visibility fitting even when there are no notes.
Rendered notes, sustains, techniques and chord frames remain additional
constraints. Distant floor slices and unrelated grey labels do not move the
preferred centre. The existing fixed-centre fit can widen the view as needed
and returns gradually when the additional space is no longer necessary.

Straight and Angled keep their fixed orientations. Manual Camera Director
offsets, pause, Follow off/on, resizing, seeking and playback speeds retain
their controls. Manual offsets are intentional changes to the fitted view and
can move geometry outside it.

## Lifecycle and verification

The position index is cached by chart-array identity and counts, string count
and fret spacing. Queries use the existing binary anchor lookup. Handedness
maps bounds without rebuilding the chart sequence. Teardown releases cached
references. Normal frames do not scan or hash the whole chart.

Unit coverage lives in `highway_3d_playing_regions.test.js`,
`highway_3d_playing_region_cache.test.js` and
`highway_3d_stable_camera.test.js`, alongside the highway regression suite.
The superseded note-focus-only tests have been retired.

`tests/browser/highway-camera-playing-area.cjs` exercises the production
renderer with synthetic passages, controls, viewports, timing variations and
optional private song fixtures. It measures lane/camera agreement, visibility,
movement within unchanged regions and resting-area transitions. Baseline
comparison uses `a42a719`. Private charts and generated recordings are not
committed. Deterministic renderer timings are not a measurement of complete
native app performance with live audio and scoring.

Validation on 2026-09-21 passed all 821 highway unit tests and 70 renderer
scenarios (30,470 frames), including full Six and Runnin' Wild in both presets.
The sampled 101.5–107.4-second Six passage changed from 13 lateral reversals
to zero. A quantized-audio-clock regression reproduces the earlier lane/camera
handoff mismatch and passes with the shared render clock. Four representative
chord, bend and slide captures retain identical mesh geometry to `a42a719`.

Wide authored areas or simultaneous holds across a position change can still
require a wider view. The camera frames a playing area rather than keeping
each gem exactly at screen centre. This branch remains separate for visual
acceptance before any integration merge.
