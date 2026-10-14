'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

for (const change of ['search', 'sort', 'filter']) {
test(`first cards and tab return do not wait for artist catalog; pending ${change} change`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://library.test/**', route => route.fulfill({
            contentType: 'text/html',
            body: '<main id="v3-main" style="height:800px;overflow:auto"><section id="v3-songs" class="screen active"></section></main>',
        }));
        await page.goto('http://library.test/');
        await page.evaluate(() => {
            window.calls = [];
            window.catalogResolvers = [];
            window.handlers = {};
            window.feedBack = { on(name, fn) { window.handlers[name] = fn; }, emit() {} };
            window.fetch = async url => {
                window.calls.push(url);
                const u = new URL(url, location.href);
                let data = {};
                if (u.pathname === '/api/library/providers') {
                    await new Promise(resolve => { window.releaseProviders = resolve; });
                    data = { providers: [{ id: 'local', label: 'My Library' }] };
                } else if (u.pathname === '/api/library/artists') {
                    data = await new Promise(resolve => { window.catalogResolvers.push(resolve); });
                } else if (u.pathname === '/api/library') {
                    data = { total: 1, songs: [{ filename: 'test.feedpak', title: 'First song', artist: 'Artist', arrangements: [] }] };
                }
                return { ok: true, json: async () => data };
            };
        });
        await page.addScriptTag({ path: path.join(__dirname, '../../static/v3/songs.js') });
        const enter = () => page.evaluate(() => window.handlers['screen:changed']({ detail: { id: 'v3-songs' } }));
        await enter();
        await page.waitForFunction(() => !!window.releaseProviders);
        // A tab bounce during initialization must share the pending render.
        await page.evaluate(() => window.handlers['screen:changed']({ detail: { id: 'settings' } }));
        await enter();
        await page.evaluate(() => window.releaseProviders());
        await page.waitForSelector('#v3-songs-grid [data-fn="test.feedpak"]');
        await page.waitForFunction(() => window.catalogResolvers.length === 1);
        assert.equal(await page.evaluate(() => window.calls.filter(u => u === '/api/library/providers').length), 1);
        assert.equal(await page.locator('#v3-songs-count').textContent(), '1 song');
        if (change === 'sort') {
            await page.selectOption('#v3-songs-sort', 'title');
            await page.evaluate(() => window.catalogResolvers[0]({ artists: [{ name: 'First Artist', albums: [] }], total_artists: 1 }));
            await page.waitForFunction(() => document.getElementById('v3-songs-artist').textContent.includes('First Artist'));
            assert.equal(await page.evaluate(() => window.catalogResolvers.length), 1);
            assert.deepEqual(errors, []);
            return;
        }
        if (change === 'search') {
            await page.evaluate(() => { window.v3Songs.search('new query'); });
        } else {
            await page.evaluate(() => {
                document.getElementById('v3-songs-unmatched').click();
                window.catalogResolvers[0]({ artists: [{ name: 'Stale Artist', albums: [] }], total_artists: 200 });
            });
        }
        await page.waitForFunction(() => window.catalogResolvers.length === 2);
        if (change === 'filter') {
            assert.ok(await page.evaluate(() => window.calls.some(u => u.startsWith('/api/library/artists?') && u.includes('match=unmatched'))));
        }
        await page.evaluate(() => window.catalogResolvers[1]({ artists: [{ name: 'New Artist', albums: [] }], total_artists: 1 }));
        await page.waitForFunction(() => document.getElementById('v3-songs-artist').textContent.includes('New Artist'));
        await page.evaluate(() => window.catalogResolvers[0]({ artists: [{ name: 'Stale Artist', albums: [] }], total_artists: 200 }));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
        assert.equal(await page.locator('#v3-songs-artist').textContent(), 'All artistsNew Artist');
        assert.equal(await page.evaluate(() => window.catalogResolvers.length), 2);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
}
