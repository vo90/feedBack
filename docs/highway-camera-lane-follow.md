# Stable camera lane following

This is the current lateral-camera policy for Stable Straight and Stable
RS+-inspired (Angled). Other camera modes keep their existing behavior.

## Camera positions

The shared effective lane timeline remains authoritative for lane rendering,
chord boxes and labels. A separate camera timeline merges metadata-only
boundaries and same-base width changes. Durations are measured in original
song time, independent of playback speed. The adjustable short-excursion
threshold defaults to 500 ms: a lane lasting exactly the threshold counts as
lasting; only whole excursions shorter than it can be suppressed. Zero turns
off brief-excursion suppression. The separate motif/riff-extension protections
retain their established criteria.

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

Non-overlapping quintic Hermite segments reach each lasting lane with zero
velocity and acceleration. The untuned plan arrives at its onset; the optional
long-switch tuning below permits bounded settling after onset. Short progressive waypoints share a
bounded velocity, so the camera continues through them without overshooting.
Default ordinary preparation is 700 ms at the default smoothing setting;
large moves can prepare up to 400 ms earlier, and quiet holds can prepare up
to 1.2 seconds early. Preparation never starts before the preceding lasting
arrival. Closely spaced destinations compress the movement into available
time, including at faster playback speeds. Tuning never shortens that baseline
travel time to make room for a later departure.

### Testing controls

The Stable camera settings, in-song **Camera tuning** panel and per-panel
controls expose five persisted values:

| Control | Trial value | Range | Meaning |
| --- | --- | --- | --- |
| Departure delay | 100 ms | 0–1000 ms | Start a long direct switch later. |
| Extra travel time | 10% | 0–200% | Lengthen that switch's travel time. |
| Maximum settling time | 250 ms | 0–3000 ms | Bound completion after the lane begins. |
| Short-excursion threshold | 500 ms | 0–3000 ms | Ignore shorter whole excursions; original song time. |
| Long switch: minimum fret change | 5 frets | 1–24 frets | Minimum absolute change in the lane's first fret for timing adjustments. |

Delay and settling limits use real playback time. Timing tuning applies to
direct moves between lasting lanes, not progressive chains. Delay and added
duration are reduced proportionally to fit both the settling limit and the
start of the next nominal movement. A zero settling limit preserves exact
arrival. Geometry fitting continues to keep playable notes visible during
the late tail, without moving the chosen horizontal centre.

The **Gentler trial** button restores all five trial values. **Previous tuning**
selects 0 ms delay, 0% extra travel, 0 ms settling, 500 ms excursions, and a
5-fret threshold, reproducing the preceding camera timing. Sliders apply on
release; numeric inputs allow precise values. The settings persist on this
device and work for both Stable viewpoints. Follow off disables the controls.
These are testing defaults, pending the user's tuning feedback. The widened
ranges allow deliberately exaggerated comparisons without changing these
defaults. At +200%, a movement can take three times its original duration.
Raise Maximum settling time when testing large delays or added travel; the
next scheduled movement still limits both proportionally.

The in-song panel opens without pausing playback. Collapse it with its button
or Escape while focused inside it. Its controls consume keyboard shortcuts
while being edited, so adjusting a value cannot seek or pause the song. The
panel updates on settings events, with no per-frame DOM updates or polling;
closing it keeps the saved values. Renderer teardown removes its listeners.

Rate changes during travel resume from the actual pose and velocity toward the
lasting destination. If slowing playback requires an earlier finish to avoid
overshooting, the camera holds there until the scheduled arrival rather than
backtracking to a delayed nominal path. Other lifecycle corrections end by the
next scheduled arrival, including a permitted late tail. Equivalent cache rebuilds and numerical rate jitter do
not restart them. Explicit seeks retain deterministic reframing; pause and
Follow off hold the pose and preserve a pending destination for resumption.

Every visibility solve uses the scheduled horizontal centre. The renderer
fits actual playable geometry and labels with the existing fixed preset
orientation and minimum required distance; there is no lateral safety pan or
percentage zoom budget. Smooth anticipation and a gentle return can retain
more distance than the instantaneous fit. Closely repeated excursions hold
the necessary width through the existing return delay instead of pumping.

Chart analysis, projected lane shapes and timed movement have separate caches.
Playback-speed and timing-control changes reschedule movement without changing
semantic decisions. Changing the short-excursion threshold rebuilds the camera
timeline, while keeping the rendered lane timeline unchanged.
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

### Original lane-follow implementation validation, 2026-10-19

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

Original lane-follow renderer SHA-256:
`84c163abb046743b815fe62e925a1f0b79e0783e499e0f375100c925d82f534b`.

### Tuning controls validation, 2026-10-19

- 167 focused camera, lifecycle, settings and live-panel tests pass. They cover
  the previous timing, bounded settling, uninterrupted progressive runs,
  original-time excursion thresholds, cache reuse, edits during movement,
  input/transport isolation, persistence and renderer cleanup.
- Full JavaScript suite: 2,807 passed; the same eight baseline failures above
  remain. ESLint reports no errors and the existing renderer size warning.
- The frozen motion implementation passed 198 production-renderer cases,
  including both complete Ghost songs, 159,950 frames and 3,642 scheduled
  arrivals. Default and extreme control values passed visibility and movement
  checks. Selected onset framing stayed unchanged or slightly closer.
- A moving-draw CPU comparison found no meaningful added cost between Previous
  and Gentler tuning. It excluded GPU rendering and does not establish live FPS.
- The settings page passes real Chromium persistence, comparison, Follow,
  viewpoint and narrow-layout checks. After adding the live panel, another
  18 production-renderer cases pass, including actual panel edits, A/B buttons,
  keyboard isolation, wide/narrow layout and destroy/recreate cleanup.
