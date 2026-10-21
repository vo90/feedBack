const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');
const api = cameraApi();

const lane = (time,fret,width=4) => ({time,fret,width});
const route = frets => frets.map((fret,index)=>lane(index*.3,fret));
function project(rows,{lefty=false,aspect=16/9,preset='straight',distance=100}={}) {
    const xFret=fret=>fret*10*(lefty?-1:1);
    return rows.map(row=>{
        const a=xFret(row.fret-1),b=xFret(row.fret+row.width-1);
        const preferred=(a+xFret(row.fret-1+Math.min(4,row.width)))/2;
        const closeDistance=distance+40/aspect;
        return {...row,firstFret:row.fret,lastFret:row.fret+row.width-1,
            minX:Math.min(a,b),maxX:Math.max(a,b),preferred,
            x:preferred+(preset==='angled'?3:0),closeDistance,
            distance:closeDistance+Math.abs(b-a),viewDistance:distance/aspect};
    });
}
function freeze(value) {
    if(value&&typeof value==='object'&&!Object.isFrozen(value)) {
        Object.values(value).forEach(freeze);Object.freeze(value);
    }
    return value;
}
function fixtures() {
    const extended=route([5,9,12,5,9,12,5]);
    extended.splice(1,0,lane(.1,5,8),lane(.2,5));
    extended.push(lane(3,16));
    const notes=[0,.9].flatMap(start=>[
        {t:start,s:0,f:5,tp:true},{t:start+.3,s:0,f:9,ho:true},{t:start+.6,s:0,f:12,po:true},
    ]);
    notes.push({t:1.8,s:0,f:5,tp:true},{t:2.1,s:0,f:0},{t:3,s:0,f:16});
    const variationNotes=[];
    for(const start of [0,4,8]) variationNotes.push({t:start+.2,s:0,f:5,sus:0},
        {t:start+1,s:1,f:start===4?13:7,sus:1.2},{t:start+3,s:0,f:5,sus:0});
    return [
        {name:'extensions and tapping',rows:extended,context:{notes,chords:[],stringCount:6}},
        {name:'climb and descent',rows:route([1,4,8,12,16,12,8,4,1]),context:{}},
        {name:'advancing zigzag',rows:route([1,5,3,7,5,9,7,12]),context:{}},
        {name:'nested homes and spikes',rows:route([5,9,12,9,12,9,5,8,5,13,4]),context:{}},
        {name:'proven note variation',rows:[lane(0,5),lane(5,13),lane(6.2,5)],context:{notes:variationNotes,
            chords:[],beats:[0,4,8,12].map((time,measure)=>({time,measure})),sections:[{time:0,name:'riff'}]}},
    ];
}
const views=[{aspect:1.2},{preset:'angled',aspect:2.4},
    {lefty:true,preset:'straight',distance:160},{lefty:true,preset:'angled',aspect:1,distance:80}];
const selected=(evidence,areas,threshold,lefty)=>api.hwyApplyTappingAreas(
    api.hwyApplyCameraThreshold(evidence,{excursionThreshold:threshold}),areas,
    {xFret:fret=>fret*10*(lefty?-1:1)});

test('reprojection retains musical proof and refreshes every coalesced span and diagnostic home',()=>{
    for(const fixture of fixtures()) {
        const original=freeze(api.hwyCompileCameraEvidence(project(fixture.rows),{context:fixture.context}));
        for(const view of views) {
            const regions=freeze(project(fixture.rows,view));
            const projected=api.hwyProjectCameraEvidence(original,regions);
            const fresh=api.hwyCompileCameraEvidence(regions,{context:fixture.context});
            assert.deepEqual(projected,fresh,`${fixture.name}: ${JSON.stringify(view)}`);
            assert.equal(projected.candidates,original.candidates,'suppression proof must be reused');
            assert.equal(projected.protectedIndices,original.protectedIndices,'progressive-run proof must be reused');
            for(let i=0;i<original.patterns.length;i++) {
                assert.equal(projected.patterns[i].cycles,original.patterns[i].cycles,'cycle ownership must be reused');
                assert.notEqual(projected.patterns[i].home,original.patterns[i].home,'diagnostic coordinates must be refreshed');
            }
            if(fixture.name==='extensions and tapping') {
                const span=projected.spans[0];
                assert.deepEqual([span.regionStart,span.regionEnd],[0,3]);
                assert.equal(span.x,view.lefty?-60:60,'same-base extension retains its first four-fret focus');
                assert.equal(span.maxX-span.minX,80,'the widened region still contributes its full geometry');
            }
        }
    }
});

test('reprojected threshold, tapping, timing diagnostics and sampled motion equal a fresh compile',()=>{
    for(const fixture of fixtures()) {
        const original=freeze(api.hwyCompileCameraEvidence(project(fixture.rows),{context:fixture.context}));
        const areas=freeze(api.hwyCompileTappingAreas(original,fixture.context));
        const attacks=api.hwyBuildCameraAttackIndex(fixture.context.notes,fixture.context.chords,6);
        if(fixture.name==='extensions and tapping')assert.equal(areas.length,1);
        if(fixture.name==='proven note variation')assert.ok(original.candidates.some(c=>c.kind==='riff-variation'));
        for(const view of views) {
            const regions=project(fixture.rows,view), projected=api.hwyProjectCameraEvidence(original,regions);
            const fresh=api.hwyCompileCameraEvidence(regions,{context:fixture.context});
            const freshAreas=api.hwyCompileTappingAreas(fresh,fixture.context);
            assert.deepEqual(areas,freshAreas,'tapping proof is independent of view geometry');
            for(const threshold of [0,250,500,1000]) {
                const actual=selected(projected,areas,threshold,view.lefty);
                const expected=selected(fresh,freshAreas,threshold,view.lefty);
                assert.deepEqual(actual,expected,'selected stops and home diagnostics must use the new projection');
                for(const movementMode of ['reach-centres','latest-destination']) for(const rate of [.5,1,2]) {
                    const prepare=stops=>api.hwyPrepareCameraStops(stops,fixture.context.notes,fixture.context.chords,1,6,attacks);
                    const actualPrepared=prepare(actual),expectedPrepared=prepare(expected);
                    const timing={startBeforeMs:400,arriveAfterMs:50,movementMode};
                    const sample=(stops,time)=>api.hwyCameraPlanAt(stops,time,rate,.5,{},0,0,250,null,timing);
                    for(const time of [0,.1,.3,.5,.9,1.2,1.8,2.8,3.05,5.1,6.25])
                        assert.deepEqual(sample(actualPrepared,time),sample(expectedPrepared,time),
                            `${fixture.name}/${movementMode}/${rate}/${threshold} at ${time}`);
                    assert.deepEqual(actualPrepared.motion,expectedPrepared.motion,'complete segments and timing explanations must match');
                }
            }
        }
    }
});

test('coincident rows and dense same-base changes preserve coalescing without replaying chart predicates',()=>{
    let scans=0;
    const counted=cameraApi({onRenderableNote:()=>scans++});
    const {context}=fixtures()[0];
    const rows=[lane(0,5),lane(.1,5,8),lane(.2,5),lane(.3,9),lane(.3,10),
        lane(.6,12),lane(.9,5),lane(1.2,10),lane(1.5,12),lane(1.8,5),lane(3,16)];
    const compiled=freeze(counted.hwyCompileCameraEvidence(project(rows),{context}));
    counted.hwyCompileTappingAreas(compiled,context);
    assert.ok(scans>0,'the original proof must inspect real fretted notes');
    const before=scans;
    for(const view of views) {
        const regions=project(rows,view),actual=counted.hwyProjectCameraEvidence(compiled,regions);
        assert.equal(scans,before,'reprojection must not re-run note predicates');
        assert.deepEqual(actual,api.hwyCompileCameraEvidence(regions,{context}));
        assert.equal(actual.spans[1].firstFret,10,'the last simultaneous row remains authoritative');
    }
});
