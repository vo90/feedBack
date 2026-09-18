// Exercise the renderer's anchor selection and rail projection without WebGL.
// Chords use millisecond wire times; source-precision anchors can differ slightly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extractFn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unbalanced function: ' + name);
}
const helpers = src.match(/const CHORD_ANCHOR_TIME_EPS = [^;]+;/)[0]
    + extractFn('getChartAnchorAt') + extractFn('chordRailEndAt');
const anchorStart = src.indexOf('const chDtEarly = ch.t - now;');
const anchorEnd = src.indexOf('const chAncB =', anchorStart);
assert.ok(anchorStart >= 0 && anchorEnd > anchorStart);
const selectAnchor = new Function('anchors', 'ch', 'now', 'maxSus',
    helpers + src.slice(anchorStart, anchorEnd) + 'return chAnc;');
const endAt = new Function(helpers + 'return chordRailEndAt;')();
const railStart = src.indexOf('const _effSus = maxSus > 0');
const railEnd = src.indexOf('if (_railLen > 0.001)', railStart);
assert.ok(railStart >= 0 && railEnd > railStart);
const project = new Function('anchors', 'ch', 'now', 'maxSus', '_rawSus',
    helpers + 'const chDt = ch.t - now, AHEAD = 5; const dZ = t => -t * 1.725;'
    + src.slice(railStart, railEnd)
    + 'return {end: now + _dtSusEndRail, length: _railLen, visible: _railLen > 0.001};'
    + '} return {visible: false};');

function near(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

// She's Kinda Hot, Lead: first strum at the fret-16 anchor. Previously its
// approaching rail collapsed to 1 microsecond, then popped in after impact.
const hotAnchors = [
    { time: 117.843002, fret: 12, width: 4 },
    { time: 119.874001, fret: 16, width: 4 },
    { time: 120.637001, fret: 14, width: 4 },
];
test('wire-rounded chord keeps its anchor and full rail before and across impact', () => {
    const ch = { t: 119.874 };
    for (const now of [119.6, 119.85, 119.874, 119.8740005, 119.874001, 119.9]) {
        assert.equal(selectAnchor(hotAnchors, ch, now, 0), hotAnchors[1]);
        const rail = project(hotAnchors, ch, now, 0, 120.129 - ch.t);
        assert.equal(rail.visible, true, `rail at ${now}`);
        near(rail.end, 120.129);
        near(rail.length, (120.129 - Math.max(now, ch.t)) * 1.725);
    }
});

test('both directions of millisecond rounding resolve the onset anchor', () => {
    for (const offset of [-0.0005, 0, 0.000001, 0.0005]) {
        const anchors = [{ time: 9, fret: 2 }, { time: 10 + offset, fret: 16 }, { time: 11, fret: 5 }];
        for (const now of [9.9, 10, 10.0001]) {
            assert.equal(selectAnchor(anchors, { t: 10 }, now, 2), anchors[1]);
        }
        near(endAt(anchors, 10, 12), 11);
    }
});

test('an anchor outside the onset tolerance remains a real clipping boundary', () => {
    const anchors = [{ time: 9, fret: 2 }, { time: 10.0006, fret: 16 }];
    assert.equal(selectAnchor(anchors, { t: 10 }, 9.9, 2), anchors[0]);
    near(endAt(anchors, 10, 12), 10.0006);
});

test('a genuine position change clips permanently, including after seeks', () => {
    const anchors = [{ time: 10, fret: 2 }, { time: 10.1, fret: 7 }, { time: 11, fret: 12 }];
    // Deliberately non-monotonic playback times exercise pause/seek determinism.
    for (const now of [9.5, 10, 10.11, 10.05, 11.2, 10.1, 9.5]) {
        const rail = project(anchors, { t: 10 }, now, 2, 2);
        near(rail.end, 10.1);
        assert.equal(rail.visible, now < 10.1, `rail must stay clipped at ${now}`);
        assert.equal(selectAnchor(anchors, { t: 10 }, now, 2), anchors[0]);
    }
});

test('empty, single, and pre-first-anchor charts preserve existing fallback semantics', () => {
    for (const anchors of [null, [], [{ time: 12 }]]) {
        near(endAt(anchors, 10, 14), 14);
    }
    const anchors = [{ time: 12, fret: 2 }, { time: 13, fret: 7 }];
    assert.equal(selectAnchor(anchors, { t: 10 }, 9, 0), anchors[0]);
    near(endAt(anchors, 10, 14), 13);
    near(endAt(anchors, 10, 10.2), 10.2);
});

test('repeat segments meet and the authored hand-shape end is preserved', () => {
    const times = [119.874, 120.129, 120.383];
    const end = 120.510002;
    times.forEach((t, i) => {
        const segmentEnd = times[i + 1] ?? end;
        const rail = project(hotAnchors, { t }, 119.6, 0, segmentEnd - t);
        assert.equal(rail.visible, true);
        near(rail.end, segmentEnd);
    });
});

test('the reported last-repeat gap at 2:09 is not extended to the next position', () => {
    const anchors = [{ time: 129.533005, fret: 12 }, { time: 130.041, fret: 14 }];
    const ch = { t: 129.787 }, end = 129.914001;
    for (const now of [129.6, 129.8, 129.92, 130]) {
        const rail = project(anchors, ch, now, 0, end - ch.t);
        assert.equal(rail.visible, now < end);
        if (rail.visible) near(rail.end, end);
    }
    near(anchors[1].time - end, 0.126999);
});

test('explicit sustain minimum survives, without extending hand-shape-only rails', () => {
    near(project([], { t: 10 }, 9.9, 0.1, 0.1).end, 10.4);
    near(project([], { t: 10 }, 9.9, 0, 0.1).end, 10.1);
});
