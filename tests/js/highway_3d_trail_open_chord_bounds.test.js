// Regression coverage for trail-visibility footprints around mixed open chords.
// The trail matcher must use the same playable-anchor test and wire-aligned
// fallback bounds as the chord renderer.

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

const resolver = new Function('assert', `
    const NFRETS = 24;
    const ACCENT_RIM_XY_SCALE_MUL = 1.2;
    const NW = 10;
    const OPEN_NOTE_PAD_X = 1;
    let _drawAnchors = [];
    let curX = 0;
    let openLaneWidth = 40;
    const xFret = fret => fret * 10;
    const openNoteLaneBoxW = () => openLaneWidth;
    ${extractFn(src, 'getChartAnchorAt')}
    ${extractFn(src, 'laneBoundsFromAnchor')}
    ${extractFn(src, 'anchorPlayedFretInclusiveSpan')}
    ${extractFn(src, 'playedFretSpanCoversShape')}
    ${extractFn(src, 'chordFallbackLaneBounds')}
    ${extractFn(src, 'trailYieldAddTargetXBounds')}
    ${extractFn(src, 'trailYieldOpenTargetXBounds')}
    return (event, anchors, laneWidth = 40) => {
        _drawAnchors = anchors;
        openLaneWidth = laneWidth;
        const bounds = new Float64Array(2);
        assert.equal(trailYieldOpenTargetXBounds(event, bounds), true);
        return Array.from(bounds);
    };
`)(assert);

const anchor = [{ time: 0, fret: 3, width: 5 }];

test('out-of-span open chord footprints use the four-cell fallback wires', () => {
    const bounds = resolver({
        t: 1,
        standalone: false,
        accent: false,
        chordMeta: { size: 2, minF: 2, maxF: 2 },
    }, anchor);

    assert.deepEqual(bounds, [10.8, 49.2]);
    assert.notDeepEqual(bounds, [21, 69], 'the old anchor-wire footprint must not survive');
});

test('covered open chord footprints retain the authored anchor wires', () => {
    assert.deepEqual(resolver({
        t: 1,
        standalone: false,
        accent: false,
        chordMeta: { size: 2, minF: 3, maxF: 7 },
    }, anchor), [21, 69]);
});

test('open ghost footprints use body width plus fixed-size parentheses, including accents', () => {
    const wideAnchor = [{ time: 0, fret: 3, width: 10 }];
    for (const accent of [false, true]) {
        const bounds = resolver({
            t: 1, standalone: false, accent, ghost: true,
            chordMeta: {size: 2, minF: 3, maxF: 7},
        }, wideAnchor);
        const actualWidth = 100 * 0.96 * (accent ? 1.2 : 1) + 10 * 0.48 * 1.1;
        assert.ok(Math.abs((bounds[1] - bounds[0]) - actualWidth) < 1e-9);
        assert.equal((bounds[0] + bounds[1]) * 0.5, 70);
    }
    const standalone = resolver({t: 1, standalone: true, ghost: true}, []);
    assert.ok(Math.abs(standalone[1] - standalone[0] - (40 * 0.96 + 10 * 0.48 * 1.1)) < 1e-9);
});

test('narrow open ghost lanes respect the actual minimum slab scale', () => {
    const expectedWidth = 10 * 8 * .22 + 10 * .48 * 1.1;
    const standalone = resolver({t:1, standalone:true, ghost:true}, [], 2);
    assert.ok(Math.abs(standalone[1]-standalone[0]-expectedWidth)<1e-9);
    const chord = resolver({t:1, standalone:false, ghost:true,
        chordMeta:{size:2,minF:3,maxF:3}}, [{time:0,fret:3,width:1}]);
    assert.ok(Math.abs(chord[1]-chord[0]-expectedWidth)<1e-9);
    const ordinary = resolver({t:1, standalone:true}, [], 2);
    assert.ok(Math.abs(ordinary[1]-ordinary[0]-2*.96)<1e-9,
        'this ghost fix does not widen unmarked note footprints');
});
