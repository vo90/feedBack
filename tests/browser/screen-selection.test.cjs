// Standalone DOM regression checks (no backend or song library):
// node --test tests/browser/screen-selection.test.cjs
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/screen-selection.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
let browser, page;

before(async () => {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(`<style>.screen { display:none } .screen.active { display:block }</style>
        <div id="settings" class="screen active"><span id="label">Settings label</span></div>
        <div id="player" class="screen"><span id="artist">Artist</span></div>`);
    await page.evaluate(async url => {
        window.clearHiddenScreenCaret = (await import(url)).clearHiddenScreenCaret;
    }, moduleUrl);
});
afterEach(async () => { await page?.close(); });

for (const tag of ['input', 'textarea']) {
    for (const shadowDepth of [0, 2]) {
        test(`preserve focused ${tag} insertion point across navigation (shadow depth ${shadowDepth})`, async () => {
            const result = await page.evaluate(({ tag, shadowDepth }) => {
                const settings = document.getElementById('settings');
                const player = document.getElementById('player');
                let parent = settings;
                for (let i = 0; i < shadowDepth; i++) {
                    const host = document.createElement('div');
                    parent.append(host);
                    parent = host.attachShadow({ mode: 'open' });
                }
                const field = document.createElement(tag);
                field.value = 'abcdef';
                parent.append(field);
                field.focus();
                field.setSelectionRange(3, 3);
                const before = field.selectionStart;
                // Chromium can expose a parent as the document selection anchor,
                // even while the real editing caret belongs to this field.
                const cleared = clearHiddenScreenCaret(player);
                const retainedFocus = field.getRootNode().activeElement === field;
                settings.classList.remove('active');
                player.classList.add('active');
                player.classList.remove('active');
                settings.classList.add('active');
                field.focus();
                return { cleared, retainedFocus, before, after: field.selectionStart, value: field.value };
            }, { tag, shadowDepth });
            assert.deepEqual(result, { cleared: false, retainedFocus: true, before: 3, after: 3, value: 'abcdef' });
        });
    }
}

test('a blurred text field does not prevent clearing an outgoing caret', async () => {
    const result = await page.evaluate(() => {
        const field = document.createElement('input');
        field.value = 'abcdef';
        document.getElementById('settings').append(field);
        field.focus();
        field.setSelectionRange(3, 3);
        field.blur();
        const cleared = clearHiddenScreenCaret(document.getElementById('player'));
        return { cleared, ranges: getSelection().rangeCount, caret: field.selectionStart, value: field.value };
    });
    assert.deepEqual(result, { cleared: true, ranges: 0, caret: 3, value: 'abcdef' });
});

test('a focused navigation button does not block outgoing HUD caret cleanup', async () => {
    const result = await page.evaluate(() => {
        const player = document.getElementById('player');
        document.getElementById('settings').classList.remove('active');
        player.classList.add('active');
        const button = document.createElement('button');
        button.textContent = 'Settings';
        player.append(button);
        getSelection().collapse(document.getElementById('artist').firstChild, 0);
        button.focus();
        return { cleared: clearHiddenScreenCaret(document.getElementById('settings')), focus: document.activeElement === button };
    });
    assert.deepEqual(result, { cleared: true, focus: true });
});

test('preserve deliberate text selections while their screen stays visible', async () => {
    const result = await page.evaluate(() => {
        getSelection().selectAllChildren(document.getElementById('label'));
        return { cleared: clearHiddenScreenCaret(document.getElementById('settings')), text: getSelection().toString() };
    });
    assert.deepEqual(result, { cleared: false, text: 'Settings label' });
});

for (const backward of [false, true]) {
    test(`clear the captured stem-label range when leaving Settings (backward ${backward})`, async () => {
        const result = await page.evaluate(backward => {
            const label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" checked>\n            Note-gem stems (RS+)\n        ';
            document.getElementById('settings').append(label);
            const text = label.lastChild, selection = getSelection();
            selection.setBaseAndExtent(text, backward ? 18 : 17, text, backward ? 17 : 18);
            const before = selection.toString();
            const cleared = clearHiddenScreenCaret(document.getElementById('player'));
            document.getElementById('settings').classList.remove('active');
            document.getElementById('player').classList.add('active');
            return { before, cleared, ranges: selection.rangeCount, checked: label.firstChild.checked };
        }, backward);
        assert.deepEqual(result, { before: '-', cleared: true, ranges: 0, checked: true });
    });
}

test('preserve a selected range inside contenteditable', async () => {
    const result = await page.evaluate(() => {
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.textContent = 'editable text';
        document.getElementById('settings').append(editor);
        editor.focus();
        getSelection().setBaseAndExtent(editor.firstChild, 1, editor.firstChild, 5);
        return { cleared: clearHiddenScreenCaret(document.getElementById('player')), text: getSelection().toString() };
    });
    assert.deepEqual(result, { cleared: false, text: 'dita' });
});

test('preserve a range spanning different screens', async () => {
    const result = await page.evaluate(() => {
        const player = document.getElementById('player');
        player.classList.add('active');
        const label = document.getElementById('label').firstChild;
        const artist = document.getElementById('artist').firstChild;
        getSelection().setBaseAndExtent(label, 0, artist, 3);
        return { cleared: clearHiddenScreenCaret(player), ranges: getSelection().rangeCount };
    });
    assert.deepEqual(result, { cleared: false, ranges: 1 });
});
