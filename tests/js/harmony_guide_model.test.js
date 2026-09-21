const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Import the actual browser ES module without changing this CommonJS suite.
const source = fs.readFileSync(path.join(__dirname, '../../static/js/harmony-guide-model.js'), 'utf8');
const model = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const STANDARD = [40, 45, 50, 55, 59, 64];

test('Am–F–C–G has one stable full scale, tonic A and the actual chord root as target', async () => {
    const { createHarmonyTimeline, resolveHarmony, buildScaleFretboard } = await model;
    const timeline = createHarmonyTimeline({
        keys: { events: [{ t: 0, key: 'Am' }] },
        harmony: { events: [
            { t: 0, root: 'A', quality: 'min' }, { t: 4, root: 'F', quality: 'maj' },
            { t: 8, root: 'C', quality: 'maj' }, { t: 12, root: 'G', quality: 'maj' },
        ] },
    });
    for (const [time, target] of [[0, 9], [4, 5], [8, 0], [12, 7], [5, 5], [1, 9]]) {
        const state = resolveHarmony(timeline, time);
        assert.equal(state.scaleStatus, 'available');
        assert.equal(state.key.label, 'A minor');
        assert.equal(state.scale.label, 'A natural minor');
        assert.deepEqual(state.scale.pitchClasses, [9, 11, 0, 2, 4, 5, 7]);
        assert.equal(state.targetPc, target);
        const { markers } = buildScaleFretboard({ scale: state.scale, targetPc: state.targetPc, openMidi: STANDARD, minFret: 5, maxFret: 9 });
        assert(markers.length > 0);
        for (const marker of markers) {
            assert(state.scale.pitchClasses.includes(marker.pc));
            assert.equal(marker.isTonic, marker.pc === 9);
            assert.equal(marker.isTarget, marker.pc === target);
            assert.equal(marker.midi, STANDARD[marker.string] + marker.fret);
        }
    }
});

test('unsupported scales and chords are honest, conflicts check thirds and extensions as well as roots', async () => {
    const { createHarmonyTimeline, resolveHarmony } = await model;
    const state = (key, scale, quality, root = 'E') => resolveHarmony(createHarmonyTimeline({
        keys: [{ t: 0, key, ...(scale ? { scale } : {}) }], harmony: [{ t: 0, root, quality }],
    }), 1);
    assert.equal(state('Am', 'imaginary', 'min').scaleStatus, 'unsupported');
    assert.equal(state('Am', 'major', '5').scaleStatus, 'conflict');
    assert.equal(state('Am', 'minor_pentatonic', 'maj', 'F').scaleStatus, 'conflict');
    assert.equal(state('Am', '', '7').scaleStatus, 'conflict'); // E root fits, G# does not.
    assert.equal(state('Am', 'harmonic_minor', '7').scaleStatus, 'available');
    assert.equal(state('Am', '', 'mysterious').scaleStatus, 'unsupported');
    assert.equal(state('Am', '', '5').scaleStatus, 'available'); // No invented third.
    assert.equal(state('Am', '', '5').current.label, 'E5');
    assert.equal(state('Am', '', '5').key.mode, 'minor');
});

test('slash bass, root-only, no-chord and unknown events keep distinct meanings', async () => {
    const { createHarmonyTimeline, resolveHarmony } = await model;
    const timeline = createHarmonyTimeline({ keys: [{ t: 0, key: 'C' }], harmony: [
        { t: 2, root: 'C', quality: 'maj', bass: 'E' },
        { t: 4, root: 'D' }, { t: 6, root: null }, { t: 8, root: '?' }, { t: 10 },
    ] });
    assert.equal(resolveHarmony(timeline, 0).current, null);
    const inversion = resolveHarmony(timeline, 3);
    assert.equal(inversion.current.label, 'C/E');
    assert.equal(inversion.current.bassPc, 4);
    assert.equal(inversion.targetPc, 0);
    assert.equal(resolveHarmony(timeline, 5).current.status, 'note');
    assert.deepEqual(resolveHarmony(timeline, 5).current.pitchClasses, [2]);
    const silent = resolveHarmony(timeline, 7);
    assert.equal(silent.current.status, 'no-chord');
    assert.equal(silent.targetPc, null);
    assert.equal(silent.scale.tonicPc, 0);
    assert.equal(resolveHarmony(timeline, 9).current.status, 'unknown');
    assert.equal(resolveHarmony(timeline, 11).current.status, 'no-chord');
});

test('key regions, equal-time replacements and user overrides resolve deterministically after seeks', async () => {
    const { createHarmonyTimeline, resolveHarmony } = await model;
    const keys = [{ t: 8, key: 'Dm' }, { t: 0, key: 'Am' }, { t: NaN, key: 'F' }, { t: 8, key: 'G' }];
    const timeline = createHarmonyTimeline({ keys, harmony: [{ t: 0, root: 'A', quality: 'min' }], overrides: { harmony: [{ t: 0, root: 'C', quality: 'maj' }] } });
    assert.equal(keys[0].key, 'Dm'); // Input untouched.
    assert.equal(resolveHarmony(timeline, 9).key.label, 'G major');
    assert.equal(resolveHarmony(timeline, 2).key.label, 'A minor');
    assert.deepEqual(resolveHarmony(timeline, 2).source, { key: 'feedpak', harmony: 'local' });
    assert.equal(resolveHarmony(timeline, -1).key, null);
    assert.equal(resolveHarmony(createHarmonyTimeline({ keys, overrides: { keys: [] } }), 9).key, null);
});

test('pitch names respect diatonic spelling, including flats and leading-note sharps', async () => {
    const { makeScale, pitchClass, buildScaleFretboard } = await model;
    assert.equal(pitchClass('B#'), 0);
    assert.equal(pitchClass('E♭'), 3);
    assert.equal(pitchClass('Cm'), null);
    assert.equal(makeScale('Bb', 'major').noteNames[3], 'Eb');
    assert.equal(makeScale('F#', 'major').noteNames[5], 'E#');
    assert.equal(makeScale('C#', 'harmonic_minor').noteNames[0], 'B#');
    assert.equal(makeScale('C', 'not_a_scale'), null);
    const board = buildScaleFretboard({ scale: makeScale('Bb', 'major'), openMidi: [39, 44, 49, 54, 58, 63] });
    assert(board.markers.some(marker => marker.note === 'Eb'));
});

test('degree glyphs preserve real interval identities for every supported scale and transposition', async () => {
    const { makeScale, buildScaleFretboard } = await model;
    const expected = {
        major: ['R', '2', '3', '4', '5', '6', '7'],
        natural_minor: ['R', '2', '♭3', '4', '5', '♭6', '♭7'],
        dorian: ['R', '2', '♭3', '4', '5', '6', '♭7'],
        phrygian: ['R', '♭2', '♭3', '4', '5', '♭6', '♭7'],
        lydian: ['R', '2', '3', '♯4', '5', '6', '7'],
        mixolydian: ['R', '2', '3', '4', '5', '6', '♭7'],
        locrian: ['R', '♭2', '♭3', '4', '♭5', '♭6', '♭7'],
        harmonic_minor: ['R', '2', '♭3', '4', '5', '♭6', '7'],
        melodic_minor: ['R', '2', '♭3', '4', '5', '6', '7'],
        major_pentatonic: ['R', '2', '3', '5', '6'],
        minor_pentatonic: ['R', '♭3', '4', '5', '♭7'],
    };
    for (const root of ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B', 'Cb']) {
        for (const [id, degrees] of Object.entries(expected)) {
            const scale = makeScale(root, id);
            assert.deepEqual(scale.pitchClasses.map(pc => scale.degreeLabels[pc]), degrees, `${root} ${id}`);
            const { markers } = buildScaleFretboard({ scale, openMidi: STANDARD, minFret: 0, maxFret: 24 });
            assert(markers.length > 0);
            for (const marker of markers) {
                assert.equal(marker.degreeLabel, degrees[scale.pitchClasses.indexOf(marker.pc)]);
                assert.equal(marker.degreeLabel === 'R', marker.isTonic);
            }
        }
    }
});

test('A minor tonic stays R while F chord targets carry their scale degree ♭6', async () => {
    const { createHarmonyTimeline, resolveHarmony, buildScaleFretboard } = await model;
    const timeline = createHarmonyTimeline({
        keys: [{ t: 0, key: 'Am' }], harmony: [{ t: 0, root: 'A', quality: 'min' }, { t: 4, root: 'F', quality: 'maj' }],
    });
    const state = resolveHarmony(timeline, 5);
    const { markers } = buildScaleFretboard({ scale: state.scale, targetPc: state.targetPc, openMidi: STANDARD });
    const roots = markers.filter(marker => marker.isTonic);
    const targets = markers.filter(marker => marker.isTarget);
    assert(roots.length > 0 && targets.length > 0);
    assert(roots.every(marker => marker.note === 'A' && marker.degreeLabel === 'R' && !marker.isTarget));
    assert(targets.every(marker => marker.note === 'F' && marker.degreeLabel === '♭6' && !marker.isTonic));
    assert(markers.filter(marker => marker.pc === 0).every(marker => marker.degreeLabel === '♭3'));
});

test('enharmonic note spellings and pentatonic omissions never alter degree labels', async () => {
    const { makeScale, buildScaleFretboard } = await model;
    const sharp = makeScale('C#', 'major');
    const flat = makeScale('Db', 'major');
    assert.equal(sharp.noteNames[5], 'E#');
    assert.equal(flat.noteNames[5], 'F');
    assert.equal(sharp.degreeLabels[5], '3');
    assert.equal(flat.degreeLabels[5], '3');
    const minorPentatonic = makeScale('A', 'minor_pentatonic');
    const { markers } = buildScaleFretboard({ scale: minorPentatonic, targetPc: 0, openMidi: STANDARD });
    assert(markers.filter(marker => marker.pc === 0).every(marker => marker.note === 'C' && marker.degreeLabel === '♭3' && marker.isTarget));
    assert(!markers.some(marker => marker.degreeLabel === '2' || marker.degreeLabel === '6'));
    assert.equal(makeScale('C', 'major_pentatonic').degreeLabels[7], '5');
    assert.equal(makeScale('C', 'major_pentatonic').degreeLabels[9], '6');
});

test('loops preview the actual next repeated state and omit progression outside the loop', async () => {
    const { createHarmonyTimeline, resolveHarmony, beatsToChange } = await model;
    const timeline = createHarmonyTimeline({ keys: [{ t: 0, key: 'C' }], harmony: [
        { t: 0, root: 'C', quality: 'maj' }, { t: 3, root: 'F', quality: 'maj' },
        { t: 7, root: 'G', quality: 'maj' }, { t: 10, root: 'E', quality: '7' },
    ] });
    const loop = { start: 2, end: 8 };
    const state = resolveHarmony(timeline, 7.5, { upcomingCount: 4, loop });
    assert.deepEqual(state.upcoming.map(event => event.label), ['C', 'F', 'G', 'C']);
    assert.deepEqual(state.upcoming.map(event => event.t), [8, 9, 13, 14]);
    assert.deepEqual(state.upcoming.map(event => event.timelineT), [2, 3, 7, 2]);
    const beats = [0, 1, 2, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8];
    assert.equal(beatsToChange(beats, 7.5, 9, loop), 2);
});

test('scale boxes are fixed valid shapes in every key; altered tunings still map pitches but omit boxes', async () => {
    const { makeScale, buildScaleFretboard } = await model;
    const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (const root of roots) {
        for (const id of ['major', 'natural_minor', 'major_pentatonic', 'minor_pentatonic']) {
            const scale = makeScale(root, id);
            const board = buildScaleFretboard({ scale, openMidi: STANDARD, minFret: 0, maxFret: 24 });
            assert(board.positions.length >= 5, `${root} ${id}`);
            assert.equal(board.positions.filter(position => position.active).length, 1);
            assert.equal(new Set(board.positions.map(position => position.label)).size, 5);
            for (const position of board.positions) {
                for (const span of position.spans) {
                    assert(scale.pitchClasses.includes((STANDARD[span.string] + span.minFret) % 12), `${root} ${id} ${position.label} start`);
                    assert(scale.pitchClasses.includes((STANDARD[span.string] + span.maxFret) % 12), `${root} ${id} ${position.label} end`);
                }
            }
        }
    }
    const scale = makeScale('A', 'natural_minor');
    const dropD = buildScaleFretboard({ scale, openMidi: [38, 45, 50, 55, 59, 64] });
    assert(dropD.markers.some(marker => marker.string === 0 && marker.fret === 0 && marker.pc === 2));
    assert.deepEqual(dropD.positions, []);
    const bass = buildScaleFretboard({ scale, openMidi: [28, 33, 38, 43] });
    assert(bass.markers.length > 0);
    assert.deepEqual(bass.positions, []);
    assert.deepEqual(buildScaleFretboard({ scale: makeScale('D', 'dorian'), openMidi: STANDARD }).positions, []);
    const capo = buildScaleFretboard({ scale, openMidi: STANDARD.map(n => n + 2) });
    assert(capo.positions.length > 0);
    assert(capo.markers.some(marker => marker.string === 0 && marker.fret === 3 && marker.isTonic));
});

test('four beats are measured through tempo changes, seconds fallback has independent eligibility', async () => {
    const { prepareRestWindows, resolveRest, beatPosition } = await model;
    const notes = [{ t: 0, sus: 1 }, { t: 4, sus: 1 }];
    const beats = [0, 1, 2, 2.5, 3, 3.5, 4, 5];
    assert.equal(beatPosition(beats, 2.25), 2.5);
    const beatWindows = prepareRestWindows({ notes, beats, duration: 5, minimumBeats: 4 });
    assert.equal(beatWindows.windows[0].beats, 5);
    assert.equal(resolveRest(beatWindows, 2).active, true);
    assert.equal(resolveRest(prepareRestWindows({ notes, beats, thresholdMode: 'seconds', minimumSeconds: 3.1 }), 2).active, false);
    assert.equal(resolveRest(prepareRestWindows({ notes, minimumSeconds: 3 }), 2).active, true);
    assert.equal(resolveRest(prepareRestWindows({ notes, beats: [0] }), 2).active, true);
});

test('sustained chord members occupy the full hold, and valid linked continuations do not become rests', async () => {
    const { prepareRestWindows, resolveRest } = await model;
    const chords = [{ t: 0, notes: [{ s: 0, f: 5, sus: 5 }, { s: 1, f: 7, sus: 1 }] }, { t: 8, notes: [{ s: 0, f: 5 }] }];
    const prepared = prepareRestWindows({ chords, minimumSeconds: 3, thresholdMode: 'seconds', duration: 9 });
    assert.equal(resolveRest(prepared, 3).active, false);
    assert.equal(resolveRest(prepared, 6).active, true);
    const linked = [{ t: 0, s: 0, f: 5, sus: 0, ln: true }, { t: 5, s: 0, f: 5, sus: 2 }, { t: 10, s: 1, f: 3 }];
    const links = prepareRestWindows({ notes: linked, thresholdMode: 'seconds' });
    assert.equal(resolveRest(links, 3).active, false);
    assert.equal(resolveRest(links, 8).active, true);
    const expired = linked.map(n => ({ ...n }));
    expired[0].sus = 1;
    assert.equal(resolveRest(prepareRestWindows({ notes: expired, thresholdMode: 'seconds' }), 3).active, true);
    const changedFret = linked.map(n => ({ ...n }));
    changedFret[1].f = 7;
    assert.equal(resolveRest(prepareRestWindows({ notes: changedFret, thresholdMode: 'seconds' }), 3).active, true);
    changedFret[0].sl = 7;
    assert.equal(resolveRest(prepareRestWindows({ notes: changedFret, thresholdMode: 'seconds' }), 3).active, false);
});

test('re-entry fade and seeking are deterministic; final silence has no invented re-entry', async () => {
    const { prepareRestWindows, resolveRest } = await model;
    const prepared = prepareRestWindows({ notes: [{ t: 0, sus: 1 }, { t: 5, sus: 1 }], beats: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], duration: 10 });
    assert.equal(resolveRest(prepared, 3).opacity, 1);
    assert.equal(resolveRest(prepared, 4.75).opacity, 0.25);
    assert.equal(resolveRest(prepared, 5).active, false);
    assert.equal(resolveRest(prepared, 3).opacity, 1);
    const ending = resolveRest(prepared, 9.75);
    assert.equal(ending.active, true);
    assert.equal(ending.opacity, 1);
    assert.equal(ending.reentryInSeconds, null);
});

test('loop rests combine head and tail, countdown into next loop and respect sustained boundaries', async () => {
    const { prepareRestWindows, resolveRest } = await model;
    const prepared = prepareRestWindows({ notes: [{ t: 2, sus: 1 }], loop: { start: 0, end: 6, hasWrapped: true }, thresholdMode: 'seconds', minimumSeconds: 4 });
    const tail = resolveRest(prepared, 5.8);
    const head = resolveRest(prepared, 0.1);
    assert.equal(tail.active, true);
    assert.equal(head.active, true);
    assert.equal(tail.reentryInSeconds, 2.2);
    assert.equal(head.reentryInSeconds, 1.9);
    assert.equal(resolveRest(prepared, 1.9).opacity > 0.19, true);
    assert.equal(resolveRest(prepared, 2).active, false);
    const boundary = prepareRestWindows({ notes: [{ t: 0, sus: 1 }, { t: 4, sus: 5 }], loop: { start: 0, end: 6 }, thresholdMode: 'seconds', minimumSeconds: 3 });
    assert.equal(resolveRest(boundary, 5.5).active, false);
});

test('first loop entry does not borrow a previous cycle, but the tail previews the coming wrap', async () => {
    const { prepareRestWindows, resolveRest } = await model;
    const input = {
        notes: [{ t: 9.5, sus: 0.4 }, { t: 12, sus: 1 }], duration: 25,
        thresholdMode: 'seconds', minimumSeconds: 3, loop: { start: 10, end: 20 },
    };
    const firstPass = prepareRestWindows(input);
    assert.equal(resolveRest(firstPass, 10.1).active, false); // Two seconds to first note, below threshold.
    const firstTail = resolveRest(firstPass, 19.5);
    assert.equal(firstTail.active, true);
    assert.equal(firstTail.reentryInSeconds, 2.5); // Next note is at 12 on the coming loop.
    const repeated = prepareRestWindows({ ...input, loop: { ...input.loop, hasWrapped: true } });
    assert.equal(resolveRest(repeated, 10.1).active, true);
    assert(Math.abs(resolveRest(repeated, 10.1).reentryInSeconds - 1.9) < 1e-7);
    // A restart/count-in resets that prior-cycle history.
    const restart = prepareRestWindows({ ...input, loop: { ...input.loop, hasWrapped: false } });
    assert.equal(resolveRest(restart, 10.1).active, false);
});

test('an out-of-loop visual clock follows real song notes and tempo, never a copied loop interval', async () => {
    const { prepareRestWindows, resolveRest } = await model;
    const prepared = prepareRestWindows({
        notes: [{ t: 1, sus: 5 }, { t: 12, sus: 1 }, { t: 22, sus: 2 }],
        beats: Array.from({ length: 31 }, (_, i) => i), duration: 30,
        thresholdMode: 'seconds', minimumSeconds: 3, loop: { start: 10, end: 20, hasWrapped: true },
    });
    assert.equal(resolveRest(prepared, 4).active, false); // Actual sustained note from 1 to 6.
    const beforeA = resolveRest(prepared, 9.8);
    assert.equal(beforeA.active, true);
    assert(Math.abs(beforeA.reentryInBeats - 2.2) < 1e-7);
    assert.equal(resolveRest(prepared, 23).active, false); // Actual held note after B.
    assert.equal(resolveRest(prepared, 26).active, true);
});

test('negative derived chart-loop starts still resolve rest windows and upcoming harmony', async () => {
    const { prepareRestWindows, resolveRest, createHarmonyTimeline, resolveHarmony } = await model;
    const loop = { start: -2, end: 8 };
    const prepared = prepareRestWindows({ notes: [{ t: 0, sus: 1 }, { t: 5, sus: 1 }], duration: 12,
        thresholdMode: 'seconds', minimumSeconds: 1, loop });
    assert.equal(resolveRest(prepared, -1).active, true);
    assert.equal(resolveRest(prepared, -1).reentryInSeconds, 1);
    const timeline = createHarmonyTimeline({ keys: [{ t: 0, key: 'C' }], harmony: [
        { t: 0, root: 'C', quality: 'maj' }, { t: 4, root: 'F', quality: 'maj' }, { t: 9, root: 'G', quality: 'maj' },
    ] });
    const state = resolveHarmony(timeline, 7, { loop });
    assert.equal(state.upcoming[0].status, 'unknown'); // Nothing authored yet at chart -2.
    assert.equal(state.upcoming[0].t, 8);
    assert.equal(state.upcoming[1].label, 'C');
    assert.equal(state.upcoming[1].t, 10);
});

test('empty arrangements and malformed optional data do not crash playback', async () => {
    const { createHarmonyTimeline, resolveHarmony, prepareRestWindows, resolveRest, buildScaleFretboard } = await model;
    assert.equal(resolveHarmony(createHarmonyTimeline({ keys: null, harmony: null }), 0).scaleStatus, 'missing');
    assert.deepEqual(buildScaleFretboard({}), { markers: [], positions: [] });
    const empty = prepareRestWindows({ notes: null, chords: null, duration: 20 });
    assert.equal(resolveRest(empty, 10).active, true);
    assert.equal(resolveRest(empty, 10).reentryInSeconds, null);
    assert.equal(resolveRest(empty, NaN).active, false);
});
