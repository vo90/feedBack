const { test } = require('node:test');
const assert = require('node:assert/strict');
const { source, extractFunction, harness } = require('../helpers/highway_camera_harness.cjs');

const cameraHelpers = [...source.matchAll(/function (hwy(?:BuildCamera|PrepareCamera|Camera)[A-Za-z0-9_]*)\(/g)]
    .map(match => match[1]);
const { motion, at, buildStops, timeline } = new Function(
    'const NFRETS=24;\n' +
    ['isPlayableFret','isPlainDeadNote','isUnpitchedMute','isRenderableNote',...cameraHelpers]
        .map(name=>extractFunction(name)).join('\n') +
    '\nreturn {motion:hwyBuildCameraMotion,at:hwyCameraPlanAt,buildStops:hwyBuildCameraStops,timeline:hwyBuildCameraTimeline};'
)();
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

test('the default long switch departs 100ms later and takes 10 percent longer in real time',()=>{
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
        near((maximum.start-old.start)/rate,3/3.2,
            'the settling cap scales both requests proportionally');
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

test('long switch eligibility uses the selected fret displacement and preserves small moves',()=>{
    for(const threshold of [1,5,12,23,24]) for(const difference of [1,4,5,11,12,22,23]) {
        const rows=[row(0,1),row(4,1+difference)];
        const old=motion(rows,1,.5,0,0,0,threshold)[0];
        const tuned=motion(rows,1,.5,100,10,250,threshold)[0];
        if(difference>=threshold) assert.ok(tuned.start>old.start&&tuned.end>old.end);
        else {assert.equal(tuned.start,old.start);assert.equal(tuned.end,old.end);}
    }
    const extended=[row(0,1,true,12),row(4,6,true,12)];
    assert.ok(motion(extended,1,.5,100,10,250,5)[0].end>4,
        'a wider riff extent must not disguise a qualifying five-fret relocation');
});

test('progressive short runs retain their complete original path with every timing control enabled',()=>{
    const rows=[row(0,1),row(4,9,false),row(4.2,13,false),row(4.4,21)];
    for(const rate of [.5,1,2]) {
        const nominal=clone(rows),tuned=clone(rows);
        for(let i=0;i<=300;i++) {
            const time=i/50,a=sample(nominal,time,{rate,delay:0,extra:0,cap:0});
            const b=sample(tuned,time,{rate,delay:1000,extra:200,cap:3000,long:1});
            assert.equal(b.x,a.x);assert.equal(b.velocity,a.velocity);
        }
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

test('the excursion control measures original whole-excursion duration independently of speed',()=>{
    const rows=[row(0,1),row(2,7),row(2.2,9),row(2.45,1)];
    for(const threshold of [0,400,450,500,1000]) for(const rate of [.5,1,2]) {
        const stops=buildStops(rows,rate,null,null,null,null,null,threshold);
        if(threshold>450) assert.deepEqual(stops.map(s=>s.firstFret),[1]);
        else assert.ok(stops.length>1,'a group reaching the cutoff must be followed');
    }
});

test('a three-second excursion threshold uses the whole source-time departure and follows its exact boundary',()=>{
    for(const duration of [1.001,2.5,2.999,3]) for(const rate of [.5,1,2]) {
        const rows=[row(0,1),row(5,7),row(5+duration/2,9),row(5+duration,1)];
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
    const h=harness();h.settings({...gentle,preset,rate:1});
    h.setRegionTimeline([{time:0,minX:0,maxX:40},{time:4,minX:160,maxX:200}]);
    h.frame(0,0);return h;
}
function advance(h,from,to,rate=1) {
    const steps=Math.max(1,Math.ceil((to-from)/rate*120));let state,previous=from;
    for(let i=1;i<=steps;i++) {const time=from+(to-from)*i/steps;state=h.frame(time,(time-previous)/rate);previous=time;}
    return state;
}

test('the four timing controls rebuild motion without reclassifying lanes or reprojecting geometry',()=>{
    const h=controller(),cache=h.planCache();
    const semantic=cache.semanticStops,timeline=cache.timeline,regions=cache.regions,attacks=cache.attacks;
    const objects=regions.slice(),stops=cache.stops;
    for(const settings of [{departureDelay:1000},{travelExtra:200},{settleLimit:3000},{longSwitchFrets:24}]) {
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

test('both Stable presets honor the tuned late arrival during ordinary playback',()=>{
    for(const preset of ['straight','angled']) {
        const h=controller(preset),atOnset=advance(h,0,4);
        assert.ok(atOnset.x<180,'enabled tuning must still be travelling at the original boundary');
        const state=advance(h,4,4.21);
        assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
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

test('turning timing adjustments off during a late tail rejoins smoothly without overshooting',()=>{
    const h=controller(),before=advance(h,0,4.1);
    h.settings({departureDelay:0,travelExtra:0,settleLimit:0});
    let state=h.frame(4.1,0),previous=state.x;
    assert.equal(state.x,before.x);
    near(state.planVelocity+state.rejoinVelocity,before.planVelocity+before.rejoinVelocity);
    for(let i=1;i<=100;i++) {
        state=h.frame(4.1+i*.01,.01);
        assert.ok(state.x>=previous-1e-8&&state.x<=180+1e-8,'disabling timing adjustments reversed or overshot');
        previous=state.x;
    }
    assert.equal(state.x,180);assert.equal(state.planVelocity+state.rejoinVelocity,0);
});

test('repeated late-tail slider changes preserve the active resume instead of jumping or restarting backwards',()=>{
    const h=controller();let state=advance(h,0,4.1),time=4.1;
    const changes=[{departureDelay:0,travelExtra:0,settleLimit:0},
        {departureDelay:200,travelExtra:30,settleLimit:400},
        {departureDelay:0,travelExtra:0,settleLimit:0}];
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
