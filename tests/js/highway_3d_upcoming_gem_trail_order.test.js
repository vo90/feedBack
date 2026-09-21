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

test('a hidden chord open-string stem does not enlarge the trail-overlap footprint', () => {
    const register = new Function(`
        const NW = 5, NH = 3, ND = .25;
        const _trailOrderGems = [], _trailOrderGemBuckets = [[]];
        const _trailOrderGemBucketCounts = [0];
        let _trailOrderGemCount = 0;
        const trailOrderDepthBucket = () => 0;
        ${extractFn('trailOrderRegisterUpcomingGem')}
        return (outline, core) => {
            trailOrderRegisterUpcomingGem({ s: 1, f: 0 }, 1, {}, outline, core);
            return _trailOrderGems[_trailOrderGemCount - 1];
        };
    `)();
    const outline = {
        visible: false,
        position: { x: -19.85, y: 0, z: -10 },
        scale: { x: .06, y: .9, z: .6 },
        rotation: { z: 0 },
    };
    const core = {
        visible: true,
        position: { x: 0, y: 0, z: -9.999 },
        scale: { x: 8, y: .15, z: .6 },
        rotation: { z: 0 },
    };
    const framed = register(outline, core);
    assert.equal(framed.width, 40, 'the full colored bar still participates');
    assert.ok(Math.abs(framed.height - .45) < 1e-10,
        'only the bar height can overlap a trail while the stem is hidden');
    assert.equal(framed.z, core.position.z);
    assert.equal(framed.outline, outline, 'retain the pooled outline for layer bookkeeping');

    outline.visible = true;
    const unframed = register(outline, core);
    assert.equal(unframed.width, 40);
    assert.ok(Math.abs(unframed.height - 2.7) < 1e-10,
        'a restored stem contributes its actual height again');
});

test('ordinary and physical corrections share one finalizer in every mode', () => {
    const finalizer = extractFn('trailOcclusionFinalizeFrame');
    const baselineCall = finalizer.indexOf('trailOrderResolveUpcomingGems()');
    const sourceReturn = finalizer.indexOf('_trailOcclusionSourceCount <= 0');
    const frontMask = finalizer.indexOf('_trailVisibilityFrontMask');
    assert.ok(baselineCall >= 0, 'the shared finalizer must run ordinary ordering');
    assert.ok(
        baselineCall < sourceReturn && sourceReturn < frontMask,
        'ordinary repair must precede the shared physical relationship pass',
    );
    assert.doesNotMatch(
        finalizer,
        /!trailYieldSettings\.enabled/,
        'disabling geometry must not bypass physical ordering',
    );
});

test('mode 0 keeps relationships active but bypasses every narrowing geometry path', () => {
    assert.match(
        source,
        /const\s+trailYieldTargetEvent\s*=\s*trailYieldEventForNote\(n\)/,
        'canonical event lookup must remain active when narrowing is disabled',
    );
    assert.match(
        source,
        /if\s*\(trailYieldTargetEvent\)\s*\{\s*occlusionCount\s*=\s*hwyFillTrailOcclusionTargets\(/,
        'physical relationships must be collected independently of geometry',
    );
    assert.match(
        source,
        /if\s*\(trailYieldSettings\.enabled\)\s*\{\s*const\s+ctx\s*=\s*_trailYieldMatchContext/,
        'fret matching and taper-window collection stay behind the geometry toggle',
    );
    assert.match(
        source,
        /const\s+strandYieldCount\s*=\s*trailYieldSettings\.enabled\s*\?\s*\(n\.f\s*===\s*0\s*\?\s*_trailYieldOpenCountsScratch\[si\]\s*:\s*yieldCount\)\s*:\s*0/,
        'moving ribbons receive no narrowing windows in mode 0',
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
        /slideRibbonUpdatePair\(\s*olMesh\.geometry, body\.geometry[\s\S]{0,800}?trailOrderRegisterStrand\(\s*olMesh, body/,
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

test('ordinary ordering uses reusable depth buckets instead of an all-pairs scan', () => {
    const resolver = extractFn('trailOrderResolveUpcomingGems');
    assert.match(source, /const\s+TRAIL_ORDER_DEPTH_BUCKET_COUNT\s*=\s*32/);
    assert.match(source, /_trailOrderGemBucketCounts\.fill\(0\)/);
    assert.match(resolver, /trailOrderDepthBucket\(strand\.nearZ\)/);
    assert.match(resolver, /_trailOrderGemBuckets\[bucketIndex\]/);
    assert.doesNotMatch(
        resolver,
        /gemIndex\s*<\s*_trailOrderGemCount/,
        'each strand should visit only gem buckets in its visible depth span',
    );
});

test('mode-0 physical collection and finalization stay allocation-free per frame', () => {
    const collector = extractFn('hwyFillTrailOcclusionTargets');
    const finalizer = extractFn('trailOcclusionFinalizeFrame');
    const allocationPattern = /\bnew\s+|\.push\(|\.map\(|\.filter\(|\.slice\(/;

    assert.doesNotMatch(collector, allocationPattern);
    assert.doesNotMatch(finalizer, allocationPattern);
    assert.match(
        source,
        /let\s+_trailOcclusionEventsScratch\s*=\s*new\s+Array\(/,
        'the collector must reuse scratch storage allocated outside the frame loop',
    );
});

test('normal and inverted lower-note modes keep their existing physical scope', () => {
    assert.match(
        source,
        /relationshipFlags\s*=\s*hwyTrailOcclusionFlagsForPair\(\s*sourceEvent\.s,\s*target\.s,\s*_invertedCached/,
    );
    assert.match(
        source,
        /const\s+frontMask\s*=\s*_trailVisibilityFrontMask/,
    );
    assert.match(
        source,
        /const\s+sourceRank\s*=\s*_invertedCached\s*\?\s*nStr\s*-\s*1\s*-\s*source\.s\s*:\s*source\.s/,
        'the feature override must preserve its acyclic visual string order in both layouts',
    );
});

test('chart changes and teardown release trail-visibility high-water references', () => {
    const release = extractFn('trailVisibilityReleaseChartReferences');
    assert.match(release, /_trailYieldMatchedEventsScratch\.fill\(null\)/);
    assert.match(release, /_trailOcclusionEventsScratch\.fill\(null\)/);
    assert.match(release, /_trailOrderGems\.length\s*=\s*0/);
    assert.match(release, /_trailOrderStrands\.length\s*=\s*0/);
    assert.match(release, /_trailOcclusionSources\.length\s*=\s*0/);

    const calls = source.match(/trailVisibilityReleaseChartReferences\(\)/g) || [];
    assert.ok(calls.length >= 3, 'definition, arrangement rebuild, and teardown must all exist');
    assert.match(
        source,
        /trailVisibilityReleaseChartReferences\(\);\s*_trailYieldEventsByFret\s*=\s*hwyBuildTrailYieldEvents/,
    );
});

function haloOrderHarness() {
    return new Function(`
        let _trailYieldFrameId = 1;
        function renderOrderForLayerAtZ(z, layer) {
            return 600 + z * 10 + {
                NOTE_OUTLINE_BEHIND_TRAIL: 0,
                NOTE_CORE_BEHIND_TRAIL: 0.001,
                NOTE_FACE_BEHIND_TRAIL: 0.002,
            }[layer];
        }
        function trailYieldConstrainOwnTrailBehindGem() {}
        ${extractFn('trailYieldApplyBehindLayerRecord')}
        ${extractFn('trailYieldApplyBehindLayers')}
        ${extractFn('trailYieldSetTargetGemBehind')}
        ${extractFn('trailYieldRegisterGem')}
        return {
            register: trailYieldRegisterGem,
            demote: trailYieldSetTargetGemBehind,
            nextFrame() { _trailYieldFrameId++; },
        };
    `)();
}

test('RS+ local halo follows the final gem order before and after crossing registration', () => {
    for (const demoteFirst of [false, true]) {
        const h = haloOrderHarness();
        const event = {};
        const gems = Array.from({ length: 2 }, () => ({
            outline: { renderOrder: 700 }, core: { renderOrder: 700.001 },
            face: { renderOrder: 700.002 }, halo: { renderOrder: 699.99 },
        }));
        if (demoteFirst) h.demote(event, 580);
        for (const gem of gems) h.register(event, -1, gem.outline, gem.core, gem.face, gem.halo);
        h.demote(event, 580);
        // A later-discovered crossing can impose a still lower order. Both
        // duplicate chord/arpeggio emissions must follow the new final order.
        h.demote(event, 570);
        for (const gem of gems) {
            assert.equal(gem.halo.renderOrder, gem.outline.renderOrder - 0.01);
            assert.ok(gem.halo.renderOrder < gem.outline.renderOrder);
            assert.ok(gem.outline.renderOrder < gem.core.renderOrder);
            assert.ok(gem.core.renderOrder < gem.face.renderOrder);
            assert.ok(gem.face.renderOrder < 570);
        }
    }
});

test('Current and disabled-soft-glow registrations release prior RS+ halo references', () => {
    const h = haloOrderHarness(), event = {};
    const oldHalos = [{ renderOrder: 699.99 }, { renderOrder: 699.99 }];
    for (const halo of oldHalos) h.register(event, -1,
        { renderOrder: 700 }, { renderOrder: 700.001 }, null, halo);
    h.nextFrame();
    for (let i = 0; i < 2; i++) h.register(event, -1,
        { renderOrder: 700 }, { renderOrder: 700.001 }, null);
    h.demote(event, 580);
    assert.equal(event._trailYieldGemHalo, null);
    assert.equal(event._trailYieldGemExtraRecords[0].halo, null);
    assert.deepEqual(oldHalos.map(halo => halo.renderOrder), [699.99, 699.99]);
});
