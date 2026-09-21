# Stable camera: playing-position priority

The stable camera previously chose its horizontal centre from the extrema of
everything visible across three chart seconds. An upcoming high fret or floor
label could displace currently played low notes, and changes to those distant
extrema repeatedly restarted the return delay. Matching playback to a direct
seek did not establish that either view followed the current passage.

## Composition and visibility

`stablePlayingFocus` supplies the preferred playing position independently of
rendered bounds. It indexes simultaneous attacks and active sustain intervals
once per arrangement, then queries the current position and a short local
passage. Small, coherent spans of at most three frets share a target, using
0.60 real seconds of recent context and 0.35 seconds of anticipation. A wide
upcoming attack has at most 30% influence while the current note is sounding.

Known-destination slides use their present playable position. Bend height and
targetless slide flourishes do not invent a different fret target. Simultaneous
chord members form one group; open members cannot pull a fretted chord toward
zero. Open-only groups use their authored anchor, bounded nearby fretted
context, or the neutral resting position. Genuine silence holds the centre.
An attack replaces the previous primary tone on the same string, even if an
imported sustain overlaps it. This focus-only endpoint never changes authored
sustain duration or visible trails, and held notes on other strings remain.

The existing 32-bin rendered envelope remains responsible for visibility.
The solver fits at the preferred centre first, widening when necessary; it no
longer redirects composition just to obtain the smallest viewing distance.
Its forecast is 0.35 real seconds. The actual-geometry safety fit also runs
during rests, preserving the centre while protecting an off-axis entry.

A position change outside the comfort band starts a smooth pan immediately.
Once started, it finishes without stopping at the edge of that band. Small
local changes retain the settling delay, which is now driven only by the
playing target. Pan damping uses elapsed time and responds fast enough to
follow a descending slide. Zoom return, pause, Follow off, direct seeking,
fixed preset orientation and manual Camera Director offsets remain supported.

Very wide simultaneous playing positions can still require a wider view.
The camera does not promise a constant distance for every chart. The priority
is a stable composition around current playing, with visibility protection.

## Validation

Unit tests cover resolver indexing, current and distant event separation,
chords, open strings, known slides, rests, playback speeds, left-handed
positions, deterministic seeks, teardown and a 50,000-note query budget.
Controller tests cover distant churn, centre-first widening, rest visibility,
pause/follow/resize, zoom return and continuous pan at 10–120 frames per second.

`tests/browser/highway-camera-current-priority.cjs` exercises the actual
renderer with synthetic passages, controls, viewport variations and optional
private Six / Runnin' Wild arrangements. It checks current-note placement and
size as well as clipping and fixed viewing angles. `--source-ref d038987`
reproduces the old failures. `--compare-ref d038987 --perf` compares camera CPU
cost without a live app. Private charts and generated evidence are not tracked.

Browser playback uses a deterministic clock, full geometry/camera updates and
GPU captures at representative moments. This is functional renderer validation
and camera CPU measurement, not a native audio/GPU frame-rate benchmark.
