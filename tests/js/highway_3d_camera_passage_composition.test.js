const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`), open = source.indexOf('{', start);
    assert.ok(start >= 0, name);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

// Real planner and projection functions, with linear fret spacing so a focus
// error has a directly interpretable distance. No controller or render loop.
function harness(rows, { aspect = 16 / 9, preset = 'straight', lefty = false, rate = 1 } = {}) {
    const constants = ['STABLE_CAMERA_FOV', 'STABLE_CAMERA_PITCH', 'STABLE_CAMERA_YAW', 'STABLE_CAMERA_SHIFT', 'STABLE_CAMERA_VIEWS']
        .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
    const functions = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
        'hwyBuildCameraStops', 'hwyBuildCameraAttackIndex', 'hwyPrepareCameraStops', 'hwyCameraPlanAt',
        'stableConstrain', 'stableIntervalAt', 'stableSolve', 'stableRegionFitDistance',
        'stableRegionFootprint', 'stableRegionFraming', 'stableRegionViewDistance', 'stableCameraPlan'];
    return new Function('rows', 'aspect', 'preset', 'lefty', 'rate', `
        const K=1, TS=230, NFRETS=24, nStr=6, S_GAP=4, NH=3, _textSizeMul=1;
        ${constants}
        const cam={aspect}, stableCameraPreset=preset, _leftyCached=lefty, cameraSmoothing=.5;
        const xFret=f=>f*10*(lefty?-1:1), xFretMid=f=>(f*10-5)*(lefty?-1:1);
        const sY=s=>3+(5-s)*4, fretLabelScaleForFret=()=>1;
        const _stablePoints=[], _stableRegionPoints=new Float64Array(48), _stableViewRegionPoints=new Float64Array(72);
        const _stableInterval={}, _stableFit={}, _stableCam={rate,pointCount:0};
        const _stablePlan={rows:null,regions:[],zoomRegions:[],stops:[],rate:1,key:'',result:{},revision:0};
        const bundle={notes:[],chords:[],playbackRate:rate}, stableRegionAnchors=()=>rows;
        function basis(pitch,yaw,x,y,distanceMul) {
            const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
            return {bx:sy*cp,by:sp,bz:cy*cp,rx:cy,rz:-sy,ux:-sy*sp,uy:cp,uz:-cy*sp,x,y,distanceMul};
        }
        const yaw=preset==='angled'?STABLE_CAMERA_YAW*(lefty?-1:1):0, view=STABLE_CAMERA_VIEWS[preset];
        const _stableBasis=basis(STABLE_CAMERA_PITCH,yaw,0,13,1);
        const _stableViewBasis=basis(STABLE_CAMERA_PITCH-Math.atan2(view.pitch,100),yaw,
            view.panX*(lefty?-1:1),13+view.panY,view.distMul);
        ${functions.map(extract).join('\n')}
        return {
            run(now){return {...stableCameraPlan(bundle,now,100)};},
            cache:_stablePlan,
            distanceAt(region,x){return stableRegionViewDistance(region,region.viewDistance,x);},
            build:hwyBuildCameraStops
        };
    `)(rows, aspect, preset, lefty, rate);
}

test('successive shared excursions preserve the earlier narrow playing focus', () => {
    const rows = [[0,13,4],[.7,11,5],[1.4,14,3],[2.1,17,8],[2.8,5,3],[3.5,19,4],[4.2,11,4]]
        .map(([time,fret,width]) => ({time,fret,width}));
    const h = harness(rows, {aspect:2.6});
    h.run(0);
    // The earlier version rewrote the stop covering the low three-fret area
    // to x=140 after accepting another excursion, 85 away from its focus=55.
    const low = h.cache.regions[4];
    const stop = h.cache.stops.filter(s => s.time <= low.time).at(-1);
    assert.ok(Math.abs(stop.x - low.preferred) <= (low.maxX - low.minX) * 1.5 + 1e-8,
        `low playing focus ${low.preferred}, held centre ${stop.x}`);
    for (const stop of h.cache.stops) {
        assert.ok(stop.x >= stop.focusMinX - 1e-8 && stop.x <= stop.focusMaxX + 1e-8);
    }
});

test('ordinary absorbed rows retain their geometry and focus for later sharing', () => {
    const {build} = harness([]);
    const row = (time,x,width=40) => ({time,x,preferred:x,minX:x-width/2,maxX:x+width/2,
        firstFret:(x-width/2)/10+1,lastFret:(x+width/2)/10});
    const rows = [row(0,20),row(.2,30),row(.7,80),row(1.4,20)];
    let observed;
    build(rows,1,()=>true,(next,held)=>{observed={...held};return NaN;});
    assert.ok(observed, 'remote excursion must consider sharing');
    assert.equal(observed.coverageMinX,0);
    assert.equal(observed.coverageMaxX,50);
    assert.equal(observed.coverageFirstFret,1);
    assert.equal(observed.coverageLastFret,5);
    assert.equal(observed.focusMinX,-30, 'the absorbed x=30 row narrows the original lower bound');
    assert.equal(observed.focusMaxX,80);
});

test('a late local group starts with the immediately preceding real region', () => {
    const {build} = harness([]);
    const row = (time,x,width=40) => ({time,x,preferred:x,minX:x-width/2,maxX:x+width/2,
        firstFret:(x-width/2)/10+1,lastFret:(x+width/2)/10});
    const rows = [row(0,20),row(99,30),row(100,90),row(100.8,30)];
    let observed;
    const stops = build(rows,1,()=>true,(next,held)=>{observed={...held};return 50;});
    assert.equal(observed.time,99.4);
    assert.equal(observed.minX,10);
    assert.equal(observed.maxX,50);
    assert.equal(observed.preferred,30);
    assert.equal(observed.focusMinX,undefined, 'ancient group bounds must not constrain a fresh group');
    assert.equal(stops[0].x,20, 'a late excursion must not rewrite the long preceding camera hold');
    assert.equal(stops[1].x,50);
});

test('late shared stops reserve predecessor zoom locally without widening earlier history', () => {
    const h = harness([{time:0,fret:1,width:4},{time:100,fret:6,width:4},{time:100.8,fret:1,width:4}], {aspect:.8});
    const early = h.run(0), cache = h.cache;
    const stop = cache.stops.find(s=>s.time>0 && s.time<100);
    assert.ok(stop, 'fixture needs a synthetic stop inside the long opening region');
    const synthetic = cache.zoomRegions.find(r=>r.time===stop.time);
    const previous = cache.regions[0];
    const required = h.distanceAt(previous,stop.x);
    assert.ok(required>previous.plannedViewDistance+1, 'moving away needs a wider predecessor view');
    assert.equal(synthetic.plannedViewDistance,required);
    assert.equal(h.run(50).distance,early.distance);
    assert.equal(h.run(stop.time-.7).distance,early.distance, 'preparation must remain local');
    const preparing = h.run(stop.time-.2);
    assert.ok(preparing.distance>early.distance && preparing.distance<required);
    const atStop = h.run(stop.time);
    assert.ok(atStop.distance>=required);
    assert.equal(atStop.regionIndex,0, 'synthetic zoom rows are not musical region changes');
    assert.equal(atStop.closeDistance,previous.closeDistance);
    assert.equal(cache.zoomRegions.length,cache.regions.length+1);
    assert.ok(cache.regions.every(r=>cache.zoomRegions.includes(r)), 'real shapes must be referenced, not copied');
    const timeline = cache.zoomRegions, entries = timeline.slice(), revision = cache.revision;
    for(let t=99;t<102;t+=.01) h.run(t);
    assert.equal(cache.zoomRegions,timeline);
    assert.ok(timeline.every((entry,i)=>entry===entries[i]), 'warm frames must reuse the prepared zoom timeline');
    assert.equal(cache.revision,revision);
});
