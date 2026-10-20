const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(source, 'function ' + name);

function harness() {
    return new Function(`
        const NFRETS=24, nStr=6, S_COL=Array(6), _oobStringWarned=true;
        const ARP_INFER_MIN_HAND_SHAPE_SPAN_S=.2;
        const _HINT_NONE=Object.freeze({explicit:false,covered:false,hs:null,fallbackInferenceStopBefore:null});
        let _hintCache=new WeakMap(), _hintCacheHsRef=null, _hintCacheTplRef=null;
        const _ARP_CID_NULL={}, _arpCidCache=new WeakMap();
        const _ARP_BOUNDS_NULL={}, _arpBoundsCache=new WeakMap();
        // Isolate occurrence selection from the independently tested inference
        // classifier. All fixtures here are eligible arpeggio passages.
        const inferArpeggioFromNotePattern=()=>true;
        const mergeChordShape=(_,notes)=>new Map(notes.map(n=>[n.s,n.f]));
        ${['isPlayableFret','validString','truthyChartFlag','hsStart','hsEnd','hsChordIdNorm',
            'handShapeChartSpanSec','chordTemplateLabel','chordNotesFromTemplate',
            'chordTemplateMarkedArpeggio','handShapeMarkedArpeggio','chordHandShapeArpeggioHint',
            'chordUsesArpeggioFrame','mergeHandShapeSynthChords','arpeggioChordIdForNote',
            'arpeggioChordIdForNoteWithInferCache','arpHsBoundsForNote'].map(fn).join('\n')}
        return {
            hint:chordHandShapeArpeggioHint, frame:chordUsesArpeggioFrame,
            merge:mergeHandShapeSynthChords, note:arpeggioChordIdForNote,
            cachedNote:arpeggioChordIdForNoteWithInferCache, bounds:arpHsBoundsForNote,
        };
    `)();
}

const shape = (id, start, end, extra={}) => ({chord_id:id,start_time:start,end_time:end,arp:true,...extra});
const templates = [
    {name:'D5',frets:[-1,-1,0,2,3,-1]},
    {name:'D',frets:[-1,-1,0,2,3,2]},
];

test('genuinely adjacent same-template occurrences retain separate arpeggio frames', () => {
    const previous=shape(0,8,10), next=shape(0,10,12);
    for(const shapes of [[previous,next],[next,previous]]) {
        const h=harness(), chords=h.merge([],shapes,templates);
        assert.deepEqual(chords.map(ch=>ch.t),[8,10]);
        const chord=chords[1], hint=h.hint(chord,shapes,templates);
        assert.equal(hint.hs,next,'the new occurrence owns its boundary');
        assert.equal(h.frame(chord,hint),true,'a new arpeggio must keep its arpeggio enclosure');
        assert.equal(h.hint(chord,shapes,templates),hint,'repeat lookup uses the cache');
    }
});

test('boundary selection preserves the new occurrence metadata and cache invalidation', () => {
    const previous=shape(0,8,10), next=shape(0,10,12,{arp:false});
    const h=harness(), chord={t:10,id:0}, shapes=[previous,next];
    assert.equal(h.hint(chord,shapes,templates).explicit,false);
    const changed=shape(0,10,12);
    assert.equal(h.hint(chord,[previous,changed],templates).explicit,true);
    assert.equal(h.hint(chord,shapes,templates).hs,next);
});

test('boundary preference respects existing timestamp tolerance and endpoint fallback', () => {
    for(const offset of [-.000099,0,.000099]) {
        const h=harness(), previous=shape(0,8,10), next=shape(0,10+offset,12);
        assert.equal(h.hint({t:10,id:0},[previous,next],templates).hs,next);
    }
    const h=harness(), previous=shape(0,8,10), future=shape(0,10.000101,12);
    assert.equal(h.hint({t:10,id:0},[previous,future],templates).hs,previous);
    assert.equal(h.hint({t:10.000099,id:0},[previous],templates).hs,previous);
    assert.equal(h.hint({t:10.000101,id:0},[previous],templates).covered,false);
});

test('wrong-template onsets and unrelated overlapping spans keep the original coverage behavior', () => {
    const h=harness(), previous=shape(0,8,11), wrong=shape(1,10,12), overlap=shape(0,9,12);
    const chord={t:10,id:0};
    assert.equal(h.hint(chord,[previous,wrong],templates).hs,previous);
    assert.equal(h.hint(chord,[previous,overlap],templates).hs,previous);
    assert.equal(h.hint(chord,[wrong],templates).fallbackInferenceStopBefore,12);
});

test('cached and uncached note lookup use the new arpeggio occurrence at the shared boundary', () => {
    const previous=shape(0,8,10), next=shape(1,10,12);
    for(const shapes of [[previous,next],[next,previous]]) {
        const h=harness(), n={t:10,s:4,f:3}, notes=[n];
        assert.equal(h.note(n,shapes,templates,notes),1);
        assert.equal(h.cachedNote(n,shapes,templates,notes,[true,true]),1);
        assert.deepEqual(h.bounds(n,shapes,[true,true]),{start:10,end:12});
        assert.equal(h.cachedNote(n,shapes,templates,notes,[true,true]),1);
    }
});

test('note boundary preference cannot bypass fret matching or inference eligibility', () => {
    const previous=shape(0,8,10), next=shape(1,10,12);
    const h=harness(), n={t:10,s:4,f:3}, notes=[n];
    const changedTemplates=[templates[0],{...templates[1],frets:[-1,-1,0,2,4,2]}];
    assert.equal(h.note(n,[previous,next],changedTemplates,notes),0);
    assert.equal(h.cachedNote(n,[previous,next],changedTemplates,notes,[true,true]),0);
    assert.deepEqual(h.bounds(n,[previous,next],[true,true],0),{start:8,end:10});
    assert.deepEqual(h.bounds(n,[previous,next],[true,true],1),{start:10,end:12},
        'the resolved template is part of the bounds cache identity');
    assert.deepEqual(h.bounds(n,[previous,{start_time:10,end_time:12}],[true,true],0),{start:8,end:10},
        'an absent template id is not template zero');
    const skipped={...n};
    assert.equal(h.cachedNote(skipped,[previous,next],templates,[skipped],[true,false]),0);
    assert.deepEqual(h.bounds(skipped,[previous,next],[true,false]),{start:8,end:10});
});

test('note lookups retain inclusive ends when no next occurrence exists', () => {
    for(const offset of [0,.000099]) {
        const h=harness(), shapes=[shape(0,8,10)], n={t:10+offset,s:4,f:3};
        assert.equal(h.note(n,shapes,templates,[n]),0);
        assert.equal(h.cachedNote(n,shapes,templates,[n],[true]),0);
        assert.deepEqual(h.bounds(n,shapes,[true]),{start:8,end:10});
    }
});

test('mastery changes recompute occurrence identity and bounds for reused note objects', () => {
    const h=harness(), n={t:10,s:4,f:3}, notes=[n], flags=[true];
    const first=[shape(0,8,11)], second=[shape(1,9,13)], empty=[];
    for(const [shapes,cid,start,end] of [[first,0,8,11],[second,1,9,13],[first,0,8,11]]) {
        assert.equal(h.cachedNote(n,shapes,templates,notes,flags),cid);
        assert.deepEqual(h.bounds(n,shapes,flags,cid),{start,end});
    }
    assert.equal(h.cachedNote(n,empty,templates,notes,flags),null);
    assert.equal(h.bounds(n,empty,flags),null);
    assert.equal(h.cachedNote(n,second,templates,notes,flags),1);
    assert.deepEqual(h.bounds(n,second,flags,1),{start:9,end:13});
});

test('template, note-stream and inference input changes invalidate cached note selection and bounds', () => {
    const h=harness(), n={t:10,s:4,f:3}, shapes=[shape(0,8,10),shape(1,10,12)];
    const notes=[n], flags=[true,true];
    assert.equal(h.cachedNote(n,shapes,templates,notes,flags),1);
    assert.deepEqual(h.bounds(n,shapes,flags,1),{start:10,end:12});
    const changedTemplates=[templates[0],{...templates[1],frets:[-1,-1,0,2,4,2]}];
    assert.equal(h.cachedNote(n,shapes,changedTemplates,notes,flags),0);
    assert.deepEqual(h.bounds(n,shapes,flags,0),{start:8,end:10});
    assert.equal(h.cachedNote(n,shapes,templates,[],flags),null);
    assert.equal(h.cachedNote(n,shapes,templates,notes,[true,false]),0);
    assert.equal(h.cachedNote(n,shapes,templates,notes,flags),1);
    // Renderer reuses its inference scratch array; replacing chart inputs is
    // what prompts that array to be recomputed.
    flags[1]=false;
    assert.equal(h.cachedNote(n,shapes,[...templates],[...notes],flags),0);
    assert.deepEqual(h.bounds(n,shapes,flags,0),{start:8,end:10});
});
