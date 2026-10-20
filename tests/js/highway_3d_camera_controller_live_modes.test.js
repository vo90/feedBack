const test = require('node:test');
const assert = require('node:assert/strict');
const { createCameraMotion } = require('../../plugins/highway_3d/src/camera-motion.mjs');
const { createCameraController } = require('../../plugins/highway_3d/src/camera-controller.mjs');
const motion=createCameraMotion({isRenderableNote:()=>true,isUnpitchedMute:()=>false});
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
function remember(state,plan,time){Object.assign(state,{
    planRevision:plan.revision,planMotionRevision:plan.motionRevision,planTime:time,planX:plan.x,planVelocity:plan.velocity,
    planMoving:plan.moving,planTransit:plan.transit,planArrivalTime:plan.arrivalTime,planArrivalX:plan.arrivalX,
    planArrivalLaneTime:plan.arrivalLaneTime,following:true,
});}

test('live edits into connected paths do not finish an obsolete arrival then jump',()=>{
    for(const oldMode of ['reach-centres','latest-destination'])for(const newMode of ['reach-centres','latest-destination'])
        for(const pendingResume of [false,true]){
            const stops=[[0,0],[5,8],[5.8,2],[6.2,10]].map(([time,x])=>({time,x,minX:x-2,maxX:x+2,lasting:true}));
            let options={movementMode:oldMode,startBeforeMs:25,arriveAfterMs:500},revision=1;
            const samplePlan=(time,out)=>motion.hwyCameraPlanAt(stops,time,1,.5,out,0,0,0,null,options);
            const controller=createCameraController({samplePlan,...motion});
            const old=samplePlan(5.05,{});
            const state={x:old.x,rejoinOffset:0,rejoinVelocity:0,rejoinEnd:-Infinity,resumeUntil:-Infinity};
            old.revision=old.motionRevision=revision;remember(state,old,5.05);
            if(pendingResume){
                // The same edit must also cancel a direct resume from a prior
                // Follow resumption rather than inherit its obsolete deadline.
                state.following=false;controller.update(state,old,5.05,1,0);
                assert.equal(state.motionMode,'direct-resume');remember(state,old,5.05);
            }
            const actualX=state.x,actualVelocity=old.velocity+state.rejoinVelocity;
            options={movementMode:newMode,startBeforeMs:700,arriveAfterMs:0};revision++;
            const frame=time=>{
                const plan=samplePlan(time,{});plan.revision=plan.motionRevision=revision;
                controller.update(state,plan,time,1,0);remember(state,plan,time);
                return {x:state.x,velocity:state.motionDiagnostics.actualVelocity,plan};
            };
            const edited=frame(5.05);
            assert.equal(edited.plan.transit,true);assert.equal(state.motionMode,'local-rejoin');
            assert.equal(state.resumeUntil,-Infinity);close(edited.x,actualX);close(edited.velocity,actualVelocity);
            frame(5.49);
            const before=frame(5.5-1e-7),at=frame(5.5),after=frame(5.5+1e-7);
            close(before.x,at.x,1e-5);close(at.x,after.x,1e-5);
            close(before.velocity,at.velocity,1e-4);close(at.velocity,after.velocity,1e-4);
            const finished=frame(6.2);close(finished.x,10);close(finished.velocity,0);
        }
});
