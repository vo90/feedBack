// Pins the localized sustain reveal in plugins/highway_3d/screen.js.
// The helpers are pure but live in the highway's classic-script IIFE, so this
// test evaluates only their self-contained source block.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

function loadHelpers() {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const start = src.indexOf('    function hwyFootprintsOverlap1D(');
    const end = src.indexOf('    /** Fixed pre-impact ramp window', start);
    assert.notEqual(start, -1, 'trail-yield helper block start not found');
    assert.notEqual(end, -1, 'trail-yield helper block end not found');
    const depthStart = src.indexOf('    const RENDER_ORDER_LAYER_STACK =');
    const depthEnd = src.indexOf('    /** Labels yield to the actual final order', depthStart);
    assert.notEqual(depthStart, -1, 'render-order helper block start not found');
    assert.notEqual(depthEnd, -1, 'render-order helper block end not found');
    const block = src.slice(start, end);
    return vm.runInNewContext(
        'const K = 1; const NFRETS = 24; const MAX_RENDER_STRINGS = 8;\n'
        + src.slice(depthStart, depthEnd)
        + block
        + '\n({ renderOrderForLayerAtZ, hwyBuildTrailYieldEvents, hwyFillTrailYieldTimes, hwyFillTrailCrossingWindows, hwyTrailOverlapsGemX, hwyTrailYieldAmountAt,'
        + ' hwyTrailFootprintsCanOcclude, hwyTrailPriorityWorldZ, hwyTrailPriorityStringOffset, hwyTrailYieldGemLayer,'
        + ' hwyTrailTargetBehindOrder, hwyBuildTrailOcclusionIndex, hwyFillTrailOcclusionTargets, hwyTrailOcclusionFarthestTargetTime, hwyTrailVisibilityScratchCapacity, hwyMergeTrailPriorityWorldZ, hwyTrailOcclusionFrontMask, hwyTrailVisibilityFrontMask, hwyTrailOcclusionFlagsForPair, hwyTrailOcclusionTrailShouldStayBehind, hwyTrailOcclusionTrailShouldMoveInFront,'
        + ' TRAIL_OCCLUSION_GEM, TRAIL_OCCLUSION_TRAIL, TRAIL_OCCLUSION_TRAIL_FRONT, TRAIL_YIELD_DEFAULTS })',
    );
}

function loadSlideOffsetHelpers() {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const start = src.indexOf('    function slideTrailEnd(');
    const end = src.indexOf('    // Camera tgtDist building blocks', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return vm.runInNewContext(
        'const fretMid = f => f * 10;\n'
        + src.slice(start, end)
        + '\n({ slideTrailEnd, slideOffsetWorldX })',
    );
}

function loadTremoloOffset() {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const start = src.indexOf('        function sustainMotionWidth(');
    const end = src.indexOf('        /** Rendered X centre', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return vm.runInNewContext(
        'const TREMOLO_BUMP_S = 0.06; const rsPlusNotation = false; const RSPLUS_SUSTAIN_STROKE_SCALE = 0.5;\n'
        + src.slice(start, end)
        + '\ntremoloOffsetWorldX',
    );
}

const helpers = loadHelpers();

test('reviewed trail-visibility defaults match the showcase settings', () => {
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.enabled, true);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.gemInFront, false);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.includeTrails, false);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.minScale, 0.30);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.leadTime, 0.50);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.taperDuration, 0.05);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.holdAfter, 0.05);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.recoverDuration, 0.05);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.endLeadTime, 0.50);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.endTaperDuration, 0.05);
});

test('the four visibility modes share physical order and expose only intended promotions', () => {
    const frontMask = helpers.hwyTrailVisibilityFrontMask;
    assert.equal(
        frontMask(false, false, false),
        0,
        'mode 0: physical order remains active while geometry is disabled',
    );
    assert.equal(
        frontMask(false, true, true),
        0,
        'disabled narrowing also disables persisted foreground preferences',
    );
    assert.equal(
        frontMask(true, false, false),
        0,
        'mode 1: narrowing does not alter physical gem or trail order',
    );
    assert.equal(
        frontMask(true, false, true),
        0,
        'the child trail preference cannot bypass its gem parent',
    );
    assert.equal(
        frontMask(true, true, false),
        helpers.TRAIL_OCCLUSION_GEM,
        'mode 2: promote the gem but retain physical trail stacking',
    );
    assert.equal(
        frontMask(true, true, true),
        helpers.TRAIL_OCCLUSION_GEM | helpers.TRAIL_OCCLUSION_TRAIL,
        'mode 3: promote both parts of the lower note',
    );
});

test('trail visibility relationships cannot invert the physical string hierarchy', () => {
    const normalize = helpers.hwyTrailOcclusionFlagsForPair;
    const gem = helpers.TRAIL_OCCLUSION_GEM;
    const trail = helpers.TRAIL_OCCLUSION_TRAIL;

    assert.equal(
        normalize(4, 3, false, gem | trail), 0,
        'a normal-view bend toward a visually higher string cannot create a relationship',
    );
    assert.equal(
        normalize(3, 4, false, trail), trail,
        'the opposing normal-view physical edge retains trail ordering',
    );
    assert.equal(
        normalize(1, 2, true, gem | trail), 0,
        'the mirrored bend/vibrato case is also rejected when inverted',
    );
    assert.equal(
        normalize(2, 1, true, trail), trail,
        'the opposing inverted physical edge retains trail ordering',
    );
    assert.equal(
        normalize(2, 2, false, gem | trail), 0,
        'same-string relationships cannot create gem or trail priority edges',
    );
});

test('per-fret onset indexes are sorted, bounded, and merge duplicate members', () => {
    const notes = [
        { t: 3, s: 2, f: 3, sus: 2, sl: 9, tr: true },
        { t: 4, s: 8, f: 3, sus: 1 },
        { t: 5, s: 1, f: 25, sus: 1 },
    ];
    const chords = [
        { t: 2, notes: [{ s: 4, f: 3, sus: 0 }] },
        { t: 3, notes: [{ s: 2, f: 3, sus: 4 }] },
    ];
    const eventsByFret = helpers.hwyBuildTrailYieldEvents(notes, chords, 6);
    const events = eventsByFret[3];
    assert.deepEqual(
        Array.from(events, ({ t, s, f, end }) => [t, s, f, end]),
        [[2, 4, 3, 2], [3, 2, 3, 7]],
    );
    assert.equal(events[0].chordMeta.size, 1);
    assert.equal(events[1].standalone, true);
    assert.ok(events[1].chordMeta, 'duplicate standalone/chord metadata is retained');
    assert.equal(events[1].sl, 9, 'the indexed event retains its rendered slide path');
    assert.equal(events[1].tr, true, 'the indexed event retains repeated lateral motion');
    assert.equal(events[1].sus, 4, 'deduplication retains the complete sustain path');
});

test('one footprint rule requires a visually lower target and overlapping X geometry', () => {
    const canOcclude = helpers.hwyTrailFootprintsCanOcclude;
    assert.equal(canOcclude(true, 10, 2, 11, 2), true);
    assert.equal(canOcclude(true, 10, 2, 13, 2), false);
    assert.equal(
        canOcclude(false, 10, 2, 11, 2),
        false,
        'bend/vibrato Y motion cannot make a visually higher target qualify',
    );
});

test('slides qualify at their rendered fret rather than their starting fret', () => {
    const { slideTrailEnd, slideOffsetWorldX } = loadSlideOffsetHelpers();
    const note = { t: 0, s: 1, f: 3, sus: 2, sl: 7 };
    const slideSt = slideTrailEnd(note);
    const trailX = 30 + slideOffsetWorldX(note, 1, slideSt);
    assert.ok(trailX > 40 && trailX < 50);
    assert.equal(
        helpers.hwyTrailFootprintsCanOcclude(
            true, trailX, 4.65, trailX, 5.5,
        ),
        true,
    );
    assert.equal(
        helpers.hwyTrailFootprintsCanOcclude(
            true, trailX, 4.65, 30, 5.5,
        ),
        false,
        'the old starting-fret match must not survive after the slide moves away',
    );

    const unpitched = { ...note, sl: undefined, slu: 7 };
    assert.notEqual(
        slideOffsetWorldX(unpitched, 1, slideTrailEnd(unpitched)),
        slideOffsetWorldX(note, 1, slideSt),
        'pitched and unpitched easing both feed the rendered-position matcher',
    );
});

test('tremolo can reach an adjacent high-fret footprint without becoming a multi-fret slide', () => {
    const tremoloOffsetWorldX = loadTremoloOffset();
    const trailW = 4.65;
    const offset = tremoloOffsetWorldX({ t: 0, sus: 1, tr: true }, 0, trailW);
    assert.ok(offset > 0 && offset < trailW * 0.5);
    assert.equal(
        helpers.hwyTrailFootprintsCanOcclude(
            true, 0, trailW, 6, 5.5,
        ),
        false,
    );
    assert.equal(
        helpers.hwyTrailFootprintsCanOcclude(
            true, offset, trailW, 6, 5.5,
        ),
        true,
    );
});

test('wide open targets use footprint overlap instead of a fret-zero special case', () => {
    const canOcclude = helpers.hwyTrailFootprintsCanOcclude;
    assert.equal(canOcclude(true, 20, 4.65, 50, 5.5), false);
    assert.equal(canOcclude(true, 20, 4.65, 50, 80), true);
});

test('candidate filters can apply the shared footprint rule beyond a fret bucket', () => {
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    const crossFretEvent = { t: 1, s: 0, f: 7, end: 1 };
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [crossFretEvent], 0, 1, 0.5, 2, false, starts, ends,
            0, 2, helpers.TRAIL_YIELD_DEFAULTS,
            event => event.f === 7,
        ),
        1,
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 1, s: 2, f: 5, end: 1 }], 0, 1, 0.5, 2, false, starts, ends,
            0, 2, helpers.TRAIL_YIELD_DEFAULTS,
            () => false,
        ),
        0,
    );
});

test('only covered notes on visually lower strings create yield windows', () => {
    const events = [
        { t: 0.8, s: 0, end: 0.8 }, // same string
        { t: 0.9, s: 1, end: 0.9 }, // lower, short
        { t: 1.1, s: 2, end: 4.1 }, // lower, sustained
        { t: 1.1, s: 3, end: 2.1 }, // same wave: shorter than the prior sustain
    ];
    const starts = new Float64Array(8);
    const ends = new Float64Array(8);
    const count = helpers.hwyFillTrailYieldTimes(
        events, 0, 0, 0.5, 20, false, starts, ends,
    );
    assert.equal(count, 2);
    assert.deepEqual(Array.from(starts.slice(0, count)), [0.9, 1.1]);
    assert.deepEqual(Array.from(ends.slice(0, count)), [0.9, 4.1]);

    const separatedT = 0.8 + helpers.TRAIL_YIELD_DEFAULTS.endLeadTime + 0.01;
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: separatedT, s: 1, end: separatedT }],
            0, 0, 0.5, 0.8, false, starts, ends,
        ),
        0,
        'a note beyond the configured endpoint window must leave the trail unchanged',
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes([{ t: 0.9, s: 4, end: 0.9 }], 0, 5, 0.5, 20, true, starts, ends),
        1,
        'inverted highways reverse which string is visually lower',
    );
});

test('physical-order index reuses canonical events and bounds older active trails', () => {
    const byFret = helpers.hwyBuildTrailYieldEvents([
        { t: 4, s: 2, f: 12, sus: 1 },
        { t: 1, s: 2, f: 5, sus: 8 },
        { t: 3, s: 1, f: 7, sus: 1 },
    ], [], 6);
    const byString = helpers.hwyBuildTrailOcclusionIndex(byFret, 6);
    assert.equal(byString[2].events[0], byFret[5][0]);
    assert.equal(byString[2].events[1], byFret[12][0]);
    assert.deepEqual(Array.from(byString[2].prefixMaxEnd), [9, 9]);
});

test('scratch capacity follows chart density instead of a fixed 128-target ceiling', () => {
    const dense = [];
    for (let i = 0; i < 220; i++) {
        dense.push({ t: i * 0.005, s: i % 6, f: 7, sus: 0.4 });
    }
    const byFret = helpers.hwyBuildTrailYieldEvents(dense, [], 6);
    const capacity = helpers.hwyTrailVisibilityScratchCapacity(byFret, 3.5, 128);
    assert.ok(capacity > 128, 'dense authored windows must grow chart-owned scratch storage');
    assert.ok(capacity >= 220, 'the densest visible onset wave must fit without truncation');
});

test('mode-3 future priority is one scalar and is independent of output capacity', () => {
    const source = { t: 0, s: 1, f: 7, sus: 20 };
    const targets = [];
    for (let i = 0; i < 180; i++) {
        targets.push({ t: 0.1 + i * 0.05, s: 2, f: 7, sus: 4 });
    }
    const byFret = helpers.hwyBuildTrailYieldEvents([source, ...targets], [], 6);
    const index = helpers.hwyBuildTrailOcclusionIndex(byFret, 6);
    assert.equal(
        helpers.hwyTrailOcclusionFarthestTargetTime(index, 0, 20, 1, false),
        13.05,
    );
    assert.equal(
        helpers.hwyTrailOcclusionFarthestTargetTime(index, 0, 20, 1, true),
        -Infinity,
        'inversion must mirror which strings are visually lower',
    );
});

test('cross-fret physical ordering distinguishes covered gems from overlapping trails', () => {
    const byFret = helpers.hwyBuildTrailYieldEvents([
        { t: 0, s: 1, f: 7, sus: 5 },       // source
        { t: 1, s: 2, f: 15, sus: 0 },      // later lower gem, different fret
        { t: -1, s: 3, f: 3, sus: 3 },      // older lower trail
        { t: 0, s: 4, f: 19, sus: 2 },      // simultaneous lower trail
        { t: 1, s: 0, f: 7, sus: 2 },       // physically above control
    ], [], 6);
    const index = helpers.hwyBuildTrailOcclusionIndex(byFret, 6);
    const events = new Array(8);
    const flags = new Uint8Array(8);
    const starts = new Float64Array(8);
    const ends = new Float64Array(8);
    const count = helpers.hwyFillTrailOcclusionTargets(
        index, 0, 5, 1, 0, 5, false,
        events, flags, starts, ends,
    );
    assert.equal(count, 3);
    assert.deepEqual(Array.from(events.slice(0, count), event => event.s), [2, 3, 4]);
    assert.deepEqual(Array.from(flags.slice(0, count)), [
        helpers.TRAIL_OCCLUSION_GEM,
        helpers.TRAIL_OCCLUSION_TRAIL,
        helpers.TRAIL_OCCLUSION_TRAIL,
    ]);
    assert.deepEqual(Array.from(starts.slice(0, count)), [1, 0, 0]);
    assert.deepEqual(Array.from(ends.slice(0, count)), [1, 2, 2]);
});

test('mode 3 promotes only trails attached to genuinely later lower targets', () => {
    const source = { t: 158, s: 3, f: 7, sus: 1.5 };
    const olderLowerTrail = { t: 156, s: 4, f: 7, sus: 7 };
    const laterLowerTrail = { t: 158.5, s: 5, f: 7, sus: 2 };
    const byFret = helpers.hwyBuildTrailYieldEvents(
        [source, olderLowerTrail, laterLowerTrail], [], 6,
    );
    const index = helpers.hwyBuildTrailOcclusionIndex(byFret, 6);
    const events = new Array(4);
    const flags = new Uint8Array(4);
    const starts = new Float64Array(4);
    const ends = new Float64Array(4);
    const count = helpers.hwyFillTrailOcclusionTargets(
        index, source.t, source.t + source.sus, source.s, 157, 160, false,
        events, flags, starts, ends,
    );
    assert.equal(count, 2);
    assert.equal(events[0].s, 4, 'the older green trail remains a physical-order target');
    assert.equal(flags[0], helpers.TRAIL_OCCLUSION_TRAIL);
    assert.equal(events[1].s, 5, 'the later purple trail is an upcoming target');
    assert.equal(
        flags[1],
        helpers.TRAIL_OCCLUSION_GEM
            | helpers.TRAIL_OCCLUSION_TRAIL
            | helpers.TRAIL_OCCLUSION_TRAIL_FRONT,
    );

    const mode2 = helpers.hwyTrailOcclusionFrontMask(true, false);
    const mode3 = helpers.hwyTrailOcclusionFrontMask(true, true);
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldStayBehind(mode3, flags[0]),
        true,
        'mode 3 must not pull an older physically lower trail over the new upper trail',
    );
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldStayBehind(mode2, flags[1]),
        true,
        'gem-only mode retains physical trail stacking for a later target',
    );
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldStayBehind(mode3, flags[1]),
        false,
        'mode 3 may promote the trail attached to a genuinely upcoming lower gem',
    );
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldMoveInFront(mode3, flags[1]),
        true,
        'mode 3 must positively order the later attached trail in front',
    );
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldMoveInFront(mode2, flags[1]),
        false,
        'gem-only mode must not move the attached trail in front',
    );
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldMoveInFront(mode3, flags[0]),
        false,
        'an older lower trail must retain physical stacking in mode 3',
    );
});

test('the sustained-target showcase relationship is stable in all four modes', () => {
    const source = { t: 14, s: 1, f: 9, sus: 7 };
    const target = { t: 16, s: 2, f: 9, sus: 3 };
    const index = helpers.hwyBuildTrailOcclusionIndex(
        helpers.hwyBuildTrailYieldEvents([source, target], [], 6),
        6,
    );
    const events = new Array(2);
    const flags = new Uint8Array(2);
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    const count = helpers.hwyFillTrailOcclusionTargets(
        index, source.t, source.t + source.sus, source.s,
        14, source.t + source.sus, false,
        events, flags, starts, ends,
    );
    assert.equal(count, 1);
    assert.equal(events[0].t, 16);
    assert.equal(
        flags[0],
        helpers.TRAIL_OCCLUSION_GEM
            | helpers.TRAIL_OCCLUSION_TRAIL
            | helpers.TRAIL_OCCLUSION_TRAIL_FRONT,
    );

    const mode0 = helpers.hwyTrailVisibilityFrontMask(false, true, true);
    const standard = helpers.hwyTrailVisibilityFrontMask(true, false, false);
    const gemOnly = helpers.hwyTrailVisibilityFrontMask(true, true, false);
    const gemAndTrail = helpers.hwyTrailVisibilityFrontMask(true, true, true);
    assert.equal(mode0, standard, 'modes 0 and 1 share physical render priority');
    assert.equal(helpers.hwyTrailOcclusionTrailShouldStayBehind(mode0, flags[0]), true);
    assert.equal(helpers.hwyTrailOcclusionTrailShouldStayBehind(standard, flags[0]), true);
    assert.equal(helpers.hwyTrailOcclusionTrailShouldStayBehind(gemOnly, flags[0]), true);
    assert.equal(helpers.hwyTrailOcclusionTrailShouldStayBehind(gemAndTrail, flags[0]), false);
    assert.equal(
        helpers.hwyTrailOcclusionTrailShouldMoveInFront(gemAndTrail, flags[0]),
        true,
    );

    const targetOrder = 510.25;
    const sourceNaturalOrder = 560.5;
    const sourceFrontFixedOrder = helpers.hwyTrailTargetBehindOrder(
        targetOrder, sourceNaturalOrder,
    );
    assert.ok(
        sourceFrontFixedOrder + 0.0005 < targetOrder,
        'both source faces must paint before the later target trail',
    );
});

test('older-trail physical stacking and later-target promotion mirror when inverted', () => {
    const source = { t: 20, s: 2, f: 9, sus: 2 };
    const olderLowerTrail = { t: 18, s: 1, f: 7, sus: 6 };
    const laterLowerTrail = { t: 21, s: 0, f: 12, sus: 2 };
    const index = helpers.hwyBuildTrailOcclusionIndex(
        helpers.hwyBuildTrailYieldEvents(
            [source, olderLowerTrail, laterLowerTrail], [], 6,
        ),
        6,
    );
    const events = new Array(4);
    const flags = new Uint8Array(4);
    const starts = new Float64Array(4);
    const ends = new Float64Array(4);
    const count = helpers.hwyFillTrailOcclusionTargets(
        index, source.t, source.t + source.sus, source.s, 19, 23, true,
        events, flags, starts, ends,
    );
    assert.equal(count, 2);
    assert.equal(events[0].s, 0);
    assert.equal(events[1].s, 1);
    assert.equal(
        flags[0],
        helpers.TRAIL_OCCLUSION_GEM
            | helpers.TRAIL_OCCLUSION_TRAIL
            | helpers.TRAIL_OCCLUSION_TRAIL_FRONT,
    );
    assert.equal(flags[1], helpers.TRAIL_OCCLUSION_TRAIL);
});

test('physical-order collection reverses with inversion and stays in the visible window', () => {
    const byFret = helpers.hwyBuildTrailYieldEvents([
        { t: 0, s: 4, f: 7, sus: 8 },
        { t: 1, s: 3, f: 3, sus: 2 },
        { t: 2, s: 5, f: 12, sus: 2 },
        { t: 6, s: 2, f: 19, sus: 2 },
    ], [], 6);
    const index = helpers.hwyBuildTrailOcclusionIndex(byFret, 6);
    const events = new Array(8);
    const flags = new Uint8Array(8);
    const starts = new Float64Array(8);
    const ends = new Float64Array(8);
    const count = helpers.hwyFillTrailOcclusionTargets(
        index, 0, 8, 4, 0, 4, true,
        events, flags, starts, ends,
    );
    assert.equal(count, 1);
    assert.equal(events[0].s, 3, 'inverted view treats the lower string index as visually lower');
    assert.equal(
        flags[0],
        helpers.TRAIL_OCCLUSION_GEM
            | helpers.TRAIL_OCCLUSION_TRAIL
            | helpers.TRAIL_OCCLUSION_TRAIL_FRONT,
    );
});

test('independent shape and physical target depths merge in the selected direction', () => {
    const merge = helpers.hwyMergeTrailPriorityWorldZ;
    assert.equal(merge(-50, -100, 1, -200, 1, true), -200);
    assert.equal(merge(-50, -100, 1, -200, 1, false), -100);
    assert.equal(merge(-50, -100, 0, -200, 1, true), -200);
    assert.equal(merge(-50, -100, 0, -200, 0, false), -50);
});

test('moving-trail crossings are timed at their rendered overlap, not gem onset', () => {
    const starts = new Float64Array(8);
    const ends = new Float64Array(8);
    const count = helpers.hwyFillTrailCrossingWindows(
        0, 1, 0.025,
        t => Math.abs(t - 0.6) <= 0.1,
        starts, ends,
    );
    assert.equal(count, 1);
    assert.ok(Math.abs(starts[0] - 0.5) < 0.002, `entry=${starts[0]}`);
    assert.ok(Math.abs(ends[0] - 0.7) < 0.002, `exit=${ends[0]}`);
    assert.notEqual(starts[0], 0, 'the lower gem onset is not reused as the crossing time');
});

test('an oscillating trail produces separate windows when crossings have room to recover', () => {
    const starts = new Float64Array(8);
    const ends = new Float64Array(8);
    const count = helpers.hwyFillTrailCrossingWindows(
        0, 2, 0.01,
        t => Math.abs(Math.sin(Math.PI * 2 * t)) <= 0.16,
        starts, ends,
    );
    assert.ok(count >= 4, `expected repeated crossings, got ${count}`);
    for (let i = 1; i < count; i++) {
        assert.ok(starts[i] > ends[i - 1], 'separate intersections retain a widening gap');
    }
});

test('crossing resolution keeps path sampling bounded for a full visible slice', () => {
    const starts = new Float64Array(96);
    const ends = new Float64Array(96);
    let calls = 0;
    helpers.hwyFillTrailCrossingWindows(
        0, 3, 0.0075,
        t => {
            calls++;
            return Math.sin(t * Math.PI * 20) > 0.8;
        },
        starts, ends,
    );
    // 401 base samples plus six binary refinements for each transition.
    // Keep generous headroom so this pins bounded work, not an exact loop
    // implementation or a wall-clock threshold that can flake in CI.
    assert.ok(calls < 1300, `unexpected crossing callback count: ${calls}`);
});

test('crossing overflow conservatively merges instead of dropping visibility', () => {
    const starts = new Float64Array([0, 2]);
    const ends = new Float64Array([1, 3]);
    const count = helpers.hwyFillTrailCrossingWindows(
        4, 5, 0.1, () => true, starts, ends, 2, 0,
    );
    assert.equal(count, 2);
    assert.ok(
        (starts[0] <= 4 && ends[0] >= 5) || (starts[1] <= 4 && ends[1] >= 5),
        'a full scratch buffer may bridge a gap but must not lose the new crossing',
    );
});

test('dense crossing collectors keep scanning after geometry storage fills', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const crossingStart = src.indexOf(
        '        function collectTrailCrossingWindowsForStrand(',
    );
    const crossingEnd = src.indexOf(
        '        /** Collect one strand', crossingStart,
    );
    const crossingCollector = src.slice(crossingStart, crossingEnd);
    assert.doesNotMatch(crossingCollector, /candidateCount\s*&&\s*count\s*<\s*capacity/);
    assert.doesNotMatch(crossingCollector, /targetStrandCount\s*&&\s*count\s*<\s*capacity/);

    const targetStart = crossingEnd;
    const targetEnd = src.indexOf('        /* ── Note renderer', targetStart);
    const targetCollector = src.slice(targetStart, targetEnd);
    assert.match(
        targetCollector,
        /count\s*<\s*starts\.length\s*\|\|\s*priorityTimes/,
        'mode-3 scalar priority must keep scanning after local taper storage fills',
    );
});

test('closely spaced crossings share one continuous taper effect without changing settings', () => {
    const starts = new Float64Array([1.0, 1.18]);
    const ends = new Float64Array([1.04, 1.22]);
    const cfg = {
        ...helpers.TRAIL_YIELD_DEFAULTS,
        leadTime: 0.20,
        taperDuration: 0.05,
        holdAfter: 0.05,
        recoverDuration: 0.10,
    };
    assert.equal(
        helpers.hwyTrailYieldAmountAt(1.10, starts, ends, 2, 3, cfg),
        1,
        'the next taper begins before the previous crossing can recover',
    );
});

test('moving upper, moving lower, and mirrored paths resolve the same crossing time', () => {
    const { slideTrailEnd, slideOffsetWorldX } = loadSlideOffsetHelpers();
    const moving = { t: 0, f: 3, sus: 2, sl: 9 };
    const slideSt = slideTrailEnd(moving);
    const collect = (movingUpper, mirror) => {
        const starts = new Float64Array(4);
        const ends = new Float64Array(4);
        const sign = mirror ? -1 : 1;
        const count = helpers.hwyFillTrailCrossingWindows(
            0, 2, 0.02,
            t => {
                const movingX = sign * (30 + slideOffsetWorldX(moving, t, slideSt));
                const straightX = sign * 60;
                return movingUpper
                    ? helpers.hwyTrailOverlapsGemX(movingX, 4, straightX, 4)
                    : helpers.hwyTrailOverlapsGemX(straightX, 4, movingX, 4);
            },
            starts, ends,
        );
        return { count, start: starts[0], end: ends[0] };
    };
    const upperMoves = collect(true, false);
    const lowerMoves = collect(false, false);
    const mirrored = collect(true, true);
    assert.equal(upperMoves.count, 1);
    assert.equal(lowerMoves.count, upperMoves.count);
    assert.ok(Math.abs(lowerMoves.start - upperMoves.start) < 1e-9);
    assert.ok(Math.abs(mirrored.start - upperMoves.start) < 1e-9);
    assert.ok(Math.abs(mirrored.end - upperMoves.end) < 1e-9);
});

test('crossing resolution ignores paths without a shared sustain interval', () => {
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    assert.equal(
        helpers.hwyFillTrailCrossingWindows(
            2, 2, 0.01, () => true, starts, ends,
        ),
        0,
    );
});

test('moving-Y techniques cannot reverse taper eligibility in normal or inverted views', () => {
    const starts = new Float64Array(4);
    const ends = new Float64Array(4);
    const matchesSameFret = (_event, visuallyBelow) => (
        helpers.hwyTrailFootprintsCanOcclude(visuallyBelow, 10, 2, 10, 2)
    );

    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 1, s: 3, f: 7, end: 2 }],
            0, 4, 0, 3, false, starts, ends,
            0, 3, helpers.TRAIL_YIELD_DEFAULTS, matchesSameFret,
        ),
        0,
        'normal: green-string bend cannot yield for an orange higher-string target',
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 1, s: 5, f: 7, end: 2 }],
            0, 4, 0, 3, false, starts, ends,
            0, 3, helpers.TRAIL_YIELD_DEFAULTS, matchesSameFret,
        ),
        1,
        'normal: the same source still yields for a purple lower-string target',
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 1, s: 2, f: 7, end: 2 }],
            0, 1, 0, 3, true, starts, ends,
            0, 3, helpers.TRAIL_YIELD_DEFAULTS, matchesSameFret,
        ),
        0,
        'inverted: the mirrored higher-string target remains ineligible',
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 1, s: 0, f: 7, end: 2 }],
            0, 1, 0, 3, true, starts, ends,
            0, 3, helpers.TRAIL_YIELD_DEFAULTS, matchesSameFret,
        ),
        1,
        'inverted: the mirrored lower-string target remains eligible',
    );
});

test('the immediate gem layer fallback changes only exact footprint targets', () => {
    const layer = helpers.hwyTrailYieldGemLayer;
    assert.equal(layer(false, true, 'normal', 'behind'), 'behind');
    assert.equal(layer(true, true, 'normal', 'behind'), 'normal');
    assert.equal(layer(false, false, 'normal', 'behind'), 'normal');
    assert.equal(layer(true, false, 'normal', 'behind'), 'normal');
});

test('accepted normal and inverted targets are reported for scoped gem ordering', () => {
    const starts = new Float64Array(4);
    const ends = new Float64Array(4);
    const accepted = [];
    const events = [
        { t: 1, s: 0, end: 1 },
        { t: 1.1, s: 2, end: 1.1 },
    ];
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            events, 0, 1, 0, 2, false, starts, ends, 0, 2,
            helpers.TRAIL_YIELD_DEFAULTS, null,
            event => accepted.push(event.s),
        ),
        1,
    );
    assert.deepEqual(accepted, [2], 'normal mode reports only the visually lower target');

    accepted.length = 0;
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            events, 0, 1, 0, 2, true, starts, ends, 0, 2,
            helpers.TRAIL_YIELD_DEFAULTS, null,
            event => accepted.push(event.s),
        ),
        1,
    );
    assert.deepEqual(accepted, [0], 'inverted mode reverses the reported target direction');

    accepted.length = 0;
    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: 2.2, s: 2, end: 2.2 }],
            0, 1, 0, 2, false, starts, ends, 0, 2,
            helpers.TRAIL_YIELD_DEFAULTS, null,
            event => accepted.push(event.s),
        ),
        1,
    );
    assert.deepEqual(accepted, [2], 'a narrowed endpoint reports the same scoped target');
});

test('a near-adjacent lower gem tapers the terminal trail face', () => {
    const starts = new Float64Array(4);
    const ends = new Float64Array(4);
    const susEnd = 5;
    const settings = { ...helpers.TRAIL_YIELD_DEFAULTS, endLeadTime: 0.6 };
    const adjacentT = susEnd + settings.endLeadTime;
    const count = helpers.hwyFillTrailYieldTimes(
        [{ t: adjacentT, s: 2, end: adjacentT }],
        0, 1, 1, susEnd, false, starts, ends, 0, susEnd, settings,
    );
    assert.equal(count, 1);
    assert.equal(starts[0], adjacentT);
    assert.equal(ends[0], susEnd);
    assert.equal(
        helpers.hwyTrailYieldAmountAt(susEnd, starts, ends, count, susEnd, settings),
        1,
        'the terminal cross-section should reach the same 30% yield as an interior notch',
    );

    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            [{ t: susEnd + settings.endLeadTime + 0.001, s: 2, end: susEnd + 1 }],
            0, 1, 1, susEnd, false, starts, ends, 0, susEnd, settings,
        ),
        0,
        'notes beyond the adjacency window must leave the endpoint unchanged',
    );
});

test('open-note rails match fretted gems by rendered X and merge appended fret buckets', () => {
    assert.equal(helpers.hwyTrailOverlapsGemX(10, 2, 12, 2), true);
    assert.equal(helpers.hwyTrailOverlapsGemX(10, 2, 12.01, 2), false);

    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    let count = helpers.hwyFillTrailYieldTimes(
        [{ t: 1, s: 2, end: 1 }], 0, 1, 0.5, 5, false, starts, ends,
    );
    count = helpers.hwyFillTrailYieldTimes(
        [{ t: 1, s: 3, end: 3 }, { t: 1.1, s: 4, end: 1.1 }],
        0, 1, 0.5, 5, false, starts, ends, count,
    );
    assert.equal(count, 2);
    assert.deepEqual(Array.from(starts), [1, 1.1]);
    assert.deepEqual(Array.from(ends), [3, 1.1]);
});

test('yielding ribbon strands choose the target-depth extreme for each priority mode', () => {
    const starts = new Float64Array([10.5, 11]);
    assert.equal(
        helpers.hwyTrailPriorityWorldZ(-575, 10, starts, 2, false, 230),
        -115,
        'the nearest obscured gem, not a long ribbon midpoint, controls ordering',
    );
    assert.equal(
        helpers.hwyTrailPriorityWorldZ(-575, 10, starts, 2, true, 230),
        -230,
        'front-priority mode paints before the farthest obscured target',
    );
    assert.equal(
        helpers.hwyTrailPriorityWorldZ(-50, 10, new Float64Array([9.9]), 1, false, 230),
        0,
        'a target at or behind the hit line clamps to the visible hit-line depth',
    );
});

test('target sustain ends are retained separately from clipped notch geometry', () => {
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    const targetTrailEnds = new Float64Array(2);
    const count = helpers.hwyFillTrailYieldTimes(
        [
            { t: 4, s: 2, end: 8 },
            { t: 4, s: 3, end: 10 },
        ],
        0, 1, 1, 5, false, starts, ends,
        0, 5, helpers.TRAIL_YIELD_DEFAULTS, null, null,
        targetTrailEnds,
    );
    assert.equal(count, 1);
    assert.equal(ends[0], 5, 'the width notch must stop with its covering trail');
    assert.equal(
        targetTrailEnds[0], 10,
        'ordering must retain the complete longest attached trail in a chord wave',
    );
});

test('front priority consistently includes attached trails for single and repeated targets', () => {
    const speed = 230;

    const singleStarts = new Float64Array([16]);
    const singleEnds = new Float64Array([19]);
    const singleSourceZ = helpers.hwyTrailPriorityWorldZ(
        -1, 14, singleStarts, 1, true, speed, singleEnds,
    );
    const singleTargetMidZ = -(17.5 - 14) * speed;
    assert.ok(
        singleSourceZ < singleTargetMidZ,
        'the covering trail paints before a long target trail, not merely its gem',
    );

    const repeatedStarts = new Float64Array([25.5, 27, 28.5, 30]);
    const repeatedEnds = new Float64Array([25.7, 27.2, 28.7, 30.2]);
    const repeatedSourceZ = helpers.hwyTrailPriorityWorldZ(
        -1, 24, repeatedStarts, 4, true, speed, repeatedEnds,
    );
    for (let i = 0; i < repeatedStarts.length; i++) {
        const targetMid = (repeatedStarts[i] + repeatedEnds[i]) * 0.5;
        const targetMidZ = -(targetMid - 24) * speed;
        assert.ok(
            repeatedSourceZ < targetMidZ,
            `target trail ${i} should paint after its covering trail`,
        );
    }

    const trailPriorityZ = helpers.hwyTrailPriorityWorldZ(
        -1, 24, repeatedStarts, 4, false, speed, repeatedEnds,
    );
    for (let i = 0; i < repeatedStarts.length; i++) {
        const targetMid = (repeatedStarts[i] + repeatedEnds[i]) * 0.5;
        const targetMidZ = -(targetMid - 24) * speed;
        assert.ok(
            trailPriorityZ > targetMidZ,
            `target trail ${i} should remain behind when front priority is off`,
        );
    }
});

test('equal-depth trail cascades follow visual string order in both orientations', () => {
    const offset = helpers.hwyTrailPriorityStringOffset;
    assert.ok(offset(2, 6, false, true) > offset(1, 6, false, true));
    assert.ok(offset(2, 6, true, true) < offset(1, 6, true, true));
    assert.ok(offset(2, 6, false, false) < offset(1, 6, false, false));
    assert.ok(offset(2, 6, true, false) > offset(1, 6, true, false));
    assert.equal(offset(-1, 6, false, true), 0);
});

test('an excluded attached trail stays completely behind its covering trail', () => {
    const behindOrder = helpers.hwyTrailTargetBehindOrder;
    const coveringOutlineOrder = 640.25;
    const targetOutlineOrder = behindOrder(coveringOutlineOrder);
    assert.ok(targetOutlineOrder < coveringOutlineOrder);
    assert.ok(
        targetOutlineOrder + 0.0005 < coveringOutlineOrder,
        'the target body must not cross back above the covering outline',
    );
    assert.equal(
        behindOrder(coveringOutlineOrder, 630), 630,
        'a target already farther behind must keep its natural order',
    );
    assert.equal(
        behindOrder(620, targetOutlineOrder), 619.999,
        'multiple covering trails choose the constraint that stays behind all of them',
    );
});

test('a demoted gem stays above its own attached trail while both stay behind the cover', () => {
    const behindOrder = helpers.hwyTrailTargetBehindOrder;
    const coveringOutlineOrder = 640.25;
    const gemOutlineOrder = coveringOutlineOrder - 0.003;
    const externallyConstrainedTrail = behindOrder(coveringOutlineOrder);
    const ownTrailOutlineOrder = behindOrder(
        gemOutlineOrder, externallyConstrainedTrail,
    );
    const ownTrailBodyOrder = ownTrailOutlineOrder + 0.0005;

    assert.ok(coveringOutlineOrder > gemOutlineOrder);
    assert.ok(
        gemOutlineOrder > ownTrailBodyOrder,
        'the complete attached trail must remain behind the lowest gem layer',
    );
    assert.ok(ownTrailBodyOrder > ownTrailOutlineOrder);
});

test('a post-end target cannot move a trail behind an intervening ordinary gem', () => {
    const endpointTarget = new Float64Array([10.1]);
    const naturalZ = -10;
    const interveningGemZ = -(10.06 - 10) * 230;
    const trailFirstZ = helpers.hwyTrailPriorityWorldZ(
        naturalZ, 10, endpointTarget, 1, false, 230,
    );
    assert.equal(trailFirstZ, naturalZ, 'the trail already lies in front of its target');
    assert.ok(
        helpers.renderOrderForLayerAtZ(trailFirstZ, 'SUSTAIN_TRAIL')
            > helpers.renderOrderForLayerAtZ(interveningGemZ, 'NOTE_CORE'),
        'an unrelated gem between the real endpoint and target must remain behind',
    );

    const gemFirstZ = helpers.hwyTrailPriorityWorldZ(
        naturalZ, 10, endpointTarget, 1, true, 230,
    );
    assert.ok(Math.abs(gemFirstZ + 23) < 1e-9, 'explicit gem promotion is unchanged');
});

test('trail-first constraints preserve natural depth or move only toward qualifying targets', () => {
    const now = 10, speed = 230, naturalZ = -230;
    // A sustain spans 10..12 with its natural midpoint at 11. Targets cover
    // both sides of that midpoint, the endpoint window, and mixed ordering.
    for (const times of [[], [10.25], [11], [11.75], [12.2], [12.2, 10.5, 11.75]]) {
        const starts = new Float64Array(times);
        const actual = helpers.hwyTrailPriorityWorldZ(
            naturalZ, now, starts, starts.length, false, speed,
        );
        assert.ok(actual >= naturalZ, `targets ${times} must not send the mesh backward`);
        if (times.every(t => t >= 11)) {
            assert.equal(actual, naturalZ, 'no movement is needed for already-farther targets');
        }
        for (const targetTime of times) {
            const targetZ = -(targetTime - now) * speed;
            assert.ok(
                helpers.renderOrderForLayerAtZ(actual, 'SUSTAIN_TRAIL')
                    > helpers.renderOrderForLayerAtZ(targetZ, 'NOTE_CORE_BEHIND_TRAIL'),
                `the trail must still cover its qualifying target at ${targetTime}`,
            );
        }
    }
    assert.equal(
        helpers.hwyTrailPriorityWorldZ(
            naturalZ, now, new Float64Array([NaN, Infinity]), 2, false, speed,
        ),
        naturalZ,
        'invalid target times cannot replace the real depth',
    );
});

test('Airbourne endpoint narrowing preserves intervening E5 gem order in modes 0 and 1', () => {
    const source = { t: 25, s: 0, f: 3, sus: 0.139, bn: 0.5 };
    const chords = [
        { t: 25.184999, notes: [{ s: 0, f: 0 }, { s: 1, f: 2 }, { s: 2, f: 2 }] },
        { t: 25.370001, notes: [{ s: 1, f: 0, ac: true }, { s: 2, f: 2 }, { s: 3, f: 2 }] },
    ];
    const index = helpers.hwyBuildTrailYieldEvents([source], chords, 6);
    const sourceEnd = source.t + source.sus;
    const starts = new Float64Array(8), ends = new Float64Array(8);
    // The open A5 string spans the red fret; the intervening E5 fret-2 gems
    // lie outside it. Supply the already-selected open footprint bucket.
    const count = helpers.hwyFillTrailYieldTimes(
        index[0], source.t, source.s, 24, sourceEnd, false, starts, ends,
    );
    assert.equal(count, 1);
    assert.equal(starts[0], chords[1].t);
    for (const t of [source.t, source.t + source.sus / 2, sourceEnd]) {
        assert.equal(
            helpers.hwyTrailYieldAmountAt(t, starts, ends, count, sourceEnd),
            1,
            'the existing fully narrowed short bend must retain its geometry',
        );
    }

    const speed = 230;
    for (const now of [23.5, 24, 24.8, 25.1]) {
        const visibleStart = Math.max(source.t, now);
        const naturalZ = -((visibleStart + sourceEnd) / 2 - now) * speed;
        for (const mode of [0, 1, 2, 3]) {
            const enabled = mode !== 0;
            const frontMask = helpers.hwyTrailVisibilityFrontMask(enabled, mode >= 2, mode === 3);
            const gemFirst = !!(frontMask & helpers.TRAIL_OCCLUSION_GEM);
            const orderZ = helpers.hwyTrailPriorityWorldZ(
                naturalZ, now, starts, enabled ? count : 0, gemFirst, speed,
                mode === 3 ? starts : null,
            );
            const trailOrder = helpers.renderOrderForLayerAtZ(orderZ, 'SUSTAIN_TRAIL');
            const gemZ = -(chords[0].t - now) * speed;
            for (const layer of ['NOTE_OUTLINE', 'NOTE_CORE', 'TECHNIQUE_MARKER']) {
                const gemOrder = helpers.renderOrderForLayerAtZ(gemZ, layer);
                assert.equal(
                    trailOrder > gemOrder,
                    mode < 2,
                    `mode ${mode}, time ${now}, ${layer}: only explicit promotion may put E5 in front`,
                );
            }
        }
    }
});

test('an added far endpoint target cannot pull an existing trail-first constraint backward', () => {
    const naturalZ = -115, now = 10, speed = 230;
    const nearTargets = new Float64Array([10.2]);
    const farTargets = new Float64Array([11.2]);
    const nearZ = helpers.hwyTrailPriorityWorldZ(naturalZ, now, nearTargets, 1, false, speed);
    const farZ = helpers.hwyTrailPriorityWorldZ(naturalZ, now, farTargets, 1, false, speed);
    assert.ok(farZ >= naturalZ, 'endpoint-only candidate sets must retain the baseline');
    assert.equal(
        helpers.hwyMergeTrailPriorityWorldZ(naturalZ, nearZ, 1, farZ, 1, false),
        nearZ,
        'a separate endpoint bucket must not weaken an existing physical constraint',
    );
    assert.equal(
        helpers.hwyMergeTrailPriorityWorldZ(naturalZ, nearZ, 0, farZ, 1, false),
        naturalZ,
        'removing the near target must return to real geometry, not the endpoint target depth',
    );
});

test('short-note notch eases in, reaches 30 percent, then recovers', () => {
    const starts = new Float64Array([10]);
    const ends = new Float64Array([10]);
    const amount = chartTime => helpers.hwyTrailYieldAmountAt(chartTime, starts, ends, 1);

    assert.ok(amount(9.49) < 1e-12);
    assert.ok(amount(9.525) > 0 && amount(9.525) < 1);
    assert.equal(amount(9.55), 1);
    assert.ok(Math.abs(
        1 - (1 - helpers.TRAIL_YIELD_DEFAULTS.minScale) * amount(9.55) - 0.30,
    ) < 1e-12);
    assert.ok(amount(10.075) > 0 && amount(10.075) < 1);
    assert.equal(amount(10.10), 0);
});

test('custom around-note timing controls narrowing, hold, and recovery independently', () => {
    const starts = new Float64Array([10]);
    const ends = new Float64Array([10]);
    const settings = {
        ...helpers.TRAIL_YIELD_DEFAULTS,
        leadTime: 0.8,
        taperDuration: 0.2,
        holdAfter: 0.3,
        recoverDuration: 0.4,
    };
    const amount = chartTime => helpers.hwyTrailYieldAmountAt(
        chartTime, starts, ends, 1, Infinity, settings,
    );

    assert.equal(amount(9.2), 0);
    assert.ok(amount(9.3) > 0 && amount(9.3) < 1);
    assert.equal(amount(9.4), 1);
    assert.equal(amount(10.3), 1);
    assert.ok(amount(10.5) > 0 && amount(10.5) < 1);
    assert.equal(amount(10.7), 0);
});

test('trail ends use their own taper timing and the shared minimum width', () => {
    const starts = new Float64Array([10.1]);
    const ends = new Float64Array([10]);
    const settings = {
        ...helpers.TRAIL_YIELD_DEFAULTS,
        minScale: 0.25,
        leadTime: 0.9,
        taperDuration: 0.8,
        endLeadTime: 0.5,
        endTaperDuration: 0.2,
    };
    const amount = chartTime => helpers.hwyTrailYieldAmountAt(
        chartTime, starts, ends, 1, 10, settings,
    );

    assert.equal(amount(9.6), 0);
    assert.ok(amount(9.7) > 0 && amount(9.7) < 1);
    assert.equal(amount(9.8), 1);
    assert.equal(amount(10), 1);
    assert.ok(Math.abs(1 - (1 - settings.minScale) * amount(10) - 0.25) < 1e-12);
    assert.equal(amount(10.01), 0, 'a terminal taper never widens beyond the trail end');
});

test('endpoint timing is anchored to its upcoming gem and compresses into the remaining trail', () => {
    const starts = new Float64Array([10.5]);
    const ends = new Float64Array([10]);
    const settings = {
        ...helpers.TRAIL_YIELD_DEFAULTS,
        endLeadTime: 1,
        endTaperDuration: 0.05,
    };
    const amount = chartTime => helpers.hwyTrailYieldAmountAt(
        chartTime, starts, ends, 1, 10, settings,
    );
    assert.equal(amount(9.5), 0, 'one-second lead is measured back from the 10.5 s gem');
    assert.ok(amount(9.525) > 0 && amount(9.525) < 1);
    assert.equal(amount(9.55), 1);
    assert.equal(amount(10), 1);

    starts[0] = 10.98;
    assert.equal(amount(9.98), 0);
    assert.ok(amount(9.99) > 0 && amount(9.99) < 1);
    assert.equal(amount(10), 1, 'the requested taper compresses into the final 0.02 s');
});

test('a lower sustained note keeps the local notch open until its trail ends', () => {
    const starts = new Float64Array([10]);
    const ends = new Float64Array([14]);
    assert.equal(helpers.hwyTrailYieldAmountAt(13, starts, ends, 1), 1);
    assert.ok(helpers.hwyTrailYieldAmountAt(14.075, starts, ends, 1) > 0);
    assert.equal(helpers.hwyTrailYieldAmountAt(14.10, starts, ends, 1), 0);
});

test('yield windows exist as soon as their chart section enters the visible slice', () => {
    const events = [{ t: 4, s: 2, end: 4 }];
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    assert.equal(
        helpers.hwyFillTrailYieldTimes(events, 0, 1, 0, 10, false, starts, ends, 0, 3.99),
        0,
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(events, 0, 1, 0, 10, false, starts, ends, 0, 4),
        1,
    );

    const endpointEvent = [{ t: 10.1, s: 2, end: 10.1 }];
    assert.equal(
        helpers.hwyFillTrailYieldTimes(endpointEvent, 0, 1, 0, 10, false, starts, ends, 0, 9.99),
        0,
        'terminal lookahead waits until the trail end enters the rendered slice',
    );
    assert.equal(
        helpers.hwyFillTrailYieldTimes(endpointEvent, 0, 1, 0, 10, false, starts, ends, 0, 10),
        1,
        'the terminal taper is present as soon as its endpoint enters view',
    );
});

test('ribbon faces are outward-wound for the highway negative-Z direction', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const start = src.indexOf('    const SLIDE_RIBBON_INDICES =');
    const end = src.indexOf('    const SLIDE_RIBBON_INDICES_ARR', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const indices = vm.runInNewContext(
        'const SLIDE_RIBBON_SAMPLES = 1;\n'
        + src.slice(start, end)
        + '\nArray.from(SLIDE_RIBBON_INDICES)',
    );
    assert.deepEqual(Array.from(indices), [
        0, 5, 1, 0, 4, 5,
        3, 6, 7, 3, 2, 6,
        0, 7, 4, 0, 3, 7,
        1, 6, 2, 1, 5, 6,
    ]);
});

test('yielding uses the existing ribbon path and gem front priority is optional', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.gemInFront, false);
    assert.equal(helpers.TRAIL_YIELD_DEFAULTS.includeTrails, false);
    assert.match(src, /const\s+ribbonSusTrail\s*=\s*yieldCount\s*>\s*0\s*\|\|/);
    assert.match(src, /const\s+isTrailYieldTarget\s*=\s*!!\(trailYieldGemEvent[\s\S]{0,140}?_trailYieldTargetFrame\s*===\s*_trailYieldFrameId\)/);
    assert.match(src, /hwyTrailYieldGemLayer\([\s\S]{0,140}?'NOTE_OUTLINE',\s*'NOTE_OUTLINE_BEHIND_TRAIL'/);
    assert.match(src, /hwyTrailYieldGemLayer\([\s\S]{0,140}?'NOTE_CORE',\s*'NOTE_CORE_BEHIND_TRAIL'/);
    assert.doesNotMatch(src, /trailYieldSettings\.gemInFront\s*\?\s*'NOTE_(?:OUTLINE|CORE)'/);
    assert.match(src, /hwyFillTrailYieldTimes\([\s\S]{0,420}?trailYieldEventMatchesRenderedFootprint,\s*ctx\.path\s*\?\s*null\s*:\s*trailYieldMarkTarget,/);
    const registerGemStart = src.indexOf('        function trailYieldRegisterGem(');
    const registerGemEnd = src.indexOf('        function trailYieldSweepMayReachFret(', registerGemStart);
    assert.notEqual(registerGemStart, -1);
    assert.notEqual(registerGemEnd, -1);
    assert.match(
        src.slice(registerGemStart, registerGemEnd),
        /trailYieldApplyBehindLayers/,
        'a gem emitted before or after its source trail must converge on the same scoped layer',
    );
    assert.match(
        src,
        /function\s+trailYieldRegisterTargetTrail\([\s\S]{0,2400}?trailYieldApplyTargetTrailOrder/,
        'an attached trail emitted before or after its source must converge on the same scoped order',
    );
    assert.match(
        src,
        /trailOcclusionRegisterRelationships\(\s*trailYieldTargetEvent,\s*strandMatchedEvents,\s*null,\s*visibilityPath\s*\?\s*0\s*:\s*strandMatchedEventCount,\s*ribbonRenderOrder,\s*TRAIL_OCCLUSION_GEM/,
        'exact lower-string footprint matching controls the gem while physical ordering owns trails',
    );
    assert.match(
        src,
        /function\s+trailYieldLinkTargetTrailInFront\(sourceEvent, targetEvent\)[\s\S]{0,500}?trailYieldLinkTargetTrailBehind\(targetEvent, sourceEvent, targetOrder\)/,
        'mode 3 must encode front priority as the reversed edge in the shared propagation graph',
    );
    assert.match(
        src,
        /hwyTrailOcclusionTrailShouldMoveInFront\([\s\S]{0,180}?trailYieldLinkTargetTrailInFront\(source, target\)/,
        'the later target relationship must be actively resolved rather than merely left unconstrained',
    );
    assert.match(
        src,
        /relationshipFlags\s*=\s*hwyTrailOcclusionFlagsForPair\(\s*sourceEvent\.s,\s*target\.s,\s*_invertedCached,\s*relationshipFlags/,
        'relationship registration must enforce the physical trail-order invariant centrally',
    );
    assert.match(
        src,
        /trailOcclusionFinalizeFrame\(\);[\s\S]{0,240}?Finalise InstancedMesh batches/,
        'relationships must resolve once after every note and trail mesh has registered',
    );
    assert.match(
        src,
        /trailYieldRegisterTargetTrail\(\s*trailYieldTargetEvent,\s*trOut,\s*tr,/,
        'straight attached trails must participate in the same rule',
    );
    assert.match(
        src,
        /trailYieldRegisterTargetTrail\(\s*trailYieldTargetEvent,\s*olMesh,\s*body,/,
        'moving and yielding ribbon trails must participate in the same rule',
    );
    assert.match(src, /hwyTrailPriorityWorldZ\([\s\S]{0,180}?strandYieldStarts,\s*orderingYieldCount,[\s\S]{0,100}?trailYieldGemInFront,\s*TS/);
    assert.match(src, /const\s+matchingVisibleEnd\s*=\s*Math\.min\(sourceEnd,\s*geometryEnd\s*\+\s*Math\.max\(cfg\.leadTime,\s*cfg\.endLeadTime\)\)/);
    assert.match(src, /ctx\.path\s*\?\s*null\s*:\s*priorityTimes/,
        'linked width queries must not scan the entire chain for cached mode-3 priority');
    assert.match(
        src,
        /hwyFillTrailYieldTimes\([\s\S]{0,700}?ctx\.path\s*\?\s*null\s*:\s*priorityTimes,\s*priorityIndex/,
        'mode 3 must retain one future endpoint depth without materializing its taper',
    );
    assert.match(src, /const\s+occlusionVisibleEnd\s*=\s*visibleYieldEnd/);
    assert.match(
        src,
        /trailVisibilityMode3PriorityTime\([\s\S]{0,120}?trailYieldTargetEvent,\s*susEnd/,
        'mode 3 must keep physical future priority independent of visible relationships',
    );
    const behindLayer = src.indexOf("'NOTE_CORE_BEHIND_TRAIL'");
    const trailLayer = src.indexOf("'SUSTAIN_TRAIL'");
    const frontLayer = src.indexOf("'NOTE_CORE'", trailLayer);
    assert.ok(behindLayer >= 0 && behindLayer < trailLayer && trailLayer < frontLayer);
    assert.match(
        src,
        /mSus\s*=\s*activePalette\.map[\s\S]{0,300}?opacity:\s*0\.35,[\s\S]{0,80}?depthTest:\s*false,\s*depthWrite:\s*false/,
    );
    const depthIndependentTrailMaterials = [
        /mGlow\s*=\s*activePalette\.map[\s\S]{0,220}?depthTest:\s*false,\s*depthWrite:\s*false/,
        /mMissOutline\s*=\s*new\s+T\.MeshLambertMaterial\([\s\S]{0,260}?depthTest:\s*false,\s*depthWrite:\s*false/,
        /mHitBright\s*=\s*activePalette\.map[\s\S]{0,260}?depthTest:\s*false,\s*depthWrite:\s*false/,
        /mSusOutline\s*=\s*new\s+T\.MeshLambertMaterial\([\s\S]{0,260}?depthTest:\s*false,\s*depthWrite:\s*false/,
        /mHitSusOutline\s*=\s*new\s+T\.MeshLambertMaterial\([\s\S]{0,260}?depthTest:\s*false,\s*depthWrite:\s*false/,
    ];
    for (const pattern of depthIndependentTrailMaterials) {
        assert.match(src, pattern, 'trail verdict materials must obey the render stack');
    }
    const ribbonStart = src.indexOf('        function slideRibbonUpdatePair(');
    const ribbonEnd = src.indexOf('        function noteHasVibrato(', ribbonStart);
    assert.notEqual(ribbonStart, -1);
    assert.notEqual(ribbonEnd, -1);
    assert.doesNotMatch(
        src.slice(ribbonStart, ribbonEnd),
        /\.material\s*=|\.opacity\s*=|\.color\s*\.\s*(?:set|copy|lerp)/,
        'visibility taper must never mutate shared material color or opacity; authored slide-out fade uses geometry alpha',
    );
});

test('mode-3 endpoint priority is stable before the endpoint enters the visible slice', () => {
    const endpointEvent = [{ t: 10.5, s: 2, end: 12 }];
    const starts = new Float64Array(2);
    const ends = new Float64Array(2);
    const targetTrailEnds = new Float64Array(2);
    const priorityTimes = new Float64Array(1);

    assert.equal(
        helpers.hwyFillTrailYieldTimes(
            endpointEvent, 0, 1, 0, 10, false, starts, ends,
            0, 4, helpers.TRAIL_YIELD_DEFAULTS,
        ),
        0,
        'geometry-only modes keep the endpoint scan local',
    );
    const count = helpers.hwyFillTrailYieldTimes(
        endpointEvent, 0, 1, 0, 10, false, starts, ends,
        0, 4, helpers.TRAIL_YIELD_DEFAULTS, null, null,
        targetTrailEnds, priorityTimes,
    );
    assert.equal(count, 0, 'future priorities do not materialize off-screen geometry');
    assert.equal(priorityTimes[0], 12, 'ordering retains the complete target trail');
    assert.equal(
        helpers.hwyTrailYieldAmountAt(
            4, starts, ends, count, 10, helpers.TRAIL_YIELD_DEFAULTS,
        ),
        0,
        'early relationship discovery must not taper visible geometry early',
    );
});

test('demoted gem and attached-trail registration converge on one internal order', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const constrainStart = src.indexOf(
        '        function trailYieldConstrainOwnTrailBehindGem(',
    );
    const constrainEnd = src.indexOf(
        '        /** Keep one qualifying attached trail behind every covering strand. */',
        constrainStart,
    );
    assert.notEqual(constrainStart, -1);
    assert.notEqual(constrainEnd, -1);
    const constrainBody = src.slice(constrainStart, constrainEnd);

    assert.match(
        constrainBody,
        /trailYieldSettings\.gemInFront[\s\S]{0,220}?_trailYieldTargetFrame[\s\S]{0,180}?_trailYieldGemFrame[\s\S]{0,180}?_trailYieldTrailMeshFrame/,
        'only a standard-mode target with both visuals registered needs the extra constraint',
    );
    assert.doesNotMatch(
        constrainBody,
        /_trailYieldTrailPriorityFrame/,
        'endpoint-gap targets must work even without an overlapping external trail constraint',
    );
    assert.match(
        constrainBody,
        /_trailYieldGemExtraRecords[\s\S]{0,300}?Math\.min\(gemFloorOrder,\s*outlineOrder\)/,
        'duplicate chord/arpeggio gems must share the lowest safe order',
    );
    assert.match(
        constrainBody,
        /trailYieldSetTargetTrailBehind\(event,\s*gemFloorOrder\)/,
        'the own-gem cap must reuse the propagated target-trail priority state',
    );

    const behindStart = src.indexOf('        function trailYieldApplyBehindLayers(');
    const behindEnd = src.indexOf('        function trailYieldSetTargetGemBehind(', behindStart);
    const registerStart = src.indexOf('        function trailYieldRegisterTargetTrail(');
    const registerEnd = src.indexOf('        /**', registerStart);
    assert.match(
        src.slice(behindStart, behindEnd),
        /trailYieldConstrainOwnTrailBehindGem\(event\)/,
        'a gem demoted after its trail was emitted must immediately repair the internal order',
    );
    assert.match(
        src.slice(registerStart, registerEnd),
        /trailYieldConstrainOwnTrailBehindGem\(event\)[\s\S]{0,100}?trailYieldApplyTargetTrailOrder\(event\)/,
        'straight, ribbon, open, and duplicate trails emitted later must converge too',
    );
});

test('rendering and eligibility share one rendered footprint model', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const centerDecl = src.indexOf('        function sustainTrailCenterXAt(');
    const matcherDecl = src.indexOf('        function trailYieldEventMatchesRenderedFootprint(');
    const rendererDecl = src.indexOf('        function slideRibbonUpdatePair(');
    assert.notEqual(centerDecl, -1);
    assert.notEqual(matcherDecl, -1);
    assert.notEqual(rendererDecl, -1);

    const centerBody = src.slice(centerDecl, src.indexOf('\n        }', centerDecl) + 10);
    assert.match(centerBody, /_leftyCached\s*\?\s*-1\s*:\s*1/);
    assert.match(centerBody, /slideOffsetWorldX\(/);
    assert.match(centerBody, /tremoloOffsetWorldX\(/);

    const matcherBody = src.slice(matcherDecl, src.indexOf('\n        }', matcherDecl) + 10);
    assert.match(matcherBody, /if\s*\(!visuallyBelow\)\s*return false/);
    assert.doesNotMatch(matcherBody, /techniqueMovesY|techniqueYOffsetWorld/);
    assert.match(matcherBody, /Math\.min\(event\.t,\s*ctx\.susEnd\)/);
    assert.match(matcherBody, /trailVisibilitySourceCenterXAt\(/);
    const pathCenterDecl = src.indexOf('        function trailVisibilitySourceCenterXAt(');
    assert.notEqual(pathCenterDecl, -1);
    const pathCenterBody = src.slice(pathCenterDecl, src.indexOf('\n        }', pathCenterDecl) + 10);
    assert.match(pathCenterBody, /sustainTrailCenterXAt\(/,
        'the linked-piece sampler must reuse the actual rendered center model');
    assert.match(matcherBody, /trailYieldOpenTargetXBounds\(/);
    assert.match(matcherBody, /hwyTrailFootprintsCanOcclude\(/);
    assert.doesNotMatch(matcherBody, /trailYieldSettings\.(?:gemInFront|includeTrails)/);
    assert.match(matcherBody, /Keeping this predicate onset-only/);

    const rendererBody = src.slice(rendererDecl, src.indexOf('        function noteHasVibrato(', rendererDecl));
    assert.match(rendererBody, /sustainTrailCenterXAt\(/);

    assert.match(src, /function\s+trailYieldSweepMayReachFret\(/);
    assert.match(src, /slideOffsetWorldX\(n,\s*n\.t\s*\+\s*\(n\.sus\s*\|\|\s*0\),\s*ctx\.slideSt\)/);
    assert.ok(/const\s+tremoloReach\s*=\s*n\.tr\s*\?\s*sustainMotionWidth\(ctx\.trailW\)\s*\*\s*0\.375\s*:\s*0/.test(src),
        'tremolo sweep bounds must retain motion reach independently of stroke thickness');
    assert.match(src, /function\s+collectTrailYieldTargetsForStrand\(/);
    assert.match(src, /function\s+collectTrailCrossingWindowsForStrand\(/);
    const crossingDecl = src.indexOf('        function collectTrailCrossingWindowsForStrand(');
    const crossingEnd = src.indexOf('        /** Collect one strand', crossingDecl);
    const crossingBody = src.slice(crossingDecl, crossingEnd);
    assert.match(crossingBody, /hwyFillTrailCrossingWindows\(/);
    assert.match(crossingBody, /TRAIL_OCCLUSION_TRAIL/);
    assert.doesNotMatch(crossingBody, /trailYieldSettings\.(?:gemInFront|includeTrails)/);
    assert.match(src, /_trailYieldEventsByFret\[f\][\s\S]{0,350}?trailYieldEventMatchesRenderedFootprint/);
    assert.match(src, /for\s*\(let f = 0; f <= NFRETS/);
    assert.match(src, /collectTrailYieldTargetsForStrand\([\s\S]{0,350}?xBase\s*\+\s*offsets\[si\],/);
    assert.match(src, /collectTrailYieldTargetsForStrand\([\s\S]{0,350}?xBase,/);
});

test('3D settings expose one shared width and separate passing-note and endpoint timing', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const settingsPath = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'settings.html');
    const html = fs.readFileSync(settingsPath, 'utf8');
    const ids = [
        'h3d-trail-yield-enabled',
        'h3d-trail-yield-gem-in-front',
        'h3d-trail-yield-include-trails',
        'h3d-trail-yield-min-scale',
        'h3d-trail-yield-lead-time',
        'h3d-trail-yield-taper-duration',
        'h3d-trail-yield-hold-after',
        'h3d-trail-yield-recover-duration',
        'h3d-trail-yield-end-lead-time',
        'h3d-trail-yield-end-taper-duration',
        'h3d-trail-yield-reset',
    ];
    for (const id of ids) assert.match(html, new RegExp(`id="${id}"`));
    assert.equal((html.match(/id="h3d-trail-yield-min-scale"/g) || []).length, 1);
    assert.doesNotMatch(html, /trail-yield-end-min-scale/);
    assert.match(html, /Endpoint visibility window:/);
    assert.match(html, /Checks this far after the trail end[\s\S]{0,160}?begins narrowing this far before that note/);
    assert.doesNotMatch(src, /TRAIL_YIELD_END_LOOKAHEAD_S/);
    for (const id of [
        'h3d-trail-yield-taper-duration',
        'h3d-trail-yield-recover-duration',
        'h3d-trail-yield-end-taper-duration',
    ]) {
        assert.match(html, new RegExp(`id="${id}" min="0\\.01"`));
    }
    assert.match(src, /trailYieldEndTaperDuration'\s*\?\s*\[0\.01,\s*1\]/);

    const uiDefaultLiterals = {
        trailYieldEnabled: 'true',
        trailYieldGemInFront: 'false',
        trailYieldIncludeTrails: 'false',
        trailYieldMinScale: '0\\.30',
        trailYieldLeadTime: '0\\.50',
        trailYieldTaperDuration: '0\\.05',
        trailYieldHoldAfter: '0\\.05',
        trailYieldRecoverDuration: '0\\.05',
        trailYieldEndLeadTime: '0\\.50',
        trailYieldEndTaperDuration: '0\\.05',
    };
    for (const [key, literal] of Object.entries(uiDefaultLiterals)) {
        assert.equal(
            (html.match(new RegExp(`${key}:\\s*${literal}`, 'g')) || []).length,
            2,
            `${key} should match in both settings-page default tables`,
        );
    }

    const setterKeys = [
        'TrailYieldEnabled',
        'TrailYieldGemInFront',
        'TrailYieldIncludeTrails',
        'TrailYieldMinScale',
        'TrailYieldLeadTime',
        'TrailYieldTaperDuration',
        'TrailYieldHoldAfter',
        'TrailYieldRecoverDuration',
        'TrailYieldEndLeadTime',
        'TrailYieldEndTaperDuration',
    ];
    for (const suffix of setterKeys) {
        assert.match(src, new RegExp(`window\\.h3dBgSet${suffix}\\s*=`));
    }
    for (const key of Object.keys(helpers.TRAIL_YIELD_DEFAULTS)) {
        const bgKey = key === 'enabled'
            ? 'trailYieldEnabled'
            : `trailYield${key[0].toUpperCase()}${key.slice(1)}`;
        assert.match(src, new RegExp(`_bgReadSetting\\(panelKey, '${bgKey}'\\)`));
    }

    assert.match(
        html,
        /function\s+syncFrontPriority\(\)[\s\S]{0,500}?includeTrailsControl\.disabled\s*=\s*!gemInFront\.checked/,
        'the attached-trail option must only be available with note front priority',
    );
    assert.match(
        src,
        /_trailVisibilityFrontMask\s*=\s*hwyTrailVisibilityFrontMask\(\s*trailYieldSettings\.enabled,\s*trailYieldSettings\.gemInFront,\s*trailYieldSettings\.includeTrails/,
        'foreground preferences must be reduced to one effective frame policy',
    );
    assert.match(
        src,
        /const\s+trailYieldIncludeTrails\s*=\s*!!\(\s*_trailVisibilityFrontMask\s*&\s*TRAIL_OCCLUSION_TRAIL\s*\)/,
    );
    assert.match(src, /const\s+includeTargetTrails\s*=\s*trailYieldIncludeTrails/);
    assert.match(
        src,
        /includeTargetTrails\s*\?\s*strandTargetTrailEnds\s*:\s*null/,
        'target trail endpoints must only affect ordering when explicitly included',
    );

    const scriptStart = html.indexOf('<script>', html.indexOf('id="h3d-trail-yield-enabled"'));
    const scriptEnd = html.indexOf('</script>', scriptStart);
    assert.notEqual(scriptStart, -1);
    assert.notEqual(scriptEnd, -1);
    assert.doesNotThrow(() => new vm.Script(html.slice(scriptStart + 8, scriptEnd)));
});
