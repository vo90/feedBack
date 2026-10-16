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
function harness(rows, { aspect = 16 / 9, preset = 'straight', lefty = false, rate = 1, notes = [], chords = [], dominant = true } = {}) {
    const constants = ['STABLE_CAMERA_FOV', 'STABLE_CAMERA_PITCH', 'STABLE_CAMERA_YAW', 'STABLE_CAMERA_SHIFT', 'STABLE_CAMERA_VIEWS']
        .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
    const functions = ['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
        'hwyBuildCameraStops', 'hwyBuildCameraAttackIndex', 'hwyPrepareCameraStops', 'hwyCameraPlanAt',
        'stableConstrain', 'stableIntervalAt', 'stableSolve', 'stableRegionFitDistance',
        'stableRegionFootprint', 'stableRegionFraming', 'stableRegionViewDistance', 'stableCameraPlan'];
    return new Function('rows', 'aspect', 'preset', 'lefty', 'rate', 'notes', 'chords', `
        const K=1, TS=230, NFRETS=24, nStr=6, S_GAP=4, NH=3, _textSizeMul=1;
        ${constants}
        const cam={aspect}, stableCameraPreset=preset, _leftyCached=lefty, cameraSmoothing=.5;
        const xFret=f=>f*10*(lefty?-1:1), xFretMid=f=>(f*10-5)*(lefty?-1:1);
        const sY=s=>3+(5-s)*4, fretLabelScaleForFret=()=>1;
        const _stablePoints=[], _stableRegionPoints=new Float64Array(48), _stableViewRegionPoints=new Float64Array(72);
        const _stableInterval={}, _stableFit={}, _stableCam={rate,pointCount:0};
        const _stablePlan={rows:null,regions:[],zoomRegions:[],stops:[],rate:1,key:'',result:{},revision:0};
        const bundle={notes,chords,playbackRate:rate}, stableRegionAnchors=()=>rows;
        function basis(pitch,yaw,x,y,distanceMul) {
            const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
            return {bx:sy*cp,by:sp,bz:cy*cp,rx:cy,rz:-sy,ux:-sy*sp,uy:cp,uz:-cy*sp,x,y,distanceMul};
        }
        const yaw=preset==='angled'?STABLE_CAMERA_YAW*(lefty?-1:1):0, view=STABLE_CAMERA_VIEWS[preset];
        const _stableBasis=basis(STABLE_CAMERA_PITCH,yaw,0,13,1);
        const _stableViewBasis=basis(STABLE_CAMERA_PITCH-Math.atan2(view.pitch,100),yaw,
            view.panX*(lefty?-1:1),13+view.panY,view.distMul);
        ${functions.map(extract).join('\n').replace('share, dominantInterval, cache.attacks', dominant ? 'share, dominantInterval, cache.attacks' : 'share')}
        return {
            run(now){return {...stableCameraPlan(bundle,now,100)};},
            cache:_stablePlan,
            distanceAt(region,x){return stableRegionViewDistance(region,region.viewDistance,x);},
            build:hwyBuildCameraStops
        };
    `)(rows, aspect, preset, lefty, rate, notes, chords);
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

function riff({main=1,other=4,mainDuration=.75,otherDuration=.25,start=2,initial=other,split=false}={}) {
    const rows=[{time:0,fret:initial,width:4}], notes=[{t:.05,s:0,f:initial}];
    let time=start;
    for(let i=0;i<14;i++) {
        rows.push({time,fret:main,width:4});
        notes.push({t:time+.02,s:0,f:main},{t:time+mainDuration*.5,s:1,f:main+3});
        if(split) rows.push({time:time+mainDuration*.3,fret:main,width:4,h3dResolvedChordLane:true},
            {time:time+mainDuration*.6,fret:main,width:4});
        time+=mainDuration;
        rows.push({time,fret:other,width:4});
        notes.push({t:time+.02,s:0,f:other,sus:Math.min(.1,otherDuration),sl:main});
        time+=otherDuration;
    }
    rows.push({time,fret:main,width:4});
    notes.push({t:time+.02,s:0,f:main});
    return {rows,notes};
}

test('duration dominance improves inherited centres symmetrically without asking for more zoom', () => {
    for(const preset of ['straight','angled']) for(const lefty of [false,true]) {
        for(const main of [1,5]) {
            const fixture=riff({main,other:main===1?4:2});
            const options={preset,lefty,notes:fixture.notes};
            const current=harness(fixture.rows,options), baseline=harness(fixture.rows,{...options,dominant:false});
            const wanted=(main+1)*10*(lefty?-1:1);
            const old=baseline.run(6), now=current.run(6);
            assert.ok(Math.abs(now.x-wanted)<Math.abs(old.x-wanted)-.5, `${preset}/${lefty}/${main}: ${old.x} -> ${now.x}`);
            const x=now.x;
            for(let t=4;t<11;t+=.05) assert.equal(current.run(t).x,x,'repeated riff must keep one composition');
            current.cache.regions.forEach((row,i)=>assert.ok(row.plannedViewDistance<=baseline.cache.regions[i].plannedViewDistance+1e-5,
                'each musical region must retain its own original distance budget'));
        }
    }
});

test('main five-to-eight riff and short lower slide keep their established centre', () => {
    const fixture=riff({main:5,other:2,mainDuration:1.9,otherDuration:.1,initial:5});
    for(const preset of ['straight','angled']) for(const lefty of [false,true]) {
        const h=harness(fixture.rows,{preset,lefty,notes:fixture.notes});
        for(let time=0;time<18;time+=.05) assert.equal(h.run(time).x,60*(lefty?-1:1));
    }
});

test('equivalent provenance fragments preserve the dominant preference within the available zoom budget', () => {
    const ordinary=riff({mainDuration:1.19,otherDuration:.75});
    const fragmented=riff({mainDuration:1.19,otherDuration:.75,split:true});
    for(const preset of ['straight','angled']) {
        const a=harness(ordinary.rows,{preset,notes:ordinary.notes});
        const b=harness(fragmented.rows,{preset,notes:fragmented.notes});
        // The unsplit baseline already selects the ideal low centre. Angled
        // may need a wider view there; the split baseline has a smaller budget.
        assert.equal(a.run(6).x,20);
        const corrected=b.run(6).x;
        assert.ok(corrected<49, 'the longer lower area must improve the inherited upper centre');
        assert.equal(b.cache.stops.find(stop=>stop.reason==='dominant').dominantPreferred,20);
        if(preset==='straight') assert.equal(corrected,20);
        for(let time=4;time<18;time+=.05) assert.equal(b.run(time).x,corrected);
        const baseline=harness(fragmented.rows,{preset,notes:fragmented.notes,dominant:false});baseline.run(6);
        b.cache.regions.forEach((row,i)=>assert.ok(row.plannedViewDistance<=baseline.cache.regions[i].plannedViewDistance+1e-5));
    }
});

test('provenance splits with equal inherited framing produce the identical complete trajectory', () => {
    const a=riff(),b=riff({split:true});
    for(const preset of ['straight','angled']) {
        const first=harness(a.rows,{preset,notes:a.notes}),second=harness(b.rows,{preset,notes:b.notes});
        for(let time=0;time<12;time+=.025) assert.equal(first.run(time).x,second.run(time).x);
    }
});

test('balanced alternation keeps the held composition instead of choosing either extreme', () => {
    const fixture=riff({mainDuration:.5,otherDuration:.5});
    for(const preset of ['straight','angled']) {
        const h=harness(fixture.rows,{preset,notes:fixture.notes});
        const centre=h.run(0).x;
        for(let time=1;time<10;time+=.05) assert.equal(h.run(time).x,centre);
    }
});

test('dominant passage preparation is local, rate-scaled, and cached across frames', () => {
    const fixture=riff({start:100});
    for(const rate of [.5,1,2]) {
        const rows=fixture.rows.map(r=>({...r,time:r.time*rate}));
        const notes=fixture.notes.map(n=>({...n,t:n.t*rate,sus:n.sus*rate}));
        const h=harness(rows,{notes,rate});
        assert.equal(h.run(50*rate).x,50);
        assert.equal(h.run(99.99*rate).x,50);
        assert.equal(h.run(104*rate).x,20);
        const stops=h.cache.stops, zoom=h.cache.zoomRegions, revision=h.cache.revision;
        for(let time=103;time<108;time+=.01) h.run(time*rate);
        assert.equal(h.cache.stops,stops);
        assert.equal(h.cache.zoomRegions,zoom);
        assert.equal(h.cache.revision,revision);
    }
});

test('inferred slide destinations cannot establish a dominant composition without a real pick', () => {
    const rows=[{time:0,fret:5,width:4},{time:2,fret:1,width:4},{time:5,fret:5,width:4}];
    const notes=[{t:0,s:0,f:8,sus:5,sl:2},{t:5,s:0,f:5}];
    const h=harness(rows,{notes});h.run(3);
    assert.ok(h.cache.stops.every(stop=>stop.reason!=='dominant'||stop.dominantPreferred!==20));
    const baseline=harness(rows,{notes,dominant:false});
    assert.equal(h.run(3).x,baseline.run(3).x,'a sustained unpicked destination retains baseline following');
});

test('genuine sustained migrations retain their original early preparation', () => {
    const rows=[{time:0,fret:3,width:4},{time:10,fret:15,width:4}];
    const notes=[{t:0,s:0,f:3},{t:10,s:0,f:15}];
    for(const preset of ['straight','angled']) {
        const h=harness(rows,{preset,notes}), baseline=harness(rows,{preset,notes,dominant:false});
        for(let time=8.5;time<12;time+=.01) assert.equal(h.run(time).x,baseline.run(time).x);
        assert.deepEqual(h.cache.stops,baseline.cache.stops);
    }
});

test('slower intentional phrase following is not replaced by a dominant compromise', () => {
    const fixture=riff({mainDuration:1.19,otherDuration:.75,split:true});
    for(const preset of ['straight','angled']) {
        const options={preset,rate:.5,notes:fixture.notes};
        const h=harness(fixture.rows,options), baseline=harness(fixture.rows,{...options,dominant:false});
        for(let time=0;time<28;time+=.025) assert.equal(h.run(time).x,baseline.run(time).x);
        assert.deepEqual(h.cache.stops,baseline.cache.stops,
            'every original stop must retain its centre, boundary and preparation lead');
    }
});

test('dominant support has hysteresis and expires without a competing sixty-percent winner', () => {
    const fixture=riff({mainDuration:.61,otherDuration:.39,split:true});
    const end=fixture.rows.at(-1).time;
    fixture.rows.pop();
    let time=end;
    for(let i=0;i<12;i++) {
        fixture.rows.push({time,fret:1,width:4});
        fixture.notes.push({t:time+.02,s:0,f:1});
        time+=.45;
        fixture.rows.push({time,fret:4,width:4});
        fixture.notes.push({t:time+.02,s:0,f:4});
        time+=.55;
    }
    fixture.rows.push({time,fret:4,width:4});
    fixture.notes.push({t:time+.02,s:0,f:4});
    for(const preset of ['straight','angled']) {
        const h=harness(fixture.rows,{preset,notes:fixture.notes});
        const x=h.run(6).x;
        assert.ok(x<49,'the first passage must correct its inherited upper centre');
        for(let t=5;t<end-4;t+=.025) assert.equal(h.run(t).x,x,
            'near-threshold provenance fragments must not restart the correction each cycle');
        for(let t=end+4;t<time;t+=.025) assert.equal(h.run(t).x,50,
            'the old preferred area must release once its dwell falls below fifty percent');
        assert.equal(h.cache.stops.filter(stop=>stop.reason==='dominant').length,1);
        assert.equal(h.cache.stops.filter(stop=>stop.reason==='dominant-return').length,1);
    }
});

test('an original stop inside the final compacted span terminates the dominant hold', () => {
    const {build}=harness([]);
    const rows=[[0,5,2],[2.5,3,3],[2.6,5,5],[3.6,6,3],[3.9,6,3],
        [4.4,2,7],[4.41,2,7],[8.41,3,5],[8.91,2,5],[9.41,2,5]]
        .map(([time,firstFret,width])=>({time,firstFret,lastFret:firstFret+width-1,
            minX:(firstFret-1)*10,maxX:(firstFret+width-1)*10,
            x:(firstFret-1+Math.min(4,width)/2)*10,
            preferred:(firstFret-1+Math.min(4,width)/2)*10}));
    const canHold=(row,x)=>Math.abs(row.preferred-x)<=35;
    const interval=row=>({min:row.preferred-30,max:row.preferred+30,valid:true});
    const attacks=rows.map(row=>({time:row.time+.001,frets:1<<row.firstFret}));
    const baseline=build(rows,1,canHold), current=build(rows,1,canHold,null,interval,attacks);
    const correction=current.find(stop=>stop.reason==='dominant');
    assert.ok(correction,'fixture must correct an earlier inherited composition');
    assert.equal(correction.end,9.41,
        'no subsequent compacted boundary exists to discover this original stop');
    assert.deepEqual(current.at(-1),baseline.at(-1),
        'retain the exact original final centre, boundary and preparation reason');
});

test('a finite riff at double speed does not reverse because its final anchor has no pick', () => {
    for(const preset of ['straight','angled']) for(const main of [1,5]) {
        const fixture=riff({main,other:main===1?4:2});
        const end=fixture.rows.at(-1).time;
        fixture.notes=fixture.notes.filter(note=>note.t<end);
        const h=harness(fixture.rows,{preset,rate:2,notes:fixture.notes});
        const wanted=(main+1)*10;
        let error=Math.abs(h.run(4).x-wanted);
        for(let time=4;time<end+1;time+=.025) {
            const next=Math.abs(h.run(time).x-wanted);
            assert.ok(next<=error+1e-7,
                `${preset}/${main}: absent future picks reversed the composition at ${time}`);
            error=next;
        }
        assert.equal(h.cache.stops.find(stop=>stop.reason==='dominant').end,end,
            'retain the correction until the original terminal stop');
    }
});
