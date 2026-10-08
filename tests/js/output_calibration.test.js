const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/settings.js'), 'utf8');
function harness() {
    let profile = null, value = 0;
    const label = {textContent: ''};
    const toggle = {}, route = {}, status = {}, slider = {};
    const elements = {'av-calibration-profile':label, 'ae-av-remember':toggle, 'ae-av-route':route, 'ae-av-status':status, 'ae-av-offset':slider};
    const context = vm.createContext({console, CustomEvent: class {},
        _avOffsetMs: 0,
        document: {getElementById: id => elements[id] || null},
        window: {addEventListener() {}, dispatchEvent() {}, feedBackDesktop: {audio: {getCalibration: async () => profile}}},
        setAvOffsetMs: n => { value = n; context._avOffsetMs = n; }});
    const start = source.indexOf('let _legacyAvOffsetMs'), end = source.indexOf('export let _avSaveDebounce', start);
    vm.runInContext(source.slice(start, end).replace(/export /g, ''), context);
    vm.runInContext('_legacyAvOffsetMs = -100;', context);
    return {context, label, toggle, route, status, slider, profile: (output, perOutputSetup = true) => { profile = output ? {output, perOutputSetup} : null; },
        refresh: () => context.refreshOutputCalibration(), sync: () => context.syncOutputCalibration(), value: () => value};
}
test('actual output profiles restore independently and browser fallback keeps its legacy value', async () => {
    const h = harness();
    const asio = {key: 'asio', offsetMs: -5, label: 'ASIO interface', checked: true};
    const tv = {key: 'tv', offsetMs: -110, label: 'TV', checked: true};
    h.profile(asio); await h.refresh(); assert.equal(h.value(), -5);
    h.profile(tv); await h.refresh(); assert.equal(h.value(), -110);
    h.profile(null); await h.refresh(); assert.equal(h.value(), -110, 'failed Apply cannot select an unopened endpoint');
    h.profile(asio); await h.refresh(); assert.equal(h.value(), -5);
    h.context.window._currentSongAudio = {};
    h.sync(); assert.equal(h.value(), -100);
    assert.match(h.label.textContent, /Browser/);
    h.context.window._juceMode = true;
    h.sync(); assert.equal(h.value(), -5);
    assert.match(h.label.textContent, /ASIO interface/);
});

test('shared mode updates the actual output label, preserves device profiles, and restores the selected profile', async () => {
    const h = harness();
    const tv = {key:'tv', label:'Windows Audio / TV', offsetMs:-100, checked:true};
    const asio = {key:'asio', label:'ASIO / Interface', offsetMs:-5, checked:true};
    h.profile(tv); await h.refresh();
    h.context.window.feedBackDesktop.audio.setCalibrationMode = async (enabled, current) => {
        assert.equal(current, -100);
        return {perOutputSetup:enabled, output:enabled ? asio : {...tv, key:'shared'}};
    };
    await h.context.setRememberOutputCalibration(false);
    assert.equal(h.value(), -100); assert.equal(h.toggle.checked, false);
    assert.match(h.status.textContent, /Shared AV/);
    h.profile({...asio, key:'shared', offsetMs:-100}, false); await h.refresh();
    assert.equal(h.value(), -100); assert.match(h.route.textContent, /ASIO/);
    await h.context.setRememberOutputCalibration(true);
    assert.equal(h.value(), -5); assert.equal(h.toggle.checked, true);
    assert.match(h.status.textContent, /Saved/);
});

test('failed preference save restores the checkbox and reports failure without changing timing', async () => {
    const h = harness(); h.profile({key:'tv', label:'TV', offsetMs:-100}); await h.refresh();
    h.context.window.feedBackDesktop.audio.setCalibrationMode = async () => null;
    await h.context.setRememberOutputCalibration(false);
    assert.equal(h.toggle.checked, true); assert.equal(h.toggle.disabled, false);
    assert.equal(h.value(), -100); assert.match(h.status.textContent, /Could not save/);
});

test('a pending profile poll cannot undo a newer mode change', async () => {
    const h = harness(); h.profile({key:'tv', label:'TV', offsetMs:-100}); await h.refresh();
    let finishPoll;
    h.context.window.feedBackDesktop.audio.getCalibration = () => new Promise(resolve => { finishPoll = resolve; });
    const pending = h.refresh();
    h.context.window.feedBackDesktop.audio.setCalibrationMode = async () => ({perOutputSetup:false, output:{key:'shared', label:'TV', offsetMs:-100}});
    await h.context.setRememberOutputCalibration(false);
    finishPoll({perOutputSetup:true, output:{key:'tv', label:'TV', offsetMs:0}});
    await pending;
    assert.equal(h.toggle.checked, false); assert.equal(h.value(), -100);
});
