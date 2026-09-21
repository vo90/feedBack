const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../static/js/harmony-guide-placement.js'), 'utf8');
const placementModule = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('malformed and future placements reset safely; finite coordinates stay bounded', async () => {
    const { normalizeGuidePlacement: normalize, DEFAULT_GUIDE_PLACEMENT: initial } = await placementModule;
    for (const value of [null, [], 'floating', { version: 2, mode: 'floating', x: 0, y: 0 },
        { version: 1, mode: 'floating', x: NaN, y: 0 }, { version: 1, mode: 'floating', x: '0.2', y: 0 }]) {
        assert.deepEqual(normalize(value), initial);
    }
    assert.deepEqual(normalize({ version: 1, mode: 'floating', x: -9, y: 20, enabled: false }),
        { version: 1, mode: 'floating', x: 0, y: 1 });
});

test('top dock fits between HUD sides without following a tall performance card downward', async () => {
    const { guidePanelPosition, DEFAULT_GUIDE_PLACEMENT } = await placementModule;
    const result = guidePanelPosition(DEFAULT_GUIDE_PLACEMENT, { width: 1440, height: 800 },
        { width: 730, height: 130 }, {
            left: { left: 20, right: 330, top: 16, bottom: 95 },
            right: { left: 1220, right: 1420, top: 16, bottom: 410 },
        });
    assert.equal(result.top, 16);
    assert.ok(result.left >= 342);
    assert.ok(result.left + 730 <= 1208);
});

test('narrow top dock clears HUD boxes when their central gap cannot hold the panel', async () => {
    const { guidePanelPosition, DEFAULT_GUIDE_PLACEMENT } = await placementModule;
    assert.deepEqual(guidePanelPosition(DEFAULT_GUIDE_PLACEMENT, { width: 390, height: 650 },
        { width: 366, height: 170 }, {
            left: { left: 20, right: 230, top: 16, bottom: 105 },
            right: { left: 310, right: 370, top: 16, bottom: 68 },
        }), { left: 12, top: 117 });
});

test('saved normalized position follows changed viewport and panel dimensions', async () => {
    const { guidePanelPosition, guidePlacementFromPoint } = await placementModule;
    const original = { width: 1440, height: 800 }, panel = { width: 730, height: 130 };
    const saved = guidePlacementFromPoint({ left: 350, top: 430 }, original, panel);
    assert.deepEqual(guidePanelPosition(saved, original, panel), { left: 350, top: 430 });
    const narrow = guidePanelPosition(saved, { width: 390, height: 600 }, { width: 366, height: 180 });
    assert.equal(narrow.left, 12);
    assert.ok(narrow.top >= 12 && narrow.top + 180 <= 588);
    assert.deepEqual(guidePanelPosition(saved, original, panel), { left: 350, top: 430 });
});

test('edge snapping commits exact normalized edges without snapping during motion', async () => {
    const { guidePlacementFromPoint } = await placementModule;
    const view = { width: 1000, height: 700 }, panel = { width: 400, height: 120 };
    const point = { left: 17, top: 562 };
    const moving = guidePlacementFromPoint(point, view, panel);
    assert.ok(moving.x > 0 && moving.y < 1);
    assert.deepEqual(guidePlacementFromPoint(point, view, panel, { snap: 16 }),
        { version: 1, mode: 'floating', x: 0, y: 1 });
    assert.deepEqual(guidePlacementFromPoint({ left: -100, top: 900 }, view, panel),
        { version: 1, mode: 'floating', x: 0, y: 1 });
});

test('only a release near the actual top dock restores docking', async () => {
    const { guidePlacementFromPoint, DEFAULT_GUIDE_PLACEMENT } = await placementModule;
    const view = { width: 1000, height: 700 }, panel = { width: 400, height: 120 };
    const dock = { left: 300, top: 16 };
    assert.deepEqual(guidePlacementFromPoint({ left: 323, top: 20 }, view, panel, { snap: 16, dock }), DEFAULT_GUIDE_PLACEMENT);
    assert.equal(guidePlacementFromPoint({ left: 20, top: 20 }, view, panel, { snap: 16, dock }).mode, 'floating');
    assert.equal(guidePlacementFromPoint({ left: 300, top: 500 }, view, panel, { snap: 16, dock }).mode, 'floating');
});

test('zero or undersized viewports do not produce negative coordinates or NaN', async () => {
    const { guidePlacementBounds, guidePanelPosition, guidePlacementFromPoint } = await placementModule;
    const panel = { width: 600, height: 180 };
    for (const view of [{ width: 0, height: 0 }, { width: 200, height: 60 }]) {
        assert.deepEqual(guidePlacementBounds(view, panel), { left: 0, top: 0, right: 0, bottom: 0 });
        const saved = guidePlacementFromPoint({ left: -20, top: 800 }, view, panel);
        assert.deepEqual(guidePanelPosition(saved, view, panel), { left: 0, top: 0 });
    }
});

test('placement persistence is isolated from musical preferences and local song edits', async () => {
    const { createGuidePlacementStore, GUIDE_PLACEMENT_KEY } = await placementModule;
    const musical = 'feedback.harmonicGuide.preferences.v1';
    const values = new Map([[musical, '{"enabled":true}'], ['feedback.harmonicGuide.song.v1:abc', 'reviewed']]);
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const store = createGuidePlacementStore(storage);
    assert.equal(store.save({ version: 1, mode: 'floating', x: 0.25, y: 0.75 }), true);
    assert.deepEqual(createGuidePlacementStore(storage).get(), store.get());
    assert.ok(values.has(GUIDE_PLACEMENT_KEY));
    assert.equal(values.get(musical), '{"enabled":true}');
    assert.equal(values.get('feedback.harmonicGuide.song.v1:abc'), 'reviewed');
    const returned = store.get(); returned.x = 1;
    assert.equal(store.get().x, 0.25);
});

test('broken or blocked storage retains a working session placement', async () => {
    const { createGuidePlacementStore, DEFAULT_GUIDE_PLACEMENT } = await placementModule;
    for (const storage of [null, { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } },
        { getItem() { return '{invalid'; }, setItem() { throw Error('full'); } }]) {
        const store = createGuidePlacementStore(storage);
        assert.deepEqual(store.get(), DEFAULT_GUIDE_PLACEMENT);
        const next = { version: 1, mode: 'floating', x: 0.3, y: 0.6 };
        assert.equal(store.save(next), false);
        assert.deepEqual(store.get(), next);
    }
});
