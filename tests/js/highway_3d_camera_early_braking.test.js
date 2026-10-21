const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createCameraMotion} = require('../../plugins/highway_3d/src/camera-motion.mjs');
const {harness} = require('../helpers/highway_camera_harness.cjs');

const motion = createCameraMotion({isRenderableNote: note => Number.isFinite(note.f), isUnpitchedMute: () => false});
const options = {movementMode:'latest-destination', startBeforeMs:400, arriveAfterMs:50};
const rows = pairs => pairs.map(([time,x]) => ({time,x,lasting:true,lead:.6,minX:x-2,maxX:x+2}));
const near = (actual, expected, tolerance = 1e-7, message = '') =>
    assert.ok(Math.abs(actual-expected)<=tolerance, `${message}: ${actual} != ${expected}`);
const build = (stops, controls = options) => motion.hwyBuildCameraMotion(stops,1,.5,0,0,250,null,controls);
const sample = (stops,time,controls = options,rate = 1,out = {}) =>
    motion.hwyCameraPlanAt(stops,time,rate,.5,out,0,0,250,null,controls);
const segmentAt = (segment,time) => motion.hwyCameraSegmentAt(segment.from,segment.to,
    segment.v0,segment.v1,segment.end-segment.start,
    (time-segment.start)/(segment.end-segment.start),{},segment.a0,segment.a1);

function assertContinuous(segments) {
    for(let i=1;i<segments.length;i++) {
        const left=segments[i-1],right=segments[i];
        assert.ok(left.end<=right.start+1e-12,'cached pieces must not overlap');
        near(left.to,right.from,1e-7,'position at handoff');
        near(left.v1,right.v0,1e-6,'velocity at handoff');
        near(left.a1,right.a0,1e-5,'acceleration at handoff');
        if(left.end===right.start && left.end>left.start && right.end>right.start) {
            const a=segmentAt(left,left.end),b=segmentAt(right,right.start);
            near(a.x,b.x,1e-7,'sampled position at handoff');
            near(a.velocity,b.velocity,1e-6,'sampled velocity at handoff');
            near(a.acceleration,b.acceleration,1e-5,'sampled acceleration at handoff');
        }
    }
}

function assertAdvancingPath(pairs, controls = options) {
    const stops=rows(pairs),segments=build(stops,controls);
    const source=pairs[0][1],target=pairs.at(-1)[1],direction=Math.sign(target-source);
    const start=Math.max(pairs[0][0],pairs[1][0]-controls.startBeforeMs/1000);
    const end=pairs.at(-1)[0]+controls.arriveAfterMs/1000;
    near(segments[0].start,start,1e-9,'first departure');
    near(segments.at(-1).end,end,1e-9,'final arrival deadline');
    assertContinuous(segments);
    near(sample(stops,start,controls).x,source);
    let previous=source;
    for(const segment of segments) {
        if(segment.end<=segment.start) continue;
        for(let i=0;i<=256;i++) {
            const time=segment.start+(segment.end-segment.start)*i/256;
            const point=segmentAt(segment,time);
            assert.ok([point.x,point.velocity,point.acceleration].every(Number.isFinite),'finite motion');
            assert.ok(direction*(point.x-previous)>=-1e-7,
                `an advancing target stream reverses at ${time}: ${previous} to ${point.x}`);
            assert.ok(direction*point.velocity>=-1e-6,
                `an advancing target stream has reverse velocity ${point.velocity} at ${time}`);
            assert.ok(direction*(target-point.x)>=-1e-7,
                `the camera passes the final centre ${target} at ${time}: ${point.x}`);
            previous=point.x;
        }
    }
    const final=sample(stops,end,controls);
    near(final.x,target,1e-8,'final centre');near(final.velocity,0);near(final.acceleration,0);
    near(sample(stops,start-.01,controls).x,source,1e-9,'no earlier first departure');
    return {stops,segments};
}

test('latest destination brakes before the large-then-small rightward audit jump can overshoot',()=>{
    const {stops}=assertAdvancingPath([[0,20],[5,210],[5.27,220]]);
    const secondTrigger=5.27-.4;
    assert.ok(sample(stops,secondTrigger).x<210,'the next target interrupts before reaching the old centre');
    assert.ok(sample(stops,secondTrigger).velocity>0,'the handoff remains moving smoothly');
});

test('the same early-braking protection works for a leftward journey',()=>{
    assertAdvancingPath([[0,220],[5,30],[5.27,20]]);
});

test('a long move followed by several short advancing lanes never backtracks',()=>{
    for(const direction of [-1,1]) assertAdvancingPath(
        [[0,0],[5,180],[5.27,182],[5.38,183],[5.49,184],[5.6,186]]
            .map(([time,x])=>[time,120+direction*x]));
});

test('tiny final steps and longer arrival windows still finish on time without reversal',()=>{
    for(const arriveAfterMs of [50,500,1000,3000]) for(const direction of [-1,1]) {
        assertAdvancingPath([[0,20],[5,210],[5.27,210.005]].map(([time,x])=>[time,x*direction]),
            {...options,arriveAfterMs});
    }
});

test('dense monotone target chains remain bounded and smooth at timing extremes',()=>{
    for(const [startBeforeMs,arriveAfterMs] of [[25,0],[400,50],[3000,3000]]) {
        const pairs=[[0,0],[5,190],...Array.from({length:80},(_,i)=>[5.01+i*.008,190.1+i*.1])];
        assertAdvancingPath(pairs,{...options,startBeforeMs,arriveAfterMs});
    }
});

test('an already safe advancing path retains its previous trajectory',()=>{
    const stops=rows([[0,20],[5,100],[5.27,210]]);
    // Captured from the pre-fix production sampler. The protection must not
    // change an ordinary path that already stays monotone and within bounds.
    const expected=[
        [4.7,26.112889295331073,159.32530610171318,2276.0758014530284],
        [4.8,51.73499974597373,325.15368592186167,650.3073718437232],
        [4.9,83.54218789293847,295.61386561316976,261.3242381344774],
        [5.1,162.5213555765639,441.72897135111515,-867.4597366661671],
        [5.3,209.92452481117238,11.07779129929412,-1059.5264061778948],
    ];
    for(const [time,x,v,a] of expected) {
        const actual=sample(stops,time);
        near(actual.x,x);near(actual.velocity,v,1e-6);near(actual.acceleration,a,1e-5);
    }
});

test('genuine target reversals retain their existing momentum and trajectory',()=>{
    const stops=rows([[0,20],[5,210],[5.27,30]]);
    const expected=[
        [4.8,95.3706243966875,772.2400040644198,1544.4800081288186],
        [4.9,169.73254315930902,588.193218897114,-6429.670435116688],
        [5,187.34475927693273,-265.8325284300198,-8377.621738474798],
        [5.2,56.4060434457281,-542.8357667818855,5404.4770326475145],
    ];
    for(const [time,x,v,a] of expected) {
        const actual=sample(stops,time);
        near(actual.x,x);near(actual.velocity,v,1e-6);near(actual.acceleration,a,1e-5);
    }
});

test('reach every centre keeps each arrival and its established shared tangent',()=>{
    const controls={...options,movementMode:'reach-centres'};
    const stops=rows([[0,20],[5,210],[5.27,220]]),segments=build(stops,controls);
    assert.equal(segments.length,2);assertContinuous(segments);
    near(segments[0].start,4.6);near(segments[0].end,5.05);near(segments[1].start,5.05);near(segments[1].end,5.32);
    near(segments[0].v1,10/.27);near(segments[1].v0,10/.27);
    near(sample(stops,5.05,controls).x,210);near(sample(stops,5.32,controls).x,220);
});

test('diagnostics identify only the journey needing earlier braking and keep requested timings explicit',()=>{
    const stops=rows([[0,20],[2,100],[2.27,210],[4,20],[5,210],[5.27,220],[9,30],[9.27,210]]);
    const segments=build(stops);
    assert.equal(segments.journeys.length,4);
    for(let i=0;i<segments.journeys.length;i++) {
        const journey=segments.journeys[i],protectedJourney=i===2;
        for(const segment of segments.slice(journey.first,journey.last+1)) {
            assert.equal(segment.timing.earlyBraking,protectedJourney);
            if(protectedJourney) near(segment.timing.brakingTriggerTime,4.87,1e-9,'problematic target trigger');
            else assert.equal(segment.timing.brakingTriggerTime,null);
            assert.equal(segment.timing.requestedStartBeforeMs,400);
            assert.equal(segment.timing.requestedArriveAfterMs,50);
        }
    }
    const duringPreparation=sample(stops,4.7).timing;
    assert.equal(duringPreparation.earlyBraking,true,'braking must be explained before the upcoming redirect');
    near(duringPreparation.brakingTriggerTime,4.87,1e-9);
    for(const segment of build(rows([[0,20],[5,210],[5.27,220]]),{...options,movementMode:'reach-centres'})) {
        assert.equal(segment.timing.earlyBraking,false,'reach every centre keeps its own movement policy');
        assert.equal(segment.timing.brakingTriggerTime,null);
    }
});

test('a protected journey containing a real reversal stays smooth and within each active target interval',()=>{
    for(const direction of [-1,1]) {
        const stops=rows([[0,20],[5,210],[5.27,30],[5.54,20]].map(([time,x])=>[time,direction*x]));
        const segments=build(stops);
        assert.ok(segments.some(segment=>segment.timing.earlyBraking),'the later leftward continuation needs protection');
        assertContinuous(segments);
        for(const segment of segments) {
            const lower=Math.min(segment.from,segment.targetX),upper=Math.max(segment.from,segment.targetX);
            const travelDirection=Math.sign(segment.to-segment.from);
            for(let i=0;i<=256;i++) {
                const point=segmentAt(segment,segment.start+(segment.end-segment.start)*i/256);
                assert.ok(point.x>=lower-1e-7&&point.x<=upper+1e-7,'stay between current position and active destination');
                assert.ok(travelDirection*point.velocity>=-1e-6,'no unintended reversal within a piece');
            }
        }
        assert.ok(direction*sample(stops,4.75).velocity>0,'the initial move still approaches the rightward lane');
        assert.ok(direction*sample(stops,5.1).velocity<0,'the chart reversal still sends the camera back left');
        near(sample(stops,5.59).x,direction*20,1e-8,'the final destination still arrives on time');
    }
});

test('earlier braking handles several target triggers before the first available song position',()=>{
    const {stops,segments}=assertAdvancingPath([[1,20],[1.1,30],[1.2,40],[1.3,210],[1.57,220]]);
    assert.ok(segments.some(segment=>segment.timing.earlyBraking),'the available continuation requires braking');
    assert.ok(segments.filter(segment=>segment.start===segment.end).length>=2,'the fixture collapses early triggers');
    for(const segment of segments) {
        assert.ok([segment.start,segment.end,segment.from,segment.to,segment.v0,segment.v1,segment.a0,segment.a1]
            .every(Number.isFinite),'even zero-duration cached pieces have finite endpoints');
    }
    for(const time of [.999999,1,1.000001,1.17,1.62]) {
        const point=sample(stops,time);
        assert.ok([point.x,point.velocity,point.acceleration].every(Number.isFinite),'boundary sampling is finite');
    }
    near(sample(stops,1).x,20,1e-9,'collapsed triggers never teleport the camera');
});

test('an offending journey does not change separate neighbouring journeys',()=>{
    const combined=rows([[0,20],[2,100],[2.27,210],[4,20],[5,210],[5.27,220],[9,30],[9.27,210]]);
    const references=[
        {stops:rows([[0,20],[2,100],[2.27,210]]),start:1.6,end:2.32},
        {stops:rows([[2.27,210],[4,20]]),start:3.6,end:4.05},
        {stops:rows([[5.27,220],[9,30],[9.27,210]]),start:8.6,end:9.32},
    ];
    for(const reference of references) for(let i=0;i<=256;i++) {
        const time=reference.start+(reference.end-reference.start)*i/256;
        const actual=sample(combined,time),expected=sample(reference.stops,time);
        assert.deepEqual([actual.x,actual.velocity,actual.acceleration],
            [expected.x,expected.velocity,expected.acceleration],`unaffected neighbouring path at ${time}`);
    }
});

test('early-braked paths remain identical in song space across rates and reuse their cached plan',()=>{
    const stops=rows([[0,20],[5,210],[5.27,220]]),out={};
    const times=Array.from({length:145},(_,i)=>4.6+i*.005);
    const reference=times.map(time=>({...sample(stops,time)}));
    const cached=stops.motion;
    for(const rate of [.25,.5,1.5,2,4]) for(let i=0;i<times.length;i++) {
        assert.equal(sample(stops,times[i],options,rate,out),out);
        assert.equal(stops.motion,cached,'rate edits reuse the song-time motion plan');
        near(out.x,reference[i].x);near(out.velocity,reference[i].velocity*rate,1e-6);
        near(out.acceleration,reference[i].acceleration*rate*rate,1e-4);
    }
});

test('sampling a cached protected journey never scans source stops again',()=>{
    let reads=0;
    const stops=new Proxy(rows([[0,20],[5,210],[5.27,220]]),{
        get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);},
    });
    const out=sample(stops,4.8),cached=stops.motion;
    assert.ok(reads>0);reads=0;
    for(let i=0;i<1000;i++) {
        assert.equal(sample(stops,4.8+i/100000,options,1,out),out);
        assert.equal(stops.motion,cached);
    }
    assert.equal(reads,0,'per-frame sampling must only search the cached pieces');
});

for(const preset of ['straight','angled']) test(`${preset} renderer follows the protected path at every speed without rebuilding musical evidence`,()=>{
    let reference;
    for(const rate of [1,.25,.5,2,4]) {
        const h=harness();
        h.settings({...options,preset,rate,autoZoom:false,excursionThreshold:0});
        h.setRegionTimeline([{time:0,minX:0,maxX:40},{time:5,minX:190,maxX:230},{time:5.27,minX:200,maxX:240}]);
        const samples=[];let previous=20,evidence;
        for(let frame=0;frame<=5.5*240;frame++) {
            const time=frame/240,state=h.frame(time,frame?1/(240*rate):0);
            assert.ok(state.x>=previous-1e-7,`rate ${rate}: renderer reverses at ${time}`);
            assert.ok(state.x<=220+1e-7,`rate ${rate}: renderer passes the final centre`);
            if(frame===0)evidence=h.planCache().cameraEvidence;
            assert.equal(h.planCache().cameraEvidence,evidence,'playback must reuse musical evidence');
            if(reference)near(state.x,reference[frame],1e-7,`rate ${rate} at ${time}`);
            previous=state.x;samples.push(state.x);
        }
        near(samples.at(-1),220);reference??=samples;
    }
});
