const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
    throw Error(name);
}
class Attribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
}
class Geometry {
    constructor() {
        this.userData = {};
        this.attributes = { position: new Attribute(new Float32Array(97 * 12), 3),
            color: new Attribute(new Float32Array(97 * 16).fill(1), 4) };
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    setIndex(v) { this.index = v; }
    setDrawRange(start, count) { this.drawRange = { start, count }; }
}
function helpers(lefty = false) {
    const visibility = source.slice(source.indexOf('    function hwyFootprintsOverlap1D('),
        source.indexOf('    /** Fixed pre-impact ramp window'));
    const motion = source.slice(source.indexOf('    function slideTrailEnd('),
        source.indexOf('    // Camera tgtDist building blocks'));
    return new Function('T', `const NFRETS=24, MAX_RENDER_STRINGS=8, SLIDE_RIBBON_SAMPLES=96;
        const _leftyCached=${lefty}, _invertedCached=false, NW=4, K=1;
        const fretX=f=>f*10, fretMid=fretX, xFretMid=fretX, dZ=t=>-230*t;
        const techniqueYOffsetWorld=()=>0, tremoloOffsetWorldX=()=>0;
        const _slideRibbonTimesScratch=[], _slideOutCrossingTimesScratch=[];
        const _trailYieldMatchContext={}, _trailOcclusionEventsScratch=[], _trailOcclusionFlagsScratch=[];
        const _trailCrossingTargetBases=[], _trailCrossingTargetWidths=[];
        const rsPlusNotation=false, RSPLUS_SUSTAIN_STROKE_SCALE=.5;
        const _trailSourceSweepBounds=new Float64Array(2), _linkedTrailPaths={byNote:new WeakMap()};
        const BEND_LINK_TIME_EPS=.001;
        const _trailYieldFrameId=1;
        let _trailCrossingTargetBaseCount=0;
        ${visibility}${motion}
        ${fn('sustainMotionWidth')}${fn('sustainTrailCenterXAt')}${fn('ensureSlideRibbonCapacity')}${fn('slideRibbonUpdatePair')}
        ${fn('noteHasVibrato')}${fn('noteHasVisibleMotionSustain')}${fn('noteHasRepeatTechniqueCue')}
        ${fn('chordMuteKind')}${fn('repeatChordMaySuppressGems')}
        ${fn('trailCrossingTargetStrands')}${fn('trailCrossingFootprintsOverlapAt')}
        ${fn('trailVisibilitySourceMemberAt')}${fn('trailVisibilitySourceNoteAt')}
        ${fn('trailVisibilitySourceCenterXAt')}${fn('trailVisibilitySourceWidthAt')}${fn('trailVisibilitySourceSweep')}
        ${fn('appendLinkedTrailContourTimes')}
        ${fn('hwyLinkNextTargetNotes')}${fn('hwyBuildLinkedTrailPaths')}${fn('hwyLinkedTrailMemberAt')}
        ${fn('collectTrailCrossingWindowsForStrand')}
        ${fn('hwyTrailTargetBehindOrder')}${fn('trailYieldApplyTargetTrailOrder')}
        ${fn('trailYieldSetTargetTrailBehind')}${fn('trailYieldPropagateTargetTrailOrder')}
        ${fn('trailYieldLinkTargetTrailBehind')}${fn('trailYieldCurrentTrailOrder')}${fn('trailYieldLinkTargetTrailInFront')}
        return { slideInMarks,slideInVisualStart,slideInCueAt,slideInOffsetWorldX,slideCueAlphaAt,slideCueWidthScaleAt,
            slideRibbonSampleTimes,slideRibbonUpdatePair,sustainTrailCenterXAt,slideTrailEnd,
            hwyBuildTrailYieldEvents,hwyBuildTrailOcclusionIndex,hwyFillTrailOcclusionTargets,
            hwyTrailVisibilityFrontMask,hwyTrailOcclusionTrailShouldStayBehind,hwyTrailOcclusionTrailShouldMoveInFront,
            repeatChordMaySuppressGems,TRAIL_OCCLUSION_TRAIL,TRAIL_OCCLUSION_TRAIL_FRONT,
            linked(notes) {
                const links=new Map();
                const attacks=hwyLinkNextTargetNotes(notes,[],1e-6,links);
                const model=hwyBuildLinkedTrailPaths(links,{visualStartForNote:slideInVisualStart});
                _linkedTrailPaths.byNote=model.byNote;
                return {...model,attacks};
            },
            orderDense(notes, useRealOnset=true) {
                const byFret=hwyBuildTrailYieldEvents(notes,[],6,{visualStartForNote:slideInVisualStart});
                const index=hwyBuildTrailOcclusionIndex(byFret,6);
                const all=byFret.filter(Boolean).flat().sort((a,b)=>a.s-b.s);
                for (const e of all) {e._trailOrderBaselineFrame=1;e._trailOrderBaselineOrder=100;}
                const targets=new Array(32),flags=new Uint8Array(32),starts=new Float64Array(32),ends=new Float64Array(32);
                for (const e of all) {
                    const count=hwyFillTrailOcclusionTargets(index,e.trailStart,e.end,e.s,10.1,13.1,false,
                        targets,flags,starts,ends,e.trailStart<e.t,useRealOnset?e.t:e.trailStart);
                    for(let i=0;i<count;i++) {
                        if(hwyTrailOcclusionTrailShouldStayBehind(3,flags[i])) trailYieldLinkTargetTrailBehind(e,targets[i],100);
                        else if(hwyTrailOcclusionTrailShouldMoveInFront(3,flags[i])) trailYieldLinkTargetTrailInFront(e,targets[i]);
                    }
                }
                return all.map(e=>({t:e.t,s:e.s,order:trailYieldCurrentTrailOrder(e)}));
            },
            crossing(source,target,start,end) {
                Object.assign(_trailYieldMatchContext,{note:source,slideSt:slideTrailEnd(source),strandBaseX:fretX(source.f),trailW:4,
                    path:_linkedTrailPaths.byNote.get(source)?.path||null,sourceSampleMember:null});
                _trailOcclusionEventsScratch[0]=target; _trailOcclusionFlagsScratch[0]=TRAIL_OCCLUSION_TRAIL;
                const starts=new Float64Array(32), ends=new Float64Array(32);
                const count=collectTrailCrossingWindowsForStrand(source,start,end,end,starts,ends,null,0,0,1);
                return {count,starts:Array.from(starts.slice(0,count)),ends:Array.from(ends.slice(0,count))};
            }
        };`)({ Float32BufferAttribute: Attribute });
}
function incoming(extra = {}) {
    return { t: 10, s: 0, f: 7, sus: 0, slide_in_marks: [{ direction: 'up', time: 0 }], ...extra };
}
function ribbon(h, n, start, end, yieldSettings) {
    const outline = new Geometry(), body = new Geometry();
    h.slideRibbonUpdatePair(outline, body, n.f * 10, 4.4, 1.4, 4, 1, 0,
        end - start, start, start, n, h.slideTrailEnd(n), yieldSettings ? [start] : [],
        yieldSettings ? [end] : [], yieldSettings ? 1 : 0, n.t + n.sus, yieldSettings);
    return { outline, body };
}
function ring(g, index) {
    const p = g.attributes.position.array;
    return { x: (p[index * 12] + p[index * 12 + 3]) / 2,
        width: p[index * 12 + 3] - p[index * 12], alpha: g.attributes.color.array[index * 16 + 3] };
}

test('incoming marks use strict source order and permit zero-sustain destinations', () => {
    const h = helpers();
    assert.deepEqual(h.slideInMarks(incoming()), [{ direction: 'up', time: 0 }]);
    assert.deepEqual(h.slideInMarks(incoming({sus: undefined})), []);
    const n = incoming({ sus: 1, slide_in_marks: [
        { direction: 'up', time: true }, { direction: 'left', time: 0 }, { direction: 'up', time: -1 },
        { direction: 'up', time: .25 }, { direction: 'down', time: .25 }, { direction: 'up', time: .1 },
        { direction: 'down', time: 1.0004 }, { direction: 'up', time: 1.001 },
    ] });
    assert.deepEqual(h.slideInMarks(n), [{ direction: 'up', time: .25 }, { direction: 'down', time: 1 }]);
    assert.equal(n.slide_in_marks[6].time, 1.0004, 'display clipping must not rewrite source precision');
});

test('real ribbon fades from unknown origin into one fixed destination without changing the note', () => {
    const h = helpers(), n = incoming();
    const before = JSON.stringify(n);
    Object.freeze(n.slide_in_marks[0]); Object.freeze(n.slide_in_marks); Object.freeze(n);
    const { outline, body } = ribbon(h, n, 9.78, 10);
    const first = ring(body, 0), last = ring(body, body.userData.ribbonSlices);
    assert.ok(Math.abs(first.x - 62) < 1e-5);
    assert.equal(first.alpha, 0);
    assert.ok(Math.abs(last.x - 70) < 1e-5);
    assert.equal(last.alpha, 1);
    assert.equal(ring(outline, outline.userData.ribbonSlices).alpha, 1);
    assert.equal(JSON.stringify(n), before);
    const events = h.hwyBuildTrailYieldEvents([n], [], 6, {visualStartForNote:h.slideInVisualStart})[7];
    assert.equal(events.length, 1, 'no additional attack or target event');
    assert.equal(events[0].t, 10); assert.equal(events[0].end, 10);
    assert.equal(events[0].trailStart, 9.78);
    assert.equal(events[0].f, 7);
});

test('both directions mirror once and song-start clipping never invents negative chart time', () => {
    const h = helpers(), lefty = helpers(true);
    const up = incoming(), down = incoming({ slide_in_marks: [{ direction: 'down', time: 0 }] });
    assert.ok(h.sustainTrailCenterXAt(up, 70, 9.8, null, 4) < 70);
    assert.ok(h.sustainTrailCenterXAt(down, 70, 9.8, null, 4) > 70);
    assert.equal(h.sustainTrailCenterXAt(up, 70, 9.8, null, 4), lefty.sustainTrailCenterXAt(down, 70, 9.8, null, 4));
    assert.equal(h.slideInVisualStart(incoming({ t: .05 })), 0);
    assert.equal(h.slideInVisualStart(incoming({ t: 0 })), 0);
    assert.equal(h.slideInCueAt(incoming({ t: 0 }), 0), 0);
    assert.equal(h.slideInVisualStart(incoming({ f: 0 })), 10);
});

test('internal tied destinations and outgoing marks retain ordinary intervals around them', () => {
    const h = helpers(), n = incoming({ sus: 1.5,
        slide_in_marks: [{ direction: 'up', time: .6 }],
        slide_out_marks: [{ direction: 'down', start: 1, end: 1.5 }] });
    assert.equal(h.slideInVisualStart(n), 10);
    assert.equal(h.slideCueAlphaAt(n, 10.2), 1);
    assert.equal(h.slideInOffsetWorldX(n, 10.2), 0);
    assert.ok(h.slideCueAlphaAt(n, 10.45) > 0 && h.slideCueAlphaAt(n, 10.45) < 1);
    assert.equal(h.slideCueAlphaAt(n, 10.8), 1);
    assert.equal(h.slideInOffsetWorldX(n, 10.8), 0);
    assert.equal(h.slideCueAlphaAt(n, 11.5), 0);
    const times = h.slideRibbonSampleTimes(n, 10.4, .2, []);
    assert.ok(times.every(t => t >= 10.4 && t <= 10.6));
    assert.ok(times.some(t => Math.abs(t - 10.6) < 1e-9));
    const linkedSlide = incoming({ sus: 1, sl: 9 });
    assert.ok(h.slideInOffsetWorldX(linkedSlide, 9.8) < 0, 'outgoing known slide does not suppress incoming cue');
    assert.equal(h.slideInOffsetWorldX(linkedSlide, 10.5), 0);
});

test('pre-onset targets are indexed by visible trail extent while gem onset stays unchanged', () => {
    const h = helpers();
    const target = incoming({ t: 10.2, s: 1, f: 8 });
    const byFret = h.hwyBuildTrailYieldEvents([target], [], 6, {visualStartForNote:h.slideInVisualStart});
    const index = h.hwyBuildTrailOcclusionIndex(byFret, 6);
    const events = new Array(8), flags = new Uint8Array(8), starts = new Float64Array(8), ends = new Float64Array(8);
    const count = h.hwyFillTrailOcclusionTargets(index, 9.9, 10.1, 0, 9.9, 10.1, false, events, flags, starts, ends, true);
    assert.equal(count, 1);
    assert.equal(events[0].t, 10.2, 'head is beyond the visible source interval');
    assert.ok(flags[0] & h.TRAIL_OCCLUSION_TRAIL);
    assert.equal(flags[0] & 1, 0, 'no phantom upcoming gem');
    assert.ok(Math.abs(starts[0] - 9.98) < 1e-9);
    assert.equal(ends[0], 10.1);
    for (const [narrowing, front, include] of [[false,false,false],[true,false,false],[true,true,false],[true,true,true]]) {
        const mask = h.hwyTrailVisibilityFrontMask(narrowing, front, include);
        assert.equal(h.hwyTrailOcclusionTrailShouldStayBehind(mask, flags[0]), !(narrowing && front && include));
    }
    assert.equal(h.hwyFillTrailOcclusionTargets(index, 9.9, 10.1, 0, 9.9, 10.1, true, events, flags, starts, ends, true), 0);
});

test('incoming contours participate in actual trail crossing sampling as source and target', () => {
    const h = helpers();
    const source = { t: 10, s: 0, f: 19, sus: 1 };
    const target = incoming({ t: 10.5, s: 1, f: 20 });
    const event = h.hwyBuildTrailYieldEvents([target], [], 6, {visualStartForNote:h.slideInVisualStart})[20][0];
    const hit = h.crossing(source, event, 10.2, 10.6);
    assert.ok(hit.count > 0, 'incoming target crosses an already visible source trail before target onset');
    assert.ok(hit.starts[0] >= 10.28 - 1e-8 && hit.ends.at(-1) <= 10.5);
    const entering = incoming({ t: 10.5, f: 20 });
    const lower = h.hwyBuildTrailYieldEvents([{ ...source, s: 1 }], [], 6, {visualStartForNote:h.slideInVisualStart})[19][0];
    assert.ok(h.crossing(entering, lower, 10.2, 10.5).count > 0, 'incoming source crosses an ordinary target trail');
});

test('ribbon pool resets alpha and visibility narrowing retains its chosen minimum', () => {
    const h = helpers(), n = incoming();
    const settings = { minScale:.3,leadTime:.5,taperDuration:.01,holdAfter:.05,recoverDuration:.05,endLeadTime:.5,endTaperDuration:.01 };
    const { outline, body } = ribbon(h, n, 9.78, 10, settings);
    assert.ok(Math.abs(ring(body, Math.floor(body.userData.ribbonSlices / 2)).width - 1.2) < 1e-5,
        'cue taper must not multiply visibility narrowing below its minimum');
    const ordinary = { t: 10, s: 0, f: 7, sus: 1 };
    h.slideRibbonUpdatePair(outline, body, 70, 4.4, 1.4, 4, 1, 0, 1, 10, 10, ordinary, null);
    for (let i = 0; i <= body.userData.ribbonSlices; i++) assert.equal(ring(body, i).alpha, 1);
});

test('repeated chords retain authored incoming cues and chord scratch clears omitted arrays', () => {
    const h = helpers();
    assert.equal(h.repeatChordMaySuppressGems(true, false, [incoming()]), false);
    const start = source.indexOf('Object.assign(_scrChordNote, cn);');
    const end = source.indexOf('drawNote(', start);
    const scratch = {};
    const copy = new Function('_scrChordNote','cn','ch','_linkedBendStarts','_linkedBendEnds','_linkedVibratoRuns',
        'const _linkedTrailPaths={byNote:new WeakMap()};'+source.slice(start,end));
    const maps = [new WeakMap(),new WeakMap(),new WeakMap()];
    copy(scratch,incoming(),{t:10},...maps);
    assert.equal(scratch.slide_in_marks.length,1);
    copy(scratch,{f:7,s:0},{t:11},...maps);
    assert.equal(scratch.slide_in_marks,undefined);
    assert.equal(scratch.ghost,false);
});

test('horizon visits preserve note identity and isolate chord render views without adding playable events', () => {
    const h = helpers();
    const drawCalls = [];
    const maps = [new WeakMap(), new WeakMap(), new WeakMap()];
    const visit = new Function('slideInVisualStart','drawNote','_linkedBendStarts','_linkedBendEnds','_linkedVibratoRuns',
        `const AHEAD=3, _linkedTrailPaths={byNote:new WeakMap()}; ${fn('drawSlideInHorizonNote')} return drawSlideInHorizonNote;`)(
        h.slideInVisualStart, (...args) => drawCalls.push(args), ...maps);
    const n = Object.freeze(incoming({t:13.1}));
    visit(n, n.t, 10);
    assert.equal(drawCalls.length, 1);
    assert.equal(drawCalls[0][0], n, 'standalone scoring identity stays the original note');
    assert.deepEqual(drawCalls[0].slice(1), [10, undefined, true, true], 'no new gem or label');
    visit(incoming({t:13.3}), 13.3, 10);
    visit({t:13.1,s:0,f:7,sus:1}, 13.1, 10);
    assert.equal(drawCalls.length, 1, 'only an entering incoming contour extends the visit window');
    const cn = Object.freeze({s:1,f:9,sus:0,slide_in_marks:Object.freeze([{direction:'down',time:0}]),ghost:true});
    const chords = Object.freeze([Object.freeze({t:13.1,notes:Object.freeze([cn])})]);
    const before = JSON.stringify(chords);
    const bendEnd={end:1}, vibrato={start:1};
    maps[0].set(cn,.5); maps[1].set(cn,bendEnd); maps[2].set(cn,vibrato);
    visit(cn,chords[0].t,10);
    const view=drawCalls[1][0];
    assert.notEqual(view,cn);
    assert.equal(view.t,13.1); assert.equal(view.f,9); assert.equal(view.sus,0); assert.equal(view.ghost,true);
    assert.equal(view.slide_in_marks,cn.slide_in_marks);
    assert.equal(maps[0].get(view),.5); assert.equal(maps[1].get(view),bendEnd); assert.equal(maps[2].get(view),vibrato);
    assert.equal(JSON.stringify(chords),before);
    assert.equal(chords.length,1); assert.equal(chords[0].notes.length,1);
    const indexed=h.hwyBuildTrailYieldEvents([],chords,6,{visualStartForNote:h.slideInVisualStart})[9];
    assert.equal(indexed.length,1); assert.equal(indexed[0].t,13.1); assert.equal(indexed[0].end,13.1);
});

test('short song-start lead-ins stay visible and known slides retain their ordinary post-onset path', () => {
    const h=helpers(), short=incoming({t:.004});
    const {body}=ribbon(h,short,0,.004);
    assert.equal(ring(body,0).alpha,0);
    assert.equal(ring(body,body.userData.ribbonSlices).alpha,1);
    const events=h.hwyBuildTrailYieldEvents([short],[],6,{visualStartForNote:h.slideInVisualStart});
    assert.equal(events[7][0].trailStart,0);
    const index=h.hwyBuildTrailOcclusionIndex(events,6);
    const targets=new Array(4),flags=new Uint8Array(4),starts=new Float64Array(4),ends=new Float64Array(4);
    assert.equal(h.hwyFillTrailOcclusionTargets(index,0,.004,1,0,.004,true,targets,flags,starts,ends,true),1);
    const known=incoming({sus:1,sl:10}), ordinary={t:10,s:0,f:7,sus:1,sl:10};
    for (const t of [10,10.1,10.5,11]) {
        assert.equal(h.sustainTrailCenterXAt(known,70,t,h.slideTrailEnd(known),4),
            h.sustainTrailCenterXAt(ordinary,70,t,h.slideTrailEnd(ordinary),4));
    }
});

test('dense mixed lead-ins use actual attack order and cannot create mode-3 propagation cycles', () => {
    const h=helpers();
    const notes=[
        incoming({t:10.35,s:2,f:7,sus:1.4}),
        {t:10.2,s:3,f:6,sus:1.4},
        {t:10.25,s:1,f:7,sus:.5},
        incoming({t:10.3,s:4,f:8,sus:.5,slide_in_marks:[{direction:'down',time:0}]}),
    ].sort((a,b)=>a.t-b.t);
    const before=JSON.stringify(notes);
    assert.throws(()=>h.orderDense(notes,false),RangeError,
        'using decorative lead-in starts as attack ranks reproduces the observed recursion');
    const result=h.orderDense(notes);
    assert.equal(JSON.stringify(notes),before);
    assert.ok(result.every(e=>Number.isFinite(e.order) && e.order>99));
    const byOnset=result.slice().sort((a,b)=>a.t-b.t);
    for(let i=1;i<byOnset.length;i++) assert.ok(byOnset[i].order>byOnset[i-1].order,
        'later real attacks retain front priority over earlier attacks');
    const noIncoming=notes.map(({slide_in_marks,...n})=>n);
    assert.deepEqual(h.orderDense(noIncoming).map(e=>[e.t,e.s]),result.map(e=>[e.t,e.s]));
    assert.match(fn('drawNote'),/hwyFillTrailOcclusionTargets\([\s\S]*?hasLeadIn,\s*n\.t,/,
        'the actual rendering call passes authored onset separately from visual extent');
});

test('closely spaced incoming destinations disconnect unknown origins without a sideways joining stroke', () => {
    const h=helpers(),n=incoming({sus:.3,slide_in_marks:[
        {direction:'up',time:0},{direction:'down',time:.1},{direction:'up',time:.2},
    ]});
    const {body}=ribbon(h,n,9.78,10.3);
    const times=h.slideRibbonSampleTimes(n,9.78,.52,[]);
    for (const boundary of [10,10.1]) {
        const ringAt=t=>ring(body,times.findIndex(value=>Math.abs(value-t)<1e-9));
        assert.ok(ringAt(boundary).alpha>.9999,'previous cue still reaches its authored destination');
        assert.equal(ringAt(boundary+1e-7).alpha,0,'return starts transparent at destination');
        assert.ok(ringAt(boundary+2e-7).alpha<1e-12,'next unknown origin also starts transparent');
        assert.ok(Math.abs(ringAt(boundary+1e-7).x-ringAt(boundary+2e-7).x)>7.9);
    }
    assert.equal(h.slideCueAlphaAt(n,10.25),1);
});

test('a linked path includes its first incoming approach without creating a continuation attack', () => {
    const h=helpers(), a=incoming({sus:1,ln:true}), b={t:11,s:0,f:7,sus:1};
    const model=h.linked([a,b]);
    assert.equal(model.byNote.get(a).path,model.byNote.get(b).path);
    assert.equal(model.byNote.get(a).path.visualStart,9.78);
    assert.equal(model.byNote.get(a).path.start,10);
    const events=h.hwyBuildTrailYieldEvents([a,b],[],6,{
        visualStartForNote:h.slideInVisualStart,suppressedAttacks:model.attacks,linkedPaths:model,
    });
    assert.equal(events[7][0].trailStart,9.78);
    assert.equal(events[7][1].gemVisible,false);
    assert.equal(events[7][1].trailVisible,true);
});

test('an incoming continuation with unknown origin splits only geometry, not authored attack suppression', () => {
    const h=helpers(), a={t:10,s:0,f:7,sus:1,ln:true}, b=incoming({t:11,sus:1});
    const model=h.linked([a,b]);
    assert.equal(model.paths.length,0);
    assert.equal(model.attacks.has(b),true);
    for(const marks of [[],[{direction:'wrong',time:0}],[{direction:'up',time:-1}]]) {
        assert.equal(h.linked([a,{...b,slide_in_marks:marks}]).paths.length,1);
    }
    assert.equal(h.linked([{...a,f:0},{...b,f:0}]).paths.length,1,
        'an open-string mark has no fretted approach and does not break a valid open path');
});

test('linked incoming source sweeps preserve pre-onset and internal crossings', () => {
    const h=helpers(), lower={t:9,s:1,f:19,sus:4};
    const event=h.hwyBuildTrailYieldEvents([lower],[],6)[19][0];
    const initial=incoming({f:20,sus:1,ln:true}), next={t:11,s:0,f:20,sus:1};
    h.linked([initial,next]);
    assert.ok(h.crossing(initial,event,9.78,9.9).count>0,
        'the first linked approach remains visible before the attack enters the viewport');
    const internal={t:10,s:0,f:20,sus:1,ln:true,slide_in_marks:[{direction:'up',time:.9}]};
    h.linked([internal,next]);
    const crossing=h.crossing(internal,event,10.5,11.5);
    assert.ok(crossing.count>0,'an internal approach cannot be rejected as a stationary whole path');
    assert.ok(crossing.starts[0]>=10.68-1e-6 && crossing.ends.at(-1)<=10.9+1e-6);
});
