// Imported fret-127 mute sentinels must preserve the strike without pulling
// the highway to a nonexistent fret. Exercise the renderer's actual helpers.
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

const helpers = ['isPlayableFret', 'isUnpitchedMute', 'isRenderableNote',
    'usesUnfrettedPosition', 'filterValidNotes', 'mergeChordShape',
    'chordNotesFromTemplate', 'getChartAnchorAt', 'laneBoundsFromAnchor',
    'hwyFirstRelevantFrettedTime', 'lookaheadComputeFretBounds'];
const frameStart = src.indexOf('let chordFrameXL = null');
const frameEnd = src.indexOf('const laneWForOpenStrings', frameStart);
const run = new Function(`
    const NFRETS = 24, NW = 1;
    const validString = s => Number.isInteger(s) && s >= 0 && s < 6;
    const _filterValidNotesCache = new WeakMap(), _chordShapeCache = new WeakMap();
    const lowerBoundT = (events, t) => { const i = events.findIndex(e => e.t >= t); return i < 0 ? events.length : i; };
    const lookaheadEndTime = now => now + 3;
    const xFret = f => f, openNoteLaneBoxW = () => 4;
    ${helpers.map(fn).join('\n')}
    return {
        ${helpers.join(',')},
        frame(ch, templates, anchors) {
            const chShape = mergeChordShape(ch, filterValidNotes(ch.notes), templates);
            const chAncB = laneBoundsFromAnchor(getChartAnchorAt(anchors, ch.t));
            const chordCX = chAncB ? (chAncB.dMin + chAncB.dMax) / 2 : 3;
            ${src.slice(frameStart, frameEnd)}
            return { shape: [...chShape], left: chordFrameXL, right: chordFrameXR };
        },
    };
`)();

test('only exact muted 127 has an unpitched rendering interpretation', () => {
    for (const f of [0, 1, 12, 24]) assert.equal(run.isPlayableFret(f), true);
    for (const f of [-1, 25, 127, 255, 1.5, NaN, Infinity, '3', null]) {
        assert.equal(run.isPlayableFret(f), false);
    }
    assert.equal(run.isRenderableNote({ f: 127, mt: true }), true);
    assert.equal(run.usesUnfrettedPosition({ f: 127, mt: true }), true);
    for (const n of [{ f: 127 }, { f: 127, pm: true }, { f: 127, fhm: true }, { f: 25, mt: true }]) {
        assert.equal(run.isRenderableNote(n), false);
    }
});

test('filter retains source objects and valid arrays without rewriting frets or flags', () => {
    const muted = Object.freeze({ s: 3, f: 127, mt: true, fhm: true, sus: 0 });
    const valid = Object.freeze({ s: 4, f: 5, sus: 1 });
    const notes = Object.freeze([muted, valid]);
    assert.equal(run.filterValidNotes(notes), notes);
    const mixed = Object.freeze([...notes, { s: 5, f: 127 }, { s: 9, f: 5 }]);
    const filtered = run.filterValidNotes(mixed);
    assert.deepEqual(filtered, notes);
    assert.equal(filtered[0], muted);
    assert.equal(run.filterValidNotes(mixed), filtered);
    assert.equal(muted.f, 127);
});

test('Clapton-like muted template keeps three strikes in the authored anchor', () => {
    const notes = [3, 4, 5].map(s => Object.freeze({ s, f: 127, mt: true, fhm: true }));
    const ch = Object.freeze({ t: 10.105, id: 0, notes: Object.freeze(notes) });
    const templates = [{ frets: [-1, -1, -1, 127, 127, 127] }];
    assert.deepEqual(run.frame(ch, templates, [{ time: 0, fret: 3, width: 4 }]), {
        shape: [[3, 0], [4, 0], [5, 0]], left: 2, right: 6,
    });
    assert.deepEqual(notes.map(n => n.f), [127, 127, 127]);
    assert.deepEqual(templates[0].frets, [-1, -1, -1, 127, 127, 127]);
});

test('unsupported template frets cannot create synthetic playable notes', () => {
    const templates = [{ frets: [-1, 0, 24, 25, 127, 3.5] }];
    assert.deepEqual(run.chordNotesFromTemplate(0, templates), [
        { s: 1, f: 0, sus: 0 }, { s: 2, f: 24, sus: 0 },
    ]);
    const ch = { t: 1, id: 0, notes: [{ s: 1, f: 0 }, { s: 2, f: 127 }] };
    assert.deepEqual([...run.mergeChordShape(ch, run.filterValidNotes(ch.notes), templates)], [[1, 0]]);
    assert.deepEqual(run.frame({ t: 1, notes: [{ s: 1, f: 7 }, { s: 2, f: 9 }] }, [], []), {
        shape: [[1, 7], [2, 9]], left: 6, right: 9,
    });
});

test('camera bootstrap and lookahead ignore sentinel and malformed frets', () => {
    const chords = [{ t: 1, notes: [{ s: 3, f: 127, mt: true }, { s: 4, f: 255 }] }];
    const notes = [{ t: 2, s: 0, f: 25 }, { t: 3, s: 1, f: 7 }];
    assert.equal(run.hwyFirstRelevantFrettedTime(notes, chords, 0, 0.2, 6), 3);
    assert.equal(run.hwyFirstRelevantFrettedTime([], chords, 0, 0.2, 6), null);
    assert.deepEqual(run.lookaheadComputeFretBounds(0, [], notes, chords), { minF: 7, maxF: 7 });
    assert.deepEqual(run.lookaheadComputeFretBounds(0, [{ time: 0, fret: 3, width: 4 }], [], chords), { minF: 3, maxF: 6 });
});
