const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
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
const threeSource = read('plugins/highway_3d/screen.js');
const load = (src, name) => new Function(extract(src, name) + '; return ' + name)();
const bendToneLabel = load(geometry, 'bendToneLabel');
const noteFretLabel = load(geometry, 'noteFretLabel');
const slideOutLabel = load(geometry, 'slideOutLabel');
const maxNoteFretInWindow = load(geometry, 'maxNoteFretInWindow');
const sourceTechniqueLabel = load(threeSource, 'sourceTechniqueLabel');

test('bend labels use whole tones while curves and pitches remain semitones', () => {
    for (const [value, label] of [[0.5, '¼'], [1, '½'], [1.5, '¾'], [2, 'full'], [3, '1½'], [4, '2']]) {
        assert.equal(bendToneLabel(value), label);
    }
    assert.equal(bendToneLabel(0), '');
    assert.equal(bendToneLabel(NaN), '');
});

test('both renderers distinguish pitched ghosts, mutes and targetless gestures', () => {
    assert.equal(noteFretLabel({ f: 7, ghost: true }), '(7)');
    assert.equal(noteFretLabel({ f: 7, mt: true }), '7');
    assert.equal(slideOutLabel({ slide_out: 'up' }), 'slide ↑');
    assert.equal(slideOutLabel({ slu: 12 }), '');
    assert.equal(sourceTechniqueLabel({ f: 7, ghost: true, slide_out: 'down' }), '(7) · slide ↓');
    assert.equal(sourceTechniqueLabel({ f: 7, mt: true }), '');
});

test('real 2D drawNote emits ghost, slide direction and full bend labels', () => {
    const labels = [];
    const ctx = new Proxy({}, { get: (o, key) => o[key] || (() => {}), set: (o, k, v) => (o[k] = v, true) });
    const draw = new Function('noteFretLabel', 'slideOutLabel', 'bendToneLabel', 'bnvNormalizedPoints',
        'roundRect', '_paintGemGlow', 'fillTextReadable',
        extract(drawSource, 'drawNote') + '; return drawNote;')(
        noteFretLabel, slideOutLabel, bendToneLabel, load(geometry, 'bnvNormalizedPoints'),
        () => {}, () => {}, (_state, text) => labels.push(text));
    const state = { ctx, STRING_COLORS: ['#f00'], STRING_DIM: ['#500'], STRING_BRIGHT: ['#f88'] };
    draw(state, 1000, 900, 500, 500, 1, 0, 7, { ghost: true, slide_out: 'up', bn: 2 }, null);
    assert.ok(labels.includes('(7)'));
    assert.ok(labels.includes('slide ↑'));
    assert.ok(labels.includes('full'));
    labels.length = 0;
    draw(state, 1000, 900, 500, 500, 1, 0, 0, { ghost: true, slide_out: 'down' }, null);
    assert.ok(labels.includes('(0)'));
    assert.ok(labels.includes('slide ↓'));
});

test('no-anchor bounds include high notes, held notes, chord targets and template chords', () => {
    assert.equal(maxNoteFretInWindow([{ t: 0, f: 22, sus: 15 }, { t: 16, f: 24 }], [], [], 10, 4), 22);
    assert.equal(maxNoteFretInWindow([{ t: 10, f: 7, slide_out: 'up' }], [], [], 10, 4), 7);
    assert.equal(maxNoteFretInWindow([], [{ t: 12, notes: [{ f: 12, sl: 24 }] }], [], 10, 4), 24);
    assert.equal(maxNoteFretInWindow([], [{ t: 12, id: 0 }], [{ frets: [-1, 0, 17] }], 10, 4), 17);
    assert.equal(maxNoteFretInWindow([{ t: 0, f: 24 }], [], [], 10, 4), 0);
});

test('actual no-anchor viewport follows filtered notes and expands immediately', () => {
    const hwState = {
        _xfAnchors: null, _filteredAnchors: null, anchors: [],
        _xfNotes: null, _filteredNotes: [{ t: 10, f: 24 }], notes: [{ t: 10, f: 5 }],
        _xfChords: null, _filteredChords: null, chords: [], chordTemplates: [],
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
    hwState.anchors = [{ time: 10, fret: 3, width: 4 }];
    assert.equal(funcs.getMaxFretInWindow(10), 7);
});

test('3D chord scratch resets absent extensions; repeated gestures keep body path', () => {
    const start = threeSource.indexOf('Object.assign(_scrChordNote, cn);');
    const end = threeSource.indexOf('drawNote(', start);
    const copy = new Function('_scrChordNote', 'cn', 'ch', threeSource.slice(start, end));
    const scratch = {};
    copy(scratch, { f: 7, ghost: true, slide_out: 'up' }, { t: 1 });
    assert.equal(sourceTechniqueLabel(scratch), '(7) · slide ↑');
    copy(scratch, { f: 5 }, { t: 2 });
    assert.equal(sourceTechniqueLabel(scratch), '');
    assert.match(threeSource, /isRepeat && !chordLinksSlide && !cn\.ghost && !cn\.slide_out/);
    const hasTech = load(drawSource, '_noteHasTechniqueFlags');
    assert.equal(hasTech({ ghost: true }), true);
    assert.equal(hasTech({ slide_out: 'down' }), true);
});
