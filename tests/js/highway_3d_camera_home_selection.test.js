const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCameraSemantics} = require('../../plugins/highway_3d/src/camera-semantics.mjs');
const api = createCameraSemantics({NFRETS:24,isRenderableNote:()=>true});
const row = (time,fret) => ({time,firstFret:fret,lastFret:fret+3,
    minX:(fret-1)*10,maxX:(fret+3)*10,x:(fret+1)*10,preferred:(fret+1)*10});
const compile = (rows,context=null) => api.hwyCompileCameraEvidence(rows,{context});
const apply = (evidence,threshold) => api.hwyApplyCameraThreshold(evidence,{excursionThreshold:threshold});
const selections = evidence => evidence.patterns.filter(pattern=>pattern.homeSelection);
const spanAt = (timeline,time) => timeline.find(span=>span.time<=time&&time<span.end);
function repeated(frets,durations,repetitions=3) {
    let time=0;
    const rows=[];
    for(let cycle=0;cycle<repetitions;cycle++) for(let i=0;i<frets.length;i++) {
        rows.push(row(time,frets[i]));
        time+=Array.isArray(durations[0])?durations[cycle][i]:durations[i];
    }
    rows.push(row(time,frets[0]));
    return rows;
}
function mosh(longHome=3.3) {
    const prefix=[[0,1],[.1,3],[.2,4],[.3,5],[.4,6],[.5,7]].map(([time,fret])=>row(time,fret));
    return prefix.concat(repeated([8,7,6,7],[.558,.42,.139,longHome]).map(span=>({...span,time:span.time+.6})));
}

test('a recurring majority home owns the short replies without erasing the incoming climb',()=>{
    const rows=mosh(), evidence=compile(rows), firstEight=evidence.spans.findIndex(span=>span.firstFret===8);
    assert.ok(evidence.protectedIndices.includes(firstEight));
    assert.deepEqual(evidence.protectedIndices,[0,1,2,3,4,5,6]);
    assert.ok(selections(evidence).length>0);
    assert.equal(selections(evidence)[0].home.firstFret,7);
    assert.equal(selections(evidence)[0].homeSelection.previousHomeIndex,firstEight);
    for(const threshold of [250,500,1000,3000]) {
        const stops=apply(evidence,threshold), first=stops.timeline[firstEight];
        assert.equal(first.explanation.decision,'follow');
        assert.equal(first.explanation.reason,'progressive-run');
        for(const span of stops.timeline.slice(firstEight+1,-1)) {
            if(span.firstFret===6 || span.firstFret===8&&threshold>558) {
                assert.equal(span.explanation.decision,'hold');
                assert.equal(span.explanation.home.firstFret,7);
            } else if(span.firstFret===8) assert.equal(span.explanation.decision,'follow');
        }
    }
});

test('home selection is independent of the threshold cap and each reply keeps its own equality boundary',()=>{
    for(const dwell of [2.999,3.001]) {
        const evidence=compile(mosh(dwell)), before=JSON.stringify(evidence);
        assert.equal(selections(evidence)[0].home.firstFret,7);
        let priorHeld=new Set();
        for(const threshold of [0,139,139.01,250,500,558,558.01,1000,3000]) {
            const stops=apply(evidence,threshold), held=new Set();
            for(const span of stops.timeline) {
                if(span.explanation.decision==='hold') {
                    held.add(span.time);
                    assert.equal(span.explanation.home.firstFret,7);
                }
                if(span.firstFret===6&&span.time>.6)
                    assert.equal(span.explanation.decision,threshold>139?'hold':'follow');
                if(span.firstFret===8&&span.time>.6&&Number.isFinite(span.duration))
                    assert.equal(span.explanation.decision,threshold>558?'hold':'follow');
            }
            for(const time of priorHeld) assert.ok(held.has(time),'a larger threshold cannot restore a held target');
            priorHeld=held;
        }
        assert.equal(JSON.stringify(evidence),before,'threshold edits must not reclassify evidence');
    }
});

test('two completed cycles suffice and an incomplete final return contributes no proof',()=>{
    const rows=repeated([8,7,6,7],[.558,.42,.139,3.3],2), evidence=compile(rows);
    assert.equal(selections(evidence)[0].home.firstFret,7);
    assert.deepEqual(selections(evidence)[0].homeSelection.interval,{start:0,end:rows.at(-1).time});
    const stops=apply(evidence,1000);
    assert.equal(stops.timeline.at(-1).explanation.decision,'follow');
    assert.equal(stops.timeline.at(-1).firstFret,8,'the unreturned final destination stays real');
    const one=compile(repeated([8,7,6,7],[.558,.42,.139,3.3],1));
    assert.equal(selections(one).length,0,'one cycle cannot establish a new recurring home');
});

test('visit ties, time ties, plurality and a sustained single visit retain existing ownership',()=>{
    const fixtures=[
        [[5,8,7,4],[.3,.3,.3,.3]],
        [[5,8,10,8],[.3,.3,.3,.3]],
        [[8,7,6,7,5],[.2,.17,.3,.17,.3]],
        [[8,7,6,5],[.1,2,.1,.1]],
        [[8,7,6,7],[2,.1,.1,.1]],
        [[8,7,6,7],[.3,.3,.3,.30000000001]],
    ];
    for(const [frets,durations] of fixtures) {
        const evidence=compile(repeated(frets,durations));
        assert.equal(selections(evidence).length,0,frets.join('→'));
        if(evidence.patterns.length) assert.equal(evidence.patterns[0].home.firstFret,frets[0]);
    }
});

test('an unproven derived reply vetoes ownership changes even when the alternative dominates time and visits',()=>{
    for(const [frets,home] of [
        [[1,3,2,3,2,7,6,2,3,2],2],
        [[8,6,5,6,7,4,7,5,7],7],
    ]) {
        const durations=frets.map(fret=>fret===home?2:.2);
        const evidence=compile(repeated(frets,durations));
        assert.equal(selections(evidence).length,0,'including a return crossing the middle proof boundary');
        assert.ok(evidence.patterns.some(pattern=>pattern.home.firstFret===frets[0]));
        const stops=apply(evidence,3000);
        for(const span of stops.timeline.filter(span=>span.explanation.decision==='hold'))
            assert.equal(span.explanation.home.firstFret,frets[0],'a nearer eligible reply cannot win by accident');
    }
});

test('a later qualifying pair cannot rewrite an earlier cycle with weak home evidence',()=>{
    const rows=repeated([8,7,6,7],[[2,.1,.2,.1],[.5,.5,.1,2.5],[.5,.5,.1,2.5]]);
    const evidence=compile(rows), chosen=selections(evidence);
    assert.ok(chosen.length>0);
    assert.equal(chosen[0].home.firstFret,7);
    assert.ok(chosen[0].start>=rows[4].time);
    assert.ok(chosen[0].homeSelection.interval.start>=rows[4].time);
    const stops=apply(evidence,3000);
    for(const span of stops.timeline.filter(span=>span.time<rows[4].time&&span.firstFret!==8)) {
        assert.equal(span.explanation.decision,'hold');
        assert.equal(span.explanation.home.firstFret,8);
    }
});

test('same-base width extensions neither add visits nor change the chosen centre',()=>{
    const rows=mosh(), extended=rows.flatMap((span,i)=>span.firstFret!==7||i===rows.length-1?[span]:[
        span,{...span,time:span.time+.01,lastFret:span.lastFret+5,maxX:span.maxX+50,x:span.x+20,preferred:span.preferred+20},
    ]);
    const original=compile(rows), evidence=compile(extended);
    for(const threshold of [0,500,1000,3000])
        assert.deepEqual(apply(evidence,threshold).map(span=>[span.time,span.firstFret,span.x]),
            apply(original,threshold).map(span=>[span.time,span.firstFret,span.x]));
    assert.equal(selections(evidence)[0].home.firstFret,7);
});

test('proven note variations retain home dwell and do not create an ineligible empty return',()=>{
    const rows=repeated([8,7,6,7],[.558,.42,.139,12.8]);
    const notes=[],beats=[],expanded=rows.slice();
    for(const span of rows.filter((span,i)=>i%4===3)) {
        for(const offset of [0,4,8]) notes.push({t:span.time+offset+.2,s:0,f:7,sus:0},
            {t:span.time+offset+1,s:1,f:offset===4?17:9,sus:1.2},
            {t:span.time+offset+3,s:0,f:7,sus:0});
        for(const offset of [0,4,8,12]) beats.push({time:span.time+offset,measure:beats.length});
        expanded.push(row(span.time+5,17),row(span.time+6.2,7));
    }
    expanded.sort((a,b)=>a.time-b.time);
    const evidence=compile(expanded,{notes,beats}), original=compile(rows);
    assert.equal(evidence.candidates.filter(candidate=>candidate.kind==='riff-variation').length,3);
    assert.equal(selections(evidence)[0].home.firstFret,7);
    for(const threshold of [500,1000,3000]) {
        const stops=apply(evidence,threshold), baseline=apply(original,threshold);
        for(const source of rows) {
            const actual=spanAt(stops.timeline,source.time), expected=spanAt(baseline.timeline,source.time);
            assert.equal(actual.cameraX,expected.cameraX);
            assert.equal(actual.explanation.decision,expected.explanation.decision);
        }
        for(const span of stops.timeline.filter(span=>span.firstFret===17)) {
            assert.equal(span.explanation.decision,'hold');
            assert.equal(span.explanation.home.firstFret,7);
        }
    }
});

test('a variation at the start of a proof cannot erase the original home dwell and manufacture a majority',()=>{
    const rows=repeated([8,7,6,7],[[7,.4,.1,1],[.2,.4,.1,1]],2);
    const notes=[];
    for(const start of [0,4,8]) notes.push({t:start+.2,s:0,f:8,sus:0},
        {t:start+1,s:1,f:start===4?17:10,sus:1.2},{t:start+3,s:0,f:8,sus:0});
    const expanded=rows.concat([row(5,17),row(6.2,8)]).sort((a,b)=>a.time-b.time);
    const evidence=compile(expanded,{notes,beats:[0,4,8,12].map((time,measure)=>({time,measure}))});
    assert.equal(evidence.candidates.filter(candidate=>candidate.kind==='riff-variation').length,1);
    assert.equal(selections(evidence).length,0,'the original 7-second home visit belongs in the first vote');
    const stops=apply(evidence,3000);
    for(const span of stops.timeline.filter(span=>span.explanation.decision==='hold'))
        assert.equal(span.explanation.home.firstFret,8);
});

test('genuine climbs, descents and advancing zigzags never become a majority-home riff',()=>{
    for(const frets of [[1,5,9,13,9,5],[13,9,5,1,5,9],[1,6,2,7,3,8,4,9]]) {
        const evidence=compile(repeated(frets,frets.map(fret=>fret===7?3:.1)));
        assert.ok(evidence.protectedIndices.length>0);
        assert.equal(selections(evidence).length,0);
        const stops=apply(evidence,3000);
        for(const index of evidence.protectedIndices)
            assert.equal(stops.timeline[index].explanation.decision,'follow');
    }
});

test('verified musical breaks cannot combine weak cycles into a promoted home',()=>{
    const rows=repeated([8,7,6,7],[.558,.42,.139,3.3],2), end=rows[4].time;
    const context={notes:rows.map(span=>({t:span.time,s:3,f:span.firstFret})),
        sections:[{time:end-1,name:'noguitar'},{time:end,name:'verse'}]};
    const evidence=compile(rows,context);
    assert.equal(evidence.musicalBreaks.length,1);
    assert.equal(selections(evidence).length,0);
});

test('a shared home after a verified break votes with post-resume dwell only',()=>{
    const rows=[[0,8],[10,8],[10.2,7],[10.6,6],[10.7,7],
        [11.7,8],[11.9,7],[12.3,6],[12.4,7],[13.4,8]].map(([time,fret])=>row(time,fret));
    const context={notes:rows.map(span=>({t:span.time,s:3,f:span.firstFret})),
        sections:[{time:1,name:'noguitar'},{time:10,name:'verse'}]};
    const evidence=compile(rows,context), ordinary=compile(rows);
    assert.equal(evidence.spans[0].time,0,'the coalesced camera stop remains unchanged');
    assert.equal(evidence.spans[0].firstFret,8);
    assert.equal(selections(ordinary).length,0,'the earlier dwell normally belongs to the first visit');
    const selection=selections(evidence)[0];
    assert.equal(selection.home.firstFret,7);
    assert.deepEqual(selection.homeSelection.interval,{start:10,end:13.4});
    const stops=apply(evidence,500);
    for(const span of stops.timeline.filter(span=>span.time>10&&span.time<13.4&&span.firstFret!==7)) {
        assert.equal(span.explanation.decision,'hold');
        assert.equal(span.explanation.home.firstFret,7);
    }
});

test('geometry projection preserves home-selection evidence and only updates its focus coordinates',()=>{
    const rows=mosh(), evidence=compile(rows), before=JSON.stringify(evidence);
    const mirrored=rows.map(span=>({...span,minX:-span.maxX,maxX:-span.minX,x:-span.x,preferred:-span.preferred}));
    const projected=api.hwyProjectCameraEvidence(evidence,mirrored);
    assert.deepEqual(selections(projected).map(pattern=>pattern.homeSelection),
        selections(evidence).map(pattern=>pattern.homeSelection));
    for(const threshold of [0,500,1000,3000]) {
        const a=apply(evidence,threshold), b=apply(projected,threshold);
        assert.deepEqual(b.timeline.map(span=>span.explanation.reason),a.timeline.map(span=>span.explanation.reason));
        for(let i=0;i<a.timeline.length;i++) assert.equal(b.timeline[i].cameraX,-a.timeline[i].cameraX);
    }
    assert.equal(JSON.stringify(evidence),before);
});
