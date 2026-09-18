const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}
function constant(name) {
    const match = src.match(new RegExp('const ' + name + ' = ([\\d.]+);'));
    assert.ok(match, name);
    return Number(match[1]);
}
function harness(nStr = 6, inverted = false) {
    return new Function('nStr', '_invertedCached', `
        const BEND_ENV_RISE_FRAC=${constant('BEND_ENV_RISE_FRAC')};
        const BEND_ENV_RELEASE_FRAC=${constant('BEND_ENV_RELEASE_FRAC')};
        const BEND_HALFSTEP_WORLD_Y=3.2;
        const NEXT_ON_STRING_T_EPS=${constant('NEXT_ON_STRING_T_EPS')};
        const BEND_LINK_TIME_EPS=${constant('BEND_LINK_TIME_EPS')};
        const VIBRATO_HALF_WAVE_S=${constant('VIBRATO_HALF_WAVE_S')};
        let _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
        let _linkedVibratoRuns=new WeakMap();
        ${['hwyLinkNextTargetNotes', 'noteHasVibrato', 'resolveLinkedVibratoRuns',
            'vibratoSemisAtTime', 'bnvSampleAt', 'bendCurveStartSemis',
            'bendCurveSemisAt', 'bendSemisAtElapsed', 'resolveLinkedBendEnds',
            'resolveLinkedBendStarts', 'bendSemisAtTime', 'bendVisualDirY',
            'prebendOffsetWorld', 'techniqueYOffsetWorld'].map(fn).join('\n')}
        return {
            link(notes,chords=[]) {
                const links=new Map();
                const targets=hwyLinkNextTargetNotes(notes,chords,1e-6,links);
                _linkedBendEnds=resolveLinkedBendEnds(links);
                _linkedBendStarts=resolveLinkedBendStarts(links,_linkedBendEnds);
                _linkedVibratoRuns=resolveLinkedVibratoRuns(links);
                return {links,targets,runs:_linkedVibratoRuns};
            },
            at:vibratoSemisAtTime, y:techniqueYOffsetWorld, bend:bendSemisAtTime,
            chordView(cn,time,_scrChordNote={}) {
                Object.assign(_scrChordNote,cn,{t:time});
                ${src.match(/_linkedVibratoRuns\.set\(_scrChordNote,[\s\S]*?;/)[0]}
                return _scrChordNote;
            },
            mutedView(sourceNote) {
                const n={...sourceNote,f:0};
                ${src.match(/_linkedVibratoRuns\.set\(n, _linkedVibratoRuns\.get\(sourceNote\)[\s\S]*?;/)[0]}
                return n;
            },
            gemOffset(n,now) {
                const sustained=now>n.t && now<=n.t+(n.sus||0);
                ${src.match(/const techniqueYNow = [\s\S]*?;/)[0]}
                return techniqueYNow;
            },
        };
    `)(nStr,inverted);
}
const note = (values = {}) => ({ t: 1, s: 5, f: 22, sus: .458, vb: true, ...values });
const end = n => n.t + n.sus;
function close(actual, expected, message = '') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
        `${message}: expected ${expected}, received ${actual}`);
}

test('Bodom 68.121 vibrato joins its authored slide-out at 68.579 without changing the chart or attacks', () => {
    const a=note({t:67.807,sus:.314,vb:false,ln:true});
    const b=note({t:68.121,ln:true});
    const c=note({t:68.579,sus:.076,vb:false,slu:12});
    const frozen=JSON.stringify([a,b,c]), h=harness();
    const linked=h.link([a,b,c]);
    assert.ok(linked.targets.has(b) && linked.targets.has(c));
    close(h.y(a,end(a)),h.y(b,b.t),'entry endpoint');
    close(h.y(b,end(b)),h.y(c,c.t),'slide-out endpoint');
    close(h.at(b,b.t+.12),Math.sin(.12*Math.PI/.08),'full vibrato between fades');
    close(h.gemOffset(b,b.t+.13),h.y(b,b.t+.13),'gem and ribbon use same motion');
    close(h.at(b,end(b)+.2),0,'clamped endpoint does not restart after its sustain');
    assert.equal(JSON.stringify([a,b,c]),frozen);
});

test('vibrato chains carry phase across differently sized pieces and into the final non-vibrato sustain', () => {
    const pieces=[.137,.047,.221,.009,.309,.011,.149];
    let time=10;
    const notes=pieces.map(sus=>{ const n=note({t:time,sus,ln:true});time+=sus;return n; });
    const tail=note({t:time,vb:false});
    const h=harness();h.link([...notes,tail]);
    let phase=0;
    for(let i=0;i<notes.length-1;i++) {
        phase+=notes[i].sus;
        close(h.at(notes[i],end(notes[i])),h.at(notes[i+1],notes[i+1].t),'phase handoff '+i);
        close(h.at(notes[i],end(notes[i])),Math.sin(phase*Math.PI/.08),'not restarted '+i);
    }
    close(h.at(notes.at(-1),end(notes.at(-1))),0,'tail meets non-vibrato');
});

test('millisecond rounding tolerance preserves phase without bridging authored gaps or overlaps', () => {
    for(const delta of [0,.001,-.001,.00101,-.00101,.09]) {
        const a=note({t:20,sus:.127,ln:true});
        const b=note({t:end(a)+delta,sus:.317});
        const h=harness(), linked=h.link([a,b]);
        if(Math.abs(delta)<=.001) {
            assert.ok(linked.runs.has(a) && linked.runs.has(b));
            close(h.at(a,end(a)),h.at(b,b.t),'rounded handoff '+delta);
        } else {
            assert.equal(linked.runs.has(a),false);
            assert.equal(linked.runs.has(b),false);
            close(h.at(a,end(a)),Math.sin(a.sus*Math.PI/.08),'authored break untouched');
        }
    }
});

test('short runs have bounded smooth envelopes, finite samples and zero slope at a linked exit', () => {
    for(const duration of [.0001,.001,.005,.03,.1,.458]) {
        const a=note({t:0,sus:1,vb:false,ln:true});
        const b=note({sus:duration,ln:true});
        const c=note({t:end(b),vb:false});
        const h=harness();h.link([a,b,c]);
        close(h.at(b,b.t),0);close(h.at(b,end(b)),0);
        for(let i=0;i<=100;i++) assert.ok(Math.abs(h.at(b,b.t+duration*i/100))<=1);
        const eps=duration*1e-6;
        assert.ok(Math.abs(h.at(b,end(b)-eps))<1e-9,'smooth exit '+duration);
        assert.ok(Math.abs(h.at(b,b.t+eps))<1e-9,'smooth entry '+duration);
    }
});

test('long chains are resolved iteratively and samples are independent of seek order', () => {
    const notes=Array.from({length:2000},(_,i)=>note({t:i*.137,sus:.137,ln:true}));
    const tail=note({t:2000*.137,vb:false});
    const h=harness();h.link([...notes,tail]);
    for(const i of [1999,10,0,987,1998,10]) {
        const n=notes[i], t=n.t+.04;
        close(h.at(n,t),Math.sin((i*.137+.04)*Math.PI/.08),'seek '+i);
    }
    close(h.at(notes.at(-1),end(notes.at(-1))),0);
});

test('ambiguous sources or destinations cannot choose a vibrato run by array order', () => {
    const a=note({t:0,sus:.137,ln:true}), b=note({t:.137,sus:.3,vb:false});
    for(const notes of [[a,{...a},b],[a,b,{...b}],[{...a},a,b],[a,{...b},b]]) {
        const h=harness(), linked=h.link(notes);
        assert.equal(linked.runs.has(a),false);
        close(h.at(a,end(a)),Math.sin(.137*Math.PI/.08));
    }
});

test('unlinked vibrato, invalid sustains and incompatible targets retain legacy behavior', () => {
    for(const changes of [{ln:false},{ln:'true'},{sus:0},{sus:-1},{sus:NaN},{sus:Infinity}]) {
        const a=note({t:0,sus:.137,ln:true,...changes});
        const b=note({t:.137,vb:false});
        const h=harness(), linked=h.link([a,b]);
        assert.equal(linked.runs.has(a),false);
    }
    for(const changes of [{f:21},{s:4},{sus:0},{sus:NaN},{sus:Infinity}]) {
        const a=note({t:0,sus:.137,ln:true}), b=note({t:.137,vb:false,...changes});
        const h=harness(), linked=h.link([a,b]);
        assert.equal(linked.runs.has(a),false);
    }
    const h=harness(), n=note();h.link([n]);
    for(const elapsed of [0,.04,.137,.458])close(h.at(n,n.t+elapsed),Math.sin(elapsed*Math.PI/.08));
});

test('linked envelope does not alter authoritative bends or invert string direction', () => {
    const a=note({t:0,sus:.137,ln:true,bnv:[{t:0,v:2},{t:.137,v:2}]});
    const b=note({t:.137,sus:.3,vb:false,bnv:[{t:0,v:2},{t:.3,v:0}]});
    for(const inverted of [false,true]) {
        const h=harness(6,inverted);h.link([a,b]);
        for(const elapsed of [0,.03,.1,.137])close(h.bend(a,elapsed),2);
        close(h.y(a,end(a)),h.y(b,b.t),'authored bend handoff');
        const dir=inverted?-1:1;
        close(h.y(a,.03),dir*3.2*(2+h.at(a,.03)));
    }
});

test('chord members inherit chord times and scratch or mute copies retain and clear their run', () => {
    const a=note({t:0,sus:.137,ln:true});
    const b={s:5,f:22,sus:.151,vb:true,ln:true};
    const c={s:5,f:22,sus:.3,vb:false};
    const h=harness(), linked=h.link([a],[{t:.137,notes:[b]},{t:.288,notes:[c]}]);
    assert.ok(linked.runs.has(b));
    const scratch={};h.chordView(b,.137,scratch);
    close(h.at(a,end(a)),h.at(scratch,.137));
    close(h.at(scratch,.288),0);
    const muted=h.mutedView(scratch);
    close(h.at(muted,.22),h.at(scratch,.22));
    const fresh=note({t:2});h.chordView(fresh,2,scratch);
    close(h.at(scratch,2.04),1,'reused view drops prior run context');
    h.link([fresh]);
    close(h.at(a,end(a)),Math.sin(a.sus*Math.PI/.08),'chart replacement drops old context');
});

test('run cache is built with chart-static link data and released with the other link caches', () => {
    assert.match(src, /_linkedVibratoRuns = resolveLinkedVibratoRuns\(bendLinks\)/);
    assert.equal((src.match(/_linkedVibratoRuns = new WeakMap\(\)/g)||[]).length,2);
    assert.match(fn('techniqueYOffsetWorld'), /vibratoSemisAtTime\(n, chartTime\)/);
    assert.match(fn('drawNote'), /techniqueYOffsetWorld\(n, now\)/);
    assert.match(src, /const yc = y \+ techniqueYOffsetWorld\(n, Tk\)/,
        'sustain contour calls the shared sampler');
});
