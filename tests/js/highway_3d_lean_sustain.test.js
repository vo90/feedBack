// Pins the "lean sustain" rendering default in plugins/highway_3d/screen.js.
//
// Dense palm-mute / fret-hand-mute passages are GPU fill-bound: the
// transparent sustain trails/rails stack many blended fragments. Profiling
// (a pinned A/B loop) traced most of the cost to the additive rail BLOOM
// halo, so by default the renderer skips ONLY the bloom (the most expensive
// per-pixel layer) while KEEPING the thin trail/ribbon white outline that
// gives tails their hit/miss-coloured border.
//
// A refactor that (a) flips the lean default off, (b) re-gates the trail or
// ribbon outline behind the lean flag, or (c) stops feeding the outline the
// hit/miss-aware material would silently regress the look or the perf win.
//
// Source-level only — same strategy as the other tests/js/ files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

test('lean sustain rendering is the default (_leanSus starts true)', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    assert.match(
        src,
        /let\s+_leanSus\s*=\s*true\s*;/,
        '_leanSus must default to true so lean rendering is the out-of-the-box behaviour',
    );
});

test('the full-quality look is an opt-out via localStorage h3d_full_sus', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    assert.match(
        src,
        /_leanSus\s*=\s*localStorage\.getItem\(\s*['"]h3d_full_sus['"]\s*\)\s*!==\s*['"]1['"]/,
        "lean must stay on unless localStorage.h3d_full_sus === '1' opts back into the full look",
    );
});

test('exactly one element is gated behind the lean flag, and it is the rail bloom', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    // Only the additive rail bloom may hide behind the lean flag. If a future
    // edit re-gates the trail or ribbon outline behind !_leanSus, this count
    // climbs above 1 and the test fails — that's the regression guard.
    const gates = src.match(/if\s*\(\s*!_leanSus\s*\)/g) || [];
    assert.equal(
        gates.length,
        1,
        'expected exactly one `if (!_leanSus)` gate (the rail bloom); the outline must stay ungated',
    );
    assert.match(
        src,
        /if\s*\(\s*!_leanSus\s*\)\s*\{[\s\S]{0,200}?pSusRailBloom\.get\(\)/,
        'the single lean gate must be the one that wraps pSusRailBloom.get()',
    );
});

test('the trail + ribbon outline always draw and use the hit/miss-aware material', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    // Run the actual material selection with distinct sentinel materials.
    // Current retains its hit-bright edge; RS+ keeps a sharp palette edge
    // while its separate trail body carries the active-hold change.
    const selection = src.match(/const\s+_susOlMat\s*=[\s\S]*?;/);
    assert.ok(selection, 'the sustain outline must select a material');
    const selectMaterial = new Function('rsPlusNotation', '_ndState', '_ndGood', `
        const s = 0;
        const mRsMissRim = 'rs-miss', mRsSusEdge = ['rs-edge'];
        const mMissOutline = 'current-miss', mHitBright = ['current-hit'];
        const mHitSusOutline = 'current-hit-fallback', mSusOutline = 'current-idle';
        ${selection[0]}
        return _susOlMat;
    `);
    for (const rsPlus of [false, true]) {
        assert.equal(selectMaterial(rsPlus, null, false), rsPlus ? 'rs-edge' : 'current-idle');
        assert.equal(selectMaterial(rsPlus, 'hit', true), rsPlus ? 'rs-edge' : 'current-hit');
        assert.equal(selectMaterial(rsPlus, 'active', true), rsPlus ? 'rs-edge' : 'current-hit');
        assert.equal(selectMaterial(rsPlus, 'miss', false), rsPlus ? 'rs-miss' : 'current-miss');
    }
    // Box trail: the outline (trOut, pSusOutline) is drawn and fed _susOlMat,
    // immediately followed by the coloured core (tr, pSus) — both ungated.
    assert.ok(
        /const\s+trOut\s*=\s*pSusOutline\.get\(\)\s*;[\s\S]*?trOut\.material\s*=\s*_susOlMat\s*;[\s\S]{0,400}?const\s+tr\s*=\s*pSus\.get\(\)/.test(src),
        'the box-trail outline (pSusOutline + _susOlMat) must draw alongside the core trail',
    );
    // Ribbon trail (slide / bend / tremolo / vibrato): the outline (olMesh,
    // pSusRibbonOl) is drawn and fed _susOlMat, then the ribbon body.
    assert.ok(
        /const\s+olMesh\s*=\s*pSusRibbonOl\.get\(\)\s*;[\s\S]*?olMesh\.material\s*=\s*_susOlMat\s*;[\s\S]*?const\s+body\s*=\s*pSusRibbon\.get\(\)/.test(src),
        'the ribbon-trail outline (pSusRibbonOl + _susOlMat) must draw alongside the ribbon body',
    );
});
