// Run after npm ci + playwright install chromium:
// node --test plugins/folder_library/tests/visibility.browser.test.cjs
// A real layout engine is required: an element's own class is not enough to
// detect a hidden ancestor, and a detached tree must not receive a rendered view either.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function fixture(t, surface = 'nav', visible = false) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.setContent(`<style>.hidden {display:none}</style>
      <section id="plugin-folder_library" class="hidden">
        <input id="fb-search"><button id="fb-reload"></button>
        <button id="fb-expand-all"></button><button id="fb-collapse-all"></button>
        <button id="fb-new-folder"></button><span id="fb-status"></span>
        <div id="fb-tree"></div>
      </section>
      <section id="library-parent" class="hidden">
        <input id="lib-filter"><span id="lib-count"></span>
        <div id="lib-folder-controls"></div><div id="lib-folder-tree"></div>
      </section>`);
    await page.evaluate(() => {
        window.requests = [];
        window.handlers = {};
        window.feedBack = { on: (name, fn) => { window.handlers[name] = fn; } };
        window.params = '';
        window.v3Songs = { filterParams: () => window.params };
        window.fetch = url => new Promise(resolve => {
            window.requests.push({ url, resolve: data => resolve({ ok: true, json: async () => data }) });
        });
        window.reply = (index, title = 'Fixture song') => window.requests[index].resolve({
            folders: [], root_songs: [{ filename: 'fixture.feedpak', title, artist: 'Fixture' }]
        });
        window.enterNav = () => {
            document.getElementById('plugin-folder_library').classList.remove('hidden');
            window.handlers['screen:changed']({ detail: { id: 'plugin-folder_library' } });
        };
    });
    await page.evaluate(({surface, visible}) => {
        if (surface === 'lib') document.getElementById('fb-search').remove();
        if (visible) document.getElementById(surface === 'lib' ? 'library-parent' : 'plugin-folder_library').classList.remove('hidden');
    }, {surface, visible});
    await page.addScriptTag({ path: path.join(__dirname, '..', 'screen.js') });
    return page;
}
const requests = page => page.evaluate(() => window.requests.map(r => r.url));
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));

test('an already visible embedded view still loads when its script arrives', async t => {
    const p = await fixture(t, 'lib', true);
    assert.equal((await requests(p)).length, 1);
    await p.evaluate(() => window.reply(0));
    await settle(p);
    assert.match(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
});

test('nav prefetch is preserved but hidden startup builds no song view', async t => {
    const p = await fixture(t);
    assert.equal((await requests(p)).length, 1);
    await p.evaluate(() => window.reply(0));
    await settle(p);
    assert.equal(await p.locator('#fb-tree').innerHTML(), '');
    await p.evaluate(() => window.enterNav());
    assert.match(await p.locator('#fb-tree').textContent(), /Fixture song/);
    const before = await p.locator('#fb-tree').innerHTML();
    await p.evaluate(() => window.enterNav());
    assert.equal((await requests(p)).length, 1);
    assert.equal(await p.locator('#fb-tree').innerHTML(), before);
});

test('a late nav response is cached without rendering and appears on return', async t => {
    const p = await fixture(t, 'nav', true);
    await p.evaluate(() => { document.getElementById('plugin-folder_library').classList.add('hidden'); window.reply(0); });
    await settle(p);
    assert.equal(await p.locator('#fb-tree').innerHTML(), '');
    await p.evaluate(() => window.enterNav());
    assert.equal((await requests(p)).length, 1);
    assert.match(await p.locator('#fb-tree').textContent(), /Fixture song/);
});

test('a hidden refresh supersedes the older response without rebuilding DOM', async t => {
    const p = await fixture(t, 'nav', true);
    await p.evaluate(() => {
        document.getElementById('plugin-folder_library').classList.add('hidden');
        document.getElementById('fb-reload').click(); window.reply(1, 'Fresh song');
    });
    await settle(p);
    await p.evaluate(() => window.reply(0, 'Stale song'));
    await settle(p);
    assert.equal((await requests(p)).length, 2);
    assert.equal(await p.locator('#fb-tree').innerHTML(), '');
    await p.evaluate(() => window.enterNav());
    assert.equal((await requests(p)).length, 2);
    assert.match(await p.locator('#fb-tree').textContent(), /Fresh song/);
    assert.doesNotMatch(await p.locator('#fb-tree').textContent(), /Stale song/);
});

test('embedded library defers hidden responses and refreshes changed host filters', async t => {
    const p = await fixture(t, 'lib');
    assert.equal((await requests(p)).length, 0, 'hidden ancestor prevents embedded autoload');
    await p.evaluate(() => { document.getElementById('library-parent').classList.remove('hidden'); window.folderLibrary.load(); });
    await p.evaluate(() => { document.getElementById('library-parent').classList.add('hidden'); window.reply(0); });
    await settle(p);
    assert.doesNotMatch(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
    assert.equal(await p.locator('#lib-folder-controls').innerHTML(), '');
    await p.evaluate(() => { document.getElementById('library-parent').classList.remove('hidden'); return window.folderLibrary.load(); });
    assert.equal((await requests(p)).length, 1);
    assert.match(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
    assert.match(await p.locator('#lib-count').textContent(), /1 song/);
    await p.evaluate(() => {
        document.getElementById('library-parent').classList.add('hidden');
        window.params = 'arrangement=Bass'; window.folderLibrary.load();
    });
    assert.equal((await requests(p)).length, 2);
    assert.match((await requests(p))[1], /arrangement=Bass/);
    await p.evaluate(() => window.reply(1, 'Bass song'));
    await settle(p);
    assert.doesNotMatch(await p.locator('#lib-folder-tree').textContent(), /Bass song/);
    await p.evaluate(() => { document.getElementById('library-parent').classList.remove('hidden'); return window.folderLibrary.load(); });
    assert.equal((await requests(p)).length, 2);
    assert.match(await p.locator('#lib-folder-tree').textContent(), /Bass song/);
});

test('hidden search leaves the old DOM alone and is applied on return', async t => {
    const p = await fixture(t);
    await p.evaluate(() => window.reply(0));
    await settle(p);
    await p.evaluate(() => window.enterNav());
    await settle(p);
    const before = await p.locator('#fb-tree').innerHTML();
    await p.evaluate(() => {
        document.getElementById('plugin-folder_library').classList.add('hidden');
        const search = document.getElementById('fb-search'); search.value = 'no-match'; search.dispatchEvent(new Event('input'));
    });
    assert.equal(await p.locator('#fb-tree').innerHTML(), before);
    await p.evaluate(() => window.enterNav());
    assert.match(await p.locator('#fb-tree').textContent(), /No songs match/);
    assert.equal((await requests(p)).length, 1);
});

test('detached responses build no view and a hidden failure retries on entry', async t => {
    const p = await fixture(t, 'lib', true);
    await p.evaluate(() => {
        window.savedParent = document.getElementById('library-parent'); window.savedParent.remove(); window.reply(0);
    });
    await settle(p);
    await p.evaluate(() => document.body.append(window.savedParent));
    assert.doesNotMatch(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
    await p.evaluate(() => window.folderLibrary.load());
    assert.match(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
    await p.evaluate(() => {
        window.folderLibrary.load(true);
        document.getElementById('library-parent').classList.add('hidden'); window.requests[1].resolve({ error: 'temporary' });
    });
    await settle(p);
    await p.evaluate(() => { document.getElementById('library-parent').classList.remove('hidden'); window.folderLibrary.load(); });
    assert.equal((await requests(p)).length, 3);
    await p.evaluate(() => window.reply(2));
    await settle(p);
    assert.match(await p.locator('#lib-folder-tree').textContent(), /Fixture song/);
});

test('older responses cannot replace the latest visible host filter result', async t => {
    const p = await fixture(t, 'lib', true);
    await p.evaluate(() => { window.params = 'arrangement=Bass'; window.folderLibrary.load(); });
    assert.equal((await requests(p)).length, 2);
    await p.evaluate(() => window.reply(1, 'Bass song'));
    await settle(p);
    await p.evaluate(() => window.reply(0, 'Old lead song'));
    await settle(p);
    const text = await p.locator('#lib-folder-tree').textContent();
    assert.match(text, /Bass song/);
    assert.doesNotMatch(text, /Old lead song/);
});
