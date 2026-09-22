// Chromium can keep resolving a native selection inside display:none content
// on every frame. Own its lifetime at UI boundaries, not in the render loop.
const coordinators = new WeakMap();

function parent(node) {
    return node?.assignedSlot || node?.parentNode || node?.host || null;
}

function contains(root, node) {
    for (let n = node; n; n = parent(n)) if (n === root) return true;
    return false;
}

function editor(node) {
    let result = null;
    for (let n = node; n; n = parent(n)) {
        if (n.nodeType !== 1) continue;
        if (n.matches('input, textarea')) return n;
        if (n.isContentEditable) result = n;
        else if (result) break;
    }
    return result;
}

function fieldPosition(field) {
    if (!field?.matches('input, textarea') || field.selectionStart == null) return null;
    return { field, value: field.value, start: field.selectionStart,
        end: field.selectionEnd, direction: field.selectionDirection };
}

function restoreField(saved) {
    if (saved?.field.isConnected && saved.field.value === saved.value) {
        saved.field.setSelectionRange(saved.start, saved.end, saved.direction);
    }
}

export function selectionLifecycle(doc = document) {
    if (coordinators.has(doc)) return coordinators.get(doc);
    const win = doc.defaultView;
    const bookmarks = new WeakMap();
    const shadowRoots = new WeakMap();
    const registrations = new Set(); // weak references, with explicit unmount cleanup
    let observed = new Set(), queued = false, disposed = false, busy = false;
    let diagnostic = null;

    function focused() {
        let active = doc.activeElement;
        for (;;) {
            const next = (active?.shadowRoot || shadowRoots.get(active))?.activeElement;
            if (!next) return active;
            active = next;
        }
    }

    function suppressed(node, hiding) {
        if (!node?.isConnected) return true;
        if (hiding && contains(hiding, node)) return true;
        let first = true;
        for (let n = node; n; n = parent(n)) {
            if (n === hiding) return true;
            // Light DOM excluded from its host's slots has no rendered content,
            // even though getComputedStyle still reports display:inline/block.
            const host = n.parentNode;
            if (host && (host.shadowRoot || shadowRoots.has(host)) && !n.assignedSlot) return true;
            if (n.nodeType !== 1) continue;
            const style = win.getComputedStyle(n);
            if (n.tagName === 'SLOT' && n.assignedNodes().length && n.contains(node)) return true;
            // visibility is inherited but a child can explicitly override it.
            if (first && (style.visibility === 'hidden' || style.visibility === 'collapse')) return true;
            if (style.display === 'none' || style.contentVisibility === 'hidden') return true;
            if (n.tagName === 'DETAILS' && !n.open && n !== node) {
                const summary = [...n.children].find(child => child.tagName === 'SUMMARY');
                if (!summary || !contains(summary, node)) return true;
            }
            first = false;
        }
        return false;
    }

    function remember(selection) {
        if (!selection?.rangeCount) return;
        const owner = editor(selection?.anchorNode);
        if (!owner?.isContentEditable || !contains(owner, selection.focusNode)) return;
        bookmarks.set(owner, {
            anchor: selection.anchorNode, a: selection.anchorOffset,
            focus: selection.focusNode, f: selection.focusOffset,
            html: owner.innerHTML,
        });
    }

    function watch(selection) {
        const next = new Set();
        if (selection?.rangeCount) {
            for (const node of [selection.anchorNode, selection.focusNode]) {
                for (let n = node; n; n = parent(n)) next.add(n);
            }
        }
        if (next.size === observed.size && [...next].every(n => observed.has(n))) return;
        observer.disconnect();
        for (const n of observed) if (n.host) n.removeEventListener('slotchange', watchSlotChange, true);
        observed = next;
        for (const n of next) {
            if (n.host) n.addEventListener('slotchange', watchSlotChange, true);
            observer.observe(n, {
                childList: true,
                ...(n.nodeType === 1 ? { attributes: true,
                    attributeFilter: ['class', 'style', 'hidden', 'open', 'slot', 'name'] } : {}),
            });
        }
    }

    function reconcile(trigger = 'visibility', hiding = null) {
        if (disposed || busy) return false;
        busy = true;
        const start = diagnostic ? win.performance.now() : 0;
        let cleared = false;
        try {
            let selection = doc.getSelection();
            // Avoid endpoint/editor traversal when the selection is empty.
            // Chromium can flush pending layout even for rangeCount; keep these
            // reads at lifecycle boundaries, never in a draw/transport loop.
            // An explicit hide still needs to preserve and blur its editor.
            if (!selection?.rangeCount && !hiding) {
                watch(null);
                return false;
            }
            const active = focused();
            const activeEditor = editor(active);
            if (activeEditor && suppressed(activeEditor, hiding)) {
                // Let the browser complete composition/blur itself. Capture the
                // resulting selection after blur; never synthesize IME events.
                remember(selection);
                const position = fieldPosition(activeEditor);
                active.blur();
                restoreField(position);
                selection = doc.getSelection();
            }
            const hidden = selection?.rangeCount &&
                (suppressed(selection.anchorNode, hiding) || suppressed(selection.focusNode, hiding));
            if (hidden) {
                remember(selection);
                // Chromium's document selection can be anchored at a field's
                // parent. Preserve a different visible field's independent caret.
                const position = fieldPosition(focused());
                selection.removeAllRanges();
                restoreField(position);
                cleared = true;
            } else if (trigger === 'event' && selection?.rangeCount) {
                // A new visible selection, including one set by an editor's
                // own code, takes precedence over a saved navigation bookmark.
                const owner = editor(selection.anchorNode);
                if (owner) bookmarks.delete(owner);
            }
            watch(doc.getSelection());
        } finally {
            busy = false;
            diagnostic?.({ trigger, cleared, watchedNodes: observed.size,
                registeredRoots: registrations.size,
                milliseconds: win.performance.now() - start });
        }
        return cleared;
    }

    function schedule() {
        if (queued || disposed) return;
        queued = true;
        win.queueMicrotask(() => {
            queued = false;
            reconcile('event');
        });
    }

    function watchSlotChange() { schedule(); }

    const observer = new win.MutationObserver(records => {
        // No subtree observer: HUD/note mutations below unrelated descendants
        // must not cause selection work. Only owned ancestry/removal matters.
        if (records.some(r => r.type === 'attributes' ||
            [...r.removedNodes].some(n => observed.has(n)))) schedule();
    });

    function onFocus(event) {
        const target = event.composedPath()[0];
        const saved = bookmarks.get(target);
        if (saved && !suppressed(target)) {
            bookmarks.delete(target);
            // Replacement content invalidates a bookmark even with valid offsets.
            if (target.innerHTML === saved.html && contains(target, saved.anchor) && contains(target, saved.focus)) {
                doc.getSelection().setBaseAndExtent(saved.anchor, saved.a, saved.focus, saved.f);
            }
        }
        schedule();
    }

    function newIntent(event) {
        const target = editor(event.composedPath()[0]);
        if (target) bookmarks.delete(target);
    }

    const listeners = [
        ['selectionchange', schedule], ['focusin', onFocus], ['focusout', schedule],
        ['pointerdown', newIntent], ['beforeinput', newIntent],
        ['compositionend', schedule], ['toggle', schedule], ['slotchange', schedule],
    ];
    for (const [name, handler] of listeners) doc.addEventListener(name, handler, true);
    win.addEventListener('resize', schedule);

    const service = {
        prepareToHide(root) {
            if (!root || disposed) return false;
            const selection = doc.getSelection();
            const endpoints = selection?.rangeCount ? [selection.anchorNode, selection.focusNode] : [];
            if (![...endpoints, focused()].some(n => contains(root, n))) return false;
            return reconcile('hide', root);
        },
        finishVisibilityChange() { return reconcile('visibility'); },
        reconcileBeforePlayback() { return reconcile('playback'); },
        // Closed shadow owners register before editing and unregister on unmount.
        // Call prepareToHide before opaque visibility changes.
        registerShadowRoot(root) {
            if (disposed) throw new Error('Selection coordinator is disposed');
            if (!root?.host || root.ownerDocument !== doc) throw new TypeError('Expected an owned ShadowRoot');
            if (shadowRoots.has(root.host)) throw new Error('ShadowRoot already registered');
            shadowRoots.set(root.host, root);
            const ref = new WeakRef(root);
            for (const old of registrations) if (!old.deref()) registrations.delete(old);
            registrations.add(ref);
            for (const [name, handler] of listeners) root.addEventListener(name, handler, true);
            schedule();
            return () => {
                for (const [name, handler] of listeners) root.removeEventListener(name, handler, true);
                shadowRoots.delete(root.host);
                registrations.delete(ref);
                schedule();
            };
        },
        // Tests can opt in to aggregate timings. No text or values are emitted.
        setDiagnosticListener(listener) { diagnostic = listener; },
        dispose() {
            disposed = true;
            observer.disconnect();
            for (const n of observed) if (n.host) n.removeEventListener('slotchange', watchSlotChange, true);
            observed.clear();
            for (const [name, handler] of listeners) doc.removeEventListener(name, handler, true);
            for (const ref of registrations) {
                const root = ref.deref();
                if (!root) continue;
                for (const [name, handler] of listeners) root.removeEventListener(name, handler, true);
                shadowRoots.delete(root.host);
            }
            registrations.clear();
            win.removeEventListener('resize', schedule);
            coordinators.delete(doc);
            diagnostic = null;
        },
    };
    coordinators.set(doc, service);
    schedule();
    return service;
}
