const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');
const api = cameraApi();
const row = (time, fret) => ({time,firstFret:fret,lastFret:fret+3,
    minX:(fret-1)*10,maxX:(fret+3)*10,x:(fret+1)*10,preferred:(fret+1)*10});
const at = (timeline,time) => timeline.find(span=>span.time<=time&&time<span.end);
const apply = (evidence,threshold) => api.hwyApplyCameraThreshold(evidence,{excursionThreshold:threshold});
function mosh() {
    const route=[[50.791,1],[51.363998,3],[51.792999,4],[52.222,5],[52.505001,6],[52.93,7],
        [57.219002,7],[59.380001,8],[59.919998,7],[60.325001,6],[60.459999,7],
        [63.676998,8],[64.219002,7],[64.625999,6],[64.761002,7],[67.998001,8],
        [68.539001,7],[68.945,6],[69.080002,7],[72.348,8],[72.899002,7]];
    return {rows:route.map(([time,fret])=>row(time,fret)),notes:route.map(([t,f])=>({t,s:3,f})),
        chords:[{t:53.071999,notes:[{s:1,f:7},{s:2,f:9},{s:3,f:9}]}],
        sections:[{time:53.459,name:'noguitar'},{time:57.219002,name:'verse'}],stringCount:6};
}
const compile = chart => api.hwyCompileCameraEvidence(chart.rows,{context:chart});

test('a verified no-guitar break resets the earlier climb inside a same-base lane',()=>{
    const chart=mosh(), original=JSON.stringify(chart), evidence=compile(chart), before=JSON.stringify(evidence);
    const after=at(evidence.spans,57.219002);
    assert.equal(after.time,52.93,'the break must not invent a lane or move the existing stable home');
    assert.equal(after.firstFret,7);
    assert.ok(evidence.protectedIndices.includes(evidence.spans.indexOf(after)),
        'the shared lane remains the genuine pre-break climb endpoint');
    assert.ok(!evidence.protectedIndices.includes(evidence.spans.indexOf(at(evidence.spans,59.380001))));
    for(const threshold of [250,500,1000,3000]) {
        const stops=apply(evidence,threshold), right=at(stops.timeline,59.380001), left=at(stops.timeline,60.325001);
        assert.equal(left.explanation.decision,'hold');
        assert.equal(left.explanation.home.firstFret,7);
        assert.equal(left.cameraX,80);
        assert.equal(right.explanation.decision,threshold>540?'hold':'follow');
        if(threshold>540) {
            assert.equal(right.explanation.home.firstFret,7);
            assert.equal(right.cameraX,80);
            assert.deepEqual(stops.filter(stop=>stop.time<61.674&&stop.end>57.596).map(stop=>stop.firstFret),[7]);
        }
    }
    assert.equal(JSON.stringify(chart),original,'classification must not alter the source chart');
    assert.equal(JSON.stringify(evidence),before,'threshold edits must not reclassify cached evidence');
});

test('ordinary section names and long lane dwell do not reset climbs, descents or advancing zigzags',()=>{
    const routes=[[[0,1],[.2,3],[.4,5],[8,7],[8.2,9]],
        [[0,13],[.2,11],[.4,9],[8,7],[8.2,5]],
        [[0,1],[.2,6],[.4,2],[8,7],[8.2,3],[8.4,8],[8.6,4],[8.8,9]]];
    for(const route of routes) {
        const chart={rows:route.map(([time,fret])=>row(time,fret)),notes:route.map(([t,f])=>({t,s:3,f})),
            sections:[{time:2,name:'verse'},{time:7,name:'solo'}]};
        const evidence=compile(chart), baseline=compile({...chart,sections:[]});
        assert.deepEqual(evidence.protectedIndices,baseline.protectedIndices);
        assert.deepEqual(apply(evidence,3000).map(stop=>[stop.time,stop.firstFret]),
            apply(baseline,3000).map(stop=>[stop.time,stop.firstFret]));
        assert.ok(evidence.protectedIndices.length>0,'the fixture contains a genuine protected route');
    }
});

test('a no-guitar label cannot reset travel when any attack or sustain occupies the interval',()=>{
    const blockers=[
        chart=>chart.notes.push({t:55,s:3,f:9}),
        chart=>chart.notes.push({t:53.459,s:3,f:9}),
        chart=>chart.notes.push({t:55,s:0,f:0}),
        chart=>chart.notes.push({t:55,s:0,f:127,mt:true}),
        chart=>chart.notes.push({t:55,s:3,f:9,mt:true}),
        chart=>chart.notes.push({t:53,s:3,f:7,sus:1}),
        chart=>chart.notes.push({t:52,s:0,f:0,sus:8}),
        chart=>chart.notes.push({t:52,s:0,f:7,let_ring_sus:8}),
        chart=>chart.notes.push({t:53,s:3,f:7,sus:Infinity}),
        chart=>chart.notes.push({t:53,s:3,f:7,sus:'unknown'}),
        chart=>chart.chords.push({t:55,notes:[{s:1,f:7},{s:2,f:9}]}),
        chart=>chart.chords.push({t:53,notes:[{s:1,f:7,sus:1},{s:2,f:9}]}),
        chart=>chart.chords.push({t:53,sus:1,notes:[{s:1,f:7},{s:2,f:9}]}),
    ];
    for(const block of blockers) {
        const chart=mosh();block(chart);
        const evidence=compile(chart), baseline=compile({...chart,sections:[]});
        assert.deepEqual(evidence.spans.map(span=>[span.time,span.firstFret]),
            baseline.spans.map(span=>[span.time,span.firstFret]));
        assert.deepEqual(evidence.protectedIndices,baseline.protectedIndices);
        assert.equal(at(apply(evidence,3000).timeline,59.380001).explanation.reason,'progressive-run');
    }
});

test('an explicit silence interval accepts a resume attack and a sustain ending exactly at its start',()=>{
    const chart=mosh();chart.sections[0].name='silence';
    chart.notes.push({t:52,s:3,f:7,sus:1.459});
    const evidence=compile(chart), stops=apply(evidence,1000);
    assert.equal(at(stops.timeline,59.380001).explanation.decision,'hold');
    assert.equal(at(stops.timeline,59.380001).explanation.home.firstFret,7);
});

test('rounded wire attacks at the resume boundary use chart coincidence tolerance only',()=>{
    for(const [offset,holds] of [[.000002,true],[.000502,false]]) {
        const chart=mosh();chart.notes.find(note=>note.t===57.219002).t-=offset;
        const span=at(apply(compile(chart),1000).timeline,59.380001);
        assert.equal(span.explanation.decision,holds?'hold':'follow');
        if(holds) assert.equal(span.explanation.home.firstFret,7);
    }
});

test('missing, malformed and zero-length quiet-section metadata cannot invent a reset',()=>{
    for(const sections of [[],[{time:53.459,name:'verse'},{time:57.219002,name:'chorus'}],
        [{time:53.459,name:'noguitar'}],
        [{time:NaN,name:'noguitar'},{time:57.219002,name:'verse'}],
        [{time:53.459,name:null},{time:57.219002,name:'verse'}],
        [{time:53.459,name:'noguitar'},{time:53.459,name:'verse'}],
        [{time:53.459,name:'noguitar'},{time:53.459,name:'verse'},{time:57.219002,name:'chorus'}]]) {
        const chart=mosh();chart.sections=sections;
        const evidence=compile(chart);
        assert.equal(at(apply(evidence,3000).timeline,59.380001).explanation.reason,'progressive-run');
    }
});

test('a quiet label shorter than chart precision cannot hide an attack at its start',()=>{
    const chart=mosh();
    chart.sections=[{time:53.071999,name:'noguitar'},{time:53.072,name:'verse'}];
    const evidence=compile(chart), baseline=compile({...chart,sections:[]});
    assert.deepEqual(evidence.protectedIndices,baseline.protectedIndices);
    assert.equal(at(apply(evidence,3000).timeline,59.380001).explanation.reason,'progressive-run');
});

test('a fresh lane beginning exactly at the resume is a new seed, not an extra step of the old climb',()=>{
    const route=[[0,1],[.1,3],[.2,5],[.3,7],[2,8],[2.1,7],[2.2,6],[2.3,7]];
    for(const resume of [2,2.000002]) {
        const chart={rows:route.map(([time,fret])=>row(time,fret)),notes:route.map(([t,f])=>({t,s:3,f})),
            sections:[{time:.5,name:'noguitar'},{time:resume,name:'verse'}]};
        const evidence=compile(chart), protectedAt=time=>evidence.protectedIndices.includes(evidence.spans.indexOf(at(evidence.spans,time)));
        assert.ok(protectedAt(.3),'the completed climb keeps its old endpoint');
        assert.ok(!protectedAt(2),'the resumed lane cannot borrow the prior climb');
        const left=at(apply(evidence,500).timeline,2.2);
        assert.equal(left.explanation.decision,'hold');
        assert.equal(left.explanation.home.firstFret,7);
    }
});

test('duplicate quiet labels and section ordering preserve one verified break',()=>{
    const chart=mosh();chart.sections=[chart.sections[1],{time:53.459,name:'silence'},chart.sections[0]];
    const stops=apply(compile(chart),1000);
    assert.equal(at(stops.timeline,59.380001).explanation.decision,'hold');
    assert.equal(at(stops.timeline,60.325001).explanation.decision,'hold');
});

test('matching lane cycles on opposite sides of a verified break cannot lend each other proof',()=>{
    const route=[[0,7],[.1,9],[.2,10],[.3,7],[2,7],[2.1,9],[2.2,10],[2.3,7]];
    const chart={rows:route.map(([time,fret])=>row(time,fret)),notes:route.map(([t,f])=>({t,s:3,f})),
        sections:[{time:.5,name:'noguitar'},{time:2,name:'verse'}]};
    const joined=compile({...chart,sections:[]});
    assert.ok(joined.patterns.some(pattern=>pattern.kind==='repeated-cycle'),'without a musical break the cycles really match');
    const evidence=compile(chart);
    assert.ok(!evidence.patterns.some(pattern=>pattern.kind==='repeated-cycle'));
    assert.ok(!evidence.candidates.some(candidate=>candidate.reason==='repeated-cycle'));
});

test('a shared stable home remains the completed return before the break and the seed after it',()=>{
    const route=[[0,7],[.1,9],[.2,7],[2,7],[2.1,8],[2.2,7]];
    const chart={rows:route.map(([time,fret])=>row(time,fret)),notes:route.map(([t,f])=>({t,s:3,f})),
        sections:[{time:.5,name:'noguitar'},{time:2,name:'verse'}]};
    const stops=apply(compile(chart),500);
    for(const time of [.1,2.1]) {
        assert.equal(at(stops.timeline,time).explanation.decision,'hold');
        assert.equal(at(stops.timeline,time).explanation.home.firstFret,7);
    }
    assert.deepEqual(stops.map(stop=>stop.firstFret),[7]);
});

test('geometry reprojection retains a verified same-base boundary and its chosen home',()=>{
    const chart=mosh(), evidence=compile(chart), before=JSON.stringify(evidence);
    const mirrored=chart.rows.map(span=>({...span,minX:-span.maxX,maxX:-span.minX,x:-span.x,preferred:-span.preferred}));
    const projected=api.hwyProjectCameraEvidence(evidence,mirrored);
    assert.deepEqual(projected.spans.map(span=>[span.time,span.end,span.firstFret]),
        evidence.spans.map(span=>[span.time,span.end,span.firstFret]));
    for(const threshold of [250,500,1000,3000]) {
        const a=apply(evidence,threshold), b=apply(projected,threshold);
        assert.deepEqual(b.timeline.map(span=>span.explanation.reason),a.timeline.map(span=>span.explanation.reason));
        assert.equal(at(b.timeline,60.325001).cameraX,-80);
    }
    assert.equal(JSON.stringify(evidence),before);
});
