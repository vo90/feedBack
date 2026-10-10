'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { extractFunction } = require('./test_utils');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(source, 'function ' + name);
const draw = fn('drawNote');
const render = fn('renderNote');
const flush = fn('flushNoteDraws');
const forwarding = draw.indexOf('            return renderNote(');
assert.ok(forwarding > 0);
const parameters = draw.slice(draw.indexOf('(') + 1, draw.indexOf(')'));
const names = parameters.split(',').map(p => p.trim().split(' = ')[0]).join(', ');
const observe = `return observeDraw(${names});`;
// Substitute only the geometry body with an observer. Exercise the actual
// collector, defaults, dispatch, record cleanup and finally block. The prior
// inline form shares that same observer so its call semantics are comparable.
const oldDraw = draw.slice(0, forwarding) + observe + '\n}';
const observedRender = render.slice(0, render.indexOf('{') + 1) + observe + '\n}';
const oldFlush = flush.replace('(_collectNoteDraws ? drawNote : renderNote).apply', 'drawNote.apply');

function harness(extracted) {
    return new Function(`
        let _collectNoteDraws=false, _noteDrawCount=0, _noteDrawParts=null, _noteDrawEvent=null;
        const _noteDrawQueue=[], _visibleTrailEvents=[], _scrChordNote={};
        const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap(), _linkedVibratoRuns=new WeakMap();
        const _linkedTrailPaths={byNote:new WeakMap()}, AHEAD=3;
        let hook=null, validHook=null;
        const seen=[], events=new WeakMap();
        const validString=s=>validHook ? validHook(s) : s>=0&&s<6;
        const isRenderableNote=n=>n.f>=0&&n.f<=24;
        const slideInVisualStart=n=>n.t, _firstEventTimeGreaterThan=()=>Infinity;
        const hwyShouldSuppressNoteBody=(skip,linked,dt)=>linked||(skip&&dt>0);
        function hwyNoteVisualParts(n,now,ahead,linger,next,start,head,trail,out) {
            out.head=!head; out.trail=!trail&&n.sus>0; out.linger=linger;
        }
        function trailYieldEventForNote(n,identity) {
            let event=events.get(identity);
            if(!event){event={identity,gemVisible:false,trailVisible:false};events.set(identity,event);}
            return event;
        }
        function observeDraw(${names}) {
            const row={args:Array.from(arguments),parts:_noteDrawParts,event:_noteDrawEvent};
            seen.push(row);
            if(hook)hook(row);
            return 'drawn';
        }
        ${extracted ? draw + '\n' + observedRender : oldDraw}
        ${extracted ? flush : oldFlush}
        return {
            draw:drawNote, flush:flushNoteDraws, seen, records:_noteDrawQueue, scratch:_scrChordNote,
            linkedStarts:_linkedBendStarts, linkedEnds:_linkedBendEnds, linkedVibrato:_linkedVibratoRuns, linkedPaths:_linkedTrailPaths,
            collect(value=true){_collectNoteDraws=value;},
            begin(){_collectNoteDraws=true;_noteDrawCount=0;},
            hook(value){hook=value;},validHook(value){validHook=value;},
            state(){return {collect:_collectNoteDraws,count:_noteDrawCount,parts:_noteDrawParts,event:_noteDrawEvent};},
        };
    `)();
}
const note = extra => ({t:10,s:1,f:5,sus:2,...extra});

test('direct note calls preserve every default, null, explicit source and return value', () => {
    const a=harness(false),b=harness(true),n=note(),identity={id:'source'};
    const cases=[
        [n,9.9],
        [n,10,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined],
        [n,10,0,false,false,null,0,null,0,null,null,null,null,null,null,null,null,null,null],
        [n,10,3,true,true,.75,40,true,'chord',true,{start:9,end:12},8,true,true,true,true,{dMin:2,dMax:6},identity,true],
    ];
    for(const args of cases)assert.equal(b.draw(...args),a.draw(...args));
    assert.deepEqual(b.seen,a.seen);
    assert.deepEqual(b.seen[0].args.slice(5),[.1,undefined,false,undefined,false,null,-Infinity,false,false,false,false,null,n,false]);
    assert.equal(b.seen[2].args[17],null,'explicit null must not select the default source identity');
});

test('queued records retain raw arity and undefined defaults across scratch cloning and cleanup', () => {
    const a=harness(false),b=harness(true);
    for(const h of [a,b]){
        Object.assign(h.scratch,note());
        h.linkedStarts.set(h.scratch,.5);h.linkedEnds.set(h.scratch,{end:1});h.linkedVibrato.set(h.scratch,{run:2});h.linkedPaths.byNote.set(h.scratch,{path:3});
        h.begin();h.draw(h.scratch,9.9);
        const record=h.records[0];
        assert.equal(record.args.length,2);
        assert.notEqual(record.args[0],h.scratch);
        assert.equal(h.linkedStarts.get(record.args[0]),.5);
        assert.deepEqual(h.linkedEnds.get(record.args[0]),{end:1});
        assert.deepEqual(h.linkedVibrato.get(record.args[0]),{run:2});
        assert.deepEqual(h.linkedPaths.byNote.get(record.args[0]),{path:3});
        h.scratch.f=11;
        h.flush();
        assert.equal(h.seen[0].args[0].f,5);
        assert.equal(h.seen[0].args[17],h.seen[0].args[0],'omitted identity defaults to the saved view on flush');
        assert.deepEqual(record.args,[undefined,undefined]);assert.equal(record.event,null);
        assert.equal(h.state().parts,null);assert.equal(h.state().event,null);
    }
    assert.deepEqual(b.seen,a.seen);
});

test('a reentrant change to collection mode is observed before the next queued item', () => {
    const a=harness(false),b=harness(true),notes=[note({s:0}),note({s:1})];
    for(const h of [a,b]){
        h.begin();for(const n of notes)h.draw(n,9.9);
        h.hook(()=>{h.collect(true);h.validHook(()=>{h.collect(false);return false;});});
        h.flush();
        assert.equal(h.seen.length,1,'second item must still take the changed collection gate');
        assert.deepEqual(h.records[1].args,[undefined,undefined]);
    }
    assert.deepEqual(b.seen,a.seen);assert.deepEqual(b.state(),a.state());
});

test('nested direct drawing preserves ordering and the outer per-note context', () => {
    const a=harness(false),b=harness(true),outer=note(),inner=note({s:2,t:11});
    for(const h of [a,b]){
        h.begin();h.draw(outer,9.9);
        h.hook(row=>{if(row.args[0]===outer)h.draw(inner,10.1);});
        h.flush();
        assert.deepEqual(h.seen.map(row=>row.args[0]),[outer,inner]);
        assert.equal(h.seen[0].parts,h.seen[1].parts);
        assert.equal(h.seen[0].event,h.seen[1].event);
    }
    assert.deepEqual(b.seen,a.seen);
});

test('a throwing draw retains the current record but clears active context in finally', () => {
    const a=harness(false),b=harness(true),notes=[note({s:0}),note({s:1})];
    for(const h of [a,b]){
        h.begin();for(const n of notes)h.draw(n,9.9);
        const error=new Error('provider failure');
        h.hook(row=>{if(row.args[0].s===1)throw error;});
        assert.throws(()=>h.flush(),e=>e===error);
        assert.deepEqual(h.records[0].args,[undefined,undefined]);
        assert.equal(h.records[0].event,null);
        assert.equal(h.records[1].args[0],notes[1]);
        assert.notEqual(h.records[1].event,null);
        assert.equal(h.state().parts,null);assert.equal(h.state().event,null);
    }
    assert.deepEqual(b.seen,a.seen);
});

test('the render entry point shares defaults and has no raw arguments dependency', () => {
    assert.equal(render.slice(render.indexOf('(')+1,render.indexOf(')')),parameters);
    assert.doesNotMatch(render,/\barguments\b/);
    assert.match(draw,/record\.args\.length = arguments\.length/);
});
