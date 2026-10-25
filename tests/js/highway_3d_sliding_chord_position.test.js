const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildHandshapeGuidance, composeHandPositionLanes } = require('../../plugins/highway_3d/src/hand-position-guidance.mjs');
const fixtures = require('../helpers/hand_position_guidance_fixtures.cjs');

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

// Use the renderer's real cached pipelines, including the stable-camera region
// builder before composition. Testing the policy in isolation missed this bug.
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
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
const span = row => [row.fret, row.fret + row.width - 1];
const anchor = (time, fret) => ({time, fret, width:4, guidanceOrigin:'unknown'});
function slideChart({time=10, frets=[3,5], targets=[15,17], kind='sl', duration=2,
    shapeEnd=time+duration, position=frets[0], arrival=false}) {
    const chord = {t:time,id:0,notes:frets.map((f,s)=>({s,f,sus:duration,[kind]:targets[s],ln:arrival}))};
    return {notes:arrival ? targets.map((f,s)=>({t:time+duration,s,f,sus:.4})) : [],
        chords:[chord], anchors:[anchor(0,position), ...(arrival ? [anchor(time+duration,targets[0])] : [])],
        handShapes:[{start_time:time+.000001,end_time:shapeEnd,chord_id:0}],
        chordTemplates:[{frets:[...frets,-1,-1,-1,-1]}]};
}

for (const uniform of [true,false]) for (const camera of ['standard','stable']) {
    const mode = `${camera}/${uniform ? 'uniform' : 'logarithmic'}`;
    for (const [name, settings, expected] of [
        ['short upward slide with rounded onset', {time:88.207,targets:[5,7],duration:.09,shapeEnd:88.296997,arrival:true}, [3,6]],
        ['downward unpitched slide', {time:90.846,targets:[2,4],kind:'slu',duration:.987,shapeEnd:92.985001}, [3,6]],
        ['long upward pitched slide', {}, [3,6]],
        ['long downward pitched slide', {frets:[15,17],targets:[3,5]}, [15,18]],
        ['long upward unpitched slide', {kind:'slu'}, [3,6]],
        ['long downward unpitched slide', {frets:[15,17],targets:[3,5],kind:'slu'}, [15,18]],
        ['valid offset hand position', {position:2}, [2,5]],
    ]) test(`${mode}: ${name} shares a compact onset lane and chord box`, () => {
        const h=harness(uniform), chart=freeze(slideChart(settings)), before=JSON.stringify(chart);
        const chord=chart.chords[0], rows=h[camera](chart), t=chord.t+.000501;
        const lane=h.at(rows,t), frets=chord.notes.map(n=>n.f);
        assert.deepEqual(span(lane),expected);
        assert.deepEqual(h.box(Math.min(...frets),Math.max(...frets),lane),
            {dMin:expected[0]-1,dMax:expected[1]}, 'frame and floor use the same position');
        assert.equal(h.evidence().handShapes.length,1,'the supported handshape remains accepted');
        for (const seek of [t+1,t-1,t,t+3,t]) {
            assert.equal(h[camera]({...chart,currentTime:seek}),rows,'seeks reuse the chart-static timeline');
            assert.deepEqual(h.at(h[camera](chart),t),lane);
        }
        if (settings.arrival) assert.deepEqual(span(h.at(rows,chord.t+settings.duration+.002)),[5,8],
            'the destination attack follows its own position');
        assert.equal(JSON.stringify(chart),before);
    });

    test(`${mode}: a stationary remote sustain still widens the one shared lane`, () => {
        const h=harness(uniform), chart=freeze(fixtures.disjointSustainedContacts());
        const rows=h[camera](chart), lane=h.at(rows,10.500501);
        assert.deepEqual(span(lane),[3,17]);
        assert.deepEqual(h.box(3,5,lane),{dMin:2,dMax:17});
        assert.deepEqual(span(h.at(rows,11.4)),[15,18]);
    });

    test(`${mode}: difficulty replacement does not retain slide or wider-grip bounds`, () => {
        const h=harness(uniform), chart=freeze(slideChart({}));
        assert.deepEqual(span(h.at(h[camera](chart),10.000501)),[3,6]);
        const wide=freeze(fixtures.pickedWideGrip());
        assert.deepEqual(span(h.at(h[camera](wide),10.4)),[3,7]);
        assert.deepEqual(span(h.at(h[camera](chart),10.000501)),[3,6]);
    });
}
