// One output owner for desktop audio. Native backing tracks already use the
// engine's selected device; capture the page's mix into that SAME output for
// stems, previews, HTML media and plugin-private WebAudio contexts. This is
// frame capture, never system/device loopback (which could recapture JUCE).
// Browser-only installs keep their normal browser audio behavior.
export function installDesktopOutput() {
    const api = window.feedBackDesktop?.audio;
    if (!api || window._reevaluateRendererBus) return;

    const TAP = `class FeedbackOutputTap extends AudioWorkletProcessor {
        constructor() {
            super();
            this.size = Math.ceil(sampleRate / 200 / 128) * 128;
            this.pcm = new Float32Array(this.size * 2);
            this.frames = 0;
        }
        process(inputs, outputs) {
            const channels = inputs[0];
            const l = channels?.[0], r = channels?.[1] || l;
            const count = l?.length || outputs[0]?.[0]?.length || 128;
            for (let i = 0; i < count; ++i) {
                this.pcm[this.frames*2] = l?.[i] || 0;
                this.pcm[this.frames*2+1] = r?.[i] || 0;
                if (++this.frames === this.size) {
                    // Electron MessagePortMain does not decode transferred
                    // ArrayBuffer payloads here (data arrives null). Structured
                    // clone the small PCM packet; only the PORT is transferred.
                    this.port.postMessage({ pcm: this.pcm, sampleRate });
                    this.pcm = new Float32Array(this.size * 2);
                    this.frames = 0;
                }
            }
            return true;
        }
    }; registerProcessor('feedback-output-tap', FeedbackOutputTap);`;
    const moduleUrl = URL.createObjectURL(new Blob([TAP], { type: 'application/javascript' }));
    let capture = null, pending = null, disposed = false, muted = false;
    let outputKey = '', retryAt = 0, retryDelay = 1000, banner = null;

    function status(state, message = '', detail = {}) {
        window._rendererOutputRoute = { state, message, ...detail };
        if (!banner && message && document.body) {
            banner = document.createElement('div');
            banner.id = 'desktop-output-status';
            banner.setAttribute('role', 'status');
            banner.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;padding:12px 16px;background:#29231a;color:#fff;border:1px solid #bf974b;border-radius:6px;font:14px system-ui';
            document.body.appendChild(banner);
        }
        if (banner) { banner.textContent = message; banner.hidden = !message; }
    }

    async function release(session) {
        if (!session) return;
        if (session.tap) {
            session.tap.port.onmessage = null;
            session.tap.port.close();
            session.tap.disconnect();
        }
        session.stream.getTracks().forEach(track => track.stop());
        if (session.portId) await api.closeRendererAudioPort(session.portId).catch(() => {});
        if (session.context && session.context.state !== 'closed') await session.context.close();
    }

    async function connectAudioPort(session) {
        if (api.rendererAudioPortVersion !== 1) throw new Error('Desktop audio streaming update required');
        const id = session.portId = crypto.randomUUID();
        await new Promise((resolve, reject) => {
            let timer;
            const done = error => {
                clearTimeout(timer); window.removeEventListener('message', ready);
                if (error) reject(error); else resolve();
            };
            const ready = event => {
                if (event.source !== window || event.origin !== window.location.origin
                    || event.data?.type !== 'feedback-renderer-audio-port-ready' || event.data.id !== id) return;
                done(event.data.ok === true ? null : new Error('Audio streaming port rejected'));
            };
            window.addEventListener('message', ready);
            timer = setTimeout(() => done(new Error('Audio streaming port timed out')), 5000);
            try {
                window.postMessage({ type: 'feedback-renderer-audio-port', id }, window.location.origin, [session.tap.port]);
            } catch (error) { done(error); }
        });
    }

    async function stop() {
        const previous = capture;
        capture = null;
        outputKey = '';
        const releasing = release(previous);
        try { await api.setRendererBus(false, 0); }
        finally { await releasing; }
        // Keep the page muted even during failure or engine stop. Falling back
        // to the OS default here violates the user's selected output.
    }

    async function openCapture() {
        // A late getDisplayMedia result must not leak tracks after a timeout or
        // page teardown. All other resources belong to this local session until
        // the complete setup succeeds; partial setup always unwinds.
        let expired = false, timer;
        const request = navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                suppressLocalAudioPlayback: true,
                echoCancellation: false, noiseSuppression: false, autoGainControl: false,
                // Let Chromium choose the capture rate. Forcing 48 kHz makes
                // its frame capturer ignore the low-latency request on Windows.
                // The context and native bus already handle rate conversion.
                channelCount: 2, latency: 0,
            },
        }).then(stream => {
            if (expired || disposed) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('Audio capture request expired');
            }
            return stream;
        });
        let stream;
        try {
            stream = await Promise.race([request, new Promise((_, reject) => {
                timer = setTimeout(() => { expired = true; reject(new Error('Audio capture timed out')); }, 10000);
            })]);
        } finally { clearTimeout(timer); }
        const session = { stream, context: null, tap: null };
        try {
            stream.getVideoTracks().forEach(track => track.stop());
            const track = stream.getAudioTracks()[0];
            if (!track || track.readyState === 'ended') throw new Error('No live page audio capture');
            session.track = track;
            // Capture must not open another hardware output or feed its own
            // audio back into the page. A null sink keeps the worklet clock live.
            const ctx = session.context = new AudioContext({ sinkId: { type: 'none' }, latencyHint: 'interactive' });
            if (ctx.sinkId?.type !== 'none') throw new Error('Silent audio capture sink unavailable');
            await ctx.audioWorklet.addModule(moduleUrl);
            session.tap = new AudioWorkletNode(ctx, 'feedback-output-tap', { numberOfInputs: 1, channelCount: 2 });
            session.tap.addEventListener('processorerror', () => { session.failed = true; retryAt = 0; void reevaluate(); });
            const source = ctx.createMediaStreamSource(stream);
            source.connect(session.tap);
            // Explicit silent connection makes processing independent of
            // Chromium's treatment of disconnected worklet outputs.
            session.tap.connect(ctx.destination);
            // Transfer once; continuous PCM delivery must not wait for the UI
            // event loop (song loading/rendering can stall it for hundreds of ms).
            await connectAudioPort(session);
            await ctx.resume();
            if (disposed) throw new Error('Audio page closed');
            track.addEventListener('ended', () => { retryAt = 0; void reevaluate(); });
            return session;
        } catch (error) { await release(session); throw error; }
    }

    async function reconcile() {
        if (disposed) return;
        try {
            if (!muted) {
                if (typeof api.setPageMuted !== 'function' || await api.setPageMuted(true) !== true)
                    throw new Error('Desktop audio routing requires page mute support');
                muted = true;
            }
            const running = await api.isAudioRunning();
            if (!running) {
                await stop();
                retryAt = 0;
                status('stopped', 'Audio engine is stopped. Start it in Audio settings to hear game audio.');
                return;
            }
            const device = await api.getCurrentDevice();
            if (!device?.output) throw new Error('The selected audio output is unavailable');
            const key = JSON.stringify([device.outputType || device.type, device.output, device.sampleRate, device.outputBlockSize]);
            if (capture && (capture.failed || !await api.hasRendererAudioPort(capture.portId)))
                throw new Error('Audio stream lost its native connection');
            if (capture && (capture.track.readyState === 'ended' || capture.context.state === 'closed')) await stop();
            if (!capture && Date.now() < retryAt) return;
            if (!capture) capture = await openCapture();
            // Opening capture is asynchronous: an Apply/Stop during that wait
            // must never commit stale routing. Reconcile again on the next tick.
            const current = await api.getCurrentDevice();
            const currentKey = JSON.stringify([current?.outputType || current?.type, current?.output, current?.sampleRate, current?.outputBlockSize]);
            if (disposed || !await api.isAudioRunning() || key !== currentKey) { await stop(); return; }
            if (capture.context.state === 'suspended') await capture.context.resume();
            const metrics = await api.getRendererBusMetrics();
            if (key !== outputKey || !metrics?.enabled) {
                await api.setRendererBus(false, 0); // discard old device's queued tail
                await api.setRendererBus(true, 1);
                const enabled = await api.getRendererBusMetrics();
                if (!enabled?.enabled) throw new Error('Native audio output bridge unavailable');
                outputKey = key;
            }
            retryDelay = 1000; retryAt = 0;
            status('active', '', { output: device.output, outputType: device.outputType || device.type,
                captureSettings: capture.track.getSettings(), sampleRate: capture.context.sampleRate, transport: 'worklet-port' });
        } catch (error) {
            await stop().catch(() => {});
            if (disposed) return;
            retryAt = Date.now() + retryDelay;
            retryDelay = Math.min(retryDelay * 2, 10000);
            console.warn('[desktop-output]', error?.message || String(error));
            status('error', 'Game audio could not reach the selected output. Retrying; check Audio settings.',
                { error: error?.message || String(error) });
        }
    }

    // One transaction at a time, including manual calls from settings/tests.
    // Poll even while hidden: a minimized game still needs working audio.
    function reevaluate() {
        if (!pending) pending = reconcile().finally(() => { pending = null; });
        return pending;
    }
    window._reevaluateRendererBus = reevaluate;
    const interval = setInterval(() => { void reevaluate(); }, 500);
    document.addEventListener('visibilitychange', () => { void reevaluate(); });
    navigator.mediaDevices?.addEventListener('devicechange', () => { retryAt = 0; void reevaluate(); });
    window.addEventListener('pagehide', () => {
        disposed = true;
        clearInterval(interval);
        void stop().catch(() => {});
        URL.revokeObjectURL(moduleUrl);
    }, { once: true });
    void reevaluate();
}
