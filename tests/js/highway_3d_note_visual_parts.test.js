const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const lifetime = src.slice(src.indexOf('    function hwyNoteVisualParts('), src.indexOf('\n    }', src.indexOf('    function hwyNoteVisualParts(')) + 6);
const predicates = src.slice(src.indexOf('    function isPlayableFret('), src.indexOf('    function isRenderableNote('));
const events = src.slice(src.indexOf('    function hwyFootprintsOverlap1D('), src.indexOf('    /** Fixed pre-impact ramp window'));
const h = vm.runInNewContext('const NFRETS=24,MAX_RENDER_STRINGS=8;\n' + predicates + events + lifetime + `
({hwyNoteVisualParts,hwyBuildTrailYieldEvents,hwyBuildTrailAttackIndex,hwyNextTrailAttack,hwyFillTrailOcclusionTargets,hwyBuildTrailOcclusionIndex})`);
const note = (extra={}) => ({t:10,s:3,f:5,sus:2,...extra});
const parts = (n, now, head=false, trail=false, next=Infinity, start=n.t) =>
    h.hwyNoteVisualParts(n,now,3,.1,next,start,head,trail);

test('hidden continuation head keeps only its real sustain visible', () => {
    for (const now of [9.8,10,11.9]) {
        const p=parts(note(),now,true);
        assert.equal(p.head,false); assert.equal(p.trail,true);
    }
    assert.equal(parts(note(),12.1,true).trail,false);
});
test('shared holds hide individual tails without hiding their attacks', () => {
    const p=parts(note(),9.8,false,true);
    assert.equal(p.head,true); assert.equal(p.trail,false);
});
test('short-head linger and long sustain lifetimes match their drawn geometry', () => {
    assert.equal(parts(note({sus:0}),10.04,false,false,10.05).head,true);
    assert.equal(parts(note({sus:0}),10.06,false,false,10.05).head,false);
    assert.equal(parts(note(),11,false,false,10.05).head,true,'another attack cannot cut a held note short');
    assert.equal(parts(note({sus:.005}),9.8).trail,false,'subthreshold tail has no mesh');
    const p=parts(note({sus:0}),6.8,true,false,Infinity,9.9);
    assert.equal(p.head,false); assert.equal(p.trail,false,'lead-in outside horizon');
    assert.equal(parts(note({sus:0}),7.95,true,false,Infinity,9.9).trail,true);
});
test('separate duplicate origins cannot donate hidden duration or geometry', () => {
    const a=note({sus:.2}),b=note({sus:5,sl:9});
    const chord={t:10,notes:[b]};
    const byFret=h.hwyBuildTrailYieldEvents([a],[chord],6,{separateRepresentations:true});
    assert.equal(byFret[5].length,2);
    assert.equal(byFret[5][0].end,10.2);
    assert.equal(byFret[5][0].sl,-1);
    assert.equal(byFret[5][1].sourceChord,chord);
    const index=h.hwyBuildTrailOcclusionIndex(byFret,6);
    byFret[5][1].gemVisible=byFret[5][1].trailVisible=false;
    assert.equal(byFret[5][0].end,10.2);
    const count=h.hwyFillTrailOcclusionTargets(index,10.4,11,2,10.4,11,false,
        new Array(8),new Uint8Array(8),new Float64Array(8),new Float64Array(8));
    assert.equal(count,0,'hidden long duplicate cannot extend the ended visible tail');
});
test('cached attack index observes hide, reveal and rewind without rebuilding', () => {
    const byFret=h.hwyBuildTrailYieldEvents([note({t:11}),note({t:11.2,f:8})],[],6);
    const index=h.hwyBuildTrailAttackIndex(byFret,6);
    const first=byFret[5][0];
    assert.equal(h.hwyNextTrailAttack(index[3],10,12),first);
    first.gemVisible=false;
    assert.equal(h.hwyNextTrailAttack(index[3],10,12).f,8);
    first.gemVisible=true;
    assert.equal(h.hwyNextTrailAttack(index[3],10,12),first);
});
test('hidden attacks beyond the source cannot force a scan of the rest of the song', () => {
    let reads=0;
    const events=new Proxy(Array.from({length:10000},(_,i)=>({t:20+i,gemVisible:false})),{
        get(target,key){if(/^\d+$/.test(String(key)))reads++;return target[key];},
    });
    assert.equal(h.hwyNextTrailAttack(events,10,12),null);
    assert.ok(reads<30,'search must stop at the source end');
});
