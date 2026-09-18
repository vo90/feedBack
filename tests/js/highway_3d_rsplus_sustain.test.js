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
const sizeStart = src.indexOf('let tw = NW * 0.85');
const sizeEnd = src.indexOf('// Standalone open strings get two parallel trails', sizeStart);
assert.ok(sizeStart >= 0 && sizeEnd > sizeStart);
const sizing = src.slice(sizeStart, sizeEnd);
const scaleDeclaration = src.match(/const RSPLUS_SUSTAIN_STROKE_SCALE = [^;]+;/)[0];
const sampleDeclaration = src.match(/const SLIDE_RIBBON_SAMPLES = [^;]+;/)[0];

function harness() {
    return new Function(`
        const K=1, NW=5, NH=3, S_GAP=6, nStr=6;
        const CHORD_FRAME_RIM_MIN=.055, CHORD_FRAME_RIM_FRAC_H=.028;
        const BEND_HALFSTEP_WORLD_Y=S_GAP*.8, BEND_ENV_RISE_FRAC=.35, BEND_ENV_RELEASE_FRAC=.3;
        const TREMOLO_BUMP_S=.06, VIBRATO_HALF_WAVE_S=.08;
        const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
        const _linkedVibratoRuns=new WeakMap();
        ${scaleDeclaration}
        ${sampleDeclaration}
        const TRAIL_YIELD_DEFAULTS={minScale:.3};
        let rsPlusNotation=false, _leftyCached=false, _invertedCached=false;
        const sY=s=>s*S_GAP, fretMid=f=>f*10, xFretMid=fretMid, dZ=t=>-t*10;
        const _drawAnchors=[], curX=0;
        const anchorLaneBoundsAt=()=>null, openNoteLaneBoxW=()=>80;
        const _trailCrossingTargetBases=new Float64Array(2), _trailYieldMatchContext={};
        let _trailCrossingTargetBaseCount=0;
        ${fn('slideTrailEnd')}
        ${fn('slideOffsetWorldX')}
        ${fn('bendVisualDirY')}
        ${fn('noteHasVibrato')}
        ${fn('bnvSampleAt')}
        ${fn('bendCurveStartSemis')}
        ${fn('bendCurveSemisAt')}
        ${fn('bendSemisAtElapsed')}
        ${fn('bendSemisAtTime')}
        ${fn('vibratoSemisAtTime')}
        ${fn('techniqueYOffsetWorld')}
        ${fn('sustainMotionWidth')}
        ${fn('tremoloOffsetWorldX')}
        ${fn('sustainTrailCenterXAt')}
        ${fn('trailCrossingTargetStrands')}
        ${fn('slideRibbonUpdatePair')}
        function dimensions(n, openWScale=1, susTrailMatchArpFrame=false) {
            const openSlabThickMul=1;
            ${sizing}
            return {tw,th,outlineW:tw+trailEdgePad,outlineH:th+trailEdgePad};
        }
        const geometry=()=>({attributes:{position:{array:new Float64Array((SLIDE_RIBBON_SAMPLES+1)*12)}}});
        const outline=geometry(), body=geometry();
        return {
            size(style,n,openWidth=1,arp=false) {
                rsPlusNotation=style;
                return dimensions(n,openWidth,arp);
            },
            crossing(style,n) {
                rsPlusNotation=style;
                const count=trailCrossingTargetStrands({...n,end:n.t+n.sus,standalone:true});
                return {count,width:_trailYieldMatchContext.crossingTargetW,bases:Array.from(_trailCrossingTargetBases)};
            },
            render(style,n,lefty=false,inverted=false) {
                rsPlusNotation=style; _leftyCached=lefty; _invertedCached=inverted;
                const size=dimensions(n);
                slideRibbonUpdatePair(outline,body,10,size.outlineW,size.outlineH,size.tw,size.th,
                    5,n.sus,n.t,n.t-.5,n,slideTrailEnd(n));
                return {body:Array.from(body.attributes.position.array),outline:Array.from(outline.attributes.position.array),
                    bodyBuffer:body.attributes.position.array,outlineBuffer:outline.attributes.position.array};
            },
            reach(style,width) { rsPlusNotation=style; return sustainMotionWidth(width)*.375; },
        };
    `)();
}
const center = (vertices, offset, axis) => (vertices[offset+axis]+vertices[offset+6+axis])/2;

test('RS+ sustain strokes and thin borders scale together for ordinary, open and arpeggio trails', () => {
    const h=harness();
    for (const f of [0,5]) for (const openWidth of [.22,1,2]) for (const arp of [false,true]) {
        const current=h.size(false,{f},openWidth,arp), rs=h.size(true,{f},openWidth,arp);
        for (const key of ['tw','th','outlineW','outlineH']) assert.equal(rs[key],current[key]*.5);
        assert.ok(rs.outlineW>rs.tw && rs.outlineH>rs.th);
    }
    assert.equal(h.size(false,{f:5}).tw,4.25,'Current retains its original .85-head-width stroke');
    assert.equal(h.size(true,{f:5}).tw,2.125);
});

test('narrow trail-to-trail footprints match both fretted strokes and standalone open rails', () => {
    const h=harness();
    for (const style of [false,true]) for (const f of [0,5]) {
        const n={t:1,s:2,f,sus:2};
        const bounds=h.crossing(style,n), size=h.size(style,n,f===0?1.92:1);
        assert.ok(Math.abs(bounds.width-size.outlineW)<1e-12);
        assert.equal(bounds.count,f===0?2:1);
        if (f===0) {
            assert.ok(Math.abs(bounds.bases[0]+28.8)<1e-12);
            assert.ok(Math.abs(bounds.bases[1]-28.8)<1e-12);
        }
    }
});

test('RS+ ribbons preserve all bend, slide, unpitched slide, vibrato and tremolo paths', () => {
    const h=harness();
    const base={t:1,s:3,f:5,sus:1.7};
    const variants=[{}, {bn:1.5}, {bnv:[{t:.12,v:1.5},{t:1,v:0}]},
        {sl:9}, {slu:9}, {sl:2}, {slu:2}, {tr:true}, {vb:true},
        {tr:true,bn:2}, {vb:true,bnv:[{t:0,v:.5},{t:1.4,v:2}]}, {tr:true,sl:9}];
    for (const variant of variants) for (const lefty of [false,true]) for (const inverted of [false,true]) {
        const n={...base,...variant}, saved=JSON.stringify(n);
        const current=h.render(false,n,lefty,inverted), rs=h.render(true,n,lefty,inverted);
        assert.equal(rs.body.length,current.body.length,'no extra ribbon samples');
        assert.equal(rs.bodyBuffer,current.bodyBuffer,'pooled body buffer is reused');
        assert.equal(rs.outlineBuffer,current.outlineBuffer,'pooled outline buffer is reused');
        for (const key of ['body','outline']) for (let i=0;i<rs[key].length;i+=12) {
            for (let axis=0;axis<3;axis++) assert.ok(Math.abs(center(rs[key],i,axis)-center(current[key],i,axis))<1e-10);
            const currentWidth=current[key][i+3]-current[key][i];
            const newWidth=rs[key][i+3]-rs[key][i];
            assert.ok(Math.abs(newWidth-currentWidth*.5)<1e-10);
        }
        assert.equal(JSON.stringify(n),saved,'restyling must not rewrite chart motion');
    }
});

test('tremolo sweep bounds retain the full zigzag reach after narrowing its stroke', () => {
    const h=harness(), n={t:1,s:1,f:5,sus:1.2,tr:true};
    const currentSize=h.size(false,n), rsSize=h.size(true,n);
    assert.equal(h.reach(false,currentSize.outlineW),h.reach(true,rsSize.outlineW));
    const ribbon=h.render(true,n);
    const reach=h.reach(true,rsSize.outlineW);
    let lo=Infinity,hi=-Infinity;
    for (let i=0;i<ribbon.outline.length;i+=12) {
        const x=center(ribbon.outline,i,0)-10;
        lo=Math.min(lo,x); hi=Math.max(hi,x);
        assert.ok(Math.abs(x)<=reach+1e-10);
    }
    assert.ok(lo<-.5 && hi>.5,'zigzag remains visibly wider than a straight center line');
    const before=h.render(false,n).body;
    h.render(true,n);
    assert.deepEqual(h.render(false,n).body,before,'Current survives style round trips');
});
