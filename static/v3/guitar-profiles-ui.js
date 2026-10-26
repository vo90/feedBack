/* Shared physical-instrument picker for the header and Audio settings. */
(function () {
    'use strict';
    const service = window.feedBack?.guitarProfiles;
    if (!service) return;
    const mounted = new WeakSet();
    let notice = '', pending = 0, workflow = null;
    const typeLabel = type => type === 'bass' ? 'Bass' : type === 'guitar' ? 'Guitar' : 'Unclassified';
    const db = gain => { const value = 20 * Math.log10(gain); return `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`; };
    function requireUnlocked() {
        if (service.getSnapshot().locked) throw new Error('Close the song before changing instruments or input levels.');
    }
    async function act(work) {
        notice = ''; ++pending; render();
        try { requireUnlocked(); await work(); }
        catch (error) { notice = error.message || 'Could not update the instrument.'; }
        finally { --pending; render(); }
    }
    function mount(host) {
        if (mounted.has(host)) return;
        mounted.add(host);
        host.classList.add('guitar-picker');
        host.innerHTML = `<label class="guitar-picker-label">My instrument
            <select data-guitar-select aria-label="Selected instrument"></select></label>
            <div class="guitar-picker-level"><span data-guitar-gain></span><span data-guitar-status></span></div>
            <div class="guitar-picker-actions">
                <button type="button" data-guitar-calibrate>Calibrate input</button>
                <button type="button" data-guitar-add>Add instrument</button>
                <button type="button" data-guitar-manage>Manage</button>
            </div>
            <div data-guitar-details hidden>
                <p data-guitar-route class="guitar-picker-help"></p>
                <label class="guitar-picker-label">Instrument type
                    <select data-guitar-classify aria-label="Instrument type"><option value="">Unclassified</option><option value="guitar">Guitar</option><option value="bass">Bass</option></select>
                </label>
                <label class="guitar-picker-label">Input gain
                    <input data-guitar-slider type="range" min="-20" max="13.9794" step="0.1" aria-label="Instrument input gain in decibels">
                </label>
                <div class="guitar-picker-actions">
                    <button type="button" data-guitar-rename>Rename</button>
                    <button type="button" data-guitar-duplicate>Duplicate</button>
                    <button type="button" data-guitar-delete>Delete</button>
                </div>
                <p class="guitar-picker-help">Guitar and Bass are ready to use. Add your own instruments to remember their input levels. Keep your hardware gain and instrument volume consistent.</p>
            </div>
            <form data-guitar-form hidden>
                <p data-guitar-step class="guitar-picker-step"></p>
                <label data-guitar-type-step class="guitar-picker-label">Instrument type
                    <select data-guitar-new-type aria-label="New instrument type"><option value="">Choose a type</option><option value="guitar">Guitar</option><option value="bass">Bass</option></select>
                </label>
                <label data-guitar-name-step class="guitar-picker-label"><span data-guitar-form-title>Instrument name</span>
                    <input data-guitar-name type="text" maxlength="80" autocomplete="off" placeholder="e.g. Strat">
                </label>
                <div data-guitar-calibration-step hidden>
                    <p class="guitar-picker-help">Set the input level for <strong data-guitar-draft-name></strong>, or skip and calibrate later. Nothing is saved until you choose Save instrument.</p>
                    <div class="guitar-picker-actions"><button type="button" data-guitar-draft-calibrate>Calibrate input</button><button type="button" data-guitar-skip>Skip for now</button></div>
                </div>
                <div data-guitar-review-step hidden><p data-guitar-review class="guitar-picker-review"></p><p data-guitar-review-gain class="guitar-picker-help"></p></div>
                <div class="guitar-picker-actions"><button type="button" data-guitar-back>Back</button><button type="submit" data-guitar-submit>Next</button><button type="button" data-guitar-cancel>Cancel</button></div>
            </form>
            <div data-guitar-delete-confirm hidden><p>Delete <strong data-guitar-delete-name></strong> and its saved levels?</p>
                <div class="guitar-picker-actions"><button type="button" data-guitar-delete-yes>Delete instrument</button><button type="button" data-guitar-delete-no>Keep instrument</button></div>
            </div>
            <p data-guitar-message class="guitar-picker-message" role="status" aria-live="polite"></p>`;
        const get = name => host.querySelector(`[data-guitar-${name}]`);
        const ownsWorkflow = () => workflow?.owner === host.dataset.guitarPicker;
        let sliderContext = null, sliderCancelled = false, deleteId = null;
        get('select').addEventListener('change', () => {
            if (service.getSnapshot().locked) { render(); return; }
            const id = get('select').value;
            const profile = service.getSnapshot().profiles.find(item => item.id === id);
            if (profile && !profile.type) {
                workflow = {kind: 'classify', owner: host.dataset.guitarPicker, id, step: 'type', type: '', name: profile.name};
                notice = ''; render(); get('new-type').focus();
            } else void act(() => service.select(id));
        });
        get('manage').onclick = () => { get('details').hidden = !get('details').hidden; };
        if (host.dataset.guitarPicker === 'settings') get('details').hidden = false;
        get('classify').onchange = () => {
            const id = service.getSnapshot().activeId, type = get('classify').value;
            if (type) void act(() => service.classify(id, type));
        };
        function openForm(kind) {
            if (service.getSnapshot().locked) return;
            const s = service.getSnapshot();
            workflow = {kind, owner: host.dataset.guitarPicker, id: s.activeId, step: kind === 'create' ? 'type' : 'name',
                type: '', name: kind === 'create' ? '' : s.activeName + (kind === 'duplicate' ? ' copy' : ''), calibration: null, context: null};
            notice = ''; render();
            get(kind === 'create' ? 'new-type' : 'name').focus();
        }
        get('add').onclick = () => openForm('create');
        get('rename').onclick = () => openForm('rename');
        get('duplicate').onclick = () => openForm('duplicate');
        get('cancel').onclick = () => { if (ownsWorkflow()) workflow = null; notice = ''; render(); };
        get('new-type').onchange = () => { if (ownsWorkflow()) workflow.type = get('new-type').value; };
        get('name').oninput = () => { if (ownsWorkflow()) workflow.name = get('name').value; };
        get('back').onclick = () => {
            if (!ownsWorkflow() || service.getSnapshot().locked) return;
            workflow.step = {name: 'type', calibration: 'name', review: 'calibration'}[workflow.step] || 'type';
            workflow.calibration = null; notice = ''; render();
        };
        get('form').onsubmit = event => {
            event.preventDefault();
            if (!ownsWorkflow()) return;
            const draft = workflow;
            void act(async () => {
                if (draft.kind === 'classify') {
                    if (!['guitar', 'bass'].includes(draft.type)) return;
                    await service.classify(draft.id, draft.type);
                    if (workflow === draft) workflow = null;
                } else if (draft.kind !== 'create') {
                    if (!draft.name.trim()) return;
                    if (draft.kind === 'duplicate') await service.duplicate(draft.id, draft.name.trim());
                    else await service.rename(draft.id, draft.name.trim());
                    if (workflow === draft) workflow = null;
                } else if (draft.step === 'type') {
                    if (!['guitar', 'bass'].includes(draft.type)) return;
                    draft.step = 'name';
                } else if (draft.step === 'name') {
                    if (!draft.name.trim()) return;
                    const context = await service.captureDraftContext(draft.type);
                    if (workflow === draft) { draft.context = context; draft.step = 'calibration'; }
                } else if (draft.step === 'review') {
                    const data = {name: draft.name.trim(), type: draft.type};
                    if (draft.calibration) data.calibration = draft.calibration;
                    await service.createInstrument(data, draft.context);
                    if (workflow === draft) workflow = null;
                }
            });
        };
        get('draft-calibrate').onclick = () => {
            if (!ownsWorkflow()) return;
            const draft = workflow;
            void act(async () => {
                if (!window.noteDetect?.measureInstrumentGain) throw new Error('Enable the updated Note Detection plugin to calibrate, or choose Skip for now.');
                const result = await window.noteDetect.measureInstrumentGain({type: draft.type, name: draft.name.trim(), context: draft.context});
                // A cancelled or replaced form must never be resurrected by a late result.
                if (workflow !== draft) return;
                if (result) { draft.calibration = result; draft.context = result.context; draft.step = 'review'; }
                else notice = 'Calibration cancelled. Try again or choose Skip for now.';
            });
        };
        get('skip').onclick = () => {
            if (!ownsWorkflow() || service.getSnapshot().locked) return;
            workflow.calibration = null; workflow.step = 'review'; notice = ''; render();
        };
        get('delete').onclick = () => {
            const selected = service.getSnapshot();
            if (selected.locked || selected.builtin) return;
            deleteId = selected.activeId;
            get('delete-name').textContent = selected.activeName;
            get('delete-confirm').hidden = false;
        };
        get('delete-no').onclick = () => { deleteId = null; get('delete-confirm').hidden = true; };
        get('delete-yes').onclick = () => void act(async () => {
            await service.remove(deleteId); deleteId = null; get('delete-confirm').hidden = true;
        });
        // Handle capture failures immediately, including gestures cancelled before Save.
        const captureSliderContext = () => service.captureContext().then(context => ({context}), error => ({error}));
        get('slider').addEventListener('pointerdown', () => { sliderCancelled = false; sliderContext = captureSliderContext(); });
        get('slider').addEventListener('keydown', event => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
                sliderCancelled = false; sliderContext = captureSliderContext();
            }
        });
        // Retain the original context if a service update disables a drag in progress.
        get('slider').addEventListener('pointercancel', () => { sliderCancelled = true; });
        get('slider').addEventListener('input', () => { get('gain').textContent = `${Number(get('slider').value).toFixed(1)} dB (preview)`; });
        get('slider').addEventListener('change', () => {
            if (sliderCancelled) { sliderContext = null; render(); return; }
            const value = Math.max(0.1, Math.min(5, 10 ** (Number(get('slider').value) / 20)));
            const captured = sliderContext || captureSliderContext(); sliderContext = null;
            void act(async () => {
                const result = await captured;
                if (result.error) throw result.error;
                await service.saveGain(value, result.context);
            });
        });
        get('calibrate').onclick = () => void act(async () => {
            await service.refresh();
            if (!window.noteDetect?.launchGuitarCalibration) throw new Error('Enable the updated Note Detection plugin to calibrate. You can also adjust input gain under Manage.');
            await window.noteDetect.launchGuitarCalibration();
        });
    }
    function renderWorkflow(host) {
        const get = name => host.querySelector(`[data-guitar-${name}]`);
        const draft = workflow?.owner === host.dataset.guitarPicker ? workflow : null;
        get('form').hidden = !draft;
        if (!draft) return;
        const creating = draft.kind === 'create';
        get('step').textContent = creating ? {type: '1 of 4 · Type', name: '2 of 4 · Name', calibration: '3 of 4 · Input level', review: '4 of 4 · Review'}[draft.step] : draft.kind === 'classify' ? `Choose a type for ${draft.name}` : draft.kind === 'duplicate' ? 'Duplicate instrument' : 'Rename instrument';
        for (const stage of ['type', 'name', 'calibration', 'review']) get(stage + '-step').hidden = draft.step !== stage;
        get('new-type').required = draft.step === 'type';
        get('new-type').value = draft.type;
        get('name').required = draft.step === 'name';
        if (document.activeElement !== get('name')) get('name').value = draft.name;
        get('form-title').textContent = draft.kind === 'duplicate' ? 'Name for the copy' : 'Instrument name';
        get('draft-name').textContent = `${draft.name.trim()} (${typeLabel(draft.type)})`;
        get('review').textContent = `${draft.name.trim()} · ${typeLabel(draft.type)}`;
        get('review-gain').textContent = draft.calibration
            ? `Input gain ${db(draft.calibration.gain)} will be saved for this audio input. ${draft.calibration.metadata?.quality?.status === 'verified' ? 'Normal and soft notes verified on every string.' : 'Input level measured; note detection has not been verified.'}`
            : 'Input level has not been calibrated. You can calibrate it later.';
        get('back').hidden = !creating || draft.step === 'type';
        get('submit').hidden = creating && draft.step === 'calibration';
        get('submit').textContent = draft.kind === 'classify' ? 'Save and select' : !creating ? 'Save' : draft.step === 'review' ? 'Save instrument' : 'Next';
    }
    function render() {
        const s = service.getSnapshot();
        const selected = s.profiles.find(profile => profile.id === s.activeId);
        document.querySelectorAll('[data-guitar-picker]').forEach(host => {
            mount(host);
            const get = name => host.querySelector(`[data-guitar-${name}]`);
            const select = get('select'), signature = JSON.stringify(s.profiles);
            if (select.dataset.options !== signature) {
                select.replaceChildren(...s.profiles.map(profile => {
                    const option = document.createElement('option'); option.value = profile.id;
                    option.textContent = profile.builtin ? profile.name : `${profile.name} · ${typeLabel(profile.type)}`;
                    return option;
                }));
                select.dataset.options = signature;
            }
            select.value = s.activeId;
            get('classify').value = selected?.type || '';
            get('gain').textContent = 'Input gain ' + db(s.gain);
            get('status').textContent = !s.loaded ? 'Loading…' : !s.applied ? 'Not applied'
                : s.calibrationStatus === 'verified' ? 'Detection verified'
                : s.calibrationStatus === 'manual' ? 'Manual gain · unverified'
                : s.calibrated ? 'Level saved · unverified' : 'Not calibrated';
            get('route').textContent = s.routeLabel;
            if (document.activeElement !== get('slider')) get('slider').value = 20 * Math.log10(s.gain);
            get('message').textContent = s.locked ? 'Close the song before changing instruments or input levels.' : notice || s.error || (!selected?.type ? 'Choose Guitar or Bass under Manage for this saved instrument.' : !s.routeKey ? s.routeLabel : '');
            renderWorkflow(host);
            host.querySelectorAll('button, select, input').forEach(el => { el.disabled = !!(pending || s.busy || !s.loaded || s.locked); });
            for (const action of ['manage', 'cancel', 'delete-no']) get(action).disabled = false;
            for (const action of ['delete', 'rename', 'classify']) get(action).disabled ||= !!s.builtin;
            get('classify').disabled ||= !!selected?.type;
            get('duplicate').disabled ||= !selected?.type;
            get('calibrate').disabled ||= !selected?.type;
            get('slider').disabled ||= !s.routeKey;
        });
        document.querySelectorAll('[data-guitar-active-label]').forEach(el => {
            el.textContent = s.activeName; el.title = `${s.activeName} · ${typeLabel(s.activeType)} · ${db(s.gain)}`;
        });
        window.v3Badges?.syncInstrumentProfile?.(s);
    }
    window.feedBack.guitarProfilesUI = {render};
    service.subscribe(render);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, {once: true});
    else render();
})();
