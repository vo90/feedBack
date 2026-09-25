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
computed entirely in the native monotonic clock domain. New Desktop builds add
`clockId`, `readAtMs` and `readUncertaintyMs` in the main process's monotonic domain.
Core calibrates that domain using intersected request/response offset bounds,
allowing 100 ppm relative drift. Once calibrated, asymmetric IPC delay does not
move the sample to an assumed request midpoint. Mapping uncertainty must be at
most 50 ms. Older timestamp-less snapshots retain the conservative 100 ms RTT
limit. Invalid and out-of-order observations are ignored.

During playback, `subscribeBackingSnapshots(callback)` supplies observations
every 50 ms, independently of pending requests. Polls continue for calibration
and compatibility, with one request in flight and a 100 ms cadence measured from
request start. A stream and its polls share sample ordering. Even a superseded
poll can refresh calibration. Stream calibration expires after 30 seconds or if
its uncertainty exceeds 50 ms. Poll ownership and idempotent stream cleanup
invalidate queued callbacks before seek, pause, restart, rate or song changes.

Source progress permits at most 250 ms of extrapolation, after which presentation
holds. New replies carrying the same position do not renew this budget. Recovery
corrects phase without a backward step. After a frame gap over 250 ms, the clock
recovers forward on the first fresh observation, including when that observation
arrives a few frames after the gap. Exhausting the source freshness budget also
arms forward recovery, even if frames kept arriving normally. Complete loss of
observations may require a hold and forward resynchronization, but cannot leave
accumulating phase debt after fresh audio returns. Native end state also handles stretched
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
`transport_poll_ownership.test.js`, `transport_clock_delivery.test.js`, the stable-camera tests and the browser
`clock-continuity` case. Recorded correction fixtures contain timing only.
