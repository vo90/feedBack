// A plugin may own the controls while borrowing the one native backing player.
// All native mutations share the core transport's command queue. Revocation is
// synchronous; its physical stop stays queued ahead of the next owner's load.
export function createNativeBackingOwner({ api, player, queue, getSong, isCoreNative, fetchPath }) {
    let active = null, generation = 0, checking = false;
    const required = ['isAudioRunning', 'loadBackingTrack', 'stopBacking', 'startBacking',
        'seekBacking', 'getBackingDuration', 'setGain', 'setBackingSpeed'];
    const live = s => active === s && getSong()?.singleStemUrl === s.url && !isCoreNative() && s.isCurrent();

    function release(s, reason = 'released') {
        if (active !== s) return Promise.resolve(true);
        const position = player.currentTime;
        s.lastPosition = position;
        active = null;
        player._stopPolling();
        return queue(async () => {
            let stopped = false;
            try { await api.stopBacking(); stopped = true; }
            catch (_) { try { stopped = !await api.isAudioRunning(); } catch (_) {} }
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
            await fn();
            return live(s);
        });
    }

    return {
        version: 1,
        snapshot: () => active ? { ownerId: active.ownerId, generation: active.generation,
            state: active.ready ? 'ready' : 'preparing', route: 'native-backing' } : null,
        releaseCurrent(reason = 'song-change') { return active ? release(active, reason) : Promise.resolve(true); },
        async acquire({ ownerId, url, isCurrent, onLost, onEnded }) {
            const song = getSong();
            if (active || isCoreNative() || typeof url !== 'string' || !url || typeof ownerId !== 'string'
                || song?.singleStemUrl !== url || typeof isCurrent !== 'function'
                || !isCurrent() || !/^[a-z0-9._:-]{1,80}$/i.test(ownerId)
                || required.some(key => typeof api?.[key] !== 'function')) return null;
            const s = active = { ownerId, url, isCurrent, onLost, onEnded, ready: false,
                generation: ++generation, ended: false };
            try {
                const prepared = await queue(async () => {
                    if (!live(s) || !await api.isAudioRunning() || !live(s)) return false;
                    const path = await fetchPath(url);
                    if (!live(s)) return false;
                    player._stopPolling();
                    await api.stopBacking();
                    if (!live(s)) return false;
                    await api.setGain('backing', 0);
                    if (!live(s)) return false;
                    if (await api.loadBackingTrack(path) === false || !live(s)) return false;
                    const duration = await api.getBackingDuration();
                    if (!live(s) || !Number.isFinite(duration) || duration <= 0) return false;
                    player._dur = duration; player._pos = 0; player._speed = 1; player._sourceEnded = false;
                    s.ready = true;
                    return true;
                });
                if (!prepared || !live(s)) { await release(s); return null; }
            } catch (_) { await release(s); return null; }
            return Object.freeze({
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
                release: reason => release(s, reason),
            });
        },
        async check() {
            if (checking || !active?.ready) return;
            const s = active;
            checking = true;
            try {
                if (!live(s)) { await release(s); return; }
                const running = await api.isAudioRunning();
                if (!live(s)) return;
                if (!running) { await release(s, 'engine-stopped'); return; }
                if (!s.ended && player._sourceEnded) {
                    s.ended = true;
                    s.onEnded?.();
                }
            } catch (_) {
                if (active === s) await release(s, 'failed');
            } finally { checking = false; }
        },
    };
}
