const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/audio-status.js'), 'utf8')
    .replace('export function', 'function') + '\ninstallAudioStatus();';

function harness({ desktop = true, initialization } = {}) {
    const calls = { screens: [], events: [] };
    const element = tag => ({ tag, children: [], textContent: '', style: {}, hidden: false, attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); child.parent = this; },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); },
    });
    const document = { body: element('body'), createElement: element, getElementById: () => ({}) };
    const window = { showScreen: screen => calls.screens.push(screen),
        dispatchEvent: event => calls.events.push(event.type),
        __feedBackDesktopAudioHooks: { initialization } };
    if (desktop) window.feedBackDesktop = { audio: {} };
    vm.runInNewContext(source, { window, document, CustomEvent: class { constructor(type) { this.type = type; } } });
    return { api: window.feedBackAudioStatus, window, document, calls };
}

test('pending startup never creates or queues either warning, including after plugin scripts loaded', () => {
    const initialization = { state: 'pending' };
    const h = harness({ initialization });
    h.api.pluginLoadFinished([{ id: 'audio_engine', status: 'ready' }]);
    for (const channel of ['input', 'output']) h.api.set(channel, { message: 'Temporary failure' });
    assert.equal(h.document.body.children.length, 0); assert.equal(h.calls.events.length, 0);
    initialization.state = 'settled';
    assert.equal(h.api.isInitializing(), false);
    assert.equal(h.document.body.children.length, 0, 'old warnings are not replayed after startup');
    h.api.set('output', { message: 'Confirmed output failure' });
    assert.equal(h.document.body.children.length, 1);
});

test('matching input/output cards stack with accessible settings and safely rendered details', () => {
    const h = harness({ initialization: { state: 'settled' } });
    h.api.set('input', { message: 'Audio input unavailable', detail: '<input failure>' });
    h.api.set('output', { message: 'Audio output unavailable', detail: '<output failure>' });
    const stack = h.document.body.children[0];
    assert.equal(h.document.body.children.length, 1); assert.equal(stack.children.length, 2);
    assert.match(stack.style.cssText, /flex-direction:column;gap:10px/);
    const [input, output] = stack.children;
    assert.equal(input.style.cssText, output.style.cssText);
    for (const card of [input, output]) {
        assert.match(card.className, /fb-audio-status/);
        assert.equal(card.attributes.role, 'status'); assert.equal(card.attributes['aria-live'], 'polite');
        assert.equal(card.children[1].textContent, 'Audio settings'); card.children[1].onclick();
        assert.equal(card.children[2].tag, 'details');
        assert.equal(card.children[2].children[0].textContent, 'Details');
    }
    assert.equal(input.children[2].children[1].textContent, '<input failure>');
    assert.equal(output.children[2].children[1].textContent, '<output failure>');
    assert.deepEqual(h.calls.screens, ['plugin-audio_engine', 'plugin-audio_engine']);
    h.document.getElementById = () => null; output.children[1].onclick();
    assert.equal(h.calls.screens.at(-1), 'settings');
});

test('updating or clearing one warning preserves the other and its expanded details', () => {
    const h = harness({ desktop: false });
    h.api.set('input', { message: 'Input', detail: 'Input detail' });
    h.api.set('output', { message: 'Output', detail: 'Output detail' });
    const stack = h.document.body.children[0], output = stack.children[1];
    output.children[2].open = true;
    h.api.set('output', { message: 'Output updated', detail: 'Updated detail' });
    h.api.setHidden('input', true); assert.equal(stack.children[0].hidden, true);
    h.api.clear('input'); assert.equal(stack.children.length, 1);
    assert.equal(stack.children[0], output); assert.equal(output.children[2].open, true);
    assert.equal(output.children[0].textContent, 'Output updated');
    h.api.clear('output'); assert.equal(h.document.body.children.length, 0);
});

test('partial plugin inventory remains pending; terminal missing or failed engine releases startup', () => {
    const h = harness(); h.api.pluginLoadFinished([]);
    assert.equal(h.api.isInitializing(), true);
    h.api.pluginStartupFinished(); assert.equal(h.api.isInitializing(), true, 'wait for final inventory');
    h.api.pluginLoadFinished([]); assert.equal(h.api.isInitializing(), false);
    assert.deepEqual(h.calls.events, ['feedback:audio-initialized']);
    h.api.pluginLoadFinished([]); assert.equal(h.calls.events.length, 1);
    const failed = harness(); failed.api.pluginLoadFinished([{ id: 'audio_engine', status: 'failed' }]);
    assert.equal(failed.api.isInitializing(), false);
});

test('an installing engine stays pending and older desktop script completion remains compatible', () => {
    const h = harness(); h.api.pluginStartupFinished();
    h.api.pluginLoadFinished([{ id: 'audio_engine', status: 'installing' }]);
    assert.equal(h.api.isInitializing(), true);
    h.api.pluginLoadFinished([{ id: 'audio_engine', status: 'ready' }]);
    assert.equal(h.api.isInitializing(), false);
});
