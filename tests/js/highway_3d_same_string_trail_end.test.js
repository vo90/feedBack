const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const block = src.slice(src.indexOf('    function hwyFootprintsOverlap1D('), src.indexOf('    /** Fixed pre-impact ramp window'));
const h = vm.runInNewContext('const NFRETS=24,MAX_RENDER_STRINGS=8;\n' + block + `
({hwyBuildTrailYieldEvents,hwyBuildTrailAttackIndex,hwyNextTrailAttack,hwySameStringTrailYieldAmountAt,
  hwyAppendSameStringContourTimes,hwyTrailYieldAmountAt,TRAIL_YIELD_DEFAULTS})`);
const cfg = h.TRAIL_YIELD_DEFAULTS;
const amount = (time, target=11, start=10, end=11, settings=cfg) =>
    h.hwySameStringTrailYieldAmountAt(time,target,start,end,settings);
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);

test('maximum gap includes 1 ms and exactly 50 ms, excluding larger gaps', () => {
    for (const origin of [0,347.12,3600.1234]) for (const gap of [-.2,0,.001,.049999,.05,.050001,.1]) {
        const event={t:origin+1+gap,s:3,f:2};
        assert.equal(h.hwyNextTrailAttack([event],origin,origin+1,cfg),gap<=.05?event:null);
    }
    assert.equal(h.hwyNextTrailAttack([{t:11.001}],10,11,{...cfg,sameStringMaxGap:0}),null);
    assert.equal(h.hwyNextTrailAttack([{t:11}],10,11,{...cfg,sameStringMaxGap:0}).t,11);
    assert.equal(h.hwyNextTrailAttack([{t:10.02}],10,10.019,cfg).t,10.02,
        'distinct rapid attacks must not inherit the cross-string 60 ms grouping tolerance');
});

test('indexes only visible attacks, skips ties, and keeps the very next attack', () => {
    const tied={t:10.5,s:3,f:4,sus:.5};
    const notes=[{t:11,s:3,f:2},{t:10,s:3,f:2,sus:1},tied,{t:10.7,s:3,f:7},{t:10.6,s:4,f:2}];
    const snapshot=JSON.stringify(notes);
    const byFret=h.hwyBuildTrailYieldEvents(notes,[],6,{suppressedAttacks:new Set([tied])});
    const index=h.hwyBuildTrailAttackIndex(byFret,6);
    assert.equal(h.hwyNextTrailAttack(index[3],10,11,cfg).f,7,'must not skip an earlier different-fret attack');
    assert.equal(h.hwyNextTrailAttack(index[3],10.7,11,cfg).t,11);
    assert.equal(JSON.stringify(notes),snapshot,'chart data stays unchanged');
});

test('stable 100 ms lead and existing 50 ms smooth taper, including a 1 ms gap', () => {
    near(amount(10.9),0);near(amount(10.925),.5);near(amount(10.95),1);near(amount(10.999,11,10,10.999),1);
    near(amount(10.95,11,10,10.95),1);near(amount(10.999,11,10,10.95),0);
    for (const duration of [.02,.05,.2]) {
        const settings={...cfg,endTaperDuration:duration};
        near(amount(10.9+duration/2,11,10,12,{...settings,taperDuration:duration}),.5);
        near(amount(10.925,11,10,11,settings), Math.min(1, .025/duration)**2 * (3-2*Math.min(1,.025/duration)));
    }
});

test('short trails clip the envelope without changing narrowing speed or attack shape', () => {
    near(amount(10.98,11,10.98,11),0);
    near(amount(10.99,11,10.98,11),.104);
    near(amount(11,11,10.98,11),.352);
    near(amount(10.97,11,10.98,11),0);
});

test('overlapping sustain narrows at the attack, holding to its authored end', () => {
    near(amount(10.925,11,10,12),.5);
    near(amount(11.5,11,10,12),1);
    near(amount(12,11,10,12),1);
    near(amount(12.001,11,10,12),0);
});

test('independent and master switches disable this rule, with cross-string widths unchanged', () => {
    for(const settings of [{...cfg,enabled:false},{...cfg,sameStringEnabled:false}]) {
        near(amount(10.99,11,10,11,settings),0);
        assert.equal(h.hwyNextTrailAttack([{t:11}],10,11,settings),null);
    }
    near(amount(10.99,NaN),0);
    for(const time of [10.2,10.5,10.525,10.55,10.9,11]) {
        near(h.hwyTrailYieldAmountAt(time,[11],[11],1,11,cfg),
            h.hwyTrailYieldAmountAt(time,[11],[11],1,11,{...cfg,sameStringEnabled:false}));
    }
});

test('contour samples retain the same taper across clipping and linked segment boundaries', () => {
    const full=[],a=[],b=[];
    h.hwyAppendSameStringContourTimes(10,11,11,10,11,cfg,full);
    h.hwyAppendSameStringContourTimes(10,10.927,11,10,11,cfg,a);
    h.hwyAppendSameStringContourTimes(10.927,11,11,10,11,cfg,b);
    assert.deepEqual([...a,...b],full);
    assert.equal(full.length,5);
    near(full[0],10.9);near(full[4],10.95);
});

test('long charts use binary next-attack lookup rather than scanning from the start', () => {
    let reads=0;
    const events=new Proxy(Array.from({length:100000},(_,i)=>({t:i})),{
        get(target,key){ if(/^\d+$/.test(String(key)))reads++;return target[key]; },
    });
    assert.equal(h.hwyNextTrailAttack(events,99990,99991,cfg).t,99991);
    assert.ok(reads<=20,`read ${reads} events`);
});
