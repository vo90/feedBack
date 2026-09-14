const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Set LOOP_PANEL_ROOT to an earlier checkout to run the same regressions against
// its real modules and styles. The fixture replaces only the song/backend seam;
// panel rendering, dismissal, chrome behavior, HTML and CSS are production code.
const ROOT = process.env.LOOP_PANEL_ROOT || path.resolve(__dirname, '../..');

async function openFixture(page, sections = 0) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://loop-panel.test') return route.abort();
        if (url.pathname === '/') {
            const html = fs.readFileSync(path.join(ROOT, 'static/v3/index.html'), 'utf8')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<link\b[^>]*>/gi, '');
            return route.fulfill({ contentType: 'text/html', body: html });
        }
        const file = path.resolve(ROOT, `.${url.pathname}`);
        if (!file.startsWith(path.resolve(ROOT, 'static') + path.sep) || !fs.existsSync(file)) {
            return route.abort();
        }
        const type = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
        return route.fulfill({ contentType: type || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.goto('http://loop-panel.test/');
    for (const file of ['static/tailwind.min.css', 'static/style.css', 'static/v3/v3.css']) {
        await page.addStyleTag({ url: `/${file}` });
    }
    await page.evaluate(async count => {
        document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
        document.getElementById('player').classList.add('active');
        window.feedBack = { uiVersion: 'v3', currentSong: { duration: 300 } };
        let chartSections = [];
        window.highway = {
            getSections: () => chartSections,
            getNotes: () => [],
            getChords: () => [],
        };
        const practice = await import('/static/js/section-practice.js');
        const { configureHost } = await import('/static/js/host.js');
        configureHost({
            loopA: () => null,
            loopB: () => null,
            updateLoopUI: () => {},
            _cancelCountIn: () => {},
            currentFilename: () => 'fixture-song',
        });
        Object.assign(window, practice);
        window.populateSections = n => {
            chartSections = Array.from({ length: n }, (_, i) => ({ name: `Part ${String.fromCharCode(65 + i)}`, time: i * 3 }));
            practice.renderSectionPracticeBar();
        };
        window.populateSections(count);
        document.getElementById('v3-loop-indicator').hidden = false;
        // Simulate saved-loop data appearing without invoking any storage API.
        const saved = document.getElementById('saved-loops');
        saved.add(new Option('A saved chorus loop', 'fixture'));
        saved.disabled = false;
        document.getElementById('btn-loop-delete').disabled = false;
    }, sections);
    await page.addScriptTag({ url: '/static/v3/player-chrome.js' });
    expect(errors).toEqual([]);
    return errors;
}

async function expectPanelInViewport(page) {
    await expect.poll(() => page.evaluate(() => {
        const bar = document.getElementById('section-practice-bar');
        const bounds = bar.getBoundingClientRect();
        const player = document.getElementById('player').getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0
            && bounds.left >= Math.max(player.left, 0) + 7
            && bounds.right <= Math.min(player.right, innerWidth) - 7
            && bounds.top >= Math.max(player.top, 0) + 7
            && bounds.bottom <= Math.min(player.bottom, innerHeight) - 7;
    })).toBe(true);
}

test('HUD opens a visible panel, focuses it, and the second click closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openFixture(page);
    const hud = page.locator('#v3-loop-indicator-open');
    await expect(page.locator('#v3-player-rail')).toHaveCSS('opacity', '0');
    await hud.click();
    await page.mouse.move(1000, 500);
    await expect(page.locator('#v3-player-rail')).toHaveCSS('opacity', '1');
    await expect(page.locator('#btn-loop-a')).toBeFocused();
    await expect(hud).toHaveAttribute('aria-expanded', 'true');
    await hud.click();
    await expect(page.locator('#section-practice-bar')).toBeHidden();
    await expect(hud).toBeFocused();
    await expect(hud).toHaveAttribute('aria-expanded', 'false');
});

test('Escape returns to the invoking trigger; outside clicks keep their target focus', async ({ page }) => {
    await openFixture(page);
    const hud = page.locator('#v3-loop-indicator-open');
    const pill = page.locator('#section-practice-pill');
    await hud.click();
    await page.keyboard.press('Escape');
    await expect(hud).toBeFocused();
    await page.mouse.move(45, 380);
    await pill.click();
    await expect(page.locator('#btn-loop-a')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pill).toBeFocused();
    await hud.click();
    const plugins = page.locator('[data-rail="plugins"]');
    await plugins.click();
    await expect(page.locator('#section-practice-bar')).toBeHidden();
    await expect(plugins).toBeFocused();
    await expect(page.locator('#v3-rail-pop-plugins')).toBeVisible();
    // Closing the other popover on the same click must not clear practice's
    // separately owned rail-visibility flag.
    await hud.click();
    await expect(page.locator('#v3-rail-pop-plugins')).toBeHidden();
    await page.mouse.move(1000, 500);
    await expect(page.locator('#v3-player-rail')).toHaveCSS('opacity', '1');
    await expect(page.locator('#btn-loop-a')).toBeFocused();
});

test('a second HUD click closes instead of capture-dismiss reopening the panel', async ({ page }) => {
    await openFixture(page);
    const hud = page.locator('#v3-loop-indicator-open');
    await hud.click();
    await hud.click();
    await expect(page.locator('#section-practice-bar')).toBeHidden();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    for (const scale of [1, 1.5]) {
        for (const sections of [0, 50]) {
            test(`panel and all controls fit ${viewport.width}x${viewport.height}, scale ${scale}, ${sections} sections`, async ({ page }) => {
                await page.setViewportSize(viewport);
                const errors = await openFixture(page, sections);
                await page.evaluate(value => { document.documentElement.style.fontSize = `${value * 100}%`; }, scale);
                await page.locator('#v3-loop-indicator-open').click();
                await expectPanelInViewport(page);
                const controls = page.locator('#section-practice-bar').locator('button:enabled, select:enabled, input:enabled');
                const total = await controls.count();
                // Real Tab events must reach each enabled control and scroll it
                // into the visible panel, including the last section chip.
                for (let i = 0; i < total; i++) {
                    const control = controls.nth(i);
                    await expect(control).toBeFocused();
                    await expect(control).toBeInViewport({ ratio: 1 });
                    // Trial clicks check actual hit-testing without starting
                    // playback or invoking the fixture's absent backend.
                    await control.click({ trial: true });
                    if (i + 1 < total) await page.keyboard.press('Tab');
                }
                expect(errors).toEqual([]);
            });
        }
    }
}

test('open panel follows resize, scaling and newly populated section content', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openFixture(page);
    await page.locator('#v3-loop-indicator-open').click();
    await expectPanelInViewport(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
        document.documentElement.style.fontSize = '150%';
        window.populateSections(50);
    });
    await expectPanelInViewport(page);
    await page.locator('[data-parent-idx="49"]').click({ trial: true });
    await expect(page.locator('[data-parent-idx="49"]')).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await page.locator('#v3-loop-indicator-open').click();
    await expect(page.locator('#btn-loop-a')).toBeFocused();
    await expect(page.locator('#btn-loop-a')).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => window.populateSections(0));
    await expectPanelInViewport(page);
});

test('practice panel preserves the section-map hit area', async ({ page }) => {
    await openFixture(page);
    await page.evaluate(() => {
        const map = document.createElement('button');
        map.id = 'section-map';
        map.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:20px;z-index:5';
        document.getElementById('player').prepend(map);
    });
    await page.locator('#v3-loop-indicator-open').click();
    expect(await page.evaluate(() => document.elementFromPoint(10, 8)?.id)).toBe('section-map');
    await page.mouse.click(10, 8);
    await expect(page.locator('#section-practice-bar')).toBeHidden();
    await expect(page.locator('#section-map')).toBeFocused();
});
