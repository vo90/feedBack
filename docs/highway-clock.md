# Highway presentation clock

The 3D renderer owns a visual clock. Audio/judgement time (`_audioTime()` and
`highway.getTime()`) remains separate. Ordinary native position corrections do
not identify a seek: within a playing epoch, notes and camera advance together,
with phase correction limited to 20% of the declared playback rate.

Transport controls use `setPlaybackState`, `setPlaybackSample` and
`resetPresentation(reason)`. Successful seeks, song replacement and calibration
changes start a new epoch, including seeks smaller than one frame. Pause holds
the last displayed frame. Count-in and its deliberate rewind are explicit modes.
These methods are separate from `setTime(t)` because existing plugins wrap that
one-argument API. Song offset and A/V offset are applied once by the host bundle;
the renderer must not apply them again.

Desktop may expose `audio.getBackingSnapshot()`, returning null for an older
addon, or version 1 with `valid`, `position` (seconds), `ageMs`, `sequence`,
`generation`, `rate`, `playing` and `ended`. The native publisher uses its existing
transport lock and atomic payload fields; reading never waits for audio. Age is
computed entirely in the native monotonic clock domain. Core maps age to the
renderer request midpoint, with uncertainty of up to half the IPC round trip.
Replies taking more than 100 ms, invalid observations and out-of-order samples
are ignored. Poll ownership invalidates replies before seek, pause, restart,
rate change and song replacement.

Source progress permits at most 250 ms of extrapolation, after which presentation
holds. New replies carrying the same position do not renew this budget. Recovery
corrects phase without a backward step. Native end state also handles stretched
playback whose latency-compensated final position can fall short of duration.

Older Desktop builds fall back to `getBackingPosition()`. That path gains poll
ownership and monotonic presentation, but cannot provide measured source age or
the stronger audio-alignment guarantee. Older Core hosts without transport
metadata retain the renderer's legacy heuristics. Browser audio and stems use
their existing host audio anchors plus explicit transport state.

Diagnostics are disabled by default. `highway.setClockDiagnostics(true)` enables
a fixed-size 4,096-frame ring. `highway.getClockDiagnostics()` returns field names,
reason names and rows; disable it after a diagnostic capture. Recording stores
no per-frame console messages. Renderer teardown resets the clock, and destruction
releases the ring.

Regression coverage lives in `highway_presentation_clock.test.js`,
`transport_poll_ownership.test.js`, the stable-camera tests and the browser
`clock-continuity` case. Recorded correction fixtures contain timing only.
