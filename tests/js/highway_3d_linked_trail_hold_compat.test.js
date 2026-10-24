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
    'isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote', 'getChartAnchorAt',
    'getNoteAnchorAt', 'laneBoundsFromAnchor', 'anchorLaneBoundsAt', 'noteAnchorLaneBoundsAt', 'anchorPlayedFretInclusiveSpan',
    'playedFretSpanCoversShape', 'chordFallbackLaneBounds', 'chordShapeLaneBounds', 'hwyLinkNextTargetNotes',
    'slideInMarks', 'hwyBuildChordHoldGuidance', 'chordGuideTimedRowAt', 'hwyUncoveredHandPositionGuides',
    'chordMemberTrailSuppressed', 'hwyBuildIndependentTrailOrigins', 'hwyBuildLinkedTrailPaths',
    'openNoteLaneBoxW', 'trailOpenLayoutAt', 'hwyCanJoinIndependentTrails', 'hwyLinkedTrailMemberAt',
    'trailLinkedOpenLayout', 'trailCrossingTargetStrands', 'trailVisibilitySourceMemberAt',
    'trailVisibilitySourceNoteAt', 'trailVisibilitySourceCenterXAt', 'trailVisibilitySourceWidthAt',
];
const constants = ['CHORD_ANCHOR_TIME_EPS', 'BEND_LINK_TIME_EPS']
    .map(name => source.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n') + '\nconst _slideInMarkCache = new WeakMap(), SLIDE_OUT_EMPTY_MARKS = Object.freeze([]);';
const eventStart = source.indexOf('    function hwyFootprintsOverlap1D(');
const eventEnd = source.indexOf('    /** Fixed pre-impact ramp window', eventStart);
const h = new Function(`
    const NFRETS=24, MAX_RENDER_STRINGS=8, K=1, NW=5, OPEN_NOTE_PAD_X=2;
    const fretX=f=>f*10, xFret=fretX, xFretMid=f=>(f-.5)*10;
    const curX=80, _drawAnchors=[], rsPlusNotation=false, RSPLUS_SUSTAIN_STROKE_SCALE=.5;
    let _linkedTrailOpenOrigins=new WeakMap();
    const _trailYieldMatchContext={}, _trailOpenLayoutScratch=new Float64Array(2);
    const _trailCrossingTargetBases=new Float64Array(4), _trailCrossingTargetWidths=new Float64Array(4);
    let _trailCrossingTargetBaseCount=0;
    const slideTrailEnd=()=>null, sustainTrailCenterXAt=(n,base)=>base;
    ${constants}
    ${names.map(extract).join('\n')}
    ${source.slice(eventStart,eventEnd)}
    return { chordMemberTrailSuppressed, hwyBuildIndependentTrailOrigins, hwyBuildChordHoldGuidance,
        hwyBuildTrailYieldEvents, trailOpenLayoutAt, hwyBuildTrailOcclusionIndex, hwyLinkNextTargetNotes,
        hwyCanJoinIndependentTrails, hwyBuildLinkedTrailPaths, trailLinkedOpenLayout,
        configure(anchors,origins) { _drawAnchors.splice(0,_drawAnchors.length,...anchors); _linkedTrailOpenOrigins=origins; },
        sourceRail(path,time,strand) {
            const layout=trailLinkedOpenLayout(path,new Float64Array(2));
            const scale=Math.max(.22,layout[1]*.96/40);
            Object.assign(_trailYieldMatchContext,{path,strandIndex:strand,sourceSampleMember:null,
                trailBodyW:NW*.85*scale,trailW:NW*.85*scale+.4,openWScale:scale,trailEdgePad:.4});
            return [trailVisibilitySourceCenterXAt(time,NW*.85*scale+.4),trailVisibilitySourceWidthAt(time)];
        },
        targetRails(event) {
            const count=trailCrossingTargetStrands(event);
            return Array.from({length:count},(_,i)=>[_trailCrossingTargetBases[i],_trailCrossingTargetWidths[i]]);
        } };
`)();
const chord = (durations, extra={}) => ({ t:10, id:0,
    notes:durations.map((sus,s)=>({s,f:s===0?0:5,sus})), ...extra });
const modelFor = (chords, notes = []) => h.hwyBuildChordHoldGuidance(chords,[],[],[],6,notes);
function eventsFor(chords, notes=[]) {
    const model = modelFor(chords, notes);
    return h.hwyBuildTrailYieldEvents(notes,chords,6,{
        trailVisible: (note,meta,ch) => !h.chordMemberTrailSuppressed(ch && model.byChord.get(ch), note),
        suppressedAttacks: h.hwyLinkNextTargetNotes(notes, chords),
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

test('open chord trails and frames share a valid lane, with outlying shapes falling back', () => {
    const out=new Float64Array(2), meta={size:2,minF:5,maxF:5};
    const anchors=[{time:0,fret:4,width:4}];
    const chordLayout=Array.from(h.trailOpenLayoutAt(10,meta,anchors,out));
    const singleLayout=Array.from(h.trailOpenLayoutAt(10,null,anchors,out));
    assert.equal(chordLayout[0],50);
    assert.equal(singleLayout[0],50);
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
    assert.equal(h.hwyCanJoinIndependentTrails(note,{s:0,f:0},origins.openOrigins),false);
    assert.deepEqual(Object.keys(note).sort(),['f','s','sus','t']);
});

function linkedFor(notes,chords,anchors) {
    const holds=modelFor(chords,notes), links=new Map();
    const attacks=h.hwyLinkNextTargetNotes(notes,chords,1e-6,links);
    const origins=h.hwyBuildIndependentTrailOrigins(notes,chords,holds.byChord,6);
    const model=h.hwyBuildLinkedTrailPaths(links,{
        trailVisible:note=>origins.drawable.has(note),
        canJoin:(a,b)=>h.hwyCanJoinIndependentTrails(a,b,origins.openOrigins),
    });
    h.configure(anchors,origins.openOrigins);
    const events=h.hwyBuildTrailYieldEvents(notes,chords,6,{
        trailVisible:note=>origins.drawable.has(note), suppressedAttacks:attacks,linkedPaths:model,
    }).flat().filter(Boolean);
    return {model,events,attacks};
}

test('Cirice open chord tie keeps both rails across the fret-1 to fret-2 lane handoff', () => {
    const start=352.846985, seam=353.014008;
    const ch={t:start,id:16,notes:[{s:0,f:0,sus:.167,ln:true},{s:1,f:1,sus:.167,sl:2,ln:true}]};
    const notes=[{t:seam,s:0,f:0,sus:6.5},{t:seam,s:1,f:2,sus:6.5}];
    const anchors=[{time:start,fret:1,width:4},{time:seam,fret:2,width:4}];
    const before=JSON.stringify({ch,notes,anchors});
    const {model,events,attacks}=linkedFor(notes,[ch],anchors);
    const p=model.byNote.get(ch.notes[0]).path;
    assert.equal(model.byNote.get(notes[0]).path,p);
    assert.equal(p.start,start); assert.equal(p.end,seam+6.5);
    assert.equal(attacks.has(notes[0]),true);
    assert.deepEqual(Array.from(h.trailLinkedOpenLayout(p,new Float64Array(2))),[20,40]);
    const expected=[[5.6,4.48],[34.4,4.48]];
    const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
    // Queries before and after the join, including a seek back into the root,
    // must agree with the rendered target strands used for occlusion.
    for(const time of [seam+6,seam,seam-.05,start+.02]) for(let strand=0;strand<2;strand++) {
        h.sourceRail(p,time,strand).forEach((v,i)=>near(v,expected[strand][i]));
    }
    for(const note of [ch.notes[0],notes[0]]) {
        const event=events.find(e=>e.sourceNote===note);
        assert.equal(event.gemVisible,note===ch.notes[0]);
        assert.equal(event.trailVisible,true);
        h.targetRails(event).forEach((rail,s)=>rail.forEach((v,i)=>near(v,expected[s][i])));
    }
    assert.equal(model.byNote.get(ch.notes[1]).path,model.byNote.get(notes[1]).path,'fretted slide path is retained');
    assert.equal(JSON.stringify({ch,notes,anchors}),before,'chart onsets, holds and lane metadata remain unchanged');
});

test('an open tie chain retains its first lane width, with fresh attacks using the new lane', () => {
    const notes=[{t:10,s:0,f:0,sus:1,ln:true},{t:11,s:0,f:0,sus:1,ln:true},
        {t:12,s:0,f:0,sus:1},{t:13,s:0,f:0,sus:1}];
    const anchors=[{time:10,fret:3,width:4},{time:11,fret:8,width:6},{time:12,fret:15,width:2}];
    const {model,events}=linkedFor(notes,[],anchors);
    const p=model.byNote.get(notes[0]).path;
    assert.equal(model.byNote.get(notes[2]).path,p);
    assert.equal(model.byNote.has(notes[3]),false,'a new attack starts a separate layout');
    assert.deepEqual(Array.from(h.trailLinkedOpenLayout(p,new Float64Array(2))),[40,44]);
    assert.deepEqual(h.targetRails(events.find(e=>e.t===12)),h.targetRails(events.find(e=>e.t===10)));
    assert.notDeepEqual(h.targetRails(events.find(e=>e.t===13)),h.targetRails(events.find(e=>e.t===10)));
    assert.equal(h.hwyCanJoinIndependentTrails({f:0},{f:2},new WeakMap()),false);
    assert.equal(h.hwyCanJoinIndependentTrails({f:2},{f:0},new WeakMap()),false);
});

test('fretted mutes drawn as open bars keep their existing per-onset footprint', () => {
    h.configure([{time:10,fret:3,width:4},{time:11,fret:8,width:6}],new WeakMap());
    const event={t:11,end:12,f:0,sourceFret:5,standaloneTrailVisible:true};
    const ordinary=h.targetRails(event);
    event.linkedPath={path:{members:[{onset:10,note:{f:5}}]}};
    assert.deepEqual(h.targetRails(event),ordinary,'an authored fretted mute does not inherit an open tie layout');
});

test('incoming techniques bypass shared holds in actual trail origins and crossing events', () => {
    const ch = chord([2, 2]);
    ch.notes[1].slide_in_marks = [{ direction: 'up', time: 0 }];
    const model = modelFor([ch]);
    assert.equal(model.byChord.get(ch).suppressMemberTrails, false);
    const origins = h.hwyBuildIndependentTrailOrigins([], [ch], model.byChord, 6);
    for (const n of ch.notes) assert.equal(origins.drawable.has(n), n.s === 1);
    for (const bucket of eventsFor([ch])) for (const event of bucket || []) {
        assert.equal(event.trailVisible, event.s === 1);
    }
});

test('palm-muted chord trails disappear from both drawing and occlusion, single opens remain', () => {
    const ch = chord([.21375, .21375]); ch.notes.forEach(n => { n.f = 0; n.pm = true; });
    const single = { t: 11, s: 0, f: 0, sus: .4, pm: true };
    const model = modelFor([ch], [single]);
    const origins = h.hwyBuildIndependentTrailOrigins([single], [ch], model.byChord, 6);
    assert.equal(origins.drawable.has(single), true);
    for (const n of ch.notes) assert.equal(origins.drawable.has(n), false);
    const events = eventsFor([ch], [single])[0];
    assert.equal(events.find(e => e.sourceNote === single).trailVisible, true);
    for (const n of ch.notes) {
        const event = events.find(e => e.sourceNote === n);
        assert.equal(event.trailVisible, false);
        assert.equal(event.gemVisible, true);
    }
});

test('legato chords suppress only the held string throughout the trail pipeline', () => {
    for (const delta of [-.001, 0, .001]) for (const heldFret of [0, 5]) {
        const ch = chord([1, .25]); ch.notes[0].f = heldFret; ch.notes[1].ln = true;
        const notes = [{ t: 10.25, s: 1, f: 7, sus: .25, ho: true, ln: true },
            { t: 10.5, s: 1, f: 5, sus: .5 + delta, po: true }];
        const model = modelFor([ch], notes);
        const origins = h.hwyBuildIndependentTrailOrigins(notes, [ch], model.byChord, 6);
        assert.equal(origins.drawable.has(ch.notes[0]), false);
        assert.equal(origins.drawable.has(ch.notes[1]), true);
        for (const target of notes) assert.equal(origins.drawable.has(target), true);
        const events = eventsFor([ch], notes).flat().filter(Boolean);
        for (const e of events) assert.equal(e.trailVisible, e.s === 1);
        for (const target of notes) assert.equal(events.find(e => e.sourceNote === target).gemVisible, true);
    }
});
