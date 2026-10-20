const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
function harness(rows) {
    return new Function('rows', `
        const _stablePlan = { rows:null, regions:[], stops:[], rate:1, key:'', result:{}, revision:0 };
        const _stableCam = {rate:1}, cam = {aspect:16/9}, _leftyCached=false, nStr=6, _textSizeMul=1;
        let stableCameraPreset='straight', cameraSmoothing=.5;
        const stableCameraDepartureDelay=0,stableCameraTravelExtra=0,stableCameraSettleLimit=0;
        const stableCameraPreparationMode='auto',stableCameraPreparationMs=700;
        const stableCameraDirectTiming={startBeforeMs:700,arriveAfterMs:0,movementMode:'reach-centres'};
        let stableCameraExcursionThreshold=500;
        const stableCameraLongSwitchFrets=5;
        const bundle={notes:[],chords:[],playbackRate:1}, counts={close:0,framing:0,view:0,attacks:0,
            evidence:0,tapping:0,selection:0};
        const xFret=f=>f*10, stableRegionAnchors=()=>rows;
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
            return base*(stableCameraPreset==='angled'?1.1:1)/cam.aspect;
        }
        function hwyBuildCameraAttackIndex() { counts.attacks++; return []; }
        function hwyCompileCameraEvidence(regions) { counts.evidence++; return {spans:regions.map(row=>({...row}))}; }
        function hwyCompileTappingAreas() { counts.tapping++; return []; }
        function hwyApplyCameraThreshold(evidence) { counts.selection++; return evidence.spans.map(row=>({...row})); }
        function hwyApplyTappingAreas(stops) { return stops; }
        function hwyPrepareCameraStops(stops) { return stops.map(stop=>({...stop,lead:.6})); }
        function hwyCameraPlanAt(stops,now,rate,smoothing,out) {
            Object.assign(out,{x:stops[0]?.x??0,velocity:0,valid:stops.length>0});
        }
        ${extract('stableCameraPlan')}
        return {
            run(){stableCameraPlan(bundle,5,100);return _stablePlan;},
            configure({aspect,preset,rate,smoothing,threshold,startBeforeMs,arriveAfterMs,movementMode}={}){
                if(aspect!==undefined)cam.aspect=aspect;
                if(preset!==undefined)stableCameraPreset=preset;
                if(rate!==undefined)bundle.playbackRate=rate;
                if(smoothing!==undefined)cameraSmoothing=smoothing;
                if(threshold!==undefined)stableCameraExcursionThreshold=threshold;
                if(startBeforeMs!==undefined)stableCameraDirectTiming.startBeforeMs=startBeforeMs;
                if(arriveAfterMs!==undefined)stableCameraDirectTiming.arriveAfterMs=arriveAfterMs;
                if(movementMode!==undefined)stableCameraDirectTiming.movementMode=movementMode;
            },
            replace(value){rows=value;},
            notes(value){bundle.notes=value;},
            appendNote(value){bundle.notes.push(value);}, counts
        };
    `)(rows);
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
    assert.deepEqual(h.counts, { close: 3, framing: 3, view: 3, attacks: 1,evidence:1,tapping:1,selection:1 });
    h.configure({ aspect: 1.3 });
    h.run();
    assert.deepEqual(h.counts, { close: 6, framing: 6, view: 6, attacks: 1,evidence:2,tapping:2,selection:2 });
    h.configure({ rate: 0.75, smoothing: 0.7 });
    h.run();
    assert.deepEqual(h.counts, { close: 6, framing: 6, view: 6, attacks: 1,evidence:2,tapping:2,selection:2 });
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
    const selections=h.counts.selection;
    for(const change of [{rate:.5},{rate:2},{smoothing:.8},{startBeforeMs:450},
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
