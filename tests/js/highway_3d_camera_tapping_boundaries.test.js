const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi, extractFunction, harness} = require('../helpers/highway_camera_harness.cjs');
const api = cameraApi();

// Exercise the authored-anchor/playing-region pipeline as well as the camera
// modules: its millisecond anchor values can differ from calculated note times.
const helpers = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
    'usesUnfrettedPosition', 'naturalNode', 'notePositionX', 'slideTrailEnd', 'getChartAnchorAt',
    'hwyBuildPlayingRegions', 'laneBoundsFromAnchor', 'chordFallbackLaneBounds', 'chordShapeLaneBounds',
    'hwyBuildAuthoredStrumFrames', 'hwyResolveGuidanceAnchors', 'hwyResolveChordLanes'];
const buildRegions = new Function(`
    const NFRETS=24, CHORD_ANCHOR_TIME_EPS=.000501;
    const fretWire=f=>f*10, fretX=fretWire, fretMid=f=>f>0?(f-.5)*10:-2;
    ${helpers.map(name=>extractFunction(name)).join('\n')}
    return (notes,chords,anchors)=>hwyResolveChordLanes(chords,
        hwyBuildPlayingRegions(notes,chords,
            hwyResolveChordLanes(chords,hwyResolveGuidanceAnchors(notes,chords,anchors),notes)),notes);
`)();
const rounded = time => Math.round(time * 1000) / 1000;
function fixture({chords=false, repeats=2, start=0}={}) {
    const notes = [], anchors = [];
    for (let cycle=0; cycle<repeats; cycle++) for (let index=0; index<3; index++) {
        const t=rounded(start+cycle*.9+index*.3), f=[5,9,12][index];
        notes.push({t,s:0,f,...[{tp:true},{ho:true},{po:true}][index]});
        anchors.push({time:t,fret:f,width:4,guidanceOrigin:'source'});
    }
    const end=rounded(start+repeats*.9);
    notes.push({t:end,s:0,f:5,tp:true});
    anchors.push({time:end,fret:5,width:4,guidanceOrigin:'source'},
        {time:end+1.2,fret:16,width:4,guidanceOrigin:'source'});
    return {notes:chords?[]:notes,chords:chords?notes.map(({t,...note})=>({t,notes:[note]})):[],anchors};
}
function compile(chart) {
    const regions=buildRegions(chart.notes,chart.chords,chart.anchors).map(row=>({...row,
        firstFret:row.fret,lastFret:row.fret+row.width-1,
        minX:(row.fret-1)*10,maxX:(row.fret+row.width-1)*10,
        x:(row.fret-1+Math.min(4,row.width)/2)*10,
        preferred:(row.fret-1+Math.min(4,row.width)/2)*10}));
    const evidence=api.hwyCompileCameraEvidence(regions,{context:chart});
    const areas=api.hwyCompileTappingAreas(evidence,chart);
    return {regions,evidence,areas};
}
function select(compiled, threshold=500) {
    const stops=api.hwyApplyCameraThreshold(compiled.evidence,{excursionThreshold:threshold});
    return api.hwyApplyTappingAreas(stops,compiled.areas,{xFret:f=>f*10});
}
const areaSummary = compiled => compiled.areas.map(({start,end,firstFret,lastFret,signature,cycles})=>
    ({start,end,firstFret,lastFret,signature,cycles}));

test('calculated .3*3 note time keeps the same tapping area as the authored .9 anchor',()=>{
    const original=compile(fixture()), chart=fixture();
    chart.notes[3].t=.3*3;
    assert.notEqual(chart.notes[3].t,chart.anchors[3].time,'the fixture must retain real floating-point disagreement');
    const before=JSON.stringify(chart), actual=compile(chart);
    assert.equal(original.areas.length,1);
    assert.deepEqual(areaSummary(actual),areaSummary(original));
    assert.deepEqual(select(actual).map(({time,x,kind})=>({time,x,kind})),
        select(original).map(({time,x,kind})=>({time,x,kind})));
    assert.equal(JSON.stringify(chart),before,'recognition must not rewrite source timestamps');
});

test('each shared cycle boundary owns its note or chord once within chart-time tolerance',()=>{
    for (const chords of [false,true]) for (const offset of [-.0005,0,.0005]) {
        const chart=fixture({chords,repeats:3,start:1}), attacks=chords?chart.chords:chart.notes;
        for (const index of [0,3,6,9]) attacks[index].t+=offset;
        const {areas}=compile(chart);
        assert.equal(areas.length,1,`${chords?'chord':'note'} offset ${offset}`);
        assert.equal(areas[0].cycles.length,3,'all three consecutive cycles must have equal ownership');
        assert.equal(JSON.parse(areas[0].signature).length,3,'a boundary attack must not be counted in both cycles');
        assert.deepEqual([areas[0].start,areas[0].end],[0,4.9]);
    }
});

test('attacks outside the tolerance remain in their actual cycle and cannot prove a mismatched riff',()=>{
    for (const chords of [false,true]) {
        const chart=fixture({chords}), evidence=compile(chart).evidence;
        const attacks=chords?chart.chords:chart.notes;
        attacks[3].t-=.000502;
        // Hold the semantic boundaries fixed here: the separate playing-region
        // resolver can legitimately move its boundaries to a nearby attack.
        assert.equal(api.hwyCompileTappingAreas(evidence,chart).length,0,
            'do not broaden the existing chart-time tolerance');
    }
});

test('matching final-return attacks within tolerance extend only through the true home dwell',()=>{
    for (const chords of [false,true]) for (const offset of [-.0005,0,.0005]) {
        const chart=fixture({chords}), attacks=chords?chart.chords:chart.notes;
        attacks.at(-1).t+=offset;
        chart.notes.push({t:2.1,s:0,f:5});
        const compiled=compile(chart);
        assert.equal(compiled.areas.length,1);
        assert.equal(compiled.areas[0].end,2.1);
        assert.deepEqual(select(compiled).map(s=>s.time),[0,2.1,3]);
    }
});

test('a changed attack at the final-return boundary ends centering at that boundary',()=>{
    for (const offset of [-.0005,0,.0005]) {
        const chart=fixture(); chart.notes.at(-1).t+=offset; delete chart.notes.at(-1).tp;
        const compiled=compile(chart);
        assert.equal(compiled.areas.length,1,'the preceding two proven cycles must survive');
        assert.equal(compiled.areas[0].end,1.8);
        assert.deepEqual(select(compiled).map(s=>s.time),[0,1.8,3]);
    }
});

test('several attacks just before the final-return boundary cannot end its area before that boundary',()=>{
    const chart=fixture(), evidence=compile(chart).evidence;
    chart.notes.at(-1).t-=.0005;
    chart.notes.push({t:1.8-.00025,s:0,f:5});
    const areas=api.hwyCompileTappingAreas(evidence,chart), compiled={evidence,areas};
    assert.equal(areas.length,1);
    assert.equal(areas[0].end,1.8,'the mismatching near-boundary attack belongs to the final return');
    const stops=select(compiled);
    assert.deepEqual(stops.map(s=>s.time),[0,1.8,3]);
    assert.ok(stops.every(stop=>stop.end>stop.time));
    assert.ok(stops.timeline.every(span=>span.end>span.time));
});

test('a next-relocation attack within tolerance cannot create a tiny return-to-home stop',()=>{
    for (const chords of [false,true]) for (const offset of [-.0005,0,.0005]) {
        const chart=fixture({chords});
        if(chords)chart.chords.push({t:3+offset,notes:[{s:0,f:16}]});
        else chart.notes.push({t:3+offset,s:0,f:16});
        const compiled=compile(chart), stops=select(compiled);
        assert.equal(compiled.areas.length,1);
        assert.equal(compiled.areas[0].end,3);
        assert.deepEqual(stops.map(s=>[s.time,s.x]),[[0,80],[3,170]]);
    }
});

test('normal in-dwell attacks and next-relocation attacks outside tolerance keep their exact times',()=>{
    for (const time of [2.1004,3-.000502]) {
        const chart=fixture();chart.notes.push({t:time,s:0,f:5});
        const compiled=compile(chart);
        assert.equal(compiled.areas.length,1);
        assert.equal(compiled.areas[0].end,time,'tolerance must not quantize genuine passage endings');
        assert.deepEqual(select(compiled).map(s=>s.time),[0,time,3]);
    }
});

test('tolerant boundary ownership does not relax pitch, technique or chord-membership proof',()=>{
    for (const mutate of [
        chart=>{chart.notes[3].f=6;},
        chart=>{delete chart.notes[3].tp;},
        chart=>{chart.chords.push({t:.9-.0005,notes:[{s:1,f:14}]});},
    ]) {
        const chart=fixture();chart.notes[3].t-=.0005;mutate(chart);
        assert.equal(compile(chart).areas.length,0);
    }
});

test('rounding repair leaves the song-time short-lane threshold and exact-threshold rule unchanged',()=>{
    const chart=fixture();chart.notes[3].t=.3*3;
    const compiled=compile(chart), before=JSON.stringify(compiled.areas);
    assert.equal(compiled.areas.length,1);
    for (const threshold of [0,200,300]) {
        assert.ok(select(compiled,threshold).every(stop=>stop.kind!=='tapping-area'),`${threshold} ms`);
    }
    for (const threshold of [300.01,400,500]) assert.equal(select(compiled,threshold)[0].kind,'tapping-area');
    assert.equal(JSON.stringify(compiled.areas),before,'threshold edits must reuse immutable evidence');
});

test('both Stable presets and movement modes reuse the repaired area at every playback rate',()=>{
    const chart=fixture();chart.notes[3].t=.3*3;
    const compiled=compile(chart);
    for (const preset of ['straight','angled']) for (const movementMode of ['reach-centres','latest-destination'])
        for (const rate of [.25,.5,1,1.5,2]) {
            const h=harness();
            h.settings({preset,movementMode,rate,excursionThreshold:500,startBeforeMs:400,arriveAfterMs:50,autoZoom:false});
            h.setRegionTimeline(compiled.regions);h.replaceChartData(chart);h.frame(0,0);
            const cache=h.planCache(), evidence=cache.cameraEvidence, areas=cache.tappingAreas;
            assert.equal(areas.length,1,`${preset}/${movementMode}/${rate}`);
            assert.equal(cache.semanticStops[0].kind,'tapping-area');
            assert.equal(cache.semanticStops[0].x,80);
            for(let index=1;index<=180;index++) {
                h.frame(index/60,1/(60*rate));
                assert.equal(cache.cameraEvidence,evidence,'frame sampling must reuse lane evidence');
                assert.equal(cache.tappingAreas,areas,'frame sampling must reuse tapping evidence');
            }
        }
});
