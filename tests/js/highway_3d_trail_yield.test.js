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
    const start = src.indexOf('    const TRAIL_YIELD_DEFAULTS');
    const end = src.indexOf('    /** Fixed pre-impact ramp window', start);
    assert.notEqual(start, -1, 'trail-yield helper block start not found');
    assert.notEqual(end, -1, 'trail-yield helper block end not found');
    const block = src.slice(start, end);
    return vm.runInNewContext(
        'const NFRETS = 24; const NEXT_ON_STRING_T_EPS = 0.06;\n'
        + block
        + '\n({ hwyBuildTrailYieldEvents, hwyFillTrailYieldTimes, hwyFillTrailCrossingWindows, hwyTrailOverlapsGemX, hwyTrailYieldAmountAt,'
        + ' hwyTrailFootprintsCanOcclude, hwyTrailPriorityWorldZ, hwyTrailPriorityStringOffset, hwyTrailYieldGemLayer,'
        + ' hwyTrailTargetBehindOrder, hwyBuildTrailOcclusionIndex, hwyFillTrailOcclusionTargets, hwyMergeTrailPriorityWorldZ, hwyTrailOcclusionFrontMask, hwyTrailOcclusionFlagsForPair,'
        + ' TRAIL_OCCLUSION_GEM, TRAIL_OCCLUSION_TRAIL, TRAIL_YIELD_DEFAULTS })',
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
    const start = src.indexOf('        function tremoloOffsetWorldX(');
    const end = src.indexOf('        /** Rendered X centre', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    return vm.runInNewContext(
        'const TREMOLO_BUMP_S = 0.06;\n'
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

test('front-priority settings expose exactly the three supported visual modes', () => {
    const frontMask = helpers.hwyTrailOcclusionFrontMask;
    assert.equal(frontMask(false, false), 0, 'standard: gem and trail stay physically below');
    assert.equal(frontMask(false, true), 0, 'the child setting cannot bypass its parent');
    assert.equal(
        frontMask(true, false),
        helpers.TRAIL_OCCLUSION_GEM,
        'gem-only: promote the gem but retain physical trail stacking',
    );
    assert.equal(
        frontMask(true, true),
        helpers.TRAIL_OCCLUSION_GEM | helpers.TRAIL_OCCLUSION_TRAIL,
        'gem+trail: promote both parts of the lower note',
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
    assert.equal(flags[0], helpers.TRAIL_OCCLUSION_GEM | helpers.TRAIL_OCCLUSION_TRAIL);
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

test('a narrowed trail endpoint uses its upcoming gem depth in both priority modes', () => {
    const endpointTarget = new Float64Array([10.1]);
    for (const gemInFront of [false, true]) {
        const worldZ = helpers.hwyTrailPriorityWorldZ(
            -10, 10, endpointTarget, 1, gemInFront, 230,
        );
        assert.ok(Math.abs(worldZ + 23) < 1e-9);
    }
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
    assert.match(src, /hwyFillTrailYieldTimes\([\s\S]{0,420}?trailYieldEventMatchesRenderedFootprint,\s*trailYieldMarkTarget,/);
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
        /trailOcclusionRegisterRelationships\(\s*trailYieldTargetEvent,\s*strandMatchedEvents,\s*null,\s*strandMatchedEventCount,\s*ribbonRenderOrder,\s*TRAIL_OCCLUSION_GEM/,
        'exact lower-string footprint matching controls the gem while physical ordering owns trails',
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
    assert.match(src, /hwyTrailPriorityWorldZ\([\s\S]{0,180}?strandYieldStarts,\s*strandYieldCount,[\s\S]{0,100}?trailYieldSettings\.gemInFront,\s*TS/);
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
    const ribbonStart = src.indexOf('        function slideRibbonUpdatePositions(');
    const ribbonEnd = src.indexOf('        function noteHasVibrato(', ribbonStart);
    assert.notEqual(ribbonStart, -1);
    assert.notEqual(ribbonEnd, -1);
    assert.doesNotMatch(
        src.slice(ribbonStart, ribbonEnd),
        /\.material\s*=|\.opacity\s*=|\.color\s*\./,
        'the taper must modify geometry only, never trail color or opacity',
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
    const rendererDecl = src.indexOf('        function slideRibbonUpdatePositions(');
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
    assert.match(matcherBody, /sustainTrailCenterXAt\(/);
    assert.match(matcherBody, /trailYieldOpenTargetXBounds\(/);
    assert.match(matcherBody, /hwyTrailFootprintsCanOcclude\(/);
    assert.doesNotMatch(matcherBody, /trailYieldSettings\.(?:gemInFront|includeTrails)/);
    assert.match(matcherBody, /Keeping this predicate onset-only/);

    const rendererBody = src.slice(rendererDecl, src.indexOf('        function noteHasVibrato(', rendererDecl));
    assert.match(rendererBody, /sustainTrailCenterXAt\(/);

    assert.match(src, /function\s+trailYieldSweepMayReachFret\(/);
    assert.match(src, /slideOffsetWorldX\(n,\s*n\.t\s*\+\s*\(n\.sus\s*\|\|\s*0\),\s*ctx\.slideSt\)/);
    assert.match(src, /const\s+tremoloReach\s*=\s*n\.tr\s*\?\s*ctx\.trailW\s*\*\s*0\.375\s*:\s*0/);
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
        /const\s+includeTargetTrails\s*=\s*trailYieldSettings\.gemInFront\s*&&\s*trailYieldSettings\.includeTrails/,
    );
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
