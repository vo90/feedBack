# Stable camera lane following

This is the current lateral-camera policy for Stable Straight and Stable
RS+-inspired (Angled). Other camera modes keep their existing behavior.

## Camera positions

The shared effective lane timeline remains authoritative for lane rendering,
chord boxes and labels. A separate camera timeline merges metadata-only
boundaries and same-base width changes. Durations are measured in original
song time, independent of playback speed. A lane lasting exactly 500 ms counts
as lasting; only whole excursions shorter than 500 ms can be suppressed.

The preferred centre remains between the middle two columns of the normal
four-fret lane. Extending the upper edge does not change this centre. Geometry
fitting cannot replace that position with a shared midpoint or a tolerance
hold. Longer relocations, including whole-chord relocations, are followed.

A short excursion returning to its home lane holds that home centre, even if
its note is at fret 24. Short ordered intermediate positions remain waypoints
in a continuous journey. A short off-route group between adjacent lasting
positions can be bypassed: 9 → 13 for 251 ms → 8 follows 9 → 8 and fits the
13th-fret notes. An intervening lasting lane is never skipped. Optional lower
fret bias for ambiguous alternating riffs is deferred.

The longer riff-variation exception requires positive local evidence. The
immediately previous and next complete measures must match, and the middle
measure must match their attack timing, strings, durations, techniques and
chord shapes except for exactly one isolated higher single note. That note
must occupy the outlying lane alone, sustain over 500 ms, and return to the
same home lane. All three measures must stay in one section. Missing structure,
uncertain matches, multiple changed attacks and chord relocations follow the
longer lane. This deliberately conservative detector does not guess a root.

## Movement and visibility

Non-overlapping quintic Hermite segments reach each lasting lane at its onset
with zero velocity and acceleration. Short progressive waypoints share a
bounded velocity, so the camera continues through them without overshooting.
Default ordinary preparation is 700 ms at the default smoothing setting;
large moves can prepare up to 400 ms earlier, and quiet holds can prepare up
to 1.2 seconds early. Preparation never starts before the preceding lasting
arrival. Closely spaced destinations compress the movement into available
time, including at faster playback speeds.

Rate changes during travel resume from the actual pose and velocity toward the
lasting destination. If slowing playback requires an earlier finish to avoid
overshooting, the camera holds there until the scheduled arrival rather than
backtracking to a delayed nominal path. Other lifecycle corrections end by the
next lasting arrival. Equivalent cache rebuilds and numerical rate jitter do
not restart them. Explicit seeks retain deterministic reframing; pause and
Follow off hold the pose and preserve a pending destination for resumption.

Every visibility solve uses the scheduled horizontal centre. The renderer
fits actual playable geometry and labels with the existing fixed preset
orientation and minimum required distance; there is no lateral safety pan or
percentage zoom budget. Smooth anticipation and a gentle return can retain
more distance than the instantaneous fit. Closely repeated excursions hold
the necessary width through the existing return delay instead of pumping.

Chart analysis, projected lane shapes and timed movement have separate caches.
Playback-speed changes reschedule movement without changing semantic decisions.
Per-frame trajectory sampling uses binary search; chart scans happen only on
cache rebuilds. Teardown releases the camera timeline and chart references.

## Verification

Unit coverage includes metadata fragmentation, 499/500/501 ms boundaries at
multiple speeds, full excursion duration, progressive travel, overshoots,
positive and rejected motif evidence, exact arrivals, lifecycle continuity,
fixed-centre projection, minimum necessary zoom, return behavior and caches.

`tests/browser/highway-camera-lane-follow.cjs` runs the production renderer in
isolated Chromium with synthetic fixtures and optional private Lead charts.
It accepts `--songs Name=path`, `--root`, `--source-ref` and an external output
directory. Private charts and generated evidence are not committed. Acceptance
uses Ghost's converted Absolution Lead (294.238 s) and Rats Lead (345.908 s),
both presets, playback speeds, viewports and exact effective-lane boundaries.
The reported Absolution regression is the lane beginning at 15.359 s, whose
1.227-second duration was incorrectly fragmented at 15.851 s.

### Validation, 2026-10-19

- Full JavaScript suite: 2,774 passed; eight unrelated failures reproduced on
  the unchanged integration baseline (three absent venue-media checks, one
  audio-barrier source assertion, two ghost-note source assertions and two
  note-state source assertions). Camera-specific checks pass.
- ESLint: no errors; the existing large-renderer size warning remains.
- Production renderer: 108 synthetic configurations and 24 full-song
  configurations across both presets, 0.5/1/2 speed and wide/portrait views.
  Full-song traces checked 3,300 lasting arrivals without missed targets.
- Final source: 36 targeted cases at 60 FPS, six at 10 FPS, and another four
  full-song runs at normal speed, all passing. The final full-song runs checked
  550 arrivals over 13,622 frames. Speed changes and Follow resumption preserve
  position, avoid an unintended reversal and reach the next lasting target.
- These are deterministic production-renderer/geometry runs in isolated
  Chromium, with GPU rendering for screenshots. They do not claim live game
  frame rates or replace subjective playing feedback. No live runtime or
  source song data was changed.

Normalized renderer SHA-256:
`84c163abb046743b815fe62e925a1f0b79e0783e499e0f375100c925d82f534b`.
