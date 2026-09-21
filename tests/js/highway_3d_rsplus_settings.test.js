const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const screen = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/settings.html'), 'utf8');

function store(initial = {}, failWrites = false) {
    const data = new Map(Object.entries(initial));
    return { data, getItem: key => data.get(key) ?? null, setItem(key, value) {
        if (failWrites) throw new Error('quota');
        data.set(key, String(value));
    } };
}

function load(storage = store()) {
    const anchor = 'window.feedBackViz_highway_3d = createFactory;';
    assert.equal(screen.split(anchor).length, 2);
    const instrumented = screen.replace(anchor, `${anchor}
        window.__rsSettings = { read: _bgReadSetting, coerce: _bgCoerce,
            hasStored: _bgHasStored, subscribe: _bgSubscribe, defaults: BG_DEFAULTS };
    `);
    const sandbox = { console: { log() {}, warn() {}, error() {} }, localStorage: storage,
        performance: { now: () => 0 }, window: { feedBackTour: { register() {} } } };
    vm.createContext(sandbox);
    vm.runInContext(instrumented, sandbox);
    return { window: sandbox.window, api: sandbox.window.__rsSettings, storage };
}

test('notation storage accepts only known styles and preserves Current for existing settings', () => {
    const h = load();
    assert.equal(h.api.read('main', 'notationStyle'), 'current');
    for (const invalid of ['', 'RS+', 'RSPLUS', 'prototype', null, false, 1]) {
        assert.equal(h.api.coerce('notationStyle', invalid), 'current');
    }
    assert.equal(h.api.coerce('notationStyle', 'rsplus'), 'rsplus');
    h.window.h3dBgSetNotationStyle('rsplus');
    assert.equal(h.api.read('main', 'notationStyle'), 'rsplus');
    h.window.h3dBgSetNotationStyle('invalid');
    assert.equal(h.api.read('main', 'notationStyle'), 'current');
});

test('a panel style or glow override survives global edits without rewriting palette or effects preferences', () => {
    const storage = store({ h3d_bg_palette: 'custom', h3d_bg_customColors: '["#ffee33"]',
        h3d_bg_vibrancy: '0.15', h3d_bg_glow: '0.4', h3d_bg_bloom: 'false',
        h3d_bg_panel0_notationStyle: 'rsplus', h3d_bg_panel0_glow: '0' });
    const h = load(storage), before = new Map(storage.data);
    const events = [];
    h.api.subscribe(key => events.push(key));
    h.window.h3dBgSetNotationStyle('current');
    assert.equal(h.api.read('panel0', 'notationStyle'), 'rsplus');
    assert.equal(h.api.read('panel1', 'notationStyle'), 'current');
    assert.equal(h.api.read('panel0', 'glow'), 0);
    assert.equal(h.api.read('panel1', 'glow'), 0.4);
    assert.equal(h.api.read('panel0', 'bloom'), false);
    for (const [key, value] of before) assert.equal(storage.data.get(key), value, key);
    assert.deepEqual(events, ['notationStyle']);
});

test('global style stays live when persistence is unavailable', () => {
    const h = load(store({ h3d_bg_notationStyle: 'current' }, true));
    const received = [];
    h.api.subscribe(key => received.push([key, h.api.read('main', key)]));
    h.window.h3dBgSetNotationStyle('rsplus');
    assert.equal(h.storage.getItem('h3d_bg_notationStyle'), 'current');
    assert.equal(h.api.read('main', 'notationStyle'), 'rsplus');
    assert.deepEqual(received, [['notationStyle', 'rsplus']]);
});

test('the host refresh contract reloads each panel before applying its style colors and glow', () => {
    const h = load(store({ h3d_bg_notationStyle: 'current', h3d_bg_glow: '0.25' }));
    const start = screen.indexOf('_bgListener = (changedKey) => {');
    const end = screen.indexOf('_bgSubscribe(_bgListener)', start);
    assert.ok(start >= 0 && end > start);
    const attach = new Function('api', 'panel', `
        let _bgListener, selected, calls = [];
        const _bgLoadSettings = () => { selected = api.read(panel, 'notationStyle'); calls.push('load:' + selected); };
        const _applyVibrancy = () => calls.push('color:' + selected);
        const _applyGlow = () => calls.push('glow:' + selected);
        const _applyBgTheme = () => calls.push('theme:' + selected);
        ${screen.slice(start, end)}
        api.subscribe(_bgListener);
        return calls;
    `);
    const first = attach(h.api, 'panel0'), second = attach(h.api, 'panel1');
    // Splitscreen writes the panel key, then invokes the matching global
    // setter with its existing value to notify renderer listeners.
    h.storage.setItem('h3d_bg_panel0_notationStyle', 'rsplus');
    h.window.h3dBgSetNotationStyle(h.storage.getItem('h3d_bg_notationStyle'));
    assert.deepEqual(first, ['load:rsplus', 'color:rsplus', 'glow:rsplus', 'theme:rsplus']);
    assert.deepEqual(second, ['load:current', 'color:current', 'glow:current', 'theme:current']);
    h.storage.setItem('h3d_bg_panel0_notationStyle', 'current');
    h.window.h3dBgSetNotationStyle('current');
    assert.deepEqual(first.slice(4), ['load:current', 'color:current', 'glow:current', 'theme:current']);
    assert.equal(h.storage.getItem('h3d_bg_notationStyle'), 'current');
});

function hydrate(saved, useSetter = true, brokenStorage = false, arrows = {}) {
    const localStorage = store({ ...(saved == null ? {} : { h3d_bg_notationStyle: saved }), ...arrows });
    if (brokenStorage) localStorage.getItem = () => { throw new Error('blocked'); };
    const elements = new Map(['h3d-notation-style', 'h3d-vibrancy-description', 'h3d-glow-description',
        'h3d-bloom-title', 'h3d-bloom-description', 'h3d-slide-arrow-approach-visible',
        'h3d-slide-arrow-neck-visible', 'h3d-slide-arrow-chain-preview-visible'].map(id => [id, {
        innerHTML: 'Current description: ' + id, listeners: {},
        addEventListener(name, fn) { this.listeners[name] = fn; },
    }]));
    const calls = [], window = useSetter ? { h3dBgSetNotationStyle: value => calls.push(value) } : {};
    const document = { getElementById: id => elements.get(id) ?? null };
    const start = settings.indexOf("            const notationSelect = document.getElementById('h3d-notation-style');");
    const end = settings.indexOf("            const sel = document.getElementById('h3d-bg-style');", start);
    assert.ok(start >= 0 && end > start);
    new Function('document', 'window', 'localStorage', settings.slice(start, end))(document, window, localStorage);
    return { elements, calls, storage: localStorage, select: elements.get('h3d-notation-style') };
}

test('settings hydrate the selected style and restore Current descriptions when switching back', () => {
    const h = hydrate('rsplus');
    assert.equal(h.select.value, 'rsplus');
    assert.equal(h.elements.get('h3d-bloom-title').textContent, 'Soft glow');
    assert.match(h.elements.get('h3d-glow-description').textContent, /keeping sharp notes/);
    assert.deepEqual(h.calls, [], 'opening Settings must not alter saved preferences');
    h.select.value = 'current'; h.select.listeners.change();
    assert.deepEqual(h.calls, ['current']);
    assert.equal(h.elements.get('h3d-bloom-title').innerHTML, 'Current description: h3d-bloom-title');
});

test('settings reject corrupt styles and can persist selection before the renderer is loaded', () => {
    for (const initial of [null, '', 'invalid']) assert.equal(hydrate(initial).select.value, 'current');
    assert.equal(hydrate('rsplus', true, true).select.value, 'current');
    const h = hydrate(null, false);
    h.select.value = 'rsplus'; h.select.listeners.change();
    assert.equal(h.storage.getItem('h3d_bg_notationStyle'), 'rsplus');
    assert.equal(h.elements.get('h3d-bloom-title').textContent, 'Soft glow');
});

function resolvedArrows(h, panelKey = 'main') {
    const start = screen.indexOf('            slideArrowApproachVisible = rsPlusNotation');
    const end = screen.indexOf('            trailYieldSettings.enabled', start);
    assert.ok(start >= 0 && end > start);
    return new Function('api', 'panelKey', `
        const _bgHasStored=api.hasStored, _bgReadSetting=api.read;
        const rsPlusNotation=api.read(panelKey,'notationStyle')==='rsplus';
        let slideArrowApproachVisible, slideArrowNeckVisible, slideArrowChainPreviewVisible;
        ${screen.slice(start, end)}
        return [slideArrowApproachVisible, slideArrowNeckVisible, slideArrowChainPreviewVisible];
    `)(h.api, panelKey);
}

test('RS+ slide defaults use only the trail while explicit global and panel arrow choices survive', () => {
    const h = load();
    assert.deepEqual(resolvedArrows(h), [true, true, true]);
    h.window.h3dBgSetNotationStyle('rsplus');
    assert.deepEqual(resolvedArrows(h), [false, false, false]);
    h.window.h3dBgSetSlideArrowApproachVisible(true);
    h.window.h3dBgSetSlideArrowNeckVisible(false);
    assert.deepEqual(resolvedArrows(h), [true, false, false]);
    h.storage.setItem('h3d_bg_panel0_slideArrowApproachVisible', 'false');
    h.storage.setItem('h3d_bg_panel0_slideArrowChainPreviewVisible', 'true');
    assert.deepEqual(resolvedArrows(h, 'panel0'), [false, false, true]);
    h.window.h3dBgSetNotationStyle('current');
    assert.deepEqual(resolvedArrows(h), [true, false, true]);
    h.storage.setItem('h3d_bg_panel0_notationStyle', 'rsplus');
    assert.deepEqual(resolvedArrows(h, 'panel0'), [false, false, true]);
});

test('explicit arrow choices remain live when localStorage writes fail', () => {
    const h = load(store({}, true));
    h.window.h3dBgSetNotationStyle('rsplus');
    assert.deepEqual(resolvedArrows(h), [false, false, false]);
    h.window.h3dBgSetSlideArrowApproachVisible(true);
    assert.deepEqual(resolvedArrows(h), [true, false, false]);
    h.window.h3dBgSetNotationStyle('current');
    assert.deepEqual(resolvedArrows(h), [true, true, true]);
});

test('slide checkboxes follow notation defaults without writing or discarding explicit choices', () => {
    const h = hydrate('rsplus', true, false, {
        h3d_bg_slideArrowNeckVisible: 'true', h3d_bg_slideArrowChainPreviewVisible: 'false',
    });
    const values = () => ['approach', 'neck', 'chain-preview'].map(name =>
        h.elements.get('h3d-slide-arrow-' + name + '-visible').checked);
    assert.deepEqual(values(), [false, true, false]);
    assert.equal(h.storage.getItem('h3d_bg_slideArrowApproachVisible'), null);
    h.select.value = 'current'; h.select.listeners.change();
    assert.deepEqual(values(), [true, true, false]);
    h.select.value = 'rsplus'; h.select.listeners.change();
    assert.deepEqual(values(), [false, true, false]);
    // The input's inline handler sends the setting to the renderer. This local
    // change listener retains that choice even when persistence is blocked.
    const approach = h.elements.get('h3d-slide-arrow-approach-visible');
    approach.checked = true; approach.listeners.change();
    h.select.value = 'current'; h.select.listeners.change();
    h.select.value = 'rsplus'; h.select.listeners.change();
    assert.deepEqual(values(), [true, true, false]);
});
