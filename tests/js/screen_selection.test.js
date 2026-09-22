const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./test_utils');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/screen-selection.js'), 'utf8');
const session = fs.readFileSync(path.join(__dirname, '../../static/js/session.js'), 'utf8');

function fixture({ collapsed = true, owner = 'settings', editable = false, input = false, elementAnchor = false } = {}) {
    const screens = { settings: { id: 'settings' }, player: { id: 'player' } };
    const element = {
        nodeType: 1,
        isContentEditable: editable,
        closest(selector) { return selector === '.screen' ? screens[owner] : (input ? this : null); },
    };
    let clears = 0;
    const selection = {
        isCollapsed: collapsed,
        anchorNode: elementAnchor ? element : { nodeType: 3, parentElement: element },
        removeAllRanges() { clears++; this.anchorNode = null; },
    };
    const document = { getSelection: () => selection };
    const context = vm.createContext({ document });
    vm.runInContext(source.replace('export function', 'function'), context);
    return { screens, selection, document, context, clear: context.clearHiddenScreenCaret, clears: () => clears };
}

test('discard an empty caret in the Settings screen being hidden', () => {
    for (const elementAnchor of [false, true]) {
        const f = fixture({ elementAnchor });
        assert.equal(f.clear(f.screens.player), true);
        assert.equal(f.clears(), 1);
        assert.equal(f.clear(f.screens.player), false, 'repeated navigation with no caret is a no-op');
    }
});

test('preserve selected text for copying and carets in the destination screen', () => {
    for (const options of [{ collapsed: false }, { owner: 'player' }]) {
        const f = fixture(options);
        assert.equal(f.clear(f.screens.player), false);
        assert.equal(f.clears(), 0);
        assert.ok(f.selection.anchorNode);
    }
});

test('preserve editing and form-control carets', () => {
    for (const options of [{ editable: true }, { input: true }]) {
        const f = fixture(options);
        assert.equal(f.clear(f.screens.player), false);
        assert.equal(f.clears(), 0);
    }
});

test('preserve focused editing controls when the document caret belongs to a screen', () => {
    for (const control of ['input', 'textarea', 'select', '[role="textbox"]', 'contenteditable']) {
        const f = fixture();
        f.document.activeElement = {
            isContentEditable: control === 'contenteditable',
            matches: selector => selector.split(', ').includes(control),
        };
        assert.equal(f.clear(f.screens.player), false, control);
        assert.equal(f.clears(), 0);
    }
});

test('follow nested shadow-root focus before clearing a document caret', () => {
    const f = fixture();
    const input = { matches: selector => selector.split(', ').includes('input') };
    f.document.activeElement = { shadowRoot: {
        activeElement: { shadowRoot: { activeElement: input } },
    } };
    assert.equal(f.clear(f.screens.player), false);
    assert.equal(f.clears(), 0);
});

test('ignore missing selections, outside-screen anchors and missing destinations', () => {
    const outside = fixture({ owner: 'outside' });
    assert.equal(outside.clear(outside.screens.player), false);
    assert.equal(outside.clear(null), false);
    assert.equal(outside.clear(outside.screens.player, {}), false);
    assert.equal(outside.clear(outside.screens.player, { getSelection: () => null }), false);
    outside.selection.anchorNode = { nodeType: 3, parentElement: null };
    assert.equal(outside.clear(outside.screens.player), false);
    assert.equal(outside.clears(), 0);
});

test('real showScreen clears the outgoing caret before hiding screens and announcing entry', async () => {
    const f = fixture();
    const events = [];
    for (const screen of Object.values(f.screens)) {
        screen.classList = {
            remove(name) { assert.equal(name, 'active'); assert.equal(f.clears(), 1); },
            add(name) { assert.equal(name, 'active'); events.push('active:' + screen.id); },
        };
    }
    Object.assign(f.document, {
        querySelector: () => f.screens.settings,
        querySelectorAll: () => Object.values(f.screens),
        getElementById: id => f.screens[id],
    });
    Object.assign(f.context, {
        _bumpLibNavGeneration() {},
        window: {
            scrollTo() {},
            feedBack: { emit(name) { events.push(name); } },
        },
    });
    vm.runInContext(extractFunction(session, 'async function showScreen('), f.context);
    await f.context.showScreen('player');
    assert.deepEqual(events, ['screen:changing', 'active:player', 'screen:changed']);
    assert.equal(f.clears(), 1);
});
