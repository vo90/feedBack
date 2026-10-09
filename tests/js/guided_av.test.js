const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../static/js/guided-av-model.js'),'utf8');
const context=vm.createContext({});vm.runInContext(source.replace(/export /g,''),context);
for(const desired of [-950,-500,-100,0,125,800,950]) test(`comparison converges with correct sign at ${desired}ms`,()=>{
    const m=context.createAvComparison(-100);
    for(let i=0;i<24&&!m.result;i++) m.answer(Math.abs(m.candidate-desired)<=5?'together':m.candidate<desired?'earlier':'later');
    assert.equal(m.result.consistent,true); assert.ok(Math.abs(m.result.offsetMs-desired)<=10);
});
test('uncertainty never becomes a successful result; Undo restores the trial',()=>{
    const m=context.createAvComparison(-100);m.answer('earlier');assert.equal(m.candidate,-20);m.undo();assert.equal(m.candidate,-100);
    for(let i=0;i<3;i++)m.answer('unsure');assert.equal(m.result.consistent,false);m.undo();assert.equal(m.result,null);
});
test('contradictory repeats produce no trusted recommendation',()=>{
    const m=context.createAvComparison(-100);m.answer('together');m.answer('together');assert.equal(m.result.consistent,false);
});
test('presentation timing adds only residual AV; stale snapshots rejected',()=>{
    const c={timingVersion:2,playing:true,position:2,sampledAt:1000,freshAt:1000};
    assert.equal(context.calibrationVisualTime(c,1100,-100),2);
    assert.equal(context.calibrationVisualTime(c,1200,-100),null);
});
