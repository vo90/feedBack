'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { extractFunction } = require('./test_utils');
const {copyState}=require('./highway-bend-layout-fixture.js');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const scrapeSource = fs.readFileSync(path.join(__dirname, '../../static/js/pick-scrapes.js'), 'utf8').replace(/export /g, '');
const scrapeGeometry = new Function(scrapeSource + ';return {scrapeGroupKey};')();
const fn = name => extractFunction(source, 'function ' + name);
const draw = fn('drawNote');
const flush = fn('flushNoteDraws');
const geometryStart = draw.indexOf('            _stableNoteRelevant =');
assert.ok(geometryStart > 0);
const parameters = draw.slice(draw.indexOf('(') + 1, draw.indexOf(')'));
const names = parameters.split(',').map(p => p.trim().split(' = ')[0]).join(', ');
// Run the actual production collector, defaults, dispatch, record cleanup and
// finally block. Observe calls at the start of geometry instead of creating a
// Three.js scene; geometry behavior is covered by the renderer's other suites.
const observedDraw = draw.slice(0, geometryStart) + `return observeDraw(${names});\n}`;

function harness() {
    return new Function('scrapeGeometry', `
        ${copyState}
        let _collectNoteDraws=false, _noteDrawCount=0, _noteDrawParts=null, _noteDrawEvent=null;
        const _noteDrawQueue=[], _visibleTrailEvents=[], _scrChordNote={};
        const _pickScrapeCaptionOwners=new Map(), sY=s=>-s;
        ${fn('isPickScrape')}
        const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap(), _linkedVibratoRuns=new WeakMap();
        const _linkedTrailPaths={byNote:new WeakMap()}, AHEAD=3;
        const _openSlideTailNotes=new WeakSet();
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
        ${observedDraw}
        ${flush}
        return {
            draw:drawNote, flush:flushNoteDraws, seen, records:_noteDrawQueue, scratch:_scrChordNote,
            linkedStarts:_linkedBendStarts, linkedEnds:_linkedBendEnds, linkedVibrato:_linkedVibratoRuns, linkedPaths:_linkedTrailPaths,
            hiddenOpenSlideTails:_openSlideTailNotes,
            collect(value=true){_collectNoteDraws=value;},
            begin(){_collectNoteDraws=true;_noteDrawCount=0;},
            hook(value){hook=value;},validHook(value){validHook=value;},
            state(){return {collect:_collectNoteDraws,count:_noteDrawCount,parts:_noteDrawParts,event:_noteDrawEvent};},
        };
    `)(scrapeGeometry);
}
const note = extra => ({t:10,s:1,f:5,sus:2,...extra});

test('direct note calls preserve every default, null, explicit source and return value', () => {
    const h=harness(),n=note(),identity={id:'source'};
    const cases=[
        [n,9.9],
        [n,10,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined],
        [n,10,0,false,false,null,0,null,0,null,null,null,null,null,null,null,null,null,null],
        [n,10,3,true,true,.75,40,true,'chord',true,{start:9,end:12},8,true,true,true,true,{dMin:2,dMax:6},identity,true],
    ];
    for(const args of cases)assert.equal(h.draw(...args),'drawn');
    const defaults=[undefined,undefined,undefined,.1,undefined,false,undefined,false,null,-Infinity,false,false,false,false,null,n,false];
    assert.deepEqual(h.seen.map(row=>row.args),[[n,9.9,...defaults],[n,10,...defaults],cases[2],cases[3]]);
    assert.equal(h.seen[2].args[17],null,'explicit null must not select the default source identity');
});

test('queued records retain raw arity and undefined defaults across scratch cloning and cleanup', () => {
    const h=harness();Object.assign(h.scratch,note());
    h.linkedStarts.set(h.scratch,.5);h.linkedEnds.set(h.scratch,{end:1});h.linkedVibrato.set(h.scratch,{run:2});h.linkedPaths.byNote.set(h.scratch,{path:3});
    h.begin();h.draw(h.scratch,9.9);
    const record=h.records[0];
    assert.equal(record.args.length,2);
    assert.notEqual(record.args[0],h.scratch);
    assert.equal(h.linkedStarts.get(record.args[0]),.5);
    assert.deepEqual(h.linkedEnds.get(record.args[0]),{end:1});
    assert.deepEqual(h.linkedVibrato.get(record.args[0]),{run:2});
    assert.deepEqual(h.linkedPaths.byNote.get(record.args[0]),{path:3});
    h.scratch.f=11;h.flush();
    assert.equal(h.seen[0].args[0].f,5);
    assert.equal(h.seen[0].args[17],h.seen[0].args[0],'omitted identity defaults to the saved view on flush');
    assert.equal(h.seen[0].event.identity,h.scratch,'collection uses the original scratch identity');
    assert.deepEqual(record.args,[undefined,undefined]);assert.equal(record.event,null);
    assert.equal(h.state().parts,null);assert.equal(h.state().event,null);

    const raw=[note(),10,undefined,false,undefined,undefined];
    h.begin();h.draw(...raw);
    assert.deepEqual(h.records[0].args,raw,'explicit undefined slots remain recorded before flush');
    h.flush();
    assert.equal(h.seen[1].args[5],.1);assert.equal(h.seen[1].args[17],raw[0]);
    assert.deepEqual(h.records[0].args,Array(6).fill(undefined));
});

test('a reentrant change to collection mode is observed before the next queued item', () => {
    const h=harness(),notes=[note({s:0}),note({s:1})];
    h.begin();for(const n of notes)h.draw(n,9.9);
    h.hook(()=>{h.collect(true);h.validHook(()=>{h.collect(false);return false;});});
    h.flush();
    assert.equal(h.seen.length,1,'second item must still take the changed collection gate');
    assert.deepEqual(h.records[1].args,[undefined,undefined]);
    assert.deepEqual(h.state(),{collect:false,count:2,parts:null,event:null});
});

test('nested direct drawing preserves ordering and the outer per-note context', () => {
    const h=harness(),outer=note(),inner=note({s:2,t:11});
    h.begin();h.draw(outer,9.9);
    h.hook(row=>{if(row.args[0]===outer)h.draw(inner,10.1);});
    h.flush();
    assert.deepEqual(h.seen.map(row=>row.args[0]),[outer,inner]);
    assert.equal(h.seen[0].parts,h.seen[1].parts);
    assert.equal(h.seen[0].event,h.seen[1].event);
    assert.equal(h.state().parts,null);assert.equal(h.state().event,null);
});

test('a throwing draw retains the current record but clears active context in finally', () => {
    const h=harness(),notes=[note({s:0}),note({s:1})];
    h.begin();for(const n of notes)h.draw(n,9.9);
    const error=new Error('provider failure');
    h.hook(row=>{if(row.args[0].s===1)throw error;});
    assert.throws(()=>h.flush(),e=>e===error);
    assert.deepEqual(h.records[0].args,[undefined,undefined]);
    assert.equal(h.records[0].event,null);
    assert.equal(h.records[1].args[0],notes[1]);
    assert.notEqual(h.records[1].event,null);
    assert.equal(h.state().parts,null);assert.equal(h.state().event,null);
});

test('a reused chord view clears stale fields and absent linked metadata', () => {
    const h=harness();Object.assign(h.scratch,note({ghost:true}));
    h.linkedStarts.set(h.scratch,.5);h.linkedEnds.set(h.scratch,{end:1});h.linkedVibrato.set(h.scratch,{run:2});h.linkedPaths.byNote.set(h.scratch,{path:3});
    h.begin();h.draw(h.scratch,9.9);const record=h.records[0],view=record.args[0];h.flush();
    delete h.scratch.ghost;h.scratch.f=7;
    h.linkedStarts.delete(h.scratch);h.linkedEnds.delete(h.scratch);h.linkedVibrato.delete(h.scratch);h.linkedPaths.byNote.delete(h.scratch);
    h.begin();h.draw(h.scratch,10);
    assert.equal(h.records[0],record);assert.equal(record.args[0],view);
    assert.equal(view.f,7);assert.equal(Object.hasOwn(view,'ghost'),false);
    assert.equal(h.linkedStarts.get(view),0);assert.equal(h.linkedEnds.get(view),undefined);
    assert.equal(h.linkedVibrato.get(view),undefined);assert.equal(h.linkedPaths.byNote.has(view),false);
    h.flush();assert.equal(h.seen[1].args[17],view);
});

test('an open slide endpoint uses chord source identity and pooled reuse restores an ordinary open tail', () => {
    const h=harness(),endpoint=note({f:0}),ordinary=note({f:0,t:11});
    h.hiddenOpenSlideTails.add(endpoint);
    Object.assign(h.scratch,endpoint);
    const args=Array(18).fill(undefined);
    args[0]=h.scratch;args[1]=9.9;args[7]=true;args[13]=true;args[17]=endpoint;
    h.begin();h.draw(...args);
    const record=h.records[0],view=record.args[0];
    assert.notEqual(view,endpoint,'the pooled drawing view is not the authored chord member');
    assert.equal(record.parts.head,false);
    assert.equal(record.parts.trail,false,'the original member identity hides both detached rails');
    assert.equal(record.event.gemVisible,false);
    assert.equal(record.event.trailVisible,false,'hidden tails cannot become overlap candidates');
    h.flush();
    Object.assign(h.scratch,ordinary);
    args[1]=10.9;args[13]=false;args[17]=ordinary;
    h.begin();h.draw(...args);
    assert.equal(h.records[0],record);assert.equal(record.args[0],view);
    assert.equal(record.parts.head,true);
    assert.equal(record.parts.trail,true,'pool reuse does not hide a later independent open note');
    assert.equal(record.event.gemVisible,true);
    assert.equal(record.event.trailVisible,true);
    h.flush();
});
