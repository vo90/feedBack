# Stable camera movement

Both Stable Straight and RS+-inspired use the same lane decisions and timing.
Start-before and arrive-after schedule every retained target. Overlapping moves
use the selected policy; they never restore hidden legacy timing.

## Ownership

| Module | Responsibility |
| --- | --- |
| `src/camera-semantics.mjs` | Coalesce lanes, classify riffs/excursions/progressive runs, retain stops and cached explanations. |
| `src/camera-motion.mjs` | Build cached motion segments, sample them, and provide join/resume/zoom mathematics. |
| `src/camera-controller.mjs` | Preserve lateral pose and velocity while live changes rejoin the current schedule. |
| `screen.js` | Geometry, caches, projection, transport lifecycle, settings, zoom and the tuning panel. |

The three modules live under `plugins/highway_3d/`. Factories keep each
renderer's state separate. They do not import Three.js or read browser settings.
Generation-prefixed module URLs avoid stale graphs after a plugin upgrade.
Renderer recreation within one script evaluation reuses its module graph.

The motion interface accepts
`hwyBuildCameraMotion(stops, rate, smoothing, departureDelay, travelExtra, settleLimit, preparationMs, directTiming)`.
`hwyCameraPlanAt` accepts the same controls after `(stops, now, rate, smoothing, out)`.
The renderer passes
`directTiming: { startBeforeMs, arriveAfterMs, movementMode }`.
Omitting this object retains the former schedule for compatibility tests. With
it present, legacy preparation, departure delay, extra travel and settling
controls do not govern lateral movement.

Segments have cached journey and timing records. Each timing record identifies
its target, requested times, actual interval and whether another target replaces
it. The controller reports temporary live corrections separately from this
nominal schedule.

## Controls

| Control | Default / range | Contract |
| --- | --- | --- |
| Movement | Reach every centre | Choose how overlapping moves connect. |
| Start before next lane | Saved preparation, otherwise 700 ms / 25–3000 ms | Departure from a hold in Reach every centre; each destination trigger in Follow latest destination. |
| Arrive after next lane | 0 ms / 0–3000 ms | Each centre's exact arrival in Reach every centre; target deadline in Follow latest destination, unless superseded. |
| Short-lane threshold | 500 ms / 0–3000 ms | Each coalesced lane's original-song duration; exactly the threshold is lasting. Existing riff and progressive-run protections remain. |
| Automatic zoom | On | Off freezes current distance, disabling safety fitting and zoom recovery. |

Timing uses real playback milliseconds. For lane onset T, playback rate R,
start-before B and arrive-after A:

- Requested departure / trigger = T − B × R / 1000.
- Requested arrival = T + A × R / 1000.
- An uninterrupted transition has B + A milliseconds available.

Distance determines speed. At 400 ms before and 50 ms after, targets less than
450 ms apart in playback time have overlapping windows. No separate transition
duration is needed.

### Reach every centre

`movementMode: 'reach-centres'`

Overlapping windows form a continuous sequence. The camera leaves its held
centre at the first requested departure, then reaches every retained centre at
its requested arrival. Intermediate same-direction moves share a bounded
velocity; reversals pass smoothly through zero velocity.

Start-before does not schedule another departure while already moving through
that sequence. The panel identifies continuation from the previous centre and
shows its actual start. Close, widely separated targets can require fast travel.
Large arrive-after values can leave the camera moving toward an older lane
after a newer lane begins. This is the selected policy, not an early fallback.

### Follow latest destination

`movementMode: 'latest-destination'`

Every requested trigger makes the next lane the destination. An interrupted
movement is sampled at that trigger, and its successor preserves position,
velocity and acceleration. The new target's arrival remains at the requested
time unless a later trigger supersedes it.

A reversal can briefly continue in the old direction while braking. Earlier
centres may not be reached. The panel reports the redirect time and superseded
arrival instead of falsely reporting completion.

Both policies bound the very first departure by the initial source lane's
availability. This exception is reported and preserves arrival. Seeking and
loop wrap sample the path at the new position; wrapping before arrival prevents
that traversal from finishing. Live edits preserve the actual pose and velocity
while rejoining the new schedule. Replay the passage to compare nominal timing.

### Fixed distance

Turning Automatic zoom off retains the displayed distance; lateral following
continues. Lane changes, pauses, Follow toggles, loop wrap, seeking, speed,
timing edits and resizing do not widen or recover the view.

Notes and labels may leave the view. A new song or arrangement, explicit camera reset or
explicit viewpoint change (preset, handedness or string layout) establishes
fresh framing. Same-song chart refreshes keep the frozen distance.
Turning zoom back on resumes normal fitting and recovery.
External manual Camera Director adjustments remain explicit view changes.

## Settings and lane policy

The in-song panel, settings page and split-screen controls expose both new
controls alongside start-before, arrive-after and threshold. Hydration does not
write defaults or overwrite existing values. A missing start-before key still
reads saved preparation through existing scope precedence. Legacy timing values
remain stored for rollback but have no lateral effect in either new mode.

Lane classification is unchanged. Same-base extensions retain four-fret focus.
Recognized riffs and brief excursions can hold home; progressive travel retains
meaningful targets. Lowering the threshold can produce more movement without
changing movement policy. Camera X-pan smoothing remains disabled in Stable;
zoom smoothing is disabled while automatic zoom is off.

A useful comparison is 400 ms before, 50 ms after and a 400–500 ms threshold.
Test 200 ms separately to expose more short targets. These are suggestions,
not values written over the user's saved settings.

## Performance and validation

Classification and explanations run when the semantic cache rebuilds.
Projected shapes and attack evidence have separate caches. Timing/movement
changes rebuild motion without scanning chart evidence again. Warm frames
sample the cached path and explanations by binary search. The tuning panel
updates only when its cached record, decision or lifecycle state changes.
Fixed-distance frames skip live visibility collection and distance solvers.

Validate both modes and presets at multiple speeds, including:

- Isolated moves, overlapping windows, progressive climbs/descents and reversals.
- Exact retained arrivals versus continuous retarget boundaries and final arrival.
- The 25 ms before / 1000 ms after Absolution case, with no legacy fallback.
- Alison Hell's repeating home lane, Absolution's lasting fret-7 lane and Rats.
- Live mode/timing/zoom edits, pause, Follow, speed changes, seek and loop wrap.
- Fixed distance across automatic paths, deliberate reframing and zoom resumption.
- Scoped settings, keyboard isolation, left-menu clearance and module reload.
- Cache lifetimes, complete rebuild cost, warm frame CPU and hardware cadence.

Compare against the same local baseline and settings. An isolated renderer
benchmark does not establish native Electron performance with audio. Keep
machine-specific evidence outside the source checkout, preserve the user's live
session, and restore it after the guarded runtime update.

### Validation on 20 October 2026

Against integration baseline `0848af1`, the focused camera suite passed 340/340.
Full JavaScript passed 2875/2878 versus baseline 2861/2864; the same three
unrelated provider-verdict/audio-barrier failures remained.

The production browser matrix passed 48 candidate cases and 12 baseline cases,
covering both presets, 0.5/1/2 playback speeds, dense transitions with 1000 ms
arrival, held excursions, both movement modes and zoom on/off. UI checks passed
at wide, narrow and split-pane sizes. Module recreation, upgrade and rollback
checks passed. Warm-frame assertions confirmed cache reuse without chart analysis.

Eight isolated RTX 4080 hardware samples remained at 60 FPS with 16.7–16.8 ms
p95 frame intervals. Warm moving draw means were 0.289/0.453 ms for baseline
Straight/Angled, 0.298/0.468 ms for Reach, 0.299/0.481 ms for Latest, and
0.234/0.331 ms for Latest with zoom off. Each plan's moving interval was sampled;
these bounded comparisons are not identical-frame or long-duration guarantees.
Machine-local evidence and native-session restoration results are retained
outside the repository.
