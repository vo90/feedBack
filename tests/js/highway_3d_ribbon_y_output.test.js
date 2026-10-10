const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8').replace(/\r\n/g,'\n');
function fn(name,input=source){
 const start=input.indexOf('function '+name+'('),open=input.indexOf('{',start);assert.ok(start>=0,name);
 let depth=1,end=open+1;while(depth){if(input[end]==='{')depth++;else if(input[end]==='}')depth--;end++;}
 return input.slice(start,end);
}
// Retained scalar Y/geometry regression coverage from the output-storage experiment.
// Complete, frozen functions from 168c12bed22d9a463d1d3a962fc505056405e2c3.
const yBaseline=`function techniqueYOffsetWorld(n, chartTime) {
            if (!(n?.sus > 0)) return 0;
            const bendSemi = bendSemisAtTime(n, chartTime);
            const vibratoSemi = vibratoSemisAtTime(n, chartTime);
            const barSemi = n.whammy?.version === 1 ? (window.feedBackWhammy?.visual(n,chartTime-n.t) || 0) : 0;
            // The source performer writes bar and finger-bend pitch events
            // separately, not additively. Show the bar contour while it is
            // active; retain the existing bend cue without inventing a sum.
            if (n.whammy?.version === 1 && window.feedBackWhammy?.segment(n,chartTime-n.t)?.curve?.length) {
                return BEND_HALFSTEP_WORLD_Y * barSemi;
            }
            if (bendSemi === 0 && vibratoSemi === 0 && barSemi === 0) return 0;
            return BEND_HALFSTEP_WORLD_Y * (bendVisualDirY(n.s) * (bendSemi + vibratoSemi) + barSemi);
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
                sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, outlineTw, _sustainCenterResult,
                );
                const outlineX = _sustainCenterResult[0];
                // Only tremolo's horizontal motion depends on strand width.
                // Reuse this sample's exact centre for all other techniques.
                let bodyX = outlineX;
                if (n.tr) {
                    sustainTrailCenterXAt(n, strandBaseX, Tk, slideSt, bodyTw, _sustainCenterResult);
                    bodyX = _sustainCenterResult[0];
                }
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

const baseline=source.replace(fn('techniqueYOffsetWorld'),yBaseline).replace(fn('slideRibbonUpdatePair'),ribbonBaseline);
test('scalar Y helper and ribbon retain the established sampling expressions',()=>{
 assert.equal(fn('techniqueYOffsetWorld'),yBaseline);
 assert.equal(fn('slideRibbonUpdatePair'),ribbonBaseline);
});

function helpers(input=source,window={},scale=4.8){
 return new Function('window','BEND_HALFSTEP_WORLD_Y',`
  const BEND_ENV_RISE_FRAC=.35,BEND_ENV_RELEASE_FRAC=.3,VIBRATO_HALF_WAVE_S=.08,nStr=6;
  let _invertedCached=false;
  const _linkedBendStarts=new WeakMap(),_linkedBendEnds=new WeakMap(),_linkedVibratoRuns=new WeakMap();
  ${['bnvSampleAt','bendCurveStartSemis','bendCurveSemisAt','bendSemisAtElapsed','bendSemisAtTime','bendVisualDirY','noteHasVibrato','vibratoSemisAtTime','techniqueYOffsetWorld'].map(n=>fn(n,input)).join('\n')}
  return {y:techniqueYOffsetWorld,inverted(v){_invertedCached=v;},
   starts:_linkedBendStarts,ends:_linkedBendEnds,runs:_linkedVibratoRuns};
 `)(window,scale);
}

test('scalar Y branches preserve finite, nonfinite and signed zero behavior',async()=>{
 const {whammyApi}=await import('../../static/js/whammy.js');
 const a=helpers(baseline,{feedBackWhammy:whammyApi}),b=helpers(source,{feedBackWhammy:whammyApi});
 const variants=[{}, {bn:1.5},{bn:-0},{bn:NaN},{bn:Infinity},
  {bnv:[{t:0,v:1},{t:.7,v:2},{t:1.7,v:0}]},{bnv:[{t:0,v:NaN},{t:1,v:Infinity}]},
  {vb:true},{bn:1,vb:true},{vibrato_marks:[{start:0,end:1.8,intensity:'wide'}]},
  {whammy:{version:1,policy:'optional',segments:[{start:0,end:1.8,curve:[{t:0,v:0},{t:1.8,v:-4}]}]}},
  {whammy:{version:1,policy:'optional',segments:[]}}];
 let negativeZeroInputCases=0;
 for(const attrs of variants)for(const sus of [-1,-0,0,.000001,1.8,NaN,Infinity])
 for(const time of [-Infinity,-0,0,.2,.7,1.2,1.8,Infinity,NaN])for(const inverted of [false,true]){
  const n={t:0,s:3,f:7,sus,...attrs};a.inverted(inverted);b.inverted(inverted);
  const expected=a.y(n,time);assert.equal(b.y(n,time),expected);
  if(Object.is(time,-0)||Object.is(sus,-0))negativeZeroInputCases++;
 }
 assert.ok(negativeZeroInputCases>0);
 for(const n of [null,undefined]){assert.equal(a.y(n,0),0);assert.equal(b.y(n,0),0);}
 // A zero scale also preserves the arithmetic expression's signed zero.
 const window={feedBackWhammy:{visual:()=>1,segment:()=>({curve:[1]})}},n={t:0,sus:1,whammy:{version:1}};
 const oldZ=helpers(baseline,window,-0),newZ=helpers(source,window,-0);
 assert.ok(Object.is(oldZ.y(n,.5),-0));assert.ok(Object.is(newZ.y(n,.5),-0));
});

test('scalar Y follows linked bend and vibrato context, edits and seeks',()=>{
 const a=helpers(baseline),b=helpers(),n={t:10,s:2,f:7,sus:1.8,bn:2,vb:true};
 for(const h of [a,b]){h.starts.set(n,.5);h.ends.set(n,1.25);h.runs.set(n,{offset:1,onset:10,run:{duration:3.2,fadeIn:.08,fadeOut:.08}});}
 for(const t of [9.8,10,10.5,11.7,10.2]){assert.equal(b.y(n,t),a.y(n,t));}
 for(const sus of [0,1.8,-1,2]){n.sus=sus;n.bn+=.25;assert.equal(b.y(n,10.3),a.y(n,10.3));}
 for(const h of [a,b]){h.starts.delete(n);h.ends.delete(n);h.runs.delete(n);}
 assert.equal(b.y(n,10.3),a.y(n,10.3));
});

test('nested whammy callbacks, property effects and thrown exceptions preserve order',()=>{
 function run(input,throws=false){
  const events=[];let h,nested=false;
  function call(n,t){return h.y(n,t);}
  const provider={visual(n,t){events.push(['visual',t]);if(!nested){nested=true;h.inverted(true);events.push(['nested',call({t:0,s:0,sus:1,bn:2},.3)]);}if(throws)throw Error('visual');return -1.25;},
   segment(n,t){events.push(['segment',t]);return {curve:[1]};}};
  h=helpers(input,{get feedBackWhammy(){events.push('provider');return provider;}});
  const whammy={get version(){events.push('version');return 1;}};
  const n=new Proxy({t:0,s:3,sus:1.8,bn:1,whammy},{get(o,k){events.push(String(k));return o[k];}});
  try{return {value:call(n,.5),events};}catch(e){return {error:e.message,events};}
 }
 for(const throws of [false,true])assert.deepEqual(run(source,throws),run(baseline,throws));
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

test('scalar Y sampling preserves ordered Float32 geometry for all techniques and state changes',async()=>{
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
