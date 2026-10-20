const test = require('node:test');
const assert = require('node:assert/strict');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');
const motion = createCameraMotion({isRenderableNote: note => Number.isFinite(note.f), isUnpitchedMute: note => !!note.unpitched});
const modes = ['reach-centres', 'latest-destination'];
const stop = (time, x, lasting = true, lead = .6) => ({time, x, lasting, lead, minX:x-2, maxX:x+2});
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual-expected)<=tolerance, `${actual} != ${expected}`);
const legacySettings = [[.5,0,0,250,null],[0,1000,200,3000,null],[1,200,75,900,25],[.25,600,35,1500,2500]];
const build = (stops,rate,direct,legacy=legacySettings[0]) => motion.hwyBuildCameraMotion(stops,rate,...legacy,direct);
const sample = (stops,time,rate,direct,out={},legacy=legacySettings[0]) => motion.hwyCameraPlanAt(stops,time,rate,legacy[0],out,...legacy.slice(1),direct);
const at = (segment,time,out={}) => motion.hwyCameraSegmentAt(segment.from,segment.to,segment.v0,segment.v1,
    segment.end-segment.start,(time-segment.start)/(segment.end-segment.start),out,segment.a0,segment.a1);
const trajectory = segments => segments.map(({start,end,from,to,v0,v1,a0,a1,transit,arrivalIndex})=>({start,end,from,to,v0,v1,a0,a1,transit,arrivalIndex}));
function continuous(segments) {
    for(let i=1;i<segments.length;i++) {
        const left=segments[i-1],right=segments[i];
        assert.ok(left.end<=right.start);
        close(left.to,right.from); close(left.v1,right.v0); close(left.a1,right.a0);
        if(left.end===right.start && left.end>left.start) {
            const a=at(left,left.end),b=at(right,right.start);
            close(a.x,b.x);close(a.velocity,b.velocity);close(a.acceleration,b.acceleration);
        }
    }
}

test('both movement modes apply exact isolated endpoints at every speed and distance',()=>{
    for(const movementMode of modes) for(const rate of [.5,1,1.5]) for(const x of [.25,3,20,-20])
        for(const startBeforeMs of [25,100,500,700,3000]) for(const arriveAfterMs of [0,200,1000,3000]) {
            const options={movementMode,startBeforeMs,arriveAfterMs};
            const rows=[stop(0,0),stop(10,x)];
            const segments=build(rows,rate,options),segment=segments[0],timing=segment.timing;
            close(segment.start,10-startBeforeMs/1000*rate); close(segment.end,10+arriveAfterMs/1000*rate);
            close(timing.appliedLeadMs,startBeforeMs);close(timing.appliedDurationMs,startBeforeMs+arriveAfterMs);
            close(timing.actualArriveAfterMs,arriveAfterMs);assert.equal(timing.mode,movementMode);
            assert.equal(timing.reachedCentre,true);assert.equal(timing.retargeted,false);
            const before=sample(rows,segment.start,rate,options),after=sample(rows,segment.end,rate,options);
            close(before.x,0);close(before.velocity,0);close(after.x,x);close(after.velocity,0);
        }
});

test('new paths ignore all legacy preparation, smoothing, delay, extra travel and settling settings',()=>{
    const chart=[stop(0,0),stop(5,4,false,1.2),stop(5.3,9,false),stop(5.6,2),stop(10,7)];
    for(const movementMode of modes) for(const rate of [.5,1,1.5]) {
        const options={movementMode,startBeforeMs:500,arriveAfterMs:1000};
        const traces=legacySettings.map(legacy=>{
            const rows=chart.map(row=>({...row})),segments=build(rows,rate,options,legacy),samples=[];
            for(let t=3;t<13;t+=.07){const out=sample(rows,t,rate,options,{},legacy);samples.push([out.x,out.velocity,out.acceleration]);}
            return {segments:trajectory(segments),samples};
        });
        for(const trace of traces.slice(1))assert.deepEqual(trace,traces[0]);
    }
});

test('reach-centres joins overlapping windows and visits every retained progressive centre',()=>{
    for(const rate of [.5,1,1.5]) {
        const rows=[stop(0,0),stop(5,3,false),stop(5.1,7,false),stop(5.2,4,false),stop(5.3,9,false),stop(5.4,2),stop(9,8)];
        const options={movementMode:'reach-centres',startBeforeMs:500,arriveAfterMs:1000};
        const segments=build(rows,rate,options);
        assert.equal(segments.journeys.length,2);assert.equal(segments.journeys[0].waypointCount,5);
        continuous(segments);
        for(let i=0;i<segments.length;i++) {
            const segment=segments[i],target=rows[i+1];
            close(segment.end,target.time+rate);close(segment.to,target.x);
            close(sample(rows,segment.end,rate,options).x,target.x);
            assert.equal(segment.timing.reachedCentre,true);
            for(let u=0;u<=1;u+=.02) {
                const out=at(segment,segment.start+(segment.end-segment.start)*u);
                assert.ok(out.x>=Math.min(segment.from,segment.to)-1e-9&&out.x<=Math.max(segment.from,segment.to)+1e-9);
            }
        }
        assert.ok(segments[0].v1>0,'advancing path has shared nonzero velocity');
        close(segments[1].v1,0);close(segments[2].v1,0);
        assert.equal(segments[1].timing.departureReason,'continuing-path');
        close(segments[1].timing.start,segments[0].end);
        assert.ok(segments[1].timing.appliedLeadMs<0,'continued travel is reported as starting after that lane');
    }
});

test('touching windows stay separate and arrive at rest without changing requested times',()=>{
    const rows=[stop(0,0),stop(5,4),stop(6,8)],options={startBeforeMs:500,arriveAfterMs:500};
    const segments=build(rows,1,options);
    assert.equal(segments.journeys.length,2);close(segments[0].end,segments[1].start);
    close(segments[0].v1,0);close(segments[1].v0,0);continuous(segments);
});

test('latest-destination interrupts from the exact x/v/a of its previous intended curve',()=>{
    for(const rate of [.5,1,1.5]) {
        const rows=[stop(0,0),stop(5,8),stop(5.2,-3),stop(5.4,6),stop(9,2)];
        const options={movementMode:'latest-destination',startBeforeMs:500,arriveAfterMs:1000};
        const segments=build(rows,rate,options);
        continuous(segments);
        for(let i=0;i<2;i++) {
            const segment=segments[i],next=segments[i+1];
            const uncut=motion.hwyCameraSegmentAt(segment.from,rows[i+1].x,segment.v0,0,
                segment.requestedEnd-segment.start,(segment.end-segment.start)/(segment.requestedEnd-segment.start),{},segment.a0,0);
            close(segment.end,rows[i+2].time-.5*rate);close(segment.to,uncut.x);close(segment.v1,uncut.velocity);close(segment.a1,uncut.acceleration);
            assert.equal(segment.timing.retargeted,true);assert.equal(segment.timing.reachedCentre,false);
            assert.equal(segment.timing.actualFirstLaneArrivalTime,null);assert.equal(segment.timing.actualArriveAfterMs,null);
            close(segment.timing.retargetTime,next.start);assert.notEqual(segment.to,rows[i+1].x);
            // Restricting the old quintic must retain its whole earlier path.
            for(const u of [.1,.3,.7,.9]) {
                const t=segment.start+(segment.end-segment.start)*u,actual=at(segment,t);
                const expected=motion.hwyCameraSegmentAt(segment.from,rows[i+1].x,segment.v0,0,
                    segment.requestedEnd-segment.start,(t-segment.start)/(segment.requestedEnd-segment.start),{},segment.a0,0);
                close(actual.x,expected.x,1e-8);close(actual.velocity,expected.velocity,1e-7);close(actual.acceleration,expected.acceleration,1e-6);
            }
        }
        const final=segments[2];close(final.end,5.4+rate);close(final.to,6);close(final.v1,0);close(final.a1,0);
        assert.equal(final.timing.reachedCentre,true);close(sample(rows,final.end,rate,options).x,6);
        assert.ok(segments[1].v0>0,'a reversal keeps existing momentum instead of jumping velocity');
    }
});

test('Absolution 1000 ms timing no longer reverts to hidden 400 ms departures',()=>{
    const rows=[stop(0,5),stop(15.359,7),stop(16.586,5),stop(17.070999,1),stop(19.246,10)];
    for(const movementMode of modes) {
        const segments=build(rows,1,{movementMode,startBeforeMs:25,arriveAfterMs:1000});
        close(segments[0].start,15.334);close(segments[0].end,16.359);
        close(segments[1].start,16.561);
        if(movementMode==='reach-centres') {
            close(segments[1].end,17.586);close(segments[2].start,17.586);close(segments[1].to,5);
        } else {
            close(segments[1].end,17.045999);close(segments[2].start,17.045999);
            assert.equal(segments[1].timing.retargeted,true);
        }
        close(segments[2].end,18.070999);
        assert.ok(segments.every(s=>s.timing.fallbackReason==='none'));
    }
});

test('initial availability is the only departure bound and is explicitly reported',()=>{
    for(const movementMode of modes) for(const rate of [.5,1,1.5]) {
        const rows=[stop(1,0),stop(1.2,3)],options={movementMode,startBeforeMs:700,arriveAfterMs:200};
        const [segment]=build(rows,rate,options);
        close(segment.start,1);close(segment.end,1.2+.2*rate);
        assert.equal(segment.timing.departureReason,'initial-availability');
        assert.equal(segment.timing.preparationLimitReason,'initial-availability');
        close(segment.timing.appliedLeadMs,.2/rate*1000);
    }
});

test('latest mode resolves several triggers before initial availability without NaNs or jumps',()=>{
    const rows=[stop(0,0),stop(.1,4),stop(.2,8),stop(.3,-2),stop(2,5)];
    for(const [startBeforeMs,arriveAfterMs] of [[1000,1000],[3000,0]]) {
    const options={movementMode:'latest-destination',startBeforeMs,arriveAfterMs};
    const segments=build(rows,1,options);
    for(const segment of segments){assert.ok(Number.isFinite(segment.from));assert.ok(Number.isFinite(segment.to));assert.ok(Number.isFinite(segment.a0));}
    assert.equal(segments[0].start,segments[0].end);assert.equal(segments[1].start,segments[1].end);
    close(sample(rows,0,1,options).x,0);
    const active=segments[2];assert.equal(active.timing.departureReason,'initial-availability');
    for(let t=0;t<=3;t+=.01){const p=sample(rows,t,1,options);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.velocity)&&Number.isFinite(p.acceleration));}
    }
});

test('dense latest reversals remain finite and C2 while the final target is reached exactly',()=>{
    for(const rate of [.5,1,1.5]) {
        const rows=[stop(0,0),...Array.from({length:250},(_,i)=>stop(5+i*.003, i%2?12:-12,false))];
        const options={movementMode:'latest-destination',startBeforeMs:25,arriveAfterMs:1000};
        const segments=build(rows,rate,options);continuous(segments);
        for(let i=0;i<segments.length;i++){
            const point=at(segments[i],(segments[i].start+segments[i].end)/2);
            assert.ok([point.x,point.velocity,point.acceleration].every(Number.isFinite));
            assert.ok(Math.abs(point.x)<=13.8,'retarget state stays close to target range across dense reversals');
        }
        const final=segments.at(-1),out=sample(rows,final.end,rate,options);
        close(out.x,rows.at(-1).x);close(out.velocity,0);close(out.acceleration,0);
    }
});

test('extreme timings and dense alternating or advancing target streams do not amplify retarget state',()=>{
    for(const rate of [.5,1,1.5]) for(const startBeforeMs of [25,3000]) for(const arriveAfterMs of [0,3000])
        for(const spacing of [.0001,.003,.1]) for(const alternating of [false,true]) {
            const rows=[stop(0,0),...Array.from({length:320},(_,i)=>stop(5+i*spacing,alternating?(i%2?12:-12):i%25))];
            const options={movementMode:'latest-destination',startBeforeMs,arriveAfterMs};
            const segments=build(rows,rate,options);
            for(const segment of segments) for(const u of [0,.25,.5,.75,1]) {
                const out=at(segment,segment.start+(segment.end-segment.start)*u);
                assert.ok([out.x,out.velocity,out.acceleration].every(Number.isFinite));
                assert.ok(Math.abs(out.x)<=(alternating?13.8:27.6),'bounded targets do not create escalating motion');
            }
            const final=segments.at(-1);close(sample(rows,final.end,rate,options).x,rows.at(-1).x);
        }
});

test('reported derivatives use real playback time across speeds and retarget boundaries',()=>{
    const rows=[stop(0,0),stop(5,8),stop(5.2,-3),stop(5.4,6)];
    for(const movementMode of modes) for(const rate of [.5,1,1.5]) {
        const options={movementMode,startBeforeMs:500,arriveAfterMs:1000};
        const segments=build(rows,rate,options),t=(segments[1].start+segments[1].end)/2,epsilon=1e-6;
        const a=sample(rows,t-epsilon*rate,rate,options),b=sample(rows,t+epsilon*rate,rate,options),mid=sample(rows,t,rate,options);
        close(mid.velocity,(b.x-a.x)/(2*epsilon),1e-6);
        close(mid.acceleration,(b.velocity-a.velocity)/(2*epsilon),1e-5);
    }
});

test('control and movement-mode cache keys use values while obsolete settings cannot rebuild a new path',()=>{
    const rows=[stop(0,0),stop(5,8),stop(5.2,2)],out={},options={startBeforeMs:500,arriveAfterMs:200};
    sample(rows,4.75,1,options,out);const first=rows.motion,report=out.timing;
    sample(rows,4.76,1,{...options,movementMode:'reach-centres'},out,legacySettings[3]);
    assert.equal(rows.motion,first);assert.equal(out.timing,report);
    options.movementMode='latest-destination';sample(rows,4.76,1,options,out);assert.notEqual(rows.motion,first);
    const second=rows.motion;options.startBeforeMs=700;sample(rows,4.76,1,options,out);assert.notEqual(rows.motion,second);
    const third=rows.motion;options.arriveAfterMs=400;sample(rows,4.76,1,options,out);assert.notEqual(rows.motion,third);
    const fourth=rows.motion;sample(rows,4.76,1,null,out);assert.notEqual(rows.motion,fourth);assert.equal(out.timing.mode,undefined);
});

test('cached sampling in both modes reuses outputs and diagnostics without walking chart stops',()=>{
    for(const movementMode of modes){
        let reads=0;
        const rows=Array.from({length:1000},(_,i)=>stop(i*.1,i%13));
        const stops=new Proxy(rows,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
        const options={movementMode,startBeforeMs:500,arriveAfterMs:1000},out={};
        sample(stops,49.05,1,options,out);assert.ok(reads>0);const cached=stops.motion,timing=out.timing;
        reads=0;
        for(let i=0;i<1000;i++){assert.equal(sample(stops,49.05+i/100000,1,options,out),out);assert.equal(stops.motion,cached);assert.equal(out.timing,timing);}
        assert.equal(reads,0);
    }
});

test('public bounds and invalid movement modes normalize to reach-centres defaults',()=>{
    const rows=[stop(0,0),stop(10,4)];
    const defaults=build(rows,1,{})[0].timing;
    assert.equal(defaults.requestedStartBeforeMs,700);assert.equal(defaults.requestedArriveAfterMs,0);assert.equal(defaults.mode,'reach-centres');
    const bounded=build(rows,1,{startBeforeMs:0,arriveAfterMs:99999,movementMode:'other'})[0].timing;
    assert.equal(bounded.requestedStartBeforeMs,25);assert.equal(bounded.requestedArriveAfterMs,3000);assert.equal(bounded.mode,'reach-centres');
    const invalid=build(rows,1,{startBeforeMs:NaN,arriveAfterMs:Infinity})[0].timing;
    assert.equal(invalid.requestedStartBeforeMs,700);assert.equal(invalid.requestedArriveAfterMs,0);
});

test('legacy callers keep their old schedule and metadata when the direct option is absent',()=>{
    const rows=[stop(0,0),stop(5,4,false),stop(5.2,8),stop(10,2)];
    for(const legacy of legacySettings){const a=build(rows,1,undefined,legacy),b=build(rows,1,null,legacy);assert.deepEqual(a,b);assert.equal(a[0].timing.mode,undefined);}
});
