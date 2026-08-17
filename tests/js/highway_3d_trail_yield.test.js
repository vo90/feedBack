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
        + '\n({ hwyBuildTrailYieldEvents, hwyFillTrailYieldTimes, hwyTrailOverlapsGemX, hwyTrailYieldAmountAt,'
        + ' hwyTrailPriorityWorldZ, TRAIL_YIELD_DEFAULTS })',
    );
}

const helpers = loadHelpers();

test('same-fret onset index is sorted, bounded, and merges duplicate members', () => {
    const notes = [
        { t: 3, s: 2, f: 3, sus: 2 },
        { t: 4, s: 8, f: 3, sus: 1 },
        { t: 5, s: 1, f: 25, sus: 1 },
    ];
    const chords = [
        { t: 2, notes: [{ s: 4, f: 3, sus: 0 }] },
        { t: 3, notes: [{ s: 2, f: 3, sus: 4 }] },
    ];
    const events = helpers.hwyBuildTrailYieldEvents(notes, chords, 6)[3];
    assert.deepEqual(
        Array.from(events, ({ t, s, end }) => [t, s, end]),
        [[2, 4, 2], [3, 2, 7]],
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
        'the terminal cross-section should reach the same 15% yield as an interior notch',
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

test('a narrowed trail endpoint uses its upcoming gem depth in both priority modes', () => {
    const endpointTarget = new Float64Array([10.1]);
    for (const gemInFront of [false, true]) {
        const worldZ = helpers.hwyTrailPriorityWorldZ(
            -10, 10, endpointTarget, 1, gemInFront, 230,
        );
        assert.ok(Math.abs(worldZ + 23) < 1e-9);
    }
});

test('short-note notch eases in, reaches 15 percent, then recovers', () => {
    const starts = new Float64Array([10]);
    const ends = new Float64Array([10]);
    const amount = chartTime => helpers.hwyTrailYieldAmountAt(chartTime, starts, ends, 1);

    assert.ok(amount(9.58) < 1e-12);
    assert.ok(amount(9.73) > 0 && amount(9.73) < 1);
    assert.equal(amount(9.88), 1);
    assert.ok(Math.abs(
        1 - (1 - helpers.TRAIL_YIELD_DEFAULTS.minScale) * amount(9.88) - 0.15,
    ) < 1e-12);
    assert.ok(amount(10.22) > 0 && amount(10.22) < 1);
    assert.equal(amount(10.34), 0);
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
    assert.ok(helpers.hwyTrailYieldAmountAt(14.22, starts, ends, 1) > 0);
    assert.equal(helpers.hwyTrailYieldAmountAt(14.34, starts, ends, 1), 0);
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
    assert.match(src, /const\s+ribbonSusTrail\s*=\s*yieldCount\s*>\s*0\s*\|\|/);
    assert.match(src, /trailYieldSettings\.gemInFront\s*\?\s*'NOTE_OUTLINE'\s*:\s*'NOTE_OUTLINE_BEHIND_TRAIL'/);
    assert.match(src, /trailYieldSettings\.gemInFront\s*\?\s*'NOTE_CORE'\s*:\s*'NOTE_CORE_BEHIND_TRAIL'/);
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

test('3D settings expose one shared width and separate passing-note and endpoint timing', () => {
    const src = fs.readFileSync(SCREEN_JS, 'utf8');
    const settingsPath = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'settings.html');
    const html = fs.readFileSync(settingsPath, 'utf8');
    const ids = [
        'h3d-trail-yield-enabled',
        'h3d-trail-yield-gem-in-front',
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
    assert.match(html, /Checks this far after the trail end[\s\S]{0,160}?starts narrowing the same amount before the end/);
    assert.doesNotMatch(src, /TRAIL_YIELD_END_LOOKAHEAD_S/);
    for (const id of [
        'h3d-trail-yield-taper-duration',
        'h3d-trail-yield-recover-duration',
        'h3d-trail-yield-end-taper-duration',
    ]) {
        assert.match(html, new RegExp(`id="${id}" min="0\\.01"`));
    }
    assert.match(src, /trailYieldEndTaperDuration'\s*\?\s*\[0\.01,\s*1\]/);

    const setterKeys = [
        'TrailYieldEnabled',
        'TrailYieldGemInFront',
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

    const scriptStart = html.indexOf('<script>', html.indexOf('id="h3d-trail-yield-enabled"'));
    const scriptEnd = html.indexOf('</script>', scriptStart);
    assert.notEqual(scriptStart, -1);
    assert.notEqual(scriptEnd, -1);
    assert.doesNotThrow(() => new vm.Script(html.slice(scriptStart + 8, scriptEnd)));
});
