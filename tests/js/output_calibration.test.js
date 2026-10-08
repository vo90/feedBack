const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/settings.js'), 'utf8');
function harness() {
    let profile = null, value = 0;
    const label = {textContent: ''};
    const context = vm.createContext({console, CustomEvent: class {},
        document: {getElementById: id => id === 'av-calibration-profile' ? label : null},
        window: {addEventListener() {}, dispatchEvent() {}, feedBackDesktop: {audio: {getCalibration: async () => profile}}},
        setAvOffsetMs: n => { value = n; }});
    const start = source.indexOf('let _legacyAvOffsetMs'), end = source.indexOf('export let _avSaveDebounce', start);
    vm.runInContext(source.slice(start, end).replace(/export /g, ''), context);
    vm.runInContext('_legacyAvOffsetMs = -100;', context);
    return {context, label, profile: output => { profile = output ? {output} : null; },
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
