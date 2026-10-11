# On-demand client diagnostics

`feedBack.diagnostics.contributeProvider(pluginId, snapshotFunction)` registers a
synchronous producer. Registration does not construct or retain a payload.
`snapshotContributions()` calls it when diagnostics are requested, such as during
export. The result describes **current state at request time**, including changes
since registration. It is not the last eagerly published historical snapshot.

The existing `contribute(pluginId, payload)` still stores the payload reference;
`snapshotContributions()` still shallow-copies those eager entries. Either API
replaces the other for the same ID. Invalid IDs/functions are ignored.

Each request freezes its eager entries and provider list before calling providers.
Changes to registrations during a call take effect on the next request. A nested
request made by a provider returns eager entries only; it does not call providers.
A throwing provider is omitted for that request, while other providers continue.
There is no stale cached fallback. Promise/thenable results are omitted: producers
must be synchronous. Native Promise rejections are observed; arbitrary thenables
are not invoked or awaited.

Producers must return detached, bounded, redacted values and avoid side effects.
The API does not sanitize or clone arbitrary provider results, just as the eager
API does not sanitize payloads. Producer failures are not logged or exported with
exception details. A materialized ID such as `__proto__` is an own data property.

Core capabilities uses this API when available and keeps its existing eager
fallback on older diagnostic hosts. Its public `inspect()` and
`snapshotDiagnostics()` still build a snapshot synchronously, with the existing
redaction, limits and copy isolation. Registry mutations, claim cleanup and
notifications are unchanged. A subscriber requesting diagnostics during a
registration now sees current registry state; nested externally mutable policy
data is also read at request time. This timing difference is deliberate.
