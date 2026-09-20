const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/settings.html'), 'utf8');

function extractFunction(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = html.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < html.length) {
        if (html[end] === '{') depth++;
        else if (html[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return html.slice(start, end);
}

function load(initial = {}, { window = {}, unavailable = false } = {}) {
    const elements = new Map();
    for (const id of ['camera-mode', 'camera-smoothing', 'zoom-smoothing',
        'stable-camera-controls', 'stable-camera-preset', 'stable-camera-follow',
        'stable-camera-reset', 'stable-camera-reset-status', 'legacy-camera-controls',
        'stable-camera-legacy-note', 'camera-smoothing-description', 'zoom-smoothing-description']) {
        const element = { value: '', checked: false, disabled: false, hidden: false,
            textContent: '', innerHTML: `Original ${id}`, listeners: {},
            addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); },
            emit(event) { for (const callback of this.listeners[event] || []) callback.call(this); } };
        elements.set('h3d-' + id, element);
    }
    const data = new Map(Object.entries(initial)), writes = [];
    const localStorage = {
        getItem(key) { if (unavailable) throw new Error('Storage unavailable'); return data.get(key) ?? null; },
        setItem(key, value) {
            if (unavailable) throw new Error('Storage unavailable');
            writes.push([key, String(value)]); data.set(key, String(value));
        },
    };
    const defaults = html.match(/const DEFAULTS = (\{[^\n]+\});/)[1];
    const validModes = html.match(/const VALID_CAMERA_MODES = ([^\n]+);/)[1];
    const api = new Function('document', 'window', 'localStorage', `
        const DEFAULTS = ${defaults};
        const VALID_CAMERA_MODES = ${validModes};
        ${extractFunction('coerceCameraMode')}
        ${extractFunction('coerceStableCameraPreset')}
        ${extractFunction('coerceBool')}
        ${extractFunction('initStableCameraControls')}
        const mode = document.getElementById('h3d-camera-mode');
        let stored = null;
        try { stored = localStorage.getItem('h3d_bg_cameraMode'); } catch (_) {}
        mode.value = coerceCameraMode(stored);
        initStableCameraControls(mode, document.getElementById('h3d-camera-smoothing'),
            document.getElementById('h3d-zoom-smoothing'));
        return { defaults: DEFAULTS, coerceCameraMode };
    `)({ getElementById: id => elements.get(id) ?? null }, window, localStorage);
    return { ...api, window, data, writes, el: id => elements.get('h3d-' + id) };
}

test('opening settings preserves the legacy default and does not migrate stored preferences', () => {
    const initial = { h3d_bg_cameraLockLow: 'true', h3d_bg_tiltSmoothing: '0.8' };
    const h = load(initial);
    assert.equal(h.defaults.cameraMode, 'lookahead');
    assert.equal(h.el('camera-mode').value, 'lookahead');
    assert.equal(h.el('stable-camera-controls').hidden, true);
    assert.equal(h.el('stable-camera-preset').disabled, true);
    assert.equal(h.el('legacy-camera-controls').disabled, false);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(Object.fromEntries(h.data), initial);
});

test('saved stable fixed view hydrates, then legacy mode restores controls without changing their values', () => {
    const h = load({ h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraPreset: 'angled',
        h3d_bg_stableCameraFollow: 'false', h3d_bg_cameraLockLow: 'true', h3d_bg_cameraLockZoom: '0.9' });
    assert.equal(h.el('camera-mode').value, 'stable');
    assert.equal(h.el('stable-camera-preset').value, 'angled');
    assert.equal(h.el('stable-camera-follow').checked, false);
    assert.equal(h.el('stable-camera-controls').hidden, false);
    assert.equal(h.el('legacy-camera-controls').disabled, true);
    assert.equal(h.el('stable-camera-legacy-note').hidden, false);
    assert.equal(h.el('camera-smoothing').disabled, true);
    assert.equal(h.el('zoom-smoothing').disabled, true);
    assert.match(h.el('camera-smoothing-description').textContent, /Turn on Follow/);

    h.el('camera-mode').value = 'steady'; h.el('camera-mode').emit('change');
    assert.equal(h.el('legacy-camera-controls').disabled, false);
    assert.equal(h.el('camera-smoothing').disabled, false);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    assert.equal(h.el('camera-smoothing-description').innerHTML, 'Original camera-smoothing-description');
    assert.equal(h.data.get('h3d_bg_cameraLockLow'), 'true');
    assert.equal(h.data.get('h3d_bg_cameraLockZoom'), '0.9');
    assert.deepEqual(h.writes, [['h3d_bg_cameraMode', 'steady']]);

    h.el('camera-mode').value = 'stable'; h.el('camera-mode').emit('change');
    h.el('stable-camera-follow').checked = true; h.el('stable-camera-follow').emit('change');
    assert.equal(h.el('camera-smoothing').disabled, false);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    assert.equal(h.el('stable-camera-preset').value, 'angled');
    assert.equal(h.data.get('h3d_bg_stableCameraFollow'), 'true');
    assert.match(h.el('camera-smoothing-description').textContent, /Small movements stay/);
});

test('corrupt saved choices use safe defaults and the historical classic alias still works', () => {
    const h = load({ h3d_bg_cameraMode: 'unknown', h3d_bg_stableCameraPreset: 'RS+',
        h3d_bg_stableCameraFollow: 'maybe' });
    assert.equal(h.el('camera-mode').value, 'lookahead');
    assert.equal(h.el('stable-camera-preset').value, 'straight');
    assert.equal(h.el('stable-camera-follow').checked, true);
    assert.equal(h.coerceCameraMode('classic'), 'steady');
    assert.equal(h.coerceCameraMode('stable'), 'stable');
    assert.deepEqual(h.writes, []);
});

test('changes call each live bridge once and reset is an action rather than a persisted setting', () => {
    const calls = [], director = { enabled: true, distMul: 1.2, yaw: 0.1 };
    const h = load({}, { window: { __h3dCamCtl: director,
        h3dBgSetCameraMode: value => calls.push(['mode', value]),
        h3dBgSetStableCameraPreset: value => calls.push(['preset', value]),
        h3dBgSetStableCameraFollow: value => calls.push(['follow', value]),
        h3dStableCameraReset: () => calls.push(['reset']) } });
    h.el('camera-mode').value = 'stable'; h.el('camera-mode').emit('change');
    h.el('stable-camera-preset').value = 'angled'; h.el('stable-camera-preset').emit('change');
    h.el('stable-camera-follow').checked = false; h.el('stable-camera-follow').emit('change');
    h.el('stable-camera-reset').emit('click');
    h.el('stable-camera-reset').emit('click');
    assert.deepEqual(calls, [['mode', 'stable'], ['preset', 'angled'], ['follow', false], ['reset'], ['reset']]);
    assert.deepEqual(h.writes, []);
    assert.equal(h.data.size, 0);
    assert.deepEqual(director, { enabled: true, distMul: 1.2, yaw: 0.1 });
    assert.match(h.el('stable-camera-reset-status').textContent, /View reset/);
});

test('settings work before renderer loading and reset discovers its bridge when it becomes available', () => {
    const h = load();
    h.el('camera-mode').value = 'stable'; h.el('camera-mode').emit('change');
    h.el('stable-camera-preset').value = 'angled'; h.el('stable-camera-preset').emit('change');
    h.el('stable-camera-follow').checked = false; h.el('stable-camera-follow').emit('change');
    assert.deepEqual(h.writes, [['h3d_bg_cameraMode', 'stable'],
        ['h3d_bg_stableCameraPreset', 'angled'], ['h3d_bg_stableCameraFollow', 'false']]);
    h.el('stable-camera-reset').emit('click');
    assert.match(h.el('stable-camera-reset-status').textContent, /Open a song/);
    assert.equal(h.writes.length, 3);
    let resets = 0;
    h.window.h3dStableCameraReset = () => resets++;
    h.el('stable-camera-reset').emit('click');
    assert.equal(resets, 1);
    h.el('camera-mode').value = 'lookahead'; h.el('camera-mode').emit('change');
    h.el('stable-camera-reset').emit('click');
    assert.equal(resets, 1, 'a hidden legacy-mode reset cannot move the camera');
});

test('blocked persistence leaves the controls usable without inventing a successful reset', () => {
    const h = load({}, { unavailable: true });
    h.el('camera-mode').value = 'stable'; h.el('camera-mode').emit('change');
    h.el('stable-camera-follow').checked = false; h.el('stable-camera-follow').emit('change');
    assert.equal(h.el('stable-camera-controls').hidden, false);
    assert.equal(h.el('camera-smoothing').disabled, true);
    h.el('stable-camera-reset').emit('click');
    assert.match(h.el('stable-camera-reset-status').textContent, /Open a song/);
});

test('the disabled fieldset covers all legacy pose controls and leaves text size usable', () => {
    const start = html.indexOf('<fieldset id="h3d-legacy-camera-controls"');
    const end = html.indexOf('</fieldset>', start);
    assert.ok(start >= 0 && end > start);
    const fieldset = html.slice(start, end);
    for (const id of ['h3d-tilt-smoothing', 'h3d-camera-lock-low', 'h3d-camera-lock-zoom']) {
        assert.ok(fieldset.includes(`id="${id}"`), id);
    }
    assert.ok(!fieldset.includes('id="h3d-text-size"'));
    assert.match(html, /<button type="button" id="h3d-stable-camera-reset"/);
    assert.match(html, /id="h3d-stable-camera-reset-status"[^>]*role="status"/);
    assert.doesNotMatch(html.match(/<select id="h3d-camera-mode"[^>]*>/)[0], /onchange/,
        'one event binding avoids double writes');
});

test('every settings script remains valid JavaScript', () => {
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        assert.doesNotThrow(() => new vm.Script(script[1]));
    }
});
