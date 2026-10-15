/* One owner for physical-guitar calibration. Tone plugins own their drive only. */
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
            if (!response.ok || data.error) throw new Error(data.error || 'Guitar settings are unavailable.');
            return data;
        };
        const legacy = () => {
            try { return JSON.parse(root.localStorage.getItem('slopsmith_notedetect') || '{}'); }
            catch (_) { return {}; }
        };
        host.guitarProfiles = factory({
            request,
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
                    throw new Error('Guitar gain could not be applied. This feature needs the updated Desktop audio engine.');
                }
            },
        });
        const refresh = () => { void host.guitarProfiles.refresh().catch(() => {}); };
        root.addEventListener('feedback:audio-route-changed', refresh);
        // Device reconnection can occur without a renderer event. The service
        // skips unchanged routes and never writes gain on every meter tick.
        root.setInterval(refresh, 1500);
        host.guitarProfiles.ready.catch(() => {});
    }
})(typeof window === 'object' ? window : globalThis, function createGuitarProfiles(deps) {
    'use strict';
    let state = {version: 1, revision: 0, migrated: false, activeId: 'default', profiles: [
        {id: 'default', name: 'Default guitar', calibrations: {}},
    ]};
    let route = {kind: 'unavailable', key: '', label: 'Loading audio input…', generation: 0};
    let epoch = 0, error = '', loaded = false, busy = false, applied = false, appliedKey = '', queue = Promise.resolve();
    const listeners = new Set();
    const clone = value => JSON.parse(JSON.stringify(value));
    const routeIdentity = r => JSON.stringify([r.kind, r.key, r.generation]);
    const active = () => state.profiles.find(p => p.id === state.activeId);
    const level = () => active()?.calibrations?.[route.key];
    const gain = () => level()?.gain ?? active()?.legacyGain ?? 1;
    const revision = () => `${state.revision}:${epoch}`;
    function snapshot() {
        return {activeId: state.activeId, activeName: active()?.name || 'Default guitar',
            gain: gain(), calibrated: level()?.calibrated === true, migrated: state.migrated,
            profiles: state.profiles.map(p => ({id: p.id, name: p.name})),
            revision: revision(), routeKey: route.key, routeLabel: route.label, route: clone(route),
            loaded, busy, applied, error};
    }
    function emit() {
        const value = snapshot();
        for (const listener of listeners) {
            try { listener(value); } catch (_) { /* One UI must not block the others. */ }
        }
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
            // A conflicting writer or an uncertain network outcome must not
            // leave this tab issuing the same stale revision forever.
            try { state = await deps.request(); } catch (_) { /* Keep last known state. */ }
            appliedKey = ''; applied = false;
            throw e;
        }
    }
    async function apply() {
        if (!route.key) { applied = false; return; }
        const key = JSON.stringify([state.activeId, gain(), routeIdentity(route)]);
        if (appliedKey === key) { applied = true; return; }
        const identity = routeIdentity(route);
        const target = gain();
        await deps.applyGain(target, clone(route));
        await readRoute();
        if (identity !== routeIdentity(route)) throw new Error('The audio input changed while applying gain. Check the selected input.');
        appliedKey = key; applied = true;
    }
    async function refreshInternal() {
        await readRoute();
        if (route.key && active()?.legacyGain != null) {
            await post({action: 'bind-legacy', profileId: state.activeId, routeKey: route.key});
        }
        await apply();
    }
    function enqueue(work, quiet = false) {
        const run = queue.catch(() => {}).then(async () => {
            if (!quiet) { busy = true; emit(); }
            try {
                const result = await work();
                error = '';
                return result;
            } catch (e) {
                error = e?.message || 'Guitar settings are unavailable.';
                throw e;
            } finally {
                busy = false; emit();
            }
        });
        queue = run;
        return run;
    }
    const ready = enqueue(async () => {
        state = await deps.request();
        await readRoute();
        if (!state.migrated) {
            const value = await deps.readLegacyGain();
            await post({action: 'migrate', gain: value, routeKey: route.key || undefined});
        }
        loaded = true;
        await refreshInternal();
    });
    // Consumers may attach later; keep startup failures observable without an
    // unhandled rejection. refresh() can retry after the device/server recovers.
    ready.catch(() => {});
    function verify(context) {
        if (!context || context.profileId !== state.activeId || context.routeKey !== route.key || context.revision !== revision()) {
            throw new Error('The guitar or input changed. Check its level again before saving.');
        }
        if (!route.key) throw new Error('Start and select your audio input before calibrating.');
    }
    async function ensureLoaded() {
        if (!loaded) {
            state = await deps.request();
            await readRoute();
            if (!state.migrated) await post({action: 'migrate', gain: await deps.readLegacyGain(), routeKey: route.key || undefined});
            loaded = true;
        }
    }
    function command(action, fields = {}) {
        return enqueue(async () => {
            await ensureLoaded();
            await refreshInternal();
            await post({action, ...fields});
            applied = false;
            await apply();
            return snapshot();
        });
    }
    return {
        ready,
        getSnapshot: snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        refresh: () => enqueue(async () => { await ensureLoaded(); await refreshInternal(); return snapshot(); }, true),
        captureContext: () => enqueue(async () => {
            await ensureLoaded(); await refreshInternal();
            if (!route.key) throw new Error('Start and select your audio input before calibrating.');
            return {profileId: state.activeId, routeKey: route.key, revision: revision(), activeName: active().name, routeLabel: route.label};
        }, true),
        saveGain: (value, context, metadata = {}) => enqueue(async () => {
            await ensureLoaded(); await refreshInternal(); verify(context);
            if (!Number.isFinite(value) || value < 0.1 || value > 5) throw new Error('Input gain must be between 0.1 and 5 times.');
            const oldGain = gain(), originalRoute = clone(route);
            // Verify the engine can apply the result before recording success.
            await deps.applyGain(value, originalRoute);
            try {
                await readRoute(); verify(context);
                await post({action: 'save-gain', profileId: context.profileId, routeKey: context.routeKey, gain: value, metadata});
            } catch (e) {
                if (routeIdentity(originalRoute) === routeIdentity(route)) await deps.applyGain(oldGain, route).catch(() => {});
                appliedKey = ''; applied = false;
                throw e;
            }
            appliedKey = ''; await apply();
            return snapshot();
        }),
        select: id => command('select', {profileId: id}),
        create: name => command('create', {name}),
        duplicate: (id, name) => command('duplicate', {profileId: id, name}),
        rename: (id, name) => command('rename', {profileId: id, name}),
        remove: id => command('delete', {profileId: id}),
    };
});
