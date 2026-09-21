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
    ${src.slice(src.indexOf('    function slideTrailEnd('), src.indexOf('    // Camera tgtDist building blocks'))}
    ${fn('noteHasVibrato')}
    ${fn('noteHasVisibleMotionSustain')}
    ${fn('noteHasRepeatTechniqueCue')}
    ${fn('chordMuteKind')}
    ${fn('repeatChordMaySuppressGems')}
    ${fn('hwyPostHitTailFadeMul')}
    const isRepeat = options.repeat !== false;
    const chordLinksSlide = !!options.slide;
    const deferChordGems = !!options.defer;
    const _deferFallback = !!options.fallback;
    const suppressSynthChord = !!options.synth;
    const sharedChordHold = options.sharedChordHold || null;
    const _linkNextTargetSet = new Set(options.linked || []);
    const _arpApproachFirstNote = options.first || null;
    const firstInShapeRun = false, _scrChordNote = {};
    const _linkedBendStarts = new WeakMap(), _linkedBendEnds = new WeakMap();
    const _linkedVibratoRuns = new WeakMap();
    const _linkedTrailPaths = { byNote: new WeakMap() };
    const now = 186, chDtEarly = options.dt ?? .460999;
    const ch = { t: now + chDtEarly, id: 1 };
    const usesUnfrettedPosition = n => n.f === 0;
    const chordCX = 0, chordTailHoldS = 0.75, laneWForOpenStrings = 40;
    const chordTailFadeS = .15, chordNextSoon = false, AHEAD = 3;
    const _chNextEventT = options.nextEvent ?? Infinity;
    const chShape = new Map(chordNotes.map(n => [n.s,n.f]));
    const chordOpenBoxW = options.width === undefined ? 40 : options.width;
    const bundle = {chordTemplates:[]};
    const chordTemplateMarkedArpeggio = () => !!options.markedArpeggio;
    const chordSusTrailMatchArpFrame = false, _ghostPrevBuf = new Map();
    const chordHighwayLavenderArpVisual = !!options.arpeggio, chordWireHighDensity = () => false;
    const lastFretForString = [], cameraMode = 'lookahead', drawn = [], drawCalls = [];
    function drawNote(note, at, openX, skipLabel, skipBody, linger, openWidth,
        fromChord, id, sustainFrame, arpBounds, previous, dropLine, linked,
        sharedHold, hasEnclosingChordFrame) {
        drawCalls.push({note:{...note},skipBody,linked,fromChord,hasEnclosingChordFrame});
        if (!skipBody && !linked) drawn.push({ ...note });
    }
    ${between('const chDt = chDtEarly;', 'const suppressRepeatGems = repeatChordMaySuppressGems(')}
    ${between('const suppressRepeatGems = repeatChordMaySuppressGems(', '// ── Arpeggio note brackets')}
    return { retainsChordGems, drawn, isRepeat, drawCalls, chordFrameEligible, hasEnclosingChordFrame };
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
const frameSymbols = new Function('chordNotes', 'compactRepeatFrame', `
    'use strict';
    ${fn('chordMuteKind')}
    const fills = [], lines = [];
    function pool(kind, output) {
        return { get() {
            output.push(kind);
            return { material: { color: { setHex() {} } }, position: { set() {} },
                scale: { set() {} }, rotation: { set() {} } };
        } };
    }
    const pPMXFill = pool('palm', fills), pFHXFill = pool('fretHand', fills);
    const pMuteXLines = pool('palm', lines), pFHXLines = pool('fretHand', lines);
    const z = -1, cx = 0, cY = 1, K = 1, innerW = 2, innerH = 3, thickZ = 1;
    const edgeOp = 1, CHORD_BOX_EDGE_ALPHA = 1, baseRimHex = 0xffffff;
    const renderOrderForLayerAtZ = () => 1;
    ${between('const frameMuteKind =', '} // end if (chDt > 0)')}
    return { fills, lines };
`);
const hasRsPlusFace = src.includes('function rsPlusTechniqueFlags(');
const muteMarkerStart = hasRsPlusFace
    ? 'if (!rsPlusNotation && (n.pm || n.mt || n.fhm)) {'
    : 'if (n.pm || n.mt || n.fhm) {';
const noteMuteSymbols = new Function('n', 'rsPlusNotation', `
    'use strict';
    ${hasRsPlusFace ? fn('rsPlusTechniqueFlags') + fn('rsPlusTechniqueCells') : ''}
    const marks = [];
    const pTechPlane = { get() {
        const mark = { material: {}, scale: { set() {} }, position: { set() {} }, rotation: {} };
        marks.push(mark);
        return mark;
    } };
    const fretHandMuteXSpriteMat = () => 'fretHand', palmMuteXSpriteMat = () => 'palm';
    const _spriteMat2MeshMat = (mark, kind) => ({ kind });
    const _showHit = false, NW = 1, NH = 1, openWScale = 4, x = 0, y = 0;
    const techniqueYNow = 0, noteZ = -1, K = 1, approachRot = 0, techniqueMarkerRenderOrder = 1;
    const _registerIncomingLabelOccluder = () => {};
    const s = n.s, activePalette = [];
    const rsPlusNoteFaceMat = flags => rsPlusTechniqueCells(flags).map(cell => cell.kind);
    ${hasRsPlusFace ? 'if (rsPlusNotation) {'
        + between('const faceFlags = rsPlusTechniqueFlags(n);', '} else if (n.ho || n.po || n.tp)') + '}' : ''}
    ${between(muteMarkerStart, '// hm / hp')}
    return marks.flatMap(mark => mark.material.kind)
        .map(kind => kind === 'palmMute' ? 'palm' : kind === 'fretHandMute' ? 'fretHand' : kind)
        .filter(kind => kind === 'palm' || kind === 'fretHand');
`);

const bbSus2 = () => [
    { s: 1, f: 1 }, { s: 2, f: 3 }, { s: 3, f: 3 }, { s: 4, f: 1 }, { s: 5, f: 1 },
];
function render(notes, options = {}) {
    const output = dispatch(notes, options);
    const frame = frameGeometry(output.isRepeat, output.retainsChordGems, !!options.inverted);
    const noteSymbols = output.drawn.map(note => noteMuteSymbols(note, false));
    if (hasRsPlusFace) {
        assert.deepEqual(output.drawn.map(note => noteMuteSymbols(note, true)), noteSymbols,
            'RS+ face masks and Current overlays convey the same per-note mute instructions');
    }
    return { ...output, frame, frameSymbols: frameSymbols(notes, frame.compactRepeatFrame),
        noteSymbols };
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

test('ordinary visible chord frames supply explicit enclosure context to open members', () => {
    const notes = [{s:0,f:0},{s:1,f:2},{s:2,f:2}];
    for (const dt of [.001,.460999,2.999]) {
        const result = render(notes,{repeat:false,dt});
        assertEnclosed(result);
        assert.equal(result.chordFrameEligible,true);
        assert.equal(result.hasEnclosingChordFrame,true);
        assert.ok(result.drawCalls.every(call => call.fromChord && call.hasEnclosingChordFrame));
    }
    const retainedRepeat = render(notes.map(n => ({...n,ac:true})),{repeat:true});
    assertEnclosed(retainedRepeat);
    assert.equal(retainedRepeat.drawCalls[0].hasEnclosingChordFrame,true);
});

test('open chord enclosure ends at the play line even while member gems can linger', () => {
    const notes = [{s:0,f:0,sus:2},{s:1,f:2,sus:2}];
    for (const dt of [0,-.001,-.6]) {
        const result = render(notes,{repeat:false,dt});
        assert.equal(result.chordFrameEligible,true,'the outer chord context still exists during linger');
        assert.equal(result.hasEnclosingChordFrame,false,'only a flying frame replaces the stem');
        assert.ok(result.drawCalls.length > 0);
        assert.ok(result.drawCalls.every(call => !call.hasEnclosingChordFrame));
    }
    const expired = render(notes,{repeat:false,dt:-.75});
    assert.equal(expired.chordFrameEligible,false);
    assert.equal(expired.hasEnclosingChordFrame,false);
});

test('arpeggios, missing frames and single-member shapes do not claim open-note enclosure', () => {
    const notes = [{s:0,f:0},{s:1,f:2}];
    for (const options of [{arpeggio:true},{width:null},{dt:3},{synth:true},
        {defer:true,fallback:true,arpeggio:true}]) {
        const result = render(notes,{repeat:false,...options});
        assert.equal(result.hasEnclosingChordFrame,false,JSON.stringify(options));
        assert.ok(result.drawCalls.every(call => !call.hasEnclosingChordFrame));
    }
    const single = render(notes.slice(0,1),{repeat:false});
    assert.equal(single.chordFrameEligible,false);
    assert.equal(single.drawCalls[0].hasEnclosingChordFrame,false);
});

test('full frame sides, corners and halo geometry use the same compact decision', () => {
    const edges = between('const withTopFrame =', 'const chordName =');
    assert.doesNotMatch(edges, /\bisRepeat\b/);
    assert.match(edges, /if \(compactRepeatFrame\)/);
    assert.match(edges, /compactRepeatFrame \? 0\.5 : 0\.25/);
    // Full frames carry mute instructions on their retained gems; compact
    // frames alone may carry a shared strum symbol.
    assert.match(src, /const frameMuteKind = compactRepeatFrame \? chordMuteKind\(chordNotes\) : 'none'/);
});

test('Bodom accented muted open and fretted repeats show only their note-level mute symbols', () => {
    // Are You Dead Yet? lead: 59.530 s (open C5) and 64.535 s (fretted Ab5).
    for (const shape of [[{ s: 0, f: 0 }, { s: 1, f: 0 }], [{ s: 1, f: 1 }, { s: 2, f: 3 }]]) {
        const notes = shape.map(n => ({ ...n, sus: 0, pm: true, ac: true, mt: false }));
        const result = render(notes);
        assertEnclosed(result);
        assert.equal(result.drawn.length, 2);
        assert.ok(result.drawn.every(n => n.ac), 'accent flags remain on both visible heads');
        assert.deepEqual(result.noteSymbols, [['palm'], ['palm']]);
        assert.deepEqual(result.frameSymbols, { fills: [], lines: [] });
    }
});

test('uniform gemless repeats have exactly one mute symbol with matching fill and outline', () => {
    for (const [flags, kind] of [[{ pm: true }, 'palm'], [{ mt: true }, 'fretHand'],
        [{ fhm: true }, 'fretHand'], [{ pm: true, mt: true }, 'fretHand'],
        [{ pm: true, fhm: true }, 'fretHand']]) {
        const result = render(bbSus2().map(n => ({ ...n, ...flags })));
        assert.equal(result.drawn.length, 0);
        assert.deepEqual(result.frameSymbols, { fills: [kind], lines: [kind] });
    }
    assert.deepEqual(render(bbSus2()).frameSymbols, { fills: [], lines: [] });
});

test('mixed mute instructions retain the entire chord and each member own symbol', () => {
    for (const [flags, expected] of [
        [[{ pm: true }, {}], [['palm'], []]],
        [[{}, { mt: true }], [[], ['fretHand']]],
        [[{ pm: true }, { fhm: true }], [['palm'], ['fretHand']]],
        [[{ pm: true }, { pm: true, mt: true }], [['palm'], ['fretHand']]],
    ]) {
        // pm/mt are always emitted by the chart wire; fhm is omit-when-false.
        const result = render(flags.map((flag, s) => ({ s, f: s + 2, pm: false, mt: false, ...flag })));
        assertEnclosed(result);
        assert.equal(result.drawn.length, 2);
        assert.deepEqual(result.noteSymbols, expected);
        assert.deepEqual(result.frameSymbols, { fills: [], lines: [] });
    }
});

test('first muted chords and technique-bearing repeats never add frame mute symbols', () => {
    for (const flags of [{ pm: true }, { mt: true }, { fhm: true }, { pm: true, mt: true }]) {
        const notes = bbSus2().map(n => ({ ...n, ...flags }));
        for (const result of [render(notes, { repeat: false }), render(notes, { slide: true }),
            render(notes.map(n => ({ ...n, hp: true })))]) {
            assertEnclosed(result);
            assert.equal(result.noteSymbols.flat().length, 5);
            assert.deepEqual(result.frameSymbols, { fills: [], lines: [] });
        }
    }
});

test('mixed muting does not invent attacks for linked continuations or arpeggio deferral', () => {
    const notes = [{ s: 1, f: 2, pm: true }, { s: 2, f: 4, mt: true }];
    for (const options of [{ linked: notes }, { defer: true }, { synth: true }]) {
        const result = render(notes, options);
        assert.equal(result.drawn.length, 0);
        assert.deepEqual(result.frameSymbols, { fills: [], lines: [] });
    }
    const partial = render(notes, { linked: notes.slice(1) });
    assert.deepEqual(partial.drawn.map(n => n.s), [1]);
    assert.deepEqual(partial.frameSymbols, { fills: [], lines: [] });
});
