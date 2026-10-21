const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

// Exercise the production cache with deterministic projection stand-ins.
// Full renderer tests cover projection correctness; these checks target the
// allocations and stale geometry that a resize or preset switch can cause.
function harness(rows, chart = {}, real = false) {
    const scans = {notes:0};
    const api = real ? cameraApi({onRenderableNote:()=>scans.notes++}) : null;
    const result = new Function('rows', 'chart', 'api', `
        const _stablePlan = { rows:null, regions:[], stops:[], rate:1, key:'', result:{}, revision:0 };
        const _stableCam = {rate:1}, cam = {aspect:16/9};
        let _leftyCached=false, nStr=6, _textSizeMul=1, baseDistance=100;
        let stableCameraPreset='straight', cameraSmoothing=.5;
        const stableCameraDepartureDelay=0,stableCameraTravelExtra=0,stableCameraSettleLimit=0;
        const stableCameraPreparationMode='auto',stableCameraPreparationMs=700;
        const stableCameraDirectTiming={startBeforeMs:700,arriveAfterMs:0,movementMode:'reach-centres'};
        let stableCameraExcursionThreshold=500;
        const stableCameraLongSwitchFrets=5;
        const bundle={notes:[],chords:[],playbackRate:1,...chart}, counts={close:0,framing:0,view:0,attacks:0,
            evidence:0,projection:0,tapping:0,selection:0};
        const xFret=f=>f*10*(_leftyCached?-1:1), stableRegionAnchors=()=>rows;
        function stableRegionFitDistance(row, preferred, base) {
            counts.close++;
            return base+(row.maxX-row.minX)/cam.aspect;
        }
        function stableRegionFraming(row, preferred, base) {
            counts.framing++;
            return {x:preferred+(stableCameraPreset==='angled'?2:0),distance:base+row.maxX-row.minX};
        }
        function stableRegionViewDistance(row, base) {
            counts.view++;
            return base*(stableCameraPreset==='angled'?1.1:1)*_textSizeMul/cam.aspect;
        }
        function hwyBuildCameraAttackIndex(...args) { counts.attacks++; return api?api.hwyBuildCameraAttackIndex(...args):[]; }
        function hwyCompileCameraEvidence(regions,...args) { counts.evidence++; return api?api.hwyCompileCameraEvidence(regions,...args):{spans:regions.map(row=>({...row}))}; }
        function hwyProjectCameraEvidence(evidence,regions) { counts.projection++; return api?api.hwyProjectCameraEvidence(evidence,regions):{...evidence,spans:regions.map(row=>({...row}))}; }
        function hwyCompileTappingAreas(...args) { counts.tapping++; return api?api.hwyCompileTappingAreas(...args):[]; }
        function hwyApplyCameraThreshold(evidence,...args) { counts.selection++; return api?api.hwyApplyCameraThreshold(evidence,...args):evidence.spans.map(row=>({...row})); }
        function hwyApplyTappingAreas(stops,...args) { return api?api.hwyApplyTappingAreas(stops,...args):stops; }
        function hwyPrepareCameraStops(stops,...args) { return api?api.hwyPrepareCameraStops(stops,...args):stops.map(stop=>({...stop,lead:.6})); }
        function hwyCameraPlanAt(stops,now,rate,smoothing,out,...args) {
            if(api)return api.hwyCameraPlanAt(stops,now,rate,smoothing,out,...args);
            Object.assign(out,{x:stops[0]?.x??0,velocity:0,valid:stops.length>0});
        }
        ${extract('stableCameraPlan')}
        return {
            run(now=5){stableCameraPlan(bundle,now,baseDistance);return _stablePlan;},
            configure({aspect,preset,lefty,strings,textSize,distance,rate,smoothing,threshold,startBeforeMs,arriveAfterMs,movementMode}={}){
                if(aspect!==undefined)cam.aspect=aspect;
                if(preset!==undefined)stableCameraPreset=preset;
                if(lefty!==undefined)_leftyCached=lefty;
                if(strings!==undefined)nStr=strings;
                if(textSize!==undefined)_textSizeMul=textSize;
                if(distance!==undefined)baseDistance=distance;
                if(rate!==undefined)bundle.playbackRate=rate;
                if(smoothing!==undefined)cameraSmoothing=smoothing;
                if(threshold!==undefined)stableCameraExcursionThreshold=threshold;
                if(startBeforeMs!==undefined)stableCameraDirectTiming.startBeforeMs=startBeforeMs;
                if(arriveAfterMs!==undefined)stableCameraDirectTiming.arriveAfterMs=arriveAfterMs;
                if(movementMode!==undefined)stableCameraDirectTiming.movementMode=movementMode;
            },
            replace(value){rows=value;},
            notes(value){bundle.notes=value;},
            appendNote(value){bundle.notes.push(value);},
            data(name,value){bundle[name]=value;},
            append(name,value){bundle[name].push(value);}, counts
        };
    `)(rows,chart,api);
    return {...result,scans};
}

const chartRows = () => Array.from({ length: 1200 }, (_, i) =>
    Object.freeze({ time: i * 0.2, fret: 2 + (i % 3) * 4, width: 4 }));

test('aspect and preset changes reuse timed region objects and produce fresh-equivalent geometry', () => {
    const rows = chartRows(), h = harness(rows), initial = h.run();
    const array = initial.regions, objects = array.slice(), before = array.map(row => ({ ...row }));
    for (const settings of [{ aspect: 1.2 }, { aspect: 1.2, preset: 'angled' }]) {
        h.configure(settings);
        const current = h.run();
        assert.equal(current.regions, array);
        assert.ok(current.regions.every((row, i) => row === objects[i]));
        assert.ok(current.regions.every((row, i) => row.time === rows[i].time));
        assert.notDeepEqual(current.regions, before);
        const fresh = harness(rows);
        fresh.configure(settings);
        assert.deepEqual(current.regions, fresh.run().regions);
    }
    assert.equal(h.counts.attacks, 1, 'projection settings must retain the chart attack index');
});

test('each distinct fret span is projected once per geometry change, independent of row count', () => {
    const h = harness(chartRows());
    assert.equal(h.run().shapeCount, 3);
    assert.deepEqual(h.counts, { close: 3, framing: 3, view: 3, attacks: 1,evidence:1,projection:0,tapping:1,selection:1 });
    h.configure({ aspect: 1.3 });
    h.run();
    assert.deepEqual(h.counts, { close: 6, framing: 6, view: 6, attacks: 1,evidence:1,projection:1,tapping:1,selection:2 });
    h.configure({ rate: 0.75, smoothing: 0.7 });
    h.run();
    assert.deepEqual(h.counts, { close: 6, framing: 6, view: 6, attacks: 1,evidence:1,projection:1,tapping:1,selection:2 });
});

test('replacement musical rows receive fresh objects even when their count is unchanged', () => {
    const h = harness(chartRows()), initial = h.run();
    const array = initial.regions, objects = array.slice(), before = array.map(row => ({ ...row }));
    const replacement = chartRows().map(row => ({ ...row, time: row.time + 1, fret: row.fret + 1 }));
    h.replace(replacement);
    const current = h.run();
    assert.notEqual(current.regions, array);
    assert.ok(current.regions.every((row, i) => row !== objects[i]));
    assert.deepEqual(array, before, 'old musical rows must not be rewritten for a different chart');
    assert.deepEqual(current.regions, harness(replacement).run().regions);
});

test('threshold and timing edits reuse structural and tapping evidence without reading the chart again',()=>{
    const h=harness(chartRows()),initial=h.run(),evidence=initial.cameraEvidence,areas=initial.tappingAreas;
    for(const threshold of [0,200,250,350,500,900,3000]) {
        h.configure({threshold});
        const current=h.run();
        assert.equal(current.cameraEvidence,evidence);
        assert.equal(current.tappingAreas,areas);
    }
    const selections=h.counts.selection,preparedStops=h.run().stops;
    for(const rate of [.25,.5,.75,1,1.5,2]) {
        h.configure({rate});
        const current=h.run();
        assert.equal(current.stops,preparedStops,'speed changes must retain prepared song-time stops');
        assert.equal(current.rate,rate,'the live sampler still receives the actual playback rate');
        assert.equal(current.cameraEvidence,evidence);
        assert.equal(current.tappingAreas,areas);
    }
    for(const change of [{smoothing:.8},{startBeforeMs:450},
        {arriveAfterMs:1000},{movementMode:'latest-destination'}]) {
        h.configure(change);
        const current=h.run();
        assert.equal(current.cameraEvidence,evidence);
        assert.equal(current.tappingAreas,areas);
    }
    assert.equal(h.counts.selection,selections,'timing edits must not reapply structural filtering');
    const warmCounts={...h.counts},stops=h.run().stops;
    for(let frame=0;frame<120;frame++) {
        assert.equal(h.run().stops,stops);
        assert.equal(h.run().cameraEvidence,evidence);
    }
    assert.deepEqual(h.counts,warmCounts,'warm frames must reuse all chart analysis');
    assert.equal(h.counts.evidence,1);assert.equal(h.counts.tapping,1);assert.equal(h.counts.attacks,1);
});

test('replacing notes or appending notes invalidates structural and tapping evidence',()=>{
    const h=harness(chartRows());
    let previous=h.run().cameraEvidence,areas=h.run().tappingAreas;
    for(const update of [()=>h.notes([{t:1,s:0,f:5,tp:true}]),()=>h.appendNote({t:2,s:0,f:9,ho:true})]) {
        update();
        const current=h.run();
        assert.notEqual(current.cameraEvidence,previous);
        assert.notEqual(current.tappingAreas,areas);
        previous=current.cameraEvidence;areas=current.tappingAreas;
    }
    assert.equal(h.counts.evidence,3);assert.equal(h.counts.tapping,3);assert.equal(h.counts.attacks,3);
});

function musicalFixture() {
    const rows=[5,9,12,5,9,12,5].map((fret,i)=>({time:i*.3,fret,width:4}));
    rows.splice(1,0,{time:.1,fret:5,width:7});
    rows.push(...[16,18,20,16,12,8,4].map((fret,i)=>({time:3+i*.3,fret,width:4})));
    const notes=[0,.9].flatMap(start=>[
        {t:start,s:0,f:5,tp:true},{t:start+.3,s:0,f:9,ho:true},{t:start+.6,s:0,f:12,po:true},
    ]);
    notes.push({t:1.8,s:0,f:5,tp:true},{t:2.1,s:1,f:0},{t:3,s:0,f:16});
    return {rows,chart:{notes,chords:[],beats:[0,1,2,3,4,5].map((time,measure)=>({time,measure})),
        sections:[{time:0,name:'tapping'},{time:3,name:'run'}]}};
}

function visiblePlan(cache) {
    const {motionRevision,revision,...result}=cache.result;
    // Reused renderer rows already carry last preparation's transient fields.
    // Coalescing has always copied those inert fields into semantic evidence;
    // preparation replaces lead and zoom reads plannedViewDistance on regions.
    // Compare their actual consumers below, not this incidental old copy.
    const unprepared=({lead,plannedViewDistance,...row})=>row;
    const prepared=({plannedViewDistance,...row})=>row;
    return {regions:cache.regions,evidence:{...cache.cameraEvidence,spans:cache.cameraEvidence.spans.map(unprepared)},
        stops:cache.stops.map(prepared),motion:cache.stops.motion,
        semanticStops:cache.semanticStops.map(unprepared),patterns:cache.semanticStops.patterns,
        timeline:cache.timeline.map(unprepared),tappingAreas:cache.tappingAreas,zoomRegions:cache.zoomRegions,result};
}

test('resize, preset, handedness, label size and distance reuse musical evidence with fresh-equivalent plans',()=>{
    for(const movementMode of ['reach-centres','latest-destination']) {
        const {rows,chart}=musicalFixture(), h=harness(rows,chart,true);
        const settings={movementMode,startBeforeMs:400,arriveAfterMs:50};
        h.configure(settings);
        const initial=h.run(2.8), musical=initial.musicalEvidence, areas=initial.tappingAreas;
        const initialScans=h.scans.notes;
        assert.ok(initialScans>0,'fixture must exercise real note analysis');
        assert.equal(areas.length,1,'fixture must contain a proven tapping area');
        assert.ok(musical.protectedIndices.length>0,'fixture must contain a protected progressive run');
        const geometryChanges=[{aspect:1.2},{preset:'angled'},{lefty:true},{textSize:1.4},
            {distance:150},{aspect:2.4,preset:'straight',lefty:false}];
        for(const change of geometryChanges) {
            Object.assign(settings,change);h.configure(change);
            const current=h.run(2.8), fresh=harness(rows,chart,true);
            fresh.configure(settings);
            assert.equal(current.musicalEvidence,musical,'view edits must retain the compiled musical proof');
            assert.equal(current.tappingAreas,areas,'view edits must retain tapping recognition');
            assert.deepEqual(visiblePlan(current),visiblePlan(fresh.run(2.8)),JSON.stringify(settings));
            assert.equal(h.scans.notes,initialScans,'reprojection must not inspect notes again');
            for(const time of [0,.25,.6,1.2,1.9,2.7,2.8,3.05,3.5,4.1,4.8]) {
                const actual={...h.run(time).result}, expected={...fresh.run(time).result};
                delete actual.motionRevision;delete expected.motionRevision;
                delete actual.revision;delete expected.revision;
                assert.deepEqual(actual,expected,`camera sample at ${time}`);
            }
        }
        assert.equal(h.counts.evidence,1);assert.equal(h.counts.tapping,1);assert.equal(h.counts.attacks,1);
        assert.equal(h.counts.projection,geometryChanges.length);
        const counts={...h.counts}, scans=h.scans.notes, stops=h.run().stops;
        for(let frame=0;frame<240;frame++)assert.equal(h.run(frame/60).stops,stops);
        assert.deepEqual(h.counts,counts,'warm frames must not perform any plan rebuilding');
        assert.equal(h.scans.notes,scans);
    }
});

test('chart references, appended chart data and string eligibility invalidate the cached musical proof',()=>{
    for(const field of ['notes','chords','beats','sections']) for(const append of [false,true]) {
        const {rows,chart}=musicalFixture();
        chart.chords=[{t:2.3,notes:[{s:0,f:0}]}];
        const h=harness(rows,chart,true);
        const initial=h.run(), musical=initial.musicalEvidence, areas=initial.tappingAreas;
        const value={notes:{t:2.2,s:0,f:7},chords:{t:2.2,notes:[{s:0,f:7}]},
            beats:{time:6,measure:6},sections:{time:1.2,name:'new'}}[field];
        const replacement=chart[field].slice();replacement[replacement.length-1]=value;
        if(append)h.append(field,value);
        else h.data(field,replacement);
        const current=h.run();
        assert.notEqual(current.musicalEvidence,musical,`${field} ${append?'append':'replacement'}`);
        assert.notEqual(current.tappingAreas,areas);
        assert.equal(h.counts.evidence,2);assert.equal(h.counts.tapping,2);
        if(field==='notes'||field==='chords') {
            assert.equal(current.tappingAreas[0].end,2.2,'new fretted data must end the tapping hold');
            assert.equal(h.counts.attacks,2);
        } else assert.equal(h.counts.attacks,1,'beat/section changes must preserve the attack index');
        const latest={...chart,[field]:append?chart[field]:replacement};
        assert.deepEqual(visiblePlan(current),visiblePlan(harness(rows,latest,true).run()));
    }
    const {rows,chart}=musicalFixture();
    chart.notes.push({t:2.2,s:6,f:7});
    const h=harness(rows,chart,true), initial=h.run(), musical=initial.musicalEvidence;
    assert.equal(initial.tappingAreas[0].end,3,'seventh string is initially outside the chart eligibility');
    h.configure({strings:7});
    const current=h.run(), fresh=harness(rows,chart,true);fresh.configure({strings:7});
    assert.notEqual(current.musicalEvidence,musical);
    assert.equal(current.tappingAreas[0].end,2.2,'string-count edits must rebuild note eligibility');
    assert.deepEqual(visiblePlan(current),visiblePlan(fresh.run()));
    assert.equal(h.counts.evidence,2);assert.equal(h.counts.tapping,2);assert.equal(h.counts.attacks,2);
});

test('threshold and timing edits after reprojection keep current coordinates and cached musical evidence',()=>{
    const {rows,chart}=musicalFixture(), h=harness(rows,chart,true);
    const musical=h.run().musicalEvidence, initialScans=h.scans.notes;
    const settings={lefty:true,preset:'angled',aspect:1.2,startBeforeMs:450,arriveAfterMs:50};
    h.configure(settings);
    const projected=h.run().cameraEvidence;
    assert.notEqual(projected,musical);
    for(const threshold of [0,200,300,400,500,1000]) {
        Object.assign(settings,{threshold});h.configure({threshold});
        const actual=h.run(2.8),fresh=harness(rows,chart,true);fresh.configure(settings);
        assert.equal(actual.cameraEvidence,projected,'threshold edits must use the current mirrored projection');
        assert.equal(actual.musicalEvidence,musical);
        assert.deepEqual(visiblePlan(actual),visiblePlan(fresh.run(2.8)));
    }
    const selected=h.run().semanticStops, selections=h.counts.selection;
    for(const change of [{rate:.5},{rate:2},{movementMode:'latest-destination'},
        {startBeforeMs:600},{arriveAfterMs:1000}]) {
        Object.assign(settings,change);h.configure(change);
        const actual=h.run(2.8),fresh=harness(rows,chart,true);fresh.configure(settings);
        assert.equal(actual.semanticStops,selected,'timing edits must retain selected positions');
        assert.deepEqual(visiblePlan(actual),visiblePlan(fresh.run(2.8)));
    }
    assert.equal(h.counts.selection,selections);assert.equal(h.counts.evidence,1);
    assert.equal(h.counts.projection,1);assert.equal(h.counts.tapping,1);assert.equal(h.counts.attacks,1);
    assert.equal(h.scans.notes,initialScans,'later control edits must not trigger any chart scan');
});

test('chart replacement after a geometry-only refresh rebuilds the musical cache and its projections',()=>{
    const {rows,chart}=musicalFixture(), h=harness(rows,chart,true), initial=h.run();
    const musical=initial.musicalEvidence;
    h.configure({lefty:true,preset:'angled'});h.run();
    const changed=rows.map(row=>({...row,time:row.time+.1}));
    h.replace(changed);
    const current=h.run(), fresh=harness(changed,chart,true);fresh.configure({lefty:true,preset:'angled'});
    assert.notEqual(current.musicalEvidence,musical);
    assert.equal(current.cameraEvidence,current.musicalEvidence,'compile immediately in the current projection');
    assert.deepEqual(visiblePlan(current),visiblePlan(fresh.run()));
    assert.equal(h.counts.evidence,2);assert.equal(h.counts.tapping,2);assert.equal(h.counts.attacks,1);
});

test('mixed and all-tap wide-lane figures reuse proof across timing, speed, threshold and view changes',()=>{
    const rows=[{time:0,fret:9,width:9},{time:4,fret:5,width:4}];
    for(const allTap of [false,true]) for(const movementMode of ['reach-centres','latest-destination']) {
        const chart={notes:[0,.9].flatMap(t=>[
            {t,s:0,f:9,tp:allTap},{t:t+.3,s:0,f:12,ho:true,tp:allTap},{t:t+.6,s:0,f:17,tp:true},
        ]),sections:[{time:0,name:'tapping'},{time:4,name:'verse'}],beats:[]};
        const h=harness(rows,chart,true), settings={movementMode,startBeforeMs:400,arriveAfterMs:50};
        h.configure(settings);
        const first=h.run(1.5), proof=first.musicalEvidence, areas=first.tappingAreas;
        assert.equal(areas.length,1);
        assert.equal(areas[0].kind,'single-lane');
        assert.deepEqual([areas[0].firstFret,areas[0].lastFret],[9,17]);
        const scans=h.scans.notes;
        for(const change of [{threshold:0},{threshold:200},{threshold:500},
            {rate:.5},{rate:2},{preset:'angled'},{lefty:true},{aspect:1.2},
            {startBeforeMs:450},{arriveAfterMs:1000}]) {
            Object.assign(settings,change);h.configure(change);
            const actual=h.run(1.5), fresh=harness(rows,chart,true);fresh.configure(settings);
            assert.equal(actual.musicalEvidence,proof);
            assert.equal(actual.tappingAreas,areas);
            assert.deepEqual(visiblePlan(actual),visiblePlan(fresh.run(1.5)),JSON.stringify(settings));
            assert.equal(h.scans.notes,scans);
        }
        const counts={...h.counts}, stops=h.run().stops;
        for(let frame=0;frame<240;frame++)assert.equal(h.run(frame/60).stops,stops);
        assert.deepEqual(h.counts,counts);
        assert.equal(h.scans.notes,scans);
        assert.equal(h.counts.evidence,1);assert.equal(h.counts.tapping,1);
    }
});
