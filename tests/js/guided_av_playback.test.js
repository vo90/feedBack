const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../static/js/guided-av-playback.js'),'utf8').replace(/export /g,''),ctx);
const good=()=>({valid:true,ageMs:2,position:.05,presentation:{version:2,playing:true,ageMs:2}});
function fixture(stalled=true){
    const calls=[], profile={perOutputSetup:true,output:{persistent:true,key:'tv',routeKey:'tv'},input:{key:'input'}};
    let current={token:'old',profile}, alive=true, recoveries=0;
    const a={playCalibrationTrial:async t=>calls.push(['play',t]),pollCalibration:async()=>stalled?{valid:true,position:0,ageMs:20,presentation:{version:2,playing:false,ageMs:0}}:good(),
        isAudioRunning:async()=>true,getCalibration:async()=>profile,getCurrentDevice:async()=>({input:'Interface',output:'TV',inputType:'ASIO',outputType:'Windows Audio',sampleRate:48000,inputBlockSize:256}),
        finishGuidedCalibration:async t=>calls.push(['finish',t]),setDevice:async d=>{calls.push(['device',d]);stalled=false;return{ok:true};},beginGuidedCalibration:async()=>({token:'new',profile})};
    const options={api:a,lease:current,volume:.2,active:()=>alive,onLease:l=>{current=l;},recover:()=>++recoveries===1,status:()=>{},wait:async()=>{}};
    return{a,options,calls,profile,current:()=>current,cancel:()=>alive=false};
}
test('healthy native output starts without device reconfiguration',async()=>{
    const f=fixture(false);assert.equal(await ctx.startCalibrationPlayback(f.options),true);assert.deepEqual(f.calls,[['play','old']]);
});
test('stalled output is reopened once at the exact selected setup, with a fresh lease',async()=>{
    const f=fixture();assert.equal(await ctx.startCalibrationPlayback(f.options),true);
    assert.deepEqual(f.calls.map(x=>x[0]),['play','finish','device','play']);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[2][1])),{inputType:'ASIO',inputDevice:'Interface',outputType:'Windows Audio',outputDevice:'TV',sampleRate:48000,bufferSize:256});
    assert.equal(f.current().token,'new');
});
test('stale output observations do not count as successful playback',()=>{
    assert.equal(ctx.calibrationOutputAdvancing({...good(),ageMs:200}),false);
    assert.equal(ctx.calibrationOutputAdvancing({...good(),presentation:{version:2,playing:false,ageMs:0}}),false);
});
test('recovery refuses a route changed by the user',async()=>{
    const f=fixture();f.a.getCalibration=async()=>({...f.profile,output:{...f.profile.output,key:'other'}});
    await assert.rejects(ctx.startCalibrationPlayback(f.options),/output changed/);assert.equal(f.calls.some(x=>x[0]==='device'),false);
});
test('a stopped engine is not restarted against user intent',async()=>{
    const f=fixture();f.a.isAudioRunning=async()=>false;
    await assert.rejects(ctx.startCalibrationPlayback(f.options),/not playing/);assert.equal(f.calls.some(x=>x[0]==='device'),false);
});
test('unavailable output fails without looping device recovery or saving',async()=>{
    const f=fixture();f.a.setDevice=async()=>{f.calls.push(['device']);return{ok:true};};
    await assert.rejects(ctx.startCalibrationPlayback(f.options),/still not playing/);assert.equal(f.calls.filter(x=>x[0]==='device').length,1);
});
test('cancellation during reopening prevents a new trial',async()=>{
    const f=fixture();f.a.setDevice=async()=>{f.cancel();return{ok:true};};
    assert.equal(await ctx.startCalibrationPlayback(f.options),false);assert.equal(f.calls.filter(x=>x[0]==='play').length,1);assert.equal(f.current(),null);
});
test('cancellation while acquiring a replacement lease releases it',async()=>{
    const f=fixture();f.a.beginGuidedCalibration=async()=>{f.cancel();return{token:'new',profile:f.profile};};
    assert.equal(await ctx.startCalibrationPlayback(f.options),false);assert.deepEqual(f.calls.at(-1),['finish','new']);
});
test('failed reconfiguration cannot become a successful comparison',async()=>{
    const f=fixture();f.a.setDevice=async()=>({ok:false});
    await assert.rejects(ctx.startCalibrationPlayback(f.options),/Could not reconnect/);assert.equal(f.current(),null);
});
test('lease input channel metadata may differ from the public input profile',async()=>{
    const f=fixture();f.options.lease={token:'old',profile:{...f.profile,input:{key:'legacy-unspecified-channel'}}};
    f.a.beginGuidedCalibration=async()=>({token:'new',profile:f.options.lease.profile});
    assert.equal(await ctx.startCalibrationPlayback(f.options),true);assert.equal(f.current().token,'new');
});
