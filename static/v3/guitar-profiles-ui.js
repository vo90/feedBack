/* Shared guitar picker for the header, fullscreen player and Audio settings. */
(function () {
    'use strict';
    const service = window.feedBack?.guitarProfiles;
    if (!service) return;
    const mounted = new WeakSet();
    let notice = '';
    const db = gain => { const value = 20 * Math.log10(gain); return `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`; };
    async function pauseForSwitch() {
        if (window.feedBack?.isPlaying) {
            await window.togglePlay?.();
            if (window.feedBack?.isPlaying) throw new Error('Pause the song before switching guitars.');
        }
    }
    async function act(work) {
        notice = '';
        try { await work(); }
        catch (error) { notice = error.message || 'Could not update the guitar.'; }
        render();
    }
    function mount(host) {
        if (mounted.has(host)) return;
        mounted.add(host);
        host.classList.add('guitar-picker');
        host.innerHTML = `<label class="guitar-picker-label">My guitar
            <select data-guitar-select aria-label="Selected guitar"></select></label>
            <div class="guitar-picker-level"><span data-guitar-gain></span><span data-guitar-status></span></div>
            <div class="guitar-picker-actions">
                <button type="button" data-guitar-calibrate>Calibrate</button>
                <button type="button" data-guitar-add>Add guitar</button>
                <button type="button" data-guitar-manage>Manage</button>
            </div>
            <div data-guitar-details hidden>
                <p data-guitar-route class="guitar-picker-help"></p>
                <label class="guitar-picker-label">Input gain
                    <input data-guitar-slider type="range" min="-20" max="13.9794" step="0.1" aria-label="Guitar input gain in decibels">
                </label>
                <div class="guitar-picker-actions">
                    <button type="button" data-guitar-rename>Rename</button>
                    <button type="button" data-guitar-duplicate>Duplicate</button>
                    <button type="button" data-guitar-delete>Delete</button>
                </div>
                <p class="guitar-picker-help">Default guitar works without adding anything. Gain is remembered for each guitar and audio input. Keep your hardware gain and guitar volume consistent.</p>
            </div>
            <form data-guitar-form hidden>
                <label class="guitar-picker-label"><span data-guitar-form-title>Guitar name</span>
                    <input data-guitar-name type="text" maxlength="80" required autocomplete="off" placeholder="e.g. Strat">
                </label>
                <div class="guitar-picker-actions"><button type="submit">Save</button><button type="button" data-guitar-cancel>Cancel</button></div>
            </form>
            <div data-guitar-delete-confirm hidden><p>Delete <strong data-guitar-delete-name></strong> and its saved levels?</p>
                <div class="guitar-picker-actions"><button type="button" data-guitar-delete-yes>Delete guitar</button><button type="button" data-guitar-delete-no>Keep guitar</button></div>
            </div>
            <p data-guitar-message class="guitar-picker-message" role="status" aria-live="polite"></p>`;
        const get = name => host.querySelector(`[data-guitar-${name}]`);
        let edit = null, sliderContext = null, sliderCancelled = false, deleteId = null;
        get('select').addEventListener('change', () => {
            const id = get('select').value;
            void act(async () => { await pauseForSwitch(); await service.select(id); });
        });
        get('manage').onclick = () => { get('details').hidden = !get('details').hidden; };
        if (host.dataset.guitarPicker === 'settings') get('details').hidden = false;
        function openForm(action) {
            const s = service.getSnapshot();
            edit = {action, id: s.activeId};
            get('form').hidden = false;
            get('form-title').textContent = action === 'create' ? 'New guitar name' : action === 'duplicate' ? 'Name for the copy' : 'Guitar name';
            get('name').value = action === 'create' ? '' : s.activeName + (action === 'duplicate' ? ' copy' : '');
            get('name').focus();
        }
        get('add').onclick = () => openForm('create');
        get('rename').onclick = () => openForm('rename');
        get('duplicate').onclick = () => openForm('duplicate');
        get('cancel').onclick = () => { edit = null; get('form').hidden = true; };
        get('form').onsubmit = event => {
            event.preventDefault();
            const pending = edit, name = get('name').value.trim();
            if (!pending || !name) return;
            void act(async () => {
                await pauseForSwitch();
                if (pending.action === 'create') await service.create(name);
                else if (pending.action === 'duplicate') await service.duplicate(pending.id, name);
                else await service.rename(pending.id, name);
                edit = null; get('form').hidden = true;
            });
        };
        get('delete').onclick = () => {
            const selected = service.getSnapshot();
            deleteId = selected.activeId;
            get('delete-name').textContent = selected.activeName;
            get('delete-confirm').hidden = false;
        };
        get('delete-no').onclick = () => { deleteId = null; get('delete-confirm').hidden = true; };
        get('delete-yes').onclick = () => void act(async () => {
            await pauseForSwitch(); await service.remove(deleteId);
            deleteId = null; get('delete-confirm').hidden = true;
        });
        // Capture failures may arrive before the gesture finishes, or after it
        // is cancelled. Handle them immediately, then surface them on Save.
        const captureSliderContext = () => service.captureContext().then(context => ({context}), error => ({error}));
        get('slider').addEventListener('pointerdown', () => { sliderCancelled = false; sliderContext = captureSliderContext(); });
        get('slider').addEventListener('keydown', event => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
                sliderCancelled = false;
                sliderContext = captureSliderContext();
            }
        });
        // A service update may disable and blur the control during a drag.
        // Keep its original context so a later change cannot target a new guitar.
        get('slider').addEventListener('pointercancel', () => { sliderCancelled = true; });
        get('slider').addEventListener('input', () => { get('gain').textContent = `${Number(get('slider').value).toFixed(1)} dB (preview)`; });
        get('slider').addEventListener('change', () => {
            if (sliderCancelled) { sliderContext = null; render(); return; }
            const value = Math.max(0.1, Math.min(5, 10 ** (Number(get('slider').value) / 20)));
            const pending = sliderContext || captureSliderContext(); sliderContext = null;
            void act(async () => {
                const captured = await pending;
                if (captured.error) throw captured.error;
                await service.saveGain(value, captured.context);
            });
        });
        get('calibrate').onclick = () => void act(async () => {
            await pauseForSwitch();
            await service.refresh();
            if (!window.noteDetect?.launchGuitarCalibration) throw new Error('Enable the updated Note Detection plugin to calibrate. You can also adjust input gain under Manage.');
            await window.noteDetect.launchGuitarCalibration();
        });
    }
    function render() {
        const s = service.getSnapshot();
        document.querySelectorAll('[data-guitar-picker]').forEach(host => {
            mount(host);
            const select = host.querySelector('[data-guitar-select]');
            const signature = JSON.stringify(s.profiles);
            if (select.dataset.options !== signature) {
                select.replaceChildren(...s.profiles.map(profile => {
                    const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; return option;
                }));
                select.dataset.options = signature;
            }
            select.value = s.activeId;
            host.querySelector('[data-guitar-gain]').textContent = 'Input gain ' + db(s.gain);
            host.querySelector('[data-guitar-status]').textContent = !s.loaded ? 'Loading…' : !s.applied ? 'Not applied' : s.calibrated ? 'Saved' : 'Check level';
            host.querySelector('[data-guitar-route]').textContent = s.routeLabel;
            const slider = host.querySelector('[data-guitar-slider]');
            if (document.activeElement !== slider) slider.value = 20 * Math.log10(s.gain);
            host.querySelector('[data-guitar-message]').textContent = notice || s.error || (!s.routeKey ? s.routeLabel : '');
            host.querySelectorAll('button, select, input[type="range"]').forEach(el => { el.disabled = s.busy || !s.loaded; });
            host.querySelector('[data-guitar-delete]').disabled ||= s.activeId === 'default';
            host.querySelector('[data-guitar-slider]').disabled ||= !s.routeKey;
        });
        document.querySelectorAll('[data-guitar-active-label]').forEach(el => { el.textContent = s.activeName; el.title = `${s.activeName} · ${db(s.gain)}`; });
    }
    window.feedBack.guitarProfilesUI = {render};
    service.subscribe(render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once: true});
    else render();
})();
