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
        'stable-camera-tuning-fields', 'stable-tuning-disabled', 'stable-tuning-status',
        'stable-tuning-trial', 'stable-tuning-previous',
        ...['departure-delay', 'travel-extra', 'settle-limit', 'excursion-threshold', 'long-switch-frets']
            .flatMap(id => ['stable-' + id, 'stable-' + id + '-value']),
        'stable-camera-legacy-note', 'camera-smoothing-description', 'zoom-smoothing-description']) {
        const element = { value: '', checked: false, disabled: false, hidden: false,
            textContent: '', innerHTML: `Original ${id}`, listeners: {},
            addEventListener(event, callback) { (this.listeners[event] ??= []).push(callback); },
            emit(event, detail) { for (const callback of this.listeners[event] || []) callback.call(this, { detail }); } };
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
        ${extractFunction('initStableCameraTuning')}
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

test('live highway edits refresh the mounted settings page without rewriting preferences', () => {
    const h = load({ h3d_bg_cameraMode: 'stable' });
    const update = (key, value) => h.el('stable-camera-controls').emit('h3d:stable-camera-change', { key, value });
    update('stableCameraDepartureDelay', 175);
    assert.equal(h.el('stable-departure-delay').value, '175');
    assert.equal(h.el('stable-departure-delay-value').value, '175');
    update('stableCameraExcursionThreshold', 750);
    assert.equal(h.el('stable-excursion-threshold-value').value, '750');
    update('stableCameraPreset', 'angled');
    assert.equal(h.el('stable-camera-preset').value, 'angled');
    update('stableCameraFollow', false);
    assert.equal(h.el('stable-camera-follow').checked, false);
    assert.equal(h.el('stable-camera-tuning-fields').disabled, true);
    update('stableCameraFollow', true);
    assert.equal(h.el('stable-camera-tuning-fields').disabled, false);
    update('cameraMode', 'steady');
    assert.equal(h.el('stable-camera-controls').hidden, true);
    assert.deepEqual(h.writes, []);
});

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

test('tuning opens with trial values without writing or changing camera behavior', () => {
    const h = load({ h3d_bg_cameraMode: 'stable' });
    for (const [id, value] of [['departure-delay', '100'], ['travel-extra', '10'],
        ['settle-limit', '250'], ['excursion-threshold', '500'], ['long-switch-frets', '5']]) {
        assert.equal(h.el('stable-' + id).value, value);
        assert.equal(h.el('stable-' + id + '-value').value, value);
    }
    assert.equal(h.el('stable-camera-tuning-fields').disabled, false);
    assert.equal(h.el('stable-tuning-disabled').hidden, true);
    assert.deepEqual(h.writes, []);
});

test('tuning previews slider values then commits once through the live setter on release', () => {
    const calls = [];
    const h = load({ h3d_bg_cameraMode: 'stable' }, {window: {
        h3dBgSetStableCameraDepartureDelay: value => calls.push(value),
    }});
    h.el('stable-departure-delay').value = '150';
    h.el('stable-departure-delay').emit('input');
    assert.equal(h.el('stable-departure-delay-value').value, '150');
    assert.deepEqual(calls, []);
    h.el('stable-departure-delay').emit('change');
    assert.deepEqual(calls, [150]);
    assert.deepEqual(h.writes, [], 'the renderer owns persistence when available');
});

test('advanced numeric controls persist, clamp invalid input, and hydrate on reopen', () => {
    const h = load({ h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraTravelExtra: 'garbage',
        h3d_bg_stableCameraSettleLimit: '9999', h3d_bg_stableCameraLongSwitchFrets: '0' });
    assert.equal(h.el('stable-travel-extra').value, '10');
    assert.equal(h.el('stable-settle-limit').value, '3000');
    assert.equal(h.el('stable-long-switch-frets').value, '1');
    h.el('stable-excursion-threshold-value').value = '750';
    h.el('stable-excursion-threshold-value').emit('change');
    assert.equal(h.el('stable-excursion-threshold').value, '750');
    assert.equal(h.data.get('h3d_bg_stableCameraExcursionThreshold'), '750');
    h.el('stable-travel-extra-value').value = '-5';
    h.el('stable-travel-extra-value').emit('change');
    assert.equal(h.el('stable-travel-extra').value, '0');
    h.el('stable-departure-delay-value').value = '112';
    h.el('stable-departure-delay-value').emit('change');
    assert.equal(h.el('stable-departure-delay').value, '100', 'numeric input uses the renderer step');
    const reopened = load(Object.fromEntries(h.data));
    assert.equal(reopened.el('stable-excursion-threshold-value').value, '750');
    assert.equal(reopened.el('stable-travel-extra-value').value, '0');
});

test('settings accept the expanded experiment ranges and retain them on reopen', () => {
    const ranges = [
        ['departure-delay', 'stableCameraDepartureDelay', 1000],
        ['travel-extra', 'stableCameraTravelExtra', 200],
        ['settle-limit', 'stableCameraSettleLimit', 3000],
        ['excursion-threshold', 'stableCameraExcursionThreshold', 3000],
        ['long-switch-frets', 'stableCameraLongSwitchFrets', 24],
    ];
    const h = load({ h3d_bg_cameraMode: 'stable' });
    for (const [id, key, max] of ranges) {
        for (const suffix of ['', '-value']) {
            const markup = html.match(new RegExp(`<input\\b[^>]*id="h3d-stable-${id}${suffix}"[^>]*>`));
            assert.ok(markup, id + suffix);
            assert.match(markup[0], new RegExp(`max="${max}"`));
        }
        const input = h.el('stable-' + id + '-value');
        input.value = String(max); input.emit('change');
        assert.equal(h.data.get('h3d_bg_' + key), String(max));
        assert.equal(h.el('stable-' + id).value, String(max));
        input.value = '99999'; input.emit('change');
        assert.equal(input.value, String(max));
    }
    const reopened = load(Object.fromEntries(h.data));
    for (const [id, , max] of ranges) {
        assert.equal(reopened.el('stable-' + id).value, String(max));
        assert.equal(reopened.el('stable-' + id + '-value').value, String(max));
    }
});

test('comparison buttons set all five values and remain inactive outside Stable Follow', () => {
    const h = load({ h3d_bg_cameraMode: 'stable' });
    h.el('stable-tuning-previous').emit('click');
    assert.equal(h.el('stable-departure-delay').value, '0');
    assert.equal(h.el('stable-travel-extra').value, '0');
    assert.equal(h.el('stable-settle-limit').value, '0');
    assert.equal(h.el('stable-excursion-threshold').value, '500');
    assert.match(h.el('stable-tuning-status').textContent, /Previous tuning/);
    assert.equal(h.writes.length, 5);
    h.el('stable-tuning-trial').emit('click');
    assert.equal(h.el('stable-departure-delay').value, '100');
    assert.equal(h.el('stable-travel-extra').value, '10');
    assert.equal(h.el('stable-settle-limit').value, '250');
    assert.equal(h.writes.length, 10);
    h.el('stable-camera-follow').checked = false;
    h.el('stable-camera-follow').emit('change');
    assert.equal(h.el('stable-camera-tuning-fields').disabled, true);
    assert.equal(h.el('stable-tuning-disabled').hidden, false);
    h.el('stable-tuning-previous').emit('click');
    assert.equal(h.writes.length, 11, 'only Follow was changed');
    h.el('camera-mode').value = 'steady'; h.el('camera-mode').emit('change');
    h.el('stable-tuning-trial').emit('click');
    assert.equal(h.writes.length, 12, 'hidden tuning controls do not affect legacy views');
});
