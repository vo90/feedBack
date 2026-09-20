// Exercise actual hold drawing with a minimal mesh pool, rather than duplicating
// interval projection math in test code. Includes source/wire rounding regressions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
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
const constants = ['CHORD_ANCHOR_TIME_EPS', 'NEXT_ON_STRING_T_EPS', 'BEND_LINK_TIME_EPS']
    .map(name => src.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n') + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);';
const functions = ['isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'laneBoundsFromAnchor', 'anchorPlayedFretInclusiveSpan', 'playedFretSpanCoversShape',
    'chordFallbackLaneBounds', 'hwyLinkNextTargetNotes', 'slideInMarks', 'hwyBuildChordHoldGuidance',
    'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides', '_ensureChordGuideEnds',
    'firstVisibleChordGuide', 'drawChordHoldGuides'];
const anchorStart = src.indexOf('const chDtEarly = ch.t - now;');
const anchorEnd = src.indexOf('const chAncB =', anchorStart);
assert.ok(anchorStart >= 0 && anchorEnd > anchorStart);
const selectAnchor = new Function('anchors', 'ch', 'now', 'maxSus', '_chGuideEnd',
    constants + fn('getChartAnchorAt') + src.slice(anchorStart, anchorEnd) + 'return chAnc;');
function makeRenderer(bundle) {
    return new Function('bundle', `
        const NFRETS = 24, K = 1, AHEAD = 5, TS = 1.725, S_GAP = 1;
        let nStr = 6, _chordGuideCache = null, drawn = [];
        const sY = s => s, xFret = f => f * 10, dZ = dt => -dt * TS;
        const pSusRail = { get() {
            const mesh = {
                material: { color: { setHex(value) { mesh.color = value; } }, opacity: 0 },
                position: { set(x, y, z) { mesh.positionValue = [x, y, z]; } },
                scale: { set(x, y, z) { mesh.scaleValue = [x, y, z]; } }
            };
            drawn.push(mesh);
            return mesh;
        } };
        ${constants}
        ${functions.map(fn).join('\n')}
        const ends = _ensureChordGuideEnds(bundle.chords, bundle);
        return { ends, model: _chordGuideCache.model, draw(now) {
            drawn = []; drawChordHoldGuides(now, _chordGuideCache.model); return drawn;
        } };
    `)(bundle);
}
function chord(t, sus = 0, id = 0, frets = [16, 18]) {
    return { t, id, notes: frets.map((f, s) => ({ s, f, sus })) };
}
function fixture(chords, anchors = [], shapes = []) {
    return { chords, anchors, handShapes: shapes, notes: [],
        chordTemplates: [{ frets: [16, 18, -1, -1, -1, -1] }] };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }
function drawnEnd(mesh, now) { return now + (-mesh.positionValue[2] + mesh.scaleValue[2] / 2) / 1.725; }
const hotAnchors = [{ time: 117.843002, fret: 12, width: 4 },
    { time: 119.874001, fret: 16, width: 4 }, { time: 120.637001, fret: 14, width: 4 }];

test('rounded first strum has stable full borders before and across impact', () => {
    const ch = chord(119.874), renderer = makeRenderer(fixture([ch], hotAnchors,
        [{ chord_id: 0, start_time: 119.874001, end_time: 120.129 }]));
    for (const now of [119.6, 119.85, 119.874, 119.8740005, 119.874001, 119.9]) {
        assert.equal(selectAnchor(hotAnchors, ch, now, 0, renderer.ends.get(ch)), hotAnchors[1]);
        const meshes = renderer.draw(now);
        assert.equal(meshes.length, 3, 'two borders and an authored endpoint cap');
        near(drawnEnd(meshes[0], now), 120.129);
        near(meshes[0].scaleValue[2], (120.129 - Math.max(now, ch.t)) * 1.725);
        near(meshes[0].positionValue[0], 150); near(meshes[1].positionValue[0], 190);
    }
});
test('both directions of wire rounding resolve the onset position throughout a hold', () => {
    for (const offset of [-0.0005, 0, 0.000001, 0.0005]) {
        const anchors = [{ time: 9, fret: 2 }, { time: 10 + offset, fret: 16 }, { time: 11, fret: 5 }];
        const ch = chord(10, 2), renderer = makeRenderer(fixture([ch], anchors));
        for (const now of [9.9, 10, 10.0001, 11.5]) {
            assert.equal(selectAnchor(anchors, ch, now, 2, renderer.ends.get(ch)), anchors[1]);
            near(renderer.draw(now)[0].positionValue[0], 150);
            near(drawnEnd(renderer.draw(now)[0], now), 12);
        }
    }
});
test('an anchor outside rounding tolerance does not truncate musical duration', () => {
    const anchors = [{ time: 9, fret: 2 }, { time: 10.0006, fret: 16 }];
    const ch = chord(10, 2), renderer = makeRenderer(fixture([ch], anchors));
    assert.equal(selectAnchor(anchors, ch, 9.9, 2, renderer.ends.get(ch)), anchors[0]);
    near(renderer.draw(9.9)[0].positionValue[0], 150, 'fallback bounds contain the chord');
    near(drawnEnd(renderer.draw(11)[0], 11), 12);
});
test('position changes and backward seeks preserve hold geometry until its exact end', () => {
    const anchors = [{ time: 10, fret: 16 }, { time: 10.1, fret: 7 }, { time: 11, fret: 12 }];
    const ch = chord(10, 2), renderer = makeRenderer(fixture([ch], anchors));
    for (const now of [9.5, 10, 10.11, 10.05, 11.2, 10.1, 9.5]) {
        assert.equal(renderer.draw(now).length, 3);
        near(drawnEnd(renderer.draw(now)[0], now), 12);
        assert.equal(selectAnchor(anchors, ch, now, 2, renderer.ends.get(ch)), anchors[0]);
    }
    assert.equal(renderer.draw(12).length, 0);
    assert.equal(renderer.draw(12.1).length, 0);
    assert.equal(renderer.draw(11.9).length, 3);
});
test('short explicit and legacy holds have exact ends without minimum length', () => {
    for (const explicit of [true, false]) {
        const ch = chord(10, explicit ? 0.1 : 0), shapes = explicit ? []
            : [{ chord_id: 0, start_time: 10, end_time: 10.1 }];
        const renderer = makeRenderer(fixture([ch], [], shapes));
        near(drawnEnd(renderer.draw(9.9)[0], 9.9), 10.1);
        near(drawnEnd(renderer.draw(10.05)[0], 10.05), 10.1);
        assert.equal(renderer.draw(10.1).length, 0);
    }
});
test('culling horizon cannot masquerade as an authored endpoint cap', () => {
    const renderer = makeRenderer(fixture([chord(10, 10)]));
    const far = renderer.draw(9);
    assert.equal(far.length, 2); near(drawnEnd(far[0], 9), 14);
    const close = renderer.draw(16);
    assert.equal(close.length, 3); near(drawnEnd(close[0], 16), 20);
    near(close[2].positionValue[2], -(20 - 16) * 1.725);
    assert.equal(renderer.draw(5).length, 0);
});
test('repeat strums render common borders once and retain individual endpoints', () => {
    const times = [119.874, 120.129, 120.383], end = 120.510002, chords = times.map(t => chord(t));
    const renderer = makeRenderer(fixture(chords, hotAnchors,
        [{ chord_id: 0, start_time: times[0], end_time: end }]));
    assert.equal(renderer.draw(119.6).length, 3);
    near(drawnEnd(renderer.draw(119.6)[0], 119.6), end);
    assert.deepEqual(chords.map(ch => renderer.ends.get(ch)), [times[1], times[2], end]);
});
test('real gaps remain unpainted instead of stretching preceding borders', () => {
    const renderer = makeRenderer(fixture([chord(10, 0.1), chord(10.3, 0.1)]));
    const meshes = renderer.draw(9.9);
    assert.equal(meshes.length, 6);
    near(drawnEnd(meshes[0], 9.9), 10.1); near(drawnEnd(meshes[3], 9.9), 10.4);
    const gapTime = renderer.draw(10.2);
    assert.equal(gapTime.length, 3);
    near(gapTime[0].scaleValue[2], 0.1 * 1.725);
});
