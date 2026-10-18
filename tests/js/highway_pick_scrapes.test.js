const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const geometry=fs.readFileSync(path.join(__dirname,'../../static/js/pick-scrapes.js'),'utf8').replace(/export /g,'');
function fn(name){const a=source.indexOf('function '+name+'('), b=source.indexOf('{',a);let d=0;
    assert.ok(a>=0,name);for(let i=b;i<source.length;i++){if(source[i]==='{')d++;if(source[i]==='}'&&--d===0)return source.slice(a,i+1);}throw Error(name);}
const kernel=new Function(geometry+';return {isPickScrape,scrapeAt,scrapeProgress,scrapePosition,scrapeFade,scrapeCueMark,scrapeCaption,scrapeGroupKey};')();
function renderer(lefty=false){
    const block=source.slice(source.indexOf('    function slideTrailEnd('),source.indexOf('    // Camera tgtDist building blocks'));
    class Attribute{constructor(array,itemSize){this.array=array;this.itemSize=itemSize;this.count=array.length/itemSize;}}
    return new Function('scrapeGeometry','T',`
        const NW=5,SLIDE_RIBBON_SAMPLES=96,_leftyCached=${lefty},_slideRibbonTimesScratch=[];
        const fretX=f=>f*10,fretMid=fretX,dZ=t=>-230*t,techniqueYOffsetWorld=()=>0;
        // Production chart-anchor selection is covered by the browser fixture.
        // This nonzero anchor isolates ribbon geometry from camera/strand state.
        const pickScrapeAnchorX=()=>_leftyCached?-37:37;
        const TRAIL_YIELD_DEFAULTS={minScale:.3,leadTime:.5,taperDuration:.05,holdAfter:.05,recoverDuration:.05,endLeadTime:.5,endTaperDuration:.05};
        ${fn('hwySmoothstep01')}${fn('hwyTrailYieldAmountAt')}${fn('hwyAppendTrailYieldContourTimes')}
        ${block}${fn('sustainTrailCenterXAt')}${fn('ensureSlideRibbonCapacity')}${fn('slideRibbonUpdatePair')}
        return {slideRibbonUpdatePair,sustainTrailCenterXAt,slideRibbonSampleTimes};`)(kernel,{Float32BufferAttribute:Attribute});
}
function mesh(){return {userData:{},attributes:{position:{count:0,array:[]},color:{array:[]}},setAttribute(k,v){this.attributes[k]=v;},setIndex(){},setDrawRange(){}};}
const make=(direction='down',f=34)=>({t:10,s:0,f,mt:true,sus:2,pick_scrape_marks:[{direction,start:0,end:2}]});
test('rough texture stays compact around a fixed anchor without inventing a directional fret path',()=>{
    for(const f of [0,19,34,127])for(const dir of ['up','down']){
        const n=make(dir,f),r=renderer(),left=renderer(true);
        assert.equal(r.sustainTrailCenterXAt(n,0,10,null,2),37);
        assert.equal(r.sustainTrailCenterXAt(n,0,12,null,2),37);
        let min=Infinity,max=-Infinity;
        for(let i=0;i<=200;i++) {
            const time=10+i/100,center=r.sustainTrailCenterXAt(n,900,time,null,2);
            min=Math.min(min,center);max=Math.max(max,center);
            assert.ok(Math.abs(center-37)<=.4+1e-9,'texture stays within eight percent of note width');
            assert.equal(center,r.sustainTrailCenterXAt(n,-900,time,null,2),'live strand/camera base is ignored');
            assert.equal(center,r.sustainTrailCenterXAt(make(dir==='up'?'down':'up',f),0,time,null,2));
            assert.equal(left.sustainTrailCenterXAt(n,0,time,null,2),-center);
        }
        assert.ok(min<36.9&&max>37.1,'the duration ribbon retains visible roughness');
        assert.equal(n.f,f);
    }
});
test('actual ribbon uses authored duration, fades body and border together, and composes visibility widths',()=>{
    const n=make(),r=renderer(),out=mesh(),body=mesh();
    r.slideRibbonUpdatePair(out,body,0,4.4,1.4,4,1,0,2,10,10,n,null,[10],[12],1,12);
    const times=r.slideRibbonSampleTimes(n,10,2,[]);
    assert.equal(times[0],10);assert.equal(times.at(-1),12);
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
    assert.equal(kernel.scrapeAt(n,1),n.pick_scrape_marks[1],'new interval owns the exact tied boundary');
    assert.equal(kernel.scrapeCaption(n,-1),'PICK SCRAPE ↗');
    assert.equal(kernel.scrapeCaption(n,1-1e-6),'PICK SCRAPE ↗');
    assert.equal(kernel.scrapeCaption(n,1),'PICK SCRAPE ↘');
    assert.equal(kernel.scrapeCaption(n,1+1e-6),'PICK SCRAPE ↘');
    assert.equal(n.t,10);assert.equal(n.pick_scrape_marks.length,2);
    r.sustainTrailCenterXAt(n,0,11.8,null,2);
    assert.equal(r.sustainTrailCenterXAt(n,0,10.7,null,2),before);
});

test('fractional clock cancellation preserves the final interval and its faded fixed endpoint',()=>{
    const n=make('up');n.t=241.354;n.sus=.21875;n.pick_scrape_marks[0].end=n.sus;
    const elapsed=n.t+n.sus-n.t,mark=kernel.scrapeAt(n,elapsed);
    assert.equal(mark,n.pick_scrape_marks[0]);
    assert.ok(kernel.scrapeFade(n,mark,kernel.scrapeProgress(mark,elapsed))<1e-10);
    assert.ok(Math.abs(renderer().sustainTrailCenterXAt(n,0,n.t+n.sus,null,2)-37)<1e-7);
});

test('caption grouping requires the same onset, duration and complete direction intervals',()=>{
    const n=make(),key=kernel.scrapeGroupKey(n);
    assert.equal(key,kernel.scrapeGroupKey({...n,s:3,f:0}));
    assert.notEqual(key,kernel.scrapeGroupKey({...n,t:11}));
    assert.notEqual(key,kernel.scrapeGroupKey({...n,sus:3}));
    assert.notEqual(key,kernel.scrapeGroupKey({...n,pick_scrape_marks:[{direction:'down',start:0,end:1}]}));
    assert.notEqual(key,kernel.scrapeGroupKey(make('up')));
    assert.notEqual(key,kernel.scrapeGroupKey({...n,pick_scrape_marks:[
        {direction:'down',start:0,end:1},{direction:'up',start:1,end:2}]}));
    assert.equal(key,kernel.scrapeGroupKey({...n,t:99},10),'chord onset can override member time');
});

test('2D scrape strings follow inversion and instrument size, with lefty applied only by the parent canvas',()=>{
    const draw=fs.readFileSync(path.join(__dirname,'../../static/js/highway-draw.js'),'utf8');
    const block=draw.slice(draw.indexOf('export function drawPickScrape2D('),draw.indexOf('export function drawSustains(')).replace(/export /g,'');
    const render=new Function(`${geometry};const VISIBLE_SECONDS=5,project=()=>({y:.5,scale:1});
        const fillTextReadable=(hw,text,x,y)=>hw.labels.push({text,x,y,color:hw.ctx.fillStyle});${block};return drawPickScrape2D;`)();
    function labels(inverted=false,lefty=false,stringCount=4,currentTime=9,n=make()) {
        const noop=()=>{}, hw={currentTime,stringCount,_inverted:inverted,_lefty:lefty,labels:[],STRING_COLORS:['#ff1122'],
            ctx:{save:noop,restore:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop}};
        render(hw,1000,600,n); return hw.labels;
    }
    const normal=labels(),inverted=labels(true);
    assert.equal(normal[0].text,'X'); assert.equal(normal[1].text,'PICK SCRAPE ↘');
    assert.equal(normal[0].color,'#ff1122');assert.equal(normal[1].color,'#fff');
    for(const time of [9,10,10.3,11.1,11.9])for(const f of [0,18,34,127]) {
        const at=labels(false,false,4,time,make('up',f));
        assert.equal(at[0].x,500,'head stays centered throughout the gesture, ignoring hidden source frets');
        assert.equal(at[1].x,500);
    }
    const reversal={...make('up'),pick_scrape_marks:[
        {direction:'up',start:0,end:1},{direction:'down',start:1,end:2}]};
    assert.equal(labels(false,false,4,10.99,reversal)[1].text,'PICK SCRAPE ↗');
    assert.equal(labels(false,false,4,11,reversal)[1].text,'PICK SCRAPE ↘');
    assert.equal(labels(false,false,4,10.99,reversal)[1].text,'PICK SCRAPE ↗','backward seek restores the source cue');
    assert.equal(normal[0].y,283.5); assert.equal(inverted[0].y,316.5);
    assert.equal(labels(false,false,7)[0].y,267);
    assert.deepEqual(labels(false,true),normal,'parent transform handles mirroring exactly once');
});

test('2D simultaneous scrape strings retain both trails and Xs with one readable caption',()=>{
    const draw=fs.readFileSync(path.join(__dirname,'../../static/js/highway-draw.js'),'utf8');
    const block=draw.slice(draw.indexOf('export function drawPickScrape2D('),draw.indexOf('export function drawNotes(')).replace(/export /g,'');
    const render=new Function(`${geometry};const VISIBLE_SECONDS=5,project=()=>({y:.5,scale:.4});
        const fillTextReadable=(hw,text,x,y)=>hw.labels.push({text,x,y,color:hw.ctx.fillStyle});${block};return drawSustains;`)();
    for(const inverted of [false,true])for(const asChord of [false,true]) {
        const noop=()=>{}, notes=[make(),{...make(),s:1}], hw={currentTime:9,stringCount:6,_inverted:inverted,
            labels:[],STRING_COLORS:['#ff1122','#33ff44'],_xfNotes:null,_filteredNotes:null,_xfChords:null,_filteredChords:null,
            notes:asChord?[]:notes,chords:asChord?[{t:10,notes}]:[],strokes:0,
            ctx:{save:noop,restore:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:()=>hw.strokes++}};
        render(hw,1000,600);
        const xs=hw.labels.filter(l=>l.text==='X'),labels=hw.labels.filter(l=>l.text==='PICK SCRAPE ↘');
        assert.equal(xs.length,2); assert.equal(labels.length,1); assert.equal(hw.strokes,144);
        assert.deepEqual(xs.map(x=>x.color),['#ff1122','#33ff44']);
        assert.ok(labels[0].y < Math.min(...xs.map(x=>x.y))-10);
        notes[1]={...notes[1],sus:1,pick_scrape_marks:[{direction:'down',start:0,end:1}]};
        hw.labels=[];render(hw,1000,600);
        assert.equal(hw.labels.filter(l=>l.text.startsWith('PICK SCRAPE')).length,2,'different durations keep separate captions');
    }
});
