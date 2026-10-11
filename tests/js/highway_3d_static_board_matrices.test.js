const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
const three = import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);

function block(prefix) {
    const start = source.indexOf(prefix);
    assert.ok(start >= 0, prefix);
    let end = source.indexOf('{', start) + 1, depth = 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, prefix);
    return source.slice(start, end);
}
const fn = name => block(`function ${name}(`);
const constants = ['SCALE', 'K', 'FRET_SCALE', 'NFRETS', 'FRET_SPACING_STRETCH_ABOVE12',
    'FRET_SPACING_ANCHOR_F', 'STR_THICK', 'S_BASE', 'S_GAP', 'AHEAD', 'TS', 'NW',
    'FRET_BOW_DZ', 'FRET_TUBE_RADIUS', 'FRET_TUBE_SEG', 'FRET_TUBE_RADIAL',
    'FRET_METALNESS', 'FRET_ROUGHNESS', 'FRET_EMISSIVE', 'FRET_WIRE_IDLE_HEX',
    'FRET_WIRE_IDLE_OP', 'DOTS', 'DDOTS', 'INLAY_LABEL_FRETS', 'FRET_LABEL_SCALE_REF_FRET']
    .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
const fretMath = source.slice(source.indexOf('const _fretXLog ='), source.indexOf('let _h3dFretUniform ='));

async function setup(config = {}, automaticReference = false) {
    const T = await three;
    // The reference uses normal Three automatic local matrices; the real
    // buildBoard and animation code, geometry and material setup are shared.
    // It is deliberately independent of the helper's matrix implementation.
    return new Function('T', 'config', 'automaticReference', `
        ${constants}
        ${fretMath}
        let nStr=6,_leftyCached=false,_invertedCached=false,_h3dFretUniform=true,rsPlusNotation=false;
        let textSize=.5,nutColor='#f5f3f0',headstockColor='#d4b48a',nutHeadstockVisible=true,inlayLabelsVisible=false;
        let hwThemeId='default',vibrancy=.85,glowMul=.25,_vibrancyIdleOp=.5,_venueSceneOverride=false;
        let _textSizeMul=1,_textSizeMulApplied=1;
        const BG_DEFAULTS={nutColor:'#f5f3f0',headstockColor:'#d4b48a'};
        ${source.match(/const RSPLUS_DEFAULT_HIGHWAY = Object\.freeze\([\s\S]*?\);/)[0]}
        const _bgHighwayColors=()=>({board:0x08080e});
        ${fn('_usesRsDefaultHighway')}
        ${source.match(/const fretX = [^;]+;/)[0]}
        ${source.match(/const fretMid = [^;]+;/)[0]}
        ${source.match(/const xFret = [^;]+;/)[0]}
        ${source.match(/const xFretMid = [^;]+;/)[0]}
        ${source.match(/const sY = [^;]+;/)[0]}
        ${block('const boardSpanX = () =>')};
        ${fn('fretColumnWorldW')}
        let _fretLabelScaleRefW=0;
        ${fn('fretLabelScaleForFret')}
        ${fn('_h3dHexOrDefault')}
        const activePalette=[0xff2222,0xffd000,0x1e8bff,0xff7a00,0x16d65a,0xb24bff,0x8899aa,0x112233];
        const mGlow=[],mAccentCore=[],mRsHalo=[];
        const renderOrderForLayerAtZ=(_z,layer)=>layer==='BOARD_STRING'?6:7;
        const textMaterials=new Map();
        function txtMat(text) {if(!textMaterials.has(text))textMaterials.set(text,new T.SpriteMaterial());return textMaterials.get(text);}
        const parent=new T.Group(),fretG=new T.Group();parent.add(fretG);
        let stringLines=[],stringLineGlows=[],fretWireMats=[],fretTubeGeo=null,nutHeadstockGroup=null;
        let _boardPlaneMat=null,_boardDotMat=null,_inlayMats=[],_inlayLabels=[];
        let boardStringStartX=0,boardTuningLabelX=0;
        ${fn('freezeBoardLocalMatrix')}
        if(automaticReference)freezeBoardLocalMatrix=object=>object;
        ${fn('buildBoard')}
        ${fn('updateStringHighlights')}
        function configure(c) {
            nStr=c.nStr??nStr;_leftyCached=c.lefty??_leftyCached;_invertedCached=c.inverted??_invertedCached;
            _h3dFretUniform=c.uniform??_h3dFretUniform;rsPlusNotation=c.rsPlus??rsPlusNotation;
            textSize=c.textSize??textSize;nutColor=c.nutColor??nutColor;headstockColor=c.headstockColor??headstockColor;
            _fretLabelScaleRefW=Math.max(1e-8,fretColumnWorldW(FRET_LABEL_SCALE_REF_FRET));
        }
        configure(config);buildBoard();
        return {T,parent,fretG,
            refs:()=>({stringLines,stringLineGlows,inlays:_inlayLabels,nut:nutHeadstockGroup,plane:_boardPlaneMat,dots:_boardDotMat,wires:fretWireMats}),
            rebuild(c){configure(c);buildBoard();},
            animate(intensity,size,visible){
                updateStringHighlights({stringSustain:Array(nStr).fill(false),stringAnticipation:Array(nStr).fill(intensity),strGlow:Array(nStr).fill(intensity),accentFillBoost:Array(nStr).fill(0)});
                textSize=size;_textSizeMul=.5+textSize;
                ${block('if (_textSizeMul !== _textSizeMulApplied)')}
                nutHeadstockGroup.visible=visible;for(const label of _inlayLabels)label.visible=visible;
                _boardPlaneMat.color.setHex(0x112233);_boardDotMat.opacity=.2;
                for(const line of stringLineGlows)line.material.opacity=.42;
                for(const wire of fretWireMats)wire.color.setHex(0xaa7722);
            },
        };
    `)(T, config, automaticReference);
}

function objects(root) { const list = []; root.traverse(o => list.push(o)); return list; }
function materialState(material) {
    const value = material.toJSON();
    for (const key of ['uuid', 'metadata']) delete value[key];
    return value;
}
function compare(a, b, assets = true) {
    const aa = objects(a.fretG), bb = objects(b.fretG);
    assert.equal(aa.length, bb.length);
    aa.forEach((o, i) => {
        const r = bb[i];
        assert.equal(o.type, r.type);assert.equal(o.visible, r.visible);assert.equal(o.renderOrder, r.renderOrder);
        assert.equal(o.matrixWorldAutoUpdate, r.matrixWorldAutoUpdate);
        assert.deepEqual(o.matrix.elements, r.matrix.elements);
        assert.deepEqual(o.matrixWorld.elements, r.matrixWorld.elements);
        if (!assets || !o.geometry) return;
        assert.equal(o.geometry.type, r.geometry.type);
        assert.deepEqual(o.geometry.index?.array, r.geometry.index?.array);
        assert.deepEqual(Object.keys(o.geometry.attributes), Object.keys(r.geometry.attributes));
        for (const key of Object.keys(o.geometry.attributes)) assert.deepEqual(o.geometry.attributes[key].array, r.geometry.attributes[key].array);
        assert.deepEqual(o.geometry.groups, r.geometry.groups);
        assert.deepEqual(o.geometry.drawRange, r.geometry.drawRange);
        assert.deepEqual(materialState(o.material), materialState(r.material));
    });
}
function moveParents(a, b, step) {
    for (const h of [a, b]) {
        h.parent.position.set(step * .3, -.5, .25);
        h.parent.rotation.set(step * .12, -.2, .31);
        h.parent.scale.set(1 + step * .04, .8, 1.2);
        h.fretG.position.set(-step * .2, .1, -.25);
        h.fretG.rotation.set(-.15, step * .03, .08);
        h.parent.updateMatrixWorld(true);
    }
}

test('actual board poses and assets match automatic Three matrices across reconstructed settings', async () => {
    for (const nStr of [4, 6, 7, 8]) for (const lefty of [false, true]) for (const rsPlus of [false, true]) {
        const config = {nStr, lefty, rsPlus, inverted: lefty !== rsPlus, uniform: !rsPlus,
            textSize: rsPlus ? .9 : .1, nutColor: '#aaaa33', headstockColor: '#773355'};
        const a = await setup(config), b = await setup(config, true);
        moveParents(a, b, 0);compare(a, b);
        for (const step of [1, 3]) {moveParents(a, b, step);compare(a, b, false);}
        const {stringLines, inlays} = a.refs();
        assert.ok([...stringLines, ...inlays, a.fretG, a.parent].every(o => o.matrixAutoUpdate));
        const frozen = objects(a.fretG).filter(o => !o.matrixAutoUpdate);
        assert.equal(frozen.length, 42 + 2 * nStr);
        assert.ok(frozen.every(o => o.children.length === 0 && !o.isSprite && !o.isSkinnedMesh && o.matrixWorldAutoUpdate));
    }
});

test('string animation, inlay resizing, visibility and material changes remain live under moving parents and camera', async () => {
    const a = await setup(), b = await setup({}, true);
    const camera = new a.T.PerspectiveCamera(40, 2.4, .001, 20);
    const poses = [0, 1, .35, 0];
    for (let i = 0; i < poses.length; i++) {
        for (const h of [a, b]) h.animate(poses[i], i / 3, i % 2 === 0);
        moveParents(a, b, i);compare(a, b);
        assert.equal(a.refs().stringLines[0].scale.y, 1 + poses[i] * .3);
        assert.equal(a.refs().inlays[0].visible, i % 2 === 0);
        camera.position.set(i * .2, 1, 3);camera.lookAt(0, 0, 0);camera.updateMatrixWorld(true);
        const aa = objects(a.fretG), bb = objects(b.fretG);
        for (let j = 0; j < aa.length; j++) {
            const project = o => new a.T.Vector3().setFromMatrixPosition(o.matrixWorld).project(camera).toArray();
            assert.deepEqual(project(aa[j]), project(bb[j]));
        }
    }
});

function watchDisposal(h) {
    const resources = new Set(), counts = [];
    h.fretG.traverse(o => {if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});
    for (const resource of resources) {const i=counts.length;counts.push(0);resource.addEventListener('dispose',()=>counts[i]++);}
    return counts;
}

test('rebuilds preserve asset sharing, disposal behavior and fresh initial transforms', async () => {
    const a = await setup(), b = await setup({}, true);
    for (const config of [{lefty:true,nStr:8,uniform:false}, {inverted:true,rsPlus:true,textSize:1}, {lefty:false,nStr:4,nutColor:'#001122'}, {nStr:6,uniform:true,rsPlus:false}]) {
        const oldA = [...a.fretG.children], oldB = [...b.fretG.children];
        const disposedA = watchDisposal(a), disposedB = watchDisposal(b);
        a.rebuild(config);b.rebuild(config);
        assert.deepEqual(disposedA, disposedB);
        assert.ok([...oldA, ...oldB].every(o => o.parent === null));
        moveParents(a, b, 2);compare(a, b);
        const sharing = h => {const os=objects(h.fretG);return os.map(o => [os.findIndex(x=>x.geometry===o.geometry),os.findIndex(x=>x.material===o.material)]);};
        assert.deepEqual(sharing(a), sharing(b));
    }
});

test('six-string board removes exactly 54 repeated local compositions while preserving world updates', async () => {
    const a = await setup(), b = await setup({}, true);
    function instrument(h) {
        const counts={compose:0,world:0};
        for(const o of objects(h.fretG)) {
            const compose=o.matrix.compose, multiply=o.matrixWorld.multiplyMatrices;
            o.matrix.compose=function(...args){counts.compose++;return compose.apply(this,args);};
            o.matrixWorld.multiplyMatrices=function(...args){counts.world++;return multiply.apply(this,args);};
        }
        return counts;
    }
    const ac=instrument(a),bc=instrument(b);
    for(let i=0;i<3;i++) {moveParents(a,b,i);compare(a,b,false);}
    assert.equal(bc.compose,72*3);assert.equal(ac.compose,18*3);
    assert.equal(ac.world,bc.world);assert.equal(ac.world,72*3);
});
