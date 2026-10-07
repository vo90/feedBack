const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/desktop-output.js'), 'utf8')
    .replace('export function', 'function') + '\ninstallDesktopOutput();';

function harness({ browserOnly = false } = {}) {
    const h = { running: true, enabled: false, time: 0, captures: [], contexts: [], taps: [],
        muted: [], bus: [], pushed: [], events: {}, timers: [], intervals: [],
        device: { outputType: 'Windows Audio', output: 'Selected speakers', sampleRate: 48000, outputBlockSize: 480 } };
    const api = {
        setPageMuted: async value => { h.muted.push(value); return value; },
        isAudioRunning: async () => h.running,
        getCurrentDevice: async () => ({ ...h.device }),
        setRendererBus: async (enabled, gain) => { h.enabled = enabled; h.bus.push([enabled, gain]); },
        getRendererBusMetrics: async () => ({ enabled: h.enabled }),
        pushRendererAudio: (pcm, rate) => h.pushed.push({ pcm: [...pcm], rate }),
    };
    function stream() {
        const track = { readyState: 'live', stop() { this.readyState = 'ended'; },
            addEventListener(name, fn) { this[name] = fn; }, getSettings: () => ({ channelCount: 2 }) };
        const video = { stopped: false, stop() { this.stopped = true; } };
        return { track, video, getAudioTracks: () => [track], getVideoTracks: () => [video], getTracks: () => [track, video] };
    }
    h.capture = async options => { h.options = options; const s = stream(); h.captures.push(s); return s; };
    class Context {
        constructor(options) {
            this.sinkId = options.sinkId; this.sampleRate = 48000; this.state = 'running'; this.destination = {};
            this.audioWorklet = { addModule: async () => { if (h.moduleError) throw Error('worklet failed'); } };
            h.contexts.push(this);
        }
        createMediaStreamSource(stream) { this.stream = stream; return { connect() {} }; }
        async resume() { this.state = 'running'; }
        async close() { this.state = 'closed'; }
    }
    class Worklet {
        constructor() { this.port = { onmessage: null, close() {} }; h.taps.push(this); }
        connect() {} disconnect() {}
    }
    const document = { body: { appendChild() {} }, hidden: false, addEventListener: (name, fn) => { h.events[name] = fn; },
        createElement: () => ({ style: {}, setAttribute() {} }) };
    const window = { addEventListener: (name, fn) => { h.events[name] = fn; } };
    if (!browserOnly) window.feedBackDesktop = { audio: api };
    vm.runInNewContext(source, { window, document, navigator: { mediaDevices: {
        getDisplayMedia: options => h.capture(options), addEventListener: (name, fn) => { h.events[name] = fn; } } },
        AudioContext: Context, AudioWorkletNode: Worklet, Float32Array, Blob: class {},
        URL: { createObjectURL: () => 'blob:worklet', revokeObjectURL() {} },
        setInterval: fn => { h.intervals.push(fn); return 1; }, clearInterval() {},
        setTimeout: fn => { h.timers.push(fn); return 1; }, clearTimeout() {},
        Date: { now: () => h.time }, console: { warn() {} } });
    Object.assign(h, { window, api, document, stream });
    h.tick = () => window._reevaluateRendererBus(); h.state = () => window._rendererOutputRoute;
    return h;
}

test('browser-only install leaves browser audio alone', () => {
    const h = harness({ browserOnly: true });
    assert.equal(h.window._reevaluateRendererBus, undefined); assert.equal(h.intervals.length, 0);
});
for (const outputType of ['Windows Audio', 'Windows Audio (Exclusive Mode)', 'Windows Audio (Low Latency)', 'DirectSound', 'ASIO', 'CoreAudio']) {
    test(`${outputType}: whole page uses selected native output without needing a song`, async () => {
        const h = harness(); h.device.outputType = outputType; await h.tick();
        assert.equal(h.state().state, 'active'); assert.equal(h.state().outputType, outputType);
        assert.equal(h.state().output, 'Selected speakers'); assert.deepEqual(h.muted, [true]);
        assert.equal(h.captures.length, 1); assert.equal(h.captures[0].video.stopped, true);
        assert.equal(h.contexts[0].sinkId.type, 'none'); assert.equal(h.enabled, true);
        assert.equal(h.options.audio.latency, 0);
        for (const flag of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) assert.equal(h.options.audio[flag], false);
    });
}
test('stereo PCM reaches bus once with capture sample rate', async () => {
    const h = harness(); await h.tick();
    const pcm = Float32Array.from({ length: 256 }, (_, i) => i % 2 ? -0.25 : 0.125);
    h.taps[0].port.onmessage({ data: pcm }); h.taps[0].port.onmessage({ data: pcm });
    assert.equal(h.pushed.length, 1); assert.equal(h.pushed[0].rate, 48000);
    assert.deepEqual(h.pushed[0].pcm, [...pcm, ...pcm]);
});
test('ASIO/shared/named device/rate changes reuse capture and flush old output tail', async () => {
    const h = harness(); await h.tick();
    for (const [outputType, output, sampleRate] of [['ASIO','Interface',48000],['Windows Audio','TV',44100],['Windows Audio','Other',48000]]) {
        h.device = { ...h.device, outputType, output, sampleRate }; await h.tick();
        assert.equal(h.state().output, output); assert.deepEqual(h.bus.slice(-2), [[false, 0], [true, 1]]);
    }
    assert.equal(h.captures.length, 1); assert.deepEqual(h.muted, [true]);
});
test('native transport and recreated plugin contexts need no extra capture', async () => {
    const h = harness(); await h.tick(); h.window._juceMode = true;
    h.window.feedBack = { stems: { audioGraph: {} } }; await h.tick();
    h.window.feedBack.stems.audioGraph = {}; await h.tick();
    assert.equal(h.captures.length, 1); assert.equal(h.bus.filter(([enabled]) => enabled).length, 1);
});
test('stop closes resources and stays muted; restart establishes fresh capture', async () => {
    const h = harness(); await h.tick(); h.running = false; await h.tick();
    assert.equal(h.state().state, 'stopped'); assert.equal(h.enabled, false);
    assert.equal(h.contexts[0].state, 'closed'); assert.equal(h.captures[0].track.readyState, 'ended');
    assert.deepEqual(h.muted, [true]); h.running = true; await h.tick();
    assert.equal(h.state().state, 'active'); assert.equal(h.captures.length, 2);
});
test('denied capture reports error and retries with backoff without OS default fallback', async () => {
    const h = harness(); h.capture = async () => { throw Error('denied'); }; await h.tick();
    assert.equal(h.state().state, 'error'); assert.match(h.state().error, /denied/);
    h.capture = async () => { const s = h.stream(); h.captures.push(s); return s; };
    await h.tick(); assert.equal(h.captures.length, 0); h.time = 1001; await h.tick();
    assert.equal(h.state().state, 'active'); assert.deepEqual(h.muted, [true]);
});
test('partial setup failure closes context and tracks, then recovers', async () => {
    const h = harness(); h.moduleError = true; await h.tick();
    assert.equal(h.state().state, 'error'); assert.equal(h.contexts[0].state, 'closed');
    assert.equal(h.captures[0].track.readyState, 'ended'); assert.equal(h.enabled, false);
    h.moduleError = false; h.time = 1001; await h.tick(); assert.equal(h.state().state, 'active');
});
test('ended capture is recreated while hidden', async () => {
    const h = harness(); await h.tick(); h.document.hidden = true;
    h.captures[0].track.readyState = 'ended'; h.captures[0].track.ended(); await h.tick();
    assert.equal(h.captures.length, 2); assert.equal(h.state().state, 'active');
});
test('reconciliation serializes; stop during capture cancels stale enable', async () => {
    const h = harness(); let resolve; h.capture = () => new Promise(r => { resolve = r; });
    const first = h.tick(); assert.equal(first, h.tick()); while (!resolve) await Promise.resolve();
    h.running = false; resolve(h.stream()); await first;
    assert.equal(h.enabled, false); assert.equal(h.contexts[0].state, 'closed');
    await h.tick(); assert.equal(h.state().state, 'stopped');
});
test('device changes during capture cannot commit stale output', async () => {
    const h = harness(); let resolve; h.capture = () => new Promise(r => { resolve = r; });
    const first = h.tick(); while (!resolve) await Promise.resolve();
    h.device.output = 'New device'; resolve(h.stream()); await first;
    assert.equal(h.enabled, false); assert.equal(h.contexts[0].state, 'closed');
});
test('timed out capture cleans up a late successful stream', async () => {
    const h = harness(); let resolve; h.capture = () => new Promise(r => { resolve = r; });
    const first = h.tick(); while (!resolve) await Promise.resolve();
    h.timers.at(-1)(); await first; assert.equal(h.state().state, 'error');
    const stream = h.stream(); resolve(stream); await Promise.resolve(); await Promise.resolve();
    assert.equal(stream.track.readyState, 'ended'); assert.equal(stream.video.stopped, true);
});
test('page teardown releases capture and bus without unmuting', async () => {
    const h = harness(); await h.tick(); h.events.pagehide(); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.enabled, false); assert.equal(h.captures[0].track.readyState, 'ended');
    assert.equal(h.contexts[0].state, 'closed'); assert.deepEqual(h.muted, [true]);
});
test('native bus reset is repaired', async () => {
    const h = harness(); await h.tick(); h.enabled = false; await h.tick();
    assert.equal(h.enabled, true); assert.equal(h.captures.length, 1);
});
