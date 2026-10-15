/* One owner for physical-instrument calibration. Tone plugins own their drive only. */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory;
    else {
        const host = root.feedBack = root.feedBack || {};
        const request = async (body) => {
            const response = await root.fetch('/api/guitar-profiles', body ? {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
            } : undefined);
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || 'Instrument settings are unavailable.');
            return data;
        };
        const legacy = () => {
            try { return JSON.parse(root.localStorage.getItem('slopsmith_notedetect') || '{}'); }
            catch (_) { return {}; }
        };
        host.guitarProfiles = factory({
            request,
            session: () => root.feedBack?.instrumentSession,
            async readGameContext() {
                const response = await root.fetch('/api/settings');
                if (!response.ok) throw new Error('Could not read the selected game instrument.');
                return response.json();
            },
            async applyGameType(type, guitarRole) {
                const response = await root.fetch('/api/settings', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({active_instrument_profile: type === 'bass' ? 'bass' : guitarRole}),
                });
                const result = await response.json();
                if (!response.ok || result.error) throw new Error(result.error || 'Could not select the game instrument.');
            },
            async selectionChanged() {
                await root.loadSettings?.();
                await root.v3Badges?.reload?.();
                root.dispatchEvent(new Event('feedback:instrument-profile-changed'));
            },
            async readLegacyGain() {
                const s = legacy();
                const valid = value => Number.isFinite(value) && value >= 0.1 && value <= 5;
                if (valid(s.engineInputGain)) return s.engineInputGain;
                if (!root.feedBackDesktop?.audio && valid(s.inputGain)) return s.inputGain;
                // Older Rig-only setups stored their clean trim here.
                try {
                    const response = await root.fetch('/api/plugins/rig_builder/settings');
                    if (response.ok) {
                        const value = (await response.json()).nam_input_calibration;
                        if (Number.isFinite(value) && value >= 0.1 && value <= 5) return value;
                    }
                } catch (_) { /* Rig is optional. */ }
                return valid(s.inputGain) ? s.inputGain : null;
            },
            async readRoute() {
                const audio = root.feedBackDesktop?.audio;
                if (audio) {
                    const device = await audio.getCurrentDevice?.();
                    const input = await audio.getInputChannelSnapshot?.();
                    if (!device?.input || !input?.running) return {kind: 'unavailable', key: '', label: 'Start your audio input', generation: 0};
                    const channel = Number.isInteger(input.selected) ? input.selected : -1;
                    const backend = device.inputType || device.type || '';
                    const identity = device.inputId || device.input;
                    if (!device.inputId && device.inputAmbiguous) return {kind: 'unavailable', key: '', label: 'Choose an unambiguous input device', generation: input.generation};
                    return {kind: 'native', deviceId: identity, channel,
                        key: JSON.stringify(['guitar-input-v1', backend, identity, channel]),
                        label: `${device.input} · ${channel < 0 ? 'first pair' : 'Input ' + (channel + 1)}`,
                        generation: input.generation};
                }
                const s = legacy(), deviceId = s.deviceId || '';
                const channel = s.channel === 'left' ? 0 : s.channel === 'right' ? 1 : -1;
                return {kind: 'browser', deviceId, channel,
                    key: JSON.stringify(['guitar-browser-v1', deviceId, channel]),
                    label: 'Browser input' + (channel < 0 ? ' · mono' : ' · Input ' + (channel + 1)), generation: 0};
            },
            async applyGain(gain, route) {
                if (route.kind !== 'native') return;
                const audio = root.feedBackDesktop?.audio;
                if (!audio?.setInputCalibrationGain || !await audio.setInputCalibrationGain(gain)) {
                    throw new Error('Instrument gain could not be applied. This feature needs the updated Desktop audio engine.');
                }
            },
        });
        host.instrumentProfiles = host.guitarProfiles;
        const watchSession = () => host.guitarProfiles.watchSession();
        root.addEventListener('feedback:instrument-session-ready', watchSession);
        watchSession();
        const refresh = () => { void host.guitarProfiles.refresh().catch(() => {}); };
        root.addEventListener('feedback:audio-route-changed', refresh);
        // Device reconnection can occur without a renderer event. The service
        // skips unchanged routes and never writes gain on every meter tick.
        root.setInterval(refresh, 1500);
        host.guitarProfiles.ready.catch(() => {});
    }
})(typeof window === 'object' ? window : globalThis, function createGuitarProfiles(deps) {
    'use strict';
    let state = {version: 2, revision: 0, migrated: false, activeId: 'default-guitar', currentType: 'guitar', guitarRole: 'guitar-lead',
        lastSelectedByType: {guitar: 'default-guitar', bass: 'default-bass'}, profiles: [
            {id: 'default-guitar', name: 'Guitar', type: 'guitar', builtin: true, calibrations: {}},
            {id: 'default-bass', name: 'Bass', type: 'bass', builtin: true, calibrations: {}},
        ]};
    let route = {kind: 'unavailable', key: '', label: 'Loading audio input…', generation: 0};
    let epoch = 0, error = '', loaded = false, busy = false, applied = false, appliedKey = '', queue = Promise.resolve();
    let watchedSession = null, unwatch = null;
    const internalRevisions = new Map(), listeners = new Set();
    const clone = value => JSON.parse(JSON.stringify(value));
    const routeIdentity = r => JSON.stringify([r.kind, r.key, r.generation]);
    const session = () => deps.session?.();
    const unlocked = () => session()?.assertUnlocked();
    const active = () => state.profiles.find(p => p.id === state.activeId);
    const activeType = () => active()?.type || state.currentType;
    const level = () => active()?.calibrations?.[route.key];
    const profileGain = p => p?.calibrations?.[route.key]?.gain ?? p?.legacyGain ?? 1;
    const gain = () => profileGain(active());
    const revision = () => `${state.revision}:${epoch}`;
    function validType(type) {
        if (type !== 'guitar' && type !== 'bass') throw new Error('Choose Guitar or Bass.');
        return type;
    }
    function validGain(value) {
        if (!Number.isFinite(value) || value < 0.1 || value > 5) throw new Error('Input gain must be between 0.1 and 5 times.');
        return value;
    }
    function snapshot() {
        return {activeId: state.activeId, activeName: active()?.name || 'Guitar', activeType: activeType(), builtin: active()?.builtin === true,
            gain: gain(), calibrated: level()?.calibrated === true, migrated: state.migrated,
            profiles: state.profiles.map(p => ({id: p.id, name: p.name, type: p.type, builtin: p.builtin})),
            revision: revision(), routeKey: route.key, routeLabel: route.label, route: clone(route),
            locked: session()?.isLocked() === true, loaded, busy, applied, error};
    }
    function emit() {
        const value = snapshot();
        for (const listener of listeners) {
            try { listener(value); } catch (_) { /* One UI must not block the others. */ }
        }
    }
    function watchSession() {
        const next = session();
        if (next === watchedSession) return;
        unwatch?.(); watchedSession = next; unwatch = next?.subscribe(emit); emit();
    }
    async function readRoute() {
        const next = await deps.readRoute();
        if (routeIdentity(next) !== routeIdentity(route)) {
            route = next; ++epoch; applied = false; appliedKey = '';
        } else route = next;
    }
    async function post(body) {
        try { state = await deps.request({...body, expectedRevision: state.revision}); }
        catch (e) {
            // Refetch uncertain writes, so recovery uses the durable selection.
            try { state = await deps.request(); }
            catch (_) { loaded = false; /* Do not start songs until durable state can be reread. */ }
            appliedKey = ''; applied = false;
            throw e;
        }
    }
    async function apply() {
        if (!route.key) { applied = false; return; }
        const key = JSON.stringify([state.activeId, gain(), routeIdentity(route)]);
        if (appliedKey === key) { applied = true; return; }
        const identity = routeIdentity(route);
        await deps.applyGain(gain(), clone(route));
        await readRoute();
        if (identity !== routeIdentity(route)) throw new Error('The audio input changed while applying gain. Check the selected input.');
        appliedKey = key; applied = true;
    }
    async function refreshInternal() {
        await readRoute();
        if (route.key && active()?.legacyGain != null) {
            const before = state.revision;
            await post({action: 'bind-legacy', profileId: state.activeId, routeKey: route.key});
            // Binding an existing legacy value is not an edit of the draft's selection.
            internalRevisions.set(before, state.revision);
        }
        await apply();
    }
    function enqueue(work, quiet = false, mutation = false) {
        let release;
        if (mutation) {
            try { unlocked(); release = session()?.acquireMutation(); }
            catch (e) { return Promise.reject(e); }
        }
        const run = queue.catch(() => {}).then(async () => {
            if (!quiet) { busy = true; emit(); }
            try {
                if (mutation) unlocked();
                const result = await work();
                error = '';
                return result;
            } catch (e) {
                error = e?.message || 'Instrument settings are unavailable.';
                throw e;
            } finally {
                release?.(); busy = false; emit();
            }
        });
        queue = run;
        return run;
    }
    async function syncType(type, guitarRole) {
        unlocked();
        const game = await deps.readGameContext?.();
        unlocked();
        const role = type === 'bass' ? 'bass' : guitarRole;
        if (game && game.active_instrument_profile !== role) await deps.applyGameType(type, guitarRole);
    }
    async function ensureLoaded() {
        if (loaded) return;
        state = await deps.request();
        await readRoute();
        if (!state.migrated) await post({action: 'migrate', gain: await deps.readLegacyGain(), routeKey: route.key || undefined});
        // The persisted physical choice owns the family after a restart.
        const game = await deps.readGameContext?.();
        if (activeType() === 'guitar' && game?.active_instrument_profile?.startsWith('guitar-')) state.guitarRole = game.active_instrument_profile;
        await syncType(activeType(), state.guitarRole);
        await refreshInternal();
        await deps.selectionChanged?.();
        loaded = true;
    }
    const ready = enqueue(async () => { await ensureLoaded(); await refreshInternal(); });
    ready.catch(() => {});
    function verify(context) {
        unlocked();
        if (!context || context.profileId !== state.activeId || context.routeKey !== route.key || context.revision !== revision()) {
            throw new Error('The instrument or input changed. Check its level again before saving.');
        }
        if (!route.key) throw new Error('Start and select your audio input before calibrating.');
    }
    function draftContext(type) {
        return {type: validType(type), profileId: state.activeId, stateRevision: state.revision, revision: revision(),
            routeKey: route.key, routeIdentity: routeIdentity(route), activeName: active().name, routeLabel: route.label};
    }
    function verifyDraftContext(context, {bindRoute = false, requireRoute = false} = {}) {
        unlocked();
        let expected = context?.stateRevision;
        while (internalRevisions.has(expected)) expected = internalRevisions.get(expected);
        if (!context || context.profileId !== state.activeId || expected !== state.revision ||
            (!bindRoute && context.routeIdentity !== routeIdentity(route))) {
            throw new Error('The instrument or input changed. Check its level again before saving.');
        }
        if (requireRoute && !route.key) throw new Error('Start and select your audio input before calibrating.');
        return draftContext(context.type);
    }
    async function recover(guitarRole = state.guitarRole) {
        // A failed/uncertain write may already have committed. Reconcile to the
        // reread durable selection, rather than blindly restoring stale state.
        appliedKey = ''; applied = false;
        if (!loaded) { await ensureLoaded(); guitarRole = state.guitarRole; }
        await syncType(activeType(), guitarRole);
        await apply();
        await deps.selectionChanged?.();
    }
    async function activate(action, fields, target, validate = () => {}) {
        unlocked(); validate();
        const originalRoute = routeIdentity(route);
        const originalRevision = state.revision;
        const game = await deps.readGameContext?.();
        const guitarRole = game?.active_instrument_profile?.startsWith('guitar-') ? game.active_instrument_profile : state.guitarRole;
        try {
            if (route.key && (!applied || profileGain(target) !== gain())) await deps.applyGain(profileGain(target), clone(route));
            await readRoute(); unlocked(); validate();
            if (originalRoute !== routeIdentity(route)) throw new Error('The audio input changed while selecting an instrument. Try again.');
            await syncType(target.type || state.currentType, guitarRole);
            unlocked(); validate();
            await post({action, ...fields, guitarRole});
            await apply();
            await deps.selectionChanged?.();
            return snapshot();
        } catch (e) {
            try { await recover(state.revision === originalRevision ? guitarRole : state.guitarRole); }
            catch (recovery) {
                loaded = false;
                throw new Error(`${e.message} Could not restore the selected instrument: ${recovery.message}`);
            }
            throw e;
        }
    }
    function command(action, fields = {}) {
        return enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); unlocked();
            if (fields.selectType) fields = {profileId: state.lastSelectedByType[fields.selectType] || 'default-' + fields.selectType};
            const p = state.profiles.find(p => p.id === (fields.profileId || state.activeId));
            if (!p) throw new Error('That instrument is no longer available.');
            let target = active();
            if (action === 'select' || action === 'duplicate') { validType(p.type); target = p; }
            if (action === 'create') target = {type: fields.type, calibrations: {}};
            if (action === 'classify') {
                validType(fields.type);
                target = {...p, type: fields.type};
            }
            if (action === 'delete' && p.id === state.activeId) target = state.profiles.find(x => x.id === 'default-' + (p.type || activeType()));
            return activate(action, fields, target);
        }, false, true);
    }
    return {
        ready, watchSession,
        getSnapshot: snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh: () => enqueue(async () => { await ensureLoaded(); await refreshInternal(); return snapshot(); }, true),
        captureContext: () => enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); unlocked();
            if (!route.key) throw new Error('Start and select your audio input before calibrating.');
            return {profileId: state.activeId, routeKey: route.key, revision: revision(), activeName: active().name, routeLabel: route.label};
        }, true),
        captureDraftContext: type => enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); unlocked(); return draftContext(type);
        }, true),
        verifyDraftContext,
        createInstrument: (draft, context) => enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); unlocked();
            validType(draft.type);
            const measured = draft.calibration;
            const captured = measured?.context || context;
            const validate = () => {
                if (captured) {
                    const checked = verifyDraftContext(captured, {bindRoute: !measured, requireRoute: !!measured});
                    if (checked.type !== draft.type) throw new Error('The instrument type changed. Check its level again.');
                } else if (measured) throw new Error('Check the instrument level again before saving.');
            };
            validate();
            const calibration = measured ? {gain: validGain(measured.gain), metadata: measured.metadata, routeKey: captured.routeKey} : undefined;
            const target = {type: draft.type, calibrations: calibration ? {[calibration.routeKey]: calibration} : {}};
            return activate('create', {name: draft.name, type: draft.type, calibration}, target, validate);
        }, false, true),
        saveGain: (value, context, metadata = {}) => enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); verify(context); validGain(value);
            // Apply first, then persist only if the exact input and selection remain.
            try {
                await deps.applyGain(value, clone(route));
                await readRoute(); verify(context);
                await post({action: 'save-gain', profileId: context.profileId, routeKey: context.routeKey, gain: value, metadata});
                appliedKey = ''; await apply();
                return snapshot();
            } catch (e) {
                appliedKey = '';
                try { await apply(); } catch (_) { loaded = false; }
                throw e;
            }
        }, false, true),
        select: id => command('select', {profileId: id}),
        selectType: type => {
            try { validType(type); } catch (e) { return Promise.reject(e); }
            return command('select', {selectType: type});
        },
        create: name => command('create', {name, type: activeType()}),
        classify: (id, type) => command('classify', {profileId: id, type}),
        duplicate: (id, name) => command('duplicate', {profileId: id, name}),
        rename: (id, name) => command('rename', {profileId: id, name}),
        remove: id => command('delete', {profileId: id}),
    };
});
