// Exercise the renderer's chart-static gold-label index using its real chart
// preprocessing and eligibility helpers. No DOM, GPU or song library is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(source, 'function ' + name);
function constant(name) {
    const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
    assert.ok(match, name);
    return match[0];
}
function cachedBlock(start, lastFunction) {
    const begin = source.indexOf(start);
    const last = fn(lastFunction);
    const end = source.indexOf(last, begin) + last.length;
    assert.ok(begin >= 0 && end > begin, start);
    return source.slice(begin, end);
}
function statementBlock(marker, after = 0) {
    const begin = source.indexOf(marker, after);
    assert.ok(begin >= 0, marker);
    const open = source.indexOf('{', begin);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(begin, i + 1);
    }
    throw Error('Unbalanced renderer block: ' + marker);
}

const helpers = [
    'validString', 'isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute',
    'isRenderableNote', 'usesUnfrettedPosition', '_noteKey', '_noteFretKey',
    '_noteHasStandaloneVisualData', 'coincidentPlainRepeatNotes', 'lowerBoundT',
    'filterValidNotes', 'mergeChordShape', 'chordShapeSignature',
    'truthyChartFlag', 'hsStart', 'hsEnd', 'hsChordIdNorm',
    'chordTemplateMarkedArpeggio', 'handShapeMarkedArpeggio',
    'chordUsesArpeggioFrame', 'suppressSynthChordForNotes', 'chordHasFrameShape',
    'chordTemplateLabel', 'chordNotesFromTemplate', 'mergeHandShapeSynthChords',
    'getChartAnchorAt', 'laneBoundsFromAnchor', 'anchorPlayedFretInclusiveSpan',
    'playedFretSpanCoversShape', 'chordFallbackLaneBounds', 'chordShapeLaneBounds',
    'hwyLinkNextTargetNotes', 'hwyChordHasNewAttack', 'hwyBuildChordHoldGuidance',
    'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides', 'hwyTrailBoundaryOverlapIsNegligible',
    'hwyBuildAuthoredStrumFrames', 'slideInMarks', 'slideOutMarks', 'slideTrailEnd',
    'slideOutLegacyDirection', 'noteHasSlideOutCue',
    'noteHasVibrato', 'noteHasVisibleMotionSustain', 'noteHasRepeatTechniqueCue',
    'chordMuteKind', 'repeatChordMaySuppressGems', 'naturalNode', 'harmonicLabel',
    'handShapeChartSpanSec', 'hitTimesQualifyArpeggioSpread', 'nextStrictlyLaterChordTime',
    'arpeggioChordIdForNote', 'fillArpeggioGhostInferFlags',
    '_buildFretLabelSet', '_ensureFretMarkerGoldIndex', 'hwyShouldSuppressNoteBody',
];
const constants = [
    'NFRETS', 'NEXT_ON_STRING_T_EPS', 'BEND_LINK_TIME_EPS', 'CHORD_ANCHOR_TIME_EPS',
    'TRAIL_BOUNDARY_OVERLAP_TOLERANCE_S', 'ARP_FRAME_ONSET_PAD_S', 'ARP_FRAME_ONSET_CLUSTER_S',
    'ARP_INFER_MIN_HAND_SHAPE_SPAN_S', 'ARP_INFER_STRUM_VS_ARP_SPREAD_MIN_S',
    'ARP_INFER_MULTI_STRUM_HIT_SLACK', 'ARP_INFER_MULTI_STRUM_WIN_MIN_S',
    'ARP_INFER_MIN_HITS_VS_SHAPE_CAP',
];

// Exported for the isolated saved-chart cost probe. Preprocessing is separate
// from ensure(), so the warm probe measures the actual constant-time guard.
function createIndexHarness() {
    const noteLabelBlock = statementBlock('if (n.f > 0 && !skipLabel)', source.indexOf('function drawNote('));
    const repeatLabelBlock = statementBlock('if (!guidanceOnly && skipBody && fromChord && !skipLabel');
    const chordLabelBlock = statementBlock('if (!isRepeat)', source.indexOf('// ── Chord fret numbers at the base'));
    const skipBodyDeclaration = source.match(/const effSkipBody = [^;]+;/)[0];
    // Preserve the actual normal-body gate, rather than a second copy of its
    // eligibility policy. The stubs below replace only material/scene writes.
    const bodyGate = 'if (!effSkipBody && !arpGhostOnlyMode && !_overLinger)';
    assert.ok(source.includes(bodyGate));
    return new Function(`
        'use strict';
        ${constants.map(constant).join('\n')}
        let nStr = 6;
        const _oobStringWarned = true;
        const _filterValidNotesCache = new WeakMap(), _chordShapeCache = new WeakMap();
        const _chordSigCache = new WeakMap(), _slideInMarkCache = new WeakMap();
        const _slideOutMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);
        let _fretMarkerGoldCache = null, _fretLabelAllowed = new Set();
        let _linkNextTargetSet = null, _coincidentRepeatNoteSet = null;
        let _chordGuideCache = null, _authoredStrumCache = null;
        const _fretMarkerWaveCache = new Map(), _arpGhostHsInferScratch = [];
        ${helpers.map(fn).join('\n')}
        ${cachedBlock('const _HINT_NONE =', 'chordHandShapeArpeggioHint')}
        ${cachedBlock('let _arpInferCache = new WeakMap();', '_inferArpeggioFromNotePatternUncached')}
        ${cachedBlock('let _arpCoverCache = new WeakMap();', 'chordShapeCoveredByStandaloneNotes')}
        ${cachedBlock('const _ARP_CID_NULL =', 'arpeggioChordIdForNoteWithInferCache')}
        ${cachedBlock('const _ARP_BOUNDS_NULL =', 'arpHsBoundsForNote')}
        const AHEAD=3.5, K=1, S_GAP=1, _textSizeMul=1, FRET_LABEL_GOLD_HEX='#gold';
        const _showFingerHints=false, _drawTeachingMarks=false, NW=1;
        const sY=s=>s, xFretMid=f=>f, fretLabelScaleForFret=()=>1;
        const renderOrderForLayerAtZ=()=>0;
        const _frameLabeledKeys=new Set();
        let registrations=[];
        const pNoteFretLabel={get:()=>({position:{set(){}},scale:{set(){}},material:{}})};
        const txtMat=text=>({text,map:{image:{width:1,height:1}}});
        function _setIncomingFloorLabelMap(sprite,mat,f,t) {registrations.push({sprite,text:mat.text,f,t});}
        function visibleRegistrations() {
            return registrations.filter(r=>r.sprite.material.opacity>0).map(({text,f,t})=>({text,f,t}));
        }
        function registerNote(sourceNote, now, opts={}) {
            registrations=[]; _frameLabeledKeys.clear();
            let n=sourceNote;
            if (!validString(n.s) || !isRenderableNote(n)) return [];
            const scrape=n.mt===true && n.pick_scrape_marks?.length>0;
            if (isUnpitchedMute(n)) n={...n,f:0};
            const dt=n.t-now, s=n.s, x=n.f, y=s, noteZ=-dt;
            const skipLabel=!!opts.skipLabel, skipBody=!!opts.skipBody;
            const fromChord=!!opts.fromChord, arpBounds=opts.arpBounds||null;
            const guidanceOnly=!!opts.guidanceOnly, explicitLinkTarget=!!opts.explicitLinkTarget;
            const arpGhostOnlyMode=false, _overLinger=false, stemVisible=false, techniqueYNow=0;
            ${skipBodyDeclaration}
            ${bodyGate} { ${noteLabelBlock} }
            ${repeatLabelBlock}
            return visibleRegistrations();
        }
        function registerChordFrame(ch, isRepeat=false) {
            registrations=[];
            const chShape=mergeChordShape(ch,filterValidNotes(ch.notes),bundle.chordTemplates);
            const chDt=.5,chordTailMul=1,yMinF=0,z=-1;
            ${chordLabelBlock}
            return visibleRegistrations();
        }
        let bundle, notes, chords, beats, anchors;
        function prepare(input) {
            bundle = { notes: [], chords: [], beats: [], anchors: [], handShapes: [], chordTemplates: [], ...input };
            ({notes, beats, anchors} = bundle);
            nStr = input.stringCount || 6;
            const merged = mergeHandShapeSynthChords(bundle.chords, bundle.handShapes, bundle.chordTemplates);
            _linkNextTargetSet = hwyLinkNextTargetNotes(notes, bundle.chords);
            _coincidentRepeatNoteSet = coincidentPlainRepeatNotes(notes, merged, chordShapeSignature);
            _fretLabelAllowed = _buildFretLabelSet(notes, merged, beats);
            _arpGhostHsInferScratch.length = bundle.handShapes.length;
            fillArpeggioGhostInferFlags(bundle.handShapes, bundle.chordTemplates, notes, _arpGhostHsInferScratch);
            _chordGuideCache = { model: hwyBuildChordHoldGuidance(merged, bundle.handShapes,
                bundle.chordTemplates, anchors, nStr, notes) };
            const strums = hwyBuildAuthoredStrumFrames(notes, merged, anchors, nStr);
            chords = strums.frames.length ? [...merged, ...strums.frames].sort((a,b)=>a.t-b.t) : merged;
            _authoredStrumCache = { ...strums, displayChords: chords };
            return bundle;
        }
        return {
            prepare,
            ensure: () => _ensureFretMarkerGoldIndex(bundle, notes, chords, beats, anchors),
            invalidateIndex: () => { _fretMarkerGoldCache = null; },
            waveCache: _fretMarkerWaveCache,
            registerNote, registerChordFrame,
            state: () => ({ bundle, notes, chords, beats, anchors, allowed:_fretLabelAllowed,
                links:_linkNextTargetSet, repeats:_coincidentRepeatNoteSet, strums:_authoredStrumCache }),
            replaceDependency(name, value) {
                if (name==='notes') notes=value;
                else if (name==='chords') chords=value;
                else if (name==='beats') beats=value;
                else if (name==='anchors') anchors=value;
                else if (name==='strings') nStr=value;
                else if (name==='allowed') _fretLabelAllowed=value;
                else if (name==='links') _linkNextTargetSet=value;
                else if (name==='repeats') _coincidentRepeatNoteSet=value;
                else if (name==='holdModel') _chordGuideCache={model:value};
                else if (name==='strums') _authoredStrumCache=value;
                else bundle[name]=value;
            },
            helpers: { isUnpitchedMute, hwyShouldSuppressNoteBody, chordHasFrameShape,
                chordUsesArpeggioFrame, suppressSynthChordForNotes, hwyChordHasNewAttack },
        };
    `)();
}

function indexed(input) {
    const h = createIndexHarness();
    h.prepare(input);
    return { h, rows: h.ensure().flat() };
}
function chord(t, frets = [3, 5], extra = {}) {
    return { t, id: 0, notes: frets.map((f,s)=>({s,f})), ...extra };
}
function template(frets = [3, 5]) {
    return { name:'fixture', frets:[...frets, ...Array(6-frets.length).fill(-1)] };
}

module.exports = { createIndexHarness };

if (require.main === module) {
test('standalone index excludes open, invalid, unpitched mute and scrape labels', () => {
    const input = { notes:[
        {t:1,s:0,f:3}, {t:2,s:0,f:0}, {t:3,s:0,f:25}, {t:4,s:6,f:7},
        {t:5,s:0,f:8,mt:true}, {t:6,s:0,f:9,mt:true,pick_scrape_marks:[{t:0,d:1}]},
        {t:7,s:0,f:10,pm:true}, {t:8,s:0,f:11,fhm:true},
    ] };
    const {rows} = indexed(input);
    assert.deepEqual(rows.map(r=>r.f), [3,10,11]);
});

test('natural harmonic retains contact caption and node without changing chart fret', () => {
    const {rows} = indexed({notes:[{t:1,s:0,f:7,hm:true,hn:7.2,hps:19}]});
    assert.deepEqual(rows, [{t:1,f:7,text:'7.2',node:7.2}]);
});

test('index agrees with actual note registration blocks for normal, harmonic, muted, scrape and linked notes', () => {
    const notes=[{t:1,s:0,f:3},{t:2,s:1,f:0},{t:3,s:0,f:5,mt:true},
        {t:4,s:0,f:7,hm:true,hn:7.2,hps:19},
        {t:5,s:0,f:9,mt:true,pick_scrape_marks:[{t:0,d:1}]},
        {t:6,s:0,f:11,sus:.2,ln:true},{t:6.2,s:0,f:11},
        {t:7,s:0,f:13,pm:true},{t:8,s:0,f:15,fhm:true}];
    const {h,rows}=indexed({notes});
    const emitted=notes.flatMap(n=>h.registerNote(n,n.t-.5,{explicitLinkTarget:h.state().links.has(n)}));
    assert.deepEqual(emitted,rows.map(({node,...row})=>row));
});

test('index frame candidates agree with the actual unique-fret registration block', () => {
    const ch=chord(1,[3,5,5,0]);
    const {h,rows}=indexed({chords:[ch],chordTemplates:[template([3,5,5,0])]});
    assert.deepEqual(h.registerChordFrame(ch),rows.map(({node,...row})=>row));
    assert.deepEqual(h.registerChordFrame(ch,true),[],'real compact-repeat block emits no frame labels');
});

test('linked targets and coincident compact repeats produce no standalone candidate', () => {
    const first = {t:1,s:0,f:3,sus:.2,ln:true};
    const target = {t:1.2,s:0,f:3};
    const duplicate = {t:2.2,s:0,f:5};
    const {h,rows} = indexed({notes:[first,target,duplicate],
        chords:[chord(2,[5,7]),chord(2.2,[5,7])],
        chordTemplates:[template([5,7])]});
    assert.ok(h.state().links.has(target), 'real link preprocessor classifies target');
    assert.ok(h.state().repeats.has(duplicate), 'real repeat preprocessor classifies duplicate');
    assert.ok(rows.some(r=>r.t===1 && r.f===3));
    assert.ok(!rows.some(r=>r.t===1.2 || r.t===2.2));
});

test('measure density is reused for notes but normal chord-frame gold bypasses it', () => {
    const {h,rows} = indexed({notes:[{t:1,s:0,f:3},{t:2,s:0,f:3},{t:3,s:0,f:3}],
        beats:[{time:0,measure:0},{time:2,measure:1},{time:3,measure:2}],
        chords:[chord(2,[5,7])], chordTemplates:[template([5,7])]});
    assert.ok(!h.state().allowed.has(2*25*100+5), 'frame frets are absent from note-only set');
    assert.deepEqual(rows.filter(r=>r.f===3).map(r=>r.t),[1,3]);
    assert.deepEqual(rows.filter(r=>r.t===2).map(r=>r.f),[5,7]);
});

test('ordinary guidance synthesizes no gold; an explicit arpeggio frame does', () => {
    const base = {chordTemplates:[template()], handShapes:[{start_time:1,end_time:3,chord_id:0}]};
    const ordinary = indexed(base);
    assert.equal(ordinary.h.state().chords[0].h3dSynth,true);
    assert.deepEqual(ordinary.rows,[]);
    const arp = indexed({...base,handShapes:[{...base.handShapes[0],arp:true}]});
    assert.deepEqual(arp.rows.map(r=>[r.t,r.f]),[[1,3],[1,5]]);
});

test('actual legacy skipBody label block excludes guidance-only synthetic members', () => {
    const n={t:1,s:0,f:3};
    const {h}=indexed({notes:[n]});
    assert.deepEqual(h.registerNote(n,.5,{skipBody:true,fromChord:true,guidanceOnly:true}),[]);
    assert.deepEqual(h.registerNote(n,.5,{skipBody:true,fromChord:true}),[{text:3,f:3,t:1}],
        'same production fallback still serves a real compact repeat');
});

test('a real repeat after intervening guidance retains its separate legacy label path', () => {
    const duplicate={t:1.2,s:0,f:3};
    const repeat=chord(1.2);
    const {h,rows}=indexed({notes:[duplicate],chords:[chord(1),repeat],
        chordTemplates:[template(),{...template([7,9]),name:'other shape'}],
        handShapes:[{start_time:1.1,end_time:1.15,chord_id:1}]});
    assert.ok(h.state().repeats.has(duplicate),'standalone duplicate is suppressed by actual preprocessor');
    const fallback=h.registerNote({...repeat.notes[0],t:repeat.t},.7,{skipBody:true,fromChord:true});
    assert.deepEqual(fallback,[{text:3,f:3,t:1.2}]);
    assert.deepEqual(rows.filter(r=>r.t===1.2).map(({node,...row})=>row),fallback);
    assert.ok(!rows.some(r=>r.t===1.1),'intervening ordinary guide contributes no gold');
});

test('compact repeats omit frame labels, while a later fresh attack registers them', () => {
    const {rows} = indexed({chords:[chord(1),chord(1.2),chord(1.8)],chordTemplates:[template()]});
    assert.deepEqual(rows.map(r=>[r.t,r.f]),[[1,3],[1.8,3],[1,5],[1.8,5]]);
});

test('a chord consisting only of linked continuations has no attack-frame candidate', () => {
    const first=chord(1); first.notes.forEach(n=>Object.assign(n,{sus:1,ln:true}));
    const next=chord(2);
    const {h,rows} = indexed({chords:[first,next],chordTemplates:[template()]});
    assert.ok(next.notes.every(n=>h.state().links.has(n)));
    assert.ok(!rows.some(r=>r.t===2));
});

test('authored staggered strum frames retain frame and standalone eligibility', () => {
    const notes=[{t:1,s:0,f:3,ch:9},{t:1.08,s:1,f:5,ch:9}];
    const {h,rows} = indexed({notes,anchors:[{time:0,fret:3,width:4}]});
    assert.equal(h.state().strums.frames.length,1);
    assert.deepEqual(rows.map(r=>[r.t,r.f]),[[1,3],[1,5],[1.08,5]]);
});

test('Iron Maiden 77 ms pair retains authored gold time rather than quantizing to the beat', () => {
    const note={t:220.597,s:0,f:3,ig:true,po:true};
    const beat={time:220.673996,measure:165};
    const {rows} = indexed({notes:[note],beats:[beat],anchors:[{time:220.520004,fret:3,width:4}]});
    assert.deepEqual(rows,[{t:220.597,f:3,text:3,node:null}]);
    assert.ok(Math.abs((beat.time-rows[0].t)*1000-76.996)<1e-8);
});

test('index is sorted, exact duplicate gold is deduplicated, source remains unchanged', () => {
    const input={notes:[{t:3,s:0,f:3},{t:1,s:0,f:3},{t:1,s:1,f:3}],
        beats:[{time:0,measure:0},{time:3,measure:2}]};
    const snapshot=JSON.stringify(input);
    const {rows}=indexed(input);
    assert.deepEqual(rows.map(r=>r.t),[1,3]);
    assert.equal(JSON.stringify(input),snapshot);
});

test('unchanged chart returns the same index without clearing locked wave decisions', () => {
    const h=createIndexHarness(); h.prepare({notes:[{t:1,s:0,f:3}]});
    const first=h.ensure(); const decision={hidden:new Set([3])};
    h.waveCache.set(1.1,decision);
    for(let i=0;i<50;i++) assert.equal(h.ensure(),first);
    assert.equal(h.waveCache.get(1.1),decision);
});

test('all chart/cache identity dependencies rebuild and clear old wave decisions', () => {
    const dependencies={notes:[],chords:[],rawChords:[],beats:[],anchors:[],handShapes:[],chordTemplates:[],
        strings:7,allowed:new Set(),links:new Set(),repeats:new Set(),holdModel:{byChord:new Map()},
        strums:{byNote:new Map(),displayChords:[]}};
    for(const [name,value] of Object.entries(dependencies)) {
        const h=createIndexHarness(); h.prepare({notes:[{t:1,s:0,f:3}]});
        const before=h.ensure(); h.waveCache.set(1,{});
        // rawChords is the bundle.chords identity, separate from display chords.
        if(name==='rawChords') h.state().bundle.chords=value;
        else h.replaceDependency(name,value);
        assert.notEqual(h.ensure(),before,name);
        assert.equal(h.waveCache.size,0,name);
    }
});

test('in-place note/beat/anchor/shape array growth invalidates a previously built index', () => {
    for(const name of ['notes','chords','beats','anchors','handShapes']) {
        const h=createIndexHarness();h.prepare({});const before=h.ensure();h.waveCache.set(1,{});
        const s=h.state();
        const values={notes:{t:1,s:0,f:3},chords:chord(1),beats:{time:0,measure:0},
            anchors:{time:0,fret:3,width:4},handShapes:{start_time:1,end_time:2,chord_id:0}};
        (s[name]||s.bundle[name]).push(values[name]);
        assert.notEqual(h.ensure(),before,name);
        assert.equal(h.waveCache.size,0,name);
    }
});
}
