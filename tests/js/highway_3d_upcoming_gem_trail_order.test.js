// Regression coverage for transparent sustain meshes hiding upcoming gems.
// The ordinary no-pop correction and lower-note feature priority intentionally
// share one post-draw finalizer; these tests pin that ordering contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const source = fs.readFileSync(SCREEN_JS, 'utf8');

function extractFn(name) {
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

const helpers = new Function(
    '"use strict";\n'
    + extractFn('hwyFootprintsOverlap1D') + '\n'
    + extractFn('hwyTrailFootprintCanCoverGem') + '\n'
    + extractFn('hwyTrailBehindGemOrder') + '\n'
    + 'return { hwyTrailFootprintCanCoverGem, hwyTrailBehindGemOrder };',
)();

test('ordinary ordering keeps a far upcoming gem above a long trail midpoint', () => {
    const trailOutlineOrder = 640.25;
    const gemOutlineOrder = 618.75;
    const fixedTrailOutlineOrder = helpers.hwyTrailBehindGemOrder(
        trailOutlineOrder, gemOutlineOrder,
    );
    const fixedTrailBodyOrder = fixedTrailOutlineOrder + 0.0005;

    assert.ok(trailOutlineOrder > gemOutlineOrder, 'the midpoint order reproduces the pop');
    assert.ok(
        gemOutlineOrder > fixedTrailBodyOrder,
        'both trail faces must paint before the gem from its first visible frame',
    );
});

test('the farthest overlapping gem controls one long transparent trail mesh', () => {
    let order = 680;
    order = helpers.hwyTrailBehindGemOrder(order, 650);
    order = helpers.hwyTrailBehindGemOrder(order, 590);
    order = helpers.hwyTrailBehindGemOrder(order, 625);
    assert.ok(order < 590);
    assert.equal(order, helpers.hwyTrailBehindGemOrder(680, 590));
});

test('visible footprint matching is direction-neutral across string rows', () => {
    const overlaps = helpers.hwyTrailFootprintCanCoverGem;
    assert.equal(
        overlaps(false, 7, 1, 0, 0.2, 7, 1.1, 4, 3),
        true,
        'a visually lower target can overlap a trail above it',
    );
    assert.equal(
        overlaps(false, 7, 1, 4, 0.2, 7, 1.1, 0, 3),
        true,
        'a visually higher target must receive the same no-pop protection',
    );
    assert.equal(
        overlaps(false, 7, 1, 0, 0.2, 10, 1.1, 4, 3),
        false,
        'separate fret footprints do not interact',
    );
    assert.equal(
        overlaps(true, 7, 1, 0, 0.2, 7, 1.1, 2, 0.5),
        false,
        'same-string moving paths still require direct Y overlap',
    );
    assert.equal(
        overlaps(true, 7, 1, 0, 0.2, 7, 1.1, 0.1, 0.5),
        true,
    );
});

test('ordinary correction runs before the optional lower-note mode overrides', () => {
    const finalizer = extractFn('trailOcclusionFinalizeFrame');
    const baselineCall = finalizer.indexOf('trailOrderResolveUpcomingGems()');
    const disabledReturn = finalizer.indexOf('!trailYieldSettings.enabled');
    const frontMask = finalizer.indexOf('hwyTrailOcclusionFrontMask(');
    assert.ok(baselineCall >= 0, 'the shared finalizer must run ordinary ordering');
    assert.ok(
        baselineCall < disabledReturn,
        'ordinary no-pop ordering must also work when trail narrowing is disabled',
    );
    assert.ok(
        disabledReturn < frontMask,
        'the three lower-note modes remain a second, feature-scoped override',
    );
});

test('only emitted upcoming gems and visible sustain strands enter the resolver', () => {
    assert.match(
        source,
        /if\s*\(!\(dt\s*>\s*0\)\s*\|\|\s*!outline\s*\|\|\s*!core\)\s*return/,
    );
    const drawNoteStart = source.indexOf('function drawNote(');
    const gemBlockStart = source.indexOf('if (!effSkipBody', drawNoteStart);
    const gemRegistration = source.indexOf(
        'trailOrderRegisterUpcomingGem(', gemBlockStart,
    );
    const gemBlockEnd = source.indexOf('end gem block', gemBlockStart);
    assert.ok(
        gemBlockStart !== -1
            && gemBlockStart < gemRegistration
            && gemRegistration < gemBlockEnd,
        'culled and suppressed slide-target gems must not affect ordering',
    );

    assert.match(
        source,
        /tr\.scale\.set\(tw, th, segLen\);[\s\S]{0,500}?trailOrderRegisterStrand\(\s*trOut, tr/,
        'straight fretted trails and both open rails use the shared resolver',
    );
    assert.match(
        source,
        /slideRibbonUpdatePositions\(\s*body\.geometry[\s\S]{0,600}?trailOrderRegisterStrand\(\s*olMesh, body/,
        'slides, bends, vibrato, and tremolo ribbons use the same resolver',
    );
});

test('the shared resolver is allocation-free and changes ordering only', () => {
    assert.match(source, /const\s+_trailOrderBoundsScratch\s*=\s*new Float64Array\(4\)/);
    assert.match(source, /_trailOrderGemCount\s*=\s*0;\s*_trailOrderStrandCount\s*=\s*0;/);
    const resolver = extractFn('trailOrderResolveUpcomingGems');
    assert.doesNotMatch(resolver, /\bnew\s+|\.push\(|\.map\(|\.filter\(|\.slice\(/);
    assert.match(resolver, /strand\.outline\.renderOrder\s*=\s*order/);
    assert.match(resolver, /strand\.body\.renderOrder\s*=\s*order\s*\+\s*0\.0005/);
    assert.doesNotMatch(resolver, /\.scale\.|\.position\.|\.material\s*=|\.geometry\s*=/);
});

test('normal and inverted lower-note modes keep their existing physical scope', () => {
    assert.match(
        source,
        /relationshipFlags\s*=\s*hwyTrailOcclusionFlagsForPair\(\s*sourceEvent\.s,\s*target\.s,\s*_invertedCached/,
    );
    assert.match(
        source,
        /const\s+frontMask\s*=\s*hwyTrailOcclusionFrontMask\(\s*trailYieldSettings\.gemInFront,\s*trailYieldSettings\.includeTrails/,
    );
    assert.match(
        source,
        /const\s+sourceRank\s*=\s*_invertedCached\s*\?\s*nStr\s*-\s*1\s*-\s*source\.s\s*:\s*source\.s/,
        'the feature override must preserve its acyclic visual string order in both layouts',
    );
});
