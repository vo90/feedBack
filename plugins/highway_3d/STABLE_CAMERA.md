# Stable camera

Select **Stable comparison** in 3D Highway settings to use **Straight** or
**RS+-inspired** with **Follow hand position**. Existing installations retain
their saved camera mode.

The current behavior contract, module boundaries, control definitions and
acceptance procedure are in
[Stable camera restructuring](../../docs/stable-camera-restructure.md).
[Stable camera lane following](../../docs/highway-camera-lane-follow.md)
describes the earlier lane/timing system.
Earlier descriptions of a lateral comfort zone, pan dwell or tolerance-based
recentering are historical; they do not describe the current Stable camera.

## Comparing the views

- **Straight** uses the saved **Standard straight** framing: distance 0.87×,
  pitch adjustment +9 and vertical pan +10.
- **RS+-inspired** uses **Standard angled**: distance 0.90×, pitch adjustment −1,
  horizontal pan −4 and vertical pan +3, on the 14-degree shoulder angle.
  Both the shoulder angle and built-in horizontal pan mirror in left-handed mode.
- These are built-in defaults; leave Free camera off to use them. Both retain
  a 60-degree vertical field of view, zero roll, constant lens shift and the
  same following rules. Pitch adjustments use Camera Director's target-height
  units: the resulting downward angles are approximately 19.86° and 25.57°.
  Height remains 1× and there is no additional yaw adjustment.
- The playing-area plan retains its existing centres and timing. A final fit
  uses each default's actual zoom, tilt and pan and can widen enough to protect
  visible notes and labels. This also applies on reset, seek and resize, while
  pause and Follow off continue to hold the view.
- Change the preset while paused or playing. **Reset to preset** reframes the
  current passage; it does not seek or overwrite Camera Director preferences.

## Following, timing and visibility

The cached lane plan selects the horizontal centre. Normal four-fret lanes
focus between their middle columns; same-base width extensions and qualifying
riff variations retain that focus. Short returns, repeated lane cycles and
progressive runs use the explicit rules in the behavior contract. Notes,
labels and other visible geometry determine the distance needed to fit;
they do not select a competing horizontal target.

**Start before next lane** and **Arrive after next lane** use original song
milliseconds, labelled **ms at 100%**. Keep the same saved numbers at every
speed: 400 ms before and 50 ms after become 800 ms before and 100 ms after in
real time at 50%. The path stays aligned to the same highway positions.
The tuning panel shows the current-speed equivalent and actual schedule.

**Reach every centre** joins overlapping moves through every retained centre
at its arrival time. Start-before controls departure from a hold. **Follow
latest destination** redirects at each start-before trigger, so an unfinished
centre can be skipped. Both retain the predictable threshold, riff and tapping
rules in the current contract. Legacy preparation/delay/stretch controls do
not govern either path.

The controller uses the meshes already emitted by this frame's renderer:
playable gems, open-string bars, chord frames, arpeggio brackets, visible sustain
ribbons, chord-hold rails, technique glyphs and incoming fret labels. A small
foreground number band protects required fret digits. The complete neck,
decorative rails, nut, background and expired verdict gems do not drive framing.
Consequently, missing anchors or handshapes do not prevent a usable view. Chart
guidance that determines an actual chord frame also determines that frame's
camera bounds; distant unused anchor ranges cannot force a zoom change.

Distance anticipates visible requirements and returns gently after them;
closely repeated excursions can retain their wider view. These intervals also
use song time. Visibility fitting keeps the chosen horizontal centre and can
widen promptly when required. **Automatic zoom** off freezes distance until
an explicit reframe; playback speed changes do not override that setting.

Pause and Follow off hold the pose. Following seeks and loop wraps reframe
directly. Playback-rate and live setting changes preserve the current lateral
pose and velocity while rejoining the scheduled path. Zoom retains its phase
and position on speed edits, and scales its real speed with the highway. Short intermediate lanes
remain in that path. A chart-defined lane can change during silence; silence
alone does not disable a valid lane plan. Resizing preserves the centre and
angle while fitting the changed viewport.

Re-enabling Follow normally catches up over 700 ms of real time, blending into
the current lane path. A nearby arrival deadline cannot compress that recovery
into a snap. The tuning panel labels this temporary timing exception "Follow
resumed"; ordinary start-before and arrive-after timing applies once recovery
finishes. Live edits during recovery preserve pose and velocity and restart its
window. This uses cached path samples without new chart analysis.

An interrupted direct recovery can retain its valid destination, extending its
deadline if needed for smooth travel, when no following move would be skipped.
This avoids backing toward a delayed nominal departure.

## Camera Director and legacy views

The existing per-panel/global Camera Director bridge remains available, without
changing its saved presets or enabling it automatically. In Stable mode its
distance, height, yaw, pitch and pan adjustments are applied on top of the
selected built-in viewpoint.
Pan translates the view; pitch remains an angular adjustment during dolly changes.
Deliberate manual zoom/pan can crop notes: the automatic fit is for the neutral
viewpoint and does not undo the user's offsets. Existing saved Free camera
presets are kept unchanged; loading Standard straight or Standard angled again
adds those adjustments a second time. Disable Free camera to use the promoted
defaults. Resetting Stable leaves external adjustments intact.

**Wide ahead** and **Steady & close** retain their previous behaviour. Legacy
automatic tilt and low-fret lock controls are unavailable in Stable; their saved
values are retained for switching back.

## Implementation and verification

`src/camera-semantics.mjs` classifies cached lane spans,
`src/camera-motion.mjs` schedules and samples journeys, and
`src/camera-controller.mjs` handles lateral continuity during live changes.
`screen.js` owns chart input, caches, renderer geometry, preset fitting,
transport state and the user interface. Modules are loaded with the renderer
dependencies through `/api/plugins/highway_3d/g/camera-N/src/`, using a fresh
generation per plugin-script evaluation and reusing it across renderer instances.

The rendered geometry is accumulated into 32 reusable depth bins. Static mesh bounds are
cached; dynamic ribbons read only their populated vertices. A fixed-orientation
perspective fit intersects linear constraints on the camera centre and uses
bounded bisection only when a larger distance is needed. No additional full-chart
scan, geometry allocation, shader or draw call is added per frame.

Use the direct module tests and current production-renderer fixtures in the
[acceptance procedure](../../docs/stable-camera-restructure.md#acceptance-procedure).
Browser CPU measurements are separate from native gameplay FPS; both need
recording for the tested build.

Additional geometry coverage is in `tests/js/highway_3d_stable_camera*.test.js`.
The earlier WebGL harness is `tests/browser/highway-stable-camera.cjs`. Run it
with an existing Playwright installation; `PLAYWRIGHT_MODULE` may point at that
installation. Optional `--nexus` and `--amaranthine` arguments accept local chart
JSON files. Private charts and generated captures are not committed.

Example from the repository root:

```text
node tests/browser/highway-stable-camera.cjs --out <fresh-output-directory>
```

The harness checks real rendered geometry, pause/follow behaviour, seeks, frame
rates, playback rates, handedness, string layouts and viewport changes, and
captures both presets for visual review.

`tests/browser/highway-camera-recentring.cjs` additionally checks continuous
playback versus direct seeking, low/high/low and repeated passages, and full-song
Airbourne coverage when supplied with the optional private chart. Preserve these
history-sensitive checks: a seek-to-fresh-open comparison alone cannot detect a
camera that retains an offset during continuous playback.
