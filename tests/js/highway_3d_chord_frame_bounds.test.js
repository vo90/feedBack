// Regression coverage for chord-frame alignment with an active anchor lane.
// A lane's dMin/dMax are fret-wire coordinates, not playable fret numbers;
// using dMin as an inclusive fret made lower-boundary notes render outside
// their frame (Back In Black lead E5 at 46.624s).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const screenPath = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const screenSrc = fs.readFileSync(screenPath, 'utf8');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const covers = new Function(
    '"use strict";' + extractFn(screenSrc, 'playedFretSpanCoversShape') +
    '\nreturn playedFretSpanCoversShape;',
)();

const fallbackBounds = new Function(
    '"use strict"; const NFRETS = 24;' +
    extractFn(screenSrc, 'laneBoundsFromAnchor') +
    extractFn(screenSrc, 'chordFallbackLaneBounds') +
    '\nreturn chordFallbackLaneBounds;',
)();

test('chord frame rejects a fret on the lower boundary wire', () => {
    // anchor fret=3,width=5 has playable span 3..7 and wire span 2..7.
    // The E5's fret-2 gems are outside and require chord-shape fallback bounds.
    assert.equal(covers({ f0: 3, f1: 7 }, 2, 2), false);
});

test('chord frame accepts frets inside the playable anchor span', () => {
    // anchor fret=2,width=4 has playable span 2..5 and correctly encloses E5.
    assert.equal(covers({ f0: 2, f1: 5 }, 2, 2), true);
    assert.equal(covers({ f0: 2, f1: 5 }, 2, 5), true);
    assert.equal(covers({ f0: 2, f1: 5 }, 2, 6), false);
});

test('chord rendering checks the playable span from the same selected anchor', () => {
    assert.match(screenSrc, /const chAnc = getChartAnchorAt\(anchors, _chAnchorT\);/);
    assert.match(screenSrc, /const chAncB = laneBoundsFromAnchor\(chAnc\);/);
    assert.match(screenSrc, /const chAncPlayed = anchorPlayedFretInclusiveSpan\(chAnc\);/);
    assert.match(screenSrc, /playedFretSpanCoversShape\(chAncPlayed, fMinCh, fMaxCh\)/);
});

test('fallback frame uses four wire-aligned fret cells', () => {
    assert.deepEqual(fallbackBounds(2, 2), { dMin: 1, dMax: 5 });
    assert.deepEqual(fallbackBounds(5, 10), { dMin: 4, dMax: 10 });
    assert.deepEqual(fallbackBounds(22, 22), { dMin: 21, dMax: 24 });
});

test('fallback frame recentres open strings on those exact bounds', () => {
    assert.match(
        screenSrc,
        /else if \(anyFretted\) \{[\s\S]*?const fallbackB = chordFallbackLaneBounds\(fMinCh, fMaxCh\);[\s\S]*?chordFrameXL = xFret\(fallbackB\.dMin\);[\s\S]*?chordFrameXR = xFret\(fallbackB\.dMax\);[\s\S]*?chordFrameAnchorMatched = true;[\s\S]*?chordCX = \(chordFrameXL \+ chordFrameXR\) \* 0\.5;/,
    );
});
