const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
function extract(name) {
    const a=src.indexOf('function '+name+'('),open=src.indexOf('{',a);let depth=0;
    assert.ok(a>=0,name);
    for(let i=open;i<src.length;i++) {
        if(src[i]==='{')depth++;
        else if(src[i]==='}' && --depth===0)return src.slice(a,i+1);
    }
    throw Error(name);
}
const factory=new Function('fretMid','notePositionX',
    ['slideTrailEnd','targetedSlideInterval','appendTargetedSlideContourTimes','slideOffsetWorldX'].map(extract).join('\n')+
    ';return {slideOffsetWorldX,appendTargetedSlideContourTimes};');
const {slideOffsetWorldX:offset,appendTargetedSlideContourTimes:samples}=factory(f=>f*10,n=>n.f*10);
test('held fret remains still until slide segment; up/down, open target, shift and legato',()=>{
    for(const target of [0,5,9])for(const ln of [false,true]) {
        const n={t:10,sus:3,f:7,sl:target,ln,slide_interval:{start:2,end:3}};
        for(const t of [9,10,11,12])assert.ok(offset(n,t)===0);
        assert.ok(Math.abs(offset(n,12.5)-(target-7)*10*Math.SQRT1_2**3)<1e-9);
        assert.equal(offset(n,13),(target-7)*10);assert.equal(offset(n,14),(target-7)*10);
    }
});
test('short final interval gets boundary samples without moving held section',()=>{
    const n={t:0,sus:10,f:7,sl:9,slide_interval:{start:9.99,end:10}},out=[];
    samples(n,0,11,out);assert.equal(out[0],9.99);assert.equal(out.at(-1),10);assert.equal(out.length,9);
    assert.equal(offset(n,9.98),0);assert.equal(offset(n,10),20);
});
test('legacy and unpitched slides retain whole-sustain motion',()=>{
    const n={t:10,sus:3,f:7,sl:9};
    assert.ok(Math.abs(offset(n,11.5)-20*Math.SQRT1_2**3)<1e-9);
    assert.equal(offset({...n,slide_interval:{start:3,end:2}},11.5),offset(n,11.5));
    const u={...n,sl:-1,slu:9};
    assert.equal(offset({...u,slide_interval:{start:2,end:3}},11.5),offset(u,11.5));
});
test('all geometry consumers keep the interval, including pooled chord notes',()=>{
    assert.match(src,/_scrChordNote\.slide_interval = cn\.slide_interval/);
    assert.match(extract('slideRibbonSampleTimes'),/appendTargetedSlideContourTimes/);
    assert.match(extract('slideOutCrossingTimes'),/appendTargetedSlideContourTimes\(source/);
    assert.match(extract('slideOutCrossingTimes'),/appendTargetedSlideContourTimes\(target/);
    assert.match(extract('appendLinkedTrailContourTimes'),/appendTargetedSlideContourTimes/);
});
