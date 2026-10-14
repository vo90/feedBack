const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const s=fs.readFileSync(require('node:path').join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const start=s.indexOf('    function createLetRingView()'),end=s.indexOf('    const letRingView',start);
const create=new Function(s.slice(start,end)+';return createLetRingView;')();
test('visual copy uses existing sustains and caches without mutating score input',()=>{
 const a={t:1,s:0,f:0,sus:.5,lr:true,let_ring_sus:2},b={t:2,s:1,f:5,sus:.5};
 const bundle={notes:[a,b],chords:[{t:3,notes:[a]}],currentTime:0};
 const before=JSON.stringify(bundle),view=create();const x=view(bundle,true),y=view({...bundle,currentTime:1},true);
 assert.equal(x.notes[0].sus,2);assert.equal(x.chords[0].notes[0].sus,2);
 assert.equal(x.notes[1],b);assert.equal(x.notes,y.notes);assert.equal(y.currentTime,1);
 assert.equal(JSON.stringify(bundle),before);assert.notEqual(x.notes[0],a);
});
test('dead notes and invalid spans retain ordinary trails',()=>{
 const ns=[{mt:true,let_ring_sus:4},{let_ring_sus:NaN},{let_ring_sus:'4'},{sus:5,let_ring_sus:4}];
 const x=create()({notes:ns,chords:[]},true);ns.forEach((n,i)=>assert.equal(x.notes[i],n));
});

test('let-ring is hidden by default and toggles without changing authored notes or scoring input',()=>{
 // Real Enter Sandman opening durations: written .2375 s; let-ring 1.9175 s.
 const ring={t:2.735,s:2,f:5,sus:.2375,lr:true,let_ring_sus:1.9175};
 const slide={t:3,s:1,f:5,sus:1,sl:7,ln:true};
 const bend={t:4,s:2,f:7,sus:1,bn:2,bnv:[{t:0,v:0},{t:1,v:2}],v:true};
 const sustain={t:5,s:0,f:3,sus:2,lr:true};
 const chord={t:6,sus:1,ct:2,arp:true,notes:[ring,slide]};
 const bundle={notes:[ring,slide,bend,sustain],chords:[chord],scoring:{hits:12}};
 const before=structuredClone(bundle),view=create();
 assert.equal(view(bundle),bundle);
 let cached;
 for(const enabled of [true,false,true]){
  const result=view(bundle,enabled);
  if(!enabled) assert.equal(result,bundle);
  assert.deepEqual(result.notes[0],{...ring,sus:enabled?1.9175:.2375});
  for(let i=1;i<bundle.notes.length;i++)assert.equal(result.notes[i],bundle.notes[i]);
  assert.equal(result.notes[2].bnv,bend.bnv);
  assert.deepEqual(result.chords[0],{...chord,notes:[{...ring,sus:enabled?1.9175:.2375},slide]});
  assert.equal(result.scoring,bundle.scoring);
  assert.deepEqual(bundle,before,'score input and original chart remain unchanged');
  if(enabled){if(cached)assert.equal(result.notes,cached);cached=result.notes;}
 }
});
