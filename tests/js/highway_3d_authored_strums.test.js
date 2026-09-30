const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '('), open = source.indexOf('{', start);
    assert.ok(start >= 0, name);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name);
}
const build = new Function('const NFRETS=24, CHORD_ANCHOR_TIME_EPS=1e-6;\n' + [
    'isPlayableFret','isPlainDeadNote','isUnpitchedMute','isRenderableNote','getChartAnchorAt',
    'laneBoundsFromAnchor','anchorPlayedFretInclusiveSpan','playedFretSpanCoversShape',
    'chordFallbackLaneBounds','hwyBuildAuthoredStrumFrames',
].map(extract).join('\n') + '\nreturn hwyBuildAuthoredStrumFrames;')();
const anchor = [{time:0,fret:3,width:4}];
function brush(up=false, gap=.02, id=0) {
    return [0,1,2].map((s,i)=>({t:10+(up?2-i:i)*gap,s,f:[0,3,5][i],sus:.5,ch:id}));
}
for (const up of [true,false]) for (const gap of [.001,.02,.18,.6]) {
    test(`one frame at first attack: direction=${up}, interval=${gap}`,()=>{
        const notes=brush(up,gap), before=JSON.stringify(notes);
        notes.forEach(Object.freeze);Object.freeze(notes);
        const result=build(notes,[],anchor);
        assert.equal(result.frames.length,1);
        const frame=result.frames[0];
        assert.equal(frame.t,10);
        assert.equal(frame.lastAttack,10+2*gap);
        for(const n of notes)assert.equal(result.byNote.get(n),frame);
        assert.equal(JSON.stringify(notes),before);
        assert.deepEqual(frame.bounds,{dMin:2,dMax:6});
    });
}
test('unmarked nearby attacks and single/incomplete ambiguous groups stay separate',()=>{
    for (const notes of [brush().map(({ch,...n})=>n),brush().slice(0,1),[...brush(),brush()[0]],
        brush().map(n=>({...n,ch:-1})),brush().map(n=>({...n,ch:'0'})),brush(false,0)]) {
        assert.equal(build(notes,[],anchor).frames.length,0);
    }
});
test('repeated groups stay separate and do not duplicate real chords',()=>{
    const a=brush(),b=brush(false,.03,1).map(n=>({...n,t:n.t+1}));
    assert.equal(build([...a,...b],[],anchor).frames.length,2);
    assert.equal(build(a,[{t:a[0].t,notes:[a[0]]}],anchor).frames.length,0);
});
test('all muted/open strings use onset lane, ignoring hidden mute frets and later camera anchors',()=>{
    const notes=brush().map(n=>({...n,f:23,mt:true}));
    const result=build(notes,[],[...anchor,{time:10.01,fret:15,width:4}]);
    assert.deepEqual(result.frames[0].bounds,{dMin:2,dMax:6});
    assert.equal(result.byNote.get(notes[2]).bounds,result.frames[0].bounds);
});
test('real fret span fallback includes the last string of a staggered brush',()=>{
    const notes=brush().map((n,i)=>({...n,f:i?8:2}));
    assert.deepEqual(build(notes,[],anchor).frames[0].bounds,{dMin:1,dMax:8});
});
test('invalid string or fret invalidates its entire group',()=>{
    for(const changed of [{s:8},{f:30},{t:NaN}]){
        const notes=brush();Object.assign(notes[1],changed);
        assert.equal(build(notes,[],anchor).frames.length,0);
    }
});
