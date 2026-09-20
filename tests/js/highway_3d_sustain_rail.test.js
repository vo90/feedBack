// Shared chord hold rails stay below strings and note-level timing geometry.
// Resolver and actual renderer tests cover eligibility, interval and appearance.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

test('sustain-rail pool meshes keep renderOrder 5 so strings (7) stay on top', () => {
    // renderOrder 5 sits below string-line glows (7) so strings render on top
    // of the rail. Chord frame edges are Z-proportional [48,698] and note gems
    // are Z-proportional [50,700], so the flat seed value does not conflict —
    // emitSusStrip() assigns its own Z-proportional RO per segment at draw time.
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    assert.match(
        src,
        /pSusRail\s*=\s*pool\([^)]*,\s*\(\)\s*=>\s*\{[\s\S]*?m\.renderOrder\s*=\s*5\s*;[\s\S]*?\}\s*\)/,
        'pSusRail pool must seed meshes with renderOrder = 5',
    );
});
