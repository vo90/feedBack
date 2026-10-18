const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootPath = path.join(__dirname, '../../static/js');
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const modelUrl = url(fs.readFileSync(path.join(rootPath, 'harmony-guide-model.js'), 'utf8'));
const controllerUrl = url(fs.readFileSync(path.join(rootPath, 'harmony-guide-controller.js'), 'utf8')
    .replaceAll("'./harmony-guide-model.js'", JSON.stringify(modelUrl)));
const settingsUrl = url(fs.readFileSync(path.join(rootPath, 'harmony-guide-settings.js'), 'utf8')
    .replaceAll("'./harmony-guide-controller.js'", JSON.stringify(controllerUrl)));
const modules = Promise.all([import(controllerUrl), import(settingsUrl)]);

function storage() {
    const values = new Map();
    return { values, blocked: false,
        getItem(key) { return values.get(key) ?? null; },
        setItem(key, value) { if (this.blocked) throw Error('Storage full'); values.set(key, value); },
    };
}

function panel() {
    const events = new Map();
    const toggle = { checked: false, disabled: true,
        addEventListener(name, fn) { events.set(name, fn); },
        removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); },
        change(value) { this.checked = value; events.get('change')?.(); },
    };
    const status = { textContent: '' };
    const root = { isConnected: true,
        querySelector(selector) { return selector === '[data-harmony-enabled]' ? toggle : status; },
    };
    return { root, toggle, status, events };
}

test('3D settings and the player use one persistent live on/off preference', async () => {
    const [controller, settings] = await modules;
    const saved = storage(), p = panel();
    const player = controller.createHarmonyGuideController(saved);
    player.setPlaybackState({ supported: true, ready: true });
    const cleanup = settings.mountHarmonyGuideSettings(p.root, saved);
    assert.equal(p.toggle.disabled, false);
    assert.equal(p.toggle.checked, false);
    p.toggle.change(true);
    assert.equal(player.options.enabled, true);
    assert.equal(controller.getHarmonyGuidePreferences(saved).enabled, true);
    player.setOptions({ enabled: false });
    assert.equal(p.toggle.checked, false, 'closing the in-game guide updates settings too');
    assert.equal(controller.createHarmonyGuideController(saved).options.enabled, false);
    cleanup();
    player.dispose?.();
});

test('the setting works before a player exists and preserves unrelated guide options', async () => {
    const [controller, settings] = await modules;
    const saved = storage(), p = panel();
    controller.setHarmonyGuidePreferences({ labelMode: 'notes', minimumBeats: 8 }, saved);
    const cleanup = settings.mountHarmonyGuideSettings(p.root, saved);
    p.toggle.change(true);
    const player = controller.createHarmonyGuideController(saved);
    assert.equal(player.options.enabled, true);
    assert.equal(player.options.minimumBeats, 8);
    assert.equal(player.options.labelMode, 'notes');
    cleanup();
    player.dispose?.();
});

test('turning off through settings cancels current-song analysis and prevents resubmission', async () => {
    const [controller, settings] = await modules;
    const saved = storage(), p = panel(), requests = [], cleared = [];
    const player = controller.createHarmonyGuideController(saved, {
        fetch: async (endpoint, options = {}) => {
            requests.push([endpoint, options.method || 'GET']);
            return { ok: true, json: async () => ({ id: 'pending-guide', status: 'running', items: [] }) };
        },
        setTimeout: () => 7, clearTimeout: id => cleared.push(id),
    });
    player.setSong({ duration: 30, harmonic_guide_revision: 'r1' }, 'test.feedpak');
    player.setPlaybackState({ supported: true, ready: true });
    assert.deepEqual(requests, [], 'off does not analyse');
    const cleanup = settings.mountHarmonyGuideSettings(p.root, saved);
    p.toggle.change(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.filter(([, method]) => method === 'POST').length, 1);
    p.toggle.change(false);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(requests.some(([endpoint, method]) => endpoint.endsWith('/pending-guide') && method === 'DELETE'));
    assert.deepEqual(cleared, [7]);
    player.setPlaybackState({ supported: true, ready: true });
    assert.equal(requests.filter(([, method]) => method === 'POST').length, 1);
    cleanup();
    player.dispose?.();
});

test('failed saves restore the checkbox and show an error; removed panels stop listening', async () => {
    const [controller, settings] = await modules;
    const saved = storage(), p = panel();
    const cleanup = settings.mountHarmonyGuideSettings(p.root, saved);
    saved.blocked = true;
    p.toggle.change(true);
    assert.equal(p.toggle.checked, false);
    assert.match(p.status.textContent, /save|storage/i);
    saved.blocked = false;
    p.root.isConnected = false;
    controller.setHarmonyGuidePreferences({ enabled: true }, saved);
    assert.equal(p.events.has('change'), false);
    cleanup();
});
