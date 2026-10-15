const {test} = require('node:test');
const assert = require('node:assert/strict');
const create = require('../../static/guitar-profiles.js');

function fixture(options = {}) {
    let state = options.state || {version: 1, revision: 0, migrated: false, activeId: 'default', profiles: [
        {id: 'default', name: 'Default guitar', calibrations: {}},
    ]};
    let route = {kind: 'native', key: 'interface-1', label: 'Interface · Input 1', generation: 1};
    let failWrite = false, applyHook = null;
    const applied = [], writes = [];
    const clone = value => structuredClone(value);
    const deps = {
        readLegacyGain: async () => options.legacy ?? null,
        readRoute: async () => clone(route),
        applyGain: async (gain, route) => { applied.push({gain, route}); if (applyHook) await applyHook(gain); },
        request: async body => {
            if (!body) return clone(state);
            if (failWrite) throw new Error('Could not save guitar settings.');
            assert.equal(body.expectedRevision, state.revision);
            writes.push(clone(body));
            const next = clone(state), p = next.profiles.find(p => p.id === (body.profileId || next.activeId));
            switch (body.action) {
            case 'migrate':
                next.migrated = true;
                if (body.gain != null) {
                    if (body.routeKey) p.calibrations[body.routeKey] = {gain: body.gain, calibrated: false};
                    else p.legacyGain = body.gain;
                }
                break;
            case 'bind-legacy': p.calibrations[body.routeKey] = {gain: p.legacyGain, calibrated: false}; delete p.legacyGain; break;
            case 'create': next.activeId = 'g' + next.revision; next.profiles.push({id: next.activeId, name: body.name, calibrations: {}}); break;
            case 'select': next.activeId = p.id; break;
            case 'rename': p.name = body.name; break;
            case 'save-gain': p.calibrations[body.routeKey] = {gain: body.gain, calibrated: true}; break;
            default: throw new Error('Unhandled test command');
            }
            ++next.revision; state = next; return clone(state);
        },
    };
    return {service: create(deps), deps, applied, writes, state: () => clone(state),
        route: patch => { route = {...route, ...patch}; },
        failWrite: value => { failWrite = value; }, applyHook: fn => { applyHook = fn; }};
}

test('fresh user can calibrate Default guitar without adding anything', async () => {
    const f = fixture(); await f.service.ready;
    assert.equal(f.service.getSnapshot().activeName, 'Default guitar');
    await f.service.saveGain(2.5, await f.service.captureContext());
    assert.equal(f.service.getSnapshot().gain, 2.5);
    assert.equal(f.service.getSnapshot().calibrated, true);
    assert.equal(f.state().profiles.length, 1);
    assert.equal(f.applied.at(-1).gain, 2.5);
});

test('existing gain migrates only once and restarts restore saved Default gain', async () => {
    const f = fixture({legacy: 3}); await f.service.ready;
    assert.equal(f.service.getSnapshot().gain, 3);
    await f.service.saveGain(2, await f.service.captureContext());
    const second = fixture({legacy: 5, state: f.state()}); await second.service.ready;
    assert.equal(second.service.getSnapshot().gain, 2);
    assert.equal(second.writes.length, 0);
});

test('guitar switching restores independent levels and last choice on restart', async () => {
    const f = fixture({legacy: 3}); await f.service.ready;
    await f.service.create('Les Paul'); const id = f.service.getSnapshot().activeId;
    assert.equal(f.service.getSnapshot().gain, 1);
    await f.service.saveGain(0.5, await f.service.captureContext());
    await f.service.select('default'); assert.equal(f.service.getSnapshot().gain, 3);
    await f.service.select(id); assert.equal(f.service.getSnapshot().gain, 0.5);
    const second = fixture({state: f.state()}); await second.service.ready;
    assert.equal(second.service.getSnapshot().activeId, id);
    assert.equal(second.service.getSnapshot().gain, 0.5);
});

test('new interface uses neutral gain until calibrated; previous route recalls', async () => {
    const f = fixture({legacy: 3}); await f.service.ready;
    f.route({key: 'interface-2', generation: 2}); await f.service.refresh();
    assert.equal(f.service.getSnapshot().gain, 1);
    assert.equal(f.service.getSnapshot().calibrated, false);
    await f.service.saveGain(0.5, await f.service.captureContext());
    f.route({key: 'interface-1', generation: 3}); await f.service.refresh();
    assert.equal(f.service.getSnapshot().gain, 3);
});

test('opening calibration then switching guitar cannot save to either guitar', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    await f.service.create('Strat');
    const before = f.state();
    await assert.rejects(f.service.saveGain(4, context), /guitar or input changed/);
    assert.deepEqual(f.state(), before);
});

test('same-named input reconnect invalidates calibration in progress', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    f.route({generation: 2});
    await assert.rejects(f.service.saveGain(4, context), /guitar or input changed/);
});

test('route changes during native apply cannot save stale calibration', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    f.applyHook(async value => { if (value === 4) f.route({key: 'new-route', generation: 2}); });
    await assert.rejects(f.service.saveGain(4, context), /guitar or input changed/);
    assert.equal(f.writes.filter(w => w.action === 'save-gain').length, 0);
});

test('save failure restores the old engine gain and reports failure', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    const context = await f.service.captureContext(); f.failWrite(true);
    await assert.rejects(f.service.saveGain(4, context), /Could not save/);
    assert.equal(f.applied.at(-1).gain, 2);
    assert.match(f.service.getSnapshot().error, /Could not save/);
    assert.equal(f.service.getSnapshot().gain, 2);
});

test('engine rejection is not persisted as successful calibration', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    f.applyHook(async value => { if (value === 4) throw new Error('engine unavailable'); });
    await assert.rejects(f.service.saveGain(4, context), /engine unavailable/);
    assert.equal(f.writes.filter(w => w.action === 'save-gain').length, 0);
});

test('steady route polling does not fight tone plugins with repeated writes', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    const count = f.applied.length;
    await f.service.refresh(); await f.service.refresh();
    assert.equal(f.applied.length, count);
    await f.service.rename('default', 'My guitar');
    assert.equal(f.applied.length, count);
    assert.equal(f.service.getSnapshot().applied, true);
});

test('edits made after a calibration snapshot invalidate its old recommendation', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    await f.service.saveGain(2, context);
    await assert.rejects(f.service.saveGain(4, context), /guitar or input changed/);
});

test('migration before an input starts preserves gain for the first actual route', async () => {
    const f = fixture({legacy: 3});
    f.route({kind: 'unavailable', key: '', generation: 0}); await f.service.ready;
    assert.equal(f.service.getSnapshot().activeId, 'default');
    await assert.rejects(f.service.captureContext(), /Start and select/);
    f.route({kind: 'native', key: 'new-input', generation: 1}); await f.service.refresh();
    assert.equal(f.service.getSnapshot().gain, 3);
    assert.equal(f.applied.at(-1).gain, 3);
});
