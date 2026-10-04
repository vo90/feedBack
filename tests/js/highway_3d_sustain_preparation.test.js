'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`), open = source.indexOf('{', start);
    assert.ok(start >= 0);
    let depth = 1, end = open + 1;
    while (depth) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    return source.slice(start, end);
}
const { prepare, at } = new Function(`
    const NFRETS = 24;
    ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'isRenderableNote'].map(extract).join('\n')}
    ${['hwyPrepareCameraStops','hwyCameraPlanAt'].map(extract).join('\n')}
    return {prepare:hwyPrepareCameraStops,at:hwyCameraPlanAt};
`)();
const note = (t, f = 2, extra = {}) => ({t, f, s: 0, sus: .25, ...extra});
const chord = (t = 1, sus = 3, extra = {}) => ({t,
    notes: [5,7,7].map((f,s) => ({f,s,sus,...extra}))});
const stops = [{time:0,x:5,minX:3,maxX:7}, {time:4,x:12,minX:10,maxX:14}];
const plan = (notes = [note(4,12)], chords = [chord()], rate = 1, rows = stops) =>
    prepare(rows, notes, chords, rate);

test('positionless tremolo and whammy keep technique focus after lane preparation', () => {
    for (const extra of [{tr:true}, {tr:true,mt:true}, {whammy:{version:1}}]) {
        const held = note(1,0,{sus:3,...extra});
        assert.equal(plan([held,note(4,12)],[])[1].lead,.6);
        const c = chord(); c.notes = c.notes.map(n=>({...n,f:0,...extra}));
        assert.equal(plan([note(4,12)],[c])[1].lead,.6);
    }
    assert.equal(plan([note(3.3,0,{mt:true}),note(4,12)],[])[1].lead,.6);
});

test('plain held chord prepares the next position 1.2 seconds early', () => {
    const original = JSON.stringify(stops), p = plan();
    assert.equal(p[1].lead, 1.2);
    assert.equal(at(p, 2.8, 1, .5).x, 5);
    assert.ok(at(p, 3.1, 1, .5).x > 5);
    assert.equal(at(stops, 3.1, 1, .5).x, 5);
    assert.equal(at(p, 4.5, 1, .5).x, 12);
    assert.equal(JSON.stringify(stops), original);
});

test('shorter holds leave 300ms after the strike before extra preparation', () => {
    const p = plan([note(4)], [chord(3,1)]);
    assert.ok(Math.abs(p[1].lead - .7) < 1e-10);
    assert.equal(at(p, 3.3, 1, .5).x, 5);
    assert.equal(plan([note(4)], [chord(3.4,.6)])[1].lead, .6);
});

test('intervening attacks and release-only lane changes retain normal lead', () => {
    assert.equal(plan([note(3.2),note(4)])[1].lead,.6);
    assert.equal(plan([note(3.2,127,{mt:true}),note(4)])[1].lead,.6);
    assert.equal(plan([note(5)])[1].lead,.6); // a release-only lane change
});

for (const extra of [{bn:1}, {bnv:[{t:0,v:1}]}, {vb:1}, {vibrato_marks:[{start:1,end:2,intensity:'slight'}]}, {tr:1}, {sl:12},
    {slu:0}, {whammy:[{t:1,v:1}]}, {harmonic_changes:[{t:1}]},
    {ho:true}, {po:true}, {ln:true}, {mt:true}]) {
    test('active chord technique keeps normal focus: '+JSON.stringify(extra), () => {
        assert.equal(plan([note(4)], [chord(1,3,extra)])[1].lead,.6);
    });
}

test('normal wire defaults and static palm mute/accent do not disable a hold', () => {
    assert.equal(plan([note(4)], [chord(1,3,{sl:-1,slu:-1,bn:0,bnv:[],pm:true,accent:true})])[1].lead,1.2);
});

test('an overlapping technique on another string prevents early movement', () => {
    const notes = [note(.5,3,{s:5,sus:3.5,bn:2}),note(4)];
    assert.equal(plan(notes)[1].lead,.6);
    notes[0].sus = 2.5;
    assert.equal(plan(notes)[1].lead,1);
});

test('partial chord releases and all-open chords remain quiet preparation', () => {
    const c = chord(); c.notes[0].sus = .25;
    assert.equal(plan([note(4)],[c])[1].lead,1.2);
    c.notes = c.notes.map(n => ({...n,f:0,sus:3}));
    assert.equal(plan([note(4)],[c])[1].lead,1.2);
});

test('replacing an old technique on its string ends that focus constraint', () => {
    assert.equal(plan([note(.5,3,{s:1,sus:10,bn:2}),note(4)])[1].lead,1.2);
});

test('real-time lead and movement agree at half, normal and double speed', () => {
    for (const rate of [.5,1,2]) {
        const rows = stops.map(s => ({...s,time:s.time*rate}));
        const c = chord(rate,3*rate), p = plan([note(4*rate)],[c],rate,rows);
        assert.equal(p[1].lead,1.2);
        for (const t of [2.7,2.8,3,3.5,4,4.5]) {
            assert.ok(Math.abs(at(p,t*rate,rate,.5).x-at(plan(),t,1,.5).x)<1e-9);
        }
    }
});

test('mixed normal/early overlapping transitions are continuous and mirrored', () => {
    const rows = [...stops, {time:4.25,x:3,minX:1,maxX:5}];
    const p = plan([note(4),note(4.25)], [chord()],1,rows);
    const mirrored = p.map(s => ({...s,x:-s.x,minX:-s.maxX,maxX:-s.minX}));
    for (let t = 2; t <= 6; t += .01) {
        const a = at(p,t,1,.5), b = at(p,t+1e-7,1,.5);
        assert.ok(Math.abs(a.velocity-b.velocity)<.0001);
        assert.ok(Math.abs(a.x+at(mirrored,t,1,.5).x)<1e-9);
        assert.deepEqual(at(p,t,1,.5),a); // direct seek evaluates the same curve
    }
    assert.equal(at(p,20,1,.5).x,3);
});

test('malformed strings and unrelated future notes do not invent intervening activity', () => {
    assert.equal(plan([note(3.9,12,{s:99}),note(4)])[1].lead,1.2);
    assert.deepEqual(plan([note(4),note(100,24)]),plan());
});

test('single sustained notes and directional slide-outs get the same early plan as chords', () => {
    for (const extra of [{}, {slide_out:'down'}, {slideOut:'up'},
        {slide_out:'down',slide_out_marks:[{start:2.5,end:3,direction:'down'}]}]) {
        const notes=[note(1,19,{s:5,sus:3,...extra}),note(4)];
        const before=JSON.stringify(notes);
        const p=plan(notes,[]);
        assert.equal(p[1].lead,1.2);
        assert.ok(at(p,3.1,1,.5).x>5);
        assert.equal(JSON.stringify(notes),before);
        assert.equal(plan([note(4)],[chord(1,3,extra)])[1].lead,1.2);
    }
});

test('silence after notes or techniques and initial silence can prepare the first open attack', () => {
    for (const notes of [[note(1,5,{sus:.25}),note(4,0)],
        [note(1,5,{sus:.25,bn:1}),note(4,0)], [note(4,0)]]) {
        assert.equal(plan(notes,[])[1].lead,1.2);
    }
    assert.equal(plan([note(4)],[chord(1,1)])[1].lead,1.2);
    assert.equal(plan([note(4)],[{...chord(),h3dSynth:true}])[1].lead,1.2);
    assert.equal(plan([note(3.2,5,{sus:0}),note(4)],[])[1].lead,.6);
});

test('overlapping single trails use the latest attack and protect techniques on every string', () => {
    const notes=[note(1,5,{s:0,sus:4}),note(2,7,{s:1,sus:2,slide_out:'down'}),note(4)];
    assert.equal(plan(notes,[])[1].lead,1.2);
    notes.splice(2,0,note(3,8,{s:2,sus:1}));
    assert.ok(Math.abs(plan(notes,[])[1].lead-.7)<1e-10);
    notes[0].bn=1;
    assert.equal(plan(notes,[])[1].lead,.6);
    notes[0].sus=2;
    assert.ok(Math.abs(plan(notes,[])[1].lead-.7)<1e-10);
});

test('a slide-out combined with a bend or a target-fret slide retains technique protection', () => {
    for (const extra of [{bn:1},{sl:12},{slu:12},{vibrato_marks:[{start:0,end:3,intensity:'slight'}]}]) {
        assert.equal(plan([note(1,19,{sus:3,slide_out:'down',...extra}),note(4)],[])[1].lead,.6);
    }
});

test('single trails and silence keep real-time lead at half and double speed', () => {
    for (const rate of [.5,1,2]) for (const sus of [.1,3]) {
        const rows=stops.map(s=>({...s,time:s.time*rate}));
        const notes=[note(rate,5,{sus:sus*rate}),note(4*rate)];
        const p=plan(notes,[],rate,rows);
        assert.equal(p[1].lead,1.2);
        assert.ok(Math.abs(at(p,3.1*rate,rate,.5).x-at(plan(),3.1,1,.5).x)<1e-9);
    }
});
