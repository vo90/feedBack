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

// Run the production cached lane pipelines and the actual chord-bound/link
// helpers, including the stable camera's intermediate musical-region pass.
function harness(uniform) {
    const functions = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
        'usesUnfrettedPosition', 'naturalNode', 'notePositionX', 'slideTrailEnd', 'getChartAnchorAt',
        'laneBoundsFromAnchor', 'chordFallbackLaneBounds', 'chordShapeLaneBounds',
        'hwyBuildAuthoredStrumFrames', 'hwyResolveGuidanceAnchors', 'hwyResolveChordLanes',
        'hwyBuildPlayingRegions', 'resolvedGuidanceAnchors', 'stableRegionAnchors',
        'hwyLinkNextTargetNotes'];
    return new Function('buildHandshapeGuidance', 'composeHandPositionLanes', `
        const NFRETS=24, CHORD_ANCHOR_TIME_EPS=.000501, nStr=6, _h3dFretUniform=${uniform};
        const NEXT_ON_STRING_T_EPS=.06, BEND_LINK_TIME_EPS=.001;
        const fretWire=f=>${uniform ? 'f*10' : '100*(1-Math.pow(2,-f/12))'};
        const fretX=fretWire, fretMid=f=>f>0?(fretWire(f-1)+fretWire(f))/2:-2;
        ${source.match(/const _guidanceLanes = [^;]+;/)[0]}
        ${source.match(/const _stableRegions = [^;]+;/)[0]}
        ${functions.map(extract).join('\n')}
        return { standard:resolvedGuidanceAnchors, stable:stableRegionAnchors,
            at:getChartAnchorAt, box:chordShapeLaneBounds, links:hwyLinkNextTargetNotes,
            evidence:()=>_guidanceLanes.evidence };
    `)(buildHandshapeGuidance, composeHandPositionLanes);
}

function freeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
const span = row => [row.fret, row.fret + row.width - 1];
const position = (time, fret, authored) => ({ time, fret, width: 4,
    ...(authored ? { guidanceOrigin: 'source' } : {}) });

// Minimal chart data from the reported 24:30 passage. The older high-E bend
// ends at 24:24.899; its dangling link must not hold fret 15 until 24:34.551.
function reportedPassage(authored, genuineSustain = false) {
    return {
        notes: [
            { t: 1463.578003, s: 5, f: 15, sus: genuineSustain ? 11 : 1.321,
                ln: true, bn: 2, bnv: [{ t: 0, v: 2 }, { t: 1.166016, v: 0 }], vb: true },
            { t: 1471.281982, s: 3, f: 5, mt: true },
            { t: 1474.551025, s: 5, f: 13 },
        ],
        chords: [
            { t: 1471.04895, id: 0, notes: [{ s: 2, f: 7 }, { s: 3, f: 7 }] },
            { t: 1471.515991, id: 1, notes: [3, 4].map(s => ({ s, f: 5, sus: 1.868, ln: true, vb: true })) },
        ],
        anchors: [position(1461.733032, 13, authored), position(1465.754028, 5, authored),
            position(1470.11499, 5, authored), position(1471.983032, 5, authored),
            position(1474.551025, 10, authored)],
        handShapes: [
            { chord_id: 0, start_time: 1471.04895, end_time: 1471.10498 },
            { chord_id: 1, start_time: 1471.515991, end_time: 1473.384033 },
        ],
        chordTemplates: [
            { name: 'D5', frets: [-1, -1, 7, 7, -1, -1] },
            { name: 'C3', frets: [-1, -1, -1, 5, 5, -1] },
        ],
    };
}

function assertChordBounds(h, rows, chord, expected) {
    const lane = h.at(rows, chord.t + .000501);
    const frets = chord.notes.map(n => n.f).filter(f => f > 0);
    assert.deepEqual(span(lane), expected);
    assert.deepEqual(h.box(Math.min(...frets), Math.max(...frets), lane),
        { dMin: expected[0] - 1, dMax: expected[1] }, 'chord frame and floor share the resolved position');
}

for (const uniform of [true, false]) for (const camera of ['standard', 'stable']) {
    for (const authored of [true, false]) {
        const mode = `${camera}/${uniform ? 'uniform' : 'logarithmic'}/${authored ? 'source' : 'legacy'}`;

        test(`${mode}: the expired high-E link cannot widen the reported chord boxes`, () => {
            const h = harness(uniform), chart = freeze(reportedPassage(authored));
            const snapshot = JSON.stringify(chart), rows = h[camera](chart);
            for (const chord of chart.chords) assertChordBounds(h, rows, chord, [5, 8]);
            assert.equal(h.links(chart.notes, chart.chords).has(chart.notes[2]), false,
                'the future fret-13 attack is not a linked continuation');
            for (const time of [1470.5, 1471.049451, 1471.516492, 1472.5, 1473.383]) {
                assert.deepEqual(span(h.at(rows, time)), [5, 8]);
            }
            for (const seek of [1472.5, 1463.6, 1471.049451, 1474.6, 1471.516492, 1470.5]) {
                const cached = h[camera]({ ...chart, currentTime: seek });
                assert.equal(cached, rows, 'forward/reverse seeking reuses chart-static geometry');
                for (const chord of chart.chords) assertChordBounds(h, cached, chord, [5, 8]);
            }
            assert.equal(JSON.stringify(chart), snapshot, 'musical data remains untouched');
        });

        test(`${mode}: a real high-E sustain still widens the same chord boxes`, () => {
            const h = harness(uniform), chart = freeze(reportedPassage(authored, true));
            const snapshot = JSON.stringify(chart), rows = h[camera](chart);
            for (const chord of chart.chords) assertChordBounds(h, rows, chord, [5, 15]);
            assert.equal(JSON.stringify(chart), snapshot);
        });

        test(`${mode}: equal-size difficulty replacement releases stale wide bounds`, () => {
            const h = harness(uniform), wide = freeze(reportedPassage(authored, true));
            const narrow = freeze(reportedPassage(authored));
            const snapshots = [wide, narrow].map(chart => JSON.stringify(chart));
            let previous;
            for (const [chart, expected] of [[wide, [5, 15]], [narrow, [5, 8]],
                [wide, [5, 15]], [narrow, [5, 8]]]) {
                const rows = h[camera](chart);
                if (previous) assert.notEqual(rows, previous, 'replacement invalidates the old timeline');
                for (const chord of chart.chords) assertChordBounds(h, rows, chord, expected);
                previous = rows;
            }
            assert.deepEqual([wide, narrow].map(chart => JSON.stringify(chart)), snapshots);
        });

        for (const sliding of [false, true]) test(`${mode}: valid ${sliding ? 'slide' : 'same-fret'} linked chords retain their contacts`, () => {
            const h = harness(uniform), firstFrets = sliding ? [3, 5] : [7, 7];
            const chart = freeze({
                notes: [],
                chords: [
                    { t: 10, id: 0, notes: firstFrets.map((f, i) => ({ s: i + 2, f,
                        sus: 1, ln: true, ...(sliding ? { sl: 7 } : {}) })) },
                    { t: 11, id: 1, notes: [2, 3].map(s => ({ s, f: 7, sus: 1, ln: true })) },
                    { t: 12, id: 1, notes: [2, 3].map(s => ({ s, f: 7, sus: .5 })) },
                ],
                anchors: [position(0, sliding ? 3 : 5, authored), position(11, 5, authored)],
                handShapes: [
                    { chord_id: 0, start_time: 10, end_time: 11 },
                    { chord_id: 1, start_time: 11, end_time: 12.5 },
                ],
                chordTemplates: [
                    { frets: [-1, -1, ...firstFrets, -1, -1] },
                    { frets: [-1, -1, 7, 7, -1, -1] },
                ],
            });
            const snapshot = JSON.stringify(chart), rows = h[camera](chart);
            const targets = h.links(chart.notes, chart.chords);
            assert.equal(targets.size, 4, 'both continuation chords still suppress their duplicate attacks');
            for (const chord of chart.chords.slice(1)) {
                for (const note of chord.notes) assert.ok(targets.has(note));
                assertChordBounds(h, rows, chord, [5, 8]);
            }
            assertChordBounds(h, rows, chart.chords[0], sliding ? [3, 6] : [5, 8]);
            const contacts = h.evidence().eventGrips;
            for (const time of [11.5, 12.4]) {
                const held = contacts.filter(g => g.start <= time && time < g.end);
                assert.equal(held.length, 2, 'both linked destination strings retain physical contact evidence');
                assert.ok(held.every(g => g.low === 7 && g.high === 7),
                    'arrivals retain their destination fret rather than the earlier slide path');
            }
            assert.deepEqual(span(h.at(rows, 12.4)), [5, 8]);
            assert.equal(JSON.stringify(chart), snapshot);
        });
    }
}
