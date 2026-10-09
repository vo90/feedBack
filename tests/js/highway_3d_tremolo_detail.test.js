const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const block=src.slice(src.indexOf('        function sustainMotionWidth('),src.indexOf('        /** Rendered X centre'));
function helpers(rs=false){return vm.runInNewContext(`const TREMOLO_BUMP_S=.06, RSPLUS_SUSTAIN_STROKE_SCALE=.2;let rsPlusNotation=${rs};`+block+';({tremoloOffsetWorldX,tremoloVisualIntervals})');}
const mark=(rate,period,start=0,end=2)=>({start,end,rate,period,phase:0,mode:period?'specified':'unspecified'});
test('slow and fast cues differ in density, not lateral reach',()=>{
 const h=helpers();
 for(const period of [.25,.125,.0625]){
  const n={t:0,sus:2,tr:true,tremolo_marks:[mark([1,16],period)]};
  assert.ok(Math.abs(h.tremoloOffsetWorldX(n,1,2)-h.tremoloOffsetWorldX(n,1+period,2))<1e-10);
  let max=0;for(let t=.25;t<1.75;t+=.0001)max=Math.max(max,Math.abs(h.tremoloOffsetWorldX(n,t,2)));
  assert.ok(Math.abs(max-.75)<.002);
 }
});
test('qualified intervals and minimum readable spacing',()=>{
 const h=helpers(),n={t:4,sus:2,tr:true,tremolo_marks:[mark([1,128],.01,.5,1.5)]};
 assert.equal(h.tremoloOffsetWorldX(n,4.4,2),0);
 assert.equal(h.tremoloOffsetWorldX(n,5.6,2),0);
 assert.equal(h.tremoloVisualIntervals(n.tremolo_marks)[0].period,.06);
 assert.equal(h.tremoloOffsetWorldX({...n,tremolo_marks:[]},5,2),0);
});
test('clock segments have continuous phase, seek-safe and stable cached sampling',()=>{
 const h=helpers(),marks=[mark([1,16],.13,0,.47),mark([1,16],.26,.47,2)];
 const n={t:0,sus:2,tr:true,tremolo_marks:marks};
 assert.ok(Math.abs(h.tremoloOffsetWorldX(n,.47-1e-9,1)-h.tremoloOffsetWorldX(n,.47+1e-9,1))<1e-6);
 assert.equal(h.tremoloVisualIntervals(marks),h.tremoloVisualIntervals(marks));
 const a=h.tremoloOffsetWorldX(n,.75,1);h.tremoloOffsetWorldX(n,1.5,1);assert.equal(a,h.tremoloOffsetWorldX(n,.75,1));
});
test('legacy cue and RS+ width/narrowing remain intact',()=>{
 const n={t:0,sus:2,tr:true},h=helpers(),rs=helpers(true);
 assert.equal(h.tremoloOffsetWorldX(n,.06,2),.75);
 assert.equal(rs.tremoloOffsetWorldX(n,.06,.4),.75);
 assert.equal(h.tremoloOffsetWorldX(n,.06,1),.375);
});
