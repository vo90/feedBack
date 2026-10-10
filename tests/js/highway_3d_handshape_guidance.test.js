const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(src, 'function ' + name);

// Execute the actual chart merge and draw queue. No song package or renderer
// dependencies are needed; these minimal fixtures reproduce the three reports.
function harness() {
    const draw = fn('drawNote');
    const queueEnd = draw.indexOf('            return renderNote(');
    assert.ok(queueEnd > 0);
    return new Function(`
        'use strict';
        const NFRETS=24, nStr=6, S_COL=Array(6), _oobStringWarned=true, AHEAD=3;
        const _collectNoteDraws=true, _noteDrawQueue=[], _visibleTrailEvents=[];
        const _scrChordNote={};
        let _noteDrawCount=0, eventLookups=0;
        const _firstEventTimeGreaterThan=()=>Infinity, slideInVisualStart=n=>n.t;
        const trailYieldEventForNote=()=>{eventLookups++;return {};};
        ${['isPlayableFret','isPlainDeadNote','isUnpitchedMute','isRenderableNote',
            'validString','chordTemplateLabel','chordNotesFromTemplate',
            'mergeHandShapeSynthChords','suppressSynthChordForNotes',
            'hwyShouldSuppressNoteBody','hwyNoteVisualParts'].map(fn).join('\n')}
        ${draw.slice(0,queueEnd)} }
        return {
            merge:mergeHandShapeSynthChords, suppress:suppressSynthChordForNotes,
            draw(ch,now) {
                _noteDrawCount=0;
                for(const member of ch.notes) {
                    const n={...member,t:ch.t};
                    drawNote(n,now,undefined,false,suppressSynthChordForNotes(ch),.75,
                        undefined,true,ch.id,false,null,-Infinity,false,false,false,
                        false,null,member,ch.h3dSynth===true);
                }
                return _noteDrawQueue.slice(0,_noteDrawCount).map(r=>({...r.parts,event:r.event}));
            },
            eventLookups:()=>eventLookups,
        };
    `)();
}

const passages = [
    { name:'C at 0:45', start:45.601002, end:46.548, attack:45.632999,
        frets:[-1,3,2,0,1,-1], notes:[{s:1,f:3},{s:4,f:1}] },
    { name:'D at 0:55', start:55.688, end:59.356998, attack:55.720001,
        frets:[-1,-1,0,2,3,2], notes:[{s:2,f:0},{s:5,f:2}] },
    { name:'C at 1:56', start:116.606003, end:117.541, attack:116.637001,
        frets:[-1,3,2,0,1,-1], notes:[{s:1,f:3},{s:4,f:1}] },
];

for (const p of passages) test(p.name + ': guidance adds no attacks before, at or after arrival', () => {
    const h=harness();
    const real=Object.freeze({t:p.attack,id:1,notes:Object.freeze(p.notes.map(Object.freeze))});
    const templates=[{name:p.name[0],frets:p.frets},{name:'',frets:Array(6).fill(-1)}];
    for(const n of p.notes) templates[1].frets[n.s]=n.f;
    const shapes=[{chord_id:0,start_time:p.start,end_time:p.end}];
    const snapshot=JSON.stringify({real,templates,shapes});
    const merged=h.merge([real],shapes,templates);
    const guide=merged.find(c=>c.h3dSynth);
    assert.ok(guide,'the 31–32 ms offset reproduces the synthetic shape');
    assert.equal(guide.notes.length,4,'full fingering remains available');
    assert.equal(merged.find(c=>!c.h3dSynth),real,'authored event identity is preserved');
    for(const now of [p.start-.5,p.start,p.attack,p.attack+.05,p.start-.5]) {
        const before=h.eventLookups();
        for(const part of h.draw(guide,now)) {
            assert.equal(part.head,false);
            assert.equal(part.trail,false);
            assert.equal(part.event,null,'guide cannot participate in attack/trail overlap');
        }
        assert.equal(h.eventLookups(),before);
        assert.equal(h.draw(real,now).filter(p=>p.head).length,2,'both authored attacks remain');
    }
    assert.equal(JSON.stringify({real,templates,shapes}),snapshot);
});

test('empty, delayed and arpeggiated shapes never require an invented preview attack', () => {
    const h=harness();
    for(const gap of [0,.027,.028,.031,.032,.06,.3,1]) {
        const ch={t:10+gap,id:1,notes:[{s:1,f:3},{s:4,f:1}]};
        const templates=[{name:'C',frets:[-1,3,2,0,1,-1]}];
        for(const reals of [[],[ch]]) {
            const merged=h.merge(reals,[{chord_id:0,start_time:10,end_time:12,arp:true}],templates);
            for(const guide of merged.filter(c=>c.h3dSynth)) {
                assert.equal(h.suppress(guide),true);
                for(const now of [9.5,10,10.1,11])
                    assert.ok(h.draw(guide,now).every(p=>!p.head&&!p.trail));
            }
            assert.deepEqual(merged.filter(c=>!c.h3dSynth),reals);
        }
    }
});

test('pooled draw records reset guidance-only visibility for real sustained notes', () => {
    const h=harness();
    const notes=[{s:2,f:0,sus:1},{s:5,f:2,sus:1}];
    const guide={t:10,h3dSynth:true,notes}, real={t:10,notes};
    assert.ok(h.draw(guide,10).every(p=>!p.head&&!p.trail));
    assert.ok(h.draw(real,10).every(p=>p.head&&p.trail));
    assert.ok(h.draw(guide,10).every(p=>!p.head&&!p.trail));
});
