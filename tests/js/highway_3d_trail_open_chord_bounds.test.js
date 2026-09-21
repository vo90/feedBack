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

// Use the drawing path's body + outline union as the comparison, so a future
// geometry change cannot silently leave the overlap matcher too narrow. In
// RS+ the outline mesh is a narrow stem inside the open bar's width.
const sizingStart = src.indexOf('const ndRim =');
const sizingEnd = src.indexOf('// ── Lateral face fill', sizingStart);
assert.ok(sizingStart >= 0 && sizingEnd > sizingStart);
const openRimSizing = src.slice(sizingStart, sizingEnd);
const coreSizingStart = src.indexOf('if (n.f === 0)', src.indexOf('const core = pNote.get();'));
const coreSizingEnd = src.indexOf('if (_hitPunch !== 1)', coreSizingStart);
assert.ok(coreSizingStart >= 0 && coreSizingEnd > coreSizingStart);
const openCoreSizing = src.slice(coreSizingStart, coreSizingEnd);

const harness = new Function('assert', `
    const NFRETS = 24;
    const ACCENT_RIM_XY_SCALE_MUL = 1.2;
    const NW = 10;
    const OPEN_NOTE_PAD_X = 1;
    let _drawAnchors = [];
    let curX = 0;
    let rsPlusNotation = false;
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
    return {
        resolve(event, anchors, rsPlus = false, laneWidth = 40) {
            _drawAnchors = anchors;
            rsPlusNotation = rsPlus;
            openLaneWidth = laneWidth;
            const bounds = new Float64Array(2);
            assert.equal(trailYieldOpenTargetXBounds(event, bounds), true);
            return Array.from(bounds);
        },
        renderedOpenWidth(laneWidth, accent, rsPlus) {
            rsPlusNotation = rsPlus;
            const K = 1, NW = 8, NH = 3, S_GAP = 4, nStr = 6;
            const n = { f: 0, ac: accent };
            const x = 0, y = 0, noteZ = 0, techniqueYNow = 0;
            const fromChord = true, _leftyCached = false, rsMiss = false, rsHit = false;
            const sY = s => s * S_GAP, gNote = {}, mRsOpenStem = {};
            const rimXY = !rsPlusNotation && n.ac ? ACCENT_RIM_XY_SCALE_MUL : 1;
            const rimZ = 1, openSlabThickMul = 1;
            const openWScale = laneWidth * 0.96 / 40;
            let rimWidth = 0, rimX = 0, coreWidth = 0;
            const outline = {
                position: { set(x) { rimX = x; } },
                scale: { set(x) { rimWidth = NW * x; } },
            };
            const core = { scale: { set(x) { coreWidth = NW * x; } } };
            ${openRimSizing}
            ${openCoreSizing}
            return Math.max(coreWidth / 2, rimX + rimWidth / 2)
                - Math.min(-coreWidth / 2, rimX - rimWidth / 2);
        },
    };
`)(assert);
const resolver = harness.resolve;

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

test('RS+ open footprints reach the actual ordinary and accent bar/stem union in every lane placement', () => {
    const placements = [
        { standalone: true, laneWidth: 40, center: 45 },
        { chordMeta: { size: 2, minF: 3, maxF: 7 }, laneWidth: 50, center: 45 },
        { chordMeta: { size: 2, minF: 2, maxF: 2 }, laneWidth: 40, center: 30 },
    ];
    for (const placement of placements) {
        for (const accent of [false, true]) {
            const event = { t: 1, standalone: !!placement.standalone, chordMeta: placement.chordMeta, accent };
            const [left, right] = resolver(event, anchor, true);
            const width = harness.renderedOpenWidth(placement.laneWidth, accent, true);
            assert.ok(Math.abs(left - (placement.center - width / 2)) < 1e-10);
            assert.ok(Math.abs(right - (placement.center + width / 2)) < 1e-10);
            // An approaching strand at the visible rim must be a potential
            // overlap; the old Current-only estimate rejected this location.
            const nearRim = placement.center + width / 2 - 0.001;
            assert.ok(nearRim >= left && nearRim <= right);
            assert.ok(right < placement.center + width / 2 + 0.001,
                'decorative halo padding must not enlarge the attack footprint');
        }
    }
});

test('Current open footprint policy survives a style round trip', () => {
    for (const accent of [false, true]) {
        const event = { t: 1, standalone: false, accent, chordMeta: { size: 2, minF: 3, maxF: 7 } };
        const before = resolver(event, anchor);
        resolver(event, anchor, true);
        assert.deepEqual(resolver(event, anchor), before);
        const expectedWidth = 48 * (accent ? 1.2 : 1);
        assert.ok(Math.abs(before[0] - (45 - expectedWidth / 2)) < 1e-10);
        assert.ok(Math.abs(before[1] - (45 + expectedWidth / 2)) < 1e-10);
    }
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
    const standalone = resolver({t:1, standalone:true, ghost:true}, [], false, 2);
    assert.ok(Math.abs(standalone[1]-standalone[0]-expectedWidth)<1e-9);
    const chord = resolver({t:1, standalone:false, ghost:true,
        chordMeta:{size:2,minF:3,maxF:3}}, [{time:0,fret:3,width:1}]);
    assert.ok(Math.abs(chord[1]-chord[0]-expectedWidth)<1e-9);
    const ordinary = resolver({t:1, standalone:true}, [], false, 2);
    assert.ok(Math.abs(ordinary[1]-ordinary[0]-2*.96)<1e-9,
        'this ghost fix does not widen unmarked note footprints');
});

test('RS+ open ghost bounds include core parentheses while preserving the bar width', () => {
    const wideAnchor = [{ time: 0, fret: 3, width: 10 }];
    for (const accent of [false, true]) {
        const bounds = resolver({
            t: 1, standalone: false, accent, ghost: true,
            chordMeta: { size: 2, minF: 3, maxF: 7 },
        }, wideAnchor, true);
        const width = 100 * 0.96 + 10 * 0.48 * (accent ? 1.5 : 1);
        assert.ok(Math.abs(bounds[1] - bounds[0] - width) < 1e-9);
        assert.equal((bounds[0] + bounds[1]) / 2, 70);
    }
});
