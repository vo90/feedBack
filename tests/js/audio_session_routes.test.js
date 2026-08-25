const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    loadAudioSession,
    runBrowserScript,
    installMixerDom,
    installDeterministicTimers,
    captureEvents,
} = require('./audio_session_test_harness');

test('audio session records route transitions without blocking callers', () => {
    const window = loadAudioSession();
    const audioSession = window.feedBack.audioSession;

    const html5 = audioSession.setRoute({ routeKind: 'html5', availability: 'available', selectedByUser: true });
    const stems = audioSession.setRoute({ routeKind: 'stems', availability: 'available', selectedByUser: true });
    const juce = audioSession.setRoute({ routeKind: 'juce', availability: 'degraded', fallbackReason: 'native route unavailable' });
    const snapshot = audioSession.snapshot();

    assert.equal(html5.routeKind, 'html5');
    assert.equal(stems.routeKind, 'stems');
    assert.equal(juce.availability, 'degraded');
    assert.equal(snapshot.domains['audio-mix'].route.routeKind, 'juce');
    assert.equal(snapshot.recentOutcomes.at(-1).outcome, 'degraded');
});

test('legacy song fader registration is bridged into audio-mix participants and route diagnostics', async () => {
    const window = loadAudioSession();
    const { audio } = installMixerDom(window);
    window.localStorage.setItem('volume', '65');

    runBrowserScript(window, 'static/audio-mixer.js');
    assert.equal(typeof window.feedBack.audio.applySongVolume, 'function');

    await window.feedBack.audio.applySongVolume(72);
    const snapshot = window.feedBack.audioSession.snapshot();
    const songParticipant = snapshot.domains['audio-mix'].participants.find(p => p.participantId === 'core.song');

    assert.equal(audio.volume, 0.72);
    assert.equal(songParticipant.label, 'Song');
    assert.equal(songParticipant.fader.currentValue, 72);
    assert.equal(snapshot.domains['audio-mix'].route.routeKind, 'html5');
    assert.equal(snapshot.domains['audio-mix'].bridges.some(b => b.bridgeId === 'audio-mix.song-volume'), true);
});

test('song volume persists through html5 stems and desktop routes', async () => {
    const window = loadAudioSession();
    const { audio } = installMixerDom(window);
    const stemsCalls = [];
    const desktopCalls = [];
    window.localStorage.setItem('volume', '41');
    window.feedBack.stems = { setMasterVolume(value) { stemsCalls.push(value); return Promise.resolve(); } };
    window.feedBackDesktop = { audio: { setGain(name, value) { desktopCalls.push([name, value]); return Promise.resolve(); } } };

    runBrowserScript(window, 'static/audio-mixer.js');
    assert.equal(window.feedBack.audio.readSongVolume(), 41);

    await window.feedBack.audio.applySongVolume(55);
    assert.equal(audio.volume, 0.55);
    assert.equal(stemsCalls.at(-1), 0.55);
    assert.equal(window.feedBack.audioSession.snapshot().domains['audio-mix'].route.routeKind, 'stems');

    window._juceMode = true;
    delete window.feedBack.stems;
    await window.feedBack.audio.applySongVolume(66);
    assert.deepEqual(desktopCalls.at(-1), ['backing', 0.66]);
    assert.equal(window.feedBack.audioSession.snapshot().domains['audio-mix'].route.routeKind, 'juce');
});

test('a full 0-to-100 song-volume hold stays realtime and persists only the final value', () => {
    const window = loadAudioSession();
    const { audio } = installMixerDom(window);
    installDeterministicTimers(window);
    window.localStorage.setItem('volume', '0');

    const participantEvents = captureEvents(window, 'audio-mix:participant-registered');
    const routeEvents = captureEvents(window, 'audio-mix:route-changed');
    const bridgeEvents = captureEvents(window, 'audio-mix:bridge-hit');
    const diagnosticUpdates = {};
    window.feedBack.diagnostics = {
        contribute(id) { diagnosticUpdates[id] = (diagnosticUpdates[id] || 0) + 1; },
    };

    runBrowserScript(window, 'static/audio-mixer.js');
    const baseline = {
        participants: participantEvents.length,
        routes: routeEvents.length,
        bridges: bridgeEvents.length,
        outcomes: window.feedBack.audioSession.snapshot().recentOutcomes.length,
    };
    for (const key of Object.keys(diagnosticUpdates)) delete diagnosticUpdates[key];

    let storageWrites = 0;
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key, value) => {
        storageWrites += 1;
        originalSetItem(key, value);
    };

    const songVolume = window.feedBack.audio.getFaders().find(fader => fader.id === 'song');
    for (let value = 1; value <= 100; value += 1) {
        songVolume.setValue(value);
    }

    assert.equal(audio.volume, 1, 'the live gain reaches 100% immediately');
    assert.equal(window.feedBack.audio.readSongVolume(), 100, 'the next repeat tick reads memory, not stale storage');
    assert.equal(participantEvents.length, baseline.participants, 'repeat ticks never re-register the song fader');
    assert.equal(routeEvents.length - baseline.routes, 1, 'the unchanged route is reported once');
    assert.equal(bridgeEvents.length - baseline.bridges, 1, 'the realtime compatibility bridge is recorded once');
    assert.equal(window.feedBack.audioSession.snapshot().recentOutcomes.length - baseline.outcomes, 2,
        'only the first route and bridge transitions create diagnostic outcomes');
    assert.deepEqual(diagnosticUpdates, { capabilities: 1, 'audio-session': 2 });
    assert.equal(storageWrites, 0, 'storage never blocks the held-key hot path');

    window.__runTimers(150);
    assert.equal(storageWrites, 1, 'the completed key-repeat burst performs one storage write');
    assert.equal(window.localStorage.getItem('volume'), '100');
    const settledSongFader = window.feedBack.audioSession.snapshot().domains['audio-mix'].faders
        .find(fader => fader.participantId === 'core.song');
    assert.equal(settledSongFader.currentValue, 100, 'the settled value is reflected in diagnostics');
    assert.equal(participantEvents.length - baseline.participants, 1,
        'the completed burst performs one deferred coordinator update');
});

test('desktop song gain coalesces an in-flight held-key burst to its newest value', async () => {
    const window = loadAudioSession();
    installMixerDom(window);
    const calls = [];
    const resolvers = [];
    window._juceMode = true;
    window.feedBackDesktop = {
        audio: {
            setGain(name, value) {
                calls.push([name, value]);
                return new Promise(resolve => resolvers.push(resolve));
            },
        },
    };
    runBrowserScript(window, 'static/audio-mixer.js');

    const first = window.feedBack.audio.applySongVolume(10);
    const middle = window.feedBack.audio.applySongVolume(20);
    const latest = window.feedBack.audio.applySongVolume(30);
    assert.deepEqual(calls, [['backing', 0.1]], 'the first gain update is dispatched immediately');

    resolvers.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['backing', 0.1], ['backing', 0.3]],
        'intermediate queued values collapse to the newest requested gain');

    resolvers.shift()();
    await Promise.all([first, middle, latest]);
});

test('desktop song gain drains an update queued during completion handoff', async () => {
    const window = loadAudioSession();
    installMixerDom(window);
    const calls = [];
    let queueDuringCompletion = true;
    window._juceMode = true;
    window.feedBackDesktop = {
        audio: {
            setGain(name, value) {
                calls.push([name, value]);
                return Promise.resolve().then(() => {
                    if (queueDuringCompletion) {
                        queueDuringCompletion = false;
                        window.feedBack.audio.applySongVolume(40);
                    }
                });
            },
        },
    };
    runBrowserScript(window, 'static/audio-mixer.js');

    await window.feedBack.audio.applySongVolume(10);
    assert.deepEqual(calls, [['backing', 0.1], ['backing', 0.4]],
        'an update queued as the previous IPC resolves is still delivered');
});

test('stems provider ownership remains separate from audio-mix stem participation', async () => {
    const window = loadAudioSession();
    const audioSession = window.feedBack.audioSession;
    audioSession.startSession({ sessionId: 'main:stems-song' });
    audioSession.registerStemOwner({ ownerId: 'stems_plugin', stemIds: ['guitar', 'bass'], availability: 'available' });
    audioSession.registerMixParticipant({
        participantId: 'stems.master',
        ownerPluginId: 'stems_plugin',
        label: 'Stems',
        kind: 'stem',
        sourceMode: 'native',
        fader: { id: 'master', label: 'Stems', min: 0, max: 1, step: 0.1, defaultValue: 1, currentValue: 1 },
        operations: ['fader.get-value', 'fader.set-value'],
    });

    const stemsInspect = await window.feedBack.capabilities.dispatch({ capability: 'stems', command: 'inspect', source: 'test' });
    const mixInspect = await window.feedBack.capabilities.dispatch({ capability: 'audio-mix', command: 'inspect', source: 'test' });

    assert.equal(stemsInspect.payload.owner.ownerId, 'stems_plugin');
    assert.equal(mixInspect.payload.faders.some(fader => fader.kind === 'stem' && fader.ownerPluginId === 'stems_plugin'), true);
});

test('audio-input selection and registered providers survive song session switches without live sessions', async () => {
    const window = loadAudioSession();
    const api = window.feedBack.capabilities;
    const audioSession = window.feedBack.audioSession;

    audioSession.startSession({ sessionId: 'main:first-song', songKey: 'first-song.sloppak', songFormat: 'sloppak' });
    await api.dispatch({
        capability: 'audio-input',
        command: 'register-source',
        source: 'note_detect',
        payload: {
            sourceId: 'switch-source',
            logicalSourceKey: 'switch:instrument:primary',
            providerId: 'note_detect',
            kind: 'instrument',
            safeLabel: 'Switch Input',
            channelSummary: { channelCount: 1, channelShape: 'mono', supports: ['mono'] },
            operations: ['source.open', 'source.close'],
            operationHandlers: {
                'source.open': () => ({ outcome: 'handled' }),
                'source.close': () => ({ outcome: 'handled' }),
            },
        },
    });
    await api.dispatch({ capability: 'audio-input', command: 'select-source', source: 'user', payload: { logicalSourceKey: 'switch:instrument:primary' } });
    const open = await api.dispatch({ capability: 'audio-input', command: 'open-source', source: 'note_detect', payload: { requesterId: 'note_detect', requiredChannelShape: 'mono' } });
    assert.equal(open.outcome, 'handled');

    const next = audioSession.startSession({ sessionId: 'main:second-song', songKey: 'second-song.archive', songFormat: 'archive' });
    const listed = await api.dispatch({ capability: 'audio-input', command: 'list-sources', source: 'note_detect' });

    assert.equal(next.session.songFormat, 'archive');
    assert.equal(next.domains['audio-input'].selected.logicalSourceKey, 'switch:instrument:primary');
    assert.equal(next.domains['audio-input'].totalOpenSessions, 0);
    assert.equal(listed.payload.sources.some(source => source.logicalSourceKey === 'switch:instrument:primary'), true);
});
