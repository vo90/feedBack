const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const geometry=fs.readFileSync(path.join(__dirname,'../../static/js/pick-scrapes.js'),'utf8').replace(/export /g,'');
function fn(name){const a=source.indexOf('function '+name+'('), b=source.indexOf('{',a);let d=0;
    assert.ok(a>=0,name);for(let i=b;i<source.length;i++){if(source[i]==='{')d++;if(source[i]==='}'&&--d===0)return source.slice(a,i+1);}throw Error(name);}
const kernel=new Function(geometry+';return {isPickScrape,scrapeAt,scrapeProgress,scrapePosition,scrapeFade};')();
function renderer(lefty=false){
    const block=source.slice(source.indexOf('    function slideTrailEnd('),source.indexOf('    // Camera tgtDist building blocks'));
    class Attribute{constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}}
    return new Function('scrapeGeometry','T',`
        const NW=5,SLIDE_RIBBON_SAMPLES=96,_leftyCached=${lefty},_slideRibbonTimesScratch=[];
        const fretX=f=>f*10,fretMid=fretX,dZ=t=>-230*t,techniqueYOffsetWorld=()=>0;
        const TRAIL_YIELD_DEFAULTS={minScale:.3,leadTime:.5,taperDuration:.05,holdAfter:.05,recoverDuration:.05,endLeadTime:.5,endTaperDuration:.05};
        ${fn('hwySmoothstep01')}${fn('hwyTrailYieldAmountAt')}${fn('hwyAppendTrailYieldContourTimes')}
        ${block}${fn('sustainTrailCenterXAt')}${fn('ensureSlideRibbonCapacity')}${fn('slideRibbonUpdatePair')}
        return {slideRibbonUpdatePair,sustainTrailCenterXAt,slideRibbonSampleTimes};`)(kernel,{Float32BufferAttribute:Attribute});
}
function mesh(){return {userData:{},attributes:{position:{count:0,array:[]},color:{array:[]}},setAttribute(k,v){this.attributes[k]=v;},setIndex(){},setDrawRange(){}};}
const make=(direction='down',f=34)=>({t:10,s:0,f,mt:true,sus:2,pick_scrape_marks:[{direction,start:0,end:2}]});
test('bounded path ignores hidden source frets, mirrors, and reverses direction',()=>{
    for(const f of [0,19,34,127])for(const dir of ['up','down']){
        const n=make(dir,f),r=renderer(),left=renderer(true);
        const start=r.sustainTrailCenterXAt(n,0,10,null,2),end=r.sustainTrailCenterXAt(n,0,12,null,2);
        assert.equal(Math.sign(end-start),dir==='up'?1:-1);
        assert.ok(Math.abs(start)<=8.6&&Math.abs(end)<=8.6);
        assert.equal(left.sustainTrailCenterXAt(n,0,11.6,null,2),-r.sustainTrailCenterXAt(n,0,11.6,null,2));
        assert.equal(n.f,f);
    }
});
test('actual ribbon uses authored duration, fades body and border together, and composes visibility widths',()=>{
    const n=make(),r=renderer(),out=mesh(),body=mesh();
    r.slideRibbonUpdatePair(out,body,0,4.4,1.4,4,1,0,2,10,10,n,null,[10],[12],1,12);
    const times=r.slideRibbonSampleTimes(n,10,2,[]);
    const last=body.userData.ribbonSlices;
    assert.equal(body.attributes.position.array[last*12+2],-460);
    assert.equal(body.attributes.color.array[last*16+3],0);
    assert.equal(out.attributes.color.array[last*16+3],0);
    let mid=0;
    while(mid<last&&Math.abs(body.attributes.position.array[mid*12+2]+230)>1e-4)mid++;
    const width=body.attributes.position.array[mid*12+3]-body.attributes.position.array[mid*12];
    assert.ok(Math.abs(width-1.2)<1e-5,'visibility minimum applied once');
});
test('a tied reversal is continuous, does not invent an attack and remains deterministic across seeks',()=>{
    const n=make('up');n.pick_scrape_marks=[{direction:'up',start:0,end:1},{direction:'down',start:1,end:2}];
    const r=renderer(),before=r.sustainTrailCenterXAt(n,0,10.7,null,2);
    assert.ok(Math.abs(r.sustainTrailCenterXAt(n,0,11-1e-8,null,2)-r.sustainTrailCenterXAt(n,0,11+1e-8,null,2))<1e-4);
    assert.equal(kernel.scrapeFade(n,n.pick_scrape_marks[0],1),1);
    r.sustainTrailCenterXAt(n,0,11.8,null,2);
    assert.equal(r.sustainTrailCenterXAt(n,0,10.7,null,2),before);
});

test('fractional clock cancellation cannot pull the faded endpoint back to the centre',()=>{
    const n=make('up');n.t=241.354;n.sus=.21875;n.pick_scrape_marks[0].end=n.sus;
    assert.ok(Math.abs(renderer().sustainTrailCenterXAt(n,0,n.t+n.sus,null,2)-8)<1e-7);
});
