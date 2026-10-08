// A plugin may own the controls while borrowing the one native backing player.
// All native mutations share the core transport's command queue. Revocation is
// synchronous; its physical stop stays queued ahead of the next owner's load.
export function createNativeBackingOwner({ api, player, queue, getSong, isCoreNative, fetchPath, getAnalyser, isPresentationComplete = () => true, isSuspended = () => false }) {
    let active = null, generation = 0, checking = false, unsafeNative = false;
    const required = ['isAudioRunning', 'loadBackingTrack', 'stopBacking', 'startBacking',
        'seekBacking', 'getBackingDuration', 'setGain', 'setBackingSpeed'];
    const matches = s => s.sources
        ? JSON.stringify(getSong()?.stemUrls) === JSON.stringify(s.sources.map(source => source.url))
            && (!s.fullMix || getSong()?.fullMixUrl === s.fullMix.url)
        : getSong()?.singleStemUrl === s.url;
    const live = s => active === s && matches(s) && !isCoreNative() && s.isCurrent();
    const validGain = value => Number.isFinite(value) && value >= 0 && value <= 2;
    const gainsFor = (sources, full) => {
        const unity = full && sources.every(source => source.gain === 1);
        return [...sources.map(source => unity ? 0 : source.gain), ...(full ? [unity ? 1 : 0] : [])];
    };

    function release(s, reason = 'released') {
        if (active !== s) return Promise.resolve(true);
        const position = player.currentTime;
        s.lastPosition = position;
        active = null;
        player._stopPolling();
        return queue(async () => {
            let stopped = false;
            try { if (await api.stopBacking() === false) throw new Error('Native stop rejected'); stopped = true; }
            catch (_) { try { stopped = !await api.isAudioRunning(); } catch (_) {} }
            unsafeNative = !stopped;
            return stopped;
        }).then(async stopped => {
            // Notify outside the native command queue: a provider may need to
            // issue new playback commands while handling the notification.
            if (reason === 'engine-stopped' || reason === 'failed' || reason === 'browser-required') {
                try { await s.onLost?.({ position, stopped, reason }); } catch (_) {}
            }
            return stopped;
        });
    }

    function command(s, fn) {
        return queue(async () => {
            if (!live(s)) return false;
            return await fn() !== false && live(s);
        });
    }

    return {
        version: 1,
        sessionVersion: 2,
        isBrowserFallbackSafe: () => !unsafeNative,
        getAnalyser: () => getAnalyser?.() ?? null,
        snapshot: () => active ? { ownerId: active.ownerId, generation: active.generation,
            state: active.ready ? 'ready' : 'preparing', route: 'native-backing' } : null,
        releaseCurrent(reason = 'song-change') { return active ? release(active, reason) : Promise.resolve(true); },
        async acquire({ ownerId, url, sources, fullMix, isCurrent, onLost, onEnded }) {
            // Copy descriptors at this boundary: a caller cannot mutate an
            // in-flight load into a different song or change its source count.
            if (sources !== undefined) {
                if (!Array.isArray(sources) || sources.length < 1 || sources.length > 32
                    || sources.some(source => !source || typeof source.id !== 'string' || !source.id
                        || typeof source.url !== 'string' || !source.url || !validGain(source.gain))
                    || new Set(sources.map(source => source.id)).size !== sources.length
                    || (fullMix && (typeof fullMix.url !== 'string' || !fullMix.url || sources.length === 32))) return null;
                sources = sources.map(({ id, url, gain }) => ({ id, url, gain }));
                fullMix = fullMix ? { url: fullMix.url } : null;
                if (typeof api?.loadBackingSession !== 'function' || typeof api?.setBackingSourceGains !== 'function') return null;
            }
            if (active || isCoreNative() || typeof url !== 'string' || !url || typeof ownerId !== 'string'
                || !matches({ url, sources, fullMix }) || typeof isCurrent !== 'function'
                || !isCurrent() || !/^[a-z0-9._:-]{1,80}$/i.test(ownerId)
                || required.some(key => typeof api?.[key] !== 'function')) return null;
            const s = active = { ownerId, url, sources, fullMix, isCurrent, onLost, onEnded, ready: false,
                generation: ++generation, ended: false };
            try {
                const prepared = await queue(async () => {
                    if (!live(s) || !await api.isAudioRunning() || !live(s)) return false;
                    if (sources && (await api.backingSessionCapabilities?.())?.version !== 2) return false;
                    const paths = sources ? await Promise.all(sources.map(source => fetchPath(source.url))) : [await fetchPath(url)];
                    let fullPath = null;
                    if (fullMix) { try { fullPath = await fetchPath(fullMix.url); } catch (_) {} }
                    if (!live(s)) return false;
                    player._stopPolling();
                    unsafeNative = true;
                    if (await api.stopBacking() === false) throw new Error('Native stop rejected');
                    unsafeNative = false;
                    if (!live(s)) return false;
                    await api.setGain('backing', 0);
                    if (!live(s)) return false;
                    if (sources) {
                        let loaded = false;
                        if (fullPath) loaded = await api.loadBackingSession([...paths, fullPath], gainsFor(sources, true), true);
                        if (!live(s)) return false;
                        s.fullMixAccepted = !!loaded;
                        // An optional missing/invalid/unaligned full mix must not
                        // prevent the separated stems using the native route.
                        if (!loaded) loaded = await api.loadBackingSession(paths, gainsFor(sources, false), false);
                        if (!loaded || !live(s)) return false;
                    } else if (await api.loadBackingTrack(paths[0]) === false || !live(s)) return false;
                    const duration = await api.getBackingDuration();
                    if (!live(s) || !Number.isFinite(duration) || duration <= 0) return false;
                    player._dur = duration; player._pos = 0; player._speed = 1; player._sourceEnded = false;
                    s.ready = true;
                    return true;
                });
                if (!prepared || !live(s)) { await release(s); return null; }
            } catch (_) { await release(s); return null; }
            return Object.freeze({
                sessionVersion: sources ? 2 : 1,
                fullMixAccepted: !!s.fullMixAccepted,
                get currentTime() { return live(s) ? player.currentTime : (s.lastPosition ?? 0); },
                get duration() { return live(s) ? player.duration : 0; },
                isCurrent: () => live(s),
                play(options = {}) {
                    if (!live(s)) return Promise.resolve(false);
                    s.ended = false;
                    return player.play({ guard: () => live(s) && (!options.guard || options.guard()) });
                },
                pause() { return live(s) ? player.pause() : Promise.resolve(false); },
                seek(value) {
                    if (!Number.isFinite(value)) return Promise.resolve(false);
                    s.ended = false;
                    return command(s, () => player.seek(value));
                },
                setRate(rate) {
                    if (!Number.isFinite(rate) || rate <= 0) return Promise.resolve(false);
                    return command(s, async () => {
                        if (await api.setBackingSpeed(rate) === false) throw new Error('Native speed unavailable');
                        if (!live(s)) return;
                        // Desktop's native stretcher preserves pitch inherently.
                        // Some hosts additionally expose a switch; it is optional,
                        // as it is for Core's ordinary native backing transport.
                        await api.setBackingPreservePitch?.(true);
                        if (live(s)) player.setRate(rate);
                    });
                },
                setGain(gain) {
                    if (!Number.isFinite(gain)) return Promise.resolve(false);
                    return command(s, () => api.setGain('backing', Math.max(0, Math.min(2, gain))));
                },
                setSourceGains(gains) {
                    if (!sources || !Array.isArray(gains) || gains.length !== sources.length
                        || !gains.every(validGain)) return Promise.resolve(false);
                    const values = gainsFor(gains.map(gain => ({ gain })), s.fullMixAccepted);
                    return command(s, () => api.setBackingSourceGains(values));
                },
                release: reason => release(s, reason),
            });
        },
        async check() {
            if (isSuspended()) return;
            if (checking || !active?.ready) return;
            const s = active;
            checking = true;
            try {
                if (!live(s)) { await release(s); return; }
                const running = await api.isAudioRunning();
                if (!live(s)) return;
                if (!running) { await release(s, 'engine-stopped'); return; }
                if (player._sourceFailed) { await release(s, 'failed'); return; }
                if (!s.ended && player._sourceEnded && isPresentationComplete()) {
                    s.ended = true;
                    s.onEnded?.();
                }
            } catch (_) {
                if (active === s) await release(s, 'failed');
            } finally { checking = false; }
        },
    };
}
