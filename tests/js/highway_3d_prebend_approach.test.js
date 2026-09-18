const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = src.indexOf('function '+name+'(');
    assert.ok(start >= 0, name+' exists');
    const end = src.indexOf('\n        }', start) + '\n        }'.length;
    return src.slice(start,end);
}
function offset(n, now, sustained, dir = 1) {
    // Execute the actual assignment and envelope used by both the approaching
    // head and active sustain, including linked-start lookup.
    const assignment = src.match(/const techniqueYNow = [\s\S]*?;/)[0];
    const helpers = ['bnvSampleAt','bendCurveStartSemis','bendCurveSemisAt',
        'bendSemisAtElapsed','bendSemisAtTime','noteHasVibrato','vibratoSemisAtTime',
        'techniqueYOffsetWorld','prebendOffsetWorld'].map(extract).join('\n');
    return new Function('n','now','sustained','dir', `
        const BEND_HALFSTEP_WORLD_Y=1, bendVisualDirY=()=>dir;
        const BEND_ENV_RISE_FRAC=.35, BEND_ENV_RELEASE_FRAC=.30, VIBRATO_HALF_WAVE_S=.08;
        const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
        const _linkedVibratoRuns=new WeakMap();
        ${helpers}
        ${assignment}
        return techniqueYNow;
    `)(n,now,sustained,dir);
}
const mamma = {t:86.739,s:5,f:12,sus:.325,bn:2,bnv:[{t:0,v:2},{t:.216003,v:0}]};
// The reported Train Kept A-Rollin' Lead chord at 22.172001 s: its first
// authored sample is later than onset, with no explicit pre-bend intent.
const train = {t:22.172001,s:3,f:14,sus:1.68,bn:2,bnv:[
    {t:.157999,v:2},{t:.316999,v:2},{t:.632999,v:0},{t:1.230999,v:2},
]};

const alignment = new Function('n', 'now', 'nStr', '_invertedCached', `
    const BEND_HALFSTEP_WORLD_Y=1, BEND_ENV_RISE_FRAC=.35, BEND_ENV_RELEASE_FRAC=.3;
    const VIBRATO_HALF_WAVE_S=.08, SLIDE_RIBBON_SAMPLES=8;
    const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
    const TRAIL_YIELD_DEFAULTS={minScale:.3};
    const dZ=t=>-t*10, sustainTrailCenterXAt=(n,x)=>x;
    ${extract('bendVisualDirY')}
    ${extract('noteHasVibrato')}
    ${extract('bnvSampleAt')}
    ${extract('bendCurveStartSemis')}
    ${extract('bendCurveSemisAt')}
    ${extract('bendSemisAtElapsed')}
    ${extract('bendSemisAtTime')}
    ${extract('vibratoSemisAtTime')}
    ${extract('prebendOffsetWorld')}
    ${extract('techniqueYOffsetWorld')}
    ${extract('slideRibbonUpdatePair')}
    const sustained=now>n.t && now<=n.t+n.sus;
    ${src.match(/const techniqueYNow = [\s\S]*?;/)[0]}
    const y=10, susStart=Math.max(n.t,now);
    const geometry=()=>({attributes:{position:{array:new Float64Array((SLIDE_RIBBON_SAMPLES+1)*12)}}});
    const outline=geometry(), body=geometry();
    slideRibbonUpdatePair(outline,body,5,1,.4,.8,.2,y,
        n.t+n.sus-susStart,susStart,now,n,null);
    const center=geo=>(geo.attributes.position.array[1]+geo.attributes.position.array[7])/2;
    return {gem:y+techniqueYNow, body:center(body), outline:center(outline), dir:bendVisualDirY(n.s)};
`);

test('authored initial bend is already displaced during approach and at onset', () => {
    for(const time of [86.4,86.738,86.739]) assert.equal(offset(mamma,time,false),2);
});
test('prebend approaches the sustained trajectory continuously', () => {
    const atHit=offset(mamma,mamma.t,false);
    const after=offset(mamma,mamma.t+1e-6,true);
    assert.ok(Math.abs(atHit-after)<.00001);
});
test('initial bend uses the same direction for low strings and inverted layouts', () => {
    assert.equal(offset(mamma,86.4,false,-1),-2);
    assert.equal(offset(mamma,86.4,false,1),2);
});
test('ordinary and scalar bends remain on the string while approaching', () => {
    for(const bnv of [undefined,[],[{t:0,v:0},{t:.2,v:2}],[{t:.2,v:2}],[{t:.2,v:0},{t:.3,v:2}]]) {
        assert.equal(offset({...mamma,bnv},86.4,false),0);
    }
});

test('an ordinary delayed positive curve starts unbent and keeps the gem aligned with the ribbon', () => {
    for (const time of [train.t-1, train.t-1e-6, train.t, train.t+1e-6, train.t+.4]) {
        const rendered=alignment(train,time,6,false);
        assert.ok(Math.abs(rendered.gem-rendered.body)<1e-10,
            'the gem and actual first ribbon cross-section must share their center');
        assert.ok(Math.abs(rendered.gem-rendered.outline)<1e-10);
    }
    assert.equal(offset(train,train.t-1,false),0);
});

test('fractional onset bends align every string in normal and inverted layouts', () => {
    for (const count of [4,6,7,8]) {
        for (const inverted of [false,true]) {
            for (let s=0;s<count;s++) {
                for (const firstTime of [0,.0005,.157999]) {
                    for (const semis of [.5,1.5,2.5]) for (const bt of [0,1,2,3]) {
                        const n={...train,s,bt,bnv:[{t:firstTime,v:semis},{t:.4,v:0}]};
                        for (const time of [n.t-.2,n.t,n.t+1e-6]) {
                            const r=alignment(n,time,count,inverted);
                            assert.ok(Math.abs(r.gem-r.body)<1e-10);
                            assert.ok(Math.abs(r.gem-r.outline)<1e-10);
                            const initial=firstTime<=1e-6 || bt>0 ? semis : 0;
                            if (time<=n.t) assert.equal(r.gem,10+r.dir*initial);
                        }
                    }
                }
            }
        }
    }
});

test('zero-onset and scalar bend ribbons still meet an unbent approach gem', () => {
    for (const bnv of [undefined,[],[{t:0,v:0},{t:.2,v:2}],[{t:.1,v:0},{t:.2,v:2}]]) {
        const n={...train,bnv};
        for (const time of [n.t-.2,n.t]) {
            const r=alignment(n,time,6,false);
            assert.equal(r.gem,10);
            assert.equal(r.body,10);
            assert.equal(r.outline,10);
        }
    }
});
test('invalid curves and notes without sustain do not create a prebend', () => {
    for(const change of [{sus:0},{bnv:[{t:0,v:-2}]},{bnv:[{t:0,v:NaN}]},{bnv:[{t:NaN,v:2}]}]) {
        assert.equal(offset({...mamma,...change},86.4,false),0);
    }
});
test('prebend does not reappear after its released sustain ends', () => {
    assert.equal(offset(mamma,mamma.t+mamma.sus+.01,false),0);
});
test('all head-attached techniques share the corrected displacement', () => {
    const start=src.indexOf('// ── Technique labels');
    const labels=src.slice(start,src.indexOf('// ── Board projection',start));
    assert.ok(labels.includes('y + techniqueYNow'));
});
