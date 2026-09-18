const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const source2D = fs.readFileSync(path.join(__dirname, '../../static/js/highway-draw.js'), 'utf8');

function fn(name, src = source) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(name);
}

class Attribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
}
class Geometry {
    constructor() {
        this.userData = {};
        this.attributes = { position: new Attribute(new Float32Array(97 * 12), 3),
            color: new Attribute(new Float32Array(97 * 16).fill(1), 4) };
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    setIndex(v) { this.index = v; }
    setDrawRange(start, count) { this.drawRange = { start, count }; }
}

function helpers(lefty = false) {
    const globals = `const SLIDE_RIBBON_SAMPLES = 96; const _leftyCached = ${lefty};
        const TRAIL_CROSSING_BOUNDARY_REFINEMENTS = 6; const TRAIL_CROSSING_TIME_EPS = 1e-5;
        const fretX = f => f * 10; const fretMid = fretX;
        const _slideRibbonTimesScratch = [];
        const dZ = t => -230 * t;
        const techniqueYOffsetWorld = () => 0;
        const tremoloOffsetWorldX = () => 0;
        const TRAIL_YIELD_DEFAULTS = {minScale:.3,leadTime:.5,taperDuration:.05,holdAfter:.05,recoverDuration:.05,endLeadTime:.5,endTaperDuration:.05};`;
    const block = source.slice(source.indexOf('    function slideTrailEnd('), source.indexOf('    // Camera tgtDist building blocks'));
    return new Function('T', globals + fn('hwySmoothstep01') + fn('hwyTrailYieldAmountAt')
        + fn('hwyAppendTrailCrossingWindow') + fn('hwyFillTrailCrossingWindows')
        + block + fn('sustainTrailCenterXAt') + fn('ensureSlideRibbonCapacity')
        + fn('slideRibbonUpdatePair') + fn('trailOrderStrandBoundsAtZ')
        + fn('noteHasVibrato') + fn('noteHasVisibleMotionSustain')
        + fn('noteHasRepeatTechniqueCue') + fn('repeatChordMaySuppressGems')
        + `return { slideOutMarks, slideOutCueAt, slideOutAlphaAt, slideOutWidthScaleAt,
            slideOutOffsetWorldX, slideOutLegacyDirection, sustainTrailCenterXAt,
            slideRibbonSampleTimes, slideOutCrossingTimes, hwyFillTrailCrossingWindows, slideRibbonUpdatePair, trailOrderStrandBoundsAtZ,
            repeatChordMaySuppressGems };`)( { Float32BufferAttribute: Attribute } );
}

const note = { t: 10, s: 2, f: 19, sus: 1.75, slide_out: 'down',
    slide_out_marks: [{ direction: 'down', start: 1.25, end: 1.75 }] };

function ribbon(n, { lefty = false, now = 10, start = 10, duration = n.sus, yielding = false } = {}) {
    const h = helpers(lefty), outline = new Geometry(), body = new Geometry();
    h.slideRibbonUpdatePair(outline, body, 190, 4.4, 1.4, 4, 1,
        5, duration, start, now, n, null,
        yielding ? [11.5] : [], yielding ? [12] : [], yielding ? 1 : 0, n.t + n.sus);
    return { h, outline, body };
}
function ring(geometry, index) {
    const a = geometry.attributes.position.array, c = geometry.attributes.color.array;
    const k = index * 12;
    return { x: (a[k] + a[k + 3]) / 2, width: a[k + 3] - a[k],
        z: a[k + 2], alpha: c[index * 16 + 3] };
}

test('Rats final segment stays located after its earlier tied sustain', () => {
    const h = helpers();
    const rats = { t: 196.2975, s: 5, f: 19, sus: 1.6625, slide_out: 'down',
        slide_out_marks: [{direction:'down',start:1.1875,end:1.6625}] };
    assert.equal(h.slideOutOffsetWorldX(rats, rats.t + 1), 0);
    assert.equal(h.slideOutOffsetWorldX(rats, rats.t + 1.3), 0);
    assert.ok(h.slideOutOffsetWorldX(rats, rats.t + 1.6) < 0);
    assert.equal(h.slideOutLegacyDirection(rats), 0);
    assert.equal(rats.sus, 1.6625);
    assert.equal(rats.sl, undefined);
});

test('both directions mirror through the same center path, never a target fret', () => {
    const up = { ...note, slide_out_marks: [{ direction: 'up', start: 1.25, end: 1.75 }] };
    const normal = helpers(), mirrored = helpers(true);
    assert.ok(normal.sustainTrailCenterXAt(note, 190, 11.7, null, 4) < 190);
    assert.ok(normal.sustainTrailCenterXAt(up, 190, 11.7, null, 4) > 190);
    assert.equal(normal.sustainTrailCenterXAt(up, 190, 11.7, null, 4),
        mirrored.sustainTrailCenterXAt(note, 190, 11.7, null, 4));
    assert.equal(up.sl, undefined); assert.equal(up.slu, undefined);
});

test('known-target slide geometry and ordinary sustains stay untouched', () => {
    const h = helpers();
    assert.equal(h.slideOutOffsetWorldX({ ...note, sl: 22 }, 11.7), 0);
    assert.equal(h.slideOutAlphaAt({ ...note, slu: 17 }, 11.75), 1);
    assert.equal(h.slideOutWidthScaleAt({ ...note, sl: 22 }, 11.75), 1);
    const ordinary = { ...note, slide_out_marks: undefined, slide_out: undefined };
    const r = ribbon(ordinary, { yielding: true });
    for (let i = 0; i <= r.body.userData.ribbonSlices; i++) assert.equal(ring(r.body, i).alpha, 1);
});

test('actual ribbon body and outline taper and fade together; no shared material mutation', () => {
    const r = ribbon(note);
    const last = r.body.userData.ribbonSlices;
    assert.ok(last > 96, 'source contour boundaries have dedicated rings');
    const begin = ring(r.body, 0), end = ring(r.body, last), outlineEnd = ring(r.outline, last);
    assert.equal(begin.width, 4); assert.equal(begin.alpha, 1);
    assert.ok(Math.abs(end.width / begin.width - .72) < 1e-5);
    assert.ok(end.x < begin.x);
    assert.equal(end.alpha, 0); assert.equal(outlineEnd.alpha, 0);
    for (let i = 0; i <= last; i++) {
        assert.equal(ring(r.body, i).alpha, ring(r.outline, i).alpha);
    }
    assert.equal(r.body.drawRange.count, last * 24);
});

test('visibility minimum scale composes conservatively instead of multiplying artistic taper', () => {
    const r = ribbon(note, { yielding: true });
    const end = ring(r.body, r.body.userData.ribbonSlices);
    assert.ok(Math.abs(end.width / 4 - .30) < 1e-5, 'not .3*.72');
    assert.equal(end.alpha, 0);
});

test('short and multiple middle segments retain contour and resume unmarked sustain', () => {
    const n = { ...note, slide_out_marks: [
        { direction: 'down', start: .2, end: .213 },
        { direction: 'up', start: 1, end: 1.04 },
    ] };
    const r = ribbon(n);
    const times = r.h.slideRibbonSampleTimes(n, 10, 1.75, []);
    assert.ok(times.includes(10.2)); assert.ok(times.includes(10.213));
    assert.ok(times.includes(11.04));
    assert.ok(r.h.slideOutOffsetWorldX(n, 10.212) < 0);
    assert.ok(r.h.slideOutOffsetWorldX(n, 11.039) > 0);
    assert.equal(r.h.slideOutOffsetWorldX(n, 11.2), 0);
    assert.equal(r.h.slideOutAlphaAt(n, 11.2), 1);
    const end = ring(r.body, r.body.userData.ribbonSlices);
    assert.equal(end.x, 190); assert.equal(end.alpha, 1); assert.equal(end.width, 4);
});

test('geometry is deterministic across pause, seek and clipped sustain windows', () => {
    const first = ribbon(note), again = ribbon(note);
    assert.deepEqual(first.body.attributes.position.array, again.body.attributes.position.array);
    const clipped = ribbon(note, { now: 11.6, start: 11.6, duration: .15 });
    const end = ring(clipped.body, clipped.body.userData.ribbonSlices);
    assert.ok(Math.abs(end.x - ring(first.body, first.body.userData.ribbonSlices).x) < 1e-4);
    assert.ok(Math.abs(end.z + .15 * 230) < 1e-4);
});

test('decimal endpoint cancellation keeps the final ring at its fading directional tip', () => {
    const n = { ...note, sus: .3, slide_out_marks: [{ direction:'up', start:0, end:.3 }] };
    const r = ribbon(n);
    const end = ring(r.body, r.body.userData.ribbonSlices);
    assert.ok(end.x > 197.99);
    assert.equal(end.alpha, 0);
    assert.ok(Math.abs(end.width - 2.88) < 1e-5);
});

test('narrow slide-out crossing cannot fall between the ordinary uniform sampling ticks', () => {
    const h = helpers();
    const n = { t:0,s:2,f:7,sus:2,slide_out_marks:[{direction:'up',start:.507,end:.517}] };
    const target = { t:0,s:3,f:8,sus:2 };
    const times = h.slideOutCrossingTimes(n, target, 0, 2, []);
    const covered = times.filter(t => Math.abs(70 + h.slideOutOffsetWorldX(n,t) - 80) <= 4);
    assert.ok(covered.length > 0);
    assert.ok(covered.every(t => t >= .507 && t <= .517));
    const starts = new Float64Array(20), ends = new Float64Array(20);
    const overlaps = t => Math.abs(70 + h.slideOutOffsetWorldX(n,t) - 80) <= 4;
    assert.equal(h.hwyFillTrailCrossingWindows(0,2,2/96,overlaps,starts,ends),0,
        'the previous uniformly sampled resolver misses this real crossing');
    let count = 0;
    for (let i = 1; i < times.length; i++) count = h.hwyFillTrailCrossingWindows(
        times[i-1],times[i],2/96,overlaps,starts,ends,count,0);
    assert.ok(count > 0);
    assert.ok(starts[0] >= .507 && ends[count-1] < .518);
    assert.match(source, /slideOutCrossingTimes\(\s*n, target, overlapStart, overlapEnd/);
});

test('render ordering reads actual nonuniform contour footprint', () => {
    const r = ribbon(note), last = r.body.userData.ribbonSlices;
    const tip = ring(r.body, last), out = [];
    r.h.trailOrderStrandBoundsAtZ({ geometry:r.body, nearZ:0, farZ:tip.z }, tip.z, out);
    assert.ok(Math.abs(out[0] - tip.x) < 1e-5);
    assert.ok(Math.abs(out[2] - tip.width) < 1e-5);
});

test('malformed arrays cannot fabricate timing or expose legacy fallback', () => {
    const h = helpers();
    for (const bad of [null, {}, [], [{direction:'up',start:true,end:1}],
        [{direction:'down',start:1,end:Infinity}], [{direction:'down',start:1,end:2}]]) {
        const n = {...note, slide_out_marks:bad};
        assert.equal(h.slideOutMarks(n).length, 0);
        assert.equal(h.slideOutLegacyDirection(n), 0);
    }
    assert.equal(h.slideOutLegacyDirection({slide_out:'up'}), 1);
});

test('repeated chord cues survive while empty and ordinary repeats remain compact', () => {
    const h = helpers();
    assert.equal(h.repeatChordMaySuppressGems(true, false, [note]), false);
    assert.equal(h.repeatChordMaySuppressGems(true, false, [{f:12,slide_out:'up'}]), false);
    assert.equal(h.repeatChordMaySuppressGems(true, false, [{f:12,slide_out:'up',slide_out_marks:[]}]), true);
    assert.match(source, /_scrChordNote\.slide_out_marks = cn\.slide_out_marks/);
    assert.match(source, /_scrChordNote\.slide_out = cn\.slide_out/);
});

test('2D and 3D agree on authoritative interval validation', () => {
    const validate = new Function(fn('slideOutMarks2D', source2D) + ';return slideOutMarks2D;')();
    const h = helpers();
    for (const marks of [note.slide_out_marks, [], null, [{direction:'up',start:0,end:1.7504}],
        [{direction:'up',start:0,end:1},{direction:'down',start:.5,end:1.5}]]) {
        assert.deepEqual(validate({...note,slide_out_marks:marks}), h.slideOutMarks({...note,slide_out_marks:marks}));
    }
});
