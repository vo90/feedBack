const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}
const helpers = ['laneBoundsFromAnchor', 'hwyBuildLaneIntervalModel',
    'createLaneIntervalCache', 'hwyFillLaneSegments'].map(extract).join('\n');
const { build, cache, fill, at, bounds } = new Function(`
    const NFRETS = 24;
    ${helpers}
    ${extract('getChartAnchorAt')}
    return { build: hwyBuildLaneIntervalModel, cache: createLaneIntervalCache,
        fill: hwyFillLaneSegments, at: getChartAnchorAt, bounds: laneBoundsFromAnchor };
`)();
const anchor = (time, fret, width = 4, extra = {}) => ({ time, fret, width, ...extra });
const output = () => ({ dMin: [], dMax: [], z0: [], z1: [], length: 0 });
const rows = out => Array.from({ length: out.length }, (_, i) =>
    [out.dMin[i], out.dMax[i], out.z0[i], out.z1[i]]);
const close = (actual, expected, epsilon = 1e-12) =>
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
function coverage(out, ahead = 3, ts = 1.725) {
    assert.ok(out.length > 0);
    assert.equal(out.z0[0], 0);
    close(out.z1[out.length - 1], -ahead * ts);
    for (let i = 0; i < out.length; i++) {
        assert.ok(out.z0[i] > out.z1[i], 'each interval has positive length');
        if (i) assert.equal(out.z0[i], out.z1[i - 1], 'adjacent sections share the exact endpoint');
    }
}

test('before-first and exact duplicate timestamps match chart lookup without a note epsilon', () => {
    const anchors = [anchor(10, 2), anchor(10, 9), anchor(11, 4), anchor(11, 12)];
    const model = build(anchors);
    assert.deepEqual(model.times, [-Infinity, 10, 11]);
    for (const now of [-4, 9.999999, 10, 10.999999, 11, 30]) {
        const out = fill(model, now, 3, 1.725, output());
        const expected = bounds(at(anchors, now));
        assert.deepEqual([out.dMin[0], out.dMax[0]], [expected.dMin, expected.dMax]);
        coverage(out);
    }
    const justBefore = fill(model, 10.999999, 3, 1.725, output());
    assert.equal(justBefore.dMin[0], 8, 'the next continuous boundary is not anticipated by 0.501 ms');
    close(justBefore.z1[0], -0.000001 * 1.725);
});

test('authored passage endpoints move each display frame at 174.963 Hz', () => {
    // Resolved authored rows from the reported 2 Minutes to Midnight Lead passage.
    const anchors = [anchor(174.871994, 5), anchor(176.850998, 4), anchor(177.175995, 2),
        anchor(179.612, 5), anchor(181.800003, 4), anchor(183.498001, 10), anchor(185.207001, 17)];
    const model = build(anchors), out = output(), previous = new Map();
    let comparisons = 0;
    for (let frame = 0; frame / 174.963 < 11; frame++) {
        const now = 175 + frame / 174.963;
        fill(model, now, 3, 1.725, out);
        coverage(out);
        for (let i = 0; i < out.length - 1; i++) {
            const time = now - out.z1[i] / 1.725;
            const boundary = anchors.find(a => Math.abs(a.time - time) < 1e-10);
            assert.ok(boundary, `unexpected floor end at ${time}`);
            close(out.z1[i], -(boundary.time - now) * 1.725);
            const old = previous.get(boundary.time);
            if (old?.frame === frame - 1) {
                close(out.z1[i] - old.z, 1.725 / 174.963, 1e-12);
                comparisons++;
            }
            previous.set(boundary.time, { frame, z: out.z1[i] });
        }
    }
    assert.ok(comparisons > 2000);
});

test('horizon entry and hit-line crossings clip exactly on either side of an authored time', () => {
    const model = build([anchor(0, 3), anchor(10, 9)]);
    for (const now of [7 - 1e-6, 7, 7 + 1e-6, 10 - 1e-6, 10, 10 + 1e-6]) {
        const out = fill(model, now, 3, 1.725, output());
        coverage(out);
        assert.equal(out.length, now > 7 && now < 10 ? 2 : 1);
        assert.equal(out.dMin[0], now < 10 ? 2 : 8);
    }
});

test('brief A-B-A and more than 96 visible transitions are retained without a slice cap', () => {
    const brief = fill(build([anchor(0, 3), anchor(1, 9), anchor(1.002, 3)]), 0, 3, 1.725, output());
    assert.equal(brief.length, 3);
    close(brief.z0[1] - brief.z1[1], 0.002 * 1.725);
    const dense = Array.from({ length: 202 }, (_, i) => anchor(i / 100, i % 2 ? 9 : 3));
    const out = fill(build(dense), 0, 3, 1.725, output());
    assert.equal(out.length, dense.length);
    coverage(out);
    for (let i = 1; i < out.length; i++) close(out.z0[i], -dense[i].time * 1.725);
});

test('unchanged normalized bounds merge, including arpeggio-tagged rows', () => {
    const ordinary = build([anchor(0, 3), anchor(1, 3), anchor(2, 9)]);
    const marked = build([anchor(0, 3), anchor(0.5, 3, 4, { arp: true }),
        anchor(1, 3, 4, { arpeggio: true }), anchor(2, 9)]);
    assert.deepEqual(marked, ordinary);
    assert.deepEqual(build([anchor(0, 0), anchor(1, 1)]), build([anchor(0, 1)]));
    assert.deepEqual(rows(fill(marked, 0, 3, 1.725, output())),
        rows(fill(ordinary, 0, 3, 1.725, output())));
});

test('seek and backwards playback reuse arrays and produce the same result as a fresh traversal', () => {
    const model = build([anchor(0, 3), anchor(1, 9), anchor(2, 6), anchor(4, 15)]);
    const out = output(), arrays = [out.dMin, out.dMax, out.z0, out.z1];
    for (const now of [0, 0.5, 2, 10, 1, -4, 4, 2.001, 2, 1.999, 0]) {
        assert.equal(fill(model, now, 3, 1.725, out), out);
        assert.deepEqual(rows(out), rows(fill(model, now, 3, 1.725, output())));
        assert.deepEqual([out.dMin, out.dMax, out.z0, out.z1], arrays);
        for (const [i, key] of ['dMin', 'dMax', 'z0', 'z1'].entries()) assert.equal(out[key], arrays[i]);
        coverage(out);
    }
});

test('cache replaces changed chart models and supports explicit reset for an in-place edit', () => {
    const memo = cache(), a = [anchor(0, 3), anchor(1, 9)];
    const first = memo.get(a);
    assert.equal(memo.get(a), first);
    const replacement = [anchor(0, 3), anchor(1, 12)];
    assert.notEqual(memo.get(replacement), first);
    assert.equal(memo.get(replacement).dMin[1], 11);
    const second = memo.get(replacement);
    replacement.push(anchor(2, 5));
    assert.notEqual(memo.get(replacement), second);
    const third = memo.get(replacement);
    replacement[1].fret = 8;
    assert.equal(memo.get(replacement), third, 'same-length mutation requires owner reset');
    memo.reset();
    assert.notEqual(memo.get(replacement), third);
    assert.equal(memo.get(replacement).dMin[1], 7);
});

test('empty input and invalid numeric draw arguments emit no stale segments', () => {
    for (const anchors of [null, undefined, []]) assert.deepEqual(build(anchors), { times: [], dMin: [], dMax: [] });
    const model = build([anchor(0, 3)]), out = output();
    for (const [m, now, ahead, ts] of [[null, 0, 3, 1], [build([]), 0, 3, 1],
        [model, NaN, 3, 1], [model, Infinity, 3, 1], [model, 0, NaN, 1],
        [model, 0, Infinity, 1], [model, 0, 0, 1], [model, 0, -1, 1],
        [model, 0, 3, NaN], [model, 0, 3, Infinity], [model, 0, 3, 0], [model, 0, 3, -1]]) {
        fill(model, 0, 3, 1, out);
        assert.equal(out.length, 1);
        fill(m, now, ahead, ts, out);
        assert.equal(out.length, 0);
    }
});

function emissionHarness() {
    const start = source.indexOf('            const hasChartAnchors = positionAnchors && positionAnchors.length;');
    const end = source.indexOf('// ── Dynamic fret number row', start);
    assert.ok(start > 0 && end > start);
    return new Function(`
        const NFRETS=24, K=.0075, S_BASE=0, NH=.1, AHEAD=3, TS=1.725;
        const xFret=f=>f*.1, _highwayLaneOpacity=x=>x, _usesRsDefaultHighway=()=>true;
        const mLaneOdd={tag:'odd'}, mLaneEven={tag:'even'}, mLaneDivider={tag:'legacy'};
        const mRsLaneDivider={tag:'gray'}, mRsLaneEdge={tag:'analyticCyan'}, mHandPositionEdge={tag:'cyan'}, mLaneDividerExt=null;
        const gRsLaneDivider={}, gLaneDivider={}, highwayIntensity=.5, fretDividersVisible=false;
        function pool() { return { rows:[], get() {
            const position={set(x,y,z){Object.assign(this,{x,y,z});}};
            const scale={set(x,y,z){Object.assign(this,{x,y,z});}};
            const mesh={position,scale,rotation:{}}; this.rows.push(mesh); return mesh;
        }}; }
        const pLane=pool(), pLaneDivider=pool();
        ${helpers}
        ${extract('setLaneDividerGeometry')}
        const _laneIntervalCache=createLaneIntervalCache();
        const _laneSegDMin=[], _laneSegDMax=[], _laneSegZ0=[], _laneSegZ1=[];
        const _laneSegments={dMin:_laneSegDMin,dMax:_laneSegDMax,z0:_laneSegZ0,z1:_laneSegZ1,length:0};
        let _laneSegLen=0, hwyLaneFretClipMin=0, hwyLaneFretClipMax=24;
        const _guidanceLanes={}, _stableRegions={}, _stableRegionResult={}, _stablePlan={};
        ${extract('stableRegionReset')}
        return { reset:stableRegionReset, draw(positionAnchors, now, activeFrets=new Set()) {
            pLane.rows=[];pLaneDivider.rows=[];
            ${source.slice(start,end)}
            return {lanes:pLane.rows, divs:pLaneDivider.rows,
                clip:[hwyLaneFretClipMin,hwyLaneFretClipMax], segments:_laneSegLen};
        }};
    `)();
}

test('production floor and divider emission retain sub-micrometre intervals without overhanging their bounds', () => {
    const harness = emissionHarness();
    const delta = 1e-9;
    const draw = harness.draw([anchor(0, 3), anchor(1, 9), anchor(1 + delta, 3)], 0);
    assert.equal(draw.segments, 3);
    assert.equal(draw.lanes.length, 12);
    assert.equal(draw.divs.length, 15);
    for (const mesh of draw.lanes.slice(4, 8)) {
        close(mesh.scale.y, delta * 1.725, 1e-15);
        close(mesh.position.z + mesh.scale.y / 2, -1.725, 1e-15);
        close(mesh.position.z - mesh.scale.y / 2, -(1 + delta) * 1.725, 1e-15);
    }
    for (const mesh of draw.divs.slice(5, 10)) close(mesh.scale.z, delta * 1.725, 1e-15);
    for (const mesh of draw.lanes) {
        assert.ok(mesh.position.z + mesh.scale.y / 2 <= 1e-15);
        assert.ok(mesh.position.z - mesh.scale.y / 2 >= -3 * 1.725 - 1e-15);
    }
    assert.deepEqual(draw.clip, [2, 6]);
    assert.deepEqual(draw.lanes.map(m => m.material.tag), Array(3).fill(['odd', 'even', 'odd', 'even']).flat());
});

test('production reset clears the interval cache and no-anchor fallback keeps its floor span and stripes', () => {
    const harness = emissionHarness(), anchors = [anchor(0, 3)];
    assert.deepEqual(harness.draw(anchors, 0).clip, [2, 6]);
    anchors[0].fret = 9;
    harness.reset();
    assert.deepEqual(harness.draw(anchors, 0).clip, [8, 12]);
    const fallback = harness.draw([], 10, new Set([3, 4]));
    assert.deepEqual(fallback.clip, [2, 6]);
    assert.equal(fallback.segments, 0);
    assert.equal(fallback.lanes.length, 4);
    assert.deepEqual(fallback.lanes.map(m => m.material.tag), ['odd', 'even', 'odd', 'even']);
    for (const mesh of fallback.lanes) {
        close(mesh.position.z + mesh.scale.y / 2, 0);
        close(mesh.position.z - mesh.scale.y / 2, -3 * 1.725);
    }
    assert.equal(harness.draw([], 10).lanes.length, 0);
});
