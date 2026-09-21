const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function harness() {
    return new Function(`
        let rsPlusNotation=false, nStr=6, _ctxLost=false, hwThemeId='default';
        let slideArrowApproachVisible=false, slideArrowNeckVisible=false;
        let activePalette=[0xee1133,0xeed133,0x1188dd,0xee8811,0x11bb44,0xbb44ee,0x55dddd,0xdd77aa];
        let _bgPaletteSig=activePalette.join(',');
        let _rsPrewarmBundle=null, _rsPrewarmState=null, _rsPrewarmLabelModes=0;
        const NFRETS=24, FRET_LABEL_RS_IDLE_HEX='#c0c3c7';
        const FRET_LABEL_GOLD_HEX='#D8A636', FRET_LABEL_IDLE_HEX='#9ab8cc';
        const _techMatCache=new Map(), textCache=new Map(), uploads=[], warnings=[];
        let canvases=0;
        const context=new Proxy({}, {get(target,key){return key in target?target[key]:(()=>{});}});
        const document={createElement(){canvases++;return {width:0,height:0,getContext(){return context;}};}};
        const T={SRGBColorSpace:'srgb',CanvasTexture:class{constructor(image){this.image=image;}},
            SpriteMaterial:class{constructor(props){Object.assign(this,props);this.userData={};}}};
        const console={warn(...args){warnings.push(args);}};
        let ren={initTexture(texture){uploads.push(texture);}};
        const validString=s=>Number.isInteger(s)&&s>=0&&s<nStr;
        const fretMid=f=>Number(f);
        function txtMat(text,color,wide,style){
            const key=text+'|'+color+'|'+style;
            if(!textCache.has(key))textCache.set(key,{map:{key}});
            return textCache.get(key);
        }
        ${['isPlayableFret','isUnpitchedMute','isRenderableNote','slideTrailEnd',
            'rsPlusTechniqueFlags','rsPlusTechniqueCells','rsPlusTechniqueColor',
            'drawRsPlusTechniqueGlyph','rsPlusTechniqueMat','rsPlusNoteFaceMat',
            '_usesRsDefaultHighway','_highwayReferenceLabelColor','chordTemplateLabel',
            '_prewarmTex','_resetRsNotationPrewarm','_prewarmRsNotation'].map(fn).join('\n')}
        return {
            warm(bundle){_prewarmRsNotation(bundle);},
            settings(next){
                if('style' in next)rsPlusNotation=next.style;
                if('theme' in next)hwThemeId=next.theme;
                if('arrows' in next)slideArrowApproachVisible=next.arrows;
                if('strings' in next)nStr=next.strings;
                if('palette' in next){activePalette=next.palette;_bgPaletteSig=activePalette.join(',');}
                _prewarmRsNotation(_rsPrewarmBundle);
            },
            drawMask(flags,string=0){return rsPlusNoteFaceMat(flags,activePalette[string]);},
            drawBend(steps,string=0){return rsPlusTechniqueMat('bend',activePalette[string],steps);},
            uploadsFor(mat){return uploads.filter(texture=>texture===mat.map).length;},
            cached(code,string=0){return _techMatCache.get(-(activePalette[string]*1024+code+1));},
            restoreContext(){_resetRsNotationPrewarm();uploads.length=0;},
            reinit(){_resetRsNotationPrewarm();_techMatCache.clear();textCache.clear();uploads.length=0;},
            snapshot(){return {canvases,materials:_techMatCache.size,uploads:uploads.length,
                texts:[...textCache.keys()],warnings:warnings.length};},
            palette(){return activePalette.slice();},
        };
    `)();
}

test('cold RS+ chart warms only observed valid masks and bends before their first draw', () => {
    const h = harness();
    const bundle = {notes:[
        {s:0,f:5,ho:true}, {s:0,f:5,ho:true},
        {s:1,f:3,pm:true,ho:true}, {s:2,f:7,bn:0,bnv:[{t:.2,v:.5}]},
        {s:3,f:8,sl:12,sus:1}, {s:9,f:4,hp:true}, {s:1,f:90,tp:true},
        {s:2,f:6}, {s:3,f:6,ho:true,slp:true,plk:true,pm:true,hp:true},
    ], chords:[{notes:[{s:4,f:127,mt:true},{s:5,f:4,hp:true,ac:true}]}]};
    h.warm(bundle);
    assert.equal(h.snapshot().canvases,0,'Current must not allocate RS+ masks');
    h.settings({style:true});
    assert.equal(h.snapshot().materials,6,'duplicates, plain notes, invalid notes and disabled arrows are excluded');
    for (const [code,string] of [[1,0],[33,1],[512,2],[313,3],[64,4],[256,5]]) assert.ok(h.cached(code,string));
    const before=h.snapshot();
    assert.equal(h.drawMask(33,1),h.cached(33,1));
    assert.equal(h.drawMask(313,3),h.cached(313,3),'five-family compensated face reuses its warmed mask');
    assert.equal(h.snapshot().canvases,before.canvases,'the actual draw factory finds its cold texture already cached');
    assert.equal(before.warnings,0);
});

test('cold bend warming matches rendered peak counts, including curves, chords and a black custom string', () => {
    const h=harness(), palette=h.palette();
    palette[0]=0;
    const bundle={notes:[
        ...[.25,.5,1,1.49,1.5,2,2.49,2.5,3,3.5,4,12].map(bn=>({s:0,f:5,bn})),
        {s:1,f:6,bn:0,bnv:[{v:.5},{v:2.5},{v:1}]},
        {s:2,f:7,bn:4,bnv:[{v:1},{v:2}]},
        {s:3,f:8,bn:1,bnv:[{v:.5},{v:2},{v:1}]},
        {s:4,f:6,bn:0,bnv:[{v:0},{v:-1}]},
        {s:4,f:6,bn:-1}, {s:9,f:6,bn:3}, {s:5,f:90,bn:3},
    ],chords:[{notes:[
        {s:4,f:4,bn:0,bnv:[{v:1},{v:8},{v:0}]},
        {s:5,f:5,bn:.5},
    ]}]};
    h.settings({style:true,palette});h.warm(bundle);
    assert.equal(h.snapshot().materials,9,'only the observed string/count combinations are allocated');
    const before=h.snapshot();
    for (const [string,steps] of [[0,1],[0,2],[0,3],[0,4],[1,3],[2,4],[3,2],[4,4],[5,1]]) {
        const material=h.cached(512+(steps-1)*4,string);
        assert.ok(material,`string ${string}, ${steps} arrows must be warm before drawing`);
        assert.equal(material.map.image.width,512);
        assert.equal(material.map.image.height,Math.round(512*(1+.4*(steps-1))));
        assert.equal(h.drawBend(steps,string),material,'the render factory reuses the warmed count and color');
        assert.equal(h.uploadsFor(material),1,'duplicate chart amounts upload a texture once per warm pass');
    }
    assert.deepEqual(h.snapshot(),before,'drawing every observed bend adds no first-use canvas or upload');
    assert.equal(before.warnings,0);
});

test('steady draws do not rescan arrays; chart replacement and append warm newly observed cues', () => {
    const h=harness();
    let reads=0;
    const note={get s(){reads++;return 0;},f:5,ho:true};
    const notes=[note], chords=[];
    h.settings({style:true});h.warm({notes,chords});
    const before=h.snapshot(), initialReads=reads;
    for(let i=0;i<40;i++)h.warm({notes,chords,currentTime:i});
    assert.equal(reads,initialReads);
    assert.deepEqual(h.snapshot(),before);
    notes.push({s:1,f:4,tp:true});h.warm({notes,chords});
    assert.ok(h.cached(4,1));
    h.warm({notes:[{s:2,f:6,hm:true}],chords});
    assert.ok(h.cached(128,2));
    assert.equal(h.snapshot().warnings,0);
});

test('live arrows, handedness, string count and custom palette warm their actual variants once', () => {
    const h=harness(), bundle={notes:[{s:0,f:4,sl:8,ho:true},{s:6,f:5,tp:true}],chords:[]};
    h.settings({style:true});h.warm(bundle);
    assert.equal(h.snapshot().materials,1);
    h.settings({arrows:true});assert.ok(h.cached(513));
    h.warm({...bundle,lefty:true});assert.ok(h.cached(514));
    h.settings({strings:8});assert.ok(h.cached(4,6));
    const palette=h.palette();palette[0]=0xabcdef;
    h.settings({palette});
    assert.ok(h.cached(1));assert.ok(h.cached(514));
    const after=h.snapshot();
    h.settings({palette});h.settings({style:false});h.settings({style:true});
    assert.deepEqual(h.snapshot(),after,'unchanged settings and round trips reuse uploaded assets');
});

test('RS+ numeric and white chord variants warm once with the active theme reference colors', () => {
    const h=harness(), bundle={notes:[],chords:[]};
    h.settings({style:true,theme:'forest'});h.warm(bundle);
    assert.equal(h.snapshot().texts.length,100,'gold digits and named-theme reference colors in their used styles');
    for(const style of ['noteFret','fretRow'])assert.ok(h.snapshot().texts.includes('24|#D8A636|'+style));
    h.settings({theme:'default'});
    assert.equal(h.snapshot().texts.length,150,'adds 0..24 neutral variants in both noteFret and fretRow');
    for(const style of ['noteFret','fretRow'])for(const fret of [0,12,24]) {
        assert.ok(h.snapshot().texts.includes(fret+'|#c0c3c7|'+style));
    }
    const before=h.snapshot();
    h.settings({theme:'forest'});h.settings({style:false});h.settings({style:true,theme:'default'});
    assert.deepEqual(h.snapshot(),before);
    h.warm({...bundle,chordTemplates:[{name:'Am'},{name:'internal',displayName:'C/E'}]});
    assert.ok(h.snapshot().texts.includes('Am|#f3f4f6|chord'));
    assert.ok(h.snapshot().texts.includes('C/E|#f3f4f6|chord'));
});

test('context restore reuploads cached assets, and renderer reinitialization builds a fresh cold cache', () => {
    const h=harness(), bundle={notes:[{s:0,f:5,ho:true},
        ...[1,2,3,4].map(bn=>({s:1,f:5,bn}))],chords:[]};
    h.settings({style:true});h.warm(bundle);
    const warm=h.snapshot();
    h.restoreContext();h.warm(bundle);
    assert.equal(h.snapshot().canvases,warm.canvases);
    assert.equal(h.snapshot().uploads,warm.uploads);
    h.reinit();h.warm(bundle);
    assert.equal(h.snapshot().canvases,warm.canvases+warm.materials);
    assert.equal(h.snapshot().uploads,warm.uploads);
});

test('production invokes guarded warming at init, settings reload and draw, and releases chart references', () => {
    assert.ok(/_prewarmStatic\(\);\s*_prewarmRsNotation\(bundle\)/.test(src));
    assert.ok(fn('_bgLoadSettings').includes('_prewarmRsNotation(_rsPrewarmBundle)'));
    assert.ok(/_leftyForBoard = _leftyCached;\s*}\s*_prewarmRsNotation\(bundle\)/.test(src));
    assert.ok(/_onCtxRestored = \(\) => \{\s*_ctxLost = false;\s*_resetRsNotationPrewarm\(\)/.test(src));
    assert.ok(/_songKey = null;\s*_resetRsNotationPrewarm\(\)/.test(src));
});

test('real text cache separates RS+ sRGB labels while Current and other text styles round trip unchanged', () => {
    const stylesStart=src.indexOf('const TXT_STYLES = {');
    const stylesEnd=src.indexOf('function txtMat(',stylesStart);
    assert.ok(stylesStart>=0 && stylesEnd>stylesStart);
    const h=new Function(`
        let rsPlusNotation=false, txtCache={};
        const context=new Proxy({measureText(){return {width:120,actualBoundingBoxLeft:0,
            actualBoundingBoxRight:100,actualBoundingBoxAscent:100,actualBoundingBoxDescent:20};}},
            {get(target,key){return key in target?target[key]:(()=>{});}});
        const document={createElement(){return {width:0,height:0,getContext(){return context;}};}};
        const T={SRGBColorSpace:'srgb',CanvasTexture:class{constructor(image){this.image=image;this.colorSpace='';this.userData={};}},
            SpriteMaterial:class{constructor(props){Object.assign(this,props);}}};
        ${src.slice(stylesStart,stylesEnd)}
        ${fn('txtMat')}
        return {get(rs,style,text='5',color='#D8A636'){
            rsPlusNotation=rs;return txtMat(text,color,style==='chord',style);
        }};
    `)();
    for(const style of ['noteFret','fretRow','chord']) {
        const current=h.get(false,style), rs=h.get(true,style);
        assert.notEqual(rs,current);
        assert.equal(current.map.colorSpace,'');
        assert.equal(rs.map.colorSpace,'srgb');
        assert.equal(h.get(false,style),current);
        assert.equal(h.get(true,style),rs);
        if (style !== 'chord') {
            const ink = current.map.userData.hwyLabelInk;
            assert.ok(ink && Object.values(ink).every(Number.isFinite), 'floor labels cache measured optical bounds');
            assert.ok(ink.minX < ink.maxX && ink.minY < ink.maxY);
            assert.deepEqual(rs.map.userData.hwyLabelInk,ink, 'sRGB conversion does not alter glyph clearance bounds');
            assert.equal(h.get(false,style).map.userData.hwyLabelInk,ink, 'cached text reuses its optical bounds');
        } else assert.equal(rs.map.userData.hwyLabelInk,undefined);
    }
    for(const style of ['technique','section','open']) {
        const current=h.get(false,style);
        assert.equal(h.get(true,style),current,'unrelated labels retain their original texture');
        assert.equal(current.map.colorSpace,'');
        assert.equal(current.map.userData.hwyLabelInk,undefined, 'unrelated labels do not acquire floor-layout metadata');
    }
});
