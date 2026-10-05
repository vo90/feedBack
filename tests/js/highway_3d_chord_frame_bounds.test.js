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


const shapeBounds = new Function('const NFRETS = 24;' +
    ['laneBoundsFromAnchor', 'chordFallbackLaneBounds', 'chordShapeLaneBounds'].map(n => extractFn(screenSrc, n)).join('\n') +
    '\nreturn chordShapeLaneBounds;')();

test('each chord starts at its lowest fret with at least four cells regardless of surrounding lane', () => {
    for (const anchor of [null, { fret: 1, width: 24 }, { fret: 3, width: 6 }, { fret: 20, width: 4 }]) {
        for (const [lo, hi, expected] of [[5, 7, [4, 8]], [7, 8, [6, 10]],
            [3, 5, [2, 6]], [7, 10, [6, 10]], [5, 10, [4, 10]], [22, 24, [20, 24]]]) {
            const bounds = shapeBounds(lo, hi, anchor);
            assert.deepEqual([bounds.dMin, bounds.dMax], expected);
        }
    }
});

test('wide and ordinary chord sequence has no inherited geometry', () => {
    const anchor = { fret: 3, width: 10 };
    assert.deepEqual([[3, 12], [7, 8], [3, 5], [5, 7]].map(([lo, hi]) => shapeBounds(lo, hi, anchor)),
        [{ dMin: 2, dMax: 12 }, { dMin: 6, dMax: 10 }, { dMin: 2, dMax: 6 }, { dMin: 4, dMax: 8 }]);
});

test('open-only chords use four cells at a contextual position, including the neck boundary', () => {
    assert.deepEqual(shapeBounds(Infinity, -Infinity, { fret: 3, width: 12 }), { dMin: 2, dMax: 6 });
    assert.deepEqual(shapeBounds(Infinity, -Infinity, null), { dMin: 0, dMax: 4 });
    assert.deepEqual(shapeBounds(Infinity, -Infinity, { fret: 24, width: 1 }), { dMin: 20, dMax: 24 });
});

test('a partial chord hit flashes the complete frame, even when only its upper note was hit', () => {
    const start = screenSrc.indexOf('if (fromChord) {', screenSrc.indexOf('// ── Fret-wire hit flash'));
    const end = screenSrc.indexOf('} else if (n.f > 0', start);
    assert.ok(start >= 0 && end > start);
    const accumulate = new Function('n', 'chordFrameBounds', '_fwChordAcc', `
        const fromChord=true, chordId=1, NFRETS=24, _fwA=1;
        ${screenSrc.slice(start, end)}}
    `);
    const acc = new Map();
    const bounds = shapeBounds(5, 7, {fret:3,width:12});
    accumulate({t:10,f:7}, bounds, acc);
    const entry = acc.get(1);
    assert.equal(entry.minF, 7, 'only the upper member received a hit verdict');
    assert.deepEqual(entry.bounds, {dMin:4,dMax:8}, 'feedback retains the full chord frame');
    const flashStart = screenSrc.indexOf('for (const _fwE of _fwChordAcc.values())');
    const flashEnd = screenSrc.indexOf('if (_fwA > _fwHitIn[_w1])', flashStart);
    const flash = new Function('_fwChordAcc', '_fwHitIn', `
        ${screenSrc.slice(flashStart, flashEnd)}
        if (_fwA > _fwHitIn[_w1]) _fwHitIn[_w1] = _fwA;
        }
    `);
    const hit = new Float64Array(25);
    flash(acc, hit);
    assert.deepEqual(Array.from(hit.keys()).filter(i => hit[i] > 0), [4,8]);
});
