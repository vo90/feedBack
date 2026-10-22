const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCameraSemantics} = require('../../plugins/highway_3d/src/camera-semantics.mjs');
const api = createCameraSemantics({NFRETS:24,isRenderableNote:()=>true});
const row = (time,fret) => ({time,firstFret:fret,lastFret:fret+3,
    minX:(fret-1)*10,maxX:(fret+3)*10,x:(fret+1)*10,preferred:(fret+1)*10});
const compile = (rows,context=null) => api.hwyCompileCameraEvidence(rows,{context});
const apply = (evidence,threshold) => api.hwyApplyCameraThreshold(evidence,{excursionThreshold:threshold});
const relocations = evidence => evidence.patterns.filter(pattern=>
    pattern.homeSelection?.reason==='dominant-single-return-relocation');
function sequence(frets,durations,offset=0) {
    let time=offset;
    return frets.map((fret,i)=>{const span=row(time,fret);time+=durations[i]??0;return span;});
}
const alternating = (durations=[.85,5.416,.283,.283,.282],a=1,b=2) =>
    sequence([a,b,a,b,a,b],durations);

test('two eligible replies hand off to a clearly dominant new home without needing a later destination',()=>{
    const rows=alternating(), evidence=compile(rows), selected=relocations(evidence);
    assert.equal(selected.length,1);
    assert.equal(selected[0].home.firstFret,2);
    assert.equal(selected[0].start,rows[1].time);
    assert.deepEqual(selected[0].homeSelection,{reason:'dominant-single-return-relocation',
        previousHomeIndex:0,homeIndex:1,interval:{start:0,end:rows[5].time}});
    assert.equal(selected[0].cycles.length,2);
    for(const threshold of [0,250,282,283,283.01,500,3000]) {
        const stops=apply(evidence,threshold);
        for(const index of [1,3,5]) {
            assert.equal(stops.timeline[index].cameraX,rows[index].x);
            assert.equal(stops.timeline[index].explanation.decision,'follow');
        }
        for(const [index,required] of [[2,283],[4,282]]) {
            const span=stops.timeline[index];
            assert.equal(span.explanation.decision,threshold>required?'hold':'follow');
            if(threshold>required) assert.equal(span.explanation.home.firstFret,2);
        }
    }
});

test('a long previous home can still relocate when the next visit dominates the whole local proof',()=>{
    const rows=alternating([4.8,13.1,.09,.68,.1],19,14), evidence=compile(rows);
    assert.equal(relocations(evidence)[0].home.firstFret,14);
    for(const span of apply(evidence,500).timeline.filter(span=>span.firstFret===19&&span.time>0)) {
        assert.equal(span.explanation.decision,'hold');
        assert.equal(span.explanation.home.firstFret,14);
    }
});

test('balanced alternation, a dominant old home and exact or numerical dominance ties retain their home',()=>{
    for(const durations of [[.28,.29,.28,.29,.28],[10,5,.2,.2,.2],
        [.5,2,.5,.5,.5],[.5,2.00000000001,.5,.5,.5]]) {
        const evidence=compile(alternating(durations));
        assert.equal(relocations(evidence).length,0);
        assert.equal(evidence.patterns[0].home.firstFret,1);
    }
    assert.equal(relocations(compile(alternating([.5,2.001,.5,.5,.5])))[0].home.firstFret,2);
});

test('an isolated long detour or incomplete second return cannot prove a relocation',()=>{
    for(const size of [3,4,5]) assert.equal(relocations(compile(alternating().slice(0,size))).length,0);
    const different=alternating();different[4]=row(different[4].time,3);
    assert.equal(relocations(compile(different)).length,0);
    const unbounded=alternating();unbounded[5]=row(Infinity,2);
    assert.equal(relocations(compile(unbounded)).length,0,'the final open-ended span cannot supply finite proof');
});

test('home choice is independent of threshold caps and scales uniformly with song time',()=>{
    for(const dwell of [2.999,3.001,8]) assert.equal(
        relocations(compile(alternating([.2,dwell,.1,.2,.1])))[0].home.firstFret,2);
    for(const scale of [.5,1,2]) {
        const rows=alternating([.5,2.1,.2,.2,.2].map(value=>value*scale));
        const evidence=compile(rows), original=JSON.stringify(evidence);
        assert.equal(relocations(evidence)[0].home.firstFret,2);
        let held=new Set();
        for(const threshold of [0,200,200.01,400,1000].map(value=>value*scale)) {
            const current=new Set(apply(evidence,threshold).timeline
                .filter(span=>span.explanation.decision==='hold').map(span=>span.time));
            for(const time of held) assert.ok(current.has(time),'raising the threshold cannot restore a target');
            held=current;
        }
        assert.equal(JSON.stringify(evidence),original,'slider edits only project cached evidence');
    }
});

test('a following real destination retains its own threshold decision',()=>{
    const rows=alternating(), start=rows[5].time;
    rows.push(row(start+.284,3),row(start+.848,2));
    const evidence=compile(rows), stops=apply(evidence,500);
    assert.equal(relocations(evidence)[0].home.firstFret,2);
    assert.equal(stops.timeline[6].firstFret,3);
    assert.equal(stops.timeline[6].explanation.decision,'follow');
    assert.equal(apply(evidence,565).timeline[6].explanation.decision,'hold');
});

test('a protected incoming climb and its endpoint cannot be erased by relocation ownership',()=>{
    const rows=sequence([1,4,7,9,7,9,7,9],[.1,.1,.2,5,.2,.2,.2]);
    const evidence=compile(rows);
    assert.ok(evidence.protectedIndices.includes(3),'the first high lane is a real run endpoint');
    assert.equal(relocations(evidence).length,0);
    for(const index of evidence.protectedIndices)
        assert.equal(apply(evidence,3000).timeline[index].explanation.decision,'follow');
});

test('ambiguous multi-lane repeated cycles keep their existing first home',()=>{
    const frets=[7,3,2,3,1,2], durations=[.36,.6,1.4,.99,.88,1.4];
    const rows=sequence([...frets,...frets,...frets,7],[...durations,...durations,...durations]);
    const evidence=compile(rows);
    assert.equal(relocations(evidence).length,0);
    assert.equal(evidence.patterns[0].kind,'repeated-cycle');
    assert.equal(evidence.patterns[0].home.firstFret,7);
    for(const threshold of [500,1400,1401,3000]) {
        const stops=apply(evidence,threshold);
        for(const span of stops.timeline.filter(span=>span.explanation.decision==='hold'))
            assert.equal(span.explanation.home.firstFret,7);
    }
});

test('verified musical breaks prevent borrowing alternating replies across the break',()=>{
    const rows=alternating(), context={notes:rows.map(span=>({t:span.time,s:0,f:span.firstFret})),
        sections:[{time:rows[1].time+.5,name:'noguitar'},{time:rows[1].time+1,name:'verse'}]};
    const evidence=compile(rows,context);
    assert.equal(evidence.musicalBreaks.length,1);
    assert.equal(relocations(evidence).length,0);
});

test('a shared old home after a verified quiet break contributes only its post-resume dwell',()=>{
    const rows=[row(0,1),...alternating([.5,2.1,.5,.5,.5]).map(span=>({...span,time:span.time+10}))];
    const context={notes:rows.map(span=>({t:span.time,s:0,f:span.firstFret})),
        sections:[{time:1,name:'silence'},{time:10,name:'verse'}]};
    assert.equal(relocations(compile(rows)).length,0);
    const evidence=compile(rows,context), chosen=relocations(evidence)[0];
    assert.equal(chosen.home.firstFret,2);
    assert.deepEqual(chosen.homeSelection.interval,{start:10,end:rows.at(-1).time});
    assert.equal(evidence.spans[0].time,0,'the original coalesced stop is not split or moved');
});

test('same-base width extensions cannot manufacture visits or change the selected centre',()=>{
    const rows=alternating(), expanded=rows.flatMap((span,i)=>i===rows.length-1?[span]:[
        span,{...span,time:span.time+.01,lastFret:span.lastFret+5,maxX:span.maxX+50,x:span.x+20,preferred:span.preferred+20}]);
    const original=compile(rows), evidence=compile(expanded);
    assert.deepEqual(relocations(evidence).map(pattern=>pattern.homeSelection),
        relocations(original).map(pattern=>pattern.homeSelection));
    for(const threshold of [0,250,500,3000]) assert.deepEqual(
        apply(evidence,threshold).map(span=>[span.time,span.firstFret,span.x]),
        apply(original,threshold).map(span=>[span.time,span.firstFret,span.x]));
});

test('a removed variation cannot truncate the old home dwell and invent leading-visit dominance',()=>{
    const rows=alternating([7,3,.2,.2,.2]), notes=[];
    for(const start of [0,4,8]) notes.push({t:start+.2,s:0,f:1,sus:0},
        {t:start+1,s:1,f:start===4?17:3,sus:1.2},{t:start+3,s:0,f:1,sus:0});
    const expanded=rows.concat([row(5,17),row(6.2,1)]).sort((a,b)=>a.time-b.time);
    const evidence=compile(expanded,{notes,beats:[0,4,8,12].map((time,measure)=>({time,measure}))});
    assert.equal(evidence.candidates.filter(candidate=>candidate.kind==='riff-variation').length,1);
    assert.equal(relocations(evidence).length,0,'the complete seven-second old home still belongs to the proof');
});

test('geometry projection preserves relocation decisions without reclassifying the chart',()=>{
    const rows=alternating(), evidence=compile(rows), before=JSON.stringify(evidence);
    const projected=api.hwyProjectCameraEvidence(evidence,rows.map(span=>({...span,
        minX:-span.maxX,maxX:-span.minX,x:-span.x,preferred:-span.preferred})));
    assert.deepEqual(relocations(projected).map(pattern=>pattern.homeSelection),
        relocations(evidence).map(pattern=>pattern.homeSelection));
    for(const threshold of [0,250,500,3000]) {
        const a=apply(evidence,threshold).timeline,b=apply(projected,threshold).timeline;
        assert.deepEqual(b.map(span=>span.explanation.reason),a.map(span=>span.explanation.reason));
        for(let i=0;i<a.length;i++) assert.equal(b[i].cameraX,-a[i].cameraX);
    }
    assert.equal(JSON.stringify(evidence),before);
});
