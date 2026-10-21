const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');
const api=cameraApi();
const row=(time,fret)=>({time,firstFret:fret,lastFret:fret+3,
    minX:(fret-1)*10,maxX:(fret+3)*10,x:(fret+1)*10,preferred:(fret+1)*10});
function fixture() {
    const rows=[5,9,12,5,9,12,5].map((f,i)=>row(i*.3,f));
    rows.push(row(3,16));
    const notes=[0,.9].flatMap(start=>[
        {t:start,s:0,f:5,tp:true},{t:start+.3,s:0,f:9,ho:true},{t:start+.6,s:0,f:12,po:true},
    ]);
    notes.push({t:1.8,s:0,f:5,tp:true});
    return {rows,notes,chords:[],stringCount:6};
}
function compile(f) {
    const evidence=api.hwyCompileCameraEvidence(f.rows,{context:f});
    const areas=api.hwyCompileTappingAreas(evidence,f);
    return {evidence,areas};
}
function apply(evidence,areas,threshold=500,lefty=false) {
    const stops=api.hwyApplyCameraThreshold(evidence,{excursionThreshold:threshold});
    return {stops,focused:api.hwyApplyTappingAreas(stops,areas,{xFret:f=>f*10*(lefty?-1:1)})};
}
function freeze(value) {
    if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
}

test('a held tapping phrase centres the entire 5–12 range including hammer-ons and pull-offs',()=>{
    const f=fixture(),before=JSON.stringify(f),{evidence,areas}=compile(f);
    assert.equal(areas.length,1);
    assert.deepEqual([areas[0].firstFret,areas[0].lastFret],[5,12]);
    assert.equal(JSON.stringify(f),before,'compilation changed the source chart');
    for(const lefty of [false,true]) {
        const {stops,focused}=apply(evidence,areas,500,lefty),area=focused.find(s=>s.kind==='tapping-area');
        assert.ok(area);
        assert.equal(stops[0].x,60,'normal held-lane centre remains between its middle two columns');
        assert.equal(area.x,lefty?-80:80,'use the midpoint of physical fret 4 and fret 12 boundaries');
        assert.equal(area.time,0);
        assert.equal(area.end,3,'include the final return dwell instead of visiting the normal home at 1.8 s');
        assert.deepEqual(focused.map(s=>s.time),[0,3]);
        assert.equal(focused.at(-1).firstFret,16,'normal departure destination survives');
        assert.ok(focused.timeline.filter(s=>s.time<3).every(s=>s.cameraX===area.x));
    }
});

test('all repeated fretted members contribute to composition, not note frequency or tapped-note positions alone',()=>{
    const f=fixture();
    for(const start of [0,.9]) {
        f.notes.push({t:start+.1,s:1,f:5},{t:start+.15,s:1,f:5},{t:start+.2,s:1,f:5});
        f.chords.push({t:start+.45,notes:[{s:2,f:4,ho:true},{s:3,f:14,po:true},
            {s:4,f:0},{s:5,f:127,mt:true}]});
    }
    const {evidence,areas}=compile(f);
    assert.deepEqual(areas.map(a=>[a.firstFret,a.lastFret]),[[4,14]]);
    const {focused}=apply(evidence,areas);
    assert.equal(focused[0].x,85,'centre boundaries 3 and 14, irrespective of many low-fret attacks');
});

test('ordinary held riffs and one isolated tap retain the original stops object and normal home',()=>{
    for(const isolated of [false,true]) {
        const f=fixture();
        f.notes.forEach(n=>{delete n.tp;});
        if(isolated)f.notes[0].tp=true;
        const {evidence,areas}=compile(f),{stops,focused}=apply(evidence,areas);
        assert.equal(areas.length,0);
        assert.equal(focused,stops);
        assert.equal(focused[0].x,60);
    }
});

test('mismatched techniques, pitch or real chord membership prevent unproven tapping composition',()=>{
    for(const change of [
        f=>{f.notes[4].ho=false;},
        f=>{f.notes[4].f=10;},
        f=>{f.chords.push({t:1.2,notes:[{s:1,f:15}]});},
        f=>{f.notes=f.notes.slice(0,3);f.chords=[{t:.9,h3dSynth:true,notes:[{s:0,f:5,tp:true}]}];},
    ]) {
        const f=fixture();change(f);
        const {evidence,areas}=compile(f),{stops,focused}=apply(evidence,areas);
        assert.equal(areas.length,0);
        assert.equal(focused,stops);
    }
});

test('inactive cycles and away lanes lasting exactly the threshold cannot activate a tapping area',()=>{
    const f=fixture(),{evidence,areas}=compile(f);
    assert.equal(areas.length,1);
    for(const threshold of [0,200,300]) {
        const {stops,focused}=apply(evidence,areas,threshold);
        assert.equal(focused,stops,`${threshold} ms must not compose an unheld cycle`);
    }
    assert.notEqual(apply(evidence,areas,300.01).focused[0].kind,undefined);
    assert.equal(apply(evidence,areas,300.01).focused[0].kind,'tapping-area');
});

test('threshold application preserves compiled tapping evidence and the source stop graph',()=>{
    const {evidence,areas}=compile(fixture());
    freeze(areas);
    const before=JSON.stringify({evidence,areas});
    const stops=api.hwyApplyCameraThreshold(evidence,{excursionThreshold:500});
    freeze(stops);
    const focused=api.hwyApplyTappingAreas(stops,areas,{xFret:f=>f*10});
    assert.notEqual(focused,stops);
    assert.equal(JSON.stringify({evidence,areas}),before);
    assert.equal(focused.evidence,evidence);
    assert.equal(focused.patterns,stops.patterns);
});

test('normal notes resume the usual four-fret centre even without a lane anchor change',()=>{
    for(const matchingReturn of [false,true]) {
        const f=fixture();
        if(!matchingReturn)delete f.notes.at(-1).tp;
        f.notes.push({t:2.1,s:0,f:5},{t:2.4,s:0,f:7});
        const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
        const end=matchingReturn?2.1:evidence.spans[6].time;
        assert.equal(areas[0].end,end);
        assert.deepEqual(focused.map(s=>s.time),[0,end,3]);
        assert.deepEqual(focused.map(s=>s.x),[80,60,170]);
        assert.equal(focused[1].firstFret,5);
        assert.notEqual(focused[1].kind,'tapping-area','the ordinary held lane must lose tapping composition');
        assert.equal(focused[1].focusArea,undefined);
        assert.ok(focused.timeline.filter(s=>s.time>=end&&s.time<3)
            .every(s=>!s.focusArea&&s.cameraX===60));
    }
});

test('open strings and unpitched muted notes keep the proven tapping area through its final dwell',()=>{
    for(const note of [
        {f:0}, {f:127,mt:true}, {f:24,mt:true}, {f:24,mt:true,pick_scrape_marks:[{}]},
    ]) {
        const f=fixture();
        f.notes.push({t:2.1,s:0,...note},{t:2.4,s:1,...note});
        const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
        assert.equal(areas[0].end,3,JSON.stringify(note));
        assert.deepEqual(focused.map(s=>[s.time,s.x]),[[0,80],[3,170]],
            'an unfretted attack must not insert a return to the four-fret home');
        assert.deepEqual([areas[0].firstFret,areas[0].lastFret],[5,12],
            'a dead note placeholder must not widen the tapping area');
    }
});

test('chords made entirely of open and unpitched muted members keep tapping centering',()=>{
    const f=fixture();
    f.chords.push({t:2.1,notes:[{s:0,f:0},{s:1,f:127,mt:true},{s:2,f:24,mt:true}]});
    const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
    assert.equal(areas[0].end,3);
    assert.deepEqual(focused.map(s=>[s.time,s.x]),[[0,80],[3,170]]);
});

test('a mixed chord with an ordinary fretted member ends tapping centering at its attack',()=>{
    const f=fixture();
    f.chords.push({t:2.1,notes:[{s:0,f:0},{s:1,f:127,mt:true},{s:2,f:7}]});
    const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
    assert.equal(areas[0].end,2.1);
    assert.deepEqual(focused.map(s=>[s.time,s.x]),[[0,80],[2.1,60],[3,170]]);
    assert.equal(focused[1].focusArea,undefined);
});

test('pitched fretted notes including palm mutes still end tapping centering normally',()=>{
    for(const note of [{f:7},{f:7,pm:true},{f:7,mt:true,sl:9}]) {
        const f=fixture();
        // A mute with an explicit slide remains a pitched movement instruction;
        // it is not the unpitched placeholder used by the hold policy.
        f.notes.push({t:2.1,s:0,...note});
        const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
        assert.equal(areas[0].end,2.1,JSON.stringify(note));
        assert.deepEqual(focused.map(s=>[s.time,s.x]),[[0,80],[2.1,60],[3,170]]);
    }
});

test('tap flags on open or unpitched muted attacks cannot prove a tapping area',()=>{
    for(const note of [{f:0},{f:127,mt:true},{f:24,mt:true}]) {
        const f=fixture();
        f.notes.forEach(note=>{delete note.tp;});
        for(const start of [0,.9]) {
            f.notes.push({t:start+.1,s:1,...note,tp:true});
            f.chords.push({t:start+.2,notes:[{s:2,...note,tap:true}]});
        }
        const {evidence,areas}=compile(f),{stops,focused}=apply(evidence,areas);
        assert.equal(areas.length,0,JSON.stringify(note));
        assert.equal(focused,stops);
    }
});

test('tap flags on unfretted attacks do not change a proven signature or widen its area',()=>{
    const expected=compile(fixture()).areas, f=fixture();
    for(const start of [0,.9,1.8]) {
        f.notes.push({t:start+.1,s:1,f:0,tp:true},{t:start+.2,s:2,f:24,mt:true,tap:true});
        f.chords.push({t:start+.25,notes:[{s:3,f:0,tap:true},{s:4,f:127,mt:true,tp:true}]});
    }
    const {evidence,areas}=compile(f),{focused}=apply(evidence,areas);
    assert.deepEqual(areas,expected,'only usable fretted evidence may define or extend the proof');
    assert.deepEqual(focused.map(s=>[s.time,s.x]),[[0,80],[3,170]]);
});

test('holding through unfretted attacks keeps normal movement timing to the next lane in both modes',()=>{
    const f=fixture();
    f.notes.push({t:2.1,s:0,f:0},{t:2.4,s:1,f:127,mt:true},{t:3,s:0,f:16});
    const {evidence,areas}=compile(f);
    for(const movementMode of ['reach-centres','latest-destination']) {
        const {focused}=apply(evidence,areas);
        const timing={startBeforeMs:400,arriveAfterMs:50,movementMode};
        const sample=time=>api.hwyCameraPlanAt(focused,time,1,.5,{},0,0,250,null,timing);
        const before=sample(2.599), moving=sample(2.8), after=sample(3.05);
        assert.equal(before.x,80,'hold the tapping centre until the requested departure');
        assert.equal(before.moving,false);
        assert.ok(moving.x>80&&moving.x<170);
        assert.equal(after.x,170,'reach the next lane at its requested arrival');
        assert.equal(after.moving,false);
        assert.equal(focused.motion.length,1,'no extra stop at an unfretted attack');
        assert.deepEqual([focused.motion[0].start,focused.motion[0].end],[2.6,3.05]);
        assert.equal(focused.motion[0].timing.movementMode,movementMode);
        assert.equal(focused.motion[0].timing.fallbackReason,'none');
    }
});
