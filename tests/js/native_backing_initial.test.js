const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../../static');
const policy = fs.readFileSync(path.join(root, 'js/native-backing-route.js'), 'utf8')
    .replace('export function', 'function');
const highway = fs.readFileSync(path.join(root, 'highway.js'), 'utf8');
// Exercise the real song metadata classification and complete async initial
// route, including its decoder fallback, fader restoration and stale guards.
const classification = highway.slice(highway.indexOf('const isAudioUrl ='), highway.indexOf('const alreadyLoaded =', highway.indexOf('const isAudioUrl =')));
const start = highway.indexOf('hwState._juceRoutingPromise = (async () => {');
const initial = highway.slice(start, highway.indexOf('})().finally(', start)) + '})();';

function harness(msg, { running = true, accepts = true } = {}) {
    const calls = { load: 0, volume: 0, browserLoad: 0 };
    const sb = {
        msg, gen: 1, hwState: { _wsGen: 1 }, audioUrl: msg.audio_url,
        console: { log() {}, warn() {} },
        audio: { src: msg.audio_url, load() { calls.browserLoad++; } },
        feedBack: { audio: { applySongVolume: async () => { calls.volume++; } } },
        jucePlayer: {},
        juceApi: {
            isAudioRunning: async () => running,
            loadBackingTrack: async () => { calls.load++; return accepts; },
            getBackingDuration: async () => 180,
            getCurrentDevice: () => { throw Error('Routing must not depend on the output backend'); },
        },
        fetch: async () => ({ ok: true, json: async () => ({ path: '/song.ogg' }) }),
        _reportAudioRoute() {}, _showAudioBufferingOverlay() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    const transportSource = fs.readFileSync(path.join(__dirname, '../../static/js/transport.js'), 'utf8');
    vm.runInContext(transportSource.slice(transportSource.indexOf('let _backingCommandChain'),
        transportSource.indexOf('export const jucePlayer')).replace(/export function/g, 'function'), sb);

    vm.runInContext(policy + '\n' + classification, sb);
    return { sb, calls, run: () => vm.runInContext(initial, sb) };
}
const pack = { audio_url: '/api/sloppak/song/file/stems/full.ogg', has_full_mix: true, has_stems: false };

test('initial full-mix load uses native output and restores song fader', async () => {
    for (const msg of [pack, { audio_url: '/audio/song.ogg' }]) {
        const h = harness(msg); await h.run();
        assert.equal(h.sb._juceMode, true);
        assert.equal(h.sb.audio.src, '', 'no second browser playback');
        assert.equal(h.calls.load, 1); assert.equal(h.calls.volume, 1);
        assert.equal(h.sb.jucePlayer._dur, 180);
    }
});

test('every listed stem retains its plugin transport, including a single full-mix stem', () => {
    for (const msg of [
        { ...pack, has_stems: true, stems: ['full', 'guitar', 'drums'] },
        { ...pack, has_full_mix: false, has_stems: true, stems: ['full'] },
        { ...pack, has_stems: false, stems: ['full'] }, // inconsistent metadata must not bypass the mixer
    ]) {
        const h = harness(msg);
        assert.equal(vm.runInContext('shouldUseNativeBacking(window._currentSongAudio, true)', h.sb), false);
    }
});

test('only a single stem without a separate pristine mix can request an owned native lease', () => {
    const url = '/api/sloppak/song/file/stems/full.ogg';
    for (const has_full_mix of [false, true]) {
        const h = harness({ ...pack, has_full_mix, has_stems: true, stems: [{ id: 'full', url }] });
        assert.equal(h.sb._currentSongAudio.singleStemUrl, has_full_mix ? null : url);
        assert.equal(vm.runInContext('shouldUseNativeBacking(window._currentSongAudio, true)', h.sb), false);
    }
});

test('stopped engine and unsupported decoder retain browser fallback with song gain', async () => {
    for (const options of [{ running: false }, { accepts: false }]) {
        const h = harness(pack, options); await h.run();
        assert.equal(h.sb._juceMode, false); assert.equal(h.sb.audio.src, pack.audio_url);
        assert.equal(h.calls.browserLoad, 1); assert.equal(h.calls.volume, 1);
    }
});

test('song change while checking the engine cannot load or overwrite the next song', async () => {
    const h = harness(pack);
    h.sb.juceApi.isAudioRunning = async () => { h.sb.hwState._wsGen++; return true; };
    await h.run(); assert.equal(h.calls.load, 0); assert.equal(h.calls.browserLoad, 0);
});

test('song change during native decode cannot commit stale routing or song gain', async () => {
    const h = harness(pack);
    h.sb.juceApi.loadBackingTrack = async () => { h.sb.hwState._wsGen++; return true; };
    await h.run(); assert.equal(h.sb._juceMode, undefined); assert.equal(h.calls.volume, 0);
});
