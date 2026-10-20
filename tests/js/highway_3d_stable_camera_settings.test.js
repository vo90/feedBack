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
        'stable-camera-movement-mode', 'stable-camera-auto-zoom',
        'stable-camera-reset', 'stable-camera-reset-status', 'legacy-camera-controls',
        'stable-camera-tuning-fields', 'stable-tuning-disabled', 'stable-tuning-status',
        ...['start-before', 'arrive-after', 'excursion-threshold']
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
    update('stableCameraStartBeforeMs', 1050);
    assert.equal(h.el('stable-start-before').value, '1050');
    assert.equal(h.el('stable-start-before-value').value, '1050');
    update('stableCameraArriveAfterMs', 175);
    assert.equal(h.el('stable-arrive-after-value').value, '175');
    update('stableCameraExcursionThreshold', 750);
    assert.equal(h.el('stable-excursion-threshold-value').value, '750');
    assert.equal(h.el('camera-smoothing').disabled, true);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    update('stableCameraMovementMode', 'latest-destination');
    assert.equal(h.el('stable-camera-movement-mode').value, 'latest-destination');
    update('stableCameraAutoZoom', false);
    assert.equal(h.el('stable-camera-auto-zoom').checked, false);
    assert.equal(h.el('zoom-smoothing').disabled, true);
    update('stableCameraAutoZoom', true);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    update('stableCameraPreset', 'angled');
    assert.equal(h.el('stable-camera-preset').value, 'angled');
    update('stableCameraFollow', false);
    assert.equal(h.el('stable-camera-follow').checked, false);
    assert.equal(h.el('stable-camera-tuning-fields').disabled, true);
    assert.equal(h.el('stable-camera-movement-mode').disabled, true);
    assert.equal(h.el('stable-camera-auto-zoom').disabled, false);
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
    assert.equal(h.el('camera-smoothing').disabled, true);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    assert.equal(h.el('stable-camera-preset').value, 'angled');
    assert.equal(h.data.get('h3d_bg_stableCameraFollow'), 'true');
    assert.match(h.el('camera-smoothing-description').textContent, /Start before next lane and Arrive after next lane/);
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

test('movement and zoom hydrate without writes and reject invalid saved choices', () => {
    for (const preset of ['straight', 'angled']) {
        const initial = {h3d_bg_cameraMode:'stable',h3d_bg_stableCameraPreset:preset,
            h3d_bg_stableCameraMovementMode:'latest-destination',h3d_bg_stableCameraAutoZoom:'false'};
        const h=load(initial);
        assert.equal(h.el('stable-camera-movement-mode').value,'latest-destination');
        assert.equal(h.el('stable-camera-auto-zoom').checked,false);
        assert.equal(h.el('zoom-smoothing').disabled,true);
        assert.match(h.el('zoom-smoothing-description').textContent,/Turn on Automatic zoom/);
        assert.deepEqual(h.writes,[]);
        assert.deepEqual(Object.fromEntries(h.data),initial);
    }
    for (const initial of [{},{h3d_bg_stableCameraMovementMode:'unknown',h3d_bg_stableCameraAutoZoom:'maybe'}]) {
        const h=load(initial);
        assert.equal(h.el('stable-camera-movement-mode').value,'reach-centres');
        assert.equal(h.el('stable-camera-auto-zoom').checked,true);
        assert.deepEqual(h.writes,[]);
    }
    assert.match(html, /value="reach-centres">Reach every centre/);
    assert.match(html, /value="latest-destination">Follow latest destination/);
});

test('movement and zoom call bridges once, and zoom remains adjustable with Follow off', () => {
    const calls=[],h=load({h3d_bg_cameraMode:'stable'}, {window:{
        h3dBgSetStableCameraMovementMode:value=>calls.push(['mode',value]),
        h3dBgSetStableCameraAutoZoom:value=>calls.push(['zoom',value]),
        h3dBgSetStableCameraFollow:value=>calls.push(['follow',value]),
    }});
    const mode=h.el('stable-camera-movement-mode'),zoom=h.el('stable-camera-auto-zoom');
    mode.value='latest-destination';mode.emit('change');
    zoom.checked=false;zoom.emit('change');
    h.el('stable-camera-follow').checked=false;h.el('stable-camera-follow').emit('change');
    assert.equal(mode.disabled,true);
    assert.equal(zoom.disabled,false);
    mode.value='reach-centres';mode.emit('change');
    zoom.checked=true;zoom.emit('change');
    assert.deepEqual(calls,[['mode','latest-destination'],['zoom',false],['follow',false],['zoom',true]]);
    assert.equal(h.el('zoom-smoothing').disabled,true,'Follow-off still freezes the view');
    assert.deepEqual(h.writes,[]);
});

test('movement and zoom persist locally without overwriting timing or old preferences', () => {
    const initial={h3d_bg_cameraMode:'stable',h3d_bg_stableCameraStartBeforeMs:'1050',
        h3d_bg_stableCameraArriveAfterMs:'200',h3d_bg_stableCameraDepartureDelay:'350'};
    const h=load(initial);
    h.el('stable-camera-movement-mode').value='latest-destination';h.el('stable-camera-movement-mode').emit('change');
    h.el('stable-camera-auto-zoom').checked=false;h.el('stable-camera-auto-zoom').emit('change');
    assert.deepEqual(h.writes,[['h3d_bg_stableCameraMovementMode','latest-destination'],['h3d_bg_stableCameraAutoZoom','false']]);
    for(const [key,value] of Object.entries(initial))assert.equal(h.data.get(key),value);
    const reopened=load(Object.fromEntries(h.data));
    assert.equal(reopened.el('stable-camera-movement-mode').value,'latest-destination');
    assert.equal(reopened.el('stable-camera-auto-zoom').checked,false);
    assert.equal(reopened.el('stable-start-before-value').value,'1050');
    assert.equal(reopened.el('stable-arrive-after-value').value,'200');
    assert.deepEqual(reopened.writes,[]);
    h.el('camera-mode').value='steady';h.el('camera-mode').emit('change');
    assert.equal(h.el('stable-camera-auto-zoom').disabled,true);
    assert.equal(h.el('zoom-smoothing').disabled,false);
    const count=h.writes.length;
    h.el('stable-camera-auto-zoom').emit('change');
    h.el('stable-camera-movement-mode').emit('change');
    assert.equal(h.writes.length,count);
});

test('direct timing opens with 700/0 and original-song threshold without writes', () => {
    const h = load({ h3d_bg_cameraMode: 'stable' });
    for (const [id, value] of [['start-before', '700'], ['arrive-after', '0'], ['excursion-threshold', '500']]) {
        assert.equal(h.el('stable-' + id).value, value);
        assert.equal(h.el('stable-' + id + '-value').value, value);
    }
    assert.equal(h.el('stable-camera-tuning-fields').disabled, false);
    assert.equal(h.el('stable-tuning-disabled').hidden, true);
    assert.equal(h.el('camera-smoothing').disabled, true);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    assert.deepEqual(h.writes, []);
});

test('timing sliders preview then commit once through the live setters', () => {
    const calls = [];
    const h = load({ h3d_bg_cameraMode: 'stable' }, { window: {
        h3dBgSetStableCameraStartBeforeMs: value => calls.push(['start', value]),
        h3dBgSetStableCameraArriveAfterMs: value => calls.push(['arrival', value]),
    } });
    for (const [id, number] of [['start-before', '1000'], ['arrive-after', '150']]) {
        const input = h.el('stable-' + id), count = calls.length;
        input.value = number; input.emit('input');
        assert.equal(h.el('stable-' + id + '-value').value, number);
        assert.equal(calls.length, count, 'preview must not rebuild the renderer');
        input.emit('change');
        assert.equal(calls.length, count + 1);
    }
    assert.deepEqual(calls, [['start', 1000], ['arrival', 150]]);
    assert.deepEqual(h.writes, [], 'the renderer owns persistence when connected');
});

test('direct times clamp, quantize, persist and hydrate through their own keys', () => {
    const h = load({ h3d_bg_cameraMode: 'stable' });
    for (const [id, key, min, max, step, fallback] of [
        ['start-before', 'stableCameraStartBeforeMs', 25, 3000, 25, 700],
        ['arrive-after', 'stableCameraArriveAfterMs', 0, 3000, 25, 0],
        ['excursion-threshold', 'stableCameraExcursionThreshold', 0, 3000, 50, 500],
    ]) {
        for (const suffix of ['', '-value']) {
            const tag = html.match(new RegExp(`<input\\b[^>]*id="h3d-stable-${id}${suffix}"[^>]*>`));
            assert.ok(tag, id + suffix);
            for (const [name, value] of Object.entries({ min, max, step }))
                assert.match(tag[0], new RegExp(`${name}="${value}"`));
        }
        const input = h.el('stable-' + id + '-value');
        for (const [raw, expected] of [['-10', min], ['99999', max], ['1012', 1000], ['', fallback], ['invalid', fallback]]) {
            input.value = raw; input.emit('change');
            assert.equal(input.value, String(expected));
            assert.equal(h.el('stable-' + id).value, String(expected));
            assert.equal(h.data.get('h3d_bg_' + key), String(expected));
        }
        input.value = '1250'; input.emit('change');
    }
    const reopened = load(Object.fromEntries(h.data));
    for (const id of ['start-before', 'arrive-after', 'excursion-threshold'])
        assert.equal(reopened.el('stable-' + id + '-value').value, '1250');
    assert.deepEqual(reopened.writes, []);
});

test('only an absent start key reads the saved preparation value without migrating storage', () => {
    for (const preparationMode of ['auto', 'manual', 'invalid']) {
        const initial = { h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraPreparationMode: preparationMode,
            h3d_bg_stableCameraPreparationMs: '1125', h3d_bg_stableCameraSettleLimit: '1000' };
        const fallback = load(initial);
        assert.equal(fallback.el('stable-start-before-value').value, '1125');
        assert.equal(fallback.el('stable-arrive-after-value').value, '0', 'an old maximum is not an exact arrival');
        assert.deepEqual(Object.fromEntries(fallback.data), initial);
        assert.deepEqual(fallback.writes, []);
        for (const [stored, expected] of [['450', '450'], ['0', '25'], ['', '700'], ['invalid', '700']]) {
            const explicit = load({ ...initial, h3d_bg_stableCameraStartBeforeMs: stored });
            assert.equal(explicit.el('stable-start-before-value').value, expected);
            assert.deepEqual(explicit.writes, []);
        }
    }
    const invalid = load({ h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraPreparationMs: 'invalid' });
    assert.equal(invalid.el('stable-start-before-value').value, '700');
});

test('retired controls are absent and edits preserve every old stored tuning value', () => {
    const retired = { stableCameraPreparationMode: 'manual', stableCameraPreparationMs: '1500',
        stableCameraDepartureDelay: '225', stableCameraTravelExtra: '20', stableCameraSettleLimit: '600',
        stableCameraLongSwitchFrets: '24' };
    const initial = { h3d_bg_cameraMode: 'stable', ...Object.fromEntries(
        Object.entries(retired).map(([key, value]) => ['h3d_bg_' + key, value])) };
    const h = load(initial);
    for (const id of ['preparation-mode', 'preparation-time', 'departure-delay', 'travel-extra',
        'settle-limit', 'long-switch-frets', 'tuning-trial', 'tuning-previous'])
        assert.ok(!html.includes(`id="h3d-stable-${id}`), id);
    for (const id of ['start-before', 'arrive-after', 'excursion-threshold']) {
        const number = h.el('stable-' + id + '-value'); number.value = '800'; number.emit('change');
    }
    for (const [key, value] of Object.entries(retired)) assert.equal(h.data.get('h3d_bg_' + key), value);
    assert.equal(h.writes.length, 3);
});

test('timing changes remain inactive outside Stable Follow, with zoom enabled while following', () => {
    const calls = [], h = load({ h3d_bg_cameraMode: 'stable' }, { window: {
        h3dBgSetStableCameraStartBeforeMs: value => calls.push(['start', value]),
        h3dBgSetStableCameraArriveAfterMs: value => calls.push(['arrival', value]),
        h3dBgSetStableCameraExcursionThreshold: value => calls.push(['threshold', value]),
    } });
    const attempt = () => {
        for (const id of ['start-before', 'arrive-after', 'excursion-threshold']) {
            const input = h.el('stable-' + id + '-value'); input.value = '1200'; input.emit('change');
        }
    };
    h.el('stable-camera-follow').checked = false; h.el('stable-camera-follow').emit('change');
    assert.equal(h.el('stable-camera-tuning-fields').disabled, true);
    assert.equal(h.el('stable-tuning-disabled').hidden, false);
    assert.equal(h.el('zoom-smoothing').disabled, true);
    attempt(); assert.deepEqual(calls, []);
    h.el('stable-camera-follow').checked = true; h.el('stable-camera-follow').emit('change');
    assert.equal(h.el('camera-smoothing').disabled, true);
    assert.equal(h.el('zoom-smoothing').disabled, false);
    attempt(); assert.equal(calls.length, 3);
    h.el('camera-mode').value = 'steady'; h.el('camera-mode').emit('change');
    assert.equal(h.el('camera-smoothing').disabled, false);
    attempt(); assert.equal(calls.length, 3);
});

test('direct timing defaults and local edits survive unavailable persistence', () => {
    const h = load({}, { unavailable: true });
    h.el('camera-mode').value = 'stable'; h.el('camera-mode').emit('change');
    assert.equal(h.el('stable-start-before-value').value, '700');
    assert.equal(h.el('stable-arrive-after-value').value, '0');
    const input = h.el('stable-start-before-value'); input.value = '1200'; input.emit('change');
    assert.equal(h.el('stable-start-before').value, '1200');
    assert.deepEqual(h.writes, []);
});
