# Selection ownership during navigation and playback

Chromium can repeatedly resolve a native selection whose endpoint is inside
hidden UI. In the measured FeedBack case this consumed renderer-main CPU on
every frame. The selection coordinator in `static/js/screen-selection.js` owns
this state across screens, panels, popups and playback entry. It does no work
from highway draw callbacks or transport timers.

Visible selections remain available for copying and editing. A native selection
with either endpoint in a hidden context is cleared, including a range spanning
visible and hidden content. Input/textarea offsets are independent of document
selection and are preserved. Contenteditable selections become weakly owned
bookmarks; valid bookmarks restore on intentional focus, without stealing focus.
A click, new input, a new visible selection or changed content invalidates the
bookmark. Navigation uses native blur/composition behavior without synthesizing
input events or changing editor contents.

## UI and plugin contract

Module consumers import `selectionLifecycle()` to obtain the per-document
singleton. Non-module UI and plugins use `window.feedBack.selectionLifecycle`.
The host initializes this at bootstrap. For a connected surface being hidden:

```js
const selection = window.feedBack.selectionLifecycle;
selection.prepareToHide(panel);
panel.hidden = true;
// Finish after the UI's usual focus and visibility changes.
selection.finishVisibilityChange();
```

Use the same boundary when removing a surface containing an editor. Existing
focus restoration still belongs to the UI owner. Call `reconcileBeforePlayback()`
immediately before an independently owned audio start. Core HTML, count-in and
queued native starts already do so; this adds no animation-frame wait or audio
buffer change. Completion events provide an additional reconciliation.

The coordinator also observes selection changes and only the current endpoints'
ancestor attributes/direct removals. This catches late selections and ordinary
plugin class/style visibility changes. It does not observe the whole document
subtree. An owner changing visibility through an external stylesheet, a sibling
selector or another opaque mechanism must call `finishVisibilityChange()`.

Open shadow roots and assigned slots participate in composed ancestry. A closed
shadow editor must register its root before editing, and dispose the registration
on unmount:

```js
const unregister = selection.registerShadowRoot(closedRoot);
// ... when unmounting:
selection.prepareToHide(closedRoot.host);
unregister();
```

Only actual rendering suppression clears selections. Offscreen scrolling,
opacity, window occlusion and `aria-hidden` alone are not hiding boundaries.
Unassigned light DOM and slot fallback replaced by assigned content are hidden;
closed `details` content is hidden except for its visible summary.

Native mouse selections inside shadow trees can be reported by Chromium as
endpoints at the visible host's parent. On browsers with `getComposedRanges`,
the coordinator resolves the actual endpoints through registered closed roots
and open roots discovered at the endpoints, including nested roots. It does not
scan the document. Older engines without this API retain ordinary endpoint
handling; internal shadow visibility is not fully covered there.
If hiding causes Chromium to drop the reported range direction, a weak record
preserves the last direction only while the composed endpoints still match.

An empty selection releases all ancestry watchers and skips editor traversal.
Repeated visibility-completion calls reuse that known-empty state until a
selection/focus event invalidates it. Explicit hide and physical-start checks
always inspect current state, including changes made before the browser delivers
`selectionchange`. A selection created after a visibility hook is caught by its
selection event; owners should still prepare their surface before hiding it.
Chromium may flush pending layout when reading even `rangeCount`, so checks are
confined to lifecycle/selection events and physical start boundaries. Measure
initial-loading and navigation costs separately from steady playback cadence.

## Verification

`tests/browser/screen-selection.test.cjs` runs actual DOM, editing, visibility,
race and browser IME tests using an installed Playwright Chromium. The exported
fixture in `selection-fixture.cjs` can also run unchanged in a managed Electron
window. `native-selection-fixture.cjs` covers backward mouse ranges in open,
nested and registered closed roots, both explicit and observed hiding, and
editor return positions. Programmatically created ranges alone miss this case.
Native OS input-method combinations require separate interactive checks;
synthetic DOM composition events alone are insufficient.

The Node tests check screen event ordering and physical start/queue boundaries.
The existing playback, count-in, loop, settings and keyboard suites remain part
of validation. Optional `setDiagnosticListener(fn)` exposes only outcome, watcher
count and elapsed time for bounded tests, never editor contents or selected text.
