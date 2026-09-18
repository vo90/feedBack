const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' exists');
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
    assert.ok(match, name + ' exists');
    return Number(match[1]);
}
function harness(strings = 6, inverted = false, lefty = false) {
    return new Function('nStr', '_invertedCached', '_leftyCached', `
        const BEND_ENV_RISE_FRAC=${constant('BEND_ENV_RISE_FRAC')};
        const BEND_ENV_RELEASE_FRAC=${constant('BEND_ENV_RELEASE_FRAC')};
        const NEXT_ON_STRING_T_EPS=${constant('NEXT_ON_STRING_T_EPS')};
        const BEND_LINK_TIME_EPS=${constant('BEND_LINK_TIME_EPS')};
        const BEND_HALFSTEP_WORLD_Y=3.2, VIBRATO_HALF_WAVE_S=.08;
        let _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
        const _linkedVibratoRuns=new WeakMap();
        ${['bnvSampleAt','bendCurveStartSemis','bendCurveSemisAt','bendSemisAtElapsed',
            'resolveLinkedBendEnds','resolveLinkedBendStarts','bendSemisAtTime','bendVisualDirY','noteHasVibrato',
            'vibratoSemisAtTime','prebendOffsetWorld','techniqueYOffsetWorld',
            'hwyLinkNextTargetNotes'].map(fn).join('\n')}
        return {
            link(notes,chords=[]) {
                const links=new Map();
                const targets=hwyLinkNextTargetNotes(notes,chords,1e-6,links);
                _linkedBendEnds=resolveLinkedBendEnds(links);
                _linkedBendStarts=resolveLinkedBendStarts(links,_linkedBendEnds);
                return {links,targets,starts:_linkedBendStarts,ends:_linkedBendEnds};
            },
            at:bendSemisAtTime, start:bendCurveStartSemis,
            elapsed:bendSemisAtElapsed, curve:bendCurveSemisAt, raw:bnvSampleAt,
            approach:prebendOffsetWorld, offset:techniqueYOffsetWorld, direction:bendVisualDirY,
            linkedElapsed(n,elapsed){
                return bendSemisAtElapsed(n,elapsed,_linkedBendStarts.get(n)||0,_linkedBendEnds.get(n));
            },
            chordView(cn,time,_scrChordNote={}) {
                Object.assign(_scrChordNote,cn,{t:time});
                ${src.match(/_linkedBendStarts\.set\(_scrChordNote,[\s\S]*?;/)[0]}
                ${src.match(/_linkedBendEnds\.set\(_scrChordNote,[\s\S]*?;/)[0]}
                return _scrChordNote;
            },
            mutedView(sourceNote) {
                const n={...sourceNote,f:0};
                ${src.match(/_linkedBendStarts\.set\(n, _linkedBendStarts\.get\(sourceNote\)[\s\S]*?;/)[0]}
                ${src.match(/_linkedBendEnds\.set\(n, _linkedBendEnds\.get\(sourceNote\)[\s\S]*?;/)[0]}
                return n;
            },
            gemOffset(n,now) {
                const sustained=now>n.t && now<=n.t+(n.sus||0);
                ${src.match(/const techniqueYNow = [\s\S]*?;/)[0]}
                return techniqueYNow;
            },
        };
    `)(strings, inverted, lefty);
}
function close(actual, expected, label = '') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
        `${label}: expected ${expected}, received ${actual}`);
}
const note = (change = {}) => ({t:1,s:2,f:7,sus:1,bn:2,bnv:[{t:.25,v:2},{t:1,v:0}],...change});

test('Twilight slide-to-fret-24 meets its delayed bend at zero pitch, then follows all authored samples', () => {
    const h=harness();
    const source={t:213.468994,s:5,f:22,sus:.079,sl:24,ln:true};
    const target={t:213.548004,s:5,f:24,sus:1.099,bn:2,
        bnv:[{t:.313995,v:2},{t:.627991,v:2},{t:1.098999,v:0}],ig:true};
    const before=JSON.stringify([source,target]);
    const linked=h.link([source,target]);
    assert.equal(linked.targets.has(target),true,'the authored destination attack remains suppressed');
    assert.equal(linked.links.get(target).source,source);
    close(h.at(source,source.t+source.sus),0);
    close(h.at(target,target.t),0);
    close(h.at(target,target.t+.313995/2),1);
    for(const point of target.bnv)close(h.at(target,target.t+point.t),point.v);
    close(h.offset(source,source.t+source.sus),h.offset(target,target.t),'ribbon handoff');
    close(h.gemOffset(target,target.t-.1),0);
    assert.equal(JSON.stringify([source,target]),before,'rendering context never edits chart data');
});

test('ordinary delayed bend curves rise from zero while the low-level endpoint sampler stays unchanged', () => {
    const h=harness(), n=note();
    close(h.raw(n.bnv,0),2,'generic interpolation keeps its endpoint-clamp contract');
    close(h.start(n),0);close(h.at(n,n.t),0);
    close(h.at(n,n.t+.125),1);close(h.at(n,n.t+.25),2);
    close(h.at(n,n.t+.625),1);close(h.at(n,n.t+1),0);
    close(h.approach(n),0);
});

test('explicit time-zero samples, including zero, remain authoritative over bend type and linked pitch', () => {
    const h=harness();
    for(const value of [0,.5,1.5])for(const bt of [0,1,2,3]) {
        const n=note({bt,bnv:[{t:0,v:value},{t:.5,v:2},{t:1,v:0}]});
        close(h.start(n,3),value);
        close(h.elapsed(n,0,3),value);
        close(h.elapsed(n,.25,3),(value+2)/2);
        const source=note({t:0,ln:true,bnv:[{t:0,v:1},{t:1,v:3}]});
        h.link([source,n]);close(h.at(n,n.t),value);
        close(h.gemOffset(n,n.t),h.offset(n,n.t));
    }
});

test('explicit bt 1, 2 and 3 retain a delayed first value as their authored initial pitch', () => {
    const h=harness();
    for(const bt of [1,2,3])for(const value of [.5,1.5,2.5]) {
        const n=note({bt,bnv:[{t:.2,v:value},{t:.6,v:value},{t:1,v:0}]});
        close(h.start(n,.25),value);
        for(const elapsed of [0,.1,.2])close(h.elapsed(n,elapsed,.25),value);
        close(h.approach(n),h.direction(n.s)*3.2*value);
        close(h.at(n,n.t+.8),value/2);
    }
});

test('a contiguous linked bend inherits the preceding endpoint and ramps to its next authored sample', () => {
    const h=harness();
    const source=note({t:0,ln:true,bnv:[{t:0,v:.5},{t:1,v:1.5}]});
    const target=note({bnv:[{t:.5,v:2.5},{t:1,v:0}]});
    const linked=h.link([source,target]);
    close(linked.starts.get(target),1.5);
    close(h.at(target,1),1.5);close(h.at(target,1.25),2);close(h.at(target,1.5),2.5);
    close(h.offset(source,1),h.offset(target,1));
});

test('linked chains resolve chronologically even when the chart arrays arrive in another order', () => {
    const h=harness();
    const a=note({t:0,ln:true,bnv:[{t:0,v:.5},{t:1,v:.5}]});
    const b=note({t:1,ln:true,bnv:[{t:.5,v:1.5},{t:1,v:1.5}]});
    const c=note({t:2,bnv:[{t:.5,v:.75},{t:1,v:0}]});
    const linked=h.link([c,a,b]);
    close(linked.starts.get(b),.5);close(linked.starts.get(c),1.5);
    close(h.at(a,1),h.at(b,1));close(h.at(b,2),h.at(c,2));
    close(h.at(c,2.25),1.125);
});

test('chord members without their own time participate in the same linked bend chain', () => {
    const h=harness();
    const source={s:2,f:7,sus:1,ln:true,bnv:[{t:0,v:.5},{t:1,v:1.25}]};
    const middle=note({t:1,ln:true,bnv:[{t:.25,v:2},{t:1,v:2}]});
    const destination={s:2,f:7,sus:1,bnv:[{t:.5,v:1},{t:1,v:0}]};
    const chords=[{t:0,notes:[source]},{t:2,notes:[destination]}];
    const before=JSON.stringify(chords);
    const linked=h.link([middle],chords);
    assert.equal(linked.links.get(middle).sourceTime,0);
    assert.equal(linked.links.get(destination).targetTime,2);
    close(linked.starts.get(middle),1.25);close(linked.starts.get(destination),2);
    close(h.linkedElapsed(destination,.25),1.5);
    assert.equal(JSON.stringify(chords),before);
});

test('overlaps, expired sustains and missing sustain do not provide bend inheritance', () => {
    const h=harness();
    for(const sus of [undefined,0,.8,1.2]) {
        const source=note({t:0,sus,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]});
        const target=note();
        const linked=h.link([source,target]);
        close(h.at(target,1),0);
        if(sus!==.8)assert.equal(linked.targets.has(target),true,'attack policy retains hold/overlap compatibility');
        assert.ok(!linked.starts.has(target) || linked.starts.get(target)===0);
    }
    const source=note({t:0,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]});
    const delayed=note({t:1+constant('BEND_LINK_TIME_EPS')*2});
    const linked=h.link([source,delayed]);
    assert.equal(linked.targets.has(delayed),true,'body tolerance remains more permissive than pitch continuity');
    assert.equal(linked.links.get(delayed),null);
    close(h.at(delayed,delayed.t),0);
});

test('ambiguous duplicate sources never choose a bend height from array order', () => {
    for(const reverse of [false,true]) {
        const h=harness();
        const a=note({t:0,ln:true,bnv:[{t:0,v:.5},{t:1,v:.5}]});
        const b=note({t:0,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]});
        const target=note();
        const linked=h.link(reverse?[b,a,target]:[a,b,target]);
        assert.equal(linked.targets.has(target),true);
        assert.equal(linked.links.get(target),null);
        close(h.at(target,1),0);
    }
    const h=harness(), source=note({t:0,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]}), target=note();
    const linked=h.link([source,target],[{t:0,notes:[source]}]);
    close(linked.starts.get(target),1.5,'the same authored object listed twice is not a conflicting source');
});

test('scalar bend fallback is unchanged and never adopts a linked-start override', () => {
    const h=harness(), n=note({bnv:undefined,bn:2});
    for(const inherited of [0,1.5])for(const [elapsed,expected] of [[0,0],[.175,1],[.35,2],[.5,2],[.85,1],[1,0]]) {
        close(h.elapsed(n,elapsed,inherited),expected);
    }
    close(h.approach(n),0);
});

test('Crazy scalar bend remains raised into its linked vibrato continuation across rounded millisecond timing', () => {
    const h=harness();
    const source={t:193.648,s:3,f:4,sus:.378,bn:2,ln:true};
    const destination={t:194.027,s:3,f:4,sus:1,bn:2,vb:true,
        bnv:[{t:0,v:2},{t:.5,v:2},{t:1,v:2}]};
    const before=JSON.stringify([source,destination]);
    // These decimal chart values exceed .001 by floating-point noise only.
    assert.ok(Math.abs(source.t+source.sus-destination.t)>.001);
    const linked=h.link([source,destination]);
    assert.equal(linked.targets.has(destination),true,'the continuation introduces no extra pick');
    close(linked.ends.get(source),2);
    close(linked.starts.get(destination),2);
    for(const p of [.7,.85,1])close(h.at(source,source.t+source.sus*p),2);
    close(h.at(destination,destination.t),2);
    close(h.offset(source,source.t+source.sus),h.offset(destination,destination.t),'joined ribbon height');
    close(h.gemOffset(source,source.t+source.sus*.85),h.offset(source,source.t+source.sus*.85));
    assert.equal(JSON.stringify([source,destination]),before,'the fix is render-only');
});

test('a linked scalar bend changes only its final release to meet an explicit continuation pitch', () => {
    for(const initial of [0,.5,1,2])for(const bt of [0,1,2,3]) {
        const h=harness(), source=note({t:0,ln:true,bnv:undefined});
        const destination=note({bt,bnv:[{t:bt===0?0:.2,v:initial},{t:.5,v:2},{t:1,v:0}]});
        h.link([source,destination]);
        for(const [elapsed,expected] of [[0,0],[.175,1],[.35,2],[.5,2],[.7,2]]) {
            close(h.at(source,elapsed),expected,'the existing rise and hold remain');
        }
        close(h.at(source,.85),(2+initial)/2,'the release interpolates to the resolved pitch');
        close(h.at(source,1),initial);
        close(h.at(destination,1),initial);
        close(h.approach(source),0,'this fix preserves ordinary scalar approach behavior');
        close(h.offset(source,1),h.offset(destination,1));
    }
});

test('explicit source curves remain authoritative even when a linked destination begins at another pitch', () => {
    const h=harness();
    for(const bnv of [[{t:0,v:0},{t:1,v:.5}],[{t:0,v:2},{t:1,v:0}]]) {
        const source=note({t:0,ln:true,bnv});
        const destination=note({bnv:[{t:0,v:2},{t:1,v:2}]});
        const linked=h.link([source,destination]);
        assert.equal(linked.ends.has(source),false);
        for(const sample of bnv)close(h.at(source,sample.t),sample.v);
        close(h.at(destination,1),2);
    }
});

test('unlinked notes and a real 90 ms chart gap retain the scalar release and separate next attack', () => {
    const h=harness();
    for(const change of [{ln:false},{sus:.91}]) {
        const source=note({t:0,ln:true,bnv:undefined,...change});
        const destination=note({bnv:[{t:0,v:2},{t:1,v:2}]});
        const linked=h.link([source,destination]);
        assert.equal(linked.ends.has(source),false);
        assert.equal(linked.targets.has(destination),false);
        close(h.at(source,source.t+source.sus),0);
        close(h.at(destination,1),2,'authored next note remains pre-bent');
    }
});

test('an endpoint is not guessed from a delayed ordinary bend, scalar destination or invalid initial sample', () => {
    const h=harness();
    const invalidDestinations=[
        {bnv:undefined},{bnv:[]},{bnv:[{t:.2,v:2}]},
        {bnv:[null]},{bnv:[{t:NaN,v:2}]},{bnv:[{t:Infinity,v:2}]},
        {bnv:[{t:-.1,v:2}]},{bnv:[{t:0,v:NaN}]},{bnv:[{t:0,v:Infinity}]},
        {bnv:[{t:0,v:'2'}]},{bnv:[{t:0,v:-1}]},{bnv:[{t:0,v:3}]},
        ...[0,-1,undefined,NaN,Infinity].map(sus=>({sus,bnv:[{t:0,v:2}]})),
    ];
    for(const change of invalidDestinations) {
        const source=note({t:0,ln:true,bnv:undefined});
        const destination=note(change);
        const linked=h.link([source,destination]);
        assert.equal(linked.ends.has(source),false,JSON.stringify(change));
        close(h.at(source,1),0,'unresolved scalar endpoint retains its release');
    }
});

test('only a finite positive scalar source can acquire a linked endpoint', () => {
    const h=harness();
    for(const change of [
        {bn:undefined},{bn:0},{bn:-1},{bn:NaN},{bn:Infinity},{bn:'2'},
        {bnv:[null]},{bnv:[{t:NaN,v:2}]},{bnv:[{t:0,v:NaN}]},
    ]) {
        const source=note({t:0,ln:true,bnv:undefined,...change});
        const destination=note({bnv:[{t:0,v:2},{t:1,v:2}]});
        const linked=h.link([source,destination]);
        assert.equal(linked.ends.has(source),false,JSON.stringify(change));
    }
    const source=note({t:0,ln:true,bnv:[]});
    const destination=note({bnv:[{t:0,v:2},{t:1,v:2}]});
    close(h.link([source,destination]).ends.get(source),2,'an empty curve uses the scalar fallback');
});

test('ambiguous coincident destinations never choose a scalar endpoint by chart array order', () => {
    for(const reverse of [false,true])for(const samePitch of [false,true]) {
        const h=harness(), source=note({t:0,ln:true,bnv:undefined});
        const a=note({bnv:[{t:0,v:.5}]}), b=note({bnv:[{t:0,v:samePitch?.5:1.5}]});
        const linked=h.link(reverse?[source,b,a]:[source,a,b]);
        assert.equal(linked.targets.has(a),true);
        assert.equal(linked.targets.has(b),true);
        assert.equal(linked.ends.has(source),false,'a unique destination is required');
        close(h.at(source,1),0);
    }
    const h=harness(), source=note({t:0,ln:true,bnv:undefined});
    const destination=note({bnv:[{t:0,v:2}]});
    const linked=h.link([source,destination],[{t:1,notes:[destination]}]);
    close(linked.ends.get(source),2,'the same target object appearing twice is not ambiguous');
});

test('linked scalar endpoint continuity works for chord members and survives pooled view normalization', () => {
    const h=harness();
    const source={s:2,f:7,sus:1,bn:2,ln:true};
    const destination={s:2,f:7,sus:1,bn:2,bnv:[{t:0,v:1.5},{t:1,v:1.5}]};
    const linked=h.link([],[{t:0,notes:[source]},{t:1,notes:[destination]}]);
    close(linked.ends.get(source),1.5);
    close(linked.starts.get(destination),1.5);
    close(h.linkedElapsed(source,1),h.linkedElapsed(destination,0));
    const scratch=h.chordView(source,0);
    close(h.at(scratch,1),1.5,'the chord scratch inherits its canonical endpoint');
    close(h.at(h.mutedView(scratch),1),1.5,'a normalized mute copy preserves that endpoint');
    h.chordView(note({t:2,bnv:undefined}),2,scratch);
    close(h.at(scratch,3),0,'scratch reuse clears the previous endpoint');
    h.link([],[{t:0,notes:[source]}]);
    close(h.linkedElapsed(source,1),0,'a new chart has no stale endpoint');
});

test('linked scalar ribbons meet their continuation in every supported string orientation', () => {
    for(const strings of [4,6,7,8])for(const inverted of [false,true])for(const lefty of [false,true]) {
        const h=harness(strings,inverted,lefty);
        for(let s=0;s<strings;s++) {
            const source=note({t:0,s,ln:true,bnv:undefined});
            const destination=note({s,bnv:[{t:0,v:1.5},{t:1,v:1.5}]});
            h.link([source,destination]);
            close(h.offset(source,1),h.offset(destination,1),'pitch continuity respects string direction');
            close(h.offset(source,1),h.direction(s)*3.2*1.5);
        }
    }
});

test('millisecond handoff tolerance is strict without changing the existing attack-suppression tolerance', () => {
    const h=harness(), eps=constant('BEND_LINK_TIME_EPS');
    const source=note({t:0,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]});
    for(const gap of [-eps*.9,0,eps*.9]) {
        const target=note({t:1+gap});
        const linked=h.link([source,target]);
        assert.equal(linked.targets.has(target),true);
        close(linked.starts.get(target),1.5);
        close(h.at(target,target.t),1.5);
    }
    for(const gap of [-eps*1.1,eps*1.1]) {
        const target=note({t:1+gap});
        const linked=h.link([source,target]);
        assert.equal(linked.targets.has(target),true);
        assert.equal(linked.links.get(target),null);
        close(h.at(target,target.t),0);
    }
});

test('malformed curve onsets and absent sustains produce finite zero displacement', () => {
    const h=harness();
    for(const bnv of [[],[null],[{t:NaN,v:2}],[{t:Infinity,v:2}],
        [{t:-.1,v:2}],[{t:0,v:NaN}],[{t:0,v:Infinity}],[{t:0,v:'2'}],[{t:0,v:-2}]]) {
        const n=note({bn:0,bnv});
        close(h.at(n,n.t),0);close(h.approach(n),0);
    }
    for(const sus of [0,-1,undefined,NaN]) {
        const n=note({sus,bt:2,bnv:[{t:0,v:2}]});
        close(h.at(n,n.t),0);close(h.approach(n),0);
    }
    const n=note();
    for(const bad of [NaN,Infinity,-Infinity])close(h.curve(n,bad,1),0);
    for(const bad of [NaN,Infinity,-1])close(h.start(n,bad),0);
});

test('a new chart replaces inherited pitch and does not retain a prior occurrence on the same string and fret', () => {
    const h=harness();
    const source=note({t:0,ln:true,bnv:[{t:0,v:2},{t:1,v:2}]}), target=note();
    h.link([source,target]);close(h.at(target,1),2);
    h.link([target]);close(h.at(target,1),0);
    const unrelated=note({t:0,s:3,ln:true,bnv:[{t:0,v:2},{t:1,v:2}]});
    h.link([unrelated,target]);close(h.at(target,1),0);
});

test('pooled chord views and normalized mute copies preserve inheritance without leaking it to later notes', () => {
    const h=harness();
    const source=note({t:0,ln:true,bnv:[{t:0,v:1.5},{t:1,v:1.5}]}), target=note();
    h.link([source,target]);
    const scratch=h.chordView(target,1);
    close(h.at(scratch,1),1.5,'chord scratch carries the canonical member start');
    const other=note({t:2});
    assert.equal(h.chordView(other,2,scratch),scratch);
    close(h.at(scratch,2),0,'reuse clears a previous chord member bend');
    const muted=h.mutedView(target);
    assert.notEqual(muted,target);
    assert.equal(muted.f,0);
    close(h.at(muted,1),1.5,'normalized muted slab keeps the source note start');
});

test('head and trail onset agree for normal and pre-bent curves on every supported string orientation', () => {
    for(const strings of [4,6,7,8])for(const inverted of [false,true])for(const lefty of [false,true]) {
        const h=harness(strings,inverted,lefty);
        for(let string=0;string<strings;string++)for(const initial of [0,.5,2]) {
            const n=note({s:string,bnv:[{t:0,v:initial},{t:.5,v:initial},{t:1,v:0}]});
            close(h.gemOffset(n,n.t-.1),h.offset(n,n.t),'approach meets ribbon');
            close(h.gemOffset(n,n.t),h.offset(n,n.t),'onset meets ribbon');
            close(h.gemOffset(n,n.t+1e-6),h.offset(n,n.t),'no onset pop');
            close(h.approach(n),h.direction(string)*3.2*initial);
        }
    }
});
