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
        extract(drawSource, 'drawNote') + '; return drawNote;')(
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

test('anchorless bounds do not treat unpitched mute sentinels as fret 127', () => {
    assert.equal(maxNoteFretInWindow([{ t: 10, f: 127, mt: true }, { t: 11, f: 9 }],
        [{ t: 10, id: 0 }], [{ frets: [-1, 0, 127] }], 10, 4), 9);
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
