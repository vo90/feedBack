const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const modulePromise=import(pathToFileURL(path.join(__dirname,'../../static/js/harmonic-contact-overlay.js')).href);

function host() {
    const texts=[],outlines=[],rectangles=[],leaders=[],layers=[];
    const ctx={setTransform(){},clearRect(){texts.length=0;outlines.length=0;rectangles.length=0;leaders.length=0;},
        measureText(text){
            const font=parseFloat(this.font.split(' ')[1]);
            return {width:text.length*font*.5,actualBoundingBoxAscent:font*.7,actualBoundingBoxDescent:0};
        },
        fillText(text,x,y){texts.push({text,x,y,font:this.font,color:this.fillStyle,alpha:this.globalAlpha});},
        strokeText(text,x,y){outlines.push({text,x,y,color:this.strokeStyle,width:this.lineWidth,alpha:this.globalAlpha});},
        fillRect(...args){rectangles.push(args);},beginPath(){},moveTo(){},lineTo(){},stroke(){leaders.push(true);}};
    const doc={defaultView:{devicePixelRatio:2},createElement(){return {style:{},setAttribute(){},getContext:()=>ctx,remove(){layers.splice(layers.indexOf(this),1);}};}};
    return {canvas:{ownerDocument:doc,parentElement:{appendChild:l=>layers.push(l)},clientWidth:1000,clientHeight:800,offsetLeft:12,offsetTop:34,style:{}},texts,outlines,rectangles,leaders,layers,ctx};
}

function overlaps(a,b) {
    return a.x+a.w>b.x&&a.x<b.x+b.w&&a.y+a.h>b.y&&a.y<b.y+b.h;
}
function textBounds(t,style) {
    const font=parseFloat(t.font.split(' ')[1]),outline=style.outlineWidth*font/style.fontSize;
    const w=t.text.length*font*.5+outline,h=font*.7+outline;
    return {x:t.x-w/2,y:t.y-font*.7-outline/2,w,h};
}

test('contact placement stays close above its own gem and avoids neighboring gems and captions',async()=>{
    const {placeContactLabel,techniqueCaptionStyle:style}=await modulePromise;
    const own={x:440,y:340,w:100,h:100};
    const close=placeContactLabel(own,85,34,[own],{w:1000,h:800});
    assert.equal(close.x+close.w/2,own.x+own.w/2);
    assert.equal(close.y+close.h,own.y-style.gap);
    const neighbor={x:430,y:310,w:130,h:25},caption={x:400,y:270,w:140,h:30};
    const label=placeContactLabel(own,85,34,[own,neighbor,caption],{w:1000,h:800});
    for(const b of [own,neighbor,caption]) assert.ok(!overlaps(label,b));
});

test('placement stays inside the viewport even for edge anchors and oversized boxes',async()=>{
    const {placeContactLabel}=await modulePromise;
    for(const anchor of [{x:980,y:770,w:20,h:25},{x:-5,y:0,w:20,h:20}]) {
        for(const size of [{w:100,h:35},{w:2000,h:900}]) {
            const box=placeContactLabel(anchor,size.w,size.h,[anchor],{w:1000,h:800});
            assert.ok(box.x>=0&&box.y>=0&&box.x+box.w<=1000&&box.y+box.h<=800);
        }
    }
});

test('crowded placement is deterministic and does not overlap when an adjacent opening exists',async()=>{
    const {placeContactLabel}=await modulePromise;
    const own={x:440,y:340,w:100,h:100},neighbor={x:430,y:280,w:130,h:55};
    const label=placeContactLabel(own,85,34,[own,neighbor],{w:1000,h:800});
    assert.deepEqual(label,placeContactLabel(own,85,34,[own,neighbor],{w:1000,h:800}));
    for(const b of [own,neighbor]) assert.ok(!overlaps(label,b));
});

test('overlay keeps crisp, compact text at every backing resolution and mirrors the anchor only',async()=>{
    const {createHarmonicContactOverlay,techniqueCaptionStyle:style}=await modulePromise;
    for(const scale of [1,.5,.25]) for(const lefty of [false,true]) {
        const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
        overlay.beginFrame(1000*scale,800*scale,lefty);
        overlay.addGem({x:250*scale,y:300*scale,rx:24*scale,ry:24*scale,label:'AH 31.7',fontSize:14*scale,pm:true});
        overlay.flush();
        assert.equal(h.layers.length,1);assert.equal(h.layers[0].width,2000);assert.equal(h.layers[0].height,1600);
        assert.deepEqual(h.texts.map(t=>t.text),['PM','AH 31.7']);
        for(const t of h.texts) {
            assert.equal(t.font,'bold 14px Arial, sans-serif');
            assert.equal(t.x,lefty?750:250);assert.equal(t.color,style.color);
        }
        assert.ok(h.texts[1].y>h.texts[0].y+14);
        assert.equal(h.leaders.length,0);
        assert.equal(h.rectangles.length,0);
        assert.equal(h.layers[0].style.pointerEvents,'none');
        overlay.beginFrame(1000,800,false);overlay.flush();assert.equal(h.layers[0].style.display,'none');
        overlay.destroy();assert.equal(h.layers.length,0);
    }
});

test('natural decimals and every technique share white outlined text and the same compact gap',async()=>{
    const {createHarmonicContactOverlay,techniqueCaptionStyle:style}=await modulePromise;
    const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
    const captions=['5','3.2','4.7','BAR','AH 17','TH 12','PICK SCRAPE','WAH','AH 31.7'];
    overlay.beginFrame(1000,800,false);
    captions.forEach((label,i)=>overlay.addGem({
        x:100+(i%3)*300,y:150+Math.floor(i/3)*200,rx:20,ry:20,label,fontSize:style.fontSize,
    }));
    overlay.flush();
    assert.equal(h.texts.length,captions.length);
    assert.deepEqual(h.texts.map(t=>t.text).sort(),[...captions].sort());
    for(const text of h.texts) {
        const i=captions.indexOf(text.text),box=textBounds(text,style);
        assert.equal(text.font,'bold 14px Arial, sans-serif');
        assert.equal(text.color,style.color);
        assert.ok(Math.abs(box.y+box.h-(150+Math.floor(i/3)*200-20-style.gap))<1e-9);
    }
    assert.equal(h.outlines.length,h.texts.length);
    for(const outline of h.outlines) {
        assert.equal(outline.color,style.outlineColor);assert.equal(outline.width,style.outlineWidth);
    }
    assert.equal(h.rectangles.length,0);
    assert.equal(h.leaders.length,0);
});

test('captions preserve text-size multipliers and apply their own fade opacity without leaking it',async()=>{
    const {createHarmonicContactOverlay}=await modulePromise;
    const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
    overlay.beginFrame(1000,800,false);
    overlay.addGem({x:200,y:300,rx:20,ry:20,label:'3.2',fontSize:28,opacity:.25});
    overlay.addGem({x:500,y:300,rx:20,ry:20,label:'WAH',fontSize:7});
    overlay.addGem({x:800,y:300,rx:20,ry:20,label:'HIDDEN',fontSize:14,opacity:0});
    overlay.flush();
    assert.deepEqual(h.texts.map(t=>[t.text,t.font,t.alpha]),[
        ['3.2','bold 28px Arial, sans-serif',.25],['WAH','bold 7px Arial, sans-serif',1],
    ]);
    assert.deepEqual(h.outlines.map(t=>t.alpha),[.25,1]);
    assert.equal(h.ctx.globalAlpha,1);
});

test('overlay avoids obstacle-only gems and previously placed captions',async()=>{
    const {createHarmonicContactOverlay,techniqueCaptionStyle:style}=await modulePromise;
    const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
    overlay.beginFrame(1000,800,false);
    const gems=[
        {x:500,y:340,rx:20,ry:20,label:'PICK SCRAPE',fontSize:14},
        {x:510,y:335,rx:20,ry:20,label:'AH 17',fontSize:14},
        {x:500,y:300,rx:40,ry:15},
    ];
    gems.forEach(g=>overlay.addGem(g));overlay.flush();
    const labels=h.texts.map(t=>textBounds(t,style));
    const bounds=gems.map(g=>({x:g.x-g.rx,y:g.y-g.ry,w:2*g.rx,h:2*g.ry}));
    assert.equal(labels.length,2);
    for(const box of labels) for(const gem of bounds) assert.ok(!overlaps(box,gem));
    assert.ok(!overlaps(labels[0],labels[1]));
    assert.equal(h.rectangles.length,0);
});

test('a caption larger than the viewport is fitted inside it without truncating decimal text',async()=>{
    const {createHarmonicContactOverlay,techniqueCaptionStyle:style}=await modulePromise;
    const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
    h.canvas.clientWidth=120;h.canvas.clientHeight=60;
    overlay.beginFrame(120,60,false);
    overlay.addGem({x:60,y:45,rx:8,ry:8,label:'AH 31.7',fontSize:140});
    overlay.flush();
    assert.equal(h.texts[0].text,'AH 31.7');
    const box=textBounds(h.texts[0],style);
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.w<=120&&box.y+box.h<=60);
});

test('2D attack and delayed-contact callers retain the shared visible size at reduced backing quality',async()=>{
    const {drawNote,drawHarmonicContact2D}=await import('../../static/js/highway-draw.js');
    const {createHarmonicContactOverlay}=await modulePromise;
    for(const quality of [1,.5,.25]) for(const distanceScale of [.2,.5,1]) {
        const h=host(),overlay=createHarmonicContactOverlay(h.canvas);
        h.canvas.clientHeight=900;
        const W=1000*quality,H=900*quality;
        const queued=[],ctx=new Proxy({}, {get:(obj,key)=>key in obj?obj[key]:()=>{},
            set:(obj,key,value)=>{obj[key]=value;return true;}});
        const state={ctx,canvas:h.canvas,currentTime:10,displayMaxFret:24,
            STRING_COLORS:['#f00'],STRING_DIM:['#300'],STRING_BRIGHT:['#fff'],
            _harmonicContactOverlay:{addGem:g=>{queued.push(g);overlay.addGem(g);}}};
        overlay.beginFrame(W,H,false);
        drawNote(state,W,H,250*quality,450*quality,distanceScale,0,5,
            {harmonic_target:{kind:'artificial',node:12}},null);
        const contact={t:10,s:0,f:5,sus:2,harmonic_changes:{version:1,events:[
            {start:.15,end:2,source_id:'contact',
                target:{kind:'artificial',node:7,interval:19,policy:'harmonic'}}]}};
        drawHarmonicContact2D(state,W,H,contact);
        overlay.flush();
        assert.deepEqual(queued.filter(g=>g.label).map(g=>g.fontSize),[14*quality,14*quality]);
        assert.deepEqual(h.texts.map(t=>t.text).sort(),['AH 12','AH 17']);
        assert.ok(h.texts.every(t=>t.font==='bold 14px Arial, sans-serif'));
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
