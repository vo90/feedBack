// Shared desktop tone opt-in. This owns policy, never input/backing transport.
(function () {
    'use strict';
    window.feedBack = window.feedBack || {};
    if (window.feedBack.ampSims?.version === 1) return;

    const handlers = new Set();
    const finalizers = new Set();
    const pending = new Set();
    let intent = 0;
    let queue = Promise.resolve();
    let state = Object.freeze({ ready: false, enabled: false, generation: 0,
        applicable: !!window.feedBackDesktop, error: null });

    function snapshot() { return { ...state }; }

    function failClosed(error) {
        const message = error?.message || String(error || 'Amp simulation policy failed');
        // A failing suspension handler must not recursively notify itself forever.
        if (!state.enabled && state.error) return;
        publish({ ready: true, enabled: false, error: message });
    }

    function invoke(handler, value) {
        let result;
        try { result = handler(value); }
        catch (error) { result = Promise.reject(error); }
        const work = Promise.resolve(result).catch(failClosed);
        pending.add(work);
        work.then(() => pending.delete(work));
    }

    function publish(patch) {
        state = Object.freeze({ ...state, ...patch, generation: state.generation + 1 });
        const value = snapshot();
        // Invalidation happens synchronously in every owner, before awaiting any
        // native operation or teardown. Each subscriber owns its generation checks.
        for (const handler of Array.from(handlers)) invoke(handler, value);
        for (const handler of Array.from(finalizers)) finalize(handler, value);
    }

    function finalize(handler, value) {
        if (!value.applicable || (value.ready && value.enabled)) return;
        // Snapshot the existing barrier BEFORE tracking this finalizer, avoiding
        // a self-wait. A failed owner still settles and the final clear still runs.
        const owners = Promise.all(Array.from(pending));
        invoke(() => owners.then(() => {
            if (finalizers.has(handler) && value.generation === state.generation) return handler(value);
        }), value);
    }

    async function whenSettled() {
        while (pending.size) await Promise.all(Array.from(pending));
        if (state.error) throw new Error(state.error);
        return snapshot();
    }

    function subscribe(handler, options = {}) {
        if (typeof handler !== 'function') throw new TypeError('A policy subscriber must be a function');
        if (options.phase === 'finalize') {
            finalizers.add(handler);
            finalize(handler, snapshot());
            return () => finalizers.delete(handler);
        }
        handlers.add(handler);
        invoke(handler, snapshot());
        return () => handlers.delete(handler);
    }

    function enqueue(operation) {
        const result = queue.then(operation);
        queue = result.catch(() => {});
        return result;
    }

    async function persist(enabled) {
        // One bounded write per user choice, never a polling loop.
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                controller?.abort();
                reject(new Error('Saving the amp simulation preference timed out'));
            }, 10000);
        });
        try {
            const saved = (async () => {
                const response = await window.fetch('/api/settings', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ use_amp_sims: enabled }),
                    ...(controller ? { signal: controller.signal } : {}),
                });
                const data = await response.json();
                if (!response.ok || data?.error) throw new Error(data?.error || 'Could not save the amp simulation preference');
            })();
            await Promise.race([saved, timeout]);
        } finally { clearTimeout(timer); }
    }

    function setEnabled(enabled) {
        if (typeof enabled !== 'boolean') return Promise.reject(new TypeError('Amp simulation preference must be a boolean'));
        const requested = ++intent;
        // Every intent invalidates old async loads. In particular OFF is effective
        // immediately, even if an older ON write or owner restore is still pending.
        publish({ enabled: false, error: null });
        return enqueue(async () => {
            let barrierError = null;
            try { await whenSettled(); } catch (error) { barrierError = error; }
            if (requested !== intent) return snapshot();
            try {
                // Persist OFF even if teardown failed. ON may never pass a failed
                // suspension barrier or run before its successful persisted ack.
                if (enabled && barrierError) throw barrierError;
                await persist(enabled);
                if (requested !== intent) return snapshot();
                if (barrierError) throw barrierError;
                // A ready OFF intent already suspended owners and finalized once.
                // Only unknown -> ready or ON needs another publication after ack.
                if (!state.ready || enabled || state.error) publish({ ready: true, enabled, error: null });
                return await whenSettled();
            } catch (error) {
                if (requested === intent) failClosed(error);
                // Finish any cleanup triggered by the failure before reporting it.
                while (pending.size) await Promise.all(Array.from(pending));
                throw error;
            }
        });
    }

    function applySettings(settings, options = {}) {
        // Capture this token BEFORE a GET, not after it. A late startup read must
        // not restore the value that preceded a user toggle.
        const expected = options.generation ?? state.generation;
        if (expected !== state.generation) return Promise.resolve(snapshot());
        const requested = intent;
        const valid = settings && typeof settings === 'object' && !Array.isArray(settings);
        const error = options.error || (!valid ? 'Could not read the amp simulation preference' : null);
        const enabled = !error && settings.use_amp_sims === true;
        if (!enabled) publish({ ready: !error, enabled: false, error: error?.message || error || null });
        let afterRead = state.generation;
        return enqueue(async () => {
            if (requested !== intent || state.generation !== afterRead) return snapshot();
            if (enabled && state.error) {
                // A successful fresh read may recover a prior read/save failure,
                // but must retry suspension and finish it before restoring owners.
                // Drain old failures before clearing them; fresh failures still win.
                while (pending.size) await Promise.all(Array.from(pending));
                if (requested !== intent || state.generation !== afterRead) return snapshot();
                publish({ ready: true, enabled: false, error: null });
                afterRead = state.generation;
            }
            await whenSettled();
            if (requested !== intent || state.generation !== afterRead) return snapshot();
            if (enabled && (!state.ready || !state.enabled)) publish({ ready: true, enabled: true, error: null });
            return whenSettled();
        });
    }

    window.feedBack.ampSims = Object.freeze({ version: 1, snapshot, subscribe, setEnabled, applySettings, whenSettled });
})();
