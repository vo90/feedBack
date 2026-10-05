const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
function extract(src, name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw Error(name);
}
const geometry = read('static/js/highway-geometry.js');
const drawSource = read('static/js/highway-draw.js');
const highwaySource = read('static/highway.js');
const load = (src, name) => new Function(extract(src, name) + '; return ' + name)();
const bendToneLabel = load(geometry, 'bendToneLabel');
const maxNoteFretInWindow = load(geometry, 'maxNoteFretInWindow');

test('bend labels use whole tones while curve and pitch values remain semitones', () => {
    for (const [value, label] of [[0.5, '¼'], [1, '½'], [1.5, '¾'], [2, 'full'], [3, '1½'], [4, '2'], [2.5, '1.25']]) {
        assert.equal(bendToneLabel(value), label);
    }
    for (const value of [0, -1, NaN, Infinity, undefined]) assert.equal(bendToneLabel(value), '');
});

test('actual 2D drawNote labels a two-semitone bend as full and one as half', () => {
    const labels = [];
    const ctx = new Proxy({}, { get: (o, key) => o[key] || (() => {}), set: (o, k, v) => (o[k] = v, true) });
    const draw = new Function('bendToneLabel', 'noteFretLabel', 'bnvNormalizedPoints', 'roundRect', '_paintGemGlow', 'fillTextReadable',
        extract(drawSource, 'harmonicContactLabel') + extract(drawSource, 'drawNote') + '; return drawNote;')(
        bendToneLabel, load(geometry, 'noteFretLabel'), load(geometry, 'bnvNormalizedPoints'), () => {}, () => {}, (_state, text) => labels.push(text));
    const state = { ctx, STRING_COLORS: ['#f00'], STRING_DIM: ['#500'], STRING_BRIGHT: ['#f88'] };
    draw(state, 1000, 900, 500, 500, 1, 0, 7, { bn: 2 }, null);
    assert.ok(labels.includes('full'));
    labels.length = 0;
    draw(state, 1000, 900, 500, 500, 1, 0, 7, { bn: 1 }, null);
    assert.ok(labels.includes('½'));
    assert.ok(!labels.includes('full'));
});

test('anchorless bounds include visible and held notes, chord targets and template chords', () => {
    assert.equal(maxNoteFretInWindow([{ t: 0, f: 22, sus: 15 }, { t: 16, f: 24 }], [], [], 10, 4), 22);
    assert.equal(maxNoteFretInWindow([{ t: 10, f: 7, slide_out: 'up' }], [], [], 10, 4), 7);
    assert.equal(maxNoteFretInWindow([], [{ t: 12, notes: [{ f: 12, sl: 24 }] }], [], 10, 4), 24);
    assert.equal(maxNoteFretInWindow([], [{ t: 0, notes: [{ f: 12, sus: 15, slu: 20 }] }], [], 10, 4), 20);
    assert.equal(maxNoteFretInWindow([], [{ t: 12, id: 0 }], [{ frets: [-1, 0, 17] }], 10, 4), 17);
    assert.equal(maxNoteFretInWindow([{ t: 0, f: 24 }], [], [], 10, 4), 0);
});

test('2D contact instructions survive reduced resolution without becoming full-size text', () => {
    const labels = [];
    const ctx = new Proxy({}, { get: (o, key) => o[key] || (() => {}), set: (o, k, v) => (o[k] = v, true) });
    const draw = new Function('bendToneLabel', 'noteFretLabel', 'bnvNormalizedPoints', 'roundRect', '_paintGemGlow', 'fillTextReadable',
        extract(drawSource, 'harmonicContactLabel') + extract(drawSource, 'drawNote') + '; return drawNote;')(
        bendToneLabel, load(geometry, 'noteFretLabel'), load(geometry, 'bnvNormalizedPoints'), () => {}, () => {},
        (_state, text, x, y) => labels.push({ text, font: ctx.font, x, y }));
    const state = { ctx, canvas: { clientHeight: 900 }, STRING_COLORS: ['#f00'], STRING_DIM: ['#500'], STRING_BRIGHT: ['#f88'] };
    for (const ratio of [1, .5, .25]) {
        for (const [fret, chord, kind, expected] of [[7, false, 'artificial', 'AH 19'], [0, false, 'tapped', 'TH 12'], [17, true, 'artificial', 'AH 31.7']]) {
            labels.length = 0;
            draw(state, 1000 * ratio, 900 * ratio, 500 * ratio, 500 * ratio, .45, 0, fret,
                { chord, pm: true, harmonic_target: { kind, node: fret === 17 ? 14.7 : 12 } }, null);
            const cue = labels.find(l => l.text === expected);
            assert.ok(cue, `${expected} at ${ratio}`);
            const pixels = Number(/([\d.]+)px/.exec(cue.font)[1]);
            assert.ok(pixels / ratio >= 9 && pixels / ratio < 15, 'secondary text stays compact');
            const pm = labels.find(l => l.text === 'PM');
            if (pm) assert.ok(cue.y > pm.y + Number(/([\d.]+)px/.exec(pm.font)[1]));
        }
        labels.length = 0;
        draw(state, 1000 * ratio, 900 * ratio, 500 * ratio, 500 * ratio, .1, 0, 7,
            { harmonic_target: { kind: 'artificial', node: 12 } }, null);
        assert.ok(!labels.some(l => l.text === 'AH 19'), 'genuinely distant instructions remain culled');
    }
});

test('anchorless bounds do not treat unpitched mute sentinels as fret 127', () => {
    assert.equal(maxNoteFretInWindow([{ t: 10, f: 127, mt: true }, { t: 11, f: 9 }],
        [{ t: 10, id: 0 }], [{ frets: [-1, 0, 127] }], 10, 4), 9);
});

test('2D note rendering sends one compound contact cue to the crisp layer without duplicate canvas captions', () => {
    const labels=[],gems=[];
    const ctx=new Proxy({}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
    const draw=new Function('bendToneLabel','noteFretLabel','bnvNormalizedPoints','roundRect','_paintGemGlow','fillTextReadable',
        extract(drawSource,'harmonicContactLabel')+extract(drawSource,'drawNote')+'; return drawNote;')(
        bendToneLabel,load(geometry,'noteFretLabel'),load(geometry,'bnvNormalizedPoints'),()=>{},()=>{},(_s,text)=>labels.push(String(text)));
    const state={ctx,canvas:{clientHeight:900},STRING_COLORS:['#f00'],STRING_DIM:['#500'],STRING_BRIGHT:['#f88'],
        _harmonicContactOverlay:{addGem:g=>gems.push(g)}};
    for(const [fret,kind,text] of [[17,'artificial','AH 31.7'],[0,'tapped','TH 12']]) {
        labels.length=0;gems.length=0;
        const target=Object.freeze({kind,node:fret?14.7:12});
        const opts=Object.freeze({pm:true,harmonic_target:target});
        draw(state,250,225,125,125,.45,0,fret,opts,null);
        assert.ok(labels.includes(String(fret)));
        assert.ok(!labels.includes(text)&&!labels.includes('PM'));
        assert.equal(gems.length,1);assert.equal(gems[0].label,text);assert.equal(gems[0].pm,true);
        assert.equal(opts.harmonic_target,target);
    }
});

test('actual anchorless viewport follows active transforms and expands immediately', () => {
    const hwState = {
        _xfAnchors: null, _filteredAnchors: null, anchors: [],
        _xfNotes: null, _filteredNotes: [{ t: 10, f: 24 }], notes: [{ t: 10, f: 5 }],
        _xfChords: null, _filteredChords: null, chords: [], chordTemplates: [], _xfChordTemplates: null,
        currentTime: 10, displayMaxFret: 12,
    };
    const funcs = new Function('hwState', 'maxNoteFretInWindow', 'VISIBLE_SECONDS',
        extract(highwaySource, 'getMaxFretInWindow') + extract(highwaySource, 'updateSmoothAnchor')
        + '; return {getMaxFretInWindow, updateSmoothAnchor};')(hwState, maxNoteFretInWindow, 4);
    assert.equal(funcs.getMaxFretInWindow(10), 24);
    funcs.updateSmoothAnchor({ fret: 1, width: 4 }, 1 / 60);
    assert.equal(hwState.displayMaxFret, 27);
    hwState._xfNotes = [{ t: 10, f: 19 }];
    assert.equal(funcs.getMaxFretInWindow(10), 19);
    hwState._xfChords = [{ t: 10, id: 0 }];
    hwState.chordTemplates = [{ frets: [5] }];
    hwState._xfChordTemplates = [{ frets: [22] }];
    assert.equal(funcs.getMaxFretInWindow(10), 22);
    hwState.anchors = [{ time: 10, fret: 3, width: 4 }];
    assert.equal(funcs.getMaxFretInWindow(10), 7);
});
