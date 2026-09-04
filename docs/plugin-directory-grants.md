# Native directory grants

Backend plugins sometimes need access to a directory selected through the
managed Desktop's native folder dialog, including a library other than the one
currently active in fee[dB]ack. The renderer is never allowed to submit an
arbitrary filesystem path to a plugin endpoint. Instead, Desktop registers the
native selection with Core and returns an opaque, short-lived grant.

## Plugin contract

The plugin loader exposes this owner-scoped callable:

```python
resolve_directory_grant(grant: str, purpose: str, *, consume: bool = True) -> pathlib.Path | None
```

`owner` is always the id of the plugin whose `setup(app, context)` is running;
it is not a caller-controlled argument. A grant resolves only when that owner
and the explicit purpose exactly match the values used at registration. Grants
expire after two minutes, disappear on Core restart, and are consumed on the
first successful resolution by default. A mismatch does not consume the grant.

Resolve a grant once at the beginning of a plugin-owned workflow, validate any
workflow-specific requirements, and store the resulting `Path` only in that
workflow's server-side state. Never return it to the browser or persist the
grant itself.

## Managed Desktop transport

Desktop privately registers a native selection with:

```text
POST /api/desktop/directory-grants
X-FeedBack-Desktop-Grant-Secret: <per-backend-run 256-bit secret>

{"owner":"hybrid_track","purpose":"library-root","path":"<native selection>"}
```

A successful `201` response is exactly:

```json
{"grant":"<opaque token>","expiresAt":1800000120000}
```

The endpoint accepts loopback clients only, authenticates before reading its
bounded request body, and is disabled when the Desktop secret is absent. The
secret is generated in Electron's main process, passed only in the spawned
Core process environment, and never exposed through preload or renderer APIs.
The endpoint never returns the selected path.

Installed plugin frontends currently share the Desktop's trusted renderer; the
bridge does not provide mutual isolation between their JavaScript contexts.
Desktop must therefore allowlist every registrable owner/purpose pair, while
Core's owner-scoped resolver remains the enforcement boundary between backend
plugins and against LAN callers. Mutually untrusted frontend plugins require
separate sandboxed renderer principals.

Browser/server-only installations have no native picker and therefore cannot
mint these grants. Plugins must retain their existing non-Desktop selection or
current-library fallback.
