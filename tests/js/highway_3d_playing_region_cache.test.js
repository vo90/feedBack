const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
    return source.slice(start, end);
}
function harness() {
    const start = source.indexOf('const _stableRegions = {');
    const end = source.indexOf('function stableRegionReset()', start);
    return new Function(`
        let nStr=6, _h3dFretUniform=true, lefty=false, builds=0;
        ${source.slice(start, end)}
        const xFret=f=>(lefty?-1:1)*f*10;
        function hwyBuildPlayingRegions(notes,chords,anchors) {
            builds++;
            return anchors?.length ? anchors.map(a=>({...a,source:'authored'}))
                : [{time:0,fret:3,width:4,source:'inferred'}];
        }
        ${extract('getChartAnchorAt')}
        ${extract('stableRegionReset')}
        ${extract('stableRegionAnchors')}
        ${extract('stablePlayingRegion')}
        return {
            rows:stableRegionAnchors,
            region:(b,t)=>({...stablePlayingRegion(b,t)}),
            count:()=>builds,
            cache:()=>_stableRegions,
            reset:stableRegionReset,
            options(o){ if(o.strings)nStr=o.strings; if('uniform'in o)_h3dFretUniform=o.uniform; if('lefty'in o)lefty=o.lefty; }
        };
    `)();
}
const bundle = () => ({notes:[],chords:[],anchors:[{time:0,fret:2,width:4},{time:10,fret:10,width:4}]});

test('region queries reuse the chart index across frames, rests and seeks', () => {
    const h=harness(), b=bundle(), rows=h.rows(b);
    for(let i=0;i<2000;i++) h.region(b, i%2 ? 1 : 11);
    assert.equal(h.count(),1);
    assert.equal(h.rows(b), rows);
    assert.equal(h.region(b,1).x,30);
    assert.equal(h.region(b,11).x,110);
});
test('anchor replacement of equal size and streamed growth rebuild the index', () => {
    const h=harness(), b=bundle(); h.region(b,1);
    b.anchors=[{time:0,fret:15,width:4},{time:10,fret:10,width:4}];
    assert.equal(h.region(b,1).x,160);
    b.anchors.push({time:20,fret:20,width:4});
    assert.equal(h.region(b,21).x,210);
    assert.equal(h.count(),3);
});
test('notes, chords, spacing and string count invalidate inferred region data', () => {
    const h=harness(), b=bundle(); h.rows(b);
    b.notes=[]; h.rows(b);
    b.chords=[]; h.rows(b);
    b.notes.push({t:1,s:0,f:2}); h.rows(b);
    h.options({uniform:false}); h.rows(b);
    h.options({strings:4}); h.rows(b);
    assert.equal(h.count(),6);
});
test('left-handed camera bounds mirror the whole area without rebuilding chart positions', () => {
    const h=harness(), b=bundle(), right=h.region(b,11);
    h.options({lefty:true}); const left=h.region(b,11);
    assert.equal(left.x,-right.x);
    assert.equal(left.minX,-right.maxX);
    assert.equal(left.maxX,-right.minX);
    assert.equal(left.dMin,right.dMin);
    assert.equal(h.count(),1);
});
test('the preferred centre uses the outer fret wires and preserves width changes', () => {
    const h=harness(), b=bundle(); b.anchors=[{time:0,fret:3,width:4},{time:5,fret:3,width:8}];
    const a=h.region(b,1), z=h.region(b,6);
    assert.deepEqual([a.dMin,a.dMax,a.minX,a.maxX,a.x],[2,6,20,60,40]);
    assert.deepEqual([z.dMin,z.dMax,z.minX,z.maxX,z.x],[2,10,20,100,60]);
});
test('teardown releases all chart references and the last returned region row', () => {
    const h=harness(), b=bundle(); h.region(b,11); h.reset();
    assert.equal(h.cache().notes,null);
    assert.equal(h.cache().chords,null);
    assert.equal(h.cache().anchors,null);
    assert.deepEqual(h.cache().rows,[]);
    h.region(b,1); assert.equal(h.count(),2);
});
