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
        return {
            inferArpeggioFromNotePattern,
            _inferArpeggioFromNotePatternUncached,
        };
    `)();
}

function handShapeHintHarness(markedArpeggio = true) {
    const hintStart = SRC.indexOf('const _HINT_NONE =');
    assert.ok(hintStart >= 0, 'hand-shape hint sentinel must exist');

    const hintSource = extractFunction(SRC, 'function chordHandShapeArpeggioHint');
    const hintEnd = SRC.indexOf(hintSource, hintStart) + hintSource.length;
    assert.ok(hintEnd > hintStart, 'hand-shape hint helper must follow its sentinel');

    return new Function('markedArpeggio', `
        "use strict";
        function handShapeMarkedArpeggio() { return markedArpeggio; }
        ${extractFunction(SRC, 'function hsStart')}
        ${extractFunction(SRC, 'function hsEnd')}
        ${extractFunction(SRC, 'function hsChordIdNorm')}
        ${SRC.slice(hintStart, hintEnd)}
        return chordHandShapeArpeggioHint;
    `)(markedArpeggio);
}

function shape(entries) {
    return new Map(entries);
}

function infer({
    ch,
    chordShape,
    notes,
    timeWin = null,
    hss = null,
    nextStopBefore = null,
    temporalStopBefore = null,
}) {
    return inferenceHarness().inferArpeggioFromNotePattern(
        ch,
        chordShape,
        notes,
        timeWin,
        hss,
        nextStopBefore,
        temporalStopBefore,
    );
}

function hint(ch, hss, markedArpeggio = true) {
    return handShapeHintHarness(markedArpeggio)(ch, hss, []);
}

function rawInfer({ ch, chordShape, notes, timeWin = null }, stopBefore = null) {
    return inferenceHarness()._inferArpeggioFromNotePatternUncached(
        ch,
        chordShape,
        notes,
        timeWin,
        stopBefore,
    );
}

const FUEL_G5_EVENTS = [
    {
        t: 32.113998,
        next: 33.240002,
        staleEnd: 32.956001,
        leadLaterHits: [33.098999, 33.240002, 33.944, 34.224998, 34.366001],
        rhythmLaterHits: [33.098999, 33.944, 34.224998],
    },
    {
        t: 106.168999,
        next: 107.292999,
        staleEnd: 107.009003,
        leadLaterHits: [107.153, 107.292999, 107.996002, 108.277, 108.417999],
        rhythmLaterHits: [107.153, 107.996002, 108.277],
    },
];

function fuelG5Fixture(event, laterHits) {
    return {
        ch: { t: event.t, id: 4 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: event.t, s: 0, f: 5 },
            ...laterHits.map((t) => ({ t, s: 1, f: 7 })),
        ],
        nextStopBefore: event.next,
        temporalStopBefore: event.staleEnd,
    };
}

test('Fuel Lead G#5 legacy false positives are never promoted by a shorter boundary', () => {
    for (const event of FUEL_G5_EVENTS) {
        const fixture = fuelG5Fixture(event, event.leadLaterHits);
        assert.equal(rawInfer(fixture), false, `${event.t}: legacy scan rejects the dense pattern`);
        assert.equal(
            rawInfer(fixture, event.next),
            true,
            `${event.t}: next-only scan reproduces the missing-gem promotion`,
        );
        assert.equal(
            rawInfer(fixture, event.staleEnd),
            false,
            `${event.t}: stale owner ends before the missing fifth`,
        );
        assert.equal(infer(fixture), false, `${event.t}: guarded result must remain false`);
    }
});

test('Fuel Rhythm G#5 is vetoed when the unique stale owner ends first', () => {
    for (const event of FUEL_G5_EVENTS) {
        const fixture = fuelG5Fixture(event, event.rhythmLaterHits);
        // Rhythm has no nearby following chord, so its raw next boundary lies
        // beyond the fallback horizon. The event.next value is sufficient to
        // prove the same invariant while keeping the fixture compact.
        fixture.nextStopBefore = event.t + 8;

        assert.equal(rawInfer(fixture), true, `${event.t}: legacy scan sees a valid sweep`);
        assert.equal(rawInfer(fixture, fixture.nextStopBefore), true);
        assert.equal(rawInfer(fixture, event.staleEnd), false);
        assert.equal(infer(fixture), false, `${event.t}: stale-owner veto must win`);
    }
});

test('a plain shorter stale scan cannot promote a multi-strum rejection', () => {
    const fixture = {
        ch: { t: 60, id: 0 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 60, s: 0, f: 5 },
            { t: 60.1, s: 1, f: 7 },
            { t: 60.5, s: 0, f: 5 },
            { t: 60.7, s: 1, f: 7 },
            { t: 60.9, s: 0, f: 5 },
        ],
        nextStopBefore: 61.5,
        temporalStopBefore: 60.2,
    };

    assert.equal(rawInfer(fixture), false, 'legacy scan rejects five hits on a two-string shape');
    assert.equal(rawInfer(fixture, fixture.nextStopBefore), false);
    assert.equal(rawInfer(fixture, fixture.temporalStopBefore), true, 'plain stale scan would promote');
    assert.equal(infer(fixture), false, 'guarded conjunction must preserve both earlier false results');
});

test('a valid arpeggio remains true under legacy, next, and stale checks', () => {
    const fixture = {
        ch: { t: 70, id: 0 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 70, s: 0, f: 5 },
            { t: 70.12, s: 1, f: 7 },
        ],
        nextStopBefore: 70.5,
        temporalStopBefore: 70.4,
    };

    assert.equal(rawInfer(fixture), true);
    assert.equal(rawInfer(fixture, fixture.nextStopBefore), true);
    assert.equal(rawInfer(fixture, fixture.temporalStopBefore), true);
    assert.equal(infer(fixture), true);
});

test('one valid mismatched same-onset hand-shape contributes its raw end', () => {
    const result = hint({ t: 10, id: 2 }, [
        { chord_id: 9, start_time: 11, end_time: 11.5 },
        { chord_id: 1, start_time: 10, end_time: 10.75 },
        { chord_id: 8, start_time: 8, end_time: 9 },
    ]);

    assert.equal(result.covered, false);
    assert.equal(result.hs, null);
    assert.equal(result.fallbackInferenceStopBefore, 10.75);
});

test('the no-hand-shape hint exposes a null temporal boundary', () => {
    const result = hint({ t: 10, id: 2 }, []);

    assert.equal(result.covered, false);
    assert.equal(result.fallbackInferenceStopBefore, null);
});

test('same-onset hand-shape selection is order independent and uses 1e-4 tolerance', () => {
    const ch = { t: 10, id: 2 };

    assert.equal(hint(ch, [
        { chord_id: 1, start_time: 12, end_time: 12.4 },
        { chord_id: 1, start_time: 10.000099, end_time: 10.6 },
        { chord_id: 1, start_time: 9, end_time: 9.5 },
    ]).fallbackInferenceStopBefore, 10.6);

    assert.equal(hint(ch, [
        { chord_id: 1, start_time: 10.000101, end_time: 10.6 },
    ]).fallbackInferenceStopBefore, null, 'candidate just outside tolerance must be ignored');

    assert.equal(hint(ch, [
        { chord_id: 1, start_time: 9.999901, end_time: 10.6 },
    ]).fallbackInferenceStopBefore, 10.6, 'negative-side candidate inside tolerance must match');
});

test('ambiguous same-onset hand-shapes do not contribute a temporal veto', () => {
    const result = hint({ t: 10, id: 2 }, [
        { chord_id: 1, start_time: 10, end_time: 10.4 },
        { chord_id: 3, start_time: 10, end_time: 10.8 },
    ]);

    assert.equal(result.covered, false);
    assert.equal(result.fallbackInferenceStopBefore, null);
});

test('invalid, reversed, and nonfinite same-onset hand-shapes are ignored', () => {
    const ch = { t: 10, id: 2 };
    const invalidCandidates = [
        { chord_id: 1, start_time: 10, end_time: 10 },
        { chord_id: 1, start_time: 10, end_time: 10.0000005 },
        { chord_id: 1, start_time: 10, end_time: 9.9 },
        { chord_id: 1, start_time: 10, end_time: Infinity },
        { chord_id: 1, start_time: 10, end_time: NaN },
        { chord_id: 1, start_time: Infinity, end_time: 11 },
        { chord_id: 1, start_time: NaN, end_time: 11 },
    ];

    for (const candidate of invalidCandidates) {
        assert.equal(
            hint(ch, [candidate]).fallbackInferenceStopBefore,
            null,
            `invalid candidate ${JSON.stringify(candidate)} must not own the chord`,
        );
    }

    assert.equal(hint(ch, [
        { chord_id: 1, start_time: 10, end_time: 10.000002 },
    ]).fallbackInferenceStopBefore, 10.000002, 'a finite end beyond the onset epsilon is valid');
});

test('an exact authored hand-shape overrides stale candidates and carries no fallback stop', () => {
    const ch = { t: 10, id: 2 };
    const stale = { chord_id: 1, start_time: 10, end_time: 10.4 };
    const exact = { chord_id: 2, start_time: 9.8, end_time: 10.8 };

    for (const markedArpeggio of [false, true]) {
        const result = hint(ch, [stale, exact], markedArpeggio);
        assert.equal(result.covered, true);
        assert.equal(result.explicit, markedArpeggio);
        assert.equal(result.hs, exact);
        assert.equal(result.fallbackInferenceStopBefore, null);
    }
});

test('synthetic chords retain exact hand-shape behavior', () => {
    const hs = { chord_id: 4, start_time: 80, end_time: 81 };
    const result = hint({ t: 80, id: 4, h3dSynth: true }, [hs], true);

    assert.equal(result.covered, true);
    assert.equal(result.explicit, true);
    assert.equal(result.hs, hs);
    assert.equal(result.fallbackInferenceStopBefore, null);
});

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
        nextStopBefore: 239.619995,
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
        nextStopBefore: 298.126007,
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
        nextStopBefore: 10.5,
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
        nextStopBefore: 20.25,
    }), false);
});

test('a note exactly on the stale hand-shape end is excluded', () => {
    assert.equal(infer({
        ch: { t: 20 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 20, s: 0, f: 5 },
            { t: 20.25, s: 1, f: 7 },
        ],
        nextStopBefore: 21,
        temporalStopBefore: 20.25,
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

test('an explicit hand-shape time window remains authoritative over both fallback stops', () => {
    assert.equal(infer({
        ch: { t: 40 },
        chordShape: shape([[0, 5], [1, 7]]),
        notes: [
            { t: 40, s: 0, f: 5 },
            { t: 40.1, s: 1, f: 7 },
        ],
        timeWin: { tLo: 40, tHi: 40.4 },
        nextStopBefore: 40.05,
        temporalStopBefore: 40.02,
    }), true);
});

test('changing and restoring the next boundary on one chord uses the correct cache key', () => {
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
    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.4),
        true,
    );
});

test('changing and restoring the temporal boundary on one chord uses the correct cache key', () => {
    const { inferArpeggioFromNotePattern } = inferenceHarness();
    const ch = { t: 50 };
    const chordShape = shape([[0, 5], [1, 7]]);
    const notes = [
        { t: 50, s: 0, f: 5 },
        { t: 50.3, s: 1, f: 7 },
    ];

    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.5, 50.35),
        true,
    );
    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.5, 50.2),
        false,
    );
    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, notes, null, null, 50.5, 50.35),
        true,
    );
});

test('inference cache invalidates when note or hand-shape references change', () => {
    const { inferArpeggioFromNotePattern } = inferenceHarness();
    const ch = { t: 90 };
    const chordShape = shape([[0, 5], [1, 7]]);
    const firstNotes = [{ t: 90, s: 0, f: 5 }];
    const completeNotes = [
        { t: 90, s: 0, f: 5 },
        { t: 90.1, s: 1, f: 7 },
    ];
    const firstHss = [];
    const loadedHss = [{ chord_id: 0, start_time: 90, end_time: 90.4 }];

    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, firstNotes, null, firstHss, 90.3, null),
        false,
    );
    assert.equal(
        inferArpeggioFromNotePattern(ch, chordShape, completeNotes, null, firstHss, 90.3, null),
        true,
        'new notes array must invalidate the fallback result',
    );
    assert.equal(
        inferArpeggioFromNotePattern(
            ch,
            chordShape,
            completeNotes,
            { tLo: 90, tHi: 90.4 },
            loadedHss,
            90.05,
            90.05,
        ),
        true,
        'late-loaded hand-shapes must invalidate and make the explicit window authoritative',
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

test('chord-loop passes separate raw next-chord and stale-owner boundaries', () => {
    const start = SRC.indexOf('const hsTimeWinFrame =');
    const end = SRC.indexOf('// Only suppress the chord gems', start);
    assert.ok(start >= 0 && end > start, 'chord-loop arpeggio inference block must exist');
    const caller = SRC.slice(start, end);

    assert.match(
        caller,
        /inferArpeggioFromNotePattern\(\s*ch\s*,\s*chShape\s*,\s*notes\s*,\s*hsTimeWinFrame\s*,\s*bundle\.handShapes\s*,\s*hsTimeWinFrame\s*\?\s*null\s*:\s*nextStrictlyLaterChordTime\(\s*bundle\.chords\s*,\s*ch\.t\s*\)\s*,\s*hsTimeWinFrame\s*\?\s*null\s*:\s*hsHintFrame\.fallbackInferenceStopBefore\s*\)/,
        'fallback inference must receive the raw authored next chord and unique stale-owner end separately',
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
