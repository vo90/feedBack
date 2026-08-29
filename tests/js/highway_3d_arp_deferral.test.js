// Pins the arpeggio chord-gem deferral gating in plugins/highway_3d/screen.js
// (feedBack#262). Without these guards, an over-eager `deferChordGems` makes
// arpeggio frames empty when standalone notes don't actually cover the shape,
// and an under-eager one duplicates gems on top of the standalone passage.
//
// The arpeggio inference helpers are extracted from the real renderer source
// and exercised in isolation. Renderer-loop wiring remains source-level so
// these tests do not need a fake DOM / Three.js scene.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const SRC = fs.readFileSync(SCREEN_JS, 'utf8');

const INFER_CONSTANTS = [
    'ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S',
    'ARP_INFER_MULTI_STRUM_HIT_SLACK',
    'ARP_INFER_MULTI_STRUM_WIN_MIN_S',
    'ARP_INFER_MIN_HITS_VS_SHAPE_CAP',
];

function constDeclaration(name) {
    const match = SRC.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
    assert.ok(match, `constant ${name} must exist`);
    return match[0];
}

function inferenceHarness() {
    const cacheStart = SRC.indexOf('let _arpInferCache = new WeakMap();');
    assert.ok(cacheStart >= 0, 'arpeggio inference cache must exist');

    const uncachedSource = extractFunction(
        SRC,
        'function _inferArpeggioFromNotePatternUncached',
    );
    const uncachedStart = SRC.indexOf(uncachedSource, cacheStart);
    assert.ok(uncachedStart >= cacheStart, 'uncached arpeggio helper must follow its cache');
    const inferenceBlock = SRC.slice(cacheStart, uncachedStart + uncachedSource.length);

    return new Function(`
        "use strict";
        ${INFER_CONSTANTS.map(constDeclaration).join('\n')}
        ${extractFunction(SRC, 'function lowerBoundT')}
        ${extractFunction(SRC, 'function hitTimesQualifyArpeggioSpread')}
        function validString(s) {
            return Number.isInteger(s) && s >= 0 && s < 6;
        }
        ${inferenceBlock}
        return { inferArpeggioFromNotePattern };
    `)();
}

function shape(entries) {
    return new Map(entries);
}

function infer({ ch, chordShape, notes, timeWin = null, hss = null, stopBefore = null }) {
    return inferenceHarness().inferArpeggioFromNotePattern(
        ch,
        chordShape,
        notes,
        timeWin,
        hss,
        stopBefore,
    );
}

test('239.341995 chord cannot borrow its missing string from later chord events', () => {
    const ch = { t: 239.341995, id: 0 };
    const notes = [
        { t: 239.341995, s: 0, f: 5 },
        { t: 239.619995, s: 0, f: 5 },
        { t: 241.542007, s: 1, f: 7 },
    ];
    const fixture = {
        ch,
        chordShape: shape([[0, 5], [1, 7]]),
        notes,
    };

    assert.equal(infer(fixture), true, 'fixture must reproduce the legacy false positive');
    assert.equal(infer({
        ...fixture,
        stopBefore: 239.619995,
    }), false);
});

test('297.740997 chord cannot borrow its missing string from later chord events', () => {
    const ch = { t: 297.740997, id: 3 };
    const notes = [
        { t: 297.740997, s: 1, f: 5 },
        { t: 298.510010, s: 2, f: 7 },
        { t: 299.792999, s: 1, f: 5 },
    ];
    const fixture = {
        ch,
        chordShape: shape([[1, 5], [2, 7]]),
        notes,
    };

    assert.equal(infer(fixture), true, 'fixture must reproduce the legacy false positive');
    assert.equal(infer({
        ...fixture,
        stopBefore: 298.126007,
    }), false);
});

test('fallback inference still accepts an arpeggio completed before the next chord', () => {
    assert.equal(infer({
        ch: { t: 10 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 10, s: 0, f: 5 },
            { t: 10.12, s: 1, f: 7 },
        ],
        stopBefore: 10.5,
    }), true);
});

test('a note exactly on the next chord onset is excluded from fallback inference', () => {
    assert.equal(infer({
        ch: { t: 20 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 20, s: 0, f: 5 },
            { t: 20.25, s: 1, f: 7 },
        ],
        stopBefore: 20.25,
    }), false);
});

test('fallback inference keeps its legacy lookahead when there is no later chord', () => {
    assert.equal(infer({
        ch: { t: 30 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 30, s: 0, f: 5 },
            { t: 31.5, s: 1, f: 7 },
        ],
    }), true);
});

test('an explicit hand-shape time window remains authoritative over stopBefore', () => {
    assert.equal(infer({
        ch: { t: 40 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 40, s: 0, f: 5 },
            { t: 40.1, s: 1, f: 7 },
        ],
        timeWin: { tLo: 40, tHi: 40.4 },
        stopBefore: 40.05,
    }), true);
});

test('changing stopBefore on the same chord invalidates its cached result', () => {
    const { inferArpeggioFromNotePattern } = inferenceHarness();
    const ch = { t: 50 };
    const chordShape = shape([[0, 5], [1, 7]]);
    const notes = [
        { t: 50, s: 0, f: 5 },
        { t: 50.3, s: 1, f: 7 },
    ];

    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.4),
        true,
    );
    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.2),
        false,
    );
});

test('nextStrictlyLaterChordTime skips coincident rows and returns null at chart end', () => {
    const nextStrictlyLaterChordTime = new Function(`
        "use strict";
        ${extractFunction(SRC, 'function lowerBoundT')}
        ${extractFunction(SRC, 'function nextStrictlyLaterChordTime')}
        return nextStrictlyLaterChordTime;
    `)();

    const chords = [
        { t: 9.8 },
        { t: 10 },
        { t: 10.0000004 },
        { t: 10.5 },
        { t: 11 },
    ];
    assert.equal(nextStrictlyLaterChordTime(chords, 10), 10.5);
    assert.equal(nextStrictlyLaterChordTime(chords, 11), null);
});

test('chord-loop fallback passes the next raw authored chord onset to inference', () => {
    const start = SRC.indexOf('const hsTimeWinFrame =');
    const end = SRC.indexOf('// Only suppress the chord gems', start);
    assert.ok(start >= 0 && end > start, 'chord-loop arpeggio inference block must exist');
    const caller = SRC.slice(start, end);

    assert.match(
        caller,
        /inferArpeggioFromNotePattern\(\s*ch\s*,\s*chShape\s*,\s*notes\s*,\s*hsTimeWinFrame\s*,\s*bundle\.handShapes\s*,\s*hsTimeWinFrame\s*\?\s*null\s*:\s*nextStrictlyLaterChordTime\(\s*bundle\.chords\s*,\s*ch\.t\s*\)\s*\)/,
        'fallback inference must stop at the next raw authored chord, never a renderer synth row',
    );
});

test('chordShapeCoveredByStandaloneNotes helper exists with the expected signature', () => {
    assert.match(
        SRC,
        /function\s+chordShapeCoveredByStandaloneNotes\s*\(\s*ch\s*,\s*shape\s*,\s*notesArr\s*,\s*timeWin\s*\)/,
        'helper that scans the note stream for shape coverage must remain on screen.js',
    );
});

test('deferChordGems gates both synth and explicit+covered branches on note-stream coverage', () => {
    // Either branch firing without coverage produces the empty-lavender-frame
    // regression PR #262 fixed. Pin both predicates so a refactor that drops
    // one gate fails the test.
    assert.match(
        SRC,
        /const\s+deferChordGems\s*=\s*\(\s*ch\.h3dSynth\s*&&\s*noteStreamCoversArpShape\(\)\s*\)\s*\|\|\s*inferredArpPattern\s*\|\|\s*\(\s*hsHintFrame\.explicit\s*&&\s*hsHintFrame\.covered\s*&&\s*noteStreamCoversArpShape\(\)\s*\)/,
        'deferChordGems must guard the h3dSynth and explicit+covered branches with the coverage check',
    );
});

test('noteStreamCoversArpShape is computed lazily (called, not eagerly bound)', () => {
    // Eager allocation regressed perf on dense charts (Copilot review on PR
    // #262). The shape must be a callable so short-circuit evaluation skips
    // the note-stream scan when neither gating branch needs it.
    assert.match(
        SRC,
        /const\s+noteStreamCoversArpShape\s*=\s*(?:\(\s*\)\s*=>|function(?:\s+\w+)?\s*\(\s*\))/,
        'noteStreamCoversArpShape must be an arrow/function so the scan is lazy',
    );
    assert.doesNotMatch(
        SRC,
        /const\s+noteStreamCoversArpShape\s*=\s*chordShapeCoveredByStandaloneNotes\(/,
        'noteStreamCoversArpShape must not eagerly invoke the coverage helper',
    );
});
