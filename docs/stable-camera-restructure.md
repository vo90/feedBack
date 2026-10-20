# Stable camera restructuring

The current gameplay policy is
[Stable camera lane following](highway-camera-lane-follow.md).
This document describes the module boundaries and current direct-timing baseline.
Both Stable Straight and RS+-inspired use the same lane decisions and timing.
Separated lane changes have exact start-before and arrive-after controls.
Crowded sequences retain their established schedule pending a separate design
for overlapping transitions; the live panel identifies this explicitly.

The older playing-area, transitions and passage-plan documents record earlier
designs and investigations. Their lateral comfort zones, tolerance holds and
reactive recentering are historical, not alternative rules for current Stable.

## Modules and ownership

The renderer loads these modules once with its dependencies through the
generation-prefixed route `/api/plugins/highway_3d/g/camera-N/src/`. The generation
advances when the classic plugin script is evaluated again, so a version change
or rehydration cannot retain an older module graph. Recreating a renderer within
the same script evaluation reuses that graph. The server also supports the plain
`/api/plugins/highway_3d/src/` route. These modules do not import Three.js or read
browser settings. Tests can import the same files directly.

| Module | Factory dependencies | Responsibility |
| --- | --- | --- |
| `plugins/highway_3d/src/camera-semantics.mjs` | `createCameraSemantics({ NFRETS, isRenderableNote })` | Coalesce lane spans, collect evidence, resolve classification precedence and return camera stops with cached explanations. |
| `plugins/highway_3d/src/camera-motion.mjs` | `createCameraMotion({ isRenderableNote, isUnpitchedMute })` | Build the attack index, prepare stops, schedule complete journeys, sample motion and provide join/resume/zoom mathematics. |
| `plugins/highway_3d/src/camera-controller.mjs` | `createCameraController({ samplePlan, hwyCameraJoinAt, hwyCameraResumeAt })` | Preserve lateral pose and velocity while live changes rejoin the current schedule; expose the current motion mode. |

`screen.js` remains responsible for effective chart lanes, projection and
geometry, cache invalidation, transport/reset/pause/Follow decisions, fixed
viewpoint fitting, settings persistence and the live panel. Each renderer owns
its own controller and state; factories do not share mutable playback state.

The semantics API returns the existing function names:

```js
const semantics = createCameraSemantics({ NFRETS, isRenderableNote });
const options = { context, excursionThreshold: 500 };
const timeline = semantics.hwyBuildCameraTimeline(regions, options);
const stops = semantics.hwyBuildCameraStops(regions, options);
```

`context` contains notes, chords, beats, sections and string count when available.
`hwyCameraRiffVariationCandidates(spans, context)` remains available for direct
evidence checks. Classification does not accept playback speed or geometry-fit
callbacks. Each span's additive `explanation` contains `decision`, `reason`,
`home` and `interval`; held spans can share a cached evidence record.

Classification precedence is explicit:

1. Coalesce same-base regions and classify each original-song duration.
2. Prove and apply the narrowly defined longer single-note variation.
3. Collect short-return, repeated-cycle and progressive-run evidence.
4. Resolve section-supported and established homes.
5. Bypass isolated short off-route spikes, then build retained stops.

The long-note exception must precede return evidence because it removes that
span's lasting barrier. Reordering these stages can change gameplay even if
each individual rule appears unchanged.

Motion keeps its stop/segment interface. `hwyBuildCameraMotion` accepts
`(stops, rate, smoothing, departureDelay, travelExtra, settleLimit, preparationMs, directTiming)`;
`hwyCameraPlanAt` accepts the same controls after `(stops, now, rate, smoothing, out)`.
The renderer passes `directTiming: { startBeforeMs, arriveAfterMs }` as the last
argument. Omitting it retains the former schedule for compatibility tests.
Legacy parameters remain available only to preserve crowded-sequence behaviour;
they no longer appear as timing controls. The returned segment array has cached `journeys` records;
segments in a journey share its timing record. Sampling returns the current
or upcoming `journey` and `timing` without reconstructing them.

The controller exposes `update(state, plan, frameTime, rate, fallbackX)` and
`setMode(state, mode)`. Its `samplePlan` dependency samples into a reusable output
object. Direct resumption, local rejoining, arrival holds, pause and Follow
holds are distinct diagnostics; their display is not another movement rule.

## Control contract

| Control | Default / range | Contract |
| --- | --- | --- |
| Start before next lane | Saved manual preparation, otherwise 700 ms / 25–3000 ms | Exact departure before a separated followed lane begins. |
| Arrive after next lane | 0 ms / 0–3000 ms | Exact arrival after that lane begins, not an allowance. Zero means on time. |
| Short-lane threshold | 500 ms / 0–3000 ms | Classifies each coalesced lane in original song time, with existing riff and progressive-run protections. |

Start and arrival use real playback milliseconds. For a lane at song time T,
playback rate R, start-before B and arrive-after A (milliseconds):

- Departure = T − B × R / 1000.
- Arrival = T + A × R / 1000.
- Real transition duration = B + A.

For example B=600, A=100 yields a 700 ms transition. Small and large moves use
that same duration and the existing smooth quintic easing. Distance determines
speed; there is no independently editable transition-duration control.

The exact baseline applies to a single lasting-to-lasting movement when its
requested departure is no earlier than its source lane, and the complete
interval fits between neighbouring existing movements. Adjacent exact requests
must also not overlap. Neither conflicting request is given hidden priority.
This is conservative: it preserves neighbouring schedules instead of rescheduling
a crowded passage. Multi-waypoint journeys and conflicts keep their entire
previous trajectory, including the saved legacy timing preferences. The panel
says **Existing sequence timing retained**, names the reason, and explicitly
states that the exact controls do not apply there yet. Handling those overlaps
with the same two controls is deferred gameplay work, not an implicit clamp.

The panel shows requested times, actual departure lead, actual duration, first
lane arrival offset, final journey arrival timestamp, and live continuity mode.
It distinguishes paused/Follow-off holds and live-edit corrections from the
cached schedule. Held riffs remain held regardless of these timing values.

Settings, the in-song panel and split-screen controls expose
`stableCameraStartBeforeMs`, `stableCameraArriveAfterMs` and the unchanged
`stableCameraExcursionThreshold`. When the new start key is absent, it reads the
saved `stableCameraPreparationMs` through the same scope precedence. No keys
are written during hydration. Old timing values remain stored for rollback and
crowded-sequence continuity; maximum settling is deliberately not migrated to
exact arrive-after, because those meanings differ. Camera X-pan smoothing is
disabled in Stable settings; direct times govern ordinary lateral transitions.
Zoom fitting and recovery retain their own controls and behaviour.

## Tuning a passage

Start with 600 ms before and 100 ms after for a 700 ms separated transition.
Replay from before departure and look for **Exact start and arrival applied**.
Increasing before starts earlier; increasing after finishes later. Both increase
the derived duration. Zero after reaches the lane at its onset.

An edit during movement preserves the actual camera position and velocity,
then rejoins the new schedule. For timing comparisons, replay the passage.
Use the lane decision and sequence status to distinguish a deliberate riff
hold or retained crowded sequence from an exact separated movement.

## Cache and performance contract

Lane evidence and explanations are built on semantic-plan changes. Projected
shapes and attack evidence have separate caches. Preparation and timing
controls rebuild scheduling, without reclassifying the chart. Ordinary frames
sample cached paths and select cached explanations by binary search. No panel
polling, per-frame chart analysis or fresh journey allocation is required.

Preserve both numerical output and cache lifetime when restructuring. Repeated
equivalent rebuilds must not restart an active local correction. A shorter
implementation that scans all chart rows during playback would violate this
contract.

## Direct-timing baseline validation (2026-10-20)

- 326 focused camera tests pass, including exact timings across distances and
  playback speeds, legacy trajectory equality for deferred crowded sequences,
  lifecycle continuity, riff policy, cache lifetime and settings preservation.
- Full JavaScript suite: 2850/2855 pass. Baseline `49d90d6` passes 2842/2847;
  the same five unrelated provider-verdict, ghost-geometry and audio-barrier
  failures remain.
- Isolated browser: both Stable presets apply 500 ms before + 200 ms after as
  departure 7.500 s, arrival 8.200 s, duration 700 ms for a lane at 8.000 s.
  All three controls remain usable clear of the left menu at 1920×1032,
  390×740 and 800×450. No browser errors or motion-assertion failures.
- One paired RTX 4080/D3D11 comparison of Absolution at 100% playback stayed
  near 60 FPS in both builds; frame p95 was 16.7–16.8 ms, max 16.8 ms.
  Moving draw CPU means: Straight 0.464→0.486 ms, Angled 0.696→0.810 ms;
  p95 remained 0.6/1.0 ms. These are isolated renderer measurements, not a
  native Electron gameplay comparison with audio.

## Acceptance procedure

This is a verification procedure, not a claim that a particular build passed.
Record results once with the tested revision, source/module hashes and
machine/runtime identity.

1. **Protect the active session.** Resolve this PC's runtime and library through
   the workspace configuration. Record the song, arrangement, loop, transport
   state, position, speed, preset and effective global/per-pane settings before
   testing. Use private charts read-only. Validate a selected runtime before
   launch, and restore the recorded session after any native experiment.
2. **Compare pure modules.** Run the direct module tests and existing camera
   suites. The frozen pre-extraction oracle covers Automatic classification and
   motion; generated sequences supplement named regressions. A baseline mismatch
   must be explained rather than accepted as an incidental refactor difference.
3. **Compare production-renderer traces.** Use
   `tests/browser/highway-camera-lane-follow.cjs` with a fresh external `--out`
   directory, both presets, 0.5/1/2 playback speeds and wide/narrow views.
   Reference and candidate runs must use matching fixtures, ranges and settings.
   `--source-ref` selects the complete revision's assets; `--compare-traces`
   compares a saved reference. `--songs Name=path` supplies local private charts.
4. **Check named behaviors.** Alison Hell Lead, 194.419134–212.784101 s:
   hold the repeated home at 350/500/900 ms and follow at 250 ms.
   Absolution Lead: follow the ~1.227 s fret-7 lane beginning at 15.359 s.
   In its 46.923210–58.746508 s loop, compare requested and applied departure
   around the direct jump and the short-intermediate journeys. Include Rats,
   singleton replies, same-base extensions, advancing zigzags and a climb/descent
   with no lasting intermediate lane.
5. **Check Manual independently.** With delay and extra travel zero, use 25,
   700 and 3000 ms where preparation fits and where the preceding stop clips it.
   Check the first-lane reference at every speed, including a multi-leg chain.
   Then add travel/delay and verify the same hard deadlines, travel-first budget,
   preserved waypoint order and shared velocities. Check that Automatic still
   restores its prior schedule.
6. **Exercise lifecycle and UI.** Edit mode/lead while moving and paused; toggle
   Follow, change speed, wrap a loop and seek. Check pose/velocity continuity,
   finite convergence, visibility, preset parity, keyboard isolation, disabled
   controls, persistence, split-screen scope and destroy/recreate cleanup.
   `--tuning-ui` and `--live-consistency` supplement direct settings tests.
   `node tests/browser/highway-camera-module-reload.cjs` separately checks
   module reuse across renderer recreation and fresh imports after same-page
   plugin upgrades and rollbacks, with mocked dependencies in real Chromium.
7. **Measure this PC.** Compare warm frame work and plan-rebuild work, then
   measure native gameplay through representative movements and live edits.
   `--perf`/`--moving-perf` isolate CPU work with GPU rendering disabled; they
   do not establish native FPS. Review visual smoothness as well as frame counts.

Run the direct-import checks from the repository root:

```text
node --test tests/js/highway_3d_camera_semantics_module.test.js tests/js/highway_3d_camera_motion_module.test.js tests/js/highway_3d_camera_controller_module.test.js
```

The broader renderer and lifecycle suites remain necessary. Neither frozen
parity nor generated fixtures prove that every unfamiliar musical passage
receives the user's preferred classification. New ambiguous gameplay decisions
still require the user's judgment.

## Branch verification — 20 October 2026

Baseline: `dd9ed24118ac19773d03d2f5584efcc148d4e590` on
`integration/songsterr-test`. Candidate: `refactor/stable-camera-system`.
The current integration runtime was left untouched; comparison used isolated
renderers and this PC's own chart copies. Song, arrangement, position, loop,
playback state/rate, browser storage and API settings matched before and after.

- Automatic: 102 paired renderer cases, 37,186 movement/zoom/pose/visibility
  frames and 1,394,152 lifecycle values matched exactly. This includes Alison
  Hell, both Absolution passages above, Rats, both presets and 0.5/1/2 playback
  speeds. A further 606-frame smoke comparison after the module-loading change
  also matched exactly.
- Manual: 18 progressive renderer cases passed; direct tests cover 25–3000 ms
  preparation, 0.1–4 playback speeds, preceding-lane caps and timing priorities.
  The final focused timing/settings/UI run passed 63 tests. Browser UI checks
  covered both presets and three viewport sizes, including the left menu,
  applied timing readouts and Follow state.
- Full JavaScript suite: 2,842 passed out of 2,847; five failures were identical
  to the baseline. They concern audio-barrier ordering, two ghost-geometry
  checks and two provider-verdict source checks. No new failures.
- The module reload browser check passed upgrade and rollback with fresh module
  evaluations, while renderer recreation reused its current modules. Its
  fixed-URL negative control reproduced the stale-module problem. All six
  plain/generation module routes served the expected JavaScript bytes locally.
- The synthetic browser checker retained 64 identical baseline assertions
  concerning its strict live-rejoin bound; sampled trajectories still matched
  exactly. The 24 private-song cases had zero assertion failures. These existing
  assertions were not weakened to make the comparison pass.

Three paired runs per revision and preset on a Ryzen 9 5900X / RTX 4080 used
Absolution Lead, 46.923210–58.746508 s, Automatic, 1000 ms departure delay,
10% extra travel, 250 ms settling, 500 ms threshold and 100% playback:

| Measurement | Straight baseline → candidate | Angled baseline → candidate |
| --- | --- | --- |
| Warm moving draw CPU, GPU disabled | 0.469 → 0.466 ms | 0.500 → 0.499 ms |
| Complete cached-plan rebuild | 1.609 → 1.617 ms | 1.613 → 1.539 ms |
| Hardware renderer cadence | 60.00 → 60.00 frames/s | 60.00 → 60.00 frames/s |

Hardware runs used isolated Chromium/D3D11 at 1920×984 CSS pixels, DPR 2;
the maximum measured animation-frame interval was 16.8 ms. The camera modules
were identical across runs; intervening renderer edits only cleared a stale UI
message and adjusted comments/indentation. Isolated semantic rebuilding rose
from about 0.14 to 0.59 ms with explanations, while the complete rebuild stayed
comparable. This work remains cached. These measurements do not establish
native Electron gameplay performance with audio; that comparison remains a
separate pre-merge check.
