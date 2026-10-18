// Shared input/output notices. Loading a plugin script only starts its async
// device restoration; the desktop owner publishes the actual completion state.
export function installAudioStatus() {
    if (window.feedBackAudioStatus) return window.feedBackAudioStatus;
    let loaderSettled = false, backendSettled = false, stack = null;
    const cards = new Map();
    function isInitializing() {
        if (!window.feedBackDesktop?.audio) return false;
        const initialization = window.__feedBackDesktopAudioHooks?.initialization;
        return initialization ? initialization.state === 'pending' : !loaderSettled;
    }
    function clear(channel) {
        const card = cards.get(channel);
        if (card) { card.notice.remove(); cards.delete(channel); }
        if (stack && !cards.size) { stack.remove(); stack = null; }
    }
    function setHidden(channel, hidden) {
        const card = cards.get(channel);
        if (card) card.notice.hidden = !!hidden;
    }
    function set(channel, { message, detail = '', hidden = false }) {
        if (!message || isInitializing()) { clear(channel); return; }
        if (!document.body) return;
        let card = cards.get(channel);
        if (!card) {
            if (!stack) {
                stack = document.createElement('div');
                stack.id = 'audio-status-notices';
                stack.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10000;display:flex;flex-direction:column;gap:10px;width:420px;max-width:calc(100% - 32px);pointer-events:none;';
                document.body.appendChild(stack);
            }
            const notice = document.createElement('div');
            notice.className = 'fb-audio-status' + (channel === 'input' ? ' nd-input-status' : '');
            notice.id = channel === 'output' ? 'desktop-output-status' : 'audio-input-status';
            notice.setAttribute('role', 'status');
            notice.setAttribute('aria-live', 'polite');
            notice.style.cssText = 'box-sizing:border-box;padding:12px 16px;border:1px solid #8d713d;border-radius:8px;background:#29251c;color:#f4e4bd;font:14px/1.5 system-ui;pointer-events:auto;';
            const text = document.createElement('div');
            notice.appendChild(text);
            const settings = document.createElement('button');
            settings.type = 'button';
            settings.className = 'fb-audio-status-settings' + (channel === 'input' ? ' nd-input-status-settings' : '');
            settings.textContent = 'Audio settings';
            settings.style.cssText = 'display:block;margin-top:6px;padding:0;border:0;background:transparent;font:inherit;text-decoration:underline;color:inherit;cursor:pointer;';
            settings.onclick = () => window.showScreen?.(document.getElementById('plugin-audio_engine') ? 'plugin-audio_engine' : 'settings');
            notice.appendChild(settings);
            const details = document.createElement('details');
            details.style.cssText = 'margin-top:4px;font-size:12px;overflow-wrap:anywhere;';
            const summary = document.createElement('summary');
            summary.textContent = 'Details';
            details.appendChild(summary);
            const detailText = document.createElement('div');
            detailText.className = 'fb-audio-status-detail' + (channel === 'input' ? ' nd-input-status-detail' : '');
            details.appendChild(detailText);
            notice.appendChild(details);
            card = { notice, text, details, detailText };
            cards.set(channel, card);
            stack.appendChild(notice);
        }
        if (card.text.textContent !== message) card.text.textContent = message;
        if (card.detailText.textContent !== detail) card.detailText.textContent = detail;
        card.details.hidden = !detail;
        card.notice.hidden = !!hidden;
    }
    function pluginLoadFinished(plugins) {
        const engine = plugins.find(plugin => plugin.id === 'audio_engine');
        // An absent entry during backend loading is only a partial inventory.
        if ((!engine && !backendSettled) || engine?.status === 'installing') return;
        if (!loaderSettled) {
            loaderSettled = true;
            if (!isInitializing()) window.dispatchEvent(new CustomEvent('feedback:audio-initialized'));
        }
    }
    const api = { isInitializing, set, clear, setHidden, pluginLoadFinished,
        pluginStartupFinished() { backendSettled = true; } };
    window.feedBackAudioStatus = api;
    return api;
}
