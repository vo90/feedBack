const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./test_utils');

const gateSource = fs.readFileSync(path.join(__dirname, '../../static/js/instrument-session.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(__dirname, '../../static/js/session.js'), 'utf8');

function createGate() {
    const context = vm.createContext({
        window: { feedBack: {}, dispatchEvent() {} }, CustomEvent: class {},
    });
    vm.runInContext(gateSource.replace(/export /g, '') + '\nglobalThis.gate = instrumentSession;', context);
    return context.gate;
}

function sessionHarness(gate = createGate()) {
    const events = [], alerts = [];
    let active = 'library';
    const audio = { src: '', pause() {}, currentTime: 0 };
    const elements = Object.fromEntries(['library', 'player', 'quality-select', 'min-scale-select', 'highway'].map(id => [id, {
        id, value: '', classList: { add() { active = id; }, remove() {} },
    }]));
    elements.audio = audio;
    const context = vm.createContext({
        instrumentSession: gate, S: {songLoadGeneration: 0}, audio,
        console: {log() {}}, URLSearchParams, location: {protocol: 'http:', host: 'test'},
        setTimeout: fn => { fn(); },
        document: {
            querySelector: () => elements[active],
            querySelectorAll: () => [elements.library, elements.player],
            getElementById: id => elements[id] || null,
        },
        window: {
            alert: message => alerts.push(message), scrollTo() {},
            feedBack: { isPlaying: false, currentSong: {filename: 'stale.sloppak'},
                emit(event) { events.push([event, gate.isLocked()]); } },
            highway: { stop() {}, init() {}, connect() {}, getRenderScale: () => 1 },
        },
        selectionLifecycle: () => ({prepareToHide() {}, finishVisibilityChange() {}}),
        _resolvePlayerOrigin: () => 'library', _getArrangementNamingMode: () => 'smart',
        _audioTime: () => 0, _songEventPayload: () => ({}),
        jucePlayer: {stop: async () => {}}, artAbortController: null,
        ...Object.fromEntries([
            '_clearAutoplayHold', '_recordPlaybackBridge', '_cancelCountIn', '_resetJuceAudioShimChain',
            '_resetAudioSeekState', 'setPlayButtonState', '_resetPlaybackSpeedForNewSong', 'clearLoop',
            '_resetSectionPracticeLog', '_hideSectionPracticeBar', '_clearAutoExit', '_bumpLibNavGeneration',
            '_scheduleSectionPracticeRetries', 'loadSavedLoops', '_snapshotResumeSession',
        ].map(name => [name, () => {}])),
    });
    vm.runInContext(extractFunction(sessionSource, 'async function showScreen(') + '\n' +
        extractFunction(sessionSource, 'async function playSong('), context);
    return {gate, context, events, alerts, get active() {return active;}};
}

test('a mutation lease prevents song entry until its idempotent release', () => {
    const gate = createGate(), release = gate.acquireMutation();
    assert.throws(() => gate.beginSong(), /Finish saving or calibrating/);
    assert.equal(gate.isLocked(), false);
    release(); release();
    const second = gate.acquireMutation();
    assert.throws(() => gate.beginSong(), /Finish saving or calibrating/);
    second();
    gate.beginSong();
    assert.throws(() => gate.acquireMutation(), /Leave the current song/);
});

test('stale teardown cannot unlock a newer song, and subscriptions are removable', () => {
    const gate = createGate(), seen = [];
    const unsubscribe = gate.subscribe(value => seen.push(value));
    const first = gate.beginSong(), second = gate.beginSong();
    gate.endSong(first);
    assert.equal(gate.isLocked(), true);
    gate.endSong(second);
    assert.deepEqual(seen, [true, true, false]);
    unsubscribe(); gate.beginSong();
    assert.deepEqual(seen, [true, true, false]);
});

test('playSong locks before loading notification and stays locked when paused or ended', async () => {
    const h = sessionHarness();
    await h.context.playSong('test.sloppak');
    assert.deepEqual(h.events.find(([event]) => event === 'song:loading'), ['song:loading', true]);
    assert.equal(h.active, 'player');
    for (const event of ['song:ready', 'song:pause', 'song:ended']) {
        h.context.window.feedBack.emit(event);
        assert.equal(h.gate.isLocked(), true, event);
        assert.throws(() => h.gate.acquireMutation(), /Leave the current song/);
    }
});

test('playSong denied during a profile mutation changes no song or screen state', async () => {
    const h = sessionHarness(), release = h.gate.acquireMutation();
    await h.context.playSong('test.sloppak');
    assert.equal(h.active, 'library');
    assert.equal(h.context.S.songLoadGeneration, 0);
    assert.deepEqual(h.events, []);
    assert.match(h.alerts[0], /Finish saving or calibrating/);
    release();
});

for (const state of [{loaded: false, busy: false}, {loaded: true, busy: true}]) {
    test('playSong waits for initialized and idle instrument settings: ' + JSON.stringify(state), async () => {
        const h = sessionHarness();
        h.context.window.feedBack.guitarProfiles = {getSnapshot: () => state};
        await h.context.playSong('test.sloppak');
        assert.equal(h.active, 'library');
        assert.equal(h.gate.isLocked(), false);
        assert.equal(h.context.S.songLoadGeneration, 0);
        assert.deepEqual(h.events, []);
        assert.match(h.alerts[0], /still loading or being saved/);
    });
}

test('leaving paused native playback unlocks only after stop completes despite stale currentSong', async () => {
    const h = sessionHarness();
    await h.context.playSong('test.sloppak');
    h.context.window._juceMode = true;
    let finish;
    h.context.jucePlayer.stop = () => new Promise(resolve => {finish = resolve;});
    const exiting = h.context.showScreen('library');
    assert.equal(h.gate.isLocked(), true);
    finish(); await exiting;
    assert.equal(h.gate.isLocked(), false);
    assert.equal(h.context.window.feedBack.currentSong.filename, 'stale.sloppak');
});

test('a failed load before entering the player releases its lock', async () => {
    const h = sessionHarness();
    h.context.window.highway.stop = () => {throw new Error('device failed');};
    await assert.rejects(h.context.playSong('test.sloppak'), /device failed/);
    assert.equal(h.gate.isLocked(), false);
});

test('an error inside the player stays locked until the user leaves', async () => {
    const h = sessionHarness();
    h.context.window.highway.connect = () => {throw new Error('chart failed');};
    await assert.rejects(h.context.playSong('test.sloppak'), /chart failed/);
    assert.equal(h.gate.isLocked(), true);
    await h.context.showScreen('library');
    assert.equal(h.gate.isLocked(), false);
});
