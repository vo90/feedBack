const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const start=source.indexOf('function drawTechniqueCaptions()'),open=source.indexOf('{',start);
assert.ok(start>0);let depth=0,end=open;
for(;end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}'&&--depth===0)break;}
const body=source.slice(start,end+1);

test('the renderer capability exposes the shared crisp overlay factory',async()=>{
    const {harmonicContactsApi}=await import('../../static/js/harmonic-contacts.js');
    const {createHarmonicContactOverlay}=await import('../../static/js/harmonic-contact-overlay.js');
    assert.equal(harmonicContactsApi.createOverlay,createHarmonicContactOverlay);
});

test('all 3D captions preserve shared CSS size, user text scale, decimals and fade across projections',()=>{
    for(const scale of [1,.5,.25]) for(const lefty of [false,true]) for(const textScale of [.5,1,1.5]) {
        let frame,gems=[],flushed=false;
        const overlay={beginFrame(w,h,mirrored){frame={w,h,mirrored};gems=[];flushed=false;},
            addGem(g){gems.push(g);},flush(){flushed=true;}};
        const canvas={width:1000*scale,height:800*scale,clientWidth:1000,clientHeight:800};
        const texts=['5','3.2','BAR','AH 17','TH 17','PICK SCRAPE ↘','WAH ○'];
        const labels=texts.map(label=>({x:lefty?-2:2,y:3,z:0,width:1,height:.2,label,opacity:.75}));
        const probe={set(x,y,z){Object.assign(this,{x,y,z});return this;},project(){this.x/=10;this.y/=10;return this;}};
        const make=new Function('captionOverlay','ren','techniqueCaptions','_probe','_textSizeMul',`
            const window={feedBackHarmonicContacts:{captionStyle:{fontSize:14}}};
            const cam={},_incomingLabelOccluderCount=1;
            const _incomingLabelOccluders=[{mesh:{visible:true,material:{opacity:1}}}];
            const _newLabelRect=()=>({});
            const _incomingLabelScreenRect=(mesh,r)=>{Object.assign(r,{minX:-.1,maxX:.1,minY:-.1,maxY:.1});return true;};
            ${body};return drawTechniqueCaptions;`);
        const draw=make(overlay,{domElement:canvas},labels,probe,textScale);draw();
        assert.equal(frame.mirrored,false,'camera has already mirrored the anchor');
        assert.equal(gems.length,texts.length+1,'foreground gem participates in label avoidance');
        assert.ok(Math.abs(gems[1].x/(1000*scale)-(lefty?.4:.6))<1e-10);
        assert.deepEqual(gems.slice(1).map(g=>g.label),texts);
        for(const gem of gems.slice(1)) {
            assert.equal(gem.fontSize*canvas.clientHeight/frame.h,14*textScale);
            assert.equal(gem.opacity,.75);
            assert.ok(gem.rx>0&&gem.ry>0);
        }
        assert(flushed);
        labels.length=0;draw();assert.equal(gems.length,0);assert.equal(flushed,false);
    }
});

test('caption anchor follows visible mesh bounds and drops hidden or offscreen events',()=>{
    const gems=[];
    const mesh={visible:true,material:{opacity:1}};
    const labels=[
        {x:0,y:0,z:0,label:'3.2',mesh,opacity:1},
        {x:0,y:0,z:0,label:'hidden',mesh:{visible:false,material:{opacity:1}}},
        {x:0,y:0,z:2,label:'behind'},
    ];
    const make=new Function('captionOverlay','ren','techniqueCaptions','_probe',`
        const cam={},_textSizeMul=1,_incomingLabelOccluderCount=0;
        const window={},_newLabelRect=()=>({});
        const _incomingLabelScreenRect=(mesh,r,inkOnly)=>{
            if(!inkOnly)throw Error('transparent padding must not separate captions from the note');
            Object.assign(r,{minX:-.2,maxX:.4,minY:-.1,maxY:.3});return true;
        };
        ${body};return drawTechniqueCaptions;`);
    make({beginFrame(){},addGem(g){gems.push(g);},flush(){}},
        {domElement:{width:1000,height:800,clientHeight:800}},labels,
        {set(x,y,z){Object.assign(this,{x,y,z});return this;},project(){return this;}})();
    assert.equal(gems.length,1);
    assert.equal(gems[0].label,'3.2');
    assert.equal(gems[0].x,550);
    assert.equal(gems[0].y,360);
    assert.ok(Math.abs(gems[0].rx-150)<1e-10);
    assert.equal(gems[0].ry,80);
});
