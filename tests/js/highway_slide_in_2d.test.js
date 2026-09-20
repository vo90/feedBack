const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../static/js/highway-draw.js'), 'utf8');

function fn(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(name);
}

const helpers = new Function(`
    const VISIBLE_SECONDS = 3;
    const project = dt => dt < -.05000001 || dt > VISIBLE_SECONDS ? null : { y: dt, scale: 1 };
    const fretX = (state, f) => f * 10;
    ${['slideInMarks2D', 'slideOutMarks2D', 'drawSlideInRibbon2D', 'drawSlideOutRibbon2D',
        'drawSustains', '_noteHasTechniqueFlags', '_chordHasTechniqueFlags'].map(fn).join('\n')}
    return {slideInMarks2D, drawSlideInRibbon2D, drawSustains, _chordHasTechniqueFlags};
`)();

function state(now = 9.5) {
    const strokes = [];
    let points = [], group = -1;
    const ctx = {
        globalAlpha: 1, lineWidth: 1,
        save() { group++; }, restore() {},
        beginPath() { points = []; },
        moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); },
        stroke() { strokes.push({ points: [...points], alpha: this.globalAlpha, width: this.lineWidth, group }); },
        fill() {},
    };
    return { ctx, strokes, currentTime: now, STRING_COLORS: ['red'], STRING_DIM: ['darkred'],
        _xfNotes: null, _filteredNotes: null, notes: [], _xfChords: null, _filteredChords: null, chords: [] };
}

const note = { t: 10, s: 0, f: 7, sus: 0, slide_in_marks: [{direction: 'up', time: 0}] };
function draw(n = note, now = 9.5, onset = n.t) {
    const hw = state(now);
    helpers.drawSlideInRibbon2D(hw, 600, 1, n, onset);
    return hw.strokes;
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ~= ${expected}`); }

test('strict endpoint validation retains zero, rejects individual malformed/order entries and clips rounding', () => {
    const marks = [null, {}, {direction:'up',time:true}, {direction:'up',time:'0'},
        {direction:'UP',time:0}, {direction:'up',time:NaN}, {direction:'up',time:Infinity},
        {direction:'up',time:-.01}, {direction:'up',time:0}, {direction:'down',time:0},
        {direction:'down',time:.5}, {direction:'up',time:.25}, {direction:'up',time:1.0004},
        {direction:'down',time:1.0003}, {direction:'down',time:1.000501}, {direction:'up',time:1.000502}];
    assert.deepEqual(helpers.slideInMarks2D({sus:1, slide_in_marks:marks}), [
        {direction:'up',time:0}, {direction:'down',time:.5},
        {direction:'up',time:1}, {direction:'down',time:1}]);
    for (const value of [undefined, null, {}, 'up', 1])
        assert.deepEqual(helpers.slideInMarks2D({sus:1,slide_in:'up',slide_in_marks:value}), []);
    for (const sus of [-1, NaN, Infinity, '1'])
        assert.deepEqual(helpers.slideInMarks2D({...note,sus}), []);
    assert.deepEqual(helpers.slideInMarks2D(note), note.slide_in_marks);
});

test('up approaches its known fret from below; down approaches from above; fade and width reach the gem', () => {
    const up = draw(), down = draw({...note,slide_in_marks:[{direction:'down',time:0}]});
    assert.equal(up.length, 16);
    near(up[0].points[0][0], 62);
    near(down[0].points[0][0], 78);
    for (let i = 0; i < up.length; i++) {
        near(up[i].points[1][0] + down[i].points[1][0], 140);
        if (i) {
            assert.ok(up[i].alpha > up[i - 1].alpha);
            assert.ok(up[i].width > up[i - 1].width);
        }
    }
    near(up.at(-1).points[1][0], 70);
    near(up.at(-1).points[1][1], .5);
    near(up.at(-1).alpha, 1);
    near(up.at(-1).width, 6);
});

test('zero-sustain cue renders through the ordinary sustain pass without changing timing or targets', () => {
    const n = Object.freeze({...note,slide_in_marks:Object.freeze([Object.freeze({...note.slide_in_marks[0]})])});
    const before = JSON.stringify(n), hw = state();
    hw.notes = [n];
    helpers.drawSustains(hw, 600, 1);
    assert.equal(hw.strokes.length, 16);
    assert.equal(JSON.stringify(n), before);
    assert.equal(n.sl, undefined);
    assert.equal(n.slu, undefined);
});

test('later tied endpoints stay inside owning sustain, after the prior endpoint, without extra attacks', () => {
    const n = {...note,sus:2,ln:true,slide_in_marks:[
        {direction:'up',time:.05}, {direction:'down',time:.12}, {direction:'up',time:1.5}]};
    const before = JSON.stringify(n), strokes = draw(n);
    assert.equal(strokes.length, 48);
    near(strokes[0].points[0][1], .5); // note onset, not endpoint minus 220ms
    near(strokes[15].points[1][1], .55);
    near(strokes[16].points[0][1], .55); // previous endpoint
    near(strokes[31].points[1][1], .62);
    near(strokes[32].points[0][1], 1.78); // later cue uses its full 220ms
    near(strokes[47].points[1][1], 2);
    assert.equal(JSON.stringify(n), before);
});

test('song start never acquires a negative-time approach', () => {
    assert.equal(draw({...note,t:0}, -.1).length, 0);
    const early = draw({...note,t:.1}, -.1);
    near(early[0].points[0][1], .1); // absolute song time zero
    near(early.at(-1).points[1][1], .2);
    assert.equal(early.at(-1).alpha, 1);
});

test('viewport clipping preserves gesture phase and retains arrival inside normal project tolerance', () => {
    const nearArrival = draw(note, 9.98);
    assert.equal(nearArrival.length, 16);
    assert.ok(nearArrival[0].alpha > .5); // clipping cannot restart fade
    assert.ok(nearArrival[0].width > 5);
    assert.ok(nearArrival[0].points[0][0] > 67);
    assert.ok(nearArrival.every(s => s.points.every(p => p[1] >= -.05000001 && p[1] <= 3)));
    assert.ok(draw(note, 10).length > 0); // touches gem at arrival despite zero sustain
    assert.equal(draw(note, 10.06).length, 0);
    const farEdge = draw(note, 6.85);
    assert.ok(farEdge.length > 0);
    near(farEdge.at(-1).points[1][1], 3);
    assert.ok(farEdge.at(-1).alpha < .5); // horizon clipping cannot finish fade early
    assert.equal(draw(note, 6).length, 0);
});

test('incoming cue coexists with pitched, unpitched and targetless outgoing slides', () => {
    const baseline = draw();
    for (const outgoing of [{sl:12}, {slu:12}, {slide_out:'down'},
        {slide_out_marks:[{direction:'down',start:0,end:1}]}]) {
        assert.deepEqual(draw({...note,...outgoing}), baseline);
    }
});

test('chord member inherits chord onset; sibling without marks has no incoming cue', () => {
    const hw = state(19.5);
    hw.chords = [{t:20,notes:[{...note,t:undefined},{s:1,f:9,sus:0}]}];
    helpers.drawSustains(hw, 600, 1);
    assert.equal(hw.strokes.length, 16);
    near(hw.strokes.at(-1).points[1][1], .5);
});

test('transformed and difficulty-filtered views do not leak hidden note or chord cues', () => {
    for (const kind of ['filtered','xf']) {
        const hw = state();
        hw.notes = [note]; hw.chords = [{t:10,notes:[note]}];
        hw[`_${kind}Notes`] = []; hw[`_${kind}Chords`] = [];
        if (kind === 'xf') { hw._filteredNotes = [note]; hw._filteredChords = [{t:10,notes:[note]}]; }
        helpers.drawSustains(hw,600,1);
        assert.equal(hw.strokes.length,0);
    }
});

test('repeat-chord simplification preserves valid slide-in technique cues only', () => {
    assert.equal(helpers._chordHasTechniqueFlags({notes:[note]}), true);
    assert.equal(helpers._chordHasTechniqueFlags({notes:[{...note,slide_in_marks:[]}]}), false);
    assert.equal(helpers._chordHasTechniqueFlags({notes:[{...note,slide_in_marks:[{direction:'up',time:true}]}]}), false);
    assert.equal(helpers._chordHasTechniqueFlags({notes:[{f:7,sus:0,ln:true}]}), false);
});

test('open fret keeps metadata without drawing an invented fretted approach', () => {
    const open = {...note,f:0};
    assert.equal(draw(open).length,0);
    assert.deepEqual(helpers.slideInMarks2D(open),note.slide_in_marks);
});
