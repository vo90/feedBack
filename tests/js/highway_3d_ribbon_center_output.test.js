const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8').replace(/\r\n/g,'\n');
function fn(name,input=source){
 const start=input.indexOf('function '+name+'('),open=input.indexOf('{',start);assert.ok(start>=0,name);
 let depth=1,end=open+1;while(depth){if(input[end]==='{')depth++;else if(input[end]==='}')depth--;end++;}
 return input.slice(start,end);
}
// Complete, frozen functions from b48c31230c103e5d8e2d3569636aca4493e95dca.
const centerBaseline=`function sustainTrailCenterXAt(n, strandBaseX, chartTime, slideSt, trailW) {
            return strandBaseX
                + (_leftyCached ? -1 : 1) * (slideSt ? slideOffsetWorldX(n, chartTime, slideSt) : 0)
                + (_leftyCached ? -1 : 1) * (n.slide_out_marks?.length ? slideOutOffsetWorldX(n, chartTime) : 0)
                + (_leftyCached ? -1 : 1) * (n.slide_in_marks?.length ? slideInOffsetWorldX(n, chartTime) : 0)
                + (n.tr ? tremoloOffsetWorldX(n, chartTime, trailW) : 0)
                + ((n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0) ? (_leftyCached ? -1 : 1) * pickScrapeOffset(n, chartTime) : 0);
        }`;
const ribbonBaseline=`function slideRibbonUpdatePair(
            outlineGeom, bodyGeom, strandBaseX,
            outlineTw, outlineTh, bodyTw, bodyTh,
            y, sliceDur, susStart, now, n, slideSt,
            yieldStarts = null, yieldEnds = null, yieldCount = 0,
            trailEnd = Infinity, yieldSettings = TRAIL_YIELD_DEFAULTS,
            sameStringTargetTime = NaN, sameStringTrailStart = n.t,
        ) {
            const times = slideRibbonSampleTimes(n, susStart, sliceDur, _slideRibbonTimesScratch);
            const contact=n.harmonic_changes ? window.feedBackHarmonicContacts?.events(n)[0] : null;
            if(contact)for(const delta of [-1e-7,0]) {
                const t=n.t+contact.start+delta;
                if(t>susStart && t<susStart+sliceDur)times.push(t);
            }
            if(contact)times.sort((a,b)=>a-b);
            if (yieldCount > 0 || Number.isFinite(sameStringTargetTime)) {
                if (Number.isFinite(sameStringTargetTime)) hwyAppendSameStringContourTimes(
                    susStart, susStart + sliceDur, sameStringTargetTime,
                    sameStringTrailStart, trailEnd, yieldSettings, times);
                hwyAppendTrailYieldContourTimes(susStart, susStart + sliceDur,
                    yieldStarts, yieldEnds, yieldCount, trailEnd, yieldSettings, times);
                times.sort((a, b) => a - b);
                let write = 1;
                for (let read = 1; read < times.length; read++) {
                    if (times[read] - times[write - 1] > 1e-10) times[write++] = times[read];
                }
                times.length = write;
            }
            const S = times.length - 1;
            ensureSlideRibbonCapacity(outlineGeom, S);
            ensureSlideRibbonCapacity(bodyGeom, S);
            const outlinePositions = outlineGeom.attributes.position.array;
            const bodyPositions = bodyGeom.attributes.position.array;
            const outlineColors = outlineGeom.attributes.color?.array;
            const bodyColors = bodyGeom.attributes.color?.array;
            const hasSlideCue = (!slideSt && slideOutMarks(n).length > 0) || slideInMarks(n).length > 0;
            let v = 0;
            for (let k = 0; k <= S; k++) {
                const Tk = times[k];
                const zk = dZ(Tk - now);
                const outlineX = sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, outlineTw,
                );
                // Only tremolo's horizontal motion depends on strand width.
                // Reuse this sample's exact centre for all other techniques.
                const bodyX = n.tr ? sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, bodyTw,
                ) : outlineX;
                const yc = y + techniqueYOffsetWorld(n, Tk);
                const yieldAmount = Math.max(Number.isFinite(sameStringTargetTime) ? hwySameStringTrailYieldAmountAt(
                    Tk, sameStringTargetTime, sameStringTrailStart, trailEnd, yieldSettings) : 0, yieldCount > 0
                    ? hwyTrailYieldAmountAt(
                        Tk, yieldStarts, yieldEnds, yieldCount, trailEnd, yieldSettings,
                    )
                    : 0);
                // Artistic taper and user-selected visibility narrowing compose
                // by the smaller envelope, never multiply into a thin sliver.
                const scrapeAlpha = (n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0) ? pickScrapeAlpha(n, Tk) : 1;
                const artisticScale = (n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0) ? .35 + .65 * scrapeAlpha : hasSlideCue ? slideCueWidthScaleAt(n, Tk) : 1;
                const yieldScale = Math.min(artisticScale,
                    1 - (1 - yieldSettings.minScale) * yieldAmount);
                if (outlineColors && bodyColors) {
                    const alpha = (n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0) ? scrapeAlpha : hasSlideCue ? slideCueAlphaAt(n, Tk) : 1;
                    for (let j = 0; j < 4; j++) {
                        outlineColors[k * 16 + j * 4 + 3] = alpha;
                        bodyColors[k * 16 + j * 4 + 3] = alpha;
                    }
                }
                const outlineHalfW = outlineTw * yieldScale * 0.5;
                const outlineHalfH = outlineTh * yieldScale * 0.5;
                // Keep the same outer footprint and visibility envelope. A
                // slightly inset body gives the contacted portion a quiet rim.
                const contactInset=contact && Tk>=n.t+contact.start ? .72 : 1;
                const bodyHalfW = bodyTw * yieldScale * 0.5 * contactInset;
                const bodyHalfH = bodyTh * yieldScale * 0.5 * contactInset;
                outlinePositions[v] = outlineX - outlineHalfW;
                bodyPositions[v++] = bodyX - bodyHalfW;
                outlinePositions[v] = yc - outlineHalfH;
                bodyPositions[v++] = yc - bodyHalfH;
                outlinePositions[v] = bodyPositions[v++] = zk;
                outlinePositions[v] = outlineX + outlineHalfW;
                bodyPositions[v++] = bodyX + bodyHalfW;
                outlinePositions[v] = yc - outlineHalfH;
                bodyPositions[v++] = yc - bodyHalfH;
                outlinePositions[v] = bodyPositions[v++] = zk;
                outlinePositions[v] = outlineX + outlineHalfW;
                bodyPositions[v++] = bodyX + bodyHalfW;
                outlinePositions[v] = yc + outlineHalfH;
                bodyPositions[v++] = yc + bodyHalfH;
                outlinePositions[v] = bodyPositions[v++] = zk;
                outlinePositions[v] = outlineX - outlineHalfW;
                bodyPositions[v++] = bodyX - bodyHalfW;
                outlinePositions[v] = yc + outlineHalfH;
                bodyPositions[v++] = yc + bodyHalfH;
                outlinePositions[v] = bodyPositions[v++] = zk;
            }
            outlineGeom.attributes.position.needsUpdate = true;
            bodyGeom.attributes.position.needsUpdate = true;
            if (outlineColors) outlineGeom.attributes.color.needsUpdate = true;
            if (bodyColors) bodyGeom.attributes.color.needsUpdate = true;
            // Normals are pre-baked at geometry creation (see mkSlideRibbonGeo);
            // axis-aligned cross-section means they don't need per-frame recompute.
        }`;

const baseline=source.replace(fn('sustainTrailCenterXAt'),centerBaseline)
 .replace(fn('slideRibbonUpdatePair'),ribbonBaseline);

test('complete production functions preserve the frozen arithmetic and ribbon ordering',()=>{
 const center=fn('sustainTrailCenterXAt').replace('slideSt, trailW, out)','slideSt, trailW)')
  .replace('const value = strandBaseX','return strandBaseX')
  .replace('\n            if (out) { out[0] = value; return; }\n            return value;','');
 assert.equal(center,centerBaseline);
 const ribbon=fn('slideRibbonUpdatePair').replace(`const baseY = y;
                techniqueYOffsetWorld(n, Tk, _sustainYResult);
                const yc = baseY + _sustainYResult[0];`,`const yc = y + techniqueYOffsetWorld(n, Tk);`).replace(`sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, outlineTw, _sustainCenterResult,
                );
                const outlineX = _sustainCenterResult[0];`,`const outlineX = sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, outlineTw,
                );`).replace(`let bodyX = outlineX;
                if (n.tr) {
                    sustainTrailCenterXAt(n, strandBaseX, Tk, slideSt, bodyTw, _sustainCenterResult);
                    bodyX = _sustainCenterResult[0];
                }`,`const bodyX = n.tr ? sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, bodyTw,
                ) : outlineX;`);
 assert.equal(ribbon,ribbonBaseline);
});

function helpers(input=source,zeroOffsets=false){
 return new Function('zeroOffsets',`
  const scratch=new Float64Array(1);let _leftyCached=false;
  const fretMid=f=>f*6+.375,fretX=f=>f*6;
  const slideOutOffsetWorldX=()=>zeroOffsets?0:3.25,slideInOffsetWorldX=()=>zeroOffsets?0:-.75,
   tremoloOffsetWorldX=(n,t,w)=>zeroOffsets?-0:w*.23,pickScrapeOffset=()=>zeroOffsets?0:1.125;
  ${['naturalNode','notePositionX','slideTrailEnd','targetedSlideInterval','slideOffsetWorldX','sustainTrailCenterXAt'].map(n=>fn(n,input)).join('\n')}
  return {center:sustainTrailCenterXAt,lefty(value){_leftyCached=value;},scratch};
 `)(zeroOffsets);
}

test('optional output preserves scalar API and every finite, invalid, open, clamped and zero value',()=>{
 const a=helpers(baseline),b=helpers(),out=new Float64Array(1);
 const notes=[{f:7,sus:2,sl:12},{f:7,sus:2,slu:2},{f:7,sus:2},
  {f:0,sus:2,sl:12},{f:-1,sus:2,sl:12},{f:7,sus:0,sl:12},
  {f:7,sus:-1,sl:12},{f:7,sus:NaN,sl:12},{f:7,sus:Infinity,sl:12},
  {f:NaN,sus:2,sl:12},{f:Infinity,sus:2,sl:12},{f:7,sus:2,sl:NaN},
  {f:7,sus:2,sl:12,slide_interval:{start:.4,end:.6}},
  {f:7,sus:2,sl:12,slide_interval:{start:.4,end:2.001}},
  {f:7,sus:2,sl:12,slide_interval:{start:NaN,end:.6}},
  {f:7,sus:2,sl:12,slu:2,slide_interval:{start:.4,end:.6}},
  {f:7,sus:2,sl:2},{f:7,sus:2,sl:7},{f:7,sus:2,sl:12,hm:true,hn:12}];
 for(const attrs of notes)for(const time of [-Infinity,-0,0,.2,.4,.5,.6,1,2,Infinity,NaN])
 for(const lefty of [false,true])for(const x of [-0,31,NaN,Infinity,-Infinity]){
  const n={t:0,s:2,...attrs};a.lefty(lefty);b.lefty(lefty);
  for(const st of [undefined,null,false,{endFret:12,unpitched:false},
    {endFret:2,unpitched:true},{endFret:NaN,unpitched:false}]){
   const expected=a.center(n,x,time,st,4);
   assert.equal(b.center(n,x,time,st,4),expected,'legacy scalar caller');
   out[0]=123456;
   assert.equal(b.center(n,x,time,st,4,out),undefined,'output mode returns no scalar');
   assert.equal(out[0],expected,'Float64 roundtrip retains NaN, infinities and signed zero');
  }
 }
 const z=helpers(source,true),oldZ=helpers(baseline,true);z.lefty(true);oldZ.lefty(true);
 const n={t:0,f:0,sus:2,slide_out_marks:[{}],slide_in_marks:[{}],tr:true,mt:true,pick_scrape_marks:[{}]};
 assert.ok(Object.is(oldZ.center(n,-0,0,{},0),-0),'signed-zero result is exercised');
 z.center(n,-0,0,{},0,out);assert.ok(Object.is(out[0],-0));
 for(const n of [null,undefined]){
  assert.throws(()=>a.center(n,1,.5,null,4));assert.throws(()=>b.center(n,1,.5,null,4));
  out[0]=123456;assert.throws(()=>b.center(n,1,.5,null,4,out));assert.equal(out[0],123456);
 }
});

test('result is written after nested provider/property effects and consumed without retaining an alias',()=>{
 function run(input,buffered){
  const h=helpers(input),events=[];let nested=false;
  function call(n,x,t,st,w){
   if(buffered){assert.equal(h.center(n,x,t,st,w,h.scratch),undefined);return h.scratch[0];}
   const value=h.center(n,x,t,st,w);h.scratch[0]=value;return value;
  }
  const n=new Proxy({t:0,s:2,f:7,sus:2,sl:12,slide_out_marks:[{}],slide_in_marks:[{}],tr:true},
   {get(target,key){events.push(String(key));if(key==='f'&&!nested){
    nested=true;h.lefty(true);
    events.push(['nested',call({t:0,s:1,f:11,sus:2,sl:3},61,.8,{endFret:3,unpitched:false},2)]);
   }return target[key];}});
  const value=call(n,31,.5,{endFret:12,unpitched:false},4),saved=value;
  const next=call({t:0,f:7,sus:0},-0,0,null,4);
  return {value,saved,next,events};
 }
 assert.deepEqual(run(source,true),run(baseline,false));
 assert.deepEqual(run(source,false),run(baseline,false));
});

async function ribbonHarness(input){
 // Reuse actual production motion providers and geometry writers, not copied math.
 let fixture=fs.readFileSync(path.join(__dirname,'highway_3d_ribbon_center_reuse.test.js'),'utf8');
 fixture=fixture.slice(0,fixture.indexOf('\nfunction checkPair('));
 fixture=fixture.replace(/const source = fs.readFileSync[^;]+;/,'');
 const start=fixture.indexOf('const reusedCenter ='),end=fixture.indexOf('class Attribute',start);
 fixture=fixture.slice(0,start)+'const referenceRibbon=ribbon;\n\n'+fixture.slice(end);
 fixture+='\nmodule.exports=harness;';
 const mod={exports:{}};new Function('require','module','__dirname','source',fixture)(require,mod,__dirname,input);
 return mod.exports(false);
}

test('optional centre storage preserves ordered Float32 geometry for all techniques and state changes',async()=>{
 const a=await ribbonHarness(baseline),b=await ribbonHarness(source);
 const variants=[{}, {tr:false}, {sl:12},{slu:2},{sl:12,slide_interval:{start:1.3,end:1.8}},
  {sl:12,tr:true},{sl:12,bn:1.5,vb:true},{sl:2,hm:true,hn:12},
  {bnv:[{t:0,v:.5},{t:.7,v:2},{t:1.7,v:0}]}, {vb:true},
  {slide_in_marks:[{direction:'up',time:.6}],slide_out_marks:[{direction:'up',start:1.2,end:1.8}],vb:true},
  {mt:true,pick_scrape_marks:[{direction:'up',start:0,end:.9},{direction:'down',start:.9,end:1.8}]},
  {whammy:{version:1,policy:'optional',segments:[{start:0,end:1.8,curve:[{t:0,v:0},{t:1.8,v:-4}]}]}},
  {harmonic_changes:{version:1,events:[{start:.8,end:1.8,source_id:'contact',target:{kind:'artificial',policy:'harmonic',node:12,interval:12}}]}},
  {tr:1,slide_out_marks:[{direction:'up',start:1.2,end:1.8}],tremolo_marks:[
   {start:.2,end:.8,mode:'specified',period:.125,phase:0},{start:.8,end:1.6,mode:'specified',period:.25,phase:0}]}];
 for(const extra of variants)for(let flags=0;flags<16;flags++)for(const now of [9.5,10.25,11.7,10.1]){
  const n={t:10,s:3,f:7,sus:1.8,...extra},before=JSON.stringify(n);
  const options={rs:flags&1,lefty:flags&2,inverted:flags&4,logarithmic:flags&8,
   yield:true,sameString:true,now,start:Math.max(n.t,now),duration:n.t+n.sus-Math.max(n.t,now)};
  assert.deepEqual(b(n,options),a(n,options),'ordered geometry, indices, draw ranges, uploads and call counts');
  assert.equal(JSON.stringify(n),before,'no chart mutation');
 }
 const n={t:10,s:3,f:7,sus:1.8,sl:12};
 for(const [f,sl,sus] of [[7,2,1.8],[0,12,0],[9,15,2],[5,1,1.8]]){
  Object.assign(n,{f,sl,sus});assert.deepEqual(b(n),a(n),'same-note edits cannot reuse a stale result');
 }
});
