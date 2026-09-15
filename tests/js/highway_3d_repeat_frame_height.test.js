// Execute the renderer's chord dispatch and frame geometry so retained gems
// cannot diverge from a compact frame (Free Fallin' lead, 186.461 s).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}
function between(start, end, from = 0) {
    const first = src.indexOf(start, from), last = src.indexOf(end, first);
    assert.ok(first >= 0 && last > first, start);
    return src.slice(first, last);
}
const dispatch = new Function('chordNotes', 'options', `
    'use strict';
    ${fn('noteHasVibrato')}
    ${fn('noteHasVisibleMotionSustain')}
    ${fn('noteHasRepeatTechniqueCue')}
    ${fn('repeatChordMaySuppressGems')}
    const isRepeat = options.repeat !== false;
    const chordLinksSlide = !!options.slide;
    const deferChordGems = !!options.defer;
    const _deferFallback = !!options.fallback;
    const suppressSynthChord = !!options.synth;
    const _linkNextTargetSet = new Set(options.linked || []);
    const _arpApproachFirstNote = options.first || null;
    const firstInShapeRun = false, _scrChordNote = {};
    const now = 186, ch = { t: 186.460999, id: 1 };
    const usesUnfrettedPosition = () => false;
    const chordCX = 0, chordTailHoldS = 0.75, laneWForOpenStrings = 40;
    const chordSusTrailMatchArpFrame = false, _ghostPrevBuf = new Map();
    const chordHighwayLavenderArpVisual = false, chordWireHighDensity = () => false;
    const lastFretForString = [], cameraMode = 'lookahead', drawn = [];
    function drawNote(note, at, openX, skipLabel, skipBody, linger, openWidth,
        fromChord, id, sustainFrame, arpBounds, previous, dropLine, linked) {
        if (!skipBody && !linked) drawn.push({ ...note });
    }
    ${between('const suppressRepeatGems = repeatChordMaySuppressGems(', '// ── Arpeggio note brackets')}
    return { retainsChordGems, drawn, isRepeat };
`);
const frameGeometry = new Function('isRepeat', 'retainsChordGems', 'inverted', `
    'use strict';
    const nStr = 6, S_GAP = 4;
    const sY = s => (inverted ? s : nStr - 1 - s) * S_GAP;
    ${between('const compactRepeatFrame = isRepeat && !retainsChordGems;', 'const fade =')}
    ${between('const withTopFrame =', '// Full-height frames')}
    return { compactRepeatFrame, yBot, yTop, height, fullChordBoxH, withTopFrame,
        stringY: Array.from({ length: nStr }, (_, s) => sY(s)) };
`);

const bbSus2 = () => [
    { s: 1, f: 1 }, { s: 2, f: 3 }, { s: 3, f: 3 }, { s: 4, f: 1 }, { s: 5, f: 1 },
];
function render(notes, options = {}) {
    const output = dispatch(notes, options);
    return { ...output, frame: frameGeometry(output.isRepeat, output.retainsChordGems, !!options.inverted) };
}
function assertEnclosed(result) {
    assert.ok(result.drawn.length > 0);
    assert.equal(result.frame.height, result.frame.fullChordBoxH);
    assert.equal(result.frame.withTopFrame, true);
    for (const note of result.drawn) {
        const y = result.frame.stringY[note.s];
        assert.ok(y > result.frame.yBot && y < result.frame.yTop, `string ${note.s} lies inside the frame`);
    }
}

test('Free Fallin accented Bbsus2 repeat encloses every retained gem in both string orientations', () => {
    for (const inverted of [false, true]) {
        const notes = bbSus2();
        notes[0].ac = true;
        const result = render(notes, { inverted });
        assert.equal(result.drawn.length, 5);
        assertEnclosed(result);
    }
});

test('ordinary and muted repeated strums retain the compact open-top frame', () => {
    for (const flags of [{}, { pm: true }, { mt: true }, { fhm: true }]) {
        const result = render(bbSus2().map(note => ({ ...note, ...flags })));
        assert.equal(result.drawn.length, 0);
        assert.equal(result.frame.height, result.frame.fullChordBoxH / 2);
        assert.equal(result.frame.withTopFrame, false);
    }
});

test('other retained techniques, slide links and moving sustains use full-height frames', () => {
    const cues = ['hm', 'hp', 'ho', 'po', 'tp', 'slp', 'plk'].map(flag => ({ [flag]: true }));
    cues.push({ bn: 1 }, { bnv: [{ t: 0, v: 1 }] }, { sus: .7, vb: true }, { sus: .7, tr: true });
    for (const cue of cues) {
        const notes = bbSus2();
        Object.assign(notes[0], cue);
        assertEnclosed(render(notes));
    }
    assertEnclosed(render(bbSus2(), { slide: true }));
});

test('a first strum remains full-height even when deferred to an arpeggio note stream', () => {
    const result = render(bbSus2(), { repeat: false, defer: true });
    assert.equal(result.drawn.length, 0);
    assert.equal(result.frame.height, result.frame.fullChordBoxH);
    assert.equal(result.frame.withTopFrame, true);
});

test('deferred, synthesized and fully linked repeats stay compact when no approach gem remains', () => {
    for (const options of [{ defer: true }, { synth: true }, { allLinked: true }]) {
        const notes = bbSus2();
        notes[0].ac = true;
        if (options.allLinked) options.linked = notes;
        const result = render(notes, options);
        assert.equal(result.drawn.length, 0);
        assert.equal(result.frame.height, result.frame.fullChordBoxH / 2);
    }
});

test('arpeggio fallback and partially linked repeats expand when even one gem is retained', () => {
    const notes = bbSus2();
    notes[0].ac = true;
    assertEnclosed(render(notes, { defer: true, fallback: true }));
    assertEnclosed(render(notes, { linked: notes.slice(1), first: notes[0] }));
});

test('full frame sides, corners and halo geometry use the same compact decision', () => {
    const edges = between('const withTopFrame =', 'const chordName =');
    assert.doesNotMatch(edges, /\bisRepeat\b/);
    assert.match(edges, /if \(compactRepeatFrame\)/);
    assert.match(edges, /compactRepeatFrame \? 0\.5 : 0\.25/);
    // PM/FH strum marks and fret-label suppression remain tied to repetition,
    // independent of whether an accompanying technique requires a full frame.
    assert.match(src, /if \(isRepeat && chordNotes\.some\(cn => cn\.pm\)\)/);
    assert.match(src, /if \(isRepeat && chordNotes\.some\(cn => cn\.mt \|\| cn\.fhm\)\)/);
});
