# Stable camera movement

Both Stable Straight and RS+-inspired use the same lane decisions and timing.
Start-before and arrive-after schedule every retained target. Overlapping moves
use the selected policy; they never restore hidden legacy timing.

## Ownership

| Module | Responsibility |
| --- | --- |
| `src/camera-semantics.mjs` | Coalesce lanes, classify riffs/excursions/progressive runs, retain stops and cached explanations. |
| `src/camera-tapping.mjs` | Compile repeated tapping areas and centre them when their cycles are held. |
| `src/camera-motion.mjs` | Build cached motion segments, sample them, and provide join/resume/zoom mathematics. |
| `src/camera-controller.mjs` | Preserve lateral pose and velocity while live changes rejoin the current schedule. |
| `screen.js` | Geometry, caches, projection, transport lifecycle, settings, zoom and the tuning panel. |

The four modules live under `plugins/highway_3d/`. Factories keep each
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

Timing uses original song milliseconds, labelled **ms at 100%**. For lane
onset T, playback rate R, start-before B and arrive-after A:

- Requested departure / trigger = T − B / 1000.
- Requested arrival = T + A / 1000.
- An uninterrupted transition has B + A song milliseconds available, taking
  (B + A) / R milliseconds of real time.

Saved numbers do not change when playback speed changes. At 50%, 400 ms before
means 800 ms of real time, and 50 ms after means 100 ms of real time. The panel
shows both the saved basis and the current-speed equivalent.

Distance determines speed. At 400 ms before and 50 ms after, targets less than
450 ms apart in song time have overlapping windows at every playback speed.
Both movement modes keep the same path, grouping and redirects at the same
song/highway positions. No separate transition duration is needed. At 100%,
this preserves the preceding implementation's timing and path exactly.

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
while rejoining the new schedule. A live speed edit likewise preserves the
current lateral pose and real velocity, so its brief handoff can depart from
the nominal path. Replay the passage to compare nominal timing.

### Fixed distance

Turning Automatic zoom off retains the displayed distance; lateral following
continues. Lane changes, pauses, Follow toggles, loop wrap, seeking, speed,
timing edits and resizing do not widen or recover the view.

Notes and labels may leave the view. A new song or arrangement, explicit camera reset or
explicit viewpoint change (preset, handedness or string layout) establishes
fresh framing. Same-song chart refreshes keep the frozen distance.
Turning zoom back on resumes normal fitting and recovery.
External manual Camera Director adjustments remain explicit view changes.

With automatic zoom on, visibility horizons, anticipation, repeated-excursion
holds and recovery use song time as well. Zoom state advances by the frame's
real duration multiplied by playback rate; its velocity is stored per song
second. A live speed edit leaves zoom position and recovery phase intact and
scales its real speed with the highway immediately. Ordinary frame sampling
can introduce small differences between rates; zoom remains a visibility
controller rather than a precomputed exact distance curve. Transport freshness,
seek detection and the presentation clock retain their real-time safeguards.

## Settings and lane policy

The in-song panel, settings page and split-screen controls expose both new
controls alongside start-before, arrive-after and threshold. Hydration does not
write defaults or overwrite existing values. A missing start-before key still
reads saved preparation through existing scope precedence. Legacy timing values
remain stored for rollback but have no lateral effect in either new mode.

### Predictable short-lane filtering

The chart is compiled into coalesced lanes, protected travel, fixed pattern
ownership and suppression candidates before applying the threshold. Slider edits
only activate those candidates. Once a destination is removed, a larger threshold
cannot restore it or move its pattern to another home. The guarantee concerns
lane destinations; removing a waypoint can still change the interpolated path.

- Same-base extensions retain their initial four-fret centre.
- A single out-and-back reply belongs to the preceding home.
- Multi-lane riffs require two adjacent cycles with the same ordered lane bases.
  Each away lane in the supporting pair must be individually shorter than the
  threshold; elapsed time for the whole trip is never used.
- A surrounding riff owns nested replies. A new local home wins only if two
  matching cycles finish before the surrounding home returns. Authored section
  boundaries can support ownership, but do not prove a riff by themselves.
- Three consecutive moves in one direction protect the route, including its
  start and turn. Advancing zigzags protect travel when both highs and lows move
  in the same direction. Replies around a fixed home do not meet that test.
- An isolated peak outside an otherwise continuing route may be held. Ambiguous
  travel follows, instead of inventing a detour from slider-dependent neighbours.
- Exact note/measure proofs still protect established riff variations regardless
  of this duration control. Zero disables duration-based suppression.

### Held tapping areas

A proven lane pattern can become a tapping area when at least two adjacent
cycles have the same ordered note/string/tap/hammer/pull sequence, contain a
marked tap, and cover more than one fret. All participating fretted notes and
real chord members determine the bounds, including hammer-ons and pull-offs.
Open strings, unpitched mutes and synthetic chord overlays do not widen it.
This is ordered-note evidence, not a claim of identical rhythm or sustain.

Once the threshold holds every cycle in that fixed area, its camera target is
the physical midpoint between the first fret's left edge and the last fret's
right edge. Repeated high or low notes cannot bias it. A frets 5–12 tapping
pattern with uniform fret spacing therefore centres between columns 8 and 9,
rather than at the usual 5–8 lane centre. It is one fixed target for the passage,
not a sliding average.
A matching final return prefix stays centred until the next event or home end;
ordinary notes on the same lane end that extension. Notes sustained into the
area from before its start and slide endpoints are not part of these bounds.

The usual motion planner handles entering and leaving the area with the saved
start-before, arrive-after and movement mode. Automatic zoom keeps its existing
behaviour, including remaining completely off when disabled. The tuning panel
identifies the active tapping area and its fret range. Ordinary held riffs keep
their existing home focus.

Camera X-pan smoothing remains disabled in Stable; zoom smoothing is disabled
while automatic zoom is off.

A useful comparison is 400 ms before, 50 ms after and a 400–500 ms threshold.
Test 200 ms separately to expose more short targets. These are suggestions,
not values written over the user's saved settings.

## Performance and validation

Pattern ownership, note evidence and tapping bounds compile when chart or
geometry evidence changes. Threshold edits only filter that cached evidence;
they do not scan notes or discover patterns again. Projected shapes and attacks
have separate caches. Timing/movement changes rebuild motion without scanning
chart evidence again. Warm frames sample the cached path and explanations by binary search. The tuning panel
updates only when its cached record, decision, lifecycle state or playback rate
changes. Rate edits reuse both prepared stops and direct motion segments;
only sampled real derivatives and the live controller handoff change. The
legacy motion entry point without directTiming retains its former time basis.
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

### Predictable threshold and tapping validation

Against integration baseline `76d60e7`, the focused camera suite passed 326/326.
The full JavaScript suite passed 2972/2975, versus 2955/2958 on that baseline;
the same three unrelated audio-barrier/provider-verdict failures remained.

Fresh production regions from Alison Hell, Absolution, Rats and Ride the
Lightning passed 2,607 threshold selections, including either side of every
coalesced lane-duration boundary within the control range. Destinations only
disappear as the threshold rises; pattern homes and evidence intervals stay
fixed. Alison holds at 350/500/900 ms and follows at 250 ms. Absolution's opening
3→5→7→10 climb remains at 200/250/500 ms, and its 1.227-second fret-7 lane
follows at 500 ms. Tapping tests cover physical centring, real chord members,
technique evidence, exact-threshold exclusion, mirrored geometry and returning
to ordinary notes without an anchor change.

Cache tests verify that threshold edits reuse pattern and tapping evidence,
while timing edits rebuild only the motion schedule. Four-module browser
reload tests cover recreation, upgrade and rollback, including a stale-module
negative control. Private charts and machine measurements remain outside the
repository.

The production renderer passed 60 cases across those four songs, both Stable
presets, both movement modes and 0.5/1/2 playback speeds. The Ride tapping area
also passed at a 150 ms threshold with zoom disabled, and two captured views
confirmed its composition. All warm-frame checks reported zero evidence,
threshold, tapping, attack or motion rebuilds; zoom-off cases also performed no
live zoom-geometry collection. There were no browser errors.


### Song-time timing validation on 21 October 2026

Against integration baseline `7d9eabe`, all 337 focused camera tests pass.
The full JavaScript suite passes 2983/2986 versus 2972/2975 on the baseline;
the same three audio-barrier/provider-verdict failures remain. Direct-motion
checks cover 10%–400%, overlap grouping, redirects, initial availability,
rate-scaled derivatives, cache reuse and exact 100% trajectory parity.
Live-edit checks cover lateral continuity and active inward zoom recovery.

The isolated production renderer passes 144 cases across both movement modes,
both viewpoints, zoom on/off and 25/50/75/100/150/200% speed. Comparing 144,120
samples at identical song positions gives a maximum position/distance/pose
difference below 5e-13; fixed-distance cases match exactly. All 24 constant-100%
reference traces match the preceding implementation. Speed-changing lifecycle
traces are checked for continuity and the new deadlines, rather than equality
to the old rate-dependent schedule. Warm frames retain all evidence and motion
caches without chart analysis.

Paired RTX 4080 renderer samples at 100% remain at 60 FPS with 16.7 ms p95
frame intervals in both viewpoints. Warm moving draw CPU means are
0.919/0.968 ms for baseline Straight/Angled and 0.927/0.967 ms after the change.
These are bounded isolated Chromium measurements with visual effects disabled,
not native Electron gameplay with audio. Native apps were closed during this
validation; their saved session/profile files were preserved.

Fresh local chart passages from Alison Hell, Absolution, Rats and Ride the
Lightning also pass 48 production-renderer cases with automatic zoom enabled,
both viewpoints and movement modes, and 50/100/200% speeds. The Ride tapping
area retains its frets 5–12 target. The tuning panel passes 50% conversion and
wide/narrow/split-pane placement checks without writing saved values.
