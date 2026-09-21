# Planned stable-camera transitions

The playing-area camera previously centred every meaningful lane change only
after it arrived. In Six, the 58.612s high-fret area lasts 0.601s before a much
lower position; following each midpoint caused an unnecessary reversal and
additional zoom. The 158.305s lane extension lasts 0.315s and also caused an
avoidable out-and-back movement.

## Musical regions and camera stops

`hwyBuildPlayingRegions` still supplies the unchanged effective lane, gold
frets and playing position. `hwyBuildCameraStops` derives camera stops from
these regions without changing chart notes, timings, sustains or lane bounds.

For a region shorter than 0.75 real seconds, it examines at most 32 following
regions within 1.5 real seconds. An opposite-direction detour or a one-sided
extension may share the previous camera centre if its displacement is bounded
by the area's width and its full footprint fits readably. Equal consecutive
centres coalesce. Longer positions and continued movement along the neck still
receive their own stops. A genuinely remote brief position is not discarded.

The footprint test includes the string stack, gold-number band and both lane
edges in the selected projection. Sharing may require at most 1.35 times the
distance needed by the region's own centred view. This is a relative readability
budget, not a universal claim about the minimum legible pixel size of a gem.
An inherently broad position may still require a wide view.

## Motion

`hwyCameraPlanAt` evaluates a compact quintic transition 0.5 real seconds before
each accepted boundary. Ordinary duration is 0.5–0.7 seconds according to the
existing camera-smoothing setting (0.6s at default). Moves larger than a whole
playing area receive up to 0.4 additional seconds, reducing lateral speed and
keeping old-position content readable. Default moves therefore finish 0.1–0.5s
after the boundary, depending on distance.
Overlapping transitions combine continuously in position, velocity and
acceleration. There is no per-frame restart and no additional pan lag filter
during ordinary playback. The result is deterministic at the same song time,
including when seeking into the middle of a transition.

Lifecycle changes that alter a plan, and resuming Follow, use a short critically
damped catch-up that preserves continuity and releases its offset completely.
Pause/Follow off hold the pose. Resize preserves the current centre, fits the
new viewport, then rejoins any reclassified plan smoothly. Preset changes and
explicit seeks retain their intentional reset behaviour. Free Camera offsets
are still applied after the automatic pose.

Camera stops are cached by effective-region identity, playback rate, projection,
handedness, string count, text size and smoothing. Explicit playback rates are
honoured exactly. Estimated rates use a small dead band so coarse audio ticks
do not rebuild or reclassify the plan repeatedly. Teardown releases the cache.
Ordinary evaluation uses a binary lookup and only the finite transition window.

## Visibility and zoom

Actual notes, trails and chord/technique geometry remain protected. Imminent
area footprints are included up to 0.8 real seconds ahead, even during rests,
so zoom can prepare with the lateral transition. Geometry prediction is 0.5
seconds. It affects fitting, not the selected camera stop.

If unanticipated geometry makes the shared view need over 1.35 times the
distance of the current area's view, a limited smooth correction moves toward
the nearest feasible centre between those two positions. It does not redirect
the camera beyond the current musical area. The correction decays afterward.
The final actual-geometry guard can widen immediately if required; slower zoom
return and a settling delay avoid repeated contraction between nearby events.

These exceptions preserve visibility but cannot promise a completely motionless
view for incompatible, widely separated positions. Manual offsets can also
intentionally move content outside automatic framing.

## Verification

The pure planner tests cover short detours, return trips, progressive changes,
width extensions, readability rejection, mirrored coordinates, frame rates,
playback speeds and continuity. Controller tests cover geometry protection,
readability recovery, lifecycle catch-up, resizing, seeking and audio/display
clock separation. Browser acceptance runs the production renderer, including
the two reported Six passages and full Six/Runnin' Wild in both presets.

This branch is for separate visual acceptance. It does not merge or publish
the changes to integration or RS+.

### Implementation validation, 2026-09-21

- All 840 highway unit tests passed. ESLint reported no errors and the existing
  large-file warning for `screen.js`.
- All 90 production-renderer scenarios passed (45 per preset), including full
  Six and Runnin' Wild, the two reported Six passages, and selected Bon Jovi,
  Amon Amarth, Extreme and DragonForce passages. These use deterministic
  simulated frame times and actual rendered geometry; GPU submissions occur
  for captures. Four additional GPU-recorded passage runs were reviewed.
- In Six at 58.2–61s, peak lateral speed fell from 2.321 to 0.898 world units
  per second, and the unnecessary reversal disappeared. Maximum camera
  distance fell from 1.417 to 1.035 in Straight and remained approximately
  1.17 in Angled. The temporary width change at 158.0–158.7s caused no pan.
- Coverage includes 10–120 FPS, half and faster playback speeds, mirrored
  layouts, four/seven strings, rests, wide positions, slides and sustains,
  controls, seeks and chart replacement. This is regression evidence, not a
  guarantee of subjective comfort or legibility for every chart and display.

The tested renderer's SHA-256 after normalizing CRLF to LF is
`5f3b9127bf54ae44225c7fc886b7cf351634969f0b5dce1c80c4dda72baddd96`.
