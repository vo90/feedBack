const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const s=fs.readFileSync(require('node:path').join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const start=s.indexOf('    function createLetRingView()'),end=s.indexOf('    const letRingView',start);
const create=new Function(s.slice(start,end)+';return createLetRingView;')();
test('visual copy uses existing sustains and caches without mutating score input',()=>{
 const a={t:1,s:0,f:0,sus:.5,lr:true,let_ring_sus:2},b={t:2,s:1,f:5,sus:.5};
 const bundle={notes:[a,b],chords:[{t:3,notes:[a]}],currentTime:0};
 const before=JSON.stringify(bundle),view=create();const x=view(bundle),y=view({...bundle,currentTime:1});
 assert.equal(x.notes[0].sus,2);assert.equal(x.chords[0].notes[0].sus,2);
 assert.equal(x.notes[1],b);assert.equal(x.notes,y.notes);assert.equal(y.currentTime,1);
 assert.equal(JSON.stringify(bundle),before);assert.notEqual(x.notes[0],a);
});
test('dead notes and invalid spans retain ordinary trails',()=>{
 const ns=[{mt:true,let_ring_sus:4},{let_ring_sus:NaN},{let_ring_sus:'4'},{sus:5,let_ring_sus:4}];
 const x=create()({notes:ns,chords:[]});ns.forEach((n,i)=>assert.equal(x.notes[i],n));
});
