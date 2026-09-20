const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name);
}
const names = [
    'isPlayableFret', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'laneBoundsFromAnchor', 'anchorLaneBoundsAt', 'anchorPlayedFretInclusiveSpan',
    'playedFretSpanCoversShape', 'chordFallbackLaneBounds', 'hwyLinkNextTargetNotes',
    'slideInMarks', 'hwyBuildChordHoldGuidance', 'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides',
    'hwyBuildIndependentTrailOrigins', 'hwyBuildLinkedTrailPaths',
    'openNoteLaneBoxW', 'trailOpenLayoutAt',
];
const constants = ['CHORD_ANCHOR_TIME_EPS', 'BEND_LINK_TIME_EPS']
    .map(name => source.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n') + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);';
const eventStart = source.indexOf('    function hwyFootprintsOverlap1D(');
const eventEnd = source.indexOf('    /** Fixed pre-impact ramp window', eventStart);
const h = new Function(`
    const NFRETS=24, MAX_RENDER_STRINGS=8, K=1, NW=5, OPEN_NOTE_PAD_X=2;
    const fretX=f=>f*10, xFret=fretX, xFretMid=f=>(f-.5)*10;
    const curX=80, _drawAnchors=[];
    ${constants}
    ${names.map(extract).join('\n')}
    ${source.slice(eventStart,eventEnd)}
    return { hwyBuildIndependentTrailOrigins, hwyBuildChordHoldGuidance,
        hwyBuildTrailYieldEvents, trailOpenLayoutAt, hwyBuildTrailOcclusionIndex };
`)();
const chord = (durations, extra={}) => ({ t:10, id:0,
    notes:durations.map((sus,s)=>({s,f:s===0?0:5,sus})), ...extra });
const modelFor = chords => h.hwyBuildChordHoldGuidance(chords,[],[],[],6,[]);
function eventsFor(chords, notes=[]) {
    const model = modelFor(chords);
    return h.hwyBuildTrailYieldEvents(notes,chords,6,{
        trailVisible: (note,meta,ch) => !ch || !model.byChord.get(ch)?.suppressMemberTrails,
    });
}

test('actual shared hold decisions suppress both fretted and open trail candidates', () => {
    const ch=chord([2,2]);
    const model=modelFor([ch]);
    assert.equal(model.byChord.get(ch).suppressMemberTrails,true);
    const origins=h.hwyBuildIndependentTrailOrigins([], [ch],model.byChord,6);
    for(const note of ch.notes) assert.equal(origins.drawable.has(note),false);
    const events=eventsFor([ch]);
    for(const bucket of events) for(const event of bucket||[]) {
        assert.equal(event.trailVisible,false);
        assert.equal(event.gemVisible,true);
        assert.equal(event.chordTrailMeta,null);
    }
});

test('unequal durations retain their independent open and fretted trails', () => {
    const ch=chord([1,2]);
    const model=modelFor([ch]);
    assert.equal(model.byChord.get(ch),undefined);
    const origins=h.hwyBuildIndependentTrailOrigins([], [ch],model.byChord,6);
    for(const note of ch.notes) assert.equal(origins.drawable.has(note),true);
    assert.equal(origins.openOrigins.get(ch.notes[0]).minF,5);
    const events=eventsFor([ch]);
    assert.equal(events[0][0].trailVisible,true);
    assert.equal(events[0][0].chordTrailMeta.size,2);
    assert.equal(events[0][0].standaloneTrailVisible,false);
    assert.equal(events[5][0].trailVisible,true);
});

test('a shared chord duplicate does not erase a real standalone open trail', () => {
    const ch=chord([2,2]);
    const note={t:10,s:0,f:0,sus:2};
    const event=eventsFor([ch],[note])[0][0];
    assert.equal(event.trailVisible,true);
    assert.equal(event.standaloneTrailVisible,true);
    assert.equal(event.chordTrailMeta,null);
});

test('open trails match anchor chord width and out-of-anchor fallback width', () => {
    const out=new Float64Array(2), meta={size:2,minF:5,maxF:5};
    const anchors=[{time:0,fret:4,width:4}];
    const chordLayout=Array.from(h.trailOpenLayoutAt(10,meta,anchors,out));
    const singleLayout=Array.from(h.trailOpenLayoutAt(10,null,anchors,out));
    assert.equal(chordLayout[0],singleLayout[0]);
    assert.equal(singleLayout[1]-chordLayout[1],4,'standalone slab has horizontal padding');
    const fallback=Array.from(h.trailOpenLayoutAt(10,{size:2,minF:12,maxF:14},anchors,out));
    assert.notEqual(fallback[0],chordLayout[0]);
    assert.equal(fallback[1],40,'fallback remains the normal four-fret chord lane');
});

test('open chord anchor resolution retains the same rounded-onset tolerance as drawing', () => {
    const anchors=[{time:0,fret:3,width:4},{time:10.0004,fret:12,width:4}];
    const meta={size:2,minF:Infinity,maxF:-Infinity};
    const early=Array.from(h.trailOpenLayoutAt(10,meta,anchors,new Float64Array(2)));
    const exact=Array.from(h.trailOpenLayoutAt(10.001,meta,anchors,new Float64Array(2)));
    assert.deepEqual(early,exact);
});

test('reused open notes with different render origins are rejected as ambiguous paths', () => {
    const note={t:10,s:0,f:0,sus:2};
    const ch={t:10,notes:[note,{s:1,f:5,sus:1}]};
    const origins=h.hwyBuildIndependentTrailOrigins([note],[ch],new Map(),6);
    assert.equal(origins.drawable.has(note),true);
    assert.equal(origins.openOrigins.get(note),false);
    assert.deepEqual(Object.keys(note).sort(),['f','s','sus','t']);
});

test('incoming techniques bypass shared holds in actual trail origins and crossing events', () => {
    const ch = chord([2, 2]);
    ch.notes[1].slide_in_marks = [{ direction: 'up', time: 0 }];
    const model = modelFor([ch]);
    assert.equal(model.byChord.get(ch), undefined);
    const origins = h.hwyBuildIndependentTrailOrigins([], [ch], model.byChord, 6);
    for (const n of ch.notes) assert.equal(origins.drawable.has(n), true);
    for (const bucket of eventsFor([ch])) for (const event of bucket || []) {
        assert.equal(event.trailVisible, true);
    }
});
