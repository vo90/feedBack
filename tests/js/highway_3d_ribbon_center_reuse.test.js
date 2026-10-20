const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { solve, rendererState, rendererLookup } = require('./highway-bend-layout-fixture.js');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error('Unclosed function ' + name);
}

// Keep the reference's original two evaluations, using the same production
// geometry writer and motion functions to isolate this sample-local reuse.
const ribbon = fn('slideRibbonUpdatePair');
const reusedCenter = /let bodyX = outlineX;\s*if \(n\.tr\) \{\s*sustainTrailCenterXAt\(n, strandBaseX, Tk, slideSt, bodyTw, _sustainCenterResult\);\s*bodyX = _sustainCenterResult\[0\];\s*\}/;
assert.match(ribbon, reusedCenter);
const referenceRibbon = ribbon.replace(reusedCenter, `sustainTrailCenterXAt(
                    n, strandBaseX, Tk, slideSt, bodyTw, _sustainCenterResult,
                );
                const bodyX = _sustainCenterResult[0];`);

class Attribute {
    constructor(array, itemSize) { this.array = array; this.count = array.length / itemSize; }
}
class Geometry {
    constructor() {
        this.userData = {};
        this.attributes = { position: new Attribute(new Float32Array(0), 3) };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    setIndex(value) { this.index = value; }
    setDrawRange(start, count) { this.drawRange = { start, count }; }
}

async function harness(original = false) {
    const [scrapeGeometry, { whammyApi }, { harmonicContactsApi }] = await Promise.all([
        import('../../static/js/pick-scrapes.js'),
        import('../../static/js/whammy.js'),
        import('../../static/js/harmonic-contacts.js'),
    ]);
    const helpers = [
        'hwySmoothstep01', 'hwyTrailYieldAmountAt', 'hwyAppendTrailYieldContourTimes',
        'hwySameStringTaperDuration', 'hwySameStringTrailYieldAmountAt', 'hwyAppendSameStringContourTimes',
        'naturalNode', 'notePositionX', 'bendVisualDirY', 'noteHasVibrato', 'bnvSampleAt',
        'bendCurveStartSemis', 'bendCurveSemisAt', 'bendSemisAtElapsed', 'bendSemisAtTime',
        'vibratoSemisAtTime', 'techniqueYOffsetWorld', 'sustainMotionWidth',
        'tremoloVisualIntervals', 'tremoloOffsetWorldX', 'ensureSlideRibbonCapacity',
    ].map(fn).join('\n');
    return new Function('T', 'scrapeGeometry', 'window', 'solveBendLayout', `
        const K=1, NW=5, S_GAP=6, nStr=6, NFRETS=24;
        const BEND_HALFSTEP_WORLD_Y=S_GAP*.8, FINGER_BEND_WORLD_Y=S_GAP, BEND_ENV_RISE_FRAC=.35, BEND_ENV_RELEASE_FRAC=.3;
        const TREMOLO_BUMP_S=.06, VIBRATO_HALF_WAVE_S=.08;
        const _linkedBendStarts=new WeakMap(), _linkedBendEnds=new WeakMap();
        const _linkedVibratoRuns=new WeakMap(), tremoloIntervalCache=new WeakMap();
        const _slideRibbonTimesScratch=[], _linkedTrailPaths={byNote:new WeakMap()};
        ${rendererState}
        ${source.match(/const RSPLUS_SUSTAIN_STROKE_SCALE = [^;]+;/)[0]}
        ${source.match(/const SLIDE_RIBBON_SAMPLES = [^;]+;/)[0]}
        ${source.match(/const TRAIL_YIELD_DEFAULTS = Object\.freeze\(\{[\s\S]*?\}\);/)[0]}
        let rsPlusNotation=false, _leftyCached=false, _invertedCached=false, logarithmic=false;
        const fretX=f=>f<=0?0:logarithmic?180*(1-Math.pow(2,-f/12)):f*6;
        const fretMid=f=>f<=0?-2*K:(fretX(f-1)+fretX(f))/2, dZ=t=>-230*t;
        // Both writers share the fixed scrape anchor; browser coverage checks
        // its production chart-lane lookup independently of this reuse test.
        const pickScrapeAnchorX=()=>_leftyCached?-37:37;
        ${source.slice(source.indexOf('    function slideTrailEnd('), source.indexOf('    // Camera tgtDist building blocks'))}
        ${helpers}
        ${rendererLookup}
        let centerCalls=0;
        ${fn('sustainTrailCenterXAt').replace('{', '{ centerCalls++;')}
        ${original ? referenceRibbon : ribbon}
        const outline=new T.Geometry(), body=new T.Geometry();
        return (n, options={}) => {
            _bendLayout=solveBendLayout([n],[],nStr);
            rsPlusNotation=!!options.rs; _leftyCached=!!options.lefty;
            _invertedCached=!!options.inverted; logarithmic=!!options.logarithmic;
            const scale=rsPlusNotation?RSPLUS_SUSTAIN_STROKE_SCALE:1;
            const start=options.start ?? n.t, duration=options.duration ?? n.sus;
            const startX=(_leftyCached?-1:1)*notePositionX(n);
            centerCalls=0;
            slideRibbonUpdatePair(outline,body,startX,4.4*scale,1.4*scale,4*scale,scale,
                5,duration,start,options.now ?? n.t-.5,n,slideTrailEnd(n),
                options.yield?[n.t+.9,n.t+n.sus]:null,
                options.yield?[n.t+1.05,n.t+n.sus]:null,options.yield?2:0,
                n.t+n.sus,TRAIL_YIELD_DEFAULTS,options.sameString?n.t+1.3:NaN,n.t);
            const snapshot=g=>({
                positions:g.attributes.position.array.slice(0,(g.userData.ribbonSlices+1)*12),
                colors:g.attributes.color.array.slice(0,(g.userData.ribbonSlices+1)*16),
                slices:g.userData.ribbonSlices,drawRange:g.drawRange,index:g.index,
                positionNeedsUpdate:g.attributes.position.needsUpdate,
                colorNeedsUpdate:g.attributes.color.needsUpdate,
            });
            return {outline:snapshot(outline),body:snapshot(body),centerCalls};
        };
    `)({ Float32BufferAttribute: Attribute, Geometry }, scrapeGeometry,
        { feedBackWhammy: whammyApi, feedBackHarmonicContacts: harmonicContactsApi }, solve);
}

function checkPair(reference, optimized, n, options) {
    const before = JSON.stringify(n);
    const expected = reference(n, options), actual = optimized(n, options);
    assert.deepEqual(actual.outline, expected.outline, 'exact outline geometry and upload state');
    assert.deepEqual(actual.body, expected.body, 'exact body geometry and upload state');
    assert.ok(actual.body.positions.every(Number.isFinite), 'finite rendered coordinates');
    const samples = actual.body.slices + 1;
    assert.equal(expected.centerCalls, samples * 2);
    assert.equal(actual.centerCalls, samples * (n.tr ? 2 : 1));
    assert.equal(JSON.stringify(n), before, 'the chart must remain unchanged');
    return actual;
}

test('sample-local center reuse preserves exact Float32 geometry for all motion combinations', async () => {
    const reference = await harness(true), optimized = await harness();
    const variants = [
        {sl:12,slide_interval:{start:1.3,end:1.8},harmonic_changes:{version:1,events:[
            {start:.8,end:1.8,source_id:'contact-slide',
                target:{kind:'artificial',policy:'harmonic',node:5,interval:24}}]}},
        {}, {tr:false}, {sl:12}, {slu:2}, {sl:12,slide_interval:{start:1.3,end:1.8}},
        {bn:1.5}, {bnv:[{t:0,v:.5},{t:.7,v:2},{t:1.7,v:0}]}, {vb:true},
        {slide_in_marks:[{direction:'up',time:0},{direction:'down',time:.7}]},
        {slide_out_marks:[{direction:'down',start:1.2,end:1.8}]},
        {slide_in_marks:[{direction:'up',time:.6}],slide_out_marks:[{direction:'up',start:1.2,end:1.8}],vb:true},
        {mt:true,pick_scrape_marks:[{direction:'up',start:0,end:.9},{direction:'down',start:.9,end:1.8}]},
        {whammy:{version:1,policy:'optional',segments:[{start:0,end:1.8,curve:[{t:0,v:0},{t:1.8,v:-4}]}]}},
        {harmonic_changes:{version:1,events:[{start:.8,end:1.8,source_id:'contact',
            target:{kind:'artificial',policy:'harmonic',node:12,interval:12}}]}},
        {tr:true}, {tr:true,sl:12,bn:1.5,vb:true},
        {tr:1,slide_out_marks:[{direction:'up',start:1.2,end:1.8}],tremolo_marks:[
            {start:.2,end:.8,mode:'specified',period:.125,phase:0},
            {start:.8,end:1.6,mode:'specified',period:.25,phase:0}]},
    ];
    for (const variant of variants) for (const f of [0,7]) for (let flags=0;flags<16;flags++) {
        const n={t:10,s:3,f,sus:1.8,...variant};
        checkPair(reference,optimized,n,{rs:flags&1,lefty:flags&2,inverted:flags&4,
            logarithmic:flags&8,yield:true,sameString:true});
    }
});

test('reuse observes edits and flag changes on the same note across frames and rewinds', async () => {
    const reference=await harness(true), optimized=await harness();
    const n={t:10,s:1,f:7,sus:1.8,sl:12};
    for (const tr of [false,true,0,1,undefined]) {
        n.tr=tr;
        for (const now of [9.5,10.75,11.4,10.2]) {
            n.sl=n.sl===12?2:12;
            checkPair(reference,optimized,n,{now,start:Math.max(n.t,now),duration:n.t+n.sus-Math.max(n.t,now)});
        }
    }
    delete n.sl;
    n.slide_in_marks=[{direction:'up',time:.5}];
    checkPair(reference,optimized,n,{});
    n.slide_in_marks[0].time=1.1;
    n.slide_in_marks[0].direction='down';
    checkPair(reference,optimized,n,{lefty:true});
});
