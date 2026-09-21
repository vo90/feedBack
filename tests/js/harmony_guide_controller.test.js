const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build: buildTransport } = require('./helpers/loop-transport-harness');

// Exercise the real ES modules under the CommonJS Node suite. Only import
// URLs change; controller and validation implementations run unmodified.
const moduleRoot = path.join(__dirname, '../../static/js');
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const modelUrl = dataUrl(fs.readFileSync(path.join(moduleRoot, 'harmony-guide-model.js'), 'utf8'));
const controllerUrl = dataUrl(fs.readFileSync(path.join(moduleRoot, 'harmony-guide-controller.js'), 'utf8')
    .replaceAll("'./harmony-guide-model.js'", JSON.stringify(modelUrl)));
const uiUrl = dataUrl(fs.readFileSync(path.join(moduleRoot, 'harmony-guide-ui.js'), 'utf8')
    .replaceAll("'./harmony-guide-model.js'", JSON.stringify(modelUrl))
    .replaceAll("'./harmony-guide-controller.js'", JSON.stringify(controllerUrl)));
const controllerModule = import(controllerUrl);
const uiModule = import(uiUrl);

function memoryStorage() {
    const values = new Map();
    return {
        values, failRead: false, failWrite: false, failRemove: false,
        getItem(key) { if (this.failRead) throw new Error('Denied'); return values.get(key) ?? null; },
        setItem(key, value) { if (this.failWrite) throw new Error('Full'); values.set(key, value); },
        removeItem(key) { if (this.failRemove) throw new Error('Denied'); values.delete(key); },
    };
}
const PACK = {
    keys: [{ t: 0, key: 'Am', scale: 'natural_minor' }],
    harmony: [{ t: 0, root: 'A', quality: 'min' }, { t: 4, root: 'F', quality: 'maj' }, { t: 8, root: 'C', quality: 'maj' }],
};
const CORRECTION = {
    keys: [{ t: 0, key: 'Dm' }], harmony: [{ t: 0, root: 'D', quality: 'min' }],
};
function loadSong(controller, revision = 'revision-a', identity = 'pack:test/song', data = PACK) {
    controller.setSong({ harmonic_guide_revision: revision, arrangement: 'Lead', duration: 20 }, identity);
    controller.setKeys(data.keys); controller.setHarmony(data.harmony);
}
function context(overrides = {}) {
    return {
        supported: true, ready: true, time: 2, duration: 20,
        notes: [{ t: 0, sus: 1 }, { t: 7, sus: 1 }], chords: [],
        beats: Array.from({ length: 21 }, (_, i) => ({ time: i })),
        tuning: [0, 0, 0, 0, 0, 0], stringCount: 6, capo: 0,
        ...overrides,
    };
}
async function fixture() {
    const { createHarmonyGuideController } = await controllerModule;
    const storage = memoryStorage();
    const controller = createHarmonyGuideController(storage);
    loadSong(controller); controller.setOptions({ enabled: true });
    return { controller, storage };
}

test('degree labels are the default and label choices persist without changing the song target', async () => {
    const { createHarmonyGuideController } = await controllerModule;
    const { controller, storage } = await fixture();
    assert.equal(controller.options.labelMode, 'degrees');
    const first = controller.update(context({ time: 4.5 }));
    assert.equal(first.state.targetPc, 5);
    assert.ok(first.markers.filter(m => m.isTarget).every(m => m.degreeLabel === '♭6'));
    assert.ok(first.markers.filter(m => m.isTonic).every(m => m.degreeLabel === 'R'));
    controller.setOptions({ labelMode: 'notes' });
    const reloaded = createHarmonyGuideController(storage);
    loadSong(reloaded);
    assert.equal(reloaded.options.labelMode, 'notes');
    assert.equal(reloaded.update(context({ time: 4.5 })).state.targetPc, 5);
    reloaded.setOptions({ labelMode: 'none' });
    assert.equal(reloaded.options.showNoteNames, false);
    reloaded.setOptions({ labelMode: 'degrees' });
    assert.equal(reloaded.options.showNoteNames, true);
    storage.failWrite = true;
    assert.throws(() => reloaded.setOptions({ labelMode: 'notes' }), /Could not save/);
    assert.equal(reloaded.options.labelMode, 'degrees');
});

test('local harmony survives reload but is isolated by song identity and content revision', async () => {
    const { createHarmonyGuideController } = await controllerModule;
    const { controller, storage } = await fixture();
    const before = JSON.stringify(PACK);
    controller.saveOverride(CORRECTION);
    assert.equal(controller.hasOverride, true);
    assert.equal(controller.update(context()).state.key.label, 'D minor');
    assert.deepEqual(controller.update(context()).state.source, { key: 'local', harmony: 'local' });
    assert.equal(JSON.stringify(PACK), before);

    const reloaded = createHarmonyGuideController(storage);
    loadSong(reloaded);
    assert.equal(reloaded.options.enabled, true);
    assert.equal(reloaded.update(context()).state.key.label, 'D minor');
    reloaded.reset(); loadSong(reloaded, 'revision-b');
    assert.equal(reloaded.hasOverride, false);
    assert.equal(reloaded.update(context()).state.key.label, 'A minor');
    reloaded.reset(); loadSong(reloaded, 'revision-a', 'different-song');
    assert.equal(reloaded.hasOverride, false);
    reloaded.reset(); loadSong(reloaded);
    assert.equal(reloaded.hasOverride, true);
    reloaded.clearOverride();
    assert.equal(reloaded.hasOverride, false);
    assert.equal(reloaded.update(context()).state.key.label, 'A minor');
    assert.deepEqual(reloaded.update(context()).state.source, { key: 'feedpak', harmony: 'feedpak' });
});

test('storage failures leave previously active preferences and harmony intact', async () => {
    const { controller, storage } = await fixture();
    const options = { ...controller.options };
    storage.failWrite = true;
    assert.throws(() => controller.setOptions({ enabled: false }), /save|storage/i);
    assert.deepEqual(controller.options, options);
    assert.throws(() => controller.saveOverride(CORRECTION), /save|storage/i);
    assert.equal(controller.hasOverride, false);
    assert.equal(controller.update(context()).state.key.label, 'A minor');
    storage.failWrite = false;
    controller.saveOverride(CORRECTION);
    storage.failRemove = true;
    assert.throws(() => controller.clearOverride(), /remove/i);
    assert.equal(controller.hasOverride, true);
    assert.equal(controller.update(context()).state.key.label, 'D minor');
});

test('unavailable or malformed local storage and songs without a revision fail safely', async () => {
    const { createHarmonyGuideController } = await controllerModule;
    const storage = memoryStorage();
    storage.failRead = true;
    const controller = createHarmonyGuideController(storage);
    assert.equal(controller.options.enabled, false);
    loadSong(controller, '');
    assert.equal(controller.canSave, false);
    assert.throws(() => controller.saveOverride(CORRECTION), /unavailable/i);
    const absentStorage = createHarmonyGuideController();
    assert.throws(() => absentStorage.setOptions({ enabled: true }), /unavailable/i);
    storage.failRead = false;
    storage.values.set('feedback.harmonicGuide.preferences.v1', '{broken');
    assert.equal(createHarmonyGuideController(storage).options.enabled, false);
});

test('the guide remains gated by 3D support, readiness and the remembered opt-in preference', async () => {
    const { createHarmonyGuideController } = await controllerModule;
    const controller = createHarmonyGuideController(memoryStorage());
    loadSong(controller);
    assert.equal(controller.update(context()).enabled, false);
    controller.setOptions({ enabled: true });
    let output = controller.update(context());
    assert.equal(output.enabled, true);
    assert(output.alpha > 0);
    output = controller.update(context({ supported: false })); // Default/2D renderer.
    assert.equal(output.enabled, false);
    assert.equal(output.alpha, 0);
    output = controller.update(context({ ready: false }));
    assert.equal(output.enabled, false);
    assert.equal(output.alpha, 0);
    controller.setOptions({ enabled: false });
    assert.equal(controller.update(context()).enabled, false);
    controller.reset();
    assert.equal(controller.update(context({ ready: false })).state, null);
});

test('the permanent harmonic state follows the song during chart notes without reading player input', async () => {
    const { controller } = await fixture();
    const input = context({ time: 4.5, notes: [{ t: 0, sus: 20 }] });
    for (const name of ['detectedMidi', 'liveNotes', 'playerInput', 'microphone', 'currentNote']) {
        Object.defineProperty(input, name, { get() { throw new Error(`Must not read ${name}`); } });
    }
    const output = controller.update(input);
    assert.equal(output.enabled, true);
    assert.equal(output.state.key.label, 'A minor');
    assert.equal(output.state.scale.label, 'A natural minor');
    assert.equal(output.state.current.label, 'F');
    assert.equal(output.state.targetPc, 5);
    assert.equal(output.state.upcoming[0].label, 'C');
    assert.equal(output.nextBeats, 3.5);
    assert.equal(output.alpha, 0);
    assert(output.markers.some(marker => marker.isTarget && marker.pc === 5));
    assert(output.markers.every(marker => marker.isTonic === (marker.pc === 9)));
});

test('chart sustain and visual offset gate markers while harmony stays on the song clock', async () => {
    const { controller } = await fixture();
    const input = context({ time: 4.5, visualTime: 3.5, notes: [], chords: [
        { t: 0, notes: [{ s: 0, f: 5, sus: 4 }] }, { t: 10, notes: [{ s: 1, f: 7 }] },
    ] });
    const holding = controller.update(input);
    assert.equal(holding.state.current.label, 'F');
    assert.equal(holding.alpha, 0); // Still showing the long held chart note.
    const resting = controller.update({ ...input, visualTime: 5 });
    assert.equal(resting.state.current.label, 'F');
    assert.equal(resting.alpha, 1);
    assert.equal(resting.rest.reentryInBeats, 5);
    assert.equal(controller.update({ ...input, visualTime: 9.75 }).alpha, 0.25);
    assert.equal(controller.update({ ...input, visualTime: 10 }).alpha, 0);
});

test('difficulty, loop and tuning changes invalidate relevant prepared data and marker spelling', async () => {
    const { controller } = await fixture();
    const base = context();
    assert.equal(controller.update(base).alpha, 1);
    assert.equal(controller.update({ ...base, notes: [...base.notes, { t: 2, sus: 1 }] }).alpha, 0);
    assert.equal(controller.update(base).alpha, 1);
    const standard = controller.update(base).markers;
    const dropD = controller.update({ ...base, tuning: [-2, 0, 0, 0, 0, 0] });
    assert.notEqual(dropD.markers, standard);
    assert(dropD.markers.some(marker => marker.string === 0 && marker.fret === 0 && marker.pc === 2));
    assert.equal(dropD.positions.length, 0);
    controller.setOptions({ showPositions: false });
    assert.equal(controller.update(base).positions.length, 0);
    controller.setOptions({ showPositions: true });
    assert(controller.update(base).positions.length > 0);

    const beats = [0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
    controller.setKeys([{ t: 0, key: 'C' }]);
    controller.setHarmony([{ t: 0, root: 'C', quality: 'maj' }, { t: 3, root: 'F', quality: 'maj' }, { t: 7, root: 'G', quality: 'maj' }]);
    const looping = controller.update({ ...base, time: 7.5, beats, loop: { start: 2, end: 8 } });
    assert.equal(looping.state.upcoming[0].label, 'C');
    assert.equal(looping.nextBeats, 1);
    assert.equal(looping.nextSeconds, 0.5);
    const beforeWrap = controller.update({ ...base, time: 7.5, beats, loop: { start: 3, end: 8 } });
    assert.equal(beforeWrap.state.upcoming[0].label, 'F');
});

test('sounding open pitches follow engine bases with effective tuning and capo exactly once', async () => {
    const { guideOpenMidi } = await controllerModule;
    assert.deepEqual(guideOpenMidi({ arrangement: 'Bass' }, [], 4), [28, 33, 38, 43]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Bass' }, [], 5), [23, 28, 33, 38, 43]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Bass' }, [], 6), [40, 45, 50, 55, 59, 64]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Lead' }, [], 4), [40, 45, 50, 55]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Lead' }, [], 7), [35, 40, 45, 50, 55, 59, 64]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Lead' }, [], 8), [30, 35, 40, 45, 50, 55, 59, 64]);
    assert.deepEqual(guideOpenMidi({ arrangement: 'Lead' }, [-2, 0, 0, 0, 0, 0], 6, 2), [40, 47, 52, 57, 61, 66]);
});

test('editor accepts and normalizes a harmonically consistent progression, note targets and silence', async () => {
    const { validateGuideRows } = await uiModule;
    const rows = [{ time: '0', key: 'Am', scale: 'natural_minor' }];
    const chords = [
        { time: '0', chord: 'Am' }, { time: '4', chord: 'F' }, { time: '8', chord: 'C/E' },
        { time: '12', chord: 'G' }, { time: '16', chord: 'A note' }, { time: '18', chord: 'N.C.' },
    ];
    const result = validateGuideRows(rows, chords, 20);
    assert.deepEqual(result.errors, []);
    assert.equal(result.harmony[2].bass, 'E');
    assert.equal(result.harmony[4].root, 'A');
    assert.equal(result.harmony[4].quality == null, true);
    assert.equal(result.harmony[5].root, null);
    assert.deepEqual(validateGuideRows([], [], 20).errors, []); // Clearing a track is intentional.
});

test('editor catches contradictions throughout the timeline, including chord thirds and key-only changes', async () => {
    const { validateGuideRows } = await uiModule;
    const key = (scale = '') => [{ time: '0', key: 'Am', scale }];
    assert(validateGuideRows(key(), [{ time: '0', chord: 'E7' }], 20).errors.some(error => /disagree/i.test(error)));
    assert(validateGuideRows(key('minor_pentatonic'), [{ time: '0', chord: 'F' }], 20).errors.length > 0);
    assert(validateGuideRows(key('major'), [{ time: '0', chord: 'A note' }], 20).errors.length > 0);
    assert.deepEqual(validateGuideRows(key('harmonic_minor'), [{ time: '0', chord: 'E7' }], 20).errors, []);
    const changedKey = validateGuideRows([
        { time: '0', key: 'C', scale: 'major' }, { time: '5', key: 'F#', scale: 'major' },
    ], [{ time: '0', chord: 'C' }], 20);
    assert(changedKey.errors.some(error => /At 5/.test(error))); // No chord event at 5, still checked.
    assert(validateGuideRows([], [{ time: '0', chord: 'Csomething' }], 20).errors.length > 0);
    assert(validateGuideRows(key('imaginary'), [], 20).errors.length > 0);
});

test('editor rejects duplicate, malformed and out-of-song times while preserving event order', async () => {
    const { validateGuideRows } = await uiModule;
    const duplicates = validateGuideRows([{ time: '0', key: 'C', scale: '' }, { time: '0', key: 'Am', scale: '' }], [], 20);
    assert(duplicates.errors.some(error => /same start time/.test(error)));
    for (const time of ['-1', '21', '1:60', 'NaN', '']) {
        assert(validateGuideRows([], [{ time, chord: 'C' }], 20).errors.length > 0, time);
    }
    assert(validateGuideRows([{ time: '0', key: '<script>', scale: '' }], [], 20).errors.length > 0);
    assert(validateGuideRows([], [{ time: '0', chord: '?' }], 20).errors.length > 0);
    const sorted = validateGuideRows([{ time: '0', key: 'C', scale: '' }], [{ time: '12', chord: 'G' }, { time: '2', chord: 'C' }], 20);
    assert.deepEqual(sorted.errors, []);
    assert.deepEqual(sorted.harmony.map(event => event.t), [2, 12]);
});

test('root-only events and chord labels round-trip without introducing major triads', async () => {
    const { parseGuideChord, guideChordText, parseGuideTime, formatGuideTime } = await controllerModule;
    for (const event of [{ t: 0, root: 'A' }, { t: 0, root: 'Bb' }, { t: 0, root: 'C', quality: 'maj', bass: 'E' }, { t: 0, root: null }]) {
        const parsed = parseGuideChord(guideChordText(event), event.t);
        assert.equal(parsed.root, event.root);
        assert.equal(parsed.quality ?? null, event.quality ?? null);
        assert.equal(parsed.bass ?? null, event.bass ?? null);
    }
    assert.equal(parseGuideChord('A', 0).quality, 'maj');
    assert.equal(parseGuideTime('1:02.5'), 62.5);
    assert.equal(parseGuideTime(formatGuideTime(62.5)), 62.5);
});

test('the prepared beat clock snapshots once and counts repeated tempo regions without rereading chart objects', async () => {
    const { prepareBeatClock } = await import(modelUrl);
    let reads = 0;
    const times = [0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
    const beats = times.map(time => ({ get time() { reads++; return time; } }));
    const clock = prepareBeatClock(beats);
    const preparationReads = reads;
    assert(preparationReads > 0);
    for (let frame = 0; frame < 100; frame++) {
        assert.equal(clock.position(2.5), 2.5);
        assert.equal(clock.beatsToChange(7.5, 9, { start: 2, end: 8 }), 2);
    }
    assert.equal(reads, preparationReads);
    assert(Object.isFrozen(clock));
    assert(Object.isFrozen(clock.times));
    beats.splice(0, beats.length);
    assert.equal(clock.position(2.5), 2.5);
    assert.equal(prepareBeatClock([]).position(2.5), null);
});

test('missing tuning and enharmonic key changes keep marker data current without changing pitches', async () => {
    const { controller } = await fixture();
    assert.doesNotThrow(() => controller.update(context({ tuning: null })));
    controller.setKeys([{ t: 0, key: 'C#' }, { t: 4, key: 'Db' }]);
    controller.setHarmony([{ t: 0, root: 'C#', quality: 'maj' }, { t: 4, root: 'Db', quality: 'maj' }]);
    const before = controller.update(context({ time: 2 })).markers;
    assert.equal(before.find(marker => marker.pc === 5).note, 'E#');
    const after = controller.update(context({ time: 5 }));
    assert.equal(after.state.scale.label, 'Db major');
    assert.notEqual(after.markers, before);
    assert.equal(after.markers.find(marker => marker.pc === 5).note, 'F');
    assert.deepEqual(after.markers.map(marker => marker.midi), before.map(marker => marker.midi));
});

test('positive and negative song offsets give the editor and trailing rests the actual chart end', async () => {
    const { controller } = await fixture();
    const { validateGuideRows } = await uiModule;
    controller.setSong({ duration: 20, offset: 2, harmonic_guide_revision: 'offset-positive' }, 'song');
    assert.equal(controller.songEnd, 22);
    const trailing = controller.update(context({ time: 21, duration: controller.songEnd, notes: [], chords: [] }));
    assert(trailing.alpha > 0);
    assert.equal(trailing.rest.end, 22);
    assert.deepEqual(validateGuideRows([{ time: '0', key: 'C', scale: '' }], [{ time: '21', chord: 'C' }], controller.songEnd).errors, []);
    controller.setSong({ duration: 20, offset: -2, harmonic_guide_revision: 'offset-negative' }, 'song');
    assert.equal(controller.songEnd, 18);
    assert(validateGuideRows([], [{ time: '19', chord: 'C' }], controller.songEnd).errors.length > 0);
});

test('wrapped-state changes invalidate rest preparation without changing loop bounds', async () => {
    const { controller } = await fixture();
    controller.setOptions({ thresholdMode: 'seconds', minimumSeconds: 3 });
    const input = context({ time: 10.1, notes: [{ t: 12, sus: 1 }], loop: { start: 10, end: 20 } });
    assert.equal(controller.update(input).alpha, 0);
    assert(controller.update({ ...input, loop: { ...input.loop, hasWrapped: true } }).alpha > 0);
    assert.equal(controller.update(input).alpha, 0);
    const empty = context({ time: 12, notes: [], chords: [], loop: { start: 10, end: 20 } });
    assert(controller.update(empty).alpha > 0);
    assert.equal(controller.update(empty).rest.reentryInSeconds, null);
    assert.equal(controller.update({ ...empty, time: 20 }).rest.active, false); // Exact real song end.
});

function highwayLoopState() {
    // Evaluate the actual small public methods, not copies of their logic;
    // the rest of the highway needs a browser/GPU and is covered separately.
    const source = fs.readFileSync(path.join(moduleRoot, '../highway.js'), 'utf8');
    const start = source.indexOf('setHarmonicGuideLoop(value) {');
    const end = source.indexOf('/**', start);
    assert(start >= 0 && end > start);
    return vm.runInNewContext(`let harmonicGuideLoop = null; ({${source.slice(start, end)} getLoop() { return harmonicGuideLoop; }})`);
}

for (const juce of [false, true]) {
    test(`transport marks only completed continuous wraps and resets history on other seeks (${juce ? 'JUCE' : 'HTML5'})`, async () => {
        const h = buildTransport({ juce });
        const state = highwayLoopState();
        Object.assign(h.window.highway, state);
        state.setHarmonicGuideLoop({ start: 10, end: 20 });
        assert.equal(state.getLoop().hasWrapped, false);
        let result = await h.api._audioSeek(10, 'loop-wrap-continuous', { guard: () => false });
        assert.equal(result.completed, false);
        assert.equal(state.getLoop().hasWrapped, false);
        result = await h.api._audioSeek(10, 'loop-wrap-continuous');
        assert.equal(result.completed, true);
        assert.equal(state.getLoop().hasWrapped, true);
        state.setHarmonicGuideLoop({ start: 10, end: 20 });
        assert.equal(state.getLoop().hasWrapped, true); // A UI refresh is not a restart.
        await h.api._audioSeek(12, 'seek-by');
        assert.equal(state.getLoop().hasWrapped, false);
        await h.api._audioSeek(10, 'loop-wrap-continuous');
        await h.api._audioSeek(10, 'loop-wrap'); // Repeat with count-in.
        assert.equal(state.getLoop().hasWrapped, false);
        await h.api._audioSeek(10, 'loop-wrap-continuous');
        state.setHarmonicGuideLoop({ start: 11, end: 20 });
        assert.equal(state.getLoop().hasWrapped, false);
        state.setHarmonicGuideLoop(null);
        assert.equal(state.getLoop(), null);
    });
}

test('the real loop controller publishes a continuous wrap after seek and clears guidance on deactivation', async () => {
    const h = buildTransport();
    const state = highwayLoopState();
    Object.assign(h.window.highway, state);
    await h.api.setLoop(10, 20);
    h.api.updateLoopPreference('firstPass', 'immediate');
    h.api.updateLoopPreference('repeat', 'continuous');
    await h.api.togglePlay();
    assert.equal(state.getLoop().hasWrapped, false);
    await h.api.handleLoopBoundary(20);
    await h.advance(400);
    assert.equal(state.getLoop().hasWrapped, true);
    assert(h.calls.includes('seek:10'));
    h.api.clearLoop();
    assert.equal(state.getLoop(), null);
});
