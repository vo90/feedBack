const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const start=source.indexOf('function drawTimedContactLabels()'),open=source.indexOf('{',start);
assert.ok(start>0);let depth=0,end=open;
for(;end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}'&&--depth===0)break;}
const body=source.slice(start,end+1);

test('the renderer capability exposes the shared crisp overlay factory',async()=>{
    const {harmonicContactsApi}=await import('../../static/js/harmonic-contacts.js');
    const {createHarmonicContactOverlay}=await import('../../static/js/harmonic-contact-overlay.js');
    assert.equal(harmonicContactsApi.createOverlay,createHarmonicContactOverlay);
});

test('3D contact projection keeps 14px text at reduced quality and clears after the event',()=>{
    for(const scale of [1,.5,.25]) for(const lefty of [false,true]) {
        let frame,gems=[],flushed=false;
        const overlay={beginFrame(w,h,mirrored){frame={w,h,mirrored};gems=[];flushed=false;},
            addGem(g){gems.push(g);},flush(){flushed=true;}};
        const canvas={width:1000*scale,height:800*scale,clientWidth:1000,clientHeight:800};
        const labels=[{x:lefty?-2:2,y:3,z:0,width:1,height:.2,label:'AH 21'}];
        const probe={set(x,y,z){Object.assign(this,{x,y,z});return this;},project(){this.x/=10;this.y/=10;return this;}};
        const make=new Function('contactOverlay','ren','timedContactLabels','_probe',`
            const cam={},_incomingLabelOccluderCount=1;
            const _incomingLabelOccluders=[{mesh:{visible:true,material:{opacity:1}}}];
            const _newLabelRect=()=>({});
            const _incomingLabelScreenRect=(mesh,r)=>{Object.assign(r,{minX:-.1,maxX:.1,minY:-.1,maxY:.1});return true;};
            ${body};return drawTimedContactLabels;`);
        const draw=make(overlay,{domElement:canvas},labels,probe);draw();
        assert.equal(frame.mirrored,false,'camera has already mirrored the anchor');
        assert.equal(gems.length,2,'foreground gem participates in label avoidance');
        assert.ok(Math.abs(gems[1].x/(1000*scale)-(lefty?.4:.6))<1e-10);
        assert.equal(gems[1].fontSize*canvas.clientHeight/frame.h,14);
        assert.equal(gems[1].label,'AH 21');assert(flushed);
        labels.length=0;draw();assert.equal(gems.length,0);assert.equal(flushed,false);
    }
});
