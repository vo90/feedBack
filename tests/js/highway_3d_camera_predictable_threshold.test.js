const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi, legacyCameraApi} = require('../helpers/highway_camera_harness.cjs');
const api = cameraApi();
const row = (time, fret, width = 4) => ({time, firstFret:fret, lastFret:fret+width-1,
    minX:(fret-1)*10, maxX:(fret+width-1)*10, x:(fret+1)*10, preferred:(fret+1)*10});
function path(frets, durations = [.3]) {
    let time = 0;
    return frets.map((fret, i) => {
        const result = row(time, fret);
        time += Array.isArray(durations) ? durations[i % durations.length] : durations;
        return result;
    });
}
const stopBases = stops => stops.map(stop => stop.firstFret);
const build = (rows, threshold = 500, context = null) =>
    api.hwyBuildCameraStops(rows, {context, excursionThreshold:threshold});
const compile = (rows, context = null) => api.hwyCompileCameraEvidence(rows, {context});
const apply = (evidence, threshold) => api.hwyApplyCameraThreshold(evidence, {excursionThreshold:threshold});
const id = span => `${span.time}/${span.base || 'f/'+span.firstFret}`;
const retained = stops => new Set(stops.timeline.filter(span => span.explanation?.decision !== 'hold').map(id));
const patternIdentity = pattern => ({
    id:pattern.id, kind:pattern.kind, homeIndex:pattern.homeIndex, home:pattern.home,
    startIndex:pattern.startIndex, endIndex:pattern.endIndex, start:pattern.start, end:pattern.end,
    proofStart:pattern.proofStart, proofEnd:pattern.proofEnd,
    cycles:pattern.cycles?.map(cycle => ({startIndex:cycle.startIndex,endIndex:cycle.endIndex,
        maxAwayDuration:cycle.maxAwayDuration})),
});
function thresholds(rows) {
    const values = new Set([0, 200, 250, 350, 500, 900, 3000]);
    for (let i=0;i+1<rows.length;i++) {
        const ms=(rows[i+1].time-rows[i].time)*1000;
        for(const value of [ms-.001,ms,ms+.001]) if(value>=0&&value<=3000) values.add(value);
    }
    return [...values].sort((a,b)=>a-b);
}
function assertMonotonic(rows, context = null) {
    const evidence=compile(rows,context), before=JSON.stringify(evidence);
    const identities=evidence.patterns.map(patternIdentity), heldHomes=new Map();
    let previous=null,previousStops=null;
    for(const threshold of thresholds(evidence.spans)) {
        const result=apply(evidence,threshold), kept=retained(result), stops=new Set(result.map(id));
        if(previous) {
            for(const destination of kept) assert.ok(previous.has(destination),
                `${threshold}ms introduced timeline destination ${destination}`);
            for(const destination of stops) assert.ok(previousStops.has(destination),
                `${threshold}ms introduced prepared destination ${destination}`);
        }
        assert.deepEqual(result.evidence.patterns.map(patternIdentity),identities,
            'threshold changed the compiled structural home or boundary');
        assert.deepEqual(result.patterns.map(patternIdentity),identities,
            'threshold changed the applied structural home or boundary');
        for(const span of result.timeline.filter(span=>span.explanation?.decision==='hold')) {
            const key=id(span),proof={home:span.explanation.home,interval:span.explanation.interval};
            if(heldHomes.has(key)) assert.deepEqual(proof,heldHomes.get(key),
                `${threshold} ms changed the home or proof interval for ${key}`);
            else heldHomes.set(key,proof);
        }
        assert.equal(JSON.stringify(evidence),before,'threshold application mutated structural evidence');
        previous=kept;previousStops=stops;
    }
}
function variants(rows) {
    return [false,true].flatMap(reverse=>[false,true].map(lefty=>rows.map(source=>{
        const fret=reverse?25-source.firstFret:source.firstFret;
        const copy=row(source.time,fret,source.lastFret-source.firstFret+1);
        if(lefty) {copy.x=-copy.x;copy.preferred=-copy.preferred;
            [copy.minX,copy.maxX]=[-copy.maxX,-copy.minX];}
        return copy;
    })));
}

test('the compile/apply split keeps structural homes and boundaries independent of threshold',()=>{
    for(const frets of [
        [5,8,7,4,5,8,7,4,5],
        [5,8,10,8,5,8,10,8,5],
        [5,9,12,9,12,9,5],
        [5,8,5,10,5,12,5],
    ]) for(const rows of variants(path(frets,[2,.246002,.492005,.3,.9])))
        assertMonotonic(rows);
});

test('raising the threshold never restores a removed destination across generated duration boundaries',()=>{
    let seed=0xcafef00d;
    const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    const durations=[.125,.2,.246002,.25,.3,.35,.492005,.5,.9,1.227,3,3.1];
    for(let trial=0;trial<80;trial++) {
        const cycle=Array.from({length:3+random(7)},()=>1+random(19));
        const frets=Array.from({length:15+random(20)},(_,i)=>trial%2?cycle[i%cycle.length]:1+random(19));
        const rows=path(frets,frets.map(()=>durations[random(durations.length)]));
        for(const variant of variants(rows)) assertMonotonic(variant);
    }
});

test('an opening 3→5→7→10 climb after 14 stays in the plan at 200, 250 and 500 ms',()=>{
    const rows=path([14,3,5,7,10,7,10,7,10,12],[2.213989,.246002,.492005,.492004,.491989,.246002,.244995,.246003,.246002,2]);
    for(const variant of variants(rows)) for(const threshold of [200,250,500]) {
        const stops=build(variant,threshold);
        for(const source of variant.slice(1,5)) assert.ok(stops.some(stop=>stop.time===source.time),
            `${threshold}ms dropped progressive target ${source.firstFret}`);
    }
});

test('two matching nested riff cycles keep their incoming home 5 rather than selecting home 8',()=>{
    const rows=path([5,8,10,8,5,8,10,8,5]);
    const stops=build(rows,500);
    assert.deepEqual(stopBases(stops),[5]);
    for(const span of stops.timeline.filter(span=>span.firstFret!==5))
        assert.equal(span.explanation.home.firstFret,5);
});

test('a remote repeated 9↔12 figure establishes local home 9 before the later return to 5',()=>{
    const rows=path([5,9,12,9,12,9,5]);
    const stops=build(rows,500);
    assert.deepEqual(stopBases(stops),[5,9,5]);
    for(const span of stops.timeline.filter(span=>span.firstFret===12))
        assert.equal(span.explanation.home.firstFret,9);
});

test('different singleton replies keep fixed home 5 as their reply peaks advance',()=>{
    const rows=path([5,8,5,10,5,12,5]);
    const stops=build(rows,500);
    assert.deepEqual(stopBases(stops),[5]);
    for(const span of stops.timeline.filter(span=>span.firstFret!==5))
        assert.equal(span.explanation.home.firstFret,5);
});

test('isolated return equality uses original song time at every playback rate',()=>{
    const old=legacyCameraApi();
    for(const rate of [.5,1,2,4]) {
        for(const offset of [0,632.272]) {
            const rows=[row(offset,5),row(offset+2,8),row(offset+2.5,5)];
            const stops=old.hwyBuildCameraStops(rows,rate,null,null,null,null,null,500);
            assert.deepEqual(stopBases(stops),[5,8,5],'exactly 500 ms remains lasting');
            assert.deepEqual(stopBases(old.hwyBuildCameraStops(rows,rate,null,null,null,null,null,500.01)),[5]);
        }
    }
});

test('same-base width and chord-provenance extensions never alter the original focus',()=>{
    const first=row(0,5),wide={...row(.1,5,8),preferred:100,x:100,h3dResolvedChordLane:true};
    const rows=[first,wide,row(.2,5),row(2,8),row(2.3,5)];
    for(const threshold of [0,200,300,500,3000]) {
        const stops=build(rows,threshold);
        assert.equal(stops[0].x,60);
        assert.equal(stops.timeline[0].x,60);
        assert.equal(stops.timeline[0].maxX,120,'wider geometry remains available to framing');
        assert.deepEqual([stops.timeline[0].regionStart,stops.timeline[0].regionEnd],[0,3]);
    }
});
