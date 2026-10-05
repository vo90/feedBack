const {test}=require('node:test');
const assert=require('node:assert/strict');
function note(f=14){return {t:10,s:2,f,sus:2,harmonic_changes:{version:1,events:[
    {start:.15,end:2,target:{kind:'artificial',node:7,interval:19,policy:'harmonic'},source_id:'source:1'}]}};}
test('one contact resolves from chart time, preserving the picked fret and attack boundary',async()=>{
    const h=await import('../../static/js/harmonic-contacts.js');
    for(const f of [0,14]) {
        const n=note(f),before=JSON.stringify(n);
        assert.equal(h.harmonicContactAt(n,.149999),null);
        assert.equal(h.harmonicContactAt(n,.15).target.interval,19);
        assert.equal(h.harmonicContactAt(n,2.001),null);
        assert.equal(h.harmonicContactLabel(n,h.harmonicContacts(n)[0]),`AH ${f+7}`);
        assert.equal(h.harmonicAttackDeadline(n,10,.2,1),10.15);
        assert.equal(h.harmonicAttackDeadline(n,10,.1,0),10.1);
        assert.equal(JSON.stringify(n),before);
    }
});
test('invalid events are rejected without guessing a target',async()=>{
    const {harmonicContacts}=await import('../../static/js/harmonic-contacts.js');
    for(const mutate of [n=>n.f=49,n=>n.hm=true,n=>n.harmonic_changes.events[0].start=0,
        n=>n.harmonic_changes.events[0].end=3,n=>n.harmonic_changes.events[0].target.interval=12,
        n=>n.harmonic_changes.events.push(n.harmonic_changes.events[0]),n=>n.harmonic_changes.events[0].source_id='']) {
        const n=note();mutate(n);assert.deepEqual(harmonicContacts(n),[]);
    }
});
test('2D uses the contact offset and held fret without drawing a picked gem',async()=>{
    const {drawHarmonicContact2D}=await import('../../static/js/highway-draw.js');
    const calls=[],ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
    const state={currentTime:10,ctx,_harmonicContactOverlay:{addGem:x=>calls.push(['label',x])},
        displayMaxFret:24};
    // Full state geometry is exercised in the actual paired-runtime screenshots.
    drawHarmonicContact2D(state,1000,600,note());
    assert.equal(calls.filter(c=>c[0]==='strokeRect').length,1);
    assert.ok(calls.find(c=>c[0]==='strokeRect').slice(1).every(Number.isFinite));
    assert.equal(calls.find(c=>c[0]==='label')[1].label,'AH 21');
    assert.ok(!calls.some(c=>c[0]==='fillRect'));
});
