import {
    getHarmonyGuidePreferences, setHarmonyGuidePreferences, subscribeHarmonyGuidePreferences,
} from './harmony-guide-controller.js';

let previousCleanup = null;

/** Mount the standard 3D settings control, sharing the player preference. */
export function mountHarmonyGuideSettings(root, storage = globalThis.localStorage) {
    previousCleanup?.();
    if (!root?.isConnected) return () => {};
    const toggle = root.querySelector('[data-harmony-enabled]');
    const status = root.querySelector('[data-harmony-status]');
    if (!toggle || !status) return () => {};
    let unsubscribe = () => {};
    let observer = null;
    const cleanup = () => {
        unsubscribe();
        observer?.disconnect();
        toggle.removeEventListener('change', change);
        if (previousCleanup === cleanup) previousCleanup = null;
    };
    const render = preferences => {
        if (!root.isConnected) { cleanup(); return; }
        toggle.checked = preferences.enabled;
    };
    const change = () => {
        try {
            setHarmonyGuidePreferences({ enabled: toggle.checked }, storage);
            status.textContent = '';
        } catch (error) {
            render(getHarmonyGuidePreferences(storage));
            status.textContent = error.message || 'Could not save the harmony guide setting.';
        }
    };
    render(getHarmonyGuidePreferences(storage));
    toggle.disabled = false;
    toggle.addEventListener('change', change);
    unsubscribe = subscribeHarmonyGuidePreferences(render, storage);
    // Watch removal of the settings panel without observing gameplay subtree
    // mutations. Any ancestor being removed disconnects this subscription.
    if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => { if (!root.isConnected) cleanup(); });
        for (let parent = root.parentNode; parent; parent = parent.parentNode) {
            observer.observe(parent, { childList: true });
        }
    }
    previousCleanup = cleanup;
    return cleanup;
}
