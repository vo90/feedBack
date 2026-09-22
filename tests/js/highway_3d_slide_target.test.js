// Regression coverage for authored linkNext target rendering in
// plugins/highway_3d/screen.js.
//
// The target selector and body policy are pure and tested behaviorally. The
// renderer wiring remains source-level: constructing the full Three.js scene
// in Node would test a large fake DOM/GL harness instead of this contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const src = fs.readFileSync(SCREEN_JS, 'utf8');

function extractFn(source, name) {
    const start = source.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

function sourceBetween(startText, endText) {
    const start = src.indexOf(startText);
    assert.ok(start >= 0, `missing source anchor: ${startText}`);
    const end = src.indexOf(endText, start);
    assert.ok(end > start, `missing source end anchor: ${endText}`);
    return src.slice(start, end);
}

const nextOnStringTolerance = src.match(/const NEXT_ON_STRING_T_EPS = ([\d.]+);/);
assert.ok(nextOnStringTolerance, 'the renderer must declare its onset tolerance');
const NEXT_ON_STRING_T_EPS = Number(nextOnStringTolerance[1]);

const hwyLinkNextTargetNotes = new Function(
    'NEXT_ON_STRING_T_EPS',
    '"use strict";'
    + extractFn(src, 'hwyLinkNextTargetNotes')
    + '\nreturn hwyLinkNextTargetNotes;',
)(NEXT_ON_STRING_T_EPS);

const hwyShouldSuppressNoteBody = new Function(
    '"use strict";'
    + extractFn(src, 'hwyShouldSuppressNoteBody')
    + '\nreturn hwyShouldSuppressNoteBody;',
)();

test('partial-chord LinkNext hides only the held same-fret continuation', () => {
    const linkedOrange = { s: 3, f: 1, sus: 0.207, ln: true };
    const linkedYellow = { s: 1, f: 0, sus: 0.207, ln: true };
    const linkedBlue = { s: 2, f: 0, sus: 0.207, ln: true };
    const orangeContinuation = { t: 19.962999, s: 3, f: 1, ho: true };
    const yellowHammerOn = { t: 19.962999, s: 1, f: 2, ho: true };
    const blueHammerOn = { t: 19.962999, s: 2, f: 2, ho: true };

    const targets = hwyLinkNextTargetNotes(
        [orangeContinuation, yellowHammerOn, blueHammerOn],
        [{
            t: 19.756001,
            notes: [linkedOrange, linkedYellow, linkedBlue],
        }],
    );

    assert.equal(targets.has(orangeContinuation), true);
    assert.equal(targets.has(yellowHammerOn), false);
    assert.equal(targets.has(blueHammerOn), false);
});

test('LinkNext supports standalone and chord-member sources and destinations', () => {
    const standaloneSource = { t: 1, s: 0, f: 3, ln: true };
    const standaloneTarget = { t: 2, s: 0, f: 3 };

    const chordTarget = { s: 1, f: 5 };
    const standaloneToChord = { t: 1, s: 1, f: 5, ln: true };

    const chordSource = { s: 2, f: 4, sl: 7, ln: true };
    const chordSlideTarget = { s: 2, f: 7 };

    const targets = hwyLinkNextTargetNotes(
        [standaloneSource, standaloneTarget, standaloneToChord],
        [
            { t: 1, notes: [chordSource] },
            { t: 2, notes: [chordTarget, chordSlideTarget] },
        ],
    );

    assert.equal(targets.has(standaloneTarget), true, 'standalone to standalone');
    assert.equal(targets.has(chordTarget), true, 'standalone to chord member');
    assert.equal(targets.has(chordSlideTarget), true, 'chord member to chord member slide');
});

test('only the first later onset on the same string can be linked', () => {
    const source = { t: 1, s: 0, f: 3, ln: true };
    const sameOnsetDuplicate = { t: 1, s: 0, f: 3 };
    const interveningAttack = { t: 1.5, s: 0, f: 5 };
    const laterSameFret = { t: 2, s: 0, f: 3 };
    const otherString = { t: 1.5, s: 1, f: 3 };

    const targets = hwyLinkNextTargetNotes(
        [source, sameOnsetDuplicate, interveningAttack, laterSameFret, otherString],
        [],
    );

    assert.equal(targets.has(sameOnsetDuplicate), false, 'same-onset notes do not link');
    assert.equal(targets.has(interveningAttack), false, 'changed-fret attack remains visible');
    assert.equal(targets.has(laterSameFret), false, 'the selector never searches past an attack');
    assert.equal(targets.has(otherString), false, 'links never cross strings');
});

test('explicit slides link while unlinked grace slides and changed-fret attacks stay visible', () => {
    const linkedSlide = { t: 1, s: 0, f: 3, sl: 7, ln: true };
    const linkedTarget = { t: 2, s: 0, f: 7 };
    const graceSlide = { t: 1, s: 1, f: 3, sl: 7 };
    const graceTarget = { t: 2, s: 1, f: 7 };
    const plainLink = { t: 1, s: 2, f: 3, ln: true };
    const changedFretAttack = { t: 2, s: 2, f: 7, ho: true };
    const unpitchedLink = { t: 1, s: 3, f: 5, slu: 2, ln: true };
    const unpitchedTarget = { t: 2, s: 3, f: 2 };
    const pullOffLink = { t: 1, s: 4, f: 7, ln: true };
    const pullOffTarget = { t: 2, s: 4, f: 3, po: true };

    const targets = hwyLinkNextTargetNotes(
        [
            linkedSlide, linkedTarget,
            graceSlide, graceTarget,
            plainLink, changedFretAttack,
            unpitchedLink, unpitchedTarget,
            pullOffLink, pullOffTarget,
        ],
        [],
    );

    assert.equal(targets.has(linkedTarget), true);
    assert.equal(targets.has(graceTarget), false);
    assert.equal(targets.has(changedFretAttack), false);
    assert.equal(targets.has(unpitchedTarget), true);
    assert.equal(targets.has(pullOffTarget), false);
});

test('strict authored links work without sustain and malformed events fail open', () => {
    const linked = { t: 1, s: 0, f: 3, sus: 0, ln: true };
    const target = { t: 2, s: 0, f: 3 };
    const stringFlagSource = { t: 1, s: 1, f: 4, ln: 'true' };
    const stringFlagTarget = { t: 2, s: 1, f: 4 };
    const malformedSource = { t: 1, s: '2', f: 5, ln: true };
    const malformedTarget = { t: 2, s: '2', f: 5 };

    const targets = hwyLinkNextTargetNotes(
        [linked, target, stringFlagSource, stringFlagTarget, malformedSource, malformedTarget],
        [],
    );

    assert.equal(targets.has(target), true);
    assert.equal(targets.has(stringFlagTarget), false);
    assert.equal(targets.has(malformedTarget), false);
});

test('dangling slide links leave both Die By The Sword chords visible', () => {
    const firstChord = [{ s: 1, f: 7 }, { s: 3, f: 9 }];
    const secondChord = [{ s: 1, f: 7 }, { s: 2, f: 9 }];
    const targets = hwyLinkNextTargetNotes([], [
        {
            t: 273.363007,
            notes: [
                { s: 1, f: 7, sl: 5, sus: 0.306, ln: true },
                { s: 2, f: 9, sl: 7, sus: 0.306, ln: true },
            ],
        },
        { t: 273.976013, notes: firstChord },
        { t: 278.873993, notes: secondChord },
    ]);

    for (const note of [...firstChord, ...secondChord]) {
        assert.equal(targets.has(note), false, `string ${note.s} fret ${note.f} remains visible`);
    }
});

test('a late matching slide destination is a visible new attack', () => {
    const source = { t: 1, s: 0, f: 3, sl: 7, sus: 0.25, ln: true };
    const target = { t: 2, s: 0, f: 7 };
    assert.equal(hwyLinkNextTargetNotes([source, target], []).has(target), false);
});

test('timely pitched and unpitched links require their authored slide destination', () => {
    for (const slide of ['sl', 'slu']) {
        const source = { t: 1, s: 0, f: 7, [slide]: 5, sus: 0.25, ln: true };
        const wrongFret = { t: 1.25, s: 0, f: 7 };
        const slideTarget = { t: 1.25, s: 0, f: 5 };
        assert.equal(
            hwyLinkNextTargetNotes([source, wrongFret], []).has(wrongFret),
            false,
            `${slide} must not suppress an attack at the starting fret`,
        );
        assert.equal(
            hwyLinkNextTargetNotes([source, slideTarget], []).has(slideTarget),
            true,
            `${slide} still suppresses its valid continuation`,
        );
    }
});

test('positive sustain bounds links with rounding tolerance and allows overlap', () => {
    const source = { t: 1, s: 0, f: 3, sus: 0.25, ln: true };
    const latest = source.t + source.sus + NEXT_ON_STRING_T_EPS;
    for (const [time, expected, label] of [
        [1.1, true, 'overlapping continuation'],
        [latest - 0.001, true, 'inside the rounding tolerance'],
        [latest, true, 'exactly at the tolerance boundary'],
        [latest + 0.001, false, 'beyond the tolerance boundary'],
    ]) {
        const target = { t: time, s: 0, f: 3 };
        assert.equal(hwyLinkNextTargetNotes([source, target], []).has(target), expected, label);
    }
});

test('explicit links remain suppressed at the hit line without changing legacy skipBody', () => {
    assert.equal(hwyShouldSuppressNoteBody(false, true, 0.5), true);
    assert.equal(hwyShouldSuppressNoteBody(false, true, 0), true);
    assert.equal(hwyShouldSuppressNoteBody(false, true, -0.5), true);

    assert.equal(hwyShouldSuppressNoteBody(true, false, 0.5), true);
    assert.equal(hwyShouldSuppressNoteBody(true, false, 0), false);
    assert.equal(hwyShouldSuppressNoteBody(true, false, -0.5), false);
    assert.equal(hwyShouldSuppressNoteBody(false, false, 0.5), false);
});

test('standalone and chord render paths pass explicit target membership separately', () => {
    assert.doesNotMatch(
        src,
        /_slideTargetSet|const\s+checkSrc/,
        'timing-only target inference must not override explicit LinkNext data',
    );
    assert.ok(
        /_linkNextTargetSet\s*=\s*hwyLinkNextTargetNotes\(notes,\s*bundle\.chords,\s*1e-6,\s*bendLinks\)/.test(src),
        'the chart-static cache includes both note representations and gathers bend-source metadata',
    );

    const standalone = sourceBetween('const _isLinkNextTgt', 'if (arGhostCid != null)');
    assert.match(standalone, /_linkNextTargetSet\.has\(n\)/);
    assert.match(standalone, /drawNote\([\s\S]*?skipLabel,\s*false,/);
    assert.match(standalone, /_arpBoundsForNote\s*!==\s*null,[\s\S]*?_isLinkNextTgt,\s*\);/);

    const chord = sourceBetween('if (!deferChordGems', 'lastFretForString[cn.s] = cn.f;');
    assert.match(chord, /_linkNextTargetSet\.has\(cn\)/);
    assert.match(chord, /chordWireHighDensity\(ch\),[\s\S]*?_isLinkNextTgt,\s*!!sharedChordHold\?\.suppressMemberTrails,\s*belongsToBoxedChord,\s*\);/);
});

test('explicit suppression skips attack/drop-line but leaves the continuation trail', () => {
    const drawNote = extractFn(src, 'drawNote');
    assert.match(
        drawNote,
        /hwyShouldSuppressNoteBody\(skipBody,\s*explicitLinkTarget,\s*dt\)/,
    );
    assert.match(
        drawNote,
        /showDropLine\s*&&\s*!skipBody\s*&&\s*!explicitLinkTarget/,
    );
    assert.match(
        drawNote,
        /!\(skipBody\s*\|\|\s*explicitLinkTarget\)\s*\|\|\s*slideArrowChainPreviewVisible/,
        'linked chains must still respect the chain-preview preference',
    );
    assert.match(
        drawNote,
        /Rendered for ALL notes with sustain, including legacy skipBody/,
        'the sustain trail must remain outside the suppressed attack-body gate',
    );
});

test('LinkNext, repeat gems, and trail caches coexist across the renderer lifecycle', () => {
    const declarations = sourceBetween(
        'let _arpGhostInferRefHs = null;',
        'let _laneRailFlagsRefTpl = null;',
    );
    assert.match(declarations, /let _linkNextTargetSet = null;/);
    assert.match(declarations, /let _trailYieldEventsByFret = \[\];/);
    assert.doesNotMatch(declarations, /_slideTarget(?:Set|NotesRef|ChordsRef)/);

    const prepass = sourceBetween(
        '// ── Linked-target gem-suppression pre-pass',
        '/** Arpeggio lane purple rails',
    );
    const linkNextIndex = prepass.indexOf('_linkNextTargetSet = hwyLinkNextTargetNotes');
    const trailIndex = prepass.indexOf('if (_trailYieldNotesRef !== notes');
    assert.ok(linkNextIndex >= 0, 'LinkNext selection must remain in the chart pre-pass');
    assert.ok(trailIndex > linkNextIndex, 'trail indexing must follow LinkNext selection');

    const chordPath = sourceBetween(
        'const suppressRepeatGems = repeatChordMaySuppressGems(',
        'lastFretForString[cn.s] = cn.f;',
    );
    assert.match(chordPath, /_linkNextTargetSet\.has\(cn\)/);
    assert.match(chordPath, /suppressRepeatGems \|\| suppressSynthChord/);

    const reset = extractFn(src, '_resetStringDependentCaches');
    assert.match(reset, /trailVisibilityReleaseChartReferences\(\);/);

    const teardown = sourceBetween(
        '_measureStarts = []; _measureStartsRef = null;',
        'function canvasSize(canvas)',
    );
    assert.match(
        teardown,
        /_linkNextTargetSet\s*=\s*null;[\s\S]*?_linkNextTargetChordsRef\s*=\s*null;[\s\S]*?trailVisibilityReleaseChartReferences\(\);/,
    );
    assert.doesNotMatch(src, /_slideTarget(?:Set|NotesRef|ChordsRef)|_isSlideTgt/);
});
