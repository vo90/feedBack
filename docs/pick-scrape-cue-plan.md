# Pick scrape technique cue implementation plan

## Problem and outcome

The 3D renderer currently sets a pick scrape's world origin to the live camera
center. Its X, caption and ribbon consequently travel sideways when the camera
prepares the next passage. The large illustrative sweep also resembles a precise
fret-to-fret slide, although explicit Songsterr scrape markings supply strings,
timing and an up/down direction without reliable physical fret endpoints.

Render these events as compact, unpitched technique cues. Preserve the authored
strings, onset, duration, intervals and tied reversals. Use a stable world anchor
and one readable caption for simultaneous matching string gestures. Preserve the
source direction symbol without interpreting it as a bridge/nut instruction.

## Implementation sequence

1. Replace the large direction-dependent path in the shared scrape geometry with
   a small centered texture. Keep the attack cue stationary horizontally; show
   source direction separately in a compact caption symbol. Match the 2D and 3D
   semantics, including the next interval at an exact reversal boundary.
2. Resolve the 3D scrape origin from chart context at its authored onset. Never
   use the live camera, a first-visible-frame snapshot or the hidden scrape fret.
   Share this origin with ribbon and visibility/crossing calculations. Use a
   deterministic fallback when ordinary chart guidance is absent.
3. Group matching simultaneous captions by onset and complete active interval,
   including direction and end time. Preserve every string cue and ribbon, and
   keep separate captions for different timing/direction. Color cues by string.
4. Update the documented contract to distinguish source notation from physical
   playing instructions. Retain existing unscored behavior and source data.
5. Add behavioral regression coverage for camera-independent rendered positions,
   visibility consistency, seek determinism, hidden frets, timing/fades, tied
   reversals, caption grouping, mixed chords and mirrored/inverted displays.
6. Review the change, run focused and full JavaScript checks, make an isolated
   local commit, and apply it to the selected Songsterr integration checkout.
   Refresh the runtime using its guarded plan/apply/seal/check workflow.
7. Inspect the real Enter Sandman lead scrape at 162.335–163.05125 seconds in the
   refreshed runtime. Compare the same ribbon point across the camera transition,
   confirm one caption for A/D strings, and check both normal and mirrored views.

## Acceptance criteria

- Camera movement cannot change any fixed authored scrape point's world X.
- Arbitrary seeks produce the same anchor and gesture geometry.
- Hidden source frets, including absent/sentinel values, never become targets.
- The X does not travel across fret columns as a physical slide instruction.
- The rough trail retains authored time and fades without a destination gem.
- Simultaneous matching strings retain distinct colored cues and one caption.
- Source direction and tied changes remain visible without a new attack.
- Ordinary notes, real slides, scoring and source/library files are unaffected.
- The selected runtime loads the verified source revision and passes its guards.

## Direction boundary

The source enum is explicit, but its physical bridge/neck interpretation is not
established by Songsterr's public notation guide. Guitar Pro's published physical
wording differs from the existing project's higher/lower-fret assumption. This
change preserves the enum and its rising/falling notation, removes that physical
claim, and does not change imported data or introduce endpoint instructions.
