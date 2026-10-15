const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const base = path.join(__dirname, '../..');
let browser;
before(async () => { browser = await chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });

async function setup() {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    let state = {version: 1, revision: 0, migrated: false, activeId: 'default', profiles: [{id: 'default', name: 'Default guitar', calibrations: {}}]};
    await page.route('http://guitar.test/**', async route => {
        if (!route.request().url().endsWith('/api/guitar-profiles')) {
            return route.fulfill({contentType: 'text/html', body: `<html><head></head><body style="margin:24px;background:#111827;color:#ddd;font-family:Arial">
                <main style="display:flex;gap:60px"><section style="width:420px"><h2>Audio settings</h2><div data-guitar-picker="settings"></div></section>
                <aside style="width:280px;border:1px solid #374151;border-radius:12px;padding:16px"><h3>Player audio</h3><div data-guitar-picker="player"></div></aside></main></body></html>`});
        }
        const body = route.request().postDataJSON();
        if (body) {
            if (body.expectedRevision !== state.revision) return route.fulfill({status: 409, json: {error: 'Settings changed'}});
            const p = state.profiles.find(p => p.id === (body.profileId || state.activeId));
            if (body.action === 'migrate') state.migrated = true;
            if (body.action === 'create' || body.action === 'duplicate') {
                state.activeId = 'g' + state.revision;
                state.profiles.push({id: state.activeId, name: body.name, calibrations: body.action === 'duplicate' ? structuredClone(p.calibrations) : {}});
            }
            if (body.action === 'select') state.activeId = p.id;
            if (body.action === 'rename') p.name = body.name;
            if (body.action === 'save-gain') p.calibrations[body.routeKey] = {gain: body.gain, calibrated: true};
            if (body.action === 'delete') {state.profiles = state.profiles.filter(p => p.id !== body.profileId); if (state.activeId === body.profileId) state.activeId = 'default';}
            ++state.revision;
        }
        await route.fulfill({json: state});
    });
    await page.goto('http://guitar.test/');
    await page.addStyleTag({content: fs.readFileSync(path.join(base, 'static/v3/guitar-profiles.css'), 'utf8')});
    await page.evaluate(() => {
        window.applied = []; window.launches = 0;
        window.feedBackDesktop = {audio: {
            getCurrentDevice: async () => ({input: 'Test interface', inputType: 'ASIO'}),
            getInputChannelSnapshot: async () => ({running: true, selected: 0, generation: 1}),
            setInputCalibrationGain: async gain => {window.applied.push(gain); return true;},
        }};
        window.noteDetect = {launchGuitarCalibration: () => {window.launches++;}};
        window.togglePlay = async () => {window.feedBack.isPlaying = false;};
    });
    await page.addScriptTag({path: path.join(base, 'static/guitar-profiles.js')});
    await page.addScriptTag({path: path.join(base, 'static/v3/guitar-profiles-ui.js')});
    await page.evaluate(() => window.feedBack.guitarProfiles.ready);
    return page;
}

test('Default guitar works immediately and both entry points share selection', async () => {
    const page = await setup();
    try {
        const settings = page.locator('[data-guitar-picker="settings"]');
        const player = page.locator('[data-guitar-picker="player"]');
        assert.equal(await settings.locator('select').inputValue(), 'default');
        assert.equal(await player.locator('select').inputValue(), 'default');
        assert.equal(await settings.locator('[data-guitar-delete]').isDisabled(), true);
        await player.getByRole('button', {name: 'Calibrate', exact: true}).click();
        assert.equal(await page.evaluate(() => window.launches), 1);
        await settings.getByRole('button', {name: 'Add guitar', exact: true}).click();
        await settings.locator('[data-guitar-name]').fill('Strat');
        await settings.getByRole('button', {name: 'Save', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Strat');
        assert.equal(await player.locator('select option:checked').textContent(), 'Strat');
        await page.evaluate(async () => {
            const p = window.feedBack.guitarProfiles;
            await p.saveGain(2, await p.captureContext());
            window.feedBack.isPlaying = true;
        });
        await player.locator('select').selectOption('default');
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'default');
        assert.equal(await page.evaluate(() => window.feedBack.isPlaying), false);
        assert.equal(await page.evaluate(() => window.applied.at(-1)), 1);
        const strat = await settings.locator('select option', {hasText: 'Strat'}).getAttribute('value');
        await player.locator('select').selectOption(strat);
        await page.waitForFunction(() => window.applied.at(-1) === 2);
        assert.match(await settings.locator('[data-guitar-gain]').textContent(), /\+6.0 dB/);
        if (process.env.GUITAR_PROFILE_SCREENSHOT) await page.screenshot({path: process.env.GUITAR_PROFILE_SCREENSHOT});
    } finally { await page.close(); }
});

test('names render as text, rename syncs, and deleting active guitar returns to Default', async () => {
    const page = await setup();
    try {
        const settings = page.locator('[data-guitar-picker="settings"]');
        await settings.getByRole('button', {name: 'Add guitar', exact: true}).click();
        await settings.locator('[data-guitar-name]').fill('<img src=x onerror="alert(1)">');
        await settings.getByRole('button', {name: 'Save', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId !== 'default');
        assert.equal(await page.locator('img').count(), 0);
        await settings.getByRole('button', {name: 'Rename', exact: true}).click();
        await settings.locator('[data-guitar-name]').fill('Les Paul');
        await settings.getByRole('button', {name: 'Save', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Les Paul');
        assert.equal(await page.locator('[data-guitar-picker="player"] select option:checked').textContent(), 'Les Paul');
        await settings.getByRole('button', {name: 'Delete', exact: true}).click();
        assert.equal(await settings.locator('[data-guitar-delete-name]').textContent(), 'Les Paul');
        // The confirmation keeps identifying its captured guitar even if the
        // selected instrument changes before the user confirms deletion.
        await settings.locator('select').selectOption('default');
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'default');
        assert.equal(await settings.locator('[data-guitar-delete-name]').textContent(), 'Les Paul');
        await settings.getByRole('button', {name: 'Delete guitar', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().profiles.length === 1);
        assert.equal(await settings.locator('select option').count(), 1);
    } finally { await page.close(); }
});

test('cancelled slider capture handles input failure without an unhandled rejection', async () => {
    const page = await setup();
    try {
        const settings = page.locator('[data-guitar-picker="settings"]');
        const slider = settings.locator('[data-guitar-slider]');
        await page.evaluate(() => {
            window.captureErrors = [];
            window.addEventListener('unhandledrejection', event => {window.captureErrors.push(String(event.reason));});
            window.feedBack.guitarProfiles.captureContext = () => Promise.reject(new Error('Input disconnected'));
        });
        await slider.dispatchEvent('pointerdown');
        await slider.dispatchEvent('pointercancel');
        // Give the browser a task turn to report any unhandled rejection.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
        assert.deepEqual(await page.evaluate(() => window.captureErrors), []);
        await slider.dispatchEvent('pointerdown');
        await slider.dispatchEvent('change');
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent === 'Input disconnected');
        assert.deepEqual(await page.evaluate(() => window.captureErrors), []);
    } finally { await page.close(); }
});

test('calibration can open the input setup wizard before audio input starts', async () => {
    const page = await setup();
    try {
        await page.evaluate(async () => {
            window.feedBackDesktop.audio.getInputChannelSnapshot = async () => ({running: false, selected: 0, generation: 1});
            await window.feedBack.guitarProfiles.refresh();
        });
        const settings = page.locator('[data-guitar-picker="settings"]');
        assert.equal(await settings.locator('[data-guitar-slider]').isDisabled(), true);
        assert.equal(await settings.getByRole('button', {name: 'Calibrate', exact: true}).isDisabled(), false);
        await settings.getByRole('button', {name: 'Calibrate', exact: true}).click();
        assert.equal(await page.evaluate(() => window.launches), 1);
    } finally { await page.close(); }
});

test('an in-flight slider gesture cannot save into a newly selected guitar', async () => {
    const page = await setup();
    try {
        const slider = page.locator('[data-guitar-picker="settings"] [data-guitar-slider]');
        await slider.focus();
        await slider.dispatchEvent('pointerdown');
        await page.evaluate(() => window.feedBack.guitarProfiles.create('Strat'));
        await slider.evaluate(element => {
            element.value = '6';
            element.dispatchEvent(new Event('change', {bubbles: true}));
        });
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent.includes('guitar or input changed'));
        assert.equal(await page.evaluate(() => window.feedBack.guitarProfiles.getSnapshot().gain), 1);
    } finally { await page.close(); }
});
