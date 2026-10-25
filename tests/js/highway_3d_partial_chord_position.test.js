const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildHandshapeGuidance, composeHandPositionLanes } =
    require('../../plugins/highway_3d/src/hand-position-guidance.mjs');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

// Exercise both actual cached renderer pipelines and their shared frame bounds.
// The stable pipeline also rebuilds musical regions before composing guidance.
function harness(uniform) {
    const functions = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
        'usesUnfrettedPosition', 'naturalNode', 'notePositionX', 'slideTrailEnd', 'getChartAnchorAt',
        'laneBoundsFromAnchor', 'chordFallbackLaneBounds', 'chordShapeLaneBounds',
        'hwyBuildAuthoredStrumFrames', 'hwyResolveGuidanceAnchors', 'hwyResolveChordLanes',
        'hwyBuildPlayingRegions', 'resolvedGuidanceAnchors', 'stableRegionAnchors'];
    return new Function('buildHandshapeGuidance', 'composeHandPositionLanes', `
        const NFRETS=24, CHORD_ANCHOR_TIME_EPS=.000501, nStr=6, _h3dFretUniform=${uniform};
        const fretWire=f=>${uniform ? 'f*10' : '100*(1-Math.pow(2,-f/12))'};
        const fretX=fretWire, fretMid=f=>f>0?(fretWire(f-1)+fretWire(f))/2:-2;
        ${source.match(/const _guidanceLanes = [^;]+;/)[0]}
        ${source.match(/const _stableRegions = [^;]+;/)[0]}
        ${functions.map(extract).join('\n')}
        return { standard:resolvedGuidanceAnchors, stable:stableRegionAnchors,
            at:getChartAnchorAt, box:chordShapeLaneBounds, evidence:()=>_guidanceLanes.evidence };
    `)(buildHandshapeGuidance, composeHandPositionLanes);
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

// A parent D5 handshape accompanies a partial D7/G7 chord and muted repeats.
// Its unplayed A5 must not enlarge the containing authored 7–10 position.
function partialChordChart(extraFret = null) {
    return {
        notes: extraFret === null ? [] : [{ t: 10.125, s: 1, f: extraFret, sus: 0.1 }],
        chords: [10, 10.25, 10.5, 10.75, 11, 11.25, 11.5, 11.75].map((t, i) => ({
            t, id: 1, notes: [2, 3].map(s => ({ s, f: 7, ...(i ? { fhm: true } : {}) })),
        })),
        anchors: [{ time: 0, fret: 7, width: 4 }],
        handShapes: [{ chord_id: 0, start_time: 10, end_time: 12 }],
        chordTemplates: [
            { name: 'D5', frets: [-1, 5, 7, 7, -1, -1] },
            { name: '', frets: [-1, -1, 7, 7, -1, -1] },
        ],
    };
}

const span = row => [row.fret, row.fret + row.width - 1];

for (const uniform of [true, false]) for (const camera of ['standard', 'stable']) {
    const mode = `${camera}/${uniform ? 'uniform' : 'logarithmic'}`;

    test(`${mode}: partial chord and muted-repeat frames retain the authored position`, () => {
        const h = harness(uniform), chart = freeze(partialChordChart());
        const before = JSON.stringify(chart), rows = h[camera](chart);
        assert.deepEqual(h.evidence().handShapes, chart.handShapes, 'context remains accepted');
        assert.deepEqual(h.evidence().decisions[0].matchedStrings, [2, 3]);
        assert.deepEqual(h.evidence().decisions[0].unmatchedStrings, [1]);
        for (const chord of chart.chords) {
            const lane = h.at(rows, chord.t + 0.000501);
            assert.deepEqual(span(lane), [7, 10], 'only actual contact evidence can widen the floor');
            assert.deepEqual(h.box(7, 7, lane), { dMin: 6, dMax: 10 },
                'first chord and muted repeats share the containing floor bounds');
        }
        for (const seek of [11.5, 9, 10.5, 12.1, 10, 11.75, 0]) {
            const cached = h[camera]({ ...chart, currentTime: seek });
            assert.equal(cached, rows, 'forward and reverse seeks reuse chart-static geometry');
            assert.deepEqual(span(h.at(cached, seek)), [7, 10]);
        }
        assert.equal(JSON.stringify(chart), before, 'musical events and metadata remain unchanged');
    });

    test(`${mode}: an actually picked A5 still supports the wider parent grip`, () => {
        const h = harness(uniform), chart = freeze(partialChordChart(5));
        const rows = h[camera](chart);
        assert.deepEqual(h.evidence().decisions[0].matchedStrings, [1, 2, 3]);
        assert.deepEqual(h.evidence().grips.map(g => [g.low, g.high]), [[5, 7]]);
        assert.deepEqual(span(h.at(rows, 9.9)), [7, 10]);
        for (const time of [10, 10.125, 10.5, 11.75, 11.999]) {
            const lane = h.at(rows, time);
            assert.deepEqual(span(lane), [5, 10], 'separately picked full grip remains useful preparation');
            assert.deepEqual(h.box(7, 7, lane), { dMin: 4, dMax: 10 });
        }
        assert.deepEqual(span(h.at(rows, 12)), [7, 10], 'the contextual grip ends at its own boundary');
    });

    test(`${mode}: equal-size difficulty replacement cannot retain earlier wide bounds`, () => {
        const h = harness(uniform);
        // The notes differ by fret only; all collection counts remain equal.
        const wide = freeze(partialChordChart(5)), partial = freeze(partialChordChart(7));
        const snapshots = [wide, partial].map(chart => JSON.stringify(chart));
        let previousRows;
        for (const [chart, expected] of [[wide, [5, 10]], [partial, [7, 10]],
            [wide, [5, 10]], [partial, [7, 10]]]) {
            const rows = h[camera](chart);
            if (previousRows) assert.notEqual(rows, previousRows, 'new chart identity invalidates the cached timeline');
            for (const seek of [11.5, 10, 12.1, 10.5]) {
                const cached = h[camera]({ ...chart, currentTime: seek });
                assert.equal(cached, rows);
                const lane = h.at(cached, 10.500501);
                assert.deepEqual(span(lane), expected);
                assert.deepEqual(h.box(7, 7, lane), { dMin: expected[0] - 1, dMax: expected[1] });
            }
            previousRows = rows;
        }
        assert.deepEqual([wide, partial].map(chart => JSON.stringify(chart)), snapshots);
    });
}
