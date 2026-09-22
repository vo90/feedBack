// A collapsed selection can survive after its screen becomes display:none.
// Chromium then repeatedly walks the hidden subtree to resolve a visible caret
// during playback. Drop that empty, non-editing caret at the screen boundary;
// keep real text selections and editor/input carets intact.
export function clearHiddenScreenCaret(nextScreen, doc = document) {
    if (!nextScreen) return false;
    const selection = doc.getSelection?.();
    if (!selection?.isCollapsed || !selection.anchorNode) return false;
    const anchor = selection.anchorNode;
    const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    const screen = element?.closest?.('.screen');
    if (!screen || screen === nextScreen) return false;
    if (element.isContentEditable || element.closest('input, textarea')) return false;
    selection.removeAllRanges();
    return true;
}
