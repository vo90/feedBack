// Behavioural coverage for plain standalone notes that duplicate members of
// compact repeat chords. Fixtures are in-memory and require no installed song.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const screenPath = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');
const screenSrc = fs.readFileSync(screenPath, 'utf8');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name);
    assert.ok(start >= 0, `function ${name} must exist`);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces extracting ${name}`);
}

const helpers = new Function(
    '"use strict";' +
    extractFn(screenSrc, '_noteKey') +
    extractFn(screenSrc, '_noteFretKey') +
    extractFn(screenSrc, '_noteHasStandaloneVisualData') +
    extractFn(screenSrc, 'coincidentPlainRepeatNotes') +
    '\nreturn { key: _noteFretKey, hasData: _noteHasStandaloneVisualData,' +
    ' find: coincidentPlainRepeatNotes };',
)();

const signature = (ch) => Array.isArray(ch.notes) && ch.notes.length
    ? ch.notes.slice().sort((a, b) => a.s - b.s).map(n => `${n.s}:${n.f}`).join('|')
    : null;

const a5 = (t) => ({
    t,
    id: 12,
    notes: [{ s: 1, f: 0 }, { s: 2, f: 2 }, { s: 3, f: 2 }],
});

test('plain member duplicate on the final A5 repeat is deduplicated', () => {
    const notes = [{ t: 23.174999, s: 1, f: 0 }];
    const chords = [a5(22.844), a5(23.01), a5(23.174999)];
    const found = helpers.find(notes, chords, signature);
    assert.equal(found.has(notes[0]), true);
});

test('a coincident note on the first chord in a run remains independent', () => {
    const notes = [{ t: 22.844, s: 1, f: 0 }];
    const found = helpers.find(notes, [a5(22.844)], signature);
    assert.equal(found.size, 0);
});

test('wire-default fields do not make a duplicate visually distinct', () => {
    const plainWireNote = {
        t: 23.174999, s: 1, f: 0, sus: 0, sl: -1, slu: -1, bn: 0,
        ho: false, po: false, hm: false, hp: false, pm: false, mt: false,
        vb: false, tr: false, ac: false, tp: false,
    };
    assert.equal(helpers.hasData(plainWireNote), false);
    const found = helpers.find(
        [plainWireNote], [a5(23.01), a5(23.174999)], signature);
    assert.equal(found.has(plainWireNote), true);
});

test('unique standalone technique or future metadata is never discarded', () => {
    for (const extra of [
        { sus: 0.4 },
        { vb: true },
        { bnv: [{ t: 0, v: 0.5 }] },
        { fg: 1 },
        { futureTechnique: 1 },
    ]) {
        const n = { t: 23.174999, s: 1, f: 0, ...extra };
        assert.equal(helpers.hasData(n), true);
        assert.equal(helpers.find(
            [n], [a5(23.01), a5(23.174999)], signature).size, 0);
    }
});

test('a plain duplicate cannot suppress a distinct technique note at the same position', () => {
    const plain = { t: 23.174999, s: 1, f: 0 };
    const technique = { t: 23.174999, s: 1, f: 0, vb: true };
    const found = helpers.find(
        [plain, technique], [a5(23.01), a5(23.174999)], signature);
    assert.equal(found.has(plain), true);
    assert.equal(found.has(technique), false);
});

test('different fret or non-repeated shape does not deduplicate', () => {
    assert.equal(helpers.find(
        [{ t: 23.174999, s: 1, f: 2 }],
        [a5(23.01), a5(23.174999)], signature,
    ).size, 0);
    assert.equal(helpers.find(
        [{ t: 23.174999, s: 1, f: 0 }],
        [a5(23.01), { t: 23.174999, notes: [{ s: 1, f: 0 }] }], signature,
    ).size, 0);
});

test('renderer caches the chart-static set and skips matching note events', () => {
    assert.match(
        screenSrc,
        /_coincidentRepeatNoteSet = coincidentPlainRepeatNotes\([\s\S]*?notes, bundle\.chords, chordShapeSignature\);/,
    );
    assert.match(
        screenSrc,
        /const n = notes\[_ni\];[\s\S]*?if \(n\.t > t1\) break;[\s\S]*?if \(_coincidentRepeatNoteSet\.has\(n\)\) continue;/,
        'the sorted-loop cutoff must run before the deduplication continue',
    );
});

test('dedup lifecycle stays on merge-independent renderer anchors', () => {
    const fretLabelCache = screenSrc.indexOf('let _fretLabelNotesRef = null;');
    const dedupState = screenSrc.indexOf('let _coincidentRepeatNoteSet = null;');
    const measureCache = screenSrc.indexOf('let _measureStarts = [];');
    assert.ok(fretLabelCache < dedupState && dedupState < measureCache);

    const reset = extractFn(screenSrc, '_resetStringDependentCaches');
    assert.ok(
        reset.indexOf('_coincidentRepeatNoteSet = null;')
            < reset.indexOf('_filterValidNotesCache = new WeakMap();'),
        'dedup state clears before the shared cache-reset tail',
    );

    const laneRailEnd = screenSrc.indexOf('laneRailBoundHi = _arpRailBoundHiScratch;');
    const dedupPrepass = screenSrc.indexOf(
        '// ── Coincident repeat-note deduplication', laneRailEnd,
    );
    const beatCache = screenSrc.indexOf('const beats = bundle.beats;', laneRailEnd);
    assert.ok(laneRailEnd < dedupPrepass && dedupPrepass < beatCache);
});
