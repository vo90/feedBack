# Close and stable playing-area camera

This follow-up to the planned-transition camera keeps a normal four-fret
composition when a chart's playing position gets wider. It is isolated on
`fix/highway-camera-close-framing`, based on the transition-planning branch
with the RS+ readability changes already merged. It does not change chart
anchors, lane bounds, gold fret numbers, note geometry or Free Camera offsets.

## Composition and visibility

- The preferred centre is halfway across the first four fret columns of the
  effective playing position (or its entire width when narrower). A position
  starting at fret 10 therefore prefers the point between frets 11 and 12.
- Fit the entire current position at the normal close distance. If it fits at
  the preferred centre, keep that centre even when the position expands.
  Otherwise use the closest feasible sideways position at that distance.
  Increase distance only when no sideways position can fit the required span.
- A whole wide position supplies one planned composition, so alternating
  tapping notes do not cause per-note panning. There is no fixed five-, seven-
  or eight-fret zoom threshold: viewport shape, handedness, preset, text size
  and actual projected geometry determine whether the span fits.
- Planned footprints include the string stack and camera-facing gold-label
  corners at the appropriate fret centres. A solid rectangle below the outer
  lane would reserve space for nonexistent corners in an angled view.
- Current geometry and the next 900ms participate in visibility fitting.
  Constraints enter progressively over the outer 300ms and are complete
  600ms before playing, within the renderer's total look-ahead limit. More
  distant rendered notes, grey reference frets and the unused neck do not
  enlarge the close view. They are still rendered normally.
- The secondary geometry fit projects only 150ms ahead. Position planning
  already prepares the next area; projecting it all the way to the strike
  line 600ms early would falsely demand both areas at once and accelerate
  the pan through the safety correction.
- Ribbon edges and mesh edges are clipped into this near window. Long holds
  crossing it are protected even when both original endpoints lie outside.
- Planned framing uses 82% horizontal and 90% vertical NDC limits. A settled
  view can use the space out to 96% before requesting a secondary correction;
  this prevents small bounding-box variations from moving the camera. The
  last-resort geometry check keeps near content within that 96% limit. These
  limits describe conservative geometry bounds, including transparent label
  padding; they do not intentionally clip notes or readable label ink.
- A secondary sideways correction may not oppose a current or imminent
  planned move. During that overlap, preserve the smooth direction and use
  the necessary temporary distance instead of recreating a right/left detour.

## Timing

Normal transitions start **600ms early** and last **700ms** at the default
smoothing setting. Large moves can take up to **1100ms**. The existing finite
quintic easing still has continuous velocity/acceleration and settles exactly;
normal peak speed is about 14% lower than the previous 600ms transition.
Playback-rate conversion, pause, follow-off, seeking and lifecycle catch-up
retain their existing behavior.

After a wider requirement disappears, wait **500ms**, then return over a finite
**800ms** curve at default zoom smoothing. Upcoming wide requirements within
that combined return window can hold the existing distance; they cannot make
it widen early. Increasing requirements cancel narrowing. The zoom smoothing
control scales the quiet period from 400–600ms and return from 600–1000ms.

## Verification

The unit tests cover four-fret centring through persistent five-/seven-fret
extensions, pan-before-zoom, stable wide passages, progressive relevance,
cross-window holds, finite zoom return, conflicting safety pans and the
existing camera lifecycle and projection cases.

The production-renderer browser harness includes Six at 13–16s, 58s and 158s,
full Six and Airbourne runs, other real chart excerpts, synthetic wide/tapping
and sustain passages, left-handed/narrow/ultrawide views, low/high frame rates,
speed changes and Free Camera controls. It checks every frame for near-note
and current-gold-label clipping. GPU captures and optional motion recordings
complement those checks; subjective comfort still needs play-testing.
