const { test } = require('node:test');
const assert = require('node:assert/strict');
const {legacyCameraApi,harness} = require('../helpers/highway_camera_harness.cjs');
const {hwyBuildCameraMotion:motion,hwyCameraPlanAt:at,hwyBuildCameraStops:buildStops,
    hwyBuildCameraTimeline:timeline} = legacyCameraApi();
const row=(time,fret,lasting=true,width=4)=>({time,firstFret:fret,lastFret:fret+width-1,
    minX:(fret-1)*10,maxX:(fret+width-1)*10,normalWidth:40,x:(fret+1)*10,preferred:(fret+1)*10,lasting});
const clone=rows=>rows.map(r=>({...r}));
const near=(actual,expected,message='')=>assert.ok(Math.abs(actual-expected)<1e-9,
    message+' expected '+expected+', got '+actual);
const sample=(rows,time,{rate=1,smoothing=.5,delay=100,extra=10,cap=250,long=5}={})=>
    at(rows,time,rate,smoothing,undefined,delay,extra,cap,long);
const build=(rows,threshold=500,context=null)=>buildStops(rows,1,null,null,null,null,context,threshold);

// Frozen pre-tuning evaluator from 3514086. This checks exact compatibility
// independently of the new scheduling and tuning implementation.
function legacyMotion(stops, rate, smoothing) {
        const segments = [];
        const base = 0.6 + Math.max(0, Math.min(1, smoothing)) * 0.2;
        let first = 0;
        while (first + 1 < stops.length) {
            let last = first + 1;
            while (last + 1 < stops.length && stops[last].lasting === false) last++;
            const from = stops[first], entry = stops[first + 1];
            const width = Math.max(1e-8, from.maxX - from.minX, entry.maxX - entry.minX);
            const extra = Math.min(0.4, Math.max(0, Math.abs(entry.x - from.x) / width - 1) * 0.8);
            const lead = Math.max(entry.lead || 0.6, base + extra);
            const start = Math.max(from.time, entry.time - lead * rate);
            const points = [{ time: start, x: from.x, velocity: 0 }];
            for (let i = first + 1; i <= last; i++) points.push({ time: stops[i].time, x: stops[i].x, velocity: 0 });
            for (let i = 1; i + 1 < points.length; i++) {
                const left = (points[i].x - points[i - 1].x) / Math.max(1e-9, points[i].time - points[i - 1].time);
                const right = (points[i + 1].x - points[i].x) / Math.max(1e-9, points[i + 1].time - points[i].time);
                if (left * right > 0) points[i].velocity = Math.sign(left) * Math.min(Math.abs(left), Math.abs(right));
            }
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i];
                if (b.time > a.time) segments.push({ start: a.time, end: b.time,
                    from: a.x, to: b.x, v0: a.velocity, v1: b.velocity, lasting: i === points.length - 1 });
            }
            first = last;
        }
        return segments;
    }

function legacySegmentAt(from, to, v0, v1, duration, u, out) {
        u = Math.max(0, Math.min(1, u));
        const delta = to - from, a = v0 * duration, b = v1 * duration;
        const c3 = 10 * delta - 6 * a - 4 * b;
        const c4 = -15 * delta + 8 * a + 7 * b;
        const c5 = 6 * delta - 3 * a - 3 * b;
        out.x = from + u * (a + u * u * (c3 + u * (c4 + u * c5)));
        out.velocity = (a + u * u * (3 * c3 + u * (4 * c4 + u * 5 * c5))) / duration;
        if (u === 1) { out.x = to; out.velocity = v1; }
        return out;
    }

function legacyAt(stops, now, rate, smoothing, out) {
        out = out || {};
        rate = Math.max(0.1, Math.min(4, Number(rate) || 1));
        if (!stops.motion || stops.motionRate !== rate || stops.motionSmoothing !== smoothing) {
            stops.motion = legacyMotion(stops, rate, smoothing);
            stops.motionRate = rate; stops.motionSmoothing = smoothing;
        }
        const motion = stops.motion;
        let lo = 0, hi = motion.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (motion[mid].end <= now) lo = mid + 1;
            else hi = mid;
        }
        const segment = motion[lo];
        if (segment && now >= segment.start) {
            const duration = segment.end - segment.start;
            legacySegmentAt(segment.from, segment.to, segment.v0, segment.v1,
                duration, (now - segment.start) / duration, out);
            out.velocity *= rate;
        } else {
            out.x = motion[lo - 1]?.to ?? stops[0]?.x ?? 0;
            out.velocity = 0;
        }
        out.valid = stops.length > 0;
        return out;
    }

test('zero timing controls preserve the pre-tuning trajectory bit for bit',()=>{
    const cases=[[],[row(0,1)],[row(0,1),row(4,5)],[row(0,1),row(4,17)],
        [row(0,17),row(4,1),row(6,12)],
        [row(0,1),row(4,7,false),row(4.2,11,false),row(4.4,17)],
        [row(0,1),row(4,17),row(4.6,3),row(5.1,10)]];
    for(const rate of [.5,1,2]) for(const smoothing of [0,.5,1]) for(const rows of cases) {
        const before=clone(rows),after=clone(rows);
        for(let i=0;i<=300;i++) {
            const time=i/37,expected=legacyAt(before,time,rate,smoothing);
            const actual=sample(after,time,{rate,smoothing,delay:0,extra:0,cap:0});
            assert.equal(actual.x,expected.x);assert.equal(actual.velocity,expected.velocity);
            assert.equal(actual.valid,expected.valid);
        }
    }
});

test('the default direct journey departs 100ms later and takes 10 percent longer in real time',()=>{
    for(const rate of [.5,1,2]) {
        const rows=[row(0,1),row(4,17)],old=motion(rows,rate,.5,0,0,0,5)[0];
        const tuned=motion(rows,rate,.5,100,10,250,5)[0];
        near((tuned.start-old.start)/rate,.1);
        near((tuned.end-tuned.start)/(old.end-old.start),1.1);
        near((tuned.end-old.end)/rate,.21);
        assert.equal(sample(rows,old.start,{rate}).x,20);
        const arrival=sample(rows,tuned.end,{rate});
        assert.equal(arrival.x,180);assert.equal(arrival.velocity,0);
    }
});

test('delay and added travel can be changed independently',()=>{
    const rows=[row(0,1),row(4,17)],old=motion(rows,1,.5,0,0,0,5)[0];
    const delay=motion(rows,1,.5,100,0,250,5)[0],extra=motion(rows,1,.5,0,10,250,5)[0];
    near(delay.start-old.start,.1);near(delay.end-old.end,.1);
    assert.equal(extra.start,old.start);near(extra.end-old.end,.11);
});

test('expanded timing limits produce a one-second delay, triple travel duration and up to three seconds of settling',()=>{
    for(const rate of [.5,1,2]) for(const direction of [1,-1]) {
        const rows=direction>0?[row(0,1),row(4,17)]:[row(0,17),row(4,1)];
        const old=motion(rows,rate,.5,0,0,0,5)[0];
        const delayed=motion(rows,rate,.5,1000,0,3000,5)[0];
        near((delayed.start-old.start)/rate,1);
        near(delayed.end-delayed.start,old.end-old.start);
        const slower=motion(rows,rate,.5,0,200,3000,5)[0];
        assert.equal(slower.start,old.start);
        near((slower.end-slower.start)/(old.end-old.start),3);
        near((slower.end-old.end)/rate,2.2);
        const maximum=motion(rows,rate,.5,1000,200,3000,5)[0];
        near((maximum.end-old.end)/rate,3);
        near((maximum.start-old.start)/rate,.8,
            'the full 2.2 seconds of extra travel has priority over departure delay');
        near((maximum.end-maximum.start)/(old.end-old.start),3);
        let previous=rows[0].x;
        for(let i=0;i<=200;i++) {
            const state=sample(rows,maximum.start+(maximum.end-maximum.start)*i/200,
                {rate,delay:1000,extra:200,cap:3000});
            assert.ok(direction*(state.x-previous)>=-1e-8,'extreme tuning must not reverse');
            assert.ok(direction*(rows[1].x-state.x)>=-1e-8,'extreme tuning must not overshoot');
            previous=state.x;
        }
        assert.equal(previous,rows[1].x);
        assert.equal(sample(rows,maximum.end,{rate,delay:1000,extra:200,cap:3000}).velocity,0);
    }
});

test('the settling limit caps lateness without shortening or accelerating the original move',()=>{
    for(const rate of [.5,1,2]) for(const cap of [0,25,100,250,400]) {
        const rows=[row(0,1),row(4,17)],old=motion(rows,rate,.5,0,0,0,5)[0];
        const tuned=motion(rows,rate,.5,200,30,cap,5)[0];
        assert.ok(tuned.start>=old.start);
        assert.ok(tuned.end-tuned.start>=old.end-old.start-1e-10);
        assert.ok((tuned.end-old.end)/rate<=cap/1000+1e-10);
        near((tuned.end-old.end)/rate,cap/1000);
        let previous=20,peak=0;
        for(let i=0;i<=300;i++) {
            const state=sample(rows,tuned.start+(tuned.end-tuned.start)*i/300,
                {rate,delay:200,extra:30,cap});
            assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8);
            peak=Math.max(peak,state.velocity);previous=state.x;
        }
        const nominalPeak=sample(clone(rows),(old.start+old.end)/2,{rate,delay:0,extra:0,cap:0}).velocity;
        assert.ok(peak<=nominalPeak+1e-8,'tuning must not make the pan faster');
    }
});

test('a tight following move limits tuning rather than overlapping or rushing either segment',()=>{
    for(const rate of [.5,1,2]) for(const nextTime of [4.5,5.15,6,8,12]) {
        const rows=[row(0,1),row(4,17),row(nextTime,1)];
        const nominal=motion(rows,rate,.5,0,0,0,5),tuned=motion(rows,rate,.5,1000,200,3000,5);
        assert.ok(tuned[0].end<=nominal[1].start+1e-10);
        assert.ok(tuned[1].start>=tuned[0].end-1e-10);
        for(let i=0;i<tuned.length;i++) {
            assert.ok(tuned[i].end-tuned[i].start>=nominal[i].end-nominal[i].start-1e-10);
        }
        if(nextTime===4.5) {
            assert.equal(tuned[0].start,nominal[0].start);
            assert.equal(tuned[0].end,nominal[0].end);
        }
        if(nextTime===5.15&&rate===1) near(tuned[0].end,4.05);
    }
});

test('every followed direct journey is tuned independently of the retired minimum fret-change gate',()=>{
    for(const threshold of [1,5,12,23,24]) for(const difference of [1,4,5,11,12,22,23]) {
        const rows=[row(0,1),row(4,1+difference)];
        const old=motion(rows,1,.5,0,0,0,threshold)[0];
        const tuned=motion(rows,1,.5,100,10,250,threshold)[0];
        assert.ok(tuned.start>old.start&&tuned.end>old.end,
            `a followed ${difference}-fret move must not be gated by the saved ${threshold}-fret value`);
        assert.deepEqual(tuned,motion(rows,1,.5,100,10,250,1)[0]);
    }
    const extended=[row(0,1,true,12),row(4,6,true,12)];
    assert.ok(motion(extended,1,.5,100,10,250,24)[0].end>4,
        'a wider riff extent must not prevent timing a followed relocation');
});

test('progressive journeys retime their complete path with shared waypoint velocity and no intermediate holds',()=>{
    const rows=[row(0,1),row(4,9,false),row(4.2,13,false),row(4.4,21)];
    for(const rate of [.5,1,2]) for(const extra of [0,10,200]) {
        const nominal=motion(rows,rate,.5,0,0,0,5);
        const tuned=motion(rows,rate,.5,1000,extra,3000,24);
        assert.equal(tuned.length,nominal.length);
        assert.ok(tuned[0].start>=nominal[0].start);
        const stretch=(tuned.at(-1).end-tuned[0].start)/(nominal.at(-1).end-nominal[0].start);
        assert.ok(stretch>=1-1e-10&&stretch<=1+extra/100+1e-10);
        if(extra<=10) {
            assert.ok(tuned[0].start>nominal[0].start);
            near(stretch,1+extra/100);
        } else assert.ok(stretch>1,'a longer journey may exhaust the cap on extra travel alone');
        for(let i=0;i<tuned.length;i++) {
            const a=nominal[i],b=tuned[i],duration=a.end-a.start,tunedDuration=b.end-b.start;
            assert.equal(b.nominalStart,a.start);assert.equal(b.nominalEnd,a.end);
            near(tunedDuration/duration,stretch);
            near(b.v0,a.v0/stretch);near(b.v1,a.v1/stretch);
            if(i) {
                assert.equal(b.start,tuned[i-1].end);
                near(b.v0,tuned[i-1].v1);
                assert.ok(b.v0>0,'a progressive waypoint must retain forward velocity');
            }
            let previous=b.from;
            for(const u of [0,.1,.25,.5,.75,.9,1]) {
                const before=sample(clone(rows),a.start+duration*u,{rate,delay:0,extra:0,cap:0});
                const after=sample(clone(rows),b.start+tunedDuration*u,
                    {rate,delay:1000,extra,cap:3000,long:24});
                near(after.x,before.x);near(after.velocity,before.velocity/stretch);
                assert.ok(after.x>=previous-1e-8&&after.x<=b.to+1e-8);
                previous=after.x;
            }
        }
        assert.equal(sample(rows,tuned.at(-1).end,{rate,delay:1000,extra,cap:3000}).velocity,0);
    }
});

test('the Absolution jump caps one-second departure at 140ms without reducing its requested extra travel',()=>{
    // Preserve the measured jump and following-journey deadline from the
    // inspected loop; the intermediate rows merely establish that deadline.
    const rows=[row(0,1),row(50.723,10),row(51.707001,9,false),row(51.907001,8)];
    const nominal=motion(rows,1,.5,0,0,0,5);
    const immediate=motion(rows,1,.5,0,10,250,5);
    const delayed=motion(rows,1,.5,1000,10,250,5);
    near(nominal[0].start,49.623);near(nominal[1].start,51.007001);
    near(immediate[0].start,49.623);near(immediate[0].end,50.833);
    near(delayed[0].start,49.763);near(delayed[0].end,50.973);
    near(delayed[0].end-delayed[0].start,1.210);
    near(delayed[0].end-delayed[0].start,immediate[0].end-immediate[0].start);
    assert.ok(delayed[0].end<=nominal[1].start);
});

test('increasing departure delay never steals reserved travel time on direct or multi-lane journeys',()=>{
    const fixtures=[
        [row(0,1),row(4,17)],
        [row(0,10),row(4,9,false),row(4.2,8)],
        [row(0,7),row(4,5,false),row(4.2,1),row(5.5,17)],
        [row(0,1),row(4,9,false),row(4.2,13,false),row(4.4,21),row(5.6,17)],
    ];
    for(const rows of fixtures) for(const rate of [.5,1,2]) for(const cap of [0,25,250,3000]) {
        const immediate=motion(rows,rate,.5,0,10,cap,5);
        for(const delay of [100,500,1000]) {
            const delayed=motion(rows,rate,.5,delay,10,cap,24);
            for(let i=0;i<delayed.length;i++) {
                const a=immediate[i],b=delayed[i];
                near(b.end-b.start,a.end-a.start,'departure must not accelerate a pan');
                near(b.v0,a.v0);near(b.v1,a.v1);
                assert.ok(b.start>=a.start-1e-10&&b.end>=a.end-1e-10);
            }
        }
    }
});

test('every waypoint respects its settling deadline without consuming the following journey departure time',()=>{
    for(const rate of [.5,1,2]) for(const cap of [0,25,250,3000]) for(const nextTime of [4.5,5.15,6,8,12]) {
        const rows=[row(0,1),row(4,9,false),row(4.2,13,false),row(4.4,21),
            row(nextTime,17,false),row(nextTime+.2,12)];
        const nominal=motion(rows,rate,.5,0,0,0,5);
        const tuned=motion(rows,rate,.5,1000,200,cap,24);
        assert.equal(tuned.length,5);
        assert.ok(tuned[2].end<=nominal[3].start+1e-10,
            'a journey cannot borrow time from the following journey');
        for(let i=0;i<tuned.length;i++) {
            const a=nominal[i],b=tuned[i];
            assert.equal(b.nominalStart,a.start);assert.equal(b.nominalEnd,a.end);
            assert.ok(b.start>=a.start-1e-10&&b.end>=a.end-1e-10);
            assert.ok((b.end-a.end)/rate<=cap/1000+1e-10,
                'intermediate waypoints have the same hard lateness bound as the destination');
            assert.ok(b.end-b.start>=a.end-a.start-1e-10);
            if(i) assert.ok(b.start>=tuned[i-1].end-1e-10);
        }
        if(nextTime===4.5) {
            for(let i=0;i<3;i++) {
                assert.equal(tuned[i].start,nominal[i].start);
                assert.equal(tuned[i].end,nominal[i].end);
            }
        }
    }
});

test('a tuned all-short climb and descent preserves every lane and reverses smoothly without waiting for a lasting lane',()=>{
    const frets=[1,2,4,6,8,10,12,14,16,18,20,22,24,23,21,19,17,15,13,11,9,7,5,3,1];
    const rows=frets.map((f,i)=>row(i?2+(i-1)*.2:0,f));
    for(const rate of [.5,1,2]) {
        const stops=buildStops(rows,rate,null,null,null,null,null,500);
        assert.deepEqual(stops.map(stop=>stop.firstFret),frets);
        assert.ok(stops.slice(1,-1).every(stop=>!stop.lasting));
        const nominal=motion(stops,rate,.5,0,0,0,5);
        const tuned=motion(stops,rate,.5,1000,10,250,24);
        assert.equal(tuned.length,frets.length-1);
        const stretch=(tuned.at(-1).end-tuned[0].start)/(nominal.at(-1).end-nominal[0].start);
        assert.ok(stretch>1);
        for(let i=0;i<tuned.length;i++) {
            const segment=tuned[i],direction=Math.sign(segment.to-segment.from);
            assert.equal(segment.from,stops[i].x);assert.equal(segment.to,stops[i+1].x);
            near(segment.v0,nominal[i].v0/stretch);near(segment.v1,nominal[i].v1/stretch);
            assert.ok((segment.end-nominal[i].end)/rate<=.25+1e-10);
            if(i) {
                assert.equal(segment.start,tuned[i-1].end);
                near(segment.v0,tuned[i-1].v1);
                const reverses=Math.sign(tuned[i-1].to-tuned[i-1].from)!==direction;
                if(reverses) assert.equal(segment.v0,0);
                else assert.ok(direction*segment.v0>0,'only an actual turn may stop lateral motion');
            }
            let previous=segment.from;
            for(let step=0;step<=20;step++) {
                const time=segment.start+(segment.end-segment.start)*step/20;
                const state=sample(stops,time,{rate,delay:1000,extra:10,cap:250,long:24});
                assert.ok(direction*(state.x-previous)>=-1e-8,'no reversal between waypoints');
                assert.ok(direction*(segment.to-state.x)>=-1e-8,'no waypoint overshoot');
                previous=state.x;
            }
        }
        assert.equal(sample(stops,tuned.at(-1).end,{rate,delay:1000,extra:10,cap:250}).x,stops.at(-1).x);
    }
});

test('tuning preserves the normalized curve and zero endpoint velocity and acceleration',()=>{
    const rows=[row(0,1),row(4,17)],old=motion(rows,1,.5,0,0,0,5)[0];
    const tuned=motion(rows,1,.5,100,10,250,5)[0];
    for(const u of [0,.1,.25,.5,.75,.9,1]) {
        const a=sample(clone(rows),old.start+(old.end-old.start)*u,{delay:0,extra:0,cap:0});
        const b=sample(rows,tuned.start+(tuned.end-tuned.start)*u);
        near(a.x,b.x);near(a.velocity*(old.end-old.start)/(tuned.end-tuned.start),b.velocity);
    }
    for(const time of [tuned.start,tuned.end]) {
        const epsilon=1e-6,left=sample(rows,time-epsilon),middle=sample(rows,time),right=sample(rows,time+epsilon);
        assert.equal(middle.velocity,0);
        assert.ok(Math.abs((right.velocity-left.velocity)/(2*epsilon))<.02);
    }
});

test('late-tail evaluation reports its actual remaining destination',()=>{
    const rows=[row(0,1),row(4,17),row(8,5)];
    const result=sample(rows,4.1);
    assert.ok(result.x<180&&result.velocity>0);
    near(result.arrivalTime,4.21);assert.equal(result.arrivalX,180);
    const after=sample(rows,4.22);
    assert.ok(after.arrivalTime>8&&after.arrivalX===60);
});

test('the cached timing report exposes actual real-time delay, reserved travel and the limiting deadline',()=>{
    for(const rate of [.5,1,2]) {
        const rows=[row(0,1),row(4,17),row(20,5)];
        const result=sample(rows,4,{rate,delay:1000,extra:10,cap:250});
        const timing=result.timing;
        near(timing.requestedDelayMs,1000);near(timing.appliedDelayMs,140);
        near(timing.requestedExtraMs,110);near(timing.appliedExtraMs,110);
        assert.equal(timing.limitingReason,'settling-limit');
        assert.equal(timing.nominalEnd,4);near(timing.end,4+.25*rate);
        near((timing.start-timing.nominalStart)/rate,.14);
        assert.equal(result.arrivalLaneTime,4);near(result.arrivalTime,timing.end);
        assert.equal(rows.motion[0].timing,timing);
        assert.equal(sample(rows,0,{rate,delay:1000,extra:10,cap:250}).timing,timing,
            'a held pose reports the next scheduled journey before departure');
        const unbounded=sample(clone(rows),4,{rate,delay:100,extra:10,cap:250}).timing;
        assert.equal(unbounded.limitingReason,'none');near(unbounded.appliedDelayMs,100);
    }
    const tight=[row(0,10),row(4,9,false),row(4.2,8),row(4.937999,7)];
    const result=sample(tight,4,{delay:1000,extra:10,cap:250});
    const timing=result.timing;
    near(timing.appliedDelayMs,0);near(timing.appliedExtraMs,37.999);
    assert.equal(timing.limitingReason,'next-journey');
    assert.equal(tight.motion[1].timing,timing,
        'one shared report describes the complete journey through both short lanes');
    assert.equal(result.arrivalLaneTime,4.2);
    assert.equal(sample(tight,100,{delay:1000,extra:10,cap:250}).timing,null);
});

test('the excursion control measures each original lane duration independently of speed and trip length',()=>{
    const rows=[row(0,1),row(2,7),row(2.2,9),row(2.45,1),row(2.65,7),row(2.85,9),row(3.1,1)];
    for(const threshold of [0,200,250,300,400,450,500,1000]) for(const rate of [.5,1,2]) {
        const stops=buildStops(rows,rate,null,null,null,null,null,threshold);
        if(threshold>250) assert.deepEqual(stops.map(s=>s.firstFret),[1]);
        else assert.ok(stops.length>1,'an individual lane reaching the cutoff must be followed');
    }
});

test('a three-second threshold holds longer complete returns but follows an individual lane at the exact boundary',()=>{
    for(const duration of [1.001,2.5,2.999,3]) for(const rate of [.5,1,2]) {
        const rows=[row(0,1),row(5,7),row(5+duration,9),row(5+duration*2,1),
            row(5+duration*3,7),row(5+duration*4,9),row(5+duration*5,1)];
        const stops=buildStops(rows,rate,null,null,null,null,null,3000);
        if(duration<3) assert.deepEqual(stops.map(s=>s.firstFret),[1],
            'the expanded value must not silently retain the old one-second cap');
        else assert.ok(stops.length>1,'exactly three source seconds is followed at every playback speed');
        const ordinary=buildStops(rows,rate,null,null,null,null,null,500);
        assert.ok(ordinary.length>1,'the wider control is a real classification choice');
    }
});

test('zero brief-excursion tolerance retains same-base and proven riff-variation protection',()=>{
    const extended=build([row(0,5),row(2,5,true,8),row(4,5)],0);
    assert.deepEqual(extended.map(s=>s.firstFret),[5]);
    const notes=[];
    for(const start of [0,4,8]) notes.push({t:start+.2,s:0,f:5,sus:0},
        {t:start+1,s:1,f:start===4?13:7,sus:1.2},{t:start+3,s:0,f:5,sus:0});
    const context={notes,chords:[],beats:[0,4,8,12].map((time,measure)=>({time,measure})),
        sections:[{time:0,name:'riff'}]};
    const stops=build([row(0,5),row(5,13),row(6.2,5)],0,context);
    assert.deepEqual(stops.map(s=>s.firstFret),[5]);
    assert.equal(stops.timeline[1].kind,'riff-variation');
});

const gentle={departureDelay:100,travelExtra:10,settleLimit:250,excursionThreshold:500,longSwitchFrets:5};
function controller(preset='straight') {
    const h=harness();h.settings({...gentle,preset,rate:1,startBeforeMs:700,arriveAfterMs:210});
    h.setRegionTimeline([{time:0,minX:0,maxX:40},{time:4,minX:160,maxX:200}]);
    h.frame(0,0);return h;
}
function advance(h,from,to,rate=1) {
    const steps=Math.max(1,Math.ceil((to-from)/rate*120));let state,previous=from;
    for(let i=1;i<=steps;i++) {const time=from+(to-from)*i/steps;state=h.frame(time,(time-previous)/rate);previous=time;}
    return state;
}
function journeyController(preset='straight',rate=1) {
    const h=harness();h.settings({...gentle,preset,rate});
    h.setRegionTimeline([row(0,1),row(4,5),row(4.2,9),row(4.4,13),row(4.6,17)]);
    h.frame(0,0);return h;
}

test('direct timing edits rebuild motion without reclassifying lanes or reprojecting geometry',()=>{
    const h=controller(),cache=h.planCache();
    const semantic=cache.semanticStops,timeline=cache.timeline,regions=cache.regions,attacks=cache.attacks;
    const objects=regions.slice(),stops=cache.stops;
    for(const settings of [{movementMode:'latest-destination'},{movementMode:'reach-centres'},
        {startBeforeMs:1000},{arriveAfterMs:0},
        {startBeforeMs:25},{arriveAfterMs:3000},{startBeforeMs:1500},{arriveAfterMs:210}]) {
        const oldMotion=cache.stops.motion,revision=cache.revision;
        h.settings(settings);h.frame(0,0);
        assert.equal(cache.semanticStops,semantic);assert.equal(cache.timeline,timeline);
        assert.equal(cache.regions,regions);assert.ok(regions.every((r,i)=>r===objects[i]));
        assert.equal(cache.attacks,attacks);assert.equal(cache.stops,stops);
        assert.notEqual(cache.stops.motion,oldMotion);assert.ok(cache.revision>revision);
        const motion=cache.stops.motion,stableRevision=cache.revision;
        for(let i=0;i<10;i++) h.frame(0,0);
        assert.equal(cache.stops.motion,motion);assert.equal(cache.revision,stableRevision);
    }
});

test('live direct timing edits preserve pose and velocity before reaching the scheduled destination',()=>{
    for(const preset of ['straight','angled']) for(const rate of [.5,1,2]) {
        const h=controller(preset);h.settings({rate});h.frame(0,0);
        let before=advance(h,0,3.8,rate);
        const cache=h.planCache(),semantic=cache.semanticStops,regions=cache.regions;
        for(const settings of [{movementMode:'latest-destination'},{movementMode:'reach-centres'},
            {startBeforeMs:1000},{startBeforeMs:25},
            {startBeforeMs:3000},{arriveAfterMs:500},{startBeforeMs:700,arriveAfterMs:210}]) {
            h.settings(settings);
            const after=h.frame(3.8,0);
            near(after.x,before.x,'direct timing edit preserves position');
            near(after.planVelocity+after.rejoinVelocity,before.planVelocity+before.rejoinVelocity,
                'direct timing edit preserves velocity');
            assert.equal(cache.semanticStops,semantic);assert.equal(cache.regions,regions);
            before=after;
        }
        const arrival=cache.stops.motion.at(-1).end;
        const state=advance(h,3.8,arrival+.1*rate,rate);
        near(state.x,180);near(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('live mode timing edits cannot retain an obsolete late arrival over a new moving path',()=>{
    const rows=[{time:0,minX:0,maxX:40},{time:5,minX:80,maxX:120},
        {time:5.8,minX:20,maxX:60},{time:6.2,minX:100,maxX:140}];
    for(const preset of ['straight','angled']) for(const movementMode of ['reach-centres','latest-destination']) {
        const h=harness();
        h.settings({preset,movementMode,excursionThreshold:0,startBeforeMs:25,arriveAfterMs:500});
        h.setRegionTimeline(rows);h.frame(0,0);
        const before=advance(h,0,5.05);
        assert.ok(before.planMoving,'fixture is travelling through the former arrival tail');
        h.settings({startBeforeMs:700,arriveAfterMs:0});
        const changed=h.frame(5.05,0);
        near(changed.x,before.x,'live edit preserves position');
        near(changed.planVelocity+changed.rejoinVelocity,before.planVelocity+before.rejoinVelocity,
            'live edit preserves velocity');
        const justBefore=advance(h,5.05,5.5-1e-7);
        const atOldDeadline=h.frame(5.5,1e-7);
        assert.ok(Math.abs(atOldDeadline.x-justBefore.x)<.001,
            `${preset}/${movementMode}: obsolete arrival cannot create a position jump`);
        const settled=advance(h,5.5,6.3);
        near(settled.x,120,'controller rejoins the new final destination');
        near(settled.planVelocity+settled.rejoinVelocity,0);
    }
});

test('retired minimum fret-change settings do not invalidate the live cached plan',()=>{
    const h=controller(),cache=h.planCache();
    const motion=cache.stops.motion,revision=cache.revision,semantic=cache.semanticStops;
    for(const longSwitchFrets of [1,12,24,5]) {
        h.settings({longSwitchFrets});h.frame(0,0);
        assert.equal(cache.stops.motion,motion);assert.equal(cache.revision,revision);
        assert.equal(cache.semanticStops,semantic);
    }
});

test('excursion changes intentionally rebuild semantics while retaining projected shapes and attack evidence',()=>{
    const h=harness();h.settings(gentle);
    h.setRegionTimeline([{time:0,minX:0,maxX:40},{time:2,minX:60,maxX:100},{time:2.6,minX:0,maxX:40}]);
    h.frame(0,0);
    const cache=h.planCache(),oldSemantic=cache.semanticStops,regions=cache.regions,attacks=cache.attacks;
    assert.equal(oldSemantic.length,3);
    h.settings({excursionThreshold:1000});h.frame(0,0);
    assert.notEqual(cache.semanticStops,oldSemantic);assert.equal(cache.semanticStops.length,1);
    assert.equal(cache.regions,regions);assert.equal(cache.attacks,attacks);
});

test('both movement modes preserve repeated-riff and same-base extension filtering at every speed',()=>{
    const rows=[{time:0,minX:40,maxX:80},{time:2,minX:40,maxX:110}];
    for(let i=0;i<24;i++) {
        const fret=[8,7,4,5][i%4];
        rows.push({time:4+i*.3,minX:(fret-1)*10,maxX:(fret+3)*10});
    }
    rows.push({time:12,minX:40,maxX:80});
    for(const preset of ['straight','angled']) for(const movementMode of ['reach-centres','latest-destination']) {
        for(const rate of [.5,1,2]) {
            const h=harness();h.settings({preset,movementMode,rate,excursionThreshold:500});
            h.setRegionTimeline(rows);
            const initial=h.frame(0,0);
            for(let i=1;i<=240;i++)near(h.frame(i/20,1/20/rate).x,initial.x,
                `${preset}/${movementMode}/${rate}: held riff retains home`);
            assert.ok(h.planCache().semanticStops.every(stop=>stop.x===initial.x));
            h.settings({excursionThreshold:250});h.frame(12,0);
            assert.ok(h.planCache().semanticStops.some(stop=>stop.x!==initial.x),
                'the movement policy cannot suppress lanes that meet the original-song threshold');
        }
    }
});

test('both Stable presets honor direct start and arrival in real playback time',()=>{
    for(const preset of ['straight','angled']) for(const rate of [.5,1,2]) {
        const h=controller(preset);h.settings({rate});h.frame(0,0);
        const segment=h.planCache().stops.motion[0];
        near(segment.start,4-.7*rate);near(segment.end,4+.21*rate);
        const atOnset=advance(h,0,4,rate);
        assert.ok(atOnset.x<180,'a requested late arrival must still be travelling at the lane onset');
        const state=advance(h,4,4+.21*rate,rate);
        assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('both Stable presets play every tuned progressive waypoint at multiple speeds',()=>{
    for(const preset of ['straight','angled']) for(const rate of [.5,1,2]) {
        const h=journeyController(preset,rate),cache=h.planCache(),segments=cache.stops.motion;
        assert.equal(segments.length,4);
        let time=0;
        for(let i=0;i<segments.length;i++) {
            const segment=segments[i],state=advance(h,time,segment.end,rate);
            near(state.x,segment.to);
            if(i+1<segments.length) assert.ok(state.planVelocity+state.rejoinVelocity>0,
                'ordinary traversal must not pause at an intermediate lane');
            else near(state.planVelocity+state.rejoinVelocity,0);
            time=segment.end;
        }
        assert.deepEqual(cache.semanticStops.map(stop=>stop.firstFret),[1,5,9,13,17]);
        assert.deepEqual(cache.semanticStops.map(stop=>stop.time),[0,4,4.2,4.4,4.6]);
    }
});

test('live journey timing edits preserve the current pose and velocity before rejoining the complete path',()=>{
    for(const preset of ['straight','angled']) {
        const h=journeyController(preset);let time=3.85,state=advance(h,0,time);
        const semantic=h.planCache().semanticStops;
        for(const settings of [{departureDelay:1000},{departureDelay:0},
            {travelExtra:30},{travelExtra:10,departureDelay:100}]) {
            const before=state;h.settings(settings);state=h.frame(time,0);
            near(state.x,before.x);near(state.planVelocity+state.rejoinVelocity,
                before.planVelocity+before.rejoinVelocity);
            assert.equal(h.planCache().semanticStops,semantic);
            state=advance(h,time,time+.02);time+=.02;
        }
        const end=h.planCache().stops.motion.at(-1).end;
        state=advance(h,time,end);
        near(state.x,180);near(state.planVelocity+state.rejoinVelocity,0);
        assert.deepEqual(semantic.map(stop=>stop.firstFret),[1,5,9,13,17]);
    }
});

test('pause, follow and speed changes preserve a tuned progressive journey and settle at its actual arrival',()=>{
    for(const preset of ['straight','angled']) for(const change of ['pause','follow-off','slower','faster']) {
        const h=journeyController(preset),before=advance(h,0,4.03);let rate=1,time=4.03;
        if(change==='pause'||change==='follow-off') {
            if(change==='follow-off') {h.settings({follow:false});time+=.03;}
            assert.equal(h.frame(time,.03,change!=='pause').x,before.x);
            h.settings({follow:true});
        } else {
            rate=change==='slower'?.5:2;h.settings({rate});
        }
        let state=h.frame(time,0,true);
        near(state.x,before.x);
        if(change==='slower'||change==='faster') near(state.planVelocity+state.rejoinVelocity,
            before.planVelocity+before.rejoinVelocity);
        const end=h.planCache().stops.motion.at(-1).end;
        state=advance(h,time,end,rate);
        near(state.x,180);near(state.planVelocity+state.rejoinVelocity,0);
        assert.deepEqual(h.planCache().semanticStops.map(stop=>stop.firstFret),[1,5,9,13,17]);
    }
});

test('loop wraps and seeks discard a live timing correction and match a fresh tuned journey',()=>{
    for(const preset of ['straight','angled']) for(const target of [1,4.4,7]) {
        const h=journeyController(preset);advance(h,0,4.03);
        h.settings({departureDelay:1000});h.frame(4.03,0);advance(h,4.03,4.05);
        if(target>4.05) h.settings({epoch:2});
        const sought=h.frame(target,.01),freshController=journeyController(preset);
        freshController.settings({departureDelay:1000});
        const fresh=freshController.frame(target,.01);
        near(sought.x,fresh.x);near(sought.distance,fresh.distance);
        assert.equal(sought.resumeUntil,-Infinity);assert.equal(sought.rejoinEnd,-Infinity);
    }
});

test('pause and follow changes in the late tail settle at the actual scheduled arrival',()=>{
    for(const preset of ['straight','angled']) for(const hold of ['pause','follow-off']) {
        const h=controller(preset),before=advance(h,0,4.05);
        let time=4.05;
        if(hold==='follow-off') {h.settings({follow:false});time=4.08;}
        const held=h.frame(time,.03,hold!=='pause');assert.equal(held.x,before.x);
        h.settings({follow:true});let state=h.frame(time,0,true),previous=state.x;
        assert.equal(state.x,before.x);
        for(let i=1;i<=40;i++) {
            const next=time+(4.21-time)*i/40;
            state=h.frame(next,(4.21-time)/40);
            assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8,`${preset}/${hold}: late resume reversed or overshot`);
            previous=state.x;
        }
        assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('rate changes within the late tail preserve pose and converge to the rescheduled arrival',()=>{
    for(const rate of [.5,2]) {
        const h=controller(),before=advance(h,0,4.03);
        h.settings({rate});let state=h.frame(4.03,0),previous=state.x;
        assert.equal(state.x,before.x);
        near(state.planVelocity+state.rejoinVelocity,before.planVelocity+before.rejoinVelocity);
        const end=h.planCache().result.arrivalTime;
        assert.ok(end>4.03&&end<=4+.25*rate+1e-9);
        for(let i=1;i<=60;i++) {
            state=h.frame(4.03+(end-4.03)*i/60,(end-4.03)/60/rate);
            assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8,'rate adjustment reversed or overshot');previous=state.x;
        }
        assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('changing direct arrival to zero during a late tail rejoins smoothly without overshooting',()=>{
    const h=controller(),before=advance(h,0,4.1);
    h.settings({arriveAfterMs:0});
    let state=h.frame(4.1,0),previous=state.x;
    assert.equal(state.x,before.x);
    near(state.planVelocity+state.rejoinVelocity,before.planVelocity+before.rejoinVelocity);
    for(let i=1;i<=100;i++) {
        state=h.frame(4.1+i*.01,.01);
        assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8,'changing direct arrival reversed or overshot');
        previous=state.x;
    }
    assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
});

test('repeated late-tail slider changes preserve the active resume instead of jumping or restarting backwards',()=>{
    const h=controller();let state=advance(h,0,4.1),time=4.1;
    const changes=[{arriveAfterMs:0},
        {startBeforeMs:1000,arriveAfterMs:400},
        {startBeforeMs:700,arriveAfterMs:0}];
    for(const change of changes) {
        const before=state;h.settings(change);state=h.frame(time,0);
        assert.equal(state.x,before.x);
        near(state.planVelocity+state.rejoinVelocity,before.planVelocity+before.rejoinVelocity);
        const next=advance(h,time,time+.015);
        assert.ok(next.x>=state.x-1e-8&&next.x<=180+1e-8);
        state=next;time+=.015;
    }
    let previous=state.x;
    for(let i=1;i<=60;i++) {
        state=h.frame(time+(4.4-time)*i/60,(4.4-time)/60);
        assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8);
        previous=state.x;
    }
    assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
});
