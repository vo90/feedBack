// A caret or text range can survive after its screen becomes display:none.
// Chromium then repeatedly walks the hidden subtree during playback. Clear
// non-editing selections wholly inside a screen being hidden. Text on the
// destination screen and editor/input selections remain intact.
export function clearHiddenScreenCaret(nextScreen, doc = document) {
    if (!nextScreen) return false;
    const selection = doc.getSelection?.();
    if (!selection?.anchorNode) return false;
    const anchor = selection.anchorNode;
    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    const screen = element?.closest?.('.screen');
    if (!screen || screen === nextScreen) return false;
    const focus = selection.focusNode;
    const focusElement = focus?.nodeType === 1 ? focus : focus?.parentElement;
    if (focusElement?.closest?.('.screen') !== screen) return false;
    if (element.isContentEditable || element.closest('input, textarea')) return false;
    if (focusElement.isContentEditable || focusElement.closest('input, textarea')) return false;
    // Chromium may anchor the document selection at an input's parent. Clearing
    // it can still reset the focused field's typing position, including in shadow DOM.
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active?.isContentEditable
        || active?.matches?.('input, textarea, select, [role="textbox"]')) return false;
    selection.removeAllRanges();
    return true;
}
