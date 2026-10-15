const {test} = require('node:test');
const assert = require('node:assert/strict');
const create = require('../../static/guitar-profiles.js');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function sessionGate() {
    const source = fs.readFileSync(path.join(__dirname, '../../static/js/instrument-session.js'), 'utf8');
    const context = vm.createContext({window: {feedBack: {}, dispatchEvent() {}}, CustomEvent: class {}});
    vm.runInContext(source.replace(/export /g, '') + '\nglobalThis.gate = instrumentSession;', context);
    return context.gate;
}

function fixture(options = {}) {
    let state = structuredClone(options.state || {version: 2, revision: 0, migrated: false,
        activeId: 'default-guitar', currentType: 'guitar', guitarRole: options.gameRole?.startsWith('guitar-') ? options.gameRole : 'guitar-lead',
        lastSelectedByType: {guitar: 'default-guitar', bass: 'default-bass'}, profiles: [
            {id: 'default-guitar', name: 'Guitar', type: 'guitar', builtin: true, calibrations: {}},
            {id: 'default-bass', name: 'Bass', type: 'bass', builtin: true, calibrations: {}},
        ]});
    let route = {kind: 'native', key: 'interface-1', label: 'Interface · Input 1', generation: 1};
    let failWrite = false, uncertainWrite = false, applyHook = null, gameHook = null;
    let game = {active_instrument_profile: options.gameRole || state.guitarRole};
    const applied = [], writes = [], gameWrites = [], notifications = [];
    const gate = sessionGate();
    const clone = value => structuredClone(value);
    const deps = {
        session: () => gate,
        readGameContext: async () => clone(game),
        applyGameType: async (type, guitarRole) => {
            if (gameHook) await gameHook(type, guitarRole);
            game.active_instrument_profile = type === 'bass' ? 'bass' : guitarRole;
            gameWrites.push(game.active_instrument_profile);
        },
        selectionChanged: async () => {notifications.push(game.active_instrument_profile);},
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
            case 'create':
            case 'duplicate': {
                next.activeId = 'g' + next.revision;
                const levels = body.action === 'duplicate' ? clone(p.calibrations) : {};
                if (body.calibration) levels[body.calibration.routeKey] = {...clone(body.calibration), calibrated: true};
                next.profiles.push({id: next.activeId, name: body.name, type: body.type || p.type, builtin: false, calibrations: levels});
                break;
            }
            case 'select': next.activeId = p.id; break;
            case 'classify': p.type = body.type; next.activeId = p.id; break;
            case 'rename':
                if (p.builtin) throw new Error('The built-in instrument name cannot be changed.');
                p.name = body.name; break;
            case 'delete':
                if (p.builtin) throw new Error('The built-in instrument cannot be deleted.');
                next.profiles = next.profiles.filter(item => item.id !== p.id);
                if (next.activeId === p.id) next.activeId = 'default-' + (p.type || next.currentType);
                for (const type of ['guitar', 'bass']) {
                    if (next.lastSelectedByType[type] === p.id) next.lastSelectedByType[type] = 'default-' + type;
                }
                break;
            case 'save-gain': p.calibrations[body.routeKey] = {gain: body.gain, calibrated: true}; break;
            default: throw new Error('Unhandled test command');
            }
            const selected = next.profiles.find(p => p.id === next.activeId);
            if (selected.type) {
                next.currentType = selected.type;
                next.lastSelectedByType[selected.type] = selected.id;
            }
            if (body.guitarRole) next.guitarRole = body.guitarRole;
            ++next.revision; state = next;
            if (uncertainWrite) throw new Error('Response lost after save.');
            return clone(state);
        },
    };
    return {service: create(deps), deps, applied, writes, gameWrites, notifications, gate, game: () => clone(game), state: () => clone(state),
        route: patch => { route = {...route, ...patch}; },
        failWrite: value => { failWrite = value; }, uncertainWrite: value => {uncertainWrite = value;},
        gameHook: fn => {gameHook = fn;}, setGameRole: role => {game.active_instrument_profile = role;},
        applyHook: fn => { applyHook = fn; }};
}

test('fresh user can calibrate the built-in Guitar without adding anything', async () => {
    const f = fixture(); await f.service.ready;
    assert.equal(f.service.getSnapshot().activeName, 'Guitar');
    await f.service.saveGain(2.5, await f.service.captureContext());
    assert.equal(f.service.getSnapshot().gain, 2.5);
    assert.equal(f.service.getSnapshot().calibrated, true);
    assert.equal(f.state().profiles.length, 2);
    assert.equal(f.applied.at(-1).gain, 2.5);
});

test('initialization and retry stay unloaded until gain application and UI synchronization finish', async () => {
    for (const retry of [false, true]) {
        const f = fixture();
        if (retry) {
            f.applyHook(async () => {throw new Error('engine not ready');});
            await assert.rejects(f.service.ready, /engine not ready/);
            assert.equal(f.service.getSnapshot().loaded, false);
        }
        let enteredApply, finishApply, enteredSync, finishSync;
        const applying = new Promise(resolve => {enteredApply = resolve;});
        const syncing = new Promise(resolve => {enteredSync = resolve;});
        f.applyHook(() => new Promise(resolve => {finishApply = resolve; enteredApply();}));
        f.deps.selectionChanged = () => new Promise(resolve => {finishSync = resolve; enteredSync();});
        const completion = retry ? f.service.refresh() : f.service.ready;
        await applying;
        assert.equal(f.service.getSnapshot().loaded, false, 'native gain is not ready');
        finishApply();
        await syncing;
        assert.equal(f.service.getSnapshot().loaded, false, 'game UI has not adopted the selected instrument');
        finishSync();
        await completion;
        assert.equal(f.service.getSnapshot().loaded, true);
        assert.equal(f.service.getSnapshot().applied, true);
    }
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
    await f.service.select('default-guitar'); assert.equal(f.service.getSnapshot().gain, 3);
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
    await assert.rejects(f.service.saveGain(4, context), /instrument or input changed/);
    assert.deepEqual(f.state(), before);
});

test('same-named input reconnect invalidates calibration in progress', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    f.route({generation: 2});
    await assert.rejects(f.service.saveGain(4, context), /instrument or input changed/);
});

test('route changes during native apply cannot save stale calibration', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    f.applyHook(async value => { if (value === 4) f.route({key: 'new-route', generation: 2}); });
    await assert.rejects(f.service.saveGain(4, context), /instrument or input changed/);
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
    await f.service.createInstrument({type: 'guitar', name: 'Strat'});
    const count = f.applied.length;
    await f.service.refresh(); await f.service.refresh();
    assert.equal(f.applied.length, count);
    await f.service.rename(f.service.getSnapshot().activeId, 'My guitar');
    assert.equal(f.applied.length, count);
    assert.equal(f.service.getSnapshot().applied, true);
});

test('edits made after a calibration snapshot invalidate its old recommendation', async () => {
    const f = fixture(); await f.service.ready;
    const context = await f.service.captureContext();
    await f.service.saveGain(2, context);
    await assert.rejects(f.service.saveGain(4, context), /instrument or input changed/);
});

test('migration before an input starts preserves gain for the first actual route', async () => {
    const f = fixture({legacy: 3});
    f.route({kind: 'unavailable', key: '', generation: 0}); await f.service.ready;
    assert.equal(f.service.getSnapshot().activeId, 'default-guitar');
    await assert.rejects(f.service.captureContext(), /Start and select/);
    f.route({kind: 'native', key: 'new-input', generation: 1}); await f.service.refresh();
    assert.equal(f.service.getSnapshot().gain, 3);
    assert.equal(f.applied.at(-1).gain, 3);
});

test('typed selections recall independent levels and preserve the guitar rhythm role', async () => {
    const f = fixture({gameRole: 'guitar-rhythm'}); await f.service.ready;
    await f.service.createInstrument({type: 'guitar', name: 'Strat'});
    const guitar = f.service.getSnapshot().activeId;
    await f.service.saveGain(2, await f.service.captureContext());
    await f.service.createInstrument({type: 'bass', name: 'Jazz Bass'});
    const bass = f.service.getSnapshot().activeId;
    await f.service.saveGain(0.5, await f.service.captureContext());
    assert.equal(f.game().active_instrument_profile, 'bass');
    await f.service.selectType('guitar');
    assert.equal(f.service.getSnapshot().activeId, guitar);
    assert.equal(f.service.getSnapshot().gain, 2);
    assert.equal(f.game().active_instrument_profile, 'guitar-rhythm');
    await f.service.selectType('bass');
    assert.equal(f.service.getSnapshot().activeId, bass);
    assert.equal(f.service.getSnapshot().gain, 0.5);
    const restarted = fixture({state: f.state(), gameRole: 'guitar-lead'});
    await restarted.service.ready;
    assert.equal(restarted.service.getSnapshot().activeType, 'bass');
    assert.equal(restarted.game().active_instrument_profile, 'bass');
    await restarted.service.selectType('guitar');
    assert.equal(restarted.game().active_instrument_profile, 'guitar-rhythm');
});

test('selectType resolves saved choices after initialization and preceding queued creations', async () => {
    const f = fixture(); await f.service.ready;
    await f.service.createInstrument({type: 'guitar', name: 'Les Paul'});
    const guitar = f.service.getSnapshot().activeId;
    await f.service.selectType('bass');
    const restarted = fixture({state: f.state(), gameRole: 'bass'});
    await restarted.service.selectType('guitar');
    assert.equal(restarted.service.getSnapshot().activeId, guitar);
    const created = restarted.service.createInstrument({type: 'bass', name: 'Jazz Bass'});
    const selected = restarted.service.selectType('bass');
    await created; await selected;
    assert.equal(restarted.service.getSnapshot().activeName, 'Jazz Bass');
});

test('selection persistence failure restores both the original game family and gain', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    const before = f.state(); f.failWrite(true);
    await assert.rejects(f.service.selectType('bass'), /Could not save/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.game().active_instrument_profile, 'guitar-lead');
    assert.equal(f.applied.at(-1).gain, 2);
    assert.equal(f.service.getSnapshot().activeType, 'guitar');
    assert.doesNotThrow(() => f.gate.beginSong(), 'failed writes release their mutation lease');
});

test('failed family switch preserves a guitar role chosen after profile initialization', async () => {
    const f = fixture(); await f.service.ready;
    f.setGameRole('guitar-rhythm');
    f.failWrite(true);
    await assert.rejects(f.service.selectType('bass'), /Could not save/);
    assert.equal(f.game().active_instrument_profile, 'guitar-rhythm');
    assert.equal(f.service.getSnapshot().activeId, 'default-guitar');
});

test('uncertain committed selection reconciles to durable choice instead of reverting it', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    f.uncertainWrite(true);
    await assert.rejects(f.service.selectType('bass'), /Response lost/);
    assert.equal(f.state().activeId, 'default-bass');
    assert.equal(f.service.getSnapshot().activeType, 'bass');
    assert.equal(f.game().active_instrument_profile, 'bass');
    assert.equal(f.applied.at(-1).gain, 1);
});

test('an uncertain selection plus failed refetch blocks readiness until durable state can be reloaded', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    const request = f.deps.request;
    let offline = false;
    f.deps.request = async body => {
        if (!body && offline) throw new Error('offline');
        const result = await request(body);
        if (body?.action === 'select') { offline = true; throw new Error('Response lost after save.'); }
        return result;
    };
    await assert.rejects(f.service.selectType('bass'), /Response lost|offline/);
    assert.equal(f.state().activeId, 'default-bass');
    assert.equal(f.service.getSnapshot().loaded, false);
    offline = false;
    await f.service.refresh();
    assert.equal(f.service.getSnapshot().loaded, true);
    assert.equal(f.service.getSnapshot().activeId, 'default-bass');
    assert.equal(f.game().active_instrument_profile, 'bass');
    assert.equal(f.applied.at(-1).gain, 1);
});

test('game type failure does not persist a physical selection or leave its gain applied', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    const before = f.state();
    f.gameHook(async type => {if (type === 'bass') throw new Error('settings unavailable');});
    await assert.rejects(f.service.selectType('bass'), /settings unavailable/);
    assert.deepEqual(f.state(), before);
    assert.equal(f.game().active_instrument_profile, 'guitar-lead');
    assert.equal(f.applied.at(-1).gain, 2);
});

test('failed rollback blocks readiness until the selected family and gain can be restored', async () => {
    const f = fixture({legacy: 2}); await f.service.ready;
    f.failWrite(true);
    f.gameHook(async type => { if (type === 'guitar') throw new Error('settings offline'); });
    await assert.rejects(f.service.selectType('bass'), /Could not restore/);
    assert.equal(f.state().activeId, 'default-guitar');
    assert.equal(f.game().active_instrument_profile, 'bass');
    assert.equal(f.service.getSnapshot().loaded, false);
    f.failWrite(false); f.gameHook(null);
    await f.service.refresh();
    assert.equal(f.service.getSnapshot().loaded, true);
    assert.equal(f.game().active_instrument_profile, 'guitar-lead');
    assert.equal(f.applied.at(-1).gain, 2);
});

test('queued mutations hold a song-start lease until all saves finish', async () => {
    const f = fixture(); await f.service.ready;
    let resume, entered;
    const waiting = new Promise(resolve => {entered = resolve;});
    f.gameHook(() => new Promise(resolve => {resume = resolve; entered();}));
    const change = f.service.selectType('bass');
    assert.throws(() => f.gate.beginSong(), /Finish saving or calibrating/);
    await waiting;
    assert.throws(() => f.gate.beginSong(), /Finish saving or calibrating/);
    resume(); await change;
    assert.doesNotThrow(() => f.gate.beginSong());
});

test('locked sessions reject selection, creation, metadata edits and gain writes', async () => {
    const f = fixture(); await f.service.ready;
    await f.service.createInstrument({type: 'guitar', name: 'Strat'});
    const id = f.service.getSnapshot().activeId, context = await f.service.captureContext(), before = f.state();
    f.service.watchSession();
    const observed = []; f.service.subscribe(s => observed.push(s.locked));
    const token = f.gate.beginSong();
    assert.equal(f.service.getSnapshot().locked, true);
    for (const action of [
        () => f.service.selectType('bass'), () => f.service.createInstrument({type: 'bass', name: 'Bass'}),
        () => f.service.rename(id, 'Changed'), () => f.service.duplicate(id, 'Copy'),
        () => f.service.remove(id), () => f.service.saveGain(3, context),
    ]) await assert.rejects(action(), /Leave the current song/);
    assert.deepEqual(f.state(), before);
    f.gate.endSong(token);
    assert.deepEqual(observed, [true, false]);
});

test('draft creation with Skip leaves neutral gain and does not inherit the previous instrument calibration', async () => {
    const f = fixture({legacy: 4}); await f.service.ready;
    const context = await f.service.captureDraftContext('bass');
    const before = f.state();
    assert.deepEqual(f.state(), before, 'opening the draft creates no durable instrument');
    await f.service.createInstrument({type: 'bass', name: 'Skipped Bass'}, context);
    const saved = f.service.getSnapshot();
    assert.equal(saved.activeType, 'bass');
    assert.equal(saved.gain, 1);
    assert.equal(saved.calibrated, false);
    assert.equal(f.applied.at(-1).gain, 1);
});

test('draft calibration saves exactly the measured route and gain', async () => {
    const f = fixture({legacy: 4}); await f.service.ready;
    const context = await f.service.captureDraftContext('bass');
    await f.service.createInstrument({type: 'bass', name: 'Measured Bass', calibration: {
        gain: 0.6, context, metadata: {method: 'guided-level-v1', rawPeak: 0.4},
    }}, context);
    assert.equal(f.service.getSnapshot().gain, 0.6);
    assert.equal(f.service.getSnapshot().calibrated, true);
    const created = f.writes.find(w => w.action === 'create');
    assert.equal(created.calibration.routeKey, 'interface-1');
    assert.equal(created.calibration.metadata.method, 'guided-level-v1');
});

test('draft measurements reject route reconnects, wrong type, changed selection and invalid gain', async () => {
    for (const cause of ['route', 'type', 'selection', 'gain']) {
        const f = fixture(); await f.service.ready;
        const context = await f.service.captureDraftContext('bass');
        if (cause === 'route') f.route({generation: 2});
        if (cause === 'selection') await f.service.selectType('bass');
        const before = f.state();
        const draft = {type: cause === 'type' ? 'guitar' : 'bass', name: 'Draft', calibration: {context, gain: cause === 'gain' ? 20 : 2}};
        await assert.rejects(f.service.createInstrument(draft, context), /changed|between 0.1 and 5/);
        assert.deepEqual(f.state(), before);
    }
});

test('draft measurement requires a route and skip accepts starting input after opening the draft', async () => {
    const f = fixture({legacy: 3});
    f.route({kind: 'unavailable', key: '', generation: 0}); await f.service.ready;
    const draft = await f.service.captureDraftContext('guitar');
    await assert.rejects(f.service.createInstrument({type: 'guitar', name: 'Invalid', calibration: {context: draft, gain: 2}}, draft), /Start and select/);
    f.route({kind: 'native', key: 'connected', generation: 1});
    await f.service.createInstrument({type: 'guitar', name: 'Skipped'}, draft);
    assert.equal(f.service.getSnapshot().gain, 1);
    assert.equal(f.service.getSnapshot().calibrated, false);
});

test('classifying an imported untyped instrument selects it and preserves its levels', async () => {
    const f = fixture(); await f.service.ready;
    const state = f.state();
    state.profiles.push({id: 'imported', name: 'Old instrument', type: null, builtin: false,
        calibrations: {'interface-1': {gain: 3, calibrated: true}}});
    const migrated = fixture({state}); await migrated.service.ready;
    await assert.rejects(migrated.service.select('imported'), /Choose Guitar or Bass/);
    await migrated.service.classify('imported', 'bass');
    assert.equal(migrated.service.getSnapshot().activeId, 'imported');
    assert.equal(migrated.service.getSnapshot().activeType, 'bass');
    assert.equal(migrated.service.getSnapshot().gain, 3);
    assert.equal(migrated.game().active_instrument_profile, 'bass');
});

test('deleting the selected custom bass falls back to built-in Bass, retaining Guitar choice', async () => {
    const f = fixture(); await f.service.ready;
    await f.service.createInstrument({type: 'guitar', name: 'Strat'});
    const guitar = f.service.getSnapshot().activeId;
    await f.service.createInstrument({type: 'bass', name: 'Jazz'});
    await f.service.remove(f.service.getSnapshot().activeId);
    assert.equal(f.service.getSnapshot().activeId, 'default-bass');
    assert.equal(f.game().active_instrument_profile, 'bass');
    await f.service.selectType('guitar');
    assert.equal(f.service.getSnapshot().activeId, guitar);
});
