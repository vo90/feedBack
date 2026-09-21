'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = source.indexOf('Object.assign(_scrChordNote, cn);');
const end = source.indexOf('drawNote(', start);
assert.ok(start >= 0 && end > start, 'actual chord scratch preparation must be present');
const prepare = new Function(`
    const _linkedBendStarts = new WeakMap(), _linkedBendEnds = new WeakMap();
    const _linkedVibratoRuns = new WeakMap();
        const _linkedTrailPaths={byNote:new WeakMap()};
    return function(_scrChordNote, cn, ch) {
        ${source.slice(start, end)}
        return _scrChordNote;
    };
`)();
const templateStart = source.indexOf('function chordNotesFromTemplate(');
const templateEnd = source.indexOf('\n        /**', templateStart);
assert.ok(templateStart >= 0 && templateEnd > templateStart, 'actual synthesized chord builder must be present');
const synthesize = new Function('isPlayableFret', 'validString', source.slice(templateStart, templateEnd) + 'return chordNotesFromTemplate;')(
    fret => Number.isInteger(fret) && fret >= 0 && fret <= 24,
    string => Number.isInteger(string) && string >= 0 && string < 6,
);
const booleanFields = ['ho', 'po', 'hm', 'hp', 'pm', 'mt', 'vb', 'tr', 'ac', 'tp', 'ln', 'ig', 'fhm', 'slp', 'plk'];

test('synthesized chord members clear previous technique flags, slides and bend data in reused scratch', () => {
    const scratch = {};
    const decorated = {s: 0, f: 5, sus: 2, bn: 2, sl: 7, slu: 9, bt: 3, bnv: [{t: 0, v: 2}], fg: 2, sd: 4, rh: 1, pkd: 1, sg: 9};
    for (const field of booleanFields) decorated[field] = true;
    prepare(scratch, decorated, {t: 1});
    const members = synthesize(0, [{frets: [5, 7, 7, -1, -1, -1]}]);
    const originals = structuredClone(members);
    for (const member of members) {
        const rendered = prepare(scratch, member, {t: 2});
        assert.equal(rendered, scratch, 'scratch object remains pooled');
        for (const field of booleanFields) assert.equal(rendered[field], false, `${field} leaked to synthesized member`);
        for (const field of ['sl', 'slu', 'fg', 'sd', 'rh', 'pkd', 'sg']) assert.equal(rendered[field], -1, `${field} did not reset`);
        assert.equal(rendered.bn, 0);
        assert.equal(rendered.bt, 0);
        assert.equal(rendered.bnv, undefined);
        assert.equal(rendered.sus, 0);
        assert.equal(rendered.t, 2);
    }
    assert.deepEqual(members, originals, 'preparation must not mutate chart members');
});

test('authored wire techniques survive scratch preparation, including zero-valued targets and labels', () => {
    const scratch = {};
    for (const enabled of [true, false, true]) {
        const authored = {s: 2, f: 7, sus: 1.2, bn: 1.5, sl: 0, slu: 0, bt: 2, bnv: [{t: 0, v: 1.5}], fg: 0, sd: 0, rh: 0, pkd: 0, sg: 0};
        for (const field of booleanFields) authored[field] = enabled;
        const original = structuredClone(authored);
        const rendered = prepare(scratch, authored, {t: 12.5});
        for (const [field, value] of Object.entries(authored)) assert.deepEqual(rendered[field], value, `authored ${field} changed`);
        assert.equal(rendered.t, 12.5);
        assert.deepEqual(authored, original, 'authored chart note must remain untouched');
    }
});
