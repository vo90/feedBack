const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { cases, runCase } = require('./selection-fixture.cjs');
const { nativeCases, setupNativeSelection, verifyNativeSelection } = require('./native-selection-fixture.cjs');
const file = process.env.SELECTION_SOURCE || path.join(__dirname, '../../static/js/screen-selection.js');
const source = fs.readFileSync(file, 'utf8');
const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
let browser;
before(async () => { browser = await chromium.launch({headless:true}); });
after(async () => { await browser?.close(); });
for (const config of nativeCases) test('native shadow mouse selection: ' + Object.values(config).join(' / '), async () => {
    const page = await browser.newPage();
    try {
        await page.evaluate(async url => { window.__selectionModule = await import(url); }, url);
        const box = await page.evaluate(setupNativeSelection, config);
        await page.mouse.move(box.x + 62, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 4 });
        await page.mouse.up();
        await page.evaluate(verifyNativeSelection);
    } finally { await page.close(); }
});
for (const name of cases) test(name, async () => {
    const page = await browser.newPage();
    try {
        await page.evaluate(async url => {
            const module = await import(url);
            window.__selectionModule = module.selectionLifecycle ? module : {
                selectionLifecycle: () => ({
                    prepareToHide: () => module.clearHiddenScreenCaret(document.getElementById('player')),
                    finishVisibilityChange() {}, reconcileBeforePlayback() {}, dispose() {},
                })
            };
        }, url);
        await page.evaluate(runCase, name);
    } finally { await page.close(); }
});

for (const tag of ['input', 'textarea', 'div']) test('browser IME composition survives hiding: ' + tag, async () => {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    try {
        await page.setContent(`<section id="panel"><${tag} id="editor" ${tag === 'div' ? 'contenteditable="true"' : ''}></${tag}></section>`);
        await page.evaluate(async url => {
            window.service = (await import(url)).selectionLifecycle();
            window.events = [];
            for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input'])
                document.addEventListener(type, e => events.push({type, trusted:e.isTrusted}));
            document.getElementById('editor').focus();
        }, url);
        await cdp.send('Input.imeSetComposition', {text:'日本', selectionStart:2, selectionEnd:2});
        await page.evaluate(() => {
            service.prepareToHide(document.getElementById('panel'));
            document.getElementById('panel').hidden = true;
            service.finishVisibilityChange();
        });
        const result = await page.evaluate(() => ({
            text: document.getElementById('editor').value ?? document.getElementById('editor').textContent,
            events, ranges:getSelection().rangeCount,
        }));
        assert.equal(result.text, '日本');
        assert.equal(result.ranges, 0);
        assert.ok(result.events.some(e => e.type === 'compositionstart' && e.trusted));
        // Chromium reports isTrusted:false for the compositionend produced by
        // programmatic blur, including without the coordinator. The composition
        // itself must originate in the browser IME pipeline, not dispatchEvent.
        assert.ok(result.events.some(e => e.type === 'compositionend'));
        await page.evaluate(() => {
            document.getElementById('panel').hidden = false;
            document.getElementById('editor').focus();
        });
        await cdp.send('Input.insertText', {text:'!'});
        assert.equal(await page.evaluate(() => document.getElementById('editor').value ?? document.getElementById('editor').textContent), '日本!');
    } finally { await cdp.detach(); await page.close(); }
});

test('an email field without the selectionStart API keeps its typing position', async () => {
    const page = await browser.newPage();
    try {
        await page.setContent('<section id="panel"><input type="email" id="email" value="abcdef"></section>');
        await page.evaluate(async url => { window.service = (await import(url)).selectionLifecycle(); }, url);
        await page.locator('#email').focus();
        await page.keyboard.press('End');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
        assert.equal(await page.locator('#email').evaluate(e => e.selectionStart), null);
        await page.evaluate(() => {
            service.prepareToHide(document.getElementById('panel'));
            document.getElementById('panel').hidden = true;
            service.finishVisibilityChange();
            document.getElementById('panel').hidden = false;
        });
        await page.locator('#email').focus();
        await page.keyboard.type('!');
        assert.equal(await page.locator('#email').inputValue(), 'abc!def');
    } finally { await page.close(); }
});

test('clearing an unrelated hidden range preserves a visible email editor', async () => {
    const results = [];
    for (const cleanup of [false, true]) {
        const page = await browser.newPage();
        try {
            await page.setContent('<span id="label">Settings text</span><input type="email" id="email" value="abcdef">');
            if (cleanup) await page.evaluate(async url => { window.service = (await import(url)).selectionLifecycle(); }, url);
            await page.locator('#email').focus();
            await page.keyboard.press('End');
            for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
            await page.evaluate(cleanup => {
                const label = document.getElementById('label');
                if (cleanup) getSelection().setBaseAndExtent(label.firstChild, 3, label.firstChild, 1);
                if (cleanup) service.prepareToHide(label);
                label.hidden = true;
                if (cleanup) service.finishVisibilityChange();
            }, cleanup);
            await page.keyboard.type('!');
            results.push(await page.locator('#email').inputValue());
        } finally { await page.close(); }
    }
    assert.equal(results[0], 'abc!def', 'clean editor inserts at its original caret');
    assert.equal(results[1], results[0], 'hidden range cleanup preserves that insertion position');
});
