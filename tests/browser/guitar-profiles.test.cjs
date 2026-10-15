const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const base = path.join(__dirname, '../..');
let browser;
before(async () => { browser = await chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });

async function setup(options = {}) {
    const page = await browser.newPage({viewport: {width: 1050, height: 1000}});
    let state = {version: 2, revision: 0, migrated: true, activeId: 'default-guitar', currentType: 'guitar', guitarRole: 'guitar-lead',
        lastSelectedByType: {guitar: 'default-guitar', bass: 'default-bass'}, profiles: [
            {id: 'default-guitar', name: 'Guitar', type: 'guitar', builtin: true, calibrations: {}},
            {id: 'default-bass', name: 'Bass', type: 'bass', builtin: true, calibrations: {}},
        ]};
    if (options.legacy) state.profiles.push({id: 'old', name: 'Old instrument', type: null, builtin: false, calibrations: {}, legacyGain: 2});
    const writes = [], settingsWrites = [];
    let game = {instrument: 'guitar', string_count: 6, tuning: 'Standard', reference_pitch: 440, pathway: 'songs', active_instrument_profile: 'guitar-lead'};
    function select(id) {
        state.activeId = id;
        const profile = state.profiles.find(p => p.id === id);
        if (profile.type) {
            state.currentType = profile.type;
            state.lastSelectedByType[profile.type] = id;
        }
    }
    await page.route('http://guitar.test/**', async route => {
        const url = new URL(route.request().url());
        const body = route.request().postDataJSON();
        if (url.pathname === '/api/settings') {
            if (body) {
                settingsWrites.push(body);
                game = {...game, ...body};
                if (body.active_instrument_profile) {
                    game.instrument = body.active_instrument_profile === 'bass' ? 'bass' : 'guitar';
                    game.string_count = game.instrument === 'bass' ? 4 : 6;
                }
            }
            return route.fulfill({json: game});
        }
        if (url.pathname === '/api/tunings') return route.fulfill({json: {tunings: {'guitar-6': {Standard: [82.41]}, 'bass-4': {Standard: [41.2]}}}});
        if (url.pathname === '/api/guitar-profiles') {
            if (body) {
                if (body.expectedRevision !== state.revision) return route.fulfill({status: 409, json: {error: 'Settings changed'}});
                writes.push(body);
                const p = state.profiles.find(p => p.id === (body.profileId || state.activeId));
                switch (body.action) {
                case 'migrate': state.migrated = true; break;
                case 'bind-legacy': p.calibrations[body.routeKey] = {gain: p.legacyGain, calibrated: false}; delete p.legacyGain; break;
                case 'create':
                case 'duplicate': {
                    const profile = {id: 'g' + state.revision, name: body.name, type: body.type || p.type, builtin: false,
                        calibrations: body.action === 'duplicate' ? structuredClone(p.calibrations) : {}};
                    if (body.calibration) profile.calibrations[body.calibration.routeKey] = {...body.calibration, calibrated: true};
                    state.profiles.push(profile); select(profile.id); break;
                }
                case 'select': select(p.id); break;
                case 'classify': p.type = body.type; select(p.id); break;
                case 'rename': p.name = body.name; break;
                case 'save-gain': p.calibrations[body.routeKey] = {gain: body.gain, calibrated: true}; break;
                case 'delete':
                    state.profiles = state.profiles.filter(profile => profile.id !== p.id);
                    if (state.activeId === p.id) select('default-' + (p.type || state.currentType));
                    if (state.lastSelectedByType[p.type] === p.id) state.lastSelectedByType[p.type] = 'default-' + p.type;
                    break;
                default: throw new Error('Unknown fixture action: ' + body.action);
                }
                if (body.guitarRole) state.guitarRole = body.guitarRole;
                ++state.revision;
            }
            return route.fulfill({json: state});
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({json: {}});
        return route.fulfill({contentType: 'text/html', body: `<html><head></head><body style="margin:24px;background:#111827;color:#ddd;font-family:Arial">
            <main style="display:flex;gap:60px"><section style="width:420px"><h2>Audio settings</h2><div data-guitar-picker="settings"></div></section>
            <aside style="width:300px"><div id="v3-badge-instrument"></div></aside></main></body></html>`});
    });
    async function boot() {
        await page.goto('http://guitar.test/');
        await page.addStyleTag({path: path.join(base, 'static/tailwind.min.css')});
        await page.addStyleTag({content: fs.readFileSync(path.join(base, 'static/v3/guitar-profiles.css'), 'utf8') + '\n.hidden {display:none} [data-inst-menu]{width:280px;padding:12px;border:1px solid #374151} [data-inst-toggle]{color:white;background:#1f2937;border-radius:12px;padding:12px}'});
        await page.evaluate(running => {
            window.applied = []; window.launches = 0; window.measured = [];
            window.inputState = {running, selected: 0, generation: 1};
            window.feedBackDesktop = {audio: {
                getCurrentDevice: async () => ({input: 'Test interface', inputType: 'ASIO'}),
                getInputChannelSnapshot: async () => ({...window.inputState}),
                setInputCalibrationGain: async gain => {window.applied.push(gain); return true;},
            }};
            window.noteDetect = {
                launchGuitarCalibration: () => {window.launches++;},
                measureInstrumentGain: async draft => {
                    window.measured.push(draft);
                    return {gain: 2, metadata: {rawPeak: 0.125, noisePeak: 0.001, measuredAt: 1234, method: 'guided-level-v1'}, context: draft.context};
                },
            };
        }, options.running !== false);
        await page.addScriptTag({type: 'module', content: fs.readFileSync(path.join(base, 'static/js/instrument-session.js'), 'utf8')});
        await page.waitForFunction(() => window.feedBack?.instrumentSession);
        await page.addScriptTag({path: path.join(base, 'static/guitar-profiles.js')});
        await page.addScriptTag({path: path.join(base, 'static/v3/guitar-profiles-ui.js')});
        await page.evaluate(() => window.feedBack.guitarProfiles.ready);
        await page.addScriptTag({path: path.join(base, 'static/v3/badges.js')});
        await page.waitForFunction(() => document.querySelector('[data-inst-toggle]'));
    }
    await boot();
    return {page, writes, settingsWrites, state: () => structuredClone(state), reload: boot};
}
const settings = page => page.locator('[data-guitar-picker="settings"]');
async function startDraft(page, {type = 'guitar', name = 'Strat', host = settings(page)} = {}) {
    await host.getByRole('button', {name: 'Add instrument', exact: true}).click();
    await host.locator('[data-guitar-new-type]').selectOption(type);
    await host.getByRole('button', {name: 'Next', exact: true}).click();
    await host.locator('[data-guitar-name]').fill(name);
    await host.getByRole('button', {name: 'Next', exact: true}).click();
    await host.locator('[data-guitar-skip]').waitFor({state: 'visible'});
}
async function saveSkipped(page, type = 'guitar', name = 'Strat') {
    const host = settings(page);
    await startDraft(page, {type, name});
    await host.getByRole('button', {name: 'Skip for now', exact: true}).click();
    await host.getByRole('button', {name: 'Save instrument', exact: true}).click();
    await page.waitForFunction(name => window.feedBack.guitarProfiles.getSnapshot().activeName === name, name);
}

test('built-in Guitar/Bass share the owner, show distinct icons, and restore independent gain', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page);
        assert.equal(await host.locator('[data-guitar-select]').inputValue(), 'default-guitar');
        assert.equal(await host.locator('[data-guitar-rename]').isDisabled(), true);
        assert.equal(await host.locator('[data-guitar-delete]').isDisabled(), true);
        assert.equal(await host.locator('[data-guitar-classify]').isDisabled(), true);
        const guitarShape = await page.locator('[data-instrument-icon]').innerHTML();
        await page.locator('[data-inst-toggle]').click();
        await page.locator('[data-pill="inst"][data-val="bass"]').click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'default-bass');
        assert.notEqual(await page.locator('[data-instrument-icon]').innerHTML(), guitarShape);
        assert.equal(await page.locator('[data-instrument-icon]').getAttribute('data-instrument-type'), 'bass');
        assert.equal(await page.locator('[data-guitar-active-label]').textContent(), 'Bass');
        await page.evaluate(async () => { const p = window.feedBack.guitarProfiles; await p.saveGain(2.5, await p.captureContext()); });
        await host.locator('[data-guitar-select]').selectOption('default-guitar');
        await page.waitForFunction(() => window.applied.at(-1) === 1);
        if (!await page.locator('[data-inst-menu]').isVisible()) await page.locator('[data-inst-toggle]').click();
        await page.locator('[data-pill="inst"][data-val="bass"]').click();
        await page.waitForFunction(() => window.applied.at(-1) === 2.5);
        assert.match(await host.locator('[data-guitar-gain]').textContent(), /\+8.0 dB/);
        assert.deepEqual(f.settingsWrites.map(w => w.active_instrument_profile), ['bass', 'guitar-lead', 'bass']);
        assert.ok(f.settingsWrites.every(w => !('instrument' in w)));
        assert.equal(fs.readFileSync(path.join(base, 'static/v3/index.html'), 'utf8').includes('data-guitar-picker="player"'), false);
    } finally { await page.close(); }
});

test('type/name/Skip remain local until final Save; typed selection survives reload', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page), applies = await page.evaluate(() => window.applied.length);
        await startDraft(page, {type: 'bass', name: 'Jazz Bass'});
        assert.equal(f.state().profiles.length, 2);
        assert.equal(f.writes.length, 0);
        assert.equal(await page.evaluate(() => window.applied.length), applies);
        await host.getByRole('button', {name: 'Skip for now', exact: true}).click();
        assert.equal(f.writes.length, 0);
        assert.match(await host.locator('[data-guitar-review]').textContent(), /Jazz Bass · Bass/);
        if (process.env.GUITAR_PROFILE_SCREENSHOT) await page.screenshot({path: process.env.GUITAR_PROFILE_SCREENSHOT});
        await host.getByRole('button', {name: 'Save instrument', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Jazz Bass');
        assert.equal(f.writes.filter(w => w.action === 'create').length, 1);
        assert.equal(f.writes.find(w => w.action === 'create').calibration, undefined);
        assert.equal(await host.locator('[data-guitar-status]').textContent(), 'Not calibrated');
        await f.reload();
        assert.equal(await page.locator('[data-guitar-active-label]').textContent(), 'Jazz Bass');
        assert.equal(await page.locator('[data-instrument-icon]').getAttribute('data-instrument-type'), 'bass');
        assert.equal(await settings(page).locator('[data-guitar-classify]').isDisabled(), true);
    } finally { await page.close(); }
});

test('calibration measurement is draft-only and final Save carries its exact result', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page), applied = await page.evaluate(() => window.applied.slice());
        await startDraft(page, {type: 'bass', name: 'P Bass'});
        await host.locator('[data-guitar-draft-calibrate]').click();
        await host.locator('[data-guitar-review-step]').waitFor({state: 'visible'});
        assert.equal(f.writes.length, 0);
        assert.deepEqual(await page.evaluate(() => window.applied), applied);
        assert.equal(await page.evaluate(() => window.measured[0].type), 'bass');
        await host.getByRole('button', {name: 'Cancel', exact: true}).click();
        assert.equal(f.state().profiles.length, 2);
        await startDraft(page, {type: 'guitar', name: 'Les Paul'});
        await host.locator('[data-guitar-draft-calibrate]').click();
        await host.getByRole('button', {name: 'Save instrument', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Les Paul');
        const created = f.writes.find(w => w.action === 'create');
        assert.equal(created.calibration.gain, 2);
        assert.equal(created.calibration.metadata.method, 'guided-level-v1');
        assert.equal(created.calibration.metadata.rawPeak, 0.125);
        assert.equal(await page.evaluate(() => window.applied.at(-1)), 2);
        assert.equal(await host.locator('[data-guitar-status]').textContent(), 'Saved');
    } finally { await page.close(); }
});

test('Cancel discards every add stage; cancelled or unavailable calibration can be skipped', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page);
        await host.locator('[data-guitar-add]').click();
        await host.locator('[data-guitar-cancel]').click();
        await host.locator('[data-guitar-add]').click();
        await host.locator('[data-guitar-new-type]').selectOption('bass');
        await host.locator('[data-guitar-submit]').click();
        await host.locator('[data-guitar-cancel]').click();
        await startDraft(page);
        await host.locator('[data-guitar-cancel]').click();
        await startDraft(page);
        await page.evaluate(() => { window.noteDetect.measureInstrumentGain = async () => null; });
        await host.locator('[data-guitar-draft-calibrate]').click();
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent.includes('Calibration cancelled'));
        await page.evaluate(() => { delete window.noteDetect.measureInstrumentGain; });
        await host.locator('[data-guitar-draft-calibrate]').click();
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent.includes('Skip for now'));
        await host.locator('[data-guitar-skip]').click();
        await host.locator('[data-guitar-cancel]').click();
        assert.equal(f.writes.length, 0);
        assert.equal(f.state().profiles.length, 2);
    } finally { await page.close(); }
});

test('a loaded paused song locks header and settings, including forced events, until teardown', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page);
        await page.locator('[data-inst-toggle]').click();
        await page.evaluate(() => { window.feedBack.isPlaying = false; window.songToken = window.feedBack.instrumentSession.beginSong(); });
        assert.equal(await page.locator('[data-inst-toggle]').isDisabled(), true);
        for (const action of ['select', 'calibrate', 'add', 'slider']) assert.equal(await host.locator(`[data-guitar-${action}]`).isDisabled(), true);
        assert.equal(await page.locator('[data-inst-menu]').isVisible(), false);
        await host.locator('[data-guitar-select]').evaluate(el => { el.value = 'default-bass'; el.dispatchEvent(new Event('change')); });
        await page.locator('[data-pill="inst"][data-val="bass"]').dispatchEvent('click');
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
        assert.equal(f.writes.length, 0);
        assert.equal(f.state().activeId, 'default-guitar');
        assert.match(await host.locator('[data-guitar-message]').textContent(), /Close the song/);
        await page.evaluate(() => window.feedBack.instrumentSession.endSong(window.songToken));
        assert.equal(await host.locator('[data-guitar-select]').isDisabled(), false);
        assert.equal(await page.locator('[data-inst-toggle]').isDisabled(), false);
    } finally { await page.close(); }
});

test('names render as text and delete confirmation retains its captured instrument', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page);
        await saveSkipped(page, 'bass', '<img src=x onerror="alert(1)">');
        assert.equal(await page.locator('img').count(), 0);
        await host.locator('[data-guitar-rename]').click();
        await host.locator('[data-guitar-name]').fill('Jazz Bass');
        await host.getByRole('button', {name: 'Save', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Jazz Bass');
        await host.locator('[data-guitar-delete]').click();
        await host.locator('[data-guitar-select]').selectOption('default-guitar');
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'default-guitar');
        assert.equal(await host.locator('[data-guitar-delete-name]').textContent(), 'Jazz Bass');
        await host.locator('[data-guitar-delete-yes]').click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().profiles.length === 2);
        assert.equal(f.writes.find(w => w.action === 'delete').profileId, 'g0');
        assert.equal(f.state().activeId, 'default-guitar');
    } finally { await page.close(); }
});

test('route changes after measurement reject final Save and retain the draft for retry', async () => {
    const f = await setup(), {page} = f;
    try {
        const host = settings(page);
        await startDraft(page);
        await host.locator('[data-guitar-draft-calibrate]').click();
        await host.locator('[data-guitar-review-step]').waitFor({state: 'visible'});
        await page.evaluate(() => { window.inputState.generation++; });
        await host.getByRole('button', {name: 'Save instrument', exact: true}).click();
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent.includes('instrument or input changed'));
        assert.equal(f.writes.length, 0);
        assert.equal(await host.locator('[data-guitar-review-step]').isVisible(), true);
        await host.locator('[data-guitar-back]').click();
        await host.locator('[data-guitar-back]').click();
        await host.locator('[data-guitar-submit]').click();
        await host.locator('[data-guitar-skip]').click();
        await host.locator('[data-guitar-submit]').click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeName === 'Strat');
    } finally { await page.close(); }
});

test('without a running input, built-in calibration can open and a draft can Skip then Save', async () => {
    const f = await setup({running: false}), {page} = f;
    try {
        const host = settings(page);
        assert.equal(await host.locator('[data-guitar-slider]').isDisabled(), true);
        assert.equal(await host.locator('[data-guitar-calibrate]').isDisabled(), false);
        await host.locator('[data-guitar-calibrate]').click();
        assert.equal(await page.evaluate(() => window.launches), 1);
        await saveSkipped(page, 'bass', 'Unplugged Bass');
        assert.equal(f.state().profiles.length, 3);
        assert.equal(f.writes.find(w => w.action === 'create').calibration, undefined);
        assert.deepEqual(await page.evaluate(() => window.applied), []);
    } finally { await page.close(); }
});

test('selecting a legacy unclassified profile asks its type once and preserves its gain', async () => {
    const f = await setup({legacy: true}), {page} = f;
    try {
        const host = settings(page);
        await host.locator('[data-guitar-select]').selectOption('old');
        assert.equal(f.state().activeId, 'default-guitar');
        assert.match(await host.locator('[data-guitar-step]').textContent(), /Choose a type for Old instrument/);
        await host.locator('[data-guitar-new-type]').selectOption('bass');
        await host.getByRole('button', {name: 'Save and select', exact: true}).click();
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'old');
        assert.equal(f.state().profiles.find(p => p.id === 'old').type, 'bass');
        assert.equal(await page.evaluate(() => window.feedBack.guitarProfiles.getSnapshot().gain), 2);
        assert.equal(await host.locator('[data-guitar-classify]').isDisabled(), true);
        await host.locator('[data-guitar-select]').selectOption('default-guitar');
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'default-guitar');
        await host.locator('[data-guitar-select]').selectOption('old');
        await page.waitForFunction(() => window.feedBack.guitarProfiles.getSnapshot().activeId === 'old');
        assert.equal(await host.locator('[data-guitar-form]').isVisible(), false);
        assert.equal(f.writes.filter(w => w.action === 'classify').length, 1);
    } finally { await page.close(); }
});

test('cancelled slider capture handles failure without an unhandled rejection', async () => {
    const f = await setup(), {page} = f;
    try {
        const slider = settings(page).locator('[data-guitar-slider]');
        await page.evaluate(() => {
            window.captureErrors = [];
            window.addEventListener('unhandledrejection', event => { window.captureErrors.push(String(event.reason)); });
            window.feedBack.guitarProfiles.captureContext = () => Promise.reject(new Error('Input disconnected'));
        });
        await slider.dispatchEvent('pointerdown');
        await slider.dispatchEvent('pointercancel');
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
        assert.deepEqual(await page.evaluate(() => window.captureErrors), []);
        await slider.dispatchEvent('pointerdown');
        await slider.dispatchEvent('change');
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent === 'Input disconnected');
        assert.deepEqual(await page.evaluate(() => window.captureErrors), []);
    } finally { await page.close(); }
});

test('a slider gesture cannot save its level into a newly selected instrument', async () => {
    const f = await setup(), {page} = f;
    try {
        const slider = settings(page).locator('[data-guitar-slider]');
        await slider.dispatchEvent('pointerdown');
        await page.evaluate(() => window.feedBack.guitarProfiles.select('default-bass'));
        await slider.evaluate(element => { element.value = '6'; element.dispatchEvent(new Event('change', {bubbles: true})); });
        await page.waitForFunction(() => document.querySelector('[data-guitar-message]').textContent.includes('instrument or input changed'));
        assert.equal(f.state().profiles[1].calibrations && Object.keys(f.state().profiles[1].calibrations).length, 0);
    } finally { await page.close(); }
});

test('header drafts survive badge rerenders and cancelling a pending measurement cannot resurrect one', async () => {
    const f = await setup(), {page} = f;
    try {
        await page.locator('[data-inst-toggle]').click();
        const host = page.locator('[data-guitar-picker="header"]');
        await startDraft(page, {type: 'bass', name: 'Five string', host});
        await page.evaluate(() => window.v3Badges.reload());
        assert.equal(await host.locator('[data-guitar-calibration-step]').isVisible(), true);
        assert.match(await host.locator('[data-guitar-draft-name]').textContent(), /Five string \(Bass\)/);
        await page.evaluate(() => { window.noteDetect.measureInstrumentGain = draft => new Promise(resolve => { window.resolveMeasurement = () => resolve({gain: 2, metadata: {}, context: draft.context}); }); });
        await host.locator('[data-guitar-draft-calibrate]').click();
        await page.waitForFunction(() => window.resolveMeasurement);
        await host.locator('[data-guitar-cancel]').click();
        await page.evaluate(() => window.resolveMeasurement());
        await page.waitForFunction(() => !document.querySelector('[data-guitar-picker="header"] [data-guitar-add]').disabled);
        assert.equal(await host.locator('[data-guitar-form]').isVisible(), false);
        assert.equal(f.writes.length, 0);
    } finally { await page.close(); }
});
