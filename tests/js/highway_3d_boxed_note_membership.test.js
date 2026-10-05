// Exercise chart membership -> actual single-note dispatch -> actual stem and
// floor-label drawing. Supplying an enclosure flag directly misses this bug.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(src, 'function ' + name);
const constant = name => src.match(new RegExp(`const ${name} = [^;]+;`))[0];
function between(start, end, from = 0) {
    const a = src.indexOf(start, from), b = src.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return src.slice(a, b);
}
function block(start) {
    const a = src.indexOf(start), open = src.indexOf('{', a);
    assert.ok(a >= 0, start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(a, i + 1);
    }
    throw new Error('Unclosed ' + start);
}

function membershipHarness() {
    return new Function(`
        'use strict';
        ${['NFRETS', 'ARP_FRAME_ONSET_PAD_S', 'ARP_FRAME_ONSET_CLUSTER_S'].map(constant).join('\n')}
        let nStr=6, _oobStringWarned=true, _boxedChordMembership=null, _filterValidNotesCache=new WeakMap();
        let _chordShapeCache=new WeakMap(), _chordSigCache=new WeakMap();
        let _coincidentRepeatNoteSet, _coincidentRepeatNotesRef, _coincidentRepeatChordsRef, _mergeCacheResult;
        const trailVisibilityReleaseChartReferences=()=>{};
        ${['validString', 'isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
            'usesUnfrettedPosition', '_noteKey', '_noteFretKey', 'lowerBoundT',
            'filterValidNotes', 'mergeChordShape', 'truthyChartFlag', 'hsStart', 'hsEnd',
            'hsChordIdNorm', 'chordTemplateMarkedArpeggio', 'handShapeMarkedArpeggio',
            'chordUsesArpeggioFrame', 'suppressSynthChordForNotes', 'chordHasFrameShape',
            '_ensureBoxedChordMembership', '_resetStringDependentCaches'].map(fn).join('\n')}
        ${between('const _HINT_NONE =', '// Hold timing and position guidance')}
        return {
            key:_noteFretKey,
            ensure(notes,chords,handShapes,templates) {
                const bundle={handShapes,chordTemplates:templates};
                ${between('const boxedChordMembers =', 'const chordGuideEnds =')}
                return boxedChordMembers;
            },
            strings(count) { nStr=count; _resetStringDependentCaches(); },
            release() { _boxedChordMembership=null; }
        };
    `)();
}

const dispatchStart = src.indexOf('const _isLinkNextTgt =', src.indexOf('const _noteRenderLo ='));
const dispatch = new Function('n', 'now', 'boxedChordMembers', 'options', `
    'use strict';
    ${fn('_noteKey')}${fn('_noteFretKey')}const NFRETS=24; ${fn('isPlayableFret')}${fn('isPlainDeadNote')}${fn('isUnpitchedMute')}${fn('usesUnfrettedPosition')}
    const _linkNextTargetSet=new Set(options.linked ? [n] : []);
    const anchors=[], noteAnchorLaneBoundsAt=()=>null, xFret=f=>f, openNoteLaneBoxW=()=>40;
    const bundle={handShapes:[],chordTemplates:[]}, notes=[n], arpGhostHsInfer=[];
    const strumFrames={byNote:new Map(options.strum ? [[n,options.strum]] : [])};
    const arpeggioChordIdForNoteWithInferCache=()=>options.arpeggio ? 7 : null;
    const arpHsBoundsForNote=()=>options.arpeggio ? {start:n.t,end:n.t+1} : null;
    const _ghostPrevBuf=new Map(), GHOST_HOLD_AFTER_ONSET=.1;
    let args;
    const drawNote=(...a)=>{args=a;};
    ${between('const _isLinkNextTgt =', 'if (arGhostCid != null) {', dispatchStart)}
    return args;
`);

function meshPool() {
    const meshes=[];
    return { meshes, get() {
        const v=()=>({set(...values){this.values=values;}});
        const m={position:v(),scale:v(),material:{color:{setHex(){}}}};
        meshes.push(m); return m;
    }};
}

const drawParameters=src.match(/function drawNote\(([^)]*)\)/)[1];
const draw = new Function('meshPool', 'args', 'options', `
    'use strict';
    const NFRETS=24; ${fn('isPlayableFret')}${fn('isPlainDeadNote')}${fn('isUnpitchedMute')}${fn('usesUnfrettedPosition')}${fn('noteStemVisible')}
    ${fn('teachingFingerLabel')}${fn('teachingDegreeLabel')}${fn('hwyShouldSuppressNoteBody')}
    ${fn('naturalNode')}${fn('harmonicLabel')}
    function drawNote(${drawParameters}) {
        const original=n;
        if(isUnpitchedMute(n)) n={...n,f:0};
        const noteStemsVisible=options.noteStems!==false, openStringStemsVisible=options.openStems!==false;
        const stemVisible=noteStemVisible(n,belongsToBoxedChord,noteStemsVisible,openStringStemsVisible);
        const NW=5,NH=3,K=1,S_GAP=4,AHEAD=3,nStr=options.strings||6;
        const rsPlusNotation=options.style!=='current',s=n.s,dt=n.t-now;
        const sY=i=>(options.inverted ? nStr-1-i : i)*S_GAP;
        const x=30,y=sY(s),techniqueYNow=0,noteZ=-10*dt, _leftyCached=!!options.lefty;
        const activePalette=[1,2,3,4,5,6,7,8], renderOrderForLayerAtZ=()=>4;
        const pConnectorLine=meshPool(),pDropLine=meshPool(),pNoteFretLabel=meshPool(),pTeachMarkLbl=meshPool();
        const txtMat=(text)=>({text,map:{image:{width:64,height:64}}});
        const _setIncomingFloorLabelMap=(mesh,map)=>{mesh.text=map.text;};
        const FRET_LABEL_GOLD_HEX='#ffaa00',_textSizeMul=1,fretLabelScaleForFret=()=>1;
        const _showFingerHints=true,_drawTeachingMarks=true;
        const _fretLabelAllowed=new Set([Math.round(n.t*25)*100+n.f]),_frameLabeledKeys=new Set();
        const outline={geometry:null,material:null,position:{set(){}},scale:{set(){}},visible:true};
        const gNote={},mRsOpenStem={},rsMiss=false,rsHit=false,openWScale=1;
        if(!hwyShouldSuppressNoteBody(skipBody,explicitLinkTarget,dt)) {
            ${block('if (rsPlusNotation && n.f === 0) {')}
            ${block('if (n.f > 0 && !skipLabel) {')}
        }
        ${between('const _wantDropLine =', '// ── Board ghost:')}
        return {original,belongsToBoxedChord,fromChord,sharedChordHold,explicitLinkTarget,
            connectors:pConnectorLine.meshes.length,drops:pDropLine.meshes.length,
            openStem:rsPlusNotation && n.f===0 && outline.visible && !explicitLinkTarget,
            frets:pNoteFretLabel.meshes.map(m=>m.text),hints:pTeachMarkLbl.meshes.map(m=>m.text)};
    }
    return drawNote(...args);
`);

function render(h, n, chords, options={}) {
    const notes=options.notes || [n];
    const keys=h.ensure(notes,chords,options.handShapes || [],options.templates || []);
    const args=dispatch(n,options.now ?? n.t-1,keys,options);
    assert.equal(args[0],n,'dispatch retains the authored note and scoring identity');
    return draw(meshPool,args,options);
}
const chord=(t=10)=>({t,id:1,notes:[{s:0,f:3},{s:1,f:5}]});

test('staggered brush dispatch preserves attack identity, suppresses stems, and centres open members on shared bounds',()=>{
    const h=membershipHarness();
    for(const style of ['current','rsplus'])for(const n of [{t:10.02,s:1,f:0},{t:10.04,s:2,f:5}]){
        const options={style,strum:{bounds:{dMin:2,dMax:6}}};
        const args=dispatch(n,9,new Set(),options);
        assert.equal(args[0],n);
        if(n.f===0){assert.equal(args[2],4);assert.equal(args[6],4);}
        const result=render(h,n,[],options);
        assert.equal(result.connectors,0);assert.equal(result.drops,0);assert.equal(result.openStem,false);
    }
});

test('Wrathchild note-stream overlaps lose stems while retaining fret and finger hints in both styles',()=>{
    for(const [t,s,f,id] of [[131.537994,1,2,3],[141.966995,0,3,1]]) {
        for(const style of ['rsplus','current']) {
            const n={t,s,f,fg:1}, ch={t,id,notes:[{s,f},{s:s+1,f:f+2}]};
            const r=render(membershipHarness(),n,[ch],{style});
            assert.equal(r.belongsToBoxedChord,true);
            assert.equal(r.connectors+r.drops,0);
            assert.deepEqual(r.frets,[f]);
            assert.deepEqual(r.hints,['1']);
            assert.equal(r.fromChord,false,'box membership must not change standalone rendering semantics');
            assert.equal(r.sharedChordHold,false);
        }
    }
});

test('first and high-density repeat chords preserve all unique metadata on coincident notes',()=>{
    const first=chord(), repeat={...chord(10.2),hd:true};
    for(const ch of [first,repeat]) {
        const n={t:ch.t,s:0,f:3,fg:1,sd:7,bn:1,bnv:[{t:0,v:1}],sl:5,ln:true,pm:true,sus:2};
        const snapshot=structuredClone(n);
        const r=render(membershipHarness(),n,[first,repeat]);
        assert.equal(r.connectors+r.drops,0);
        assert.deepEqual(r.hints,['1','7']);
        assert.deepEqual(n,snapshot);
    }
});

test('Songsterr harmonic overlaps retain precise touch labels without stems',()=>{
    const n={t:10,s:0,f:7,hm:true,hn:7.2,hps:5,fg:1};
    const ch={t:10,id:1,notes:[{s:0,f:7},{s:1,f:9}]};
    const snapshot=structuredClone(n);
    for(const style of ['rsplus','current']) {
        const r=render(membershipHarness(),n,[ch],{style});
        assert.equal(r.connectors+r.drops,0);
        assert.deepEqual(r.frets,['7.2']);
        assert.deepEqual(r.hints,['1']);
        assert.deepEqual(n,snapshot);
    }
});

test('different onset, string, fret and template-only notes retain their stems',()=>{
    const ch=chord();
    const templates={1:{frets:[3,5,7,-1,-1,-1]}};
    for(const n of [{t:10.01,s:0,f:3},{t:10,s:2,f:3},{t:10,s:0,f:4},{t:10,s:2,f:7}]) {
        const r=render(membershipHarness(),n,[ch],{templates});
        assert.equal(r.belongsToBoxedChord,false);
        assert.equal(r.connectors,1);
    }
});

test('membership uses the existing 100-microsecond event key rather than a broad chord window',()=>{
    const h=membershipHarness(),ch=chord(141.966995),notes=[];
    const keys=h.ensure(notes,[ch],[],[]);
    assert.equal(keys.has(h.key(141.967,0,3)),true);
    assert.equal(keys.has(h.key(141.9672,0,3)),false);
});

test('open, unpitched mute and fretted mute overlaps obey box membership and independent settings',()=>{
    for(const member of [{s:0,f:0},{s:0,f:127,mt:true},{s:0,f:3,mt:true}]) {
        for(const style of ['rsplus','current']) for(const noteStems of [false,true]) for(const openStems of [false,true]) {
            const n={t:10,...member},ch={t:10,id:1,notes:[member,{s:1,f:5}]};
            const options={style,noteStems,openStems,lefty:true,inverted:true};
            const boxed=render(membershipHarness(),n,[ch],options);
            assert.equal(boxed.connectors+boxed.drops,0);
            assert.equal(boxed.openStem,false);
            const free=render(membershipHarness(),{...n,t:10.1},[ch],options);
            assert.equal(free.openStem,style==='rsplus' && openStems);
        }
    }
});

test('arpeggio onset and later ordinary strums use the same classification as chord frames',()=>{
    const first=chord(),later=chord(10.5),handShapes=[{chord_id:1,start_time:10,end_time:12,arp:true}];
    for(const [ch,boxed] of [[first,false],[later,true]]) {
        const n={t:ch.t,s:0,f:3};
        const r=render(membershipHarness(),n,[first,later],{handShapes,arpeggio:true});
        assert.equal(r.belongsToBoxedChord,boxed);
        assert.equal(r.fromChord,true,'existing arpeggio association remains independent');
        assert.equal(r.drops,Number(!boxed));
    }
});

test('suppressed synthetic frames and single-string shapes do not hide standalone stems',()=>{
    for(const ch of [{...chord(),h3dSynth:true},{t:10,id:1,notes:[{s:0,f:3}]}]) {
        const r=render(membershipHarness(),{t:10,s:0,f:3},[ch]);
        assert.equal(r.belongsToBoxedChord,false);
        assert.equal(r.connectors,1);
    }
    // The renderer explicitly keeps a template-marked synthetic frame without
    // an initiating handshape. It must agree with the membership index too.
    const r=render(membershipHarness(),{t:10,s:0,f:3},[{...chord(),h3dSynth:true}],
        {templates:{1:{frets:[3,5],arp:true}}});
    assert.equal(r.belongsToBoxedChord,true);
    assert.equal(r.connectors,0);
});

test('invalid and out-of-range members cannot manufacture box membership',()=>{
    for(const invalid of [{s:7,f:5},{s:1,f:127},{s:1,f:-1}]) {
        const ch={t:10,notes:[{s:0,f:3},invalid]};
        const r=render(membershipHarness(),{t:10,s:0,f:3},[ch]);
        assert.equal(r.belongsToBoxedChord,false);
        assert.equal(r.connectors,1);
    }
});

test('membership survives play-line crossing, longer standalone sustains, seeks and linked targets',()=>{
    const n={t:10,s:0,f:3,fg:1,sus:4},ch=chord(),h=membershipHarness();
    for(const now of [9,10,12,9,13,8]) {
        const r=render(h,n,[ch],{now});
        assert.equal(r.belongsToBoxedChord,true);
        assert.equal(r.connectors+r.drops,0);
    }
    const r=render(h,n,[ch],{linked:true});
    assert.equal(r.explicitLinkTarget,true);
    assert.equal(r.connectors+r.drops,0);
});

test('chart-static cache reuses its index and refreshes every membership input',()=>{
    const h=membershipHarness(),ch=chord(),notes=[{t:10,s:0,f:3}],chords=[ch],hs=[],tpl=[];
    const a=h.ensure(notes,chords,hs,tpl);
    assert.equal(h.ensure(notes,chords,hs,tpl),a);
    assert.notEqual(h.ensure([...notes],chords,hs,tpl),a);
    assert.equal(h.ensure(notes,[],hs,tpl).size,0);
    assert.equal(h.ensure(notes,chords,[{chord_id:1,start_time:10,end_time:11,arp:true}],tpl).size,0);
    assert.equal(h.ensure(notes,chords,hs,tpl).has(h.key(10,0,3)),true);
    const lone={t:10,id:1,notes:[{s:0,f:3}]},one=[lone];
    assert.equal(h.ensure(notes,one,hs,{1:{frets:[3,5]}}).size,1);
    assert.equal(h.ensure(notes,one,hs,{1:{frets:[3]}}).size,0);
    const synthetic=[{...ch,h3dSynth:true}];
    assert.equal(h.ensure([],synthetic,hs,tpl).size,2);
    assert.equal(h.ensure(notes,synthetic,hs,tpl).size,0);
    h.release();
    assert.notEqual(h.ensure(notes,chords,hs,tpl),a);
});

test('string-count changes discard filtered shapes and restore extended-range membership',()=>{
    const h=membershipHarness(),n={t:10,s:0,f:3},ch={t:10,notes:[{s:0,f:3},{s:6,f:5}]};
    assert.equal(render(h,n,[ch]).connectors,1);
    h.strings(7);
    assert.equal(render(h,n,[ch],{strings:7}).connectors,0);
    h.strings(6);
    assert.equal(render(h,n,[ch]).connectors,1);
});
