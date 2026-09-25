const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
function fn(name) {
 const start=src.indexOf('function '+name+'('),open=src.indexOf('{',start);assert.ok(start>=0,name);
 let depth=0;for(let i=open;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);}
 throw Error(name);
}
async function harness() {
 const {whammyApi}=await import('../../static/js/whammy.js');
 return new Function('window',`
  const BEND_HALFSTEP_WORLD_Y=1,BEND_ENV_RISE_FRAC=.35,BEND_ENV_RELEASE_FRAC=.3,VIBRATO_HALF_WAVE_S=.08,SLIDE_RIBBON_SAMPLES=8;
  const _linkedBendStarts=new WeakMap(),_linkedBendEnds=new WeakMap(),_linkedVibratoRuns=new WeakMap(),_slideRibbonTimesScratch=[];
  const bendVisualDirY=()=>1,TRAIL_YIELD_DEFAULTS={minScale:.3},dZ=t=>-10*t,sustainTrailCenterXAt=(n,x)=>x;
  ${src.slice(src.indexOf('    function slideTrailEnd('),src.indexOf('    // Camera tgtDist building blocks'))}
  ${['noteHasVibrato','bnvSampleAt','bendCurveStartSemis','bendCurveSemisAt','bendSemisAtElapsed','bendSemisAtTime','vibratoSemisAtTime','techniqueYOffsetWorld','ensureSlideRibbonCapacity','slideRibbonUpdatePair'].map(fn).join('\n')}
  return n=>{
   const yieldCount=0,scrape=false,slideSt=slideTrailEnd(n),hasTechniqueVibrato=noteHasVibrato(n);
   // Execute the renderer's actual path-selection statement before building
   // the real ribbon. Calling the ribbon helper alone missed this regression.
   ${src.match(/const ribbonSusTrail = [\s\S]*?;/)[0]}
   if(!ribbonSusTrail)return null;
   const geometry=()=>({userData:{},setDrawRange(){},attributes:{position:{count:4000,array:new Float64Array(12000)}}});
   const outer=geometry(),inner=geometry();
   slideRibbonUpdatePair(outer,inner,7,1,.4,.8,.2,0,n.sus,n.t,n.t-.1,n,slideSt);
   const p=inner.attributes.position.array,centers=[];
   for(let i=0;i<=inner.userData.ribbonSlices;i++)centers.push({x:(p[i*12]+p[i*12+6])/2,y:(p[i*12+1]+p[i*12+7])/2,z:p[i*12+2]});
   return centers;
  };
 `)({feedBackWhammy:whammyApi});
}
function note(curve,vibrato,f=7) {return {t:10,sus:2,s:0,f,whammy:{version:1,policy:'optional',segments:[{start:0,end:2,curve,vibrato}]}};}
test('bar-only open and fretted notes reach the shaped ribbon and preserve signed motion',async()=>{
 const render=await harness();assert.equal(render({t:10,sus:2,s:0,f:7}),null);
 for(const f of [0,7])for(const end of [-8,4]) {
  const centers=render(note([{t:0,v:0},{t:2,v:end}],undefined,f));assert.ok(centers,'Bar-only note incorrectly used a straight box');
  assert.ok(centers.every(p=>p.x===7),'A bar gesture must not become a fret slide');
  assert.ok(centers.every(p=>Number.isFinite(p.y)));assert.equal(Math.sign(centers.at(-2).y),Math.sign(end));
 }
});
test('qualitative bar vibrato emits oscillating geometry with larger wide motion',async()=>{
 const render=await harness(),spans=[];
 for(const vibrato of ['slight','wide']) {
  const centers=render(note([],vibrato));assert.ok(centers,'Bar vibrato incorrectly used a straight box');
  const ys=centers.map(p=>p.y);assert.ok(Math.min(...ys)<0&&Math.max(...ys)>0);assert.ok(centers.length>=80);
  spans.push(Math.max(...ys)-Math.min(...ys));
 }
 assert.ok(spans[1]>spans[0]*2);
});
