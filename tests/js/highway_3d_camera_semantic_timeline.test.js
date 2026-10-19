const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`), open = source.indexOf('{', start);
    assert.ok(start >= 0, name);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}
const api = new Function(`
    const NFRETS = 24;
    ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote',
        'hwyCameraRiffVariationCandidates', 'hwyBuildCameraTimeline', 'hwyBuildCameraStops'].map(extract).join('\n')}
    return { timeline: hwyBuildCameraTimeline, stops: hwyBuildCameraStops };
`)();
const row = (time, fret, width = 4, extra = {}) => ({time, firstFret:fret, lastFret:fret+width-1,
    minX:(fret-1)*10, maxX:(fret+width-1)*10, preferred:(fret+1)*10, x:(fret+1)*10, ...extra});
const build = (rows, context = null, rate = 1, threshold = 500) =>
    api.stops(rows, rate, () => false, null, null, null, context, threshold);
const positions = stops => stops.map(s => [s.time,s.firstFret,s.lasting]);
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

test('Absolution continuous 1.227-second lane survives its chord metadata split', () => {
    const rows = freeze([row(0,2),row(15.359,7),row(15.851,7,4,{h3dResolvedChordLane:true}),
        row(16.586,5),row(17.070999,1)]);
    const before = JSON.stringify(rows), stops = build(rows);
    const seven = stops.find(s => s.firstFret === 7);
    assert.equal(seven.time,15.359);
    assert.ok(Math.abs(seven.duration-1.227)<1e-9);
    assert.equal(seven.lasting,true);
    assert.deepEqual([seven.regionStart,seven.regionEnd],[1,3]);
    assert.equal(JSON.stringify(rows),before);
});

test('500ms classification uses source time and compensates subtraction roundoff only', () => {
    for (const rate of [.5,1,2,4]) {
        assert.equal(build([row(0,2),row(2,7),row(2.499,2)],null,rate).length,1);
        for (const duration of [.5,.501]) {
            const stops=build([row(0,2),row(2,7),row(2+duration,2)],null,rate);
            assert.deepEqual(stops.map(s=>s.firstFret),[2,7,2]);
            assert.equal(stops[1].lasting,true);
        }
    }
    assert.equal(build([row(0,2),row(15.1,7),row(15.6,2)])[1].lasting,true);
});

test('a whole multi-position departure cannot be hidden as individually short rows', () => {
    const short=build([row(0,2),row(2,7),row(2.2,9),row(2.4,2)]);
    assert.equal(short.length,1);
    assert.deepEqual(short.timeline.slice(1,3).map(s=>s.kind),['ignored-excursion','ignored-excursion']);
    const long=build([row(0,2),row(2,7),row(2.3,9),row(2.6,2)]);
    assert.deepEqual(long.map(s=>s.firstFret),[2,7,9,2]);
    assert.equal(long.at(-1).lasting,true);
});

test('same-base riff extensions hold their original focus and preserve source geometry', () => {
    const rows=freeze([row(0,5),row(1,5,5,{x:75}),row(2,5,6,{x:85}),row(3,5)]);
    const stops=build(rows);
    assert.equal(stops.length,1);
    assert.equal(stops[0].x,60);
    assert.equal(stops.timeline[0].regionEnd,4);
    assert.deepEqual(rows.map(r=>r.lastFret),[8,9,10,8]);
});

test('Rats short off-route overshoot bypasses its stop while ordered steps remain transit', () => {
    const spike=build([row(0,9),row(2,13),row(2.251,8)]);
    assert.deepEqual(positions(spike),[[0,9,true],[2.251,8,true]]);
    assert.equal(spike.timeline[1].kind,'ignored-overshoot');
    assert.equal(spike.timeline[1].homeX,100);
    const path=build([row(0,9),row(2,10),row(2.2,11),row(2.4,12)]);
    assert.deepEqual(path.map(s=>s.firstFret),[9,10,11,12]);
    assert.deepEqual(path.map(s=>s.lasting),[true,false,false,true]);
    const tooLong=build([row(0,9),row(2,13),row(2.3,14),row(2.6,8)]);
    assert.deepEqual(tooLong.map(s=>s.firstFret),[9,13,14,8]);
});

test('fit callbacks and distance never veto a semantic destination or remote ignored excursion', () => {
    const rows=[row(0,1),row(2,24),row(2.3,1)];
    const fail=()=>{throw new Error('semantic classification must not request a projection fit');};
    assert.equal(api.stops(rows,1,fail,fail,fail).length,1);
    assert.deepEqual(api.stops([row(0,1),row(2,2)],1,fail,fail,fail).map(s=>s.firstFret),[1,2]);
});

function variationFixture() {
    const notes=[];
    for (const start of [0,4,8]) notes.push({t:start+.2,s:0,f:5,sus:0},
        {t:start+1,s:1,f:start===4?13:7,sus:1.2},{t:start+3,s:0,f:5,sus:0});
    return {rows:[row(0,5),row(5,13),row(6.2,5)],
        context:{notes,chords:[],beats:[0,4,8,12].map((time,measure)=>({time,measure})),
            sections:[{time:0,name:'riff'}]}};
}

test('positive neighbouring home-pattern variation can retain a longer isolated high note', () => {
    const fixture=variationFixture();
    const stops=build(fixture.rows,fixture.context);
    assert.equal(stops.length,1);
    assert.equal(stops.timeline[1].kind,'riff-variation');
    assert.equal(stops.timeline[1].cameraX,60);
    assert.equal(stops.timeline[1].x,140);
});

test('uncertain patterns, rhythm, technique and section boundaries never create a motif exception', () => {
    for (const change of [
        c=>{c.beats=[];},
        c=>{c.notes[7].f=6;},
        c=>{c.notes[4].t+=.1;},
        c=>{c.notes[4].sus=.8;},
        c=>{c.notes[4].sl=15;},
        c=>{c.sections.push({time:4,name:'new phrase'});},
        c=>{c.notes.push({t:5.6,s:2,f:13,sus:0});},
    ]) {
        const {rows,context}=variationFixture(); change(context);
        assert.deepEqual(build(rows,context).map(s=>s.firstFret),[5,13,5]);
    }
});

test('whole-chord relocations are never a longer isolated-note variation', () => {
    const {rows,context}=variationFixture();
    context.notes=context.notes.filter(n=>n.t!==5);
    context.chords=[{t:5,notes:[{s:1,f:13,sus:1.2},{s:2,f:15,sus:1.2}]}];
    assert.deepEqual(build(rows,context).map(s=>s.firstFret),[5,13,5]);
});

test('all motion and attack techniques participate in conservative motif evidence', () => {
    for (const [key,value] of [
        ['hn',12],['hps',19],['harmonic_alias',{fret:7}],['bt',1],
        ['slide_out','up'],['slideOut','down'],['slide_out_marks',[{time:.8,direction:'up'}]],
        ['slide_interval',{start:.2,end:1}],['tremolo_marks',[{start:0,end:1.2}]],
        ['tp',true],['ac',true],['slp',true],['plk',true],['ghost',true],['lr',true],['let_ring_sus',2],
    ]) {
        const {rows,context}=variationFixture();context.notes[4][key]=value;
        assert.equal(build(rows,context).timeline[1].kind,'lasting',key);
    }
});

test('returning home after ignored replies does not cancel subsequent progressive travel', () => {
    const stops=build([row(0,5),row(2,9),row(2.2,5),row(2.4,6),row(2.6,7),row(2.8,8)]);
    assert.deepEqual(stops.map(s=>s.firstFret),[5,6,7,8]);
    assert.equal(stops.timeline[1].kind,'ignored-excursion');
    assert.deepEqual(stops.slice(1).map(s=>s.lasting),[false,false,true]);
});

test('short alternation retains the incoming home until a lasting new position begins', () => {
    const stops=build([row(0,5),row(2,9),row(2.3,5),row(2.6,9),row(2.9,5),row(3.2,9)]);
    assert.deepEqual(positions(stops),[[0,5,true],[3.2,9,true]]);
    assert.deepEqual(stops.timeline.filter(s=>s.kind==='ignored-excursion').map(s=>s.time),[2,2.6]);
});

test('a complete local return does not require a lasting individual home dwell', () => {
    const stops=build([row(0,15),row(2,5),row(2.2,12),row(2.5,5),row(2.7,7)],null,1,1000);
    assert.deepEqual(stops.map(s=>s.firstFret),[15,5,7]);
    assert.equal(stops.timeline[2].kind,'ignored-excursion');
    assert.equal(stops.timeline[2].homeX,60);
    assert.equal(stops[1].lasting,false);
    for (const duration of [1,1.001]) {
        const exact=build([row(0,15),row(2,5),row(2.2,12),row(2.2+duration,5)],null,1,1000);
        assert.equal(exact.find(s=>s.firstFret===12).lasting,true);
    }
});

test('incoming local home owns nested returns without suppressing onward progression', () => {
    const stops=build([row(0,5),row(.1,8),row(.2,10),row(.3,8),row(.4,5),
        row(.6,6),row(.8,7),row(1,6),row(1.2,8),row(1.4,9)],null,1,1000);
    assert.deepEqual(stops.map(s=>s.firstFret),[5,6,8,9]);
    assert.deepEqual(stops.timeline.slice(1,4).map(s=>s.homeX),[60,60,60]);
    assert.equal(stops.timeline[6].homeX,70);
    assert.equal(stops.at(-1).firstFret,9);
});

function shortHomeFixture() {
    const rows=[[0,15],[1.4,8],[1.55,7],[1.7,5],[2.16,4],[2.93,5],[3.24,7],[3.4,8],
        [3.87,5],[4.17,8],[4.47,7],[4.77,4],[5.07,5],[5.97,12],
        [6.27,5],[6.57,8],[6.87,7],[7.17,4],[7.47,5],[8.67,2]].map(([time,fret])=>row(time,fret));
    return {rows,context:{sections:[{time:3.87,name:'riff'},{time:6.27,name:'riff'}]}};
}

test('proven section entry resolves overlapping homes and merges their effective hold', () => {
    for (const threshold of [1000,1500,2000,2500,3000]) {
        const {rows,context}=shortHomeFixture();
        context.sections.push({time:3.87,name:'duplicate'});
        const stops=build(freeze(rows),freeze(context),1,threshold);
        const inside=stops.timeline.filter(s=>s.time>=3.87&&s.time<8.67);
        assert.ok(inside.every(s=>s.firstFret===5||s.kind==='ignored-excursion'),threshold);
        assert.ok(inside.filter(s=>s.firstFret!==5).every(s=>s.homeX===60),threshold);
        const home=stops.find(s=>s.firstFret===5&&s.time<=3.87&&s.end>7.47);
        assert.ok(home,threshold);
        assert.equal(home.lasting,true,threshold);
        assert.ok(home.duration>=8.67-3.87-1e-9,threshold);
        assert.equal(home.reason,'lasting');
    }
});

test('raising the threshold keeps proven brief replies suppressed as home dwells cease lasting', () => {
    for (const threshold of [500,600,800,900,901,950,1000,1100,2000,3000]) {
        const {rows,context}=shortHomeFixture(),stops=build(rows,context,1,threshold);
        const reply=stops.timeline.find(s=>s.firstFret===12);
        assert.equal(reply.kind,'ignored-excursion',threshold);
        assert.equal(reply.homeX,60,threshold);
        if (threshold===500) {
            assert.ok(stops.some(s=>s.time<=4.17&&s.end>=4.47&&s.firstFret===8));
            assert.ok(stops.some(s=>s.time===4.47&&s.firstFret===7));
            assert.ok(stops.some(s=>s.time===4.77&&s.firstFret===4));
        }
    }
});

test('section markers alone cannot reset a valid home or create excursion evidence', () => {
    const rows=[row(0,5),row(2,12),row(2.3,5),row(4,12),row(4.3,5),row(6,7)];
    for (const sections of [[],[{time:2,name:'riff'}],[{time:1,name:'riff'}],
        [{time:2.3,name:'riff'},{time:4.3,name:'riff'}]]) {
        const stops=build(rows,{sections},1,1000);
        assert.deepEqual(stops.map(s=>s.firstFret),[5,7]);
        assert.ok(stops.timeline.filter(s=>s.firstFret===12).every(s=>s.homeX===60));
    }
    const progress=build([row(0,1),row(.2,3),row(.4,2),row(.6,4),row(.8,6)],
        {sections:[{time:.2,name:'riff'}]},1,3000);
    assert.deepEqual(progress.map(s=>s.firstFret),[1,3,2,4,6]);
});

test('dense short return cycles have one effective home and preserve raw row durations', () => {
    const rows=Array.from({length:20000},(_,i)=>row(i*.1,i%2?12:5));
    rows.push(row(2000,5),row(2002,9));
    const stops=build(rows,null,1,3000);
    assert.deepEqual(stops.map(s=>s.firstFret),[5,9]);
    assert.equal(stops[0].lasting,true);
    assert.equal(stops[0].duration,2002);
    assert.equal(stops.timeline[0].duration,.1);
    assert.equal(stops.timeline[1].kind,'ignored-excursion');
});

test('a repeated high passage is insufficient evidence for an established lower home variation', () => {
    const {rows,context}=variationFixture();
    context.notes[1].f=context.notes[7].f=13;
    assert.deepEqual(build(rows,context).map(s=>s.firstFret),[5,13,5]);
});

test('a dense metadata timeline coalesces once without per-row motif searches', () => {
    const rows=Array.from({length:10000},(_,i)=>row(i/10000,5,4,{h3dResolvedChordLane:!!(i%2)}));
    rows.push(row(1,9),row(2,5));
    const stops=build(rows);
    assert.equal(stops.timeline.length,3);
    assert.equal(stops[0].regionEnd,10000);
    assert.deepEqual(stops.map(s=>s.firstFret),[5,9,5]);
});

test('a dense 50,000-note context with complete measure evidence retains uncertain relocations', () => {
    const notes=Array.from({length:50000},(_,i)=>({t:i*.1,s:i%6,f:5+i%4,sus:0}));
    const beats=Array.from({length:1252},(_,i)=>({time:i*4,measure:i}));
    const rows=[row(0,5),row(2500,13),row(2501.2,5)];
    const stops=build(rows,{notes,chords:[],beats,sections:[{time:0}]});
    assert.deepEqual(stops.map(s=>s.firstFret),[5,13,5]);
    assert.equal(stops.timeline[1].kind,'lasting');
});
