const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start=source.indexOf(`function ${name}(`);
    assert.ok(start>=0,name);
    let signature=source.indexOf('(',start)+1,parentheses=1;
    while(parentheses) {
        if(source[signature]==='(') parentheses++;
        if(source[signature]===')') parentheses--;
        signature++;
    }
    const open=source.indexOf('{',signature);
    let depth=1,end=open+1;
    while(depth&&end<source.length) {
        if(source[end]==='{') depth++;
        else if(source[end]==='}') depth--;
        end++;
    }
    assert.equal(depth,0,name);
    return source.slice(start,end);
}

// Real planner and projection functions, with linear fret spacing so focus
// errors have a directly interpretable distance. No controller or render loop.
function harness(rows, {aspect=16/9,preset='straight',lefty=false,rate=1,notes=[],chords=[],beats=[],sections=[]}={}) {
    const constants=['STABLE_CAMERA_FOV','STABLE_CAMERA_PITCH','STABLE_CAMERA_YAW','STABLE_CAMERA_SHIFT','STABLE_CAMERA_VIEWS']
        .map(name=>source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
    const api=cameraApi();
    const functions=['stableConstrain','stableIntervalAt','stableSolve','stableRegionFitDistance',
        'stableRegionFootprint','stableRegionFraming','stableRegionViewDistance','stableCameraPlan'];
    return new Function('rows','aspect','preset','lefty','rate','notes','chords','beats','sections','cameraApi',`
        const K=1,TS=230,NFRETS=24,nStr=6,S_GAP=4,NH=3,_textSizeMul=1;
        ${constants}
        const {${Object.keys(api).join(',')}}=cameraApi;
        const cam={aspect},stableCameraPreset=preset,_leftyCached=lefty,cameraSmoothing=.5;
        const stableCameraDepartureDelay=0,stableCameraTravelExtra=0,stableCameraSettleLimit=0;
        const stableCameraPreparationMode='auto',stableCameraPreparationMs=700;
        const stableCameraExcursionThreshold=500,stableCameraLongSwitchFrets=5;
        const xFret=f=>f*10*(lefty?-1:1),xFretMid=f=>(f*10-5)*(lefty?-1:1);
        const sY=s=>3+(5-s)*4,fretLabelScaleForFret=()=>1;
        const _stablePoints=[],_stableRegionPoints=new Float64Array(48),_stableViewRegionPoints=new Float64Array(72);
        const _stableInterval={},_stableFit={},_stableCam={rate,pointCount:0};
        const _stablePlan={rows:null,regions:[],zoomRegions:[],stops:[],rate:1,key:'',result:{},revision:0};
        const bundle={notes,chords,beats,sections,playbackRate:rate},stableRegionAnchors=()=>rows;
        function basis(pitch,yaw,x,y,distanceMul) {
            const cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
            return {bx:sy*cp,by:sp,bz:cy*cp,rx:cy,rz:-sy,ux:-sy*sp,uy:cp,uz:-cy*sp,x,y,distanceMul};
        }
        const yaw=preset==='angled'?STABLE_CAMERA_YAW*(lefty?-1:1):0,view=STABLE_CAMERA_VIEWS[preset];
        const _stableBasis=basis(STABLE_CAMERA_PITCH,yaw,0,13,1);
        const _stableViewBasis=basis(STABLE_CAMERA_PITCH-Math.atan2(view.pitch,100),yaw,
            view.panX*(lefty?-1:1),13+view.panY,view.distMul);
        ${functions.map(extract).join('\n')}
        return {
            run(now){return {...stableCameraPlan(bundle,now,100)};},
            setRate(value){bundle.playbackRate=value;},
            cache:_stablePlan,
            distanceAt(region,x){return stableRegionViewDistance(region,region.viewDistance,x);},
            fitsAt(region,x,distance){
                stableRegionViewDistance(region,region.viewDistance,x);
                return stableIntervalAt(distance,0,.96,x,_stableViewRegionPoints,_stableViewRegionPoints.length,_stableViewBasis).valid;
            }
        };
    `)(rows,aspect,preset,lefty,rate,notes,chords,beats,sections,api);
}
const focus=(fret,lefty=false)=>(fret+1)*10*(lefty?-1:1);
const rowsFor=entries=>entries.map(([time,fret,width=4])=>({time,fret,width}));
const assertArrival=(h,time,fret,lefty=false)=>{
    const actual=h.run(time);
    assert.ok(Math.abs(actual.x-focus(fret,lefty))<1e-8,`${time}: expected fret ${fret} focus, got ${actual.x}`);
    assert.ok(Math.abs(actual.velocity)<1e-8,`${time}: arrival velocity ${actual.velocity}`);
};

test('both Stable views preserve the current first-four-fret focus across viewport and handedness',()=>{
    for(const preset of ['straight','angled']) for(const lefty of [false,true]) for(const aspect of [.8,16/9,2.6]) {
        const h=harness(rowsFor([[0,5],[2,5,8],[4,5]]),{preset,lefty,aspect});
        for(let t=0;t<6;t+=.05) assert.equal(h.run(t).x,focus(5,lefty));
        assert.equal(h.cache.regions[1].lastFret,12,'extended geometry must remain available for visibility');
    }
});

test('Absolution-sized provenance splits follow the entire 1.227 second lane',()=>{
    const rows=rowsFor([[0,1],[15.359,7],[15.851,7],[16.586,5]]);
    rows[2].h3dResolvedChordLane=true;
    for(const preset of ['straight','angled']) for(const rate of [.5,1,2]) {
        const h=harness(rows,{preset,rate});
        assertArrival(h,15.359,7);
        assertArrival(h,16.586,5);
        assert.deepEqual(h.cache.stops.map(s=>s.x),[20,80,60]);
        assert.equal(h.cache.regions.length,rows.length,'camera compaction must preserve musical rows');
    }
});

test('each genuine lasting region is reached even when the previous view could fit it',()=>{
    const rows=rowsFor([[0,1],[2,2],[2.5,1],[3,7],[3.75,1]]);
    for(const preset of ['straight','angled']) for(const lefty of [false,true]) {
        const h=harness(rows,{preset,lefty,aspect:2.6});
        for(const row of rows) assertArrival(h,row.time,row.fret,lefty);
    }
});

test('a suppressed distant excursion uses the minimum fixed-centre fit without a zoom budget',()=>{
    const rows=rowsFor([[0,1],[2,21],[2.3,1]]);
    for(const preset of ['straight','angled']) for(const lefty of [false,true]) {
        const h=harness(rows,{preset,lefty,aspect:.8});
        const early=h.run(0),at=h.run(2),region=h.cache.regions[1],home=focus(1,lefty);
        const required=h.distanceAt(region,home);
        assert.equal(at.x,home);
        assert.ok(required>region.viewDistance*1.25,'fixture must exceed the obsolete 25% widening budget');
        assert.ok(Math.abs(region.plannedViewDistance-required)<1e-8);
        assert.ok(at.distance>=required-1e-8);
        assert.ok(h.fitsAt(region,home,required+1e-6));
        assert.equal(h.fitsAt(region,home,required-.001),false,'any smaller static fit clips required geometry');
        assert.ok(early.distance<required);
        for(let t=0;t<4;t+=.025) assert.equal(h.run(t).x,home,'visibility must never select a lateral compromise');
    }
});

test('late excursions prepare zoom locally without widening earlier history',()=>{
    const h=harness(rowsFor([[0,1],[100,21],[100.3,1]]),{aspect:.8});
    const early=h.run(0),required=h.cache.regions[1].plannedViewDistance;
    assert.equal(h.run(50).distance,early.distance);
    assert.equal(h.run(98).distance,early.distance);
    const preparing=h.run(99.8);
    assert.ok(preparing.distance>early.distance&&preparing.distance<required);
    assert.equal(preparing.x,20);
    assert.equal(h.run(100).distance,required);
});

test('closely repeated excursions retain a wide return floor while the centre stays still',()=>{
    const h=harness(rowsFor([[0,1],[2,21],[2.2,1],[2.8,21],[3,1]]),{aspect:.8});
    h.run(0);
    const required=h.cache.regions[1].plannedViewDistance;
    const between=h.run(2.4);
    assert.equal(between.x,20);
    assert.ok(between.returnFloor>=required,'a close repeat must prevent a narrow/wide zoom cycle');
});

test('Rats-sized short overshoot bypasses its target while fitting all original rows',()=>{
    const rows=rowsFor([[0,9],[54.256,13],[54.507,8]]);
    for(const preset of ['straight','angled']) {
        const h=harness(rows,{preset});
        h.run(0);
        assert.deepEqual(h.cache.stops.map(s=>s.x),[100,90]);
        assert.equal(h.cache.regions[1].firstFret,13);
        for(let t=53;t<55;t+=.01) {
            const actual=h.run(t);
            assert.ok(actual.x<=100+1e-8&&actual.x>=90-1e-8);
        }
        assertArrival(h,54.507,8);
    }
});

test('progressive short lanes travel before a distant destination and settle at that destination',()=>{
    const rows=rowsFor([[0,1],[2,4],[2.2,8],[2.4,12],[2.6,16],[2.8,21]]);
    for(const preset of ['straight','angled']) for(const rate of [.5,1,2]) {
        const h=harness(rows,{preset,rate});
        assert.ok(h.run(2.1).x>20);
        for(const time of [2,2.2,2.4,2.6]) assert.ok(h.run(time).velocity>0);
        assertArrival(h,2.8,21);
    }
});

test('same-position provenance fragments preserve the entire camera trajectory',()=>{
    const rows=rowsFor([[0,1],[2,7],[3.2,5],[5,1]]);
    const fragmented=[rows[0],rows[1],{...rows[1],time:2.3,h3dResolvedChordLane:true},
        {...rows[1],time:2.7,guidanceOrigin:'inferred'},rows[2],rows[3]];
    for(const preset of ['straight','angled']) {
        const a=harness(rows,{preset}),b=harness(fragmented,{preset});
        for(let t=0;t<7;t+=.025) {
            const x=a.run(t),y=b.run(t);
            assert.equal(x.x,y.x);assert.equal(x.velocity,y.velocity);
        }
    }
});

test('long repeated whole-chord relocations are followed without a dominance override',()=>{
    const rows=rowsFor([[0,1],[2,7],[2.75,1],[4,7],[4.75,1],[6,7],[6.75,1]]);
    const chords=rows.map(row=>({t:row.time,notes:[{s:0,f:row.fret},{s:1,f:row.fret+2}]}));
    for(const preset of ['straight','angled']) {
        const h=harness(rows,{preset,chords});
        for(const row of rows) assertArrival(h,row.time,row.fret);
    }
});

test('ambiguous long single notes follow their longer lane instead of inferring a riff exception',()=>{
    const rows=rowsFor([[0,1],[2,7],[2.75,1],[4,7],[4.75,1]]);
    const notes=rows.map(row=>({t:row.time,s:0,f:row.fret}));
    for(const preset of ['straight','angled']) {
        const h=harness(rows,{preset,notes});
        assertArrival(h,2,7);assertArrival(h,4,7);
    }
});

test('semantic classification is unchanged by playback speed and cached across warm frames',()=>{
    const rows=rowsFor([[0,1],[2,7],[2.3,1],[4,7],[4.75,1]]);
    const h=harness(rows);
    h.run(0);
    const semantic=h.cache.semanticStops,timeline=h.cache.timeline,regions=h.cache.regions;
    for(const rate of [.5,1,2]) {
        h.setRate(rate);h.run(0);
        assert.equal(h.cache.semanticStops,semantic);
        assert.equal(h.cache.timeline,timeline);
        assert.equal(h.cache.regions,regions);
        assert.deepEqual(h.cache.stops.map(s=>s.x),[20,80,20]);
        const stops=h.cache.stops,zoom=h.cache.zoomRegions,revision=h.cache.revision;
        const entries=zoom.slice();
        for(let t=0;t<6;t+=.01) h.run(t);
        assert.equal(h.cache.stops,stops);assert.equal(h.cache.zoomRegions,zoom);
        assert.ok(zoom.every((entry,i)=>entry===entries[i]));
        assert.equal(h.cache.revision,revision);
        assertArrival(h,4,7);
    }
});
