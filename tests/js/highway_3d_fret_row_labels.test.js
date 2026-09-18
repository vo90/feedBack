// Pins the fret-row label visibility and color rules in
// plugins/highway_3d/screen.js.
//
// Rules:
//   1. Only main frets (DOTS: 3,5,7,9,12,…) show a gray label by default.
//      Non-dot frets outside the anchor range are skipped entirely.
//   2. Every fret inside the active anchor range [f0, f1] shows a gold label,
//      even if it is not a dot fret.
//      f0 = anchor.fret,  f1 = anchor.fret + anchor.width - 1
//      e.g. { fret:3, width:4 } → 3,4,5,6 gold (4 is not a dot fret).
//
// Source-level regex checks — no Three.js or DOM required.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

let _src;
function src() {
    if (!_src) _src = fs.readFileSync(SCREEN_JS, 'utf8');
    return _src;
}

test('fret row uses anchorPlayedFretSpanAt to get anchor range [f0, f1]', () => {
    // anchorPlayedFretSpanAt returns { f0: anchor.fret, f1: anchor.fret+width-1 }.
    // This is the correct span for note labels (the played zone), distinct from
    // the wire span used by fret wires (anchorLaneBoundsAt: dMin=fret-1, dMax=fret+width-1).
    assert.match(
        src(),
        /anchorPlayedFretSpanAt\(\s*anchors\s*,\s*now\s*\)/,
        'fret row must call anchorPlayedFretSpanAt(anchors, now)',
    );
});

test('non-main frets outside anchor range are skipped (continue)', () => {
    // The loop must skip frets that are neither in the anchor range nor a
    // DOTS (main) fret, so non-dot frets never show a gray ghost label.
    assert.match(
        src(),
        /if\s*\(\s*!isInAnchor\s*&&\s*!isMainFret\s*\)\s*continue\s*;/,
        'fret row loop must skip non-anchor non-dot frets with: if (!isInAnchor && !isMainFret) continue',
    );
});

test('in-anchor frets use FRET_LABEL_GOLD_HEX color', () => {
    assert.ok(
        /isInAnchor\s*\?\s*FRET_LABEL_GOLD_HEX\s*:\s*_highwayReferenceLabelColor\(FRET_LABEL_IDLE_HEX\)/.test(src()),
        'active fret rows keep gold; idle rows pass the existing idle color through the style-aware reference helper',
    );
});

test('in-anchor frets use opacity 1.0, idle frets use opacity 0.55', () => {
    assert.match(
        src(),
        /lb\.material\.opacity\s*=\s*isInAnchor\s*\?\s*1\.0\s*:\s*0\.55\s*;/,
        'fret row opacity must be 1.0 in anchor and 0.55 idle',
    );
});

test('isMainFret uses DOTS.includes(f) — same dot positions as fret wires and inlays', () => {
    // Main frets are the dot-inlay positions (3,5,7,9,12,15,17,19,21,24).
    // Reusing DOTS keeps the visible set consistent across all fret indicators.
    assert.match(
        src(),
        /const\s+isMainFret\s*=\s*DOTS\.includes\(\s*f\s*\)/,
        'isMainFret must be defined as DOTS.includes(f)',
    );
});

test('isInAnchor checks anchorSpan.f0 and anchorSpan.f1 inclusive bounds', () => {
    assert.match(
        src(),
        /f\s*>=\s*anchorSpan\.f0\s*&&\s*f\s*<=\s*anchorSpan\.f1/,
        'isInAnchor must check f >= anchorSpan.f0 && f <= anchorSpan.f1',
    );
});
