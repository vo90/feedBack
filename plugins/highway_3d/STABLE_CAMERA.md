# Stable camera comparison

This branch adds an opt-in **Stable comparison** camera under 3D Highway settings.
Existing installations keep their saved camera mode; the comparison runtime uses
Stable with **Straight** and **Follow hand position** enabled.

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

## Following and visibility

The controller uses the meshes already emitted by this frame's renderer:
playable gems, open-string bars, chord frames, arpeggio brackets, visible sustain
ribbons, chord-hold rails, technique glyphs and incoming fret labels. A small
foreground number band protects required fret digits. The complete neck,
decorative rails, nut, background and expired verdict gems do not drive framing.
Consequently, missing anchors or handshapes do not prevent a usable view. Chart
guidance that determines an actual chord frame also determines that frame's
camera bounds; distant unused anchor ranges cannot force a zoom change.

There is no nine-measure preview in this mode. The geometry window is the
renderer's three chart seconds. Within that window the camera prepares for about
1.2 real seconds of approach, adjusted for playback speed. It projects that
geometry toward the play line before solving the safe frame. Playback speed is
estimated across multiple audio samples when the host does not supply it.

The horizontal comfort region occupies 68% of the view. Playback and seeking
use the same preferred centre and required distance for the current passage.
During a changing passage, the camera makes only the movement needed to fit.
Once the preferred centre remains within a small tolerance for 0.6 seconds, it
gently returns toward that composition. The tolerance is approximately 1% of the
horizontal half-view at the play line; small note/label fluctuations therefore
do not make the camera chase each note. A correction needed for visibility is
never adopted as the permanent resting centre. A wider view is held briefly
before returning all the way, without the former 3% residual zoom offset.
Pan and zoom smoothing control this movement using elapsed time, independently
of BPM and render frame rate. The pan dwell boundary splits a frame's damping
time so a low frame rate does not receive an extra frame of return movement.
A second fit against actual geometry protects against clipping after an unusually
large frame step. An extreme passage can therefore require a prompt correction.

Pause freezes automatic following. Turning Follow off holds the base pose through
playback and seeks. Reset, preset changes and a new arrangement explicitly
establish a new composition. Resizing retains the centre and angle while fitting
the changed viewport. Silence holds the last useful composition. Silence and
Follow off clear pending settling time; paused time does not advance it. The
first playable passage after silence establishes its own return target. With Follow on,
seeks and loop jumps reframe directly rather than flying from the old passage.

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

`stableCamUpdate` in `screen.js` owns the experimental controller. The rendered
geometry is accumulated into 32 reusable depth bins. Static mesh bounds are
cached; dynamic ribbons read only their populated vertices. A fixed-orientation
perspective fit intersects linear constraints on the camera centre and uses
bounded bisection only when a larger distance is needed. No additional full-chart
scan, geometry allocation, shader or draw call is added per frame.

Unit coverage is in `tests/js/highway_3d_stable_camera*.test.js`. The actual
WebGL acceptance harness is `tests/browser/highway-stable-camera.cjs`. Run it
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
