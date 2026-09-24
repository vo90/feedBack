const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.join(__dirname,'../../static/js/harmonic-contact-overlay.js')).href);

function host() {
    const texts=[],layers=[];
    const ctx={setTransform(){},clearRect(){texts.length=0;},measureText:t=>({width:t.length*7}),
        fillText(text,x,y){texts.push({text,x,y,font:this.font});},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
    const doc={defaultView:{devicePixelRatio:2},createElement(){return {style:{},setAttribute(){},getContext:()=>ctx,remove(){layers.splice(layers.indexOf(this),1);}};}};
    return {canvas:{ownerDocument:doc,parentElement:{appendChild:l=>layers.push(l)},clientWidth:1000,clientHeight:800,offsetLeft:12,offsetTop:34,style:{}},texts,layers};
}

test('contact placement avoids a neighboring gem, keeps labels inside the viewport',async()=>{
    const {placeContactLabel}=await modulePromise;
    const own={x:440,y:340,w:100,h:100},neighbor={x:515,y:435,w:100,h:100};
    const label=placeContactLabel(own,85,34,[own,neighbor],{w:1000,h:800});
    for(const b of [own,neighbor]) assert.ok(label.x+label.w<=b.x||label.x>=b.x+b.w||label.y+label.h<=b.y||label.y>=b.y+b.h);
    const edge=placeContactLabel({x:980,y:770,w:20,h:25},100,35,[],{w:1000,h:800});
    assert.ok(edge.x>=0&&edge.y>=0&&edge.x+edge.w<=1000&&edge.y+edge.h<=800);
});

test('overlay keeps crisp, compact text at every backing resolution and mirrors the anchor only',async()=>{
    const {createHarmonicContactOverlay}=await modulePromise;
    for(const scale of [1,.5,.25]) for(const lefty of [false,true]) {
        const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
        overlay.beginFrame(1000*scale,800*scale,lefty);
        overlay.addGem({x:250*scale,y:300*scale,rx:24*scale,ry:24*scale,label:'AH 31.7',fontSize:12*scale,pm:true});
        overlay.flush();
        assert.equal(h.layers.length,1);assert.equal(h.layers[0].width,2000);assert.equal(h.layers[0].height,1600);
        assert.deepEqual(h.texts.map(t=>t.text),['PM','AH 31.7']);
        for(const t of h.texts) {assert.equal(t.font,'bold 12px sans-serif');assert.equal(t.x,lefty?750:250);}
        assert.ok(h.texts[1].y>h.texts[0].y+12);
        assert.equal(h.layers[0].style.pointerEvents,'none');
        overlay.beginFrame(1000,800,false);overlay.flush();assert.equal(h.layers[0].style.display,'none');
        overlay.destroy();assert.equal(h.layers.length,0);
    }
});

test('independent owners resize without leaking labels across views or instances',async()=>{
    const {createHarmonicContactOverlay}=await modulePromise;
    const a=host(),b=host(),oa=createHarmonicContactOverlay(a.canvas),ob=createHarmonicContactOverlay(b.canvas);
    oa.beginFrame(1000,800,false);oa.addGem({x:250,y:300,rx:20,ry:20,label:'TH 12',fontSize:12});oa.flush();
    ob.beginFrame(1000,800,false);ob.flush();assert.equal(b.layers.length,0);
    a.canvas.clientWidth=500;a.canvas.clientHeight=400;oa.flush();
    assert.equal(a.layers[0].width,1000);assert.equal(a.layers[0].height,800);
    oa.destroy();oa.destroy();ob.destroy();assert.equal(a.layers.length,0);
});
