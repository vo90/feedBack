# Stable camera comparison

This branch adds an opt-in **Stable comparison** camera under 3D Highway settings.
Existing installations keep their saved camera mode; the comparison runtime uses
Stable with **Straight** and **Follow hand position** enabled.

## Comparing the views

- **Straight** looks directly along the highway.
- **RS+-inspired** uses a fixed 14-degree shoulder angle, mirrored in left-handed
  mode. It is a comparison preset, not a claim of an exact Rocksmith camera match.
- Both use a 60-degree vertical field of view, 25-degree downward pitch, zero
  roll, the same neutral distance, and the same following rules. A constant lens
  shift keeps the play line low in the viewport without an automatic tilt loop.
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

The horizontal comfort region occupies 68% of the view. If the passage fits,
the centre stays unchanged. Otherwise the solver finds the smallest translation
and distance that fit; it does not force a fret centroid on every frame. A wider
view is held briefly before returning gradually. Pan and zoom smoothing control
this movement using elapsed time, independently of BPM and render frame rate.
A second fit against actual geometry protects against clipping after an unusually
large frame step. An extreme passage can therefore require a prompt correction.

Pause freezes automatic following. Turning Follow off holds the base pose through
playback and seeks. Reset, preset changes and a new arrangement explicitly
establish a new composition. Resizing retains the centre and angle while fitting
the changed viewport. Silence holds the last useful composition. With Follow on,
seeks and loop jumps reframe directly rather than flying from the old passage.

## Camera Director and legacy views

The existing per-panel/global Camera Director bridge remains available, without
changing its saved presets or enabling it automatically. In Stable mode its
distance, height, yaw, pitch and pan adjustments are applied to the stable base.
Pan translates the view; pitch remains an angular adjustment during dolly changes.
Deliberate manual zoom/pan can crop notes: the automatic fit is for the neutral
base and does not undo the user's offsets. Disable Free camera for a fair preset
comparison. Resetting Stable leaves those external adjustments intact.

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
