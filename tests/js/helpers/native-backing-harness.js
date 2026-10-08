const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function deferred() {
    let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
function nativeHarness() {
    const calls = [], url = '/api/sloppak/song/file/stems/full.ogg';
    let song = { singleStemUrl: url }, running = true, current = true, coreNative = false;
    const api = {
        isAudioRunning: async () => running,
        loadBackingTrack: async p => { calls.push(['load', p]); return true; },
        stopBacking: async () => { calls.push(['stop']); },
        startBacking: async () => { calls.push(['play']); },
        getBackingDuration: async () => 100,
        seekBacking: async p => { calls.push(['seek', p]); },
        setGain: async (bus, gain) => { calls.push(['gain', gain]); },
        setBackingSpeed: async rate => { calls.push(['rate', rate]); },
        setBackingPreservePitch: async value => { calls.push(['pitch', value]); },
    };
    const ctx = vm.createContext({ console, performance: { now: () => 0 },
        window: { feedBackDesktop: { audio: api } }, audioSeekGen: () => 0,
        selectionLifecycle: () => ({ reconcileBeforePlayback() {} }),
        setTimeout: () => 1, clearTimeout() {}, _emitSongPositionChanged() {} });
    const root = path.join(__dirname, '../../../static/js');
    const source = fs.readFileSync(path.join(root, 'transport.js'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('let _backingCommandChain'), source.indexOf('export function _audioTime'))
        .replace(/export /g, ''), ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'native-backing-owner.js'), 'utf8').replace('export function', 'function'), ctx);
    const { player, queue, create, loadCore } = vm.runInContext('({ player: jucePlayer, queue: _queueBackingCommand, create: createNativeBackingOwner, loadCore: loadCoreBackingTrack })', ctx);
    const host = create({ api, player, queue, getSong: () => song, isCoreNative: () => coreNative,
        fetchPath: async value => { assertUrl(value); return '/local/full.ogg'; } });
    ctx.window.feedBack = { audioSession: { nativeBacking: host } };
    function assertUrl(value) { if (value !== url) throw Error('unexpected source'); }
    return { api, player, queue, host, calls, url, loadCore: (path, guard = () => true) => loadCore(api, path, guard),
        acquire: (options = {}) => host.acquire({ ownerId: 'stems', url, isCurrent: () => current, ...options }),
        setSong: value => { song = value; }, setRunning: value => { running = value; },
        setCurrent: value => { current = value; }, setCoreNative: value => { coreNative = value; },
    };
}
module.exports = { nativeHarness, deferred };
