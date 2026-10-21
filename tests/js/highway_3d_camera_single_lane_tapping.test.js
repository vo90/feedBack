const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi, harness} = require('../helpers/highway_camera_harness.cjs');
const api = cameraApi();
const row = (time, fret, last = fret + 3) => ({time, firstFret:fret, lastFret:last,
    minX:(fret-1)*10, maxX:last*10, x:(fret+1)*10, preferred:(fret+1)*10});
const figure = (start, frets=[9,11,16], {pull=false, spacing=.1}={}) => frets.map((f,index)=>({
    t:start+index*spacing, s:3, f, ...(index===0 ? pull?{po:true}:{} : index===frets.length-1
        ? {tp:true,ho:true} : {ho:true})}));
function fixture() {
    return {rows:[row(0,5),row(1,9,17),row(3,14)], notes:[...figure(1),...figure(1.3),
        {t:1.6,s:3,f:9}], chords:[], stringCount:6};
}
function compile(chart) {
    const evidence=api.hwyCompileCameraEvidence(chart.rows,{context:chart});
    return {evidence, areas:api.hwyCompileTappingAreas(evidence,chart)};
}
function select(compiled,threshold=500,lefty=false) {
    const stops=api.hwyApplyCameraThreshold(compiled.evidence,{excursionThreshold:threshold});
    return {stops, focused:api.hwyApplyTappingAreas(stops,compiled.areas,{xFret:f=>f*10*(lefty?-1:1)})};
}
const summary = area => [area.start,area.end,area.firstFret,area.lastFret];

test('a repeated wide tapping figure centres a single lane independently of the short-lane threshold',()=>{
    const chart=fixture(), before=JSON.stringify(chart), compiled=compile(chart);
    assert.deepEqual(compiled.areas.map(summary),[[1,3,9,16]]);
    assert.equal(compiled.areas[0].kind,'single-lane');
    assert.equal(JSON.stringify(chart),before);
    for(const threshold of [0,200,400,500,3000]) for(const lefty of [false,true]) {
        const {focused}=select(compiled,threshold,lefty);
        const area=focused.find(stop=>stop.kind==='tapping-area');
        assert.equal(area.x,lefty?-120:120,'centre physical boundaries 8 and 16, not the whole lane metadata');
        assert.deepEqual(focused.map(stop=>stop.time),[0,1,3]);
    }
});

test('ordinary wide extensions, one-off taps, narrow figures and nonmatching techniques keep normal focus',()=>{
    for(const mutate of [
        chart=>chart.notes.forEach(note=>{delete note.tp;}),
        chart=>{delete chart.notes[5].tp;},
        chart=>{chart.notes[4].ho=false;},
        chart=>{chart.notes[4].f=12;},
        chart=>{chart.notes=chart.notes.map(note=>({...note,f:note.f===16?12:note.f}));},
        chart=>{chart.notes[4].s=2;},
    ]) {
        const chart=fixture();mutate(chart);
        const compiled=compile(chart), {stops,focused}=select(compiled);
        assert.equal(compiled.areas.length,0);
        assert.equal(focused,stops);
    }
});

test('adjacent proven variants share one union centre across one known-pitch tapped connector',()=>{
    const chart=fixture(); chart.rows[2].time=5;
    chart.notes=[...figure(1),...figure(1.3),
        {t:1.6,s:3,f:11,po:true},{t:1.7,s:3,f:9,po:true},{t:1.8,s:3,f:12,ho:true},{t:1.9,s:3,f:17,tp:true,ho:true},
        ...figure(2,[9,12,17]),...figure(2.3,[9,12,17]),{t:2.6,s:3,f:9}];
    const compiled=compile(chart);
    assert.deepEqual(compiled.areas.map(summary),[[1,5,9,17]]);
    assert.equal(compiled.areas[0].signatures.length,2);
    const {focused}=select(compiled);
    assert.deepEqual(focused.map(stop=>[stop.time,stop.x]),[[0,60],[1,125],[5,150]]);
});

test('novel-pitch, slow, or multiple unproven connecting figures cannot join proven variants',()=>{
    for(const mode of ['novel','slow','multiple']) {
        const chart=fixture();chart.rows[2].time=5;
        chart.notes=[...figure(1),...figure(1.3),
            {t:1.6,s:3,f:mode==='novel'?13:11,po:true},{t:1.7,s:3,f:17,tp:true,ho:true}];
        const start=mode==='slow'?3:mode==='multiple'?2.1:1.8;
        if(mode==='multiple')chart.notes.push({t:1.8,s:3,f:12},{t:1.9,s:3,f:17,tp:true});
        chart.notes.push(...figure(start,[9,12,17]),...figure(start+.3,[9,12,17]));
        const compiled=compile(chart);
        assert.equal(compiled.areas.length,2,mode);
        assert.ok(compiled.areas[0].end<=compiled.areas[1].start);
    }
});

test('ordinary fretted attacks stop centering while unpitched attacks do not widen or break the proof',()=>{
    const chart=fixture(); chart.notes.push({t:1.65,s:3,f:7});
    const compiled=compile(chart);
    assert.equal(compiled.areas[0].end,1.65);
    assert.deepEqual(select(compiled).focused.map(stop=>[stop.time,stop.x]),[[0,60],[1,120],[1.65,100],[3,150]]);
    const quiet=fixture();
    quiet.notes.push({t:1.65,s:0,f:0,tp:true},{t:1.7,s:1,f:127,mt:true,tp:true});
    assert.deepEqual(compile(quiet).areas.map(summary),[[1,3,9,16]]);
});

test('a long rest between identical tapped figures does not prove a continuous phrase',()=>{
    const chart=fixture();chart.rows[2].time=6;
    chart.notes=[...figure(1),...figure(4)];
    assert.equal(compile(chart).areas.length,0);
});

test('lane and section boundaries cannot borrow proof from the other side',()=>{
    const chart=fixture();chart.sections=[{time:1.3}];
    assert.equal(compile(chart).areas.length,0);
    const shifted=fixture();shifted.rows.splice(2,0,row(1.3,10,17));
    assert.equal(compile(shifted).areas.length,0);
});

test('a threshold-held host or held home never overrides the existing riff policy',()=>{
    for(const heldHome of [false,true]) {
        const chart=fixture();
        chart.rows=heldHome?[row(0,9,17),row(1,5),row(1.1,9,17)]
            :[row(0,5),row(1,9,17),row(1.7,5)];
        chart.notes=[...figure(heldHome?0:1),...figure(heldHome?.3:1.3)];
        const compiled=compile(chart);
        assert.equal(compiled.areas.length,1);
        assert.ok(select(compiled,0).focused.some(stop=>stop.kind==='tapping-area'));
        const {stops,focused}=select(compiled,1000);
        assert.equal(focused,stops,'holding the semantic riff must keep its existing home');
    }
});

test('progressively travelling lanes keep their existing camera destinations',()=>{
    const chart=fixture();chart.rows=[row(0,1,9),row(1,5,13),row(2,9,17),row(3,14,21)];
    chart.notes=[...figure(2),...figure(2.3)];
    const compiled=compile(chart);
    assert.ok(compiled.evidence.protectedIndices.includes(2));
    assert.equal(compiled.areas.length,0);
});

test('ordinary and wholly progressive charts keep the cheap exit without inspecting attacks',()=>{
    let inspected=0;
    const measured=cameraApi({onRenderableNote:()=>inspected++});
    for(const rows of [[row(0,9),row(3,14)],
        [row(0,1,9),row(1,5,13),row(2,9,17),row(3,14,21)]]) {
        const chart={rows,notes:[...figure(2),...figure(2.3)]};
        const evidence=measured.hwyCompileCameraEvidence(rows,{context:chart});
        inspected=0;
        assert.equal(evidence.patterns.length,0);
        assert.deepEqual(measured.hwyCompileTappingAreas(evidence,chart),[]);
        assert.equal(inspected,0,'ineligible lane evidence must avoid the chart scan entirely');
    }
});

test('real chord membership proves a figure but synthesized chords and unfretted tap flags do not',()=>{
    const chart=fixture();chart.chords=chart.notes.map(({t,...note})=>({t,notes:[note]}));chart.notes=[];
    assert.deepEqual(compile(chart).areas.map(summary),[[1,3,9,16]]);
    chart.chords[4].notes.push({s:2,f:12});
    assert.equal(compile(chart).areas.length,0);
    const synth=fixture();synth.chords=synth.notes.map(({t,...note})=>({t,h3dSynth:true,notes:[note]}));synth.notes=[];
    assert.equal(compile(synth).areas.length,0);
    const muted=fixture();muted.notes.forEach(note=>{if(note.tp){note.f=127;note.mt=true;}});
    assert.equal(compile(muted).areas.length,0);
});

test('the terminal wide lane ends at finite matched sustain or the next chart beat',()=>{
    for(const beat of [false,true]) {
        const chart=fixture();chart.rows.pop();chart.notes.pop();chart.notes.at(-1).sus=.25;
        if(beat)chart.beats=[{time:2}];
        const compiled=compile(chart);
        assert.equal(compiled.areas[0].end,beat?2:1.75);
        assert.ok(Number.isFinite(compiled.areas[0].end));
    }
});

test('centering entry and exit use the selected timing and movement mode',()=>{
    const compiled=compile(fixture());
    for(const movementMode of ['reach-centres','latest-destination']) {
        const {focused}=select(compiled);
        const timing={startBeforeMs:400,arriveAfterMs:50,movementMode};
        const sample=time=>api.hwyCameraPlanAt(focused,time,1,.5,{},0,0,250,null,timing);
        assert.equal(sample(.599).x,60);
        assert.ok(sample(.8).x>60&&sample(.8).x<120);
        assert.equal(sample(1.05).x,120);
        assert.equal(sample(2.599).x,120);
        assert.equal(sample(3.05).x,150);
        assert.deepEqual(focused.motion.map(move=>[move.start,move.end]),[[.6,1.05],[2.6,3.05]]);
    }
});

test('both presets and movement modes cache the same single-lane evidence at all playback rates',()=>{
    const chart=fixture();
    for(const preset of ['straight','angled']) for(const movementMode of ['reach-centres','latest-destination'])
        for(const rate of [.5,1,2]) {
            const h=harness();
            h.settings({preset,movementMode,rate,excursionThreshold:500,startBeforeMs:400,arriveAfterMs:50,autoZoom:false});
            h.setRegionTimeline(chart.rows);h.replaceChartData(chart);h.frame(0,0);
            const cache=h.planCache(), evidence=cache.cameraEvidence, areas=cache.tappingAreas;
            assert.deepEqual(areas.map(summary),[[1,3,9,16]]);
            assert.equal(cache.semanticStops.find(stop=>stop.kind==='tapping-area').x,120);
            for(let index=1;index<=180;index++) {
                h.frame(index/60,1/(60*rate));
                assert.equal(cache.cameraEvidence,evidence);
                assert.equal(cache.tappingAreas,areas,'normal frame samples must not rescan the chart');
            }
        }
});
