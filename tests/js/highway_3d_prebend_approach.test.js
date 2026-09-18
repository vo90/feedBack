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
        ${helpers}
        ${assignment}
        return techniqueYNow;
    `)(n,now,sustained,dir);
}
const mamma = {t:86.739,s:5,f:12,sus:.325,bn:2,bnv:[{t:0,v:2},{t:.216003,v:0}]};

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
    for(const bnv of [undefined,[],[{t:0,v:0},{t:.2,v:2}],[{t:.2,v:2}]]) {
        assert.equal(offset({...mamma,bnv},86.4,false),0);
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
