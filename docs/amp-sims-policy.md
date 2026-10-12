# Desktop amp simulation policy

`use_amp_sims` remains the only user preference. Pure web behavior is unchanged.
Desktop must start the Python backend with `FEEDBACK_DESKTOP=1`; the renderer
detects its existing `feedBackDesktop` bridge. Both supported app routes (`/`
and `/v3`) serve `static/v3/index.html`, which installs the policy before the
effects host and plugin bootstrap.

`feedBack.ampSims` version 1 exposes:

- `snapshot()`: `{ready, enabled, generation, applicable, error}`.
- `subscribe(handler)`: immediately calls the handler with a snapshot and
  returns an unsubscribe function. Handlers may return cleanup promises.
  Desktop uses `subscribe(handler, {phase: 'finalize'})` for its final live-chain
  clear: this phase runs only for applicable disabled snapshots, after ordinary
  handlers settle (even on failure). A late finalizer joins the current barrier.
  Never call `whenSettled()` inside a handler; it would wait on itself.
- `setEnabled(boolean)`: persists the preference and resolves only after all
  transition handlers settle. Failure rejects and leaves processing disabled.
- `applySettings(settings, {generation, error})`: hydrate a successful settings
  read, using the generation captured **before** starting the request. A stale
  response cannot replace a newer user intent.
- `whenSettled()`: await outstanding transition work; rejects on policy error.

Consumers allow automatic tone work only when
`!snapshot.applicable || (snapshot.ready && snapshot.enabled)`. OFF invalidates
all subscribers synchronously. ON waits for preceding suspension and a successful
save. Each owner must invalidate its own asynchronous work and check generation
after awaits and before native writes. Suspend timers, requests and watchers;
preserve catalogs, mappings, saved chains and plugin master preferences.

The effects host rejects disabled/stale loads with `code: 'amp-sims-disabled'`,
`status: 'disabled'`, and outcome `denied` or `stale`. This is terminal: callers
must not retry through a legacy API. Route release remains allowed while off.
Pass `providerId` to `releaseRoute` when releasing an owned route; a different
selected owner returns `code: 'audio-effects-owner-mismatch'` without release.
Policy teardown must never stop shared audio input or native backing playback.

Backend plugins receive `context['amp_sims_policy']`, a dict containing
`snapshot()` and `subscribe(handler)`. Subscribe delivers the same five fields
immediately and returns an unsubscribe function. Successful settings POST,
reset and import update the cache in commit order and notify outside the settings
write lock. Callbacks must only invalidate/wake a worker, never wait for a scan.
Workers should wait on an event/condition while disabled, inspect the cached
snapshot before scanning, and reject results with an old generation before
committing. There is no periodic settings-file or HTTP polling.
