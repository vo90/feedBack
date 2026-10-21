const {test} = require('node:test');
const assert = require('node:assert/strict');
const {harness} = require('../helpers/highway_camera_harness.cjs');
const rates = [.25,.5,.75,1,1.5,2];
const presets = ['straight','angled'];
const modes = ['reach-centres','latest-destination'];
const near = (a,b,message) => assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} versus ${b}`);
const velocity = state => state.planVelocity+state.rejoinVelocity;
const row = (time,fret) => ({time,minX:(fret-1)*10,maxX:(fret+3)*10});
function camera({rate=1,preset='straight',movementMode='reach-centres',autoZoom=true,rows}={}) {
    const h=harness();
    h.settings({rate,preset,movementMode,autoZoom,startBeforeMs:450,arriveAfterMs:1000});
    h.setRegionTimeline(rows || [row(0,2),row(3,10),row(3.65,5),row(4.3,14),row(4.95,7),row(6,2)]);
    return h;
}
function sample(h,rate,end=9,geometry=()=>[]) {
    const states=[];
    for(let frame=0;frame<=end*120;frame++) {
        const time=frame/120; h.setPoints(geometry(time));
        states.push(h.frame(time,frame?1/(120*rate):0));
    }
    return states;
}
test('renderer plans and nominal camera poses follow the same song positions at every rate',()=>{
    for(const preset of presets)for(const movementMode of modes)for(const autoZoom of [true,false]) {
        const reference=sample(camera({preset,movementMode,autoZoom}),1);
        for(const rate of rates.filter(rate=>rate!==1)) {
            const states=sample(camera({rate,preset,movementMode,autoZoom}),rate);
            for(let i=0;i<states.length;i++)for(const field of ['x','planX','distance','targetDistance'])
                near(states[i][field],reference[i][field],`${preset}/${movementMode}/${autoZoom}/${rate} at ${i/120}: ${field}`);
        }
    }
});
test('held-lane visibility widening and recovery use song time across repeated excursions',()=>{
    const geometry=time=>time>=3&&time<3.4||time>=3.6&&time<4
        ?[[30,13,0],[310,13,-30]]:[[30,13,0]];
    for(const preset of presets) {
        const reference=sample(camera({preset,rows:[row(0,2)]}),1,10,geometry);
        assert.ok(Math.max(...reference.map(state=>state.distance))>reference[0].distance*1.1,
            'the fixture must exercise outward zoom');
        assert.ok(reference.at(-1).distance<Math.max(...reference.map(state=>state.distance))*.9,
            'the fixture must also exercise recovery');
        for(const rate of rates.filter(rate=>rate!==1)) {
            const states=sample(camera({preset,rate,rows:[row(0,2)]}),rate,10,geometry);
            for(let i=0;i<states.length;i++)for(const field of ['x','distance','targetDistance'])
                near(states[i][field],reference[i][field],`${preset}/${rate}: ${field} at ${i/120}`);
        }
    }
});
test('changing speed during a pan preserves the live pose and velocity before rejoining the song-time path',()=>{
    for(const preset of presets)for(const movementMode of modes)for(const [from,to] of [[.25,2],[2,.25],[.75,1.5]]) {
        const h=camera({preset,movementMode,rate:from,rows:[row(0,2),row(4,15),row(8,3)]});
        const before=sample(h,from,4.25).at(-1);
        assert.ok(Math.abs(velocity(before))>1e-6,'the rate change must occur during actual movement');
        const evidence=h.planCache().cameraEvidence,areas=h.planCache().tappingAreas;
        h.settings({rate:to});const changed=h.frame(4.25,0);
        near(changed.x,before.x,'speed changes preserve position');
        near(changed.distance,before.distance,'speed changes preserve zoom');
        near(velocity(changed),velocity(before),'speed changes preserve actual velocity');
        assert.equal(h.planCache().cameraEvidence,evidence,'speed changes must reuse musical evidence');
        assert.equal(h.planCache().tappingAreas,areas,'speed changes must reuse tapping evidence');
        // A slowed nominal path may finish after the continuity bridge. The
        // existing handoff may reach early and hold until that arrival.
        const end=Math.max(4.25+1.5*to,5.1),steps=Math.ceil((end-4.25)/to*120);
        let settled=changed;
        for(let frame=1;frame<=steps;frame++)settled=h.frame(4.25+(end-4.25)*frame/steps,(end-4.25)/steps/to);
        near(settled.x,h.planCache().result.x,'the local handoff rejoins the current nominal path');
        near(velocity(settled),h.planCache().result.velocity,'the local handoff rejoins nominal velocity');
    }
});

test('live speed edits preserve an active inward zoom phase and scale its real speed with the highway',()=>{
    const geometry=time=>time>=3&&time<4?[[30,13,0],[310,13,-30]]:[[30,13,0]];
    for(const preset of presets)for(const rate of [.25,.5,2]) {
        const reference=camera({preset,rows:[row(0,2)]});
        const changed=camera({preset,rows:[row(0,2)]});
        const before=sample(changed,1,4.75,geometry).at(-1);
        sample(reference,1,4.75,geometry);
        assert.ok(before.zoomVelocity<0,'the speed edit must occur during inward recovery');
        assert.ok(before.quietZoomTime>.5,'the quiet hold must have finished');
        changed.settings({rate});
        const atEdit=changed.frame(4.75,0);
        for(const field of ['distance','zoomVelocity','quietZoomTime','zoomReturnFrom'])
            near(atEdit[field],before[field],`rate ${rate}: keep song-space ${field}`);
        for(let frame=1;frame<=180;frame++) {
            const time=4.75+frame/120;
            reference.setPoints(geometry(time));changed.setPoints(geometry(time));
            const a=reference.frame(time,1/120),b=changed.frame(time,1/(120*rate));
            for(const field of ['distance','zoomVelocity','quietZoomTime','targetDistance'])
                near(b[field],a[field],`rate ${rate}: ${field} at ${time}`);
        }
    }
});
