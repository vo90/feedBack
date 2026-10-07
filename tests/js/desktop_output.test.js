const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/desktop-output.js'), 'utf8')
    .replace('export function', 'function') + '\ninstallDesktopOutput();';

function harness({ browserOnly = false } = {}) {
    const h = { running: true, enabled: false, time: 0, captures: [], contexts: [], taps: [],
        muted: [], bus: [], pushed: [], ports: new Map(), events: {}, timers: [], intervals: [],
        device: { outputType: 'Windows Audio', output: 'Selected speakers', sampleRate: 48000, outputBlockSize: 480 } };
    const api = {
        rendererAudioPortVersion: 1,
        hasRendererAudioPort: async id => h.ports.has(id),
        closeRendererAudioPort: async id => h.ports.delete(id),
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
    let portNumber = 0;
    const window = {
        location: { origin: 'http://localhost:8000' },
        addEventListener: (name, fn) => { h.events[name] = fn; },
        removeEventListener: (name, fn) => { if (h.events[name] === fn) delete h.events[name]; },
        postMessage(data, origin, ports) {
            assert.equal(data.type, 'feedback-renderer-audio-port');
            h.ports.set(data.id, ports[0]);
            h.events.message({ source: window, origin, data: { type: 'feedback-renderer-audio-port-ready', id: data.id, ok: true } });
        },
    };
    if (!browserOnly) window.feedBackDesktop = { audio: api };
    vm.runInNewContext(source, { window, document, navigator: { mediaDevices: {
        getDisplayMedia: options => h.capture(options), addEventListener: (name, fn) => { h.events[name] = fn; } } },
        AudioContext: Context, AudioWorkletNode: Worklet, Float32Array, crypto: { randomUUID: () => `port-${++portNumber}` }, Blob: class { constructor(parts) { h.workletSource = parts.join(''); } },
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
test('worklet batches stereo PCM directly and clocks silence without UI callbacks', async () => {
    const h = harness(); await h.tick();
    assert.equal(h.ports.size, 1);
    assert.equal([...h.ports.values()][0], h.taps[0].port);
    assert.equal(h.taps[0].port.onmessage, null, 'no renderer forwarding callback');
    let Processor; const packets = [];
    vm.runInNewContext(h.workletSource, {
        sampleRate: 48000, Float32Array,
        AudioWorkletProcessor: class { constructor() { this.port = { postMessage: packet => packets.push(packet) }; } },
        registerProcessor: (_name, processor) => { Processor = processor; },
    });
    const tap = new Processor(), left = new Float32Array(128).fill(.125), right = new Float32Array(128).fill(-.25);
    tap.process([[left, right]], []); tap.process([[left, right]], []);
    assert.equal(packets.length, 1); assert.equal(packets[0].sampleRate, 48000);
    assert.deepEqual([...packets[0].pcm], Array.from({length:512}, (_,i)=>i%2?-.25:.125));
    tap.process([], []); tap.process([], []);
    assert.ok(packets[1].pcm.every(x => x === 0));
    assert.equal(h.pushed.length, 0);
});

test('closed direct audio port recreates capture instead of silently losing sound', async () => {
    const h = harness(); await h.tick(); h.ports.clear(); await h.tick();
    assert.equal(h.captures.length, 2); assert.equal(h.state().state, 'active');
    assert.equal(h.captures[0].track.readyState, 'ended'); assert.equal(h.ports.size, 1);
});

test('missing direct audio port capability fails visibly without output fallback', async () => {
    const h = harness(); h.api.rendererAudioPortVersion = 0; await h.tick();
    assert.equal(h.state().state, 'error'); assert.equal(h.enabled, false);
    assert.match(h.state().error, /streaming update/); assert.deepEqual(h.muted, [true]);
});

test('audio port handshake timeout releases capture and stays muted', async () => {
    const h = harness(); let transferred = false;
    h.window.postMessage = () => { transferred = true; };
    const running = h.tick(); while (!transferred) await Promise.resolve();
    h.timers.at(-1)(); await running;
    assert.equal(h.state().state, 'error'); assert.match(h.state().error, /port timed out/);
    assert.equal(h.contexts[0].state, 'closed'); assert.equal(h.captures[0].track.readyState, 'ended');
    assert.equal(h.enabled, false); assert.deepEqual(h.muted, [true]);
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
    const h = harness(); await h.tick(); h.events.pagehide(); for(let i=0;i<6;i++) await Promise.resolve();
    assert.equal(h.enabled, false); assert.equal(h.captures[0].track.readyState, 'ended');
    assert.equal(h.contexts[0].state, 'closed'); assert.deepEqual(h.muted, [true]);
});
test('native bus reset is repaired', async () => {
    const h = harness(); await h.tick(); h.enabled = false; await h.tick();
    assert.equal(h.enabled, true); assert.equal(h.captures.length, 1);
});
