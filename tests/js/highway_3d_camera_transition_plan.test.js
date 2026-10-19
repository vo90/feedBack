const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let signature = source.indexOf('(',start)+1, parentheses=1;
    while(parentheses) {
        if(source[signature]==='(') parentheses++;
        if(source[signature]===')') parentheses--;
        signature++;
    }
    const open=source.indexOf('{',signature);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}
// Exercise the production camera helpers together, without duplicating their
// internal stages in the tests.
const cameraHelpers = [...source.matchAll(/function (hwy(?:BuildCamera|PrepareCamera|Camera)[A-Za-z0-9_]*)\(/g)]
    .map(match => match[1]);
const { build, prepare, at, rejoin, joinAt, zoom } = new Function(`
    const NFRETS = 24;
    ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote'].map(extract).join('\n')}
    ${cameraHelpers.map(extract).join('\n')}
    return {build:hwyBuildCameraStops,prepare:hwyPrepareCameraStops,at:hwyCameraPlanAt,rejoin:hwyCameraRejoin,joinAt:hwyCameraJoinAt,zoom:hwyCameraZoom};
`)();
const row = (time, x, width = 4) => ({ time, x, preferred:x, minX:x-2, maxX:x-2+width,
    firstFret:x-1, lastFret:x-2+width });
const fits = () => true;
const sample = (stops, time, rate = 1) => at(stops, time, rate, .5, undefined, 0, 0, 0, 5);
const targets = stops => stops.map(stop => stop.x);
const assertArrived = (stops, time, wanted, rate = 1) => {
    const result = sample(stops, time, rate);
    assert.ok(Math.abs(result.x-wanted)<1e-9, `at ${time}: ${result.x} must equal ${wanted}`);
    assert.ok(Math.abs(result.velocity)<1e-9, `at ${time}: arrival velocity ${result.velocity}`);
};

test('a sub-500ms return holds the original position without changing chart rows', () => {
    const rows = [row(0,9), row(2,13), row(2.499,9)];
    rows.forEach(Object.freeze); Object.freeze(rows);
    const stops = build(rows,1,fits);
    assert.deepEqual(targets(stops),[9]);
    assert.equal(rows[1].x,13);
    for(let t=0;t<5;t+=.01) assert.equal(sample(stops,t).x,9);
});

test('the 500ms boundary follows the whole lasting lane at every speed', () => {
    for(const duration of [.499,.5,.501,.75]) for(const rate of [.5,1,2]) {
        const stops = build([row(0,9),row(2,13),row(2+duration,9)],rate,fits);
        assert.deepEqual(targets(stops),duration<.5?[9]:[9,13,9], `${duration}s / ${rate}x`);
        if(duration>=.5) {
            assertArrived(stops,2,13,rate);
            assertArrived(stops,2+duration,9,rate);
        }
    }
});

test('duration is measured across provenance fragments, not individual chord rows', () => {
    const rows = [row(0,3),row(15.359,9),{...row(15.851,9),h3dResolvedChordLane:true},row(16.586,7)];
    const stops=build(rows,1,fits);
    assert.deepEqual(targets(stops),[3,9,7]);
    assertArrived(stops,15.359,9);
    assertArrived(stops,16.586,7);
});

test('a short whole excursion can contain several changed lanes', () => {
    const stops=build([row(0,9),row(2,13),row(2.2,15),row(2.49,9)],1,fits);
    assert.deepEqual(targets(stops),[9]);
});

test('several short rows cannot hide a whole excursion longer than 500ms', () => {
    const stops=build([row(0,3),row(2,7),row(2.3,9),row(2.6,11),row(2.9,3)],1,fits);
    assert.ok(stops.length>1);
    assert.ok(sample(stops,2.5).x>3,'camera must travel while the excursion is in progress');
});

test('a short off-route overshoot is skipped while travelling to the lasting destination', () => {
    const stops=build([row(0,9),row(2,13),row(2.251,8)],1,fits);
    assert.deepEqual(targets(stops),[9,8]);
    let previous=9;
    for(let t=1;t<4;t+=.01) {
        const {x}=sample(stops,t); assert.ok(x<=previous+1e-10); previous=x;
    }
    assertArrived(stops,2.251,8);
});

test('an overshoot lasting 500ms is a real destination and is followed', () => {
    const stops=build([row(0,9),row(2,13),row(2.5,8)],1,fits);
    assert.deepEqual(targets(stops),[9,13,8]);
    assertArrived(stops,2,13);
});

test('distant brief notes retain the home position even when fitting requires zoom', () => {
    for(const readable of [true,false]) {
        const stops=build([row(0,3),row(2,23),row(2.3,3)],1,()=>readable,()=>13);
        assert.deepEqual(targets(stops),[3]);
        for(let t=1;t<3;t+=.025) assert.equal(sample(stops,t).x,3);
    }
});

test('small genuine lasting lane changes cannot be canceled by a fit tolerance', () => {
    const stops=build([row(0,5),row(2,6),row(3,5)],1,fits,()=>5,()=>({min:0,max:20,valid:true}));
    assert.deepEqual(targets(stops),[5,6,5]);
    assertArrived(stops,2,6);
});

test('same-base extensions preserve the first-four-fret focus regardless of fit', () => {
    for(const canHold of [fits,()=>false]) {
        const stops=build([row(0,7),row(2,7,8),row(6,7)],1,canHold);
        assert.deepEqual(targets(stops),[7]);
    }
});

test('an unrelated return much later cannot suppress the preceding progression', () => {
    const stops=build([row(0,3),row(2,7),row(2.4,9),row(10,3)],1,fits);
    assert.ok(targets(stops).includes(7));
    assertArrived(stops,2.4,9);
});

test('short alternating detours retain the established focus without choosing a new bias', () => {
    const rows=[row(0,7),...Array.from({length:40},(_,i)=>row(2+i*.1,i%2?7:6)),row(6,7)];
    assert.deepEqual(targets(build(rows,1,fits)),[7]);
});

test('a progressive short run moves continuously and settles at its lasting destination', () => {
    const rows=[row(0,3),row(2,5),row(2.2,7),row(2.4,9),row(2.6,11),row(5,11)];
    const stops=build(rows,1,fits);
    assert.deepEqual(targets(stops),[3,5,7,9,11]);
    assert.ok(sample(stops,2.1).x>3);
    for(const time of [2,2.2,2.4]) assert.ok(sample(stops,time).velocity>0,`transit at ${time} must not stop`);
    let previous=3;
    for(let t=0;t<4;t+=.005) {
        const {x}=sample(stops,t);assert.ok(x>=previous-1e-9);assert.ok(x<=11+1e-9);previous=x;
    }
    assertArrived(stops,2.6,11);
});

test('every lasting destination has zero lateral velocity exactly at its onset', () => {
    const rows=[row(0,3),row(2,7),row(2.6,5),row(3.2,23),row(4,9)];
    for(const rate of [.5,1,2]) {
        const stops=prepare(build(rows,rate,fits),[],[],rate);
        for(const r of rows) assertArrived(stops,r.time,r.x,rate);
    }
});

test('ordinary and large moves prepare early and finish without residual drift', () => {
    for(const destination of [7,23]) {
        const stops=build([row(0,3),row(2,destination)],1,fits);
        assert.equal(sample(stops,.5).x,3);
        assert.ok(sample(stops,1.8).x>3);
        assertArrived(stops,2,destination);
        assertArrived(stops,10000,destination);
    }
});

test('scheduled moves preserve position and velocity continuity through overlapping preparation', () => {
    const stops=build([row(0,3),row(2,7),row(2.2,11),row(2.4,15)],1,fits),e=1e-7;
    for(let t=1;t<3;t+=.005) {
        const before=sample(stops,t-e),after=sample(stops,t+e);
        assert.ok(Math.abs(before.x-after.x)<.0001);
        assert.ok(Math.abs(before.velocity-after.velocity)<.001,`velocity discontinuity near ${t}`);
    }
    assertArrived(stops,2.4,15);
});

test('lasting arrival and transit waypoints have continuous acceleration',()=>{
    const stops=build([row(0,3),row(2,7),row(2.2,11),row(2.4,15)],1,fits),e=1e-6;
    for(const time of [2,2.2,2.4]) {
        const left=sample(stops,time-e),middle=sample(stops,time),right=sample(stops,time+e);
        const before=(middle.velocity-left.velocity)/e,after=(right.velocity-middle.velocity)/e;
        assert.ok(Math.abs(before-after)<.02,`acceleration changes at ${time}: ${before} to ${after}`);
    }
});

test('seeking and low or variable frame rates evaluate the same trajectory', () => {
    const stops=build([row(0,3),row(2,11),row(4,7)],1,fits);
    const expected=sample(stops,1.9);
    for(const fps of [10,20,30,60,120]) {
        for(let i=0;i<fps*2;i++) sample(stops,i/fps);
        assert.deepEqual(sample(stops,1.9),expected);
    }
});

test('preparation timing stays constant in real seconds when room is available', () => {
    const reference=sample(build([row(0,3),row(4,11)],1,fits),3.8);
    for(const rate of [.5,1,1.5,2]) {
        const stops=build([row(0,3),row(4*rate,11)],rate,fits);
        const result=sample(stops,3.8*rate,rate);
        assert.ok(Math.abs(result.x-reference.x)<1e-8);
        assert.ok(Math.abs(result.velocity-reference.velocity)<1e-8);
    }
});

test('mirrored world coordinates yield mirrored movement and excursion decisions', () => {
    const rows=[row(0,9),row(2,13),row(2.25,8),row(4,20)];
    const mirror=rows.map(r=>({...r,x:-r.x,preferred:-r.preferred,minX:-r.maxX,maxX:-r.minX}));
    const a=build(rows,1,fits),b=build(mirror,1,fits);
    for(let t=0;t<5;t+=.025) assert.ok(Math.abs(sample(a,t).x+sample(b,t).x)<1e-8);
});

test('duplicate bounds and provenance have no effect on the complete trajectory', () => {
    const rows=[row(0,3),row(2,11),row(4,7)];
    const a=build(rows,1,fits),b=build([rows[0],rows[1],{...row(2.01,11),guidanceOrigin:'inferred'},
        {...row(2.02,11),h3dResolvedChordLane:true},rows[2]],1,fits);
    for(let t=0;t<6;t+=.01) assert.deepEqual(sample(a,t),sample(b,t));
});

test('a repeated longer relocation alone is insufficient evidence for a riff exception', () => {
    const rows=[row(0,3),row(2,9),row(2.75,3),row(4,9),row(4.75,3)];
    const stops=build(rows,1,fits);
    assert.deepEqual(targets(stops),[3,9,3,9,3]);
    assertArrived(stops,2,9);assertArrived(stops,4,9);
});

test('catch-up after lifecycle changes is stable across frame rates', () => {
    const results=[];
    for(const fps of [10,20,60,120]) {
        let state={offset:20,velocity:-5};
        for(let i=0;i<fps;i++) state=rejoin(state.offset,state.velocity,1/fps);
        results.push(state);
    }
    assert.ok(Math.max(...results.map(r=>r.offset))-Math.min(...results.map(r=>r.offset))<1e-10);
    assert.ok(Math.abs(results[0].offset)<.001);
});

test('lifecycle correction preserves initial position and velocity then ends at the arrival deadline',()=>{
    for(const rate of [.5,1,2]) {
        const start=3,end=4,initial=joinAt(5,-2,start,end,start,rate);
        assert.equal(initial.x,5);assert.equal(initial.velocity,-2);
        for(const fps of [10,60,120]) {
            let previous=initial;
            for(let time=start+rate/fps;time<end;time+=rate/fps) {
                const result=joinAt(5,-2,start,end,time,rate);
                assert.ok(Number.isFinite(result.x)&&Number.isFinite(result.velocity));
                assert.ok(result.x<=previous.x+1e-9&&result.x>=-1e-9);
                previous=result;
            }
            assert.deepEqual(joinAt(5,-2,start,end,end,rate),{x:0,velocity:0});
            assert.deepEqual(joinAt(5,-2,start,end,end+1,rate),{x:0,velocity:0});
        }
    }
});

test('empty and one-position charts have finite resting plans', () => {
    assert.deepEqual(sample([],20),{x:0,velocity:0,valid:false,arrivalTime:Infinity,arrivalX:0});
    assert.deepEqual(sample(build([row(3,9)],1,fits),0),{x:9,velocity:0,valid:true,arrivalTime:Infinity,arrivalX:9});
});

test('necessary zoom waits 500ms and returns fully over 800ms at every frame rate', () => {
    for(const fps of [10,20,60,120]) {
        const state={distance:2,quietZoomTime:0};
        for(let i=1;i<=Math.round(1.4*fps);i++) {
            zoom(state,1,1/fps);
            if(i/fps<=.5) assert.ok(Math.abs(state.distance-2)<1e-10);
        }
        assert.equal(state.distance,1);assert.equal(state.zoomRequired,1);
    }
});

test('outward motion decelerates through a disappearing constraint before returning', () => {
    for(const fps of [30,60,100]) {
        const state={distance:1,quietZoomTime:0,zoomVelocity:.3,zoomRequired:1};
        let previous=state.distance,previousStep=.3/fps;
        for(let i=1;i<=Math.round(.4*fps);i++) {
            zoom(state,.9,1/fps);
            const step=state.distance-previous;
            assert.ok(step>0&&step<=previousStep+1e-10);
            assert.ok(step/previousStep>.7,'outward movement stopped abruptly');
            previous=state.distance;previousStep=step;
        }
        for(let i=0;i<2*fps;i++) zoom(state,.9,1/fps);
        assert.equal(state.distance,.9);assert.equal(state.zoomVelocity,0);
    }
});

test('a slowly rising requirement cancels narrowing without dropping its velocity', () => {
    const state={distance:2,quietZoomTime:0};
    for(let i=0;i<85;i++) zoom(state,1,.01);
    const before=state.distance,velocity=state.zoomVelocity;
    assert.ok(velocity<0);
    zoom(state,1.001,.01);
    assert.ok(state.distance<before&&state.distance>1.001);
    assert.ok(state.zoomVelocity<0&&state.zoomVelocity>velocity);
    assert.ok(state.quietZoomTime<.02,'rising requirements must cancel the old return');
});

test('renewed wide requirements cancel a narrowing return', () => {
    const state={distance:2,quietZoomTime:0};
    for(let i=0;i<9;i++) zoom(state,1,.1);
    assert.ok(state.distance>1&&state.distance<2);
    const before=state.distance;
    zoom(state,2,.1);
    assert.equal(state.quietZoomTime,0);assert.ok(state.distance>before);
});
