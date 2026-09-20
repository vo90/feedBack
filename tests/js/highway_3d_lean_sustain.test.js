// Individual sustain outlines stay visible and preserve verdict colors.
// Shared chord holds are tested separately from these note-level trails.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

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
