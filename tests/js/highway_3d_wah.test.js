const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const start=source.indexOf('    function buildWahGuidance('),end=source.indexOf('    // Explicit transport',start);
const build=new Function(source.slice(start,end)+';return buildWahGuidance;')();
const cue=(t,state='open',strings=[0])=>({t,state,strings});
test('notes, holds, slides, chords, rests and duplicate voice cues',()=>{
 const b={wah:[cue(1),cue(2,'closed'),cue(3),cue(3)],notes:[{t:1,s:0,f:5,sus:2,sl:9}],
   chords:[],anchors:[{time:0,fret:3,width:4},{time:3,fret:9,width:4}]};
 const before=JSON.stringify(b),c=build(b);
 assert.deepEqual(c.map(x=>[x.t,x.fret,x.text]),[[1,5,'WAH ○'],[2,7,'WAH +'],[3,9,'WAH ○']]);
 assert.equal(JSON.stringify(b),before);
 assert.equal(build({...b,wah:[cue(4,'closed',[])]})[0].fret,10.5);
});
test('chord has one cue; conflicting states are explicit; dense changes use rows',()=>{
 const b={wah:[cue(1,'open',[0,1]),cue(1,'closed',[1]),cue(1.05),cue(1.5)],
  chords:[{t:1,notes:[{s:0,f:3},{s:1,f:5}]}]};
 const c=build(b);assert.equal(c.length,3);assert.equal(c[0].text,'WAH ○/+');
 assert.equal(c[0].fret,4);assert.deepEqual(c.map(x=>x.row),[0,1,0]);
});
test('open strings and unpitched mutes use their timed lane, no invented fret',()=>{
 const c=build({wah:[cue(1)],notes:[{t:1,s:0,f:127,mt:true}],anchors:[{time:0,fret:7,width:4}]});
 assert.equal(c[0].fret,8.5);
});
