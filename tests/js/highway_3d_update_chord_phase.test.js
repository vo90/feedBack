'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {copyState}=require('./highway-bend-layout-fixture.js');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    for (; depth && end < source.length; end++) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}
const phase = fn('updateChordPhase');
const body = phase.slice(phase.indexOf('            if (strumFrames.displayChords)'),
    phase.indexOf('            result.highwayIntensity ='));
const update = fn('update');
const handoff = update.slice(update.indexOf('            _chordFrameResult.highwayIntensity ='),
    update.indexOf('            flushNoteDraws();'));
const inputs = 'strumFrames, chordGuideEnds, ndVerdictT0, t1, now, bundle, activeFrets, anchors, notes, camT0, camT1, camTau, _ghostPrevBuf, lastFretForString, _noteStreamBracketStrings';
const totals = 'highwayIntensity, camWX, camWSum, camDistMin, camDistMax, camDistGot';

// Run the exact production handoff and phase against its former inline form.
// Mesh emission is captured at drawNote; no WebGL, DOM or game process is used.
function harness(extracted, cameraMode = 'stable') {
    const draws = [], anchorsRead = [], phaseRecords = [];
    const env = {
        AHEAD: 3, nStr: 6, SLIDE_IN_CUE_SECONDS: .22, NEXT_ON_STRING_T_EPS: .001,
        CHORD_ANCHOR_TIME_EPS: .000501, CHORD_HWY_LINGER_S: .2, CHORD_HWY_FADE_S: .1,
        NOTEDETECT_GEM_VERDICT_WINDOW: .75, ARP_INFER_MIN_HAND_SHAPE_SPAN_S: .2,
        cameraMode, curX: 23, _ndHasProvider: false,
        _chordGuideCache: { model: { byChord: new Map() } },
        _chordPredecessorStateScratch: {}, _linkNextTargetSet: new Set(),
        _scrChordNote: {}, _linkedBendStarts: new WeakMap(), _linkedBendEnds: new WeakMap(),
        _linkedVibratoRuns: new WeakMap(), _linkedTrailPaths: { byNote: new WeakMap() },
        lowerBoundT: new Function(`${fn('lowerBoundT')}; return lowerBoundT;`)(),
        _ensureChordCullIndex(chords) {
            env._chordCullIndex = { maxSustains: chords.map(ch => Math.max(0, ...(ch.notes || []).map(n => n.sus || 0))) };
        },
        _nextChordCullCandidate: (index, from) => from,
        _restoreChordPredecessorState: () => assert.fail('Fixture traversal is contiguous'),
        chordShapeSignature: ch => ch.notes ? ch.notes.map(n => `${n.s}:${n.f}`).join(',') : null,
        filterValidNotes: notes => notes.filter(n => n.s >= 0 && n.s < 6 && n.f >= 0 && n.f <= 24),
        mergeChordShape: (ch, notes) => new Map(notes.map(n => [n.s, n.f])),
        isPlayableFret: f => Number.isInteger(f) && f >= 0 && f <= 24,
        isUnpitchedMute: n => n.f === 127 && n.mt,
        getChartAnchorAt(anchors, time) { anchorsRead.push([anchors[0]?.fret, time]); return anchors[0]; },
        laneBoundsFromAnchor: anchor => anchor ? { dMin: anchor.fret, dMax: anchor.fret + 4 } : null,
        xFret: f => f * 10,
        chordShapeLaneBounds: (lo, hi) => ({ dMin: lo - 1, dMax: hi }),
        openNoteLaneBoxW: () => 80,
        chordHandShapeArpeggioHint: () => ({ hs: null, explicit: false, covered: false }),
        inferArpeggioFromNotePattern: () => false,
        nextStrictlyLaterChordTime: () => Infinity,
        chordUsesArpeggioFrame: () => false,
        chordWireHighDensity: ch => !!ch.hd,
        _firstEventTimeGreaterThan: () => Infinity,
        suppressSynthChordForNotes: ch => !!ch.h3dSynth,
        chordShapeCoveredByStandaloneNotes: () => false,
        hwyPostHitTailFadeMul: () => 1,
        chordHasFrameShape: () => false,
        repeatChordMaySuppressGems: () => false,
        usesUnfrettedPosition: n => n.f === 0,
        chordMemberTrailSuppressed: () => false,
        xNote: n => n.f * 11,
        chordTemplateLabel: () => '',
        drawNote(...args) { draws.push(structuredClone(args)); },
        drawSlideInHorizonNote(...args) { draws.push(['horizon', ...structuredClone(args)]); },
    };
    env.phaseRecords = phaseRecords;
    const result = new Function('env', `with (env) {
        ${copyState}
        const _chordFrameResult = {};
        ${phase}
        const actualPhase = updateChordPhase;
        updateChordPhase = function(...args) { phaseRecords.push(args.at(-1)); return actualPhase(...args); };
        return function(frame) {
            const { ${inputs} } = frame;
            let { ${totals} } = frame.initial;
            ${extracted ? handoff : body}
            return { ${totals} };
        };
    }`)(env);
    return { run: result, draws, anchorsRead, phaseRecords, env };
}

function frame(now, chords) {
    return {
        now, t1: now + 3, ndVerdictT0: now - .75,
        strumFrames: { displayChords: chords }, chordGuideEnds: new Map(),
        bundle: { chords, handShapes: [], chordTemplates: [] },
        notes: [], anchors: [{ fret: 3 }], activeFrets: new Set(),
        camT0: now - .2, camT1: now + 1.25, camTau: .6,
        _ghostPrevBuf: new Map([[1000001, 8.75]]), lastFretForString: [],
        _noteStreamBracketStrings: new Map(),
        initial: { highwayIntensity: .03, camWX: 2.5, camWSum: .25, camDistMin: 9, camDistMax: 2, camDistGot: false },
    };
}

test('empty chord phases preserve all six initialized results and reuse their result record', () => {
    const h = harness(true);
    for (const chords of [null, [], null]) {
        const input = frame(10, chords);
        assert.deepEqual(h.run(input), input.initial);
    }
    assert.equal(new Set(h.phaseRecords).size, 1);
});

test('actual phase handoff matches inline note emissions, anchors, fret state and camera totals across frames', () => {
    for (const mode of ['stable', 'lookahead']) {
        const old = harness(false, mode), next = harness(true, mode);
        const chords = [
            { t: 7, id: 0, notes: [{ s: 0, f: 4, sus: 5 }, { s: 1, f: 7, sus: .1 }] },
            { t: 10, id: 1, notes: [{ s: 0, f: 0 }, { s: 1, f: 5, sus: 1, sl: 7, bn: 1 }] },
            { t: 10.3, id: 1, notes: [{ s: 0, f: 0 }, { s: 1, f: 5, sus: 1, pm: true }] },
            { t: 10.6, id: 2, h3dSynth: true, notes: [{ s: 2, f: 8, sus: 1 }] },
            { t: 13.1, id: 3, notes: [{ s: 3, f: 9, sus: 1, slide_in_marks: [{ end: 0 }] }] },
        ];
        for (const now of [10, 10.4, 11.1, 14, 9.9]) {
            const a = frame(now, structuredClone(chords)), b = frame(now, structuredClone(chords));
            assert.deepEqual(next.run(b), old.run(a), `scalar outputs at ${now}, ${mode}`);
            assert.deepEqual(next.draws, old.draws, `emitted draw calls at ${now}, ${mode}`);
            assert.deepEqual(next.anchorsRead, old.anchorsRead);
            assert.deepEqual([...b.activeFrets], [...a.activeFrets]);
            assert.deepEqual(b.lastFretForString, a.lastFretForString);
        }
        assert.ok(next.draws.length > 10, 'fixture must exercise real chord-member emission');
        assert.equal(new Set(next.phaseRecords).size, 1);
    }
});

test('the extracted phase remains between note collection and the same-frame flush/guides', () => {
    assert.ok(!update.includes('if (strumFrames.displayChords)'));
    const before = update.indexOf('pbEnd(4);');
    const phaseCall = update.indexOf('updateChordPhase(');
    const flush = update.indexOf('flushNoteDraws();');
    const guides = update.indexOf('drawChordHoldGuides(now,');
    assert.ok(before >= 0 && phaseCall > before && flush > phaseCall && guides > flush);
    assert.ok(source.indexOf('const _chordFrameResult =') < source.indexOf('function update(bundle)'));
});
