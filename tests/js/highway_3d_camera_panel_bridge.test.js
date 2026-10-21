const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = 'stableCameraStartBeforeMs';
const arrival = 'stableCameraArriveAfterMs';

// Load the complete plugin but never construct a WebGL renderer. The exported
// factory is the optional splitscreen host's public settings boundary.
function load(initial = {}, {blockReads = false, blockWrites = false} = {}) {
    const data = new Map(Object.entries(initial)), writes = [], changes = [], errors = [];
    const window = {};
    const sandbox = {window, document: {getElementById() { return null; }},
        console: {log() {}, warn() {}, error(...args) { errors.push(args); }},
        localStorage: {
            getItem(key) { if (blockReads) throw new Error('Blocked'); return data.get(key) ?? null; },
            setItem(key, value) {
                if (blockWrites) throw new Error('Blocked');
                data.set(key, String(value)); writes.push([key, String(value)]);
            },
        },
    };
    const anchor = 'window.feedBackViz_highway_3d = createFactory;';
    assert.equal(source.split(anchor).length, 2);
    vm.runInNewContext(source.replace(anchor, `${anchor}\nwindow.testPanelBridge = {
        read: _bgReadSetting, global: _bgReadGlobal, subscribe: _bgSubscribe };`), sandbox);
    const factory = window.feedBackViz_highway_3d, api = window.testPanelBridge;
    api.subscribe(key => changes.push(key));
    return {factory, api, window, data, writes, changes, errors};
}

test('panel bridge reads the same effective values as rendering, including legacy preparation', () => {
    const initial = {h3d_bg_stableCameraPreparationMs: '400',
        h3d_bg_panel0_stableCameraPreparationMs: '800',
        h3d_bg_panel1_stableCameraStartBeforeMs: '1050',
        h3d_bg_main_stableCameraPreparationMs: '900'};
    const h = load(initial);
    assert.equal(h.factory.getPanelSetting(0, start), 800);
    assert.equal(h.factory.getPanelSetting(1, start), 1050);
    assert.equal(h.factory.getPanelSetting(2, start), 400);
    for (let panel = 0; panel < 3; panel++) {
        for (const control of h.factory.panelControls) {
            assert.equal(h.factory.getPanelSetting(panel, control.key), h.api.read('panel' + panel, control.key));
        }
    }
    assert.equal(h.api.read('main', start), 900);
    assert.deepEqual(Object.fromEntries(h.data), initial);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.changes, []);
});

test('changing one panel preserves the global, main highway and every other panel', () => {
    const initial = {h3d_bg_stableCameraPreparationMs: '400',
        h3d_bg_panel0_stableCameraPreparationMs: '800',
        h3d_bg_panel2_stableCameraStartBeforeMs: '1200',
        h3d_bg_main_stableCameraStartBeforeMs: '900'};
    const h = load(initial);
    h.factory.setPanelSetting(0, start, 600);
    assert.equal(h.factory.getPanelSetting(0, start), 600);
    assert.equal(h.factory.getPanelSetting(1, start), 400);
    assert.equal(h.factory.getPanelSetting(2, start), 1200);
    assert.equal(h.api.read('main', start), 900);
    assert.equal(h.api.global(start), 400);
    assert.deepEqual(h.writes, [['h3d_bg_panel0_' + start, '600']]);
    assert.deepEqual(h.changes, [start]);
    assert.deepEqual(Object.fromEntries(h.data), {...initial, h3d_bg_panel0_stableCameraStartBeforeMs: '600'});
});

test('bridge normalizes numeric, boolean and enum edits exactly like the renderer', () => {
    const h = load();
    for (const [key, value, expected] of [
        [start, 1012, 1000], [start, -1, 25], [arrival, 9999, 3000],
        ['stableCameraExcursionThreshold', 743, 750],
        ['stableCameraFollow', false, false], ['stableCameraAutoZoom', '0', false],
        ['stableCameraAutoZoom', 'invalid', true], ['stableCameraPreset', 'angled', 'angled'],
        ['stableCameraMovementMode', 'latest-destination', 'latest-destination'],
        ['stableCameraMovementMode', 'invalid', 'reach-centres'], ['cameraMode', 'classic', 'steady'],
    ]) {
        h.factory.setPanelSetting(0, key, value);
        assert.equal(h.factory.getPanelSetting(0, key), expected, key);
        assert.equal(h.api.read('panel0', key), expected, key);
        assert.equal(h.data.get('h3d_bg_panel0_' + key), String(expected), key);
    }
    assert.deepEqual(h.errors, []);
});

test('corrupt saved values are displayed using renderer defaults without rewriting them', () => {
    const initial = {h3d_bg_panel0_stableCameraStartBeforeMs: 'bad',
        h3d_bg_panel0_stableCameraAutoZoom: 'bad', h3d_bg_panel0_stableCameraPreset: 'bad',
        h3d_bg_panel0_cameraMode: 'classic'};
    const h = load(initial);
    assert.equal(h.factory.getPanelSetting(0, start), 700);
    assert.equal(h.factory.getPanelSetting(0, 'stableCameraAutoZoom'), true);
    assert.equal(h.factory.getPanelSetting(0, 'stableCameraPreset'), 'straight');
    assert.equal(h.factory.getPanelSetting(0, 'cameraMode'), 'steady');
    assert.deepEqual(Object.fromEntries(h.data), initial);
    assert.deepEqual(h.writes, []);
});

for (const blockReads of [false, true]) {
    test(`panel edits stay live with blocked storage (${blockReads ? 'reads and writes' : 'writes only'})`, () => {
        const h = load({h3d_bg_stableCameraStartBeforeMs: '400', h3d_bg_panel0_stableCameraStartBeforeMs: '800'},
            {blockReads, blockWrites: true});
        const priorOther = h.factory.getPanelSetting(1, start), priorMain = h.api.read('main', start);
        h.factory.setPanelSetting(0, start, 600);
        assert.equal(h.factory.getPanelSetting(0, start), 600);
        assert.equal(h.api.read('panel0', start), 600);
        assert.equal(h.factory.getPanelSetting(1, start), priorOther);
        assert.equal(h.api.read('main', start), priorMain);
        h.window.h3dBgSetStableCameraStartBeforeMs(450);
        assert.equal(h.factory.getPanelSetting(0, start), 600, 'explicit pane still wins over global in-memory edit');
        assert.equal(h.factory.getPanelSetting(1, start), 450);
        assert.equal(h.api.read('main', start), 450);
        assert.deepEqual(h.writes, []);
        assert.deepEqual(h.errors, []);
    });
}

test('later global edits update inheriting panes and preserve scoped overrides', () => {
    const h = load({h3d_bg_stableCameraStartBeforeMs: '400'});
    h.factory.setPanelSetting(0, start, 600);
    h.window.h3dBgSetStableCameraStartBeforeMs(450);
    assert.equal(h.factory.getPanelSetting(0, start), 600);
    assert.equal(h.factory.getPanelSetting(1, start), 450);
    assert.equal(h.api.read('main', start), 450);
    assert.deepEqual(h.writes, [['h3d_bg_panel0_' + start, '600'], ['h3d_bg_' + start, '450']]);
});

test('bridge rejects non-panel indices and settings absent from the curated controls', () => {
    const h = load();
    for (const index of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '0', null, undefined, {}, 'main']) {
        assert.equal(h.factory.getPanelSetting(index, start), undefined);
        assert.equal(h.factory.setPanelSetting(index, start, 600), false);
    }
    for (const key of ['palette', 'customColors', 'stableCameraPreparationMs', '__proto__', 'not-a-setting', null, undefined]) {
        assert.equal(h.factory.getPanelSetting(0, key), undefined);
        assert.equal(h.factory.setPanelSetting(0, key, 'value'), false);
    }
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.changes, []);
    assert.equal(h.data.size, 0);
});
