/** Display placement only: independent of song corrections and musical options. */
export const GUIDE_PLACEMENT_KEY = 'feedback.harmonicGuide.placement.v1';
export const DEFAULT_GUIDE_PLACEMENT = Object.freeze({ version: 1, mode: 'top', x: 0.5, y: 0 });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const size = value => Number.isFinite(value) ? Math.max(0, value) : 0;

export function normalizeGuidePlacement(value) {
    if (!value || value.version !== 1 || value.mode !== 'floating'
        || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return { ...DEFAULT_GUIDE_PLACEMENT };
    return { version: 1, mode: 'floating', x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
}

export function createGuidePlacementStore(storage) {
    let placement;
    try { placement = normalizeGuidePlacement(JSON.parse(storage?.getItem(GUIDE_PLACEMENT_KEY) || 'null')); }
    catch (_) { placement = { ...DEFAULT_GUIDE_PLACEMENT }; }
    return {
        get() { return { ...placement }; },
        save(value) {
            placement = normalizeGuidePlacement(value);
            try {
                if (!storage) return false;
                storage.setItem(GUIDE_PLACEMENT_KEY, JSON.stringify(placement));
                return true;
            } catch (_) { return false; }
        },
    };
}

/** Coordinates are CSS pixels relative to the highway canvas, not the window. */
export function guidePlacementBounds(viewport, panel, margin = 12) {
    const width = size(viewport.width), height = size(viewport.height);
    const panelWidth = Math.min(width, size(panel.width)), panelHeight = Math.min(height, size(panel.height));
    const left = Math.min(margin, Math.max(0, (width - panelWidth) / 2));
    const top = Math.min(margin, Math.max(0, (height - panelHeight) / 2));
    return { left, top, right: Math.max(left, width - panelWidth - left),
        bottom: Math.max(top, height - panelHeight - top) };
}

export function guidePanelPosition(value, viewport, panel, hud = {}) {
    const placement = normalizeGuidePlacement(value);
    const bounds = guidePlacementBounds(viewport, panel);
    if (placement.mode === 'floating') return {
        left: bounds.left + placement.x * (bounds.right - bounds.left),
        top: bounds.top + placement.y * (bounds.bottom - bounds.top),
    };
    const gap = 12;
    const leftEdge = Math.max(bounds.left, hud.left ? hud.left.right + gap : bounds.left);
    const rightEdge = Math.min(bounds.right, hud.right ? hud.right.left - gap - panel.width : bounds.right);
    const centered = (size(viewport.width) - size(panel.width)) / 2;
    const hudTop = Math.min(...[hud.left?.top, hud.right?.top].filter(Number.isFinite));
    const top = Number.isFinite(hudTop) ? Math.max(bounds.top, hudTop) : bounds.top;
    // Only the side boxes matter when the panel fits between them. A tall
    // performance card on the right must not push the whole center dock down.
    if (leftEdge <= rightEdge) return { left: clamp(centered, leftEdge, rightEdge),
        top: clamp(top, bounds.top, bounds.bottom) };
    const belowHud = Math.max(bounds.top, hud.left?.bottom || 0, hud.right?.bottom || 0) + gap;
    return { left: clamp(centered, bounds.left, bounds.right), top: clamp(belowHud, bounds.top, bounds.bottom) };
}

/** Snap only when committing a drag; movement itself stays continuous. */
export function guidePlacementFromPoint(point, viewport, panel, { snap = 0, dock = null } = {}) {
    const bounds = guidePlacementBounds(viewport, panel);
    let left = clamp(point.left, bounds.left, bounds.right), top = clamp(point.top, bounds.top, bounds.bottom);
    if (snap > 0 && dock && Math.abs(left - dock.left) <= snap * 3 && Math.abs(top - dock.top) <= snap) {
        return { ...DEFAULT_GUIDE_PLACEMENT };
    }
    if (snap > 0) {
        if (left - bounds.left <= snap) left = bounds.left;
        else if (bounds.right - left <= snap) left = bounds.right;
        if (top - bounds.top <= snap) top = bounds.top;
        else if (bounds.bottom - top <= snap) top = bounds.bottom;
    }
    return { version: 1, mode: 'floating',
        x: bounds.right > bounds.left ? (left - bounds.left) / (bounds.right - bounds.left) : 0.5,
        y: bounds.bottom > bounds.top ? (top - bounds.top) / (bounds.bottom - bounds.top) : 0 };
}
