const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const keys = ['stableCameraDepartureDelay', 'stableCameraTravelExtra', 'stableCameraSettleLimit',
    'stableCameraExcursionThreshold', 'stableCameraLongSwitchFrets'];

// The production helper builds ordinary elements. This DOM implements tree
// traversal and bubbling so keyboard tests exercise the ancestor boundary,
// rather than invoking its listener directly and assuming it protects the app.
function makeDocument() {
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = []; this.parentNode = null; this.listeners = new Map();
            this.attributes = new Map(); this.dataset = {}; this.style = {};
            this.value = ''; this.textContent = ''; this.className = '';
            this.hidden = false; this.disabled = false; this.checked = false;
        }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        append(...children) { for (const child of children) this.appendChild(child); }
        remove() {
            if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
            this.parentNode = null;
        }
        contains(node) { return node === this || this.children.some(child => child.contains(node)); }
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
            if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
            if (name === 'id') this.id = String(value);
        }
        getAttribute(name) {
            if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
            return this.attributes.get(name) ?? null;
        }
        matches(selector) {
            const tag = selector.match(/^[a-z]+/i)?.[0];
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            if (selector.startsWith('#')) return this.id === selector.slice(1);
            if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
            return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)]
                .every(([, name, value]) => value === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === value);
        }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
        addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
        removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
        dispatchEvent(event) {
            event.target ??= this;
            event.currentTarget = this;
            for (const fn of [...this.listeners.get(event.type) || []]) fn.call(this, event);
            if (event.bubbles && !event.cancelBubble) this.parentNode?.dispatchEvent(event);
            return !event.defaultPrevented;
        }
        emit(type, properties = {}) {
            const event = {type, bubbles: true, defaultPrevented: false, cancelBubble: false,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() { this.cancelBubble = true; }, ...properties};
            this.dispatchEvent(event); return event;
        }
        focus() { document.activeElement = this; }
        click() { if (!this.disabled) this.emit('click'); }
    }
    const document = new Element('document');
    document.body = document.appendChild(new Element('body'));
    document.activeElement = document.body;
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.querySelector('#' + id);
    return document;
}

function load(initial = {}, {blocked = false} = {}) {
    const document = makeDocument(), writes = [], data = new Map(Object.entries(initial));
    const window = document.createElement('window');
    document.parentNode = window;
    window.feedBackTour = {register() {}};
    const errors = [];
    const sandbox = {document, window, performance: {now: () => 0},
        console: {log() {}, warn() {}, error(...args) { errors.push(args); }},
        localStorage: {getItem(key) { return data.get(key) ?? null; }, setItem(key, value) {
            if (blocked) throw new Error('Storage unavailable');
            data.set(key, String(value)); writes.push([key, String(value)]);
        }},
        CustomEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    };
    const anchor = 'window.feedBackViz_highway_3d = createFactory;';
    assert.equal(source.split(anchor).length, 2);
    vm.runInNewContext(source.replace(anchor, `${anchor}\nwindow.testCameraOverlay = {
        create: createStableCameraTuningOverlay, listeners: _bgListeners,
        read: _bgReadSetting, write: _bgWriteGlobal };`), sandbox);
    const api = window.testCameraOverlay;
    const overlays = [];
    function create(panelIndex = null) {
        const host = document.body.appendChild(document.createElement('div'));
        const canvas = document.createElement('canvas'); canvas.panelIndex = panelIndex;
        window.feedBackSplitscreen = {panelIndexFor: value => value?.panelIndex};
        const overlay = api.create(host, () => canvas, 'test-' + overlays.length);
        const query = selector => overlay.root.querySelector(selector);
        const input = (key, type = 'range') => query(`[data-camera-setting="${key}"][data-camera-input="${type}"]`);
        const toggle = query('[data-camera-tuning-toggle]');
        const panel = query('[data-camera-tuning-panel]');
        const instance = {...overlay, host, canvas, query, input, toggle, panel};
        overlays.push(instance); return instance;
    }
    return {document, window, writes, data, api, create, errors};
}

function stored(key) { return 'h3d_bg_' + key; }
function values(overlay) { return keys.map(key => Number(overlay.input(key).value)); }

test('live tuning opens from saved settings without writing and commits slider changes only on release', () => {
    const h = load({h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraDepartureDelay: '150'});
    const o = h.create();
    assert.equal(o.panel.hidden, true);
    assert.deepEqual(values(o), [150, 10, 250, 500, 5]);
    assert.deepEqual(h.writes, []);
    o.toggle.click();
    assert.equal(o.panel.hidden, false);
    assert.equal(o.toggle.getAttribute('aria-expanded'), 'true');
    const range = o.input(keys[0]), number = o.input(keys[0], 'number');
    range.value = '175'; range.emit('input');
    assert.equal(number.value, '175');
    assert.deepEqual(h.writes, []);
    range.emit('change');
    assert.deepEqual(h.writes, [[stored(keys[0]), '175']]);
    assert.equal(h.api.read('main', keys[0]), 175);
    assert.deepEqual(h.errors, []);
});

test('live numeric controls coerce values through production storage and hydrate after reopening', () => {
    const h = load({h3d_bg_cameraMode: 'stable', h3d_bg_stableCameraDepartureDelay: '50'}), o = h.create();
    o.toggle.click();
    for (const [key, raw, expected] of [[keys[0], '112', 100], [keys[1], '999', 30],
        [keys[2], '-25', 0], [keys[3], '743', 750], [keys[4], '0', 1]]) {
        const input = o.input(key, 'number'); input.value = raw; input.emit('change');
        assert.equal(Number(o.input(key).value), expected);
        assert.equal(Number(input.value), expected);
        assert.equal(h.data.get(stored(key)), String(expected));
    }
    o.toggle.click(); o.toggle.click();
    assert.deepEqual(values(o), [100, 30, 0, 750, 1]);
    o.destroy();
    const reopened = h.create();
    assert.deepEqual(values(reopened), [100, 30, 0, 750, 1]);
    assert.equal(h.writes.length, 5);
});

test('comparison buttons persist all five settings and restore previous or gentler tuning', () => {
    const initial = Object.fromEntries(keys.map((key, index) => [stored(key), String([150, 20, 300, 750, 8][index])]));
    const h = load({h3d_bg_cameraMode: 'stable', ...initial}), o = h.create();
    o.toggle.click();
    o.query('[data-camera-tuning-preset="previous"]').click();
    assert.deepEqual(values(o), [0, 0, 0, 500, 5]);
    assert.equal(h.writes.length, 5);
    o.query('[data-camera-tuning-preset="gentler"]').click();
    assert.deepEqual(values(o), [100, 10, 250, 500, 5]);
    assert.equal(h.writes.length, 8, 'unchanged values do not cause redundant settings events');
    o.query('[data-camera-tuning-preset="gentler"]').click();
    assert.equal(h.writes.length, 8);
});

test('live overlays synchronize on setting events and keep split-screen edits scoped', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}), main = h.create(), split = h.create(1);
    h.window.h3dBgSetStableCameraDepartureDelay(200);
    assert.equal(main.input(keys[0]).value, '200');
    assert.equal(split.input(keys[0]).value, '200');
    split.input(keys[0], 'number').value = '75'; split.input(keys[0], 'number').emit('change');
    assert.equal(split.input(keys[0]).value, '75');
    assert.equal(main.input(keys[0]).value, '200');
    assert.equal(h.data.get('h3d_bg_panel1_' + keys[0]), '75');
    assert.equal(h.data.get(stored(keys[0])), '200');
    h.window.h3dBgSetStableCameraDepartureDelay(150);
    assert.equal(main.input(keys[0]).value, '150');
    assert.equal(split.input(keys[0]).value, '75', 'explicit panel choice retains its precedence');
    assert.deepEqual(h.errors, []);
});

test('an existing main override is updated without writing an ineffective global value', () => {
    const h = load({h3d_bg_cameraMode: 'stable', h3d_bg_main_stableCameraDepartureDelay: '50'}), o = h.create();
    o.input(keys[0], 'number').value = '125'; o.input(keys[0], 'number').emit('change');
    assert.deepEqual(h.writes, [['h3d_bg_main_' + keys[0], '125']]);
    assert.equal(o.input(keys[0]).value, '125');
    assert.equal(h.api.read('main', keys[0]), 125);
});

test('destroy removes its DOM and subscription, and reopening does not accumulate listeners', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}), baseline = h.api.listeners.size;
    const o = h.create();
    assert.equal(h.api.listeners.size, baseline + 1);
    assert.ok(h.document.body.contains(o.root));
    o.destroy(); o.destroy();
    assert.equal(h.api.listeners.size, baseline);
    assert.equal(h.document.body.contains(o.root), false);
    o.input(keys[1], 'number').value = '30'; o.input(keys[1], 'number').emit('change');
    assert.deepEqual(h.writes, [], 'detached controls no longer hold active mutation handlers');
    h.window.h3dBgSetStableCameraTravelExtra(25);
    const reopened = h.create();
    assert.equal(h.api.listeners.size, baseline + 1);
    assert.equal(reopened.input(keys[1]).value, '25');
    reopened.destroy();
    assert.equal(h.api.listeners.size, baseline);
    assert.deepEqual(h.errors, []);
});

test('overlay keyboard events cannot reach transport shortcuts while native slider and button behavior remains available', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}), o = h.create(), dispatched = [];
    h.document.addEventListener('keydown', event => dispatched.push(['down', event.key]));
    h.document.addEventListener('keyup', event => dispatched.push(['up', event.key]));
    o.toggle.click();
    for (const element of [o.input(keys[0]), o.input(keys[0], 'number'),
        o.query('[data-camera-tuning-preset="previous"]')]) {
        for (const key of ['ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Tab']) {
            const enterCommitsInput = key === 'Enter' && element.tagName === 'INPUT';
            assert.equal(element.emit('keydown', {key}).defaultPrevented, enterCommitsInput,
                key + ' keeps the control action or explicitly commits numeric input');
            element.emit('keyup', {key});
        }
    }
    assert.deepEqual(dispatched, []);
    const escape = o.input(keys[0]).emit('keydown', {key: 'Escape'});
    assert.equal(escape.defaultPrevented, true);
    assert.equal(o.panel.hidden, true);
    assert.equal(h.document.activeElement, o.toggle);
    assert.deepEqual(dispatched, [], 'Escape closes the panel instead of exiting the song');
    h.document.body.emit('keydown', {key: ' '});
    assert.deepEqual(dispatched, [['down', ' ']], 'transport remains available outside the overlay');
});

test('numeric Enter and blur commit once, while unrelated settings never erase an unfinished edit', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}), o = h.create(), number = o.input(keys[0], 'number');
    o.toggle.click();
    number.value = '150'; number.emit('input');
    h.window.h3dBgSetStableCameraTravelExtra(20);
    assert.equal(number.value, '150');
    assert.equal(h.api.read('main', keys[0]), 100, 'the uncommitted edit has not moved the camera');
    number.emit('keydown', {key: 'Enter'}); number.emit('change'); number.emit('blur');
    assert.deepEqual(h.writes, [[stored(keys[1]), '20'], [stored(keys[0]), '150']]);
    number.value = '175'; number.emit('input'); number.emit('blur'); number.emit('change');
    assert.deepEqual(h.writes.at(-1), [stored(keys[0]), '175']);
    assert.equal(h.writes.length, 3, 'a browser change/blur pair does not duplicate the write');
    h.window.h3dBgSetStableCameraDepartureDelay(50);
    assert.equal(number.value, '50');
});

test('both Stable views share tuning and disabling Follow blocks movement edits without changing other camera modes', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}), o = h.create();
    const preset = o.query('[data-camera-setting="stableCameraPreset"]');
    const follow = o.query('[data-camera-setting="stableCameraFollow"]');
    preset.value = 'angled'; preset.emit('change');
    assert.equal(h.data.get(stored('stableCameraPreset')), 'angled');
    assert.equal(h.api.read('main', 'cameraMode'), 'stable');
    follow.checked = false; follow.emit('change');
    const before = h.writes.length;
    o.input(keys[0], 'number').value = '200'; o.input(keys[0], 'number').emit('change');
    o.query('[data-camera-tuning-preset="previous"]').click();
    assert.equal(h.writes.length, before, 'disabled fieldset handlers cannot change tuning');
    follow.checked = true; follow.emit('change');
    assert.deepEqual(values(o), [100, 10, 250, 500, 5]);
    assert.equal(preset.value, 'angled');
    o.toggle.click();
    h.window.h3dBgSetCameraMode('steady');
    assert.equal(o.root.hidden, true);
    assert.equal(o.panel.hidden, true);
    h.window.h3dBgSetCameraMode('stable');
    assert.equal(o.root.hidden, false);
    assert.equal(o.panel.hidden, true);
    assert.equal(preset.value, 'angled');
    assert.deepEqual(values(o), [100, 10, 250, 500, 5]);
});

test('blocked storage retains live tuning in memory and preserves per-panel isolation', () => {
    const h = load({h3d_bg_cameraMode: 'stable'}, {blocked: true}), main = h.create(), split = h.create(2);
    split.input(keys[0], 'number').value = '175'; split.input(keys[0], 'number').emit('change');
    assert.equal(h.api.read('panel2', keys[0]), 175);
    assert.equal(h.api.read('main', keys[0]), 100);
    split.destroy();
    assert.equal(h.create(2).input(keys[0]).value, '175');
    assert.equal(main.input(keys[0]).value, '100');
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.errors, []);
});
