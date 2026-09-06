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
const suppress = new Function(fn('noteHasRepeatTechniqueCue')
    + fn('repeatChordMaySuppressGems') + ';return repeatChordMaySuppressGems;')();

test('Godzilla-like palm-muted pinch harmonics retain their approach gems', () => {
    const ordinary = [{ s: 2, f: 2, pm: true }, { s: 3, f: 2, pm: true }];
    assert.equal(suppress(true, false, ordinary), true);
    const harmonic = ordinary.map(n => ({ ...n, hp: true, sus: 0 }));
    assert.equal(suppress(true, false, harmonic), false);
});

test('each gem-only technique is preserved even with zero sustain', () => {
    for (const flag of ['hm', 'hp', 'ho', 'po', 'tp', 'ac', 'slp', 'plk']) {
        assert.equal(suppress(true, false, [{ s: 2, f: 5, sus: 0, [flag]: true }]), false, flag);
    }
    for (const bend of [{ bn: 1 }, { bn: 0, bnv: [{ t: 0.2, v: 1 }] }]) {
        assert.equal(suppress(true, false, [{ s: 2, f: 5, ...bend }]), false);
    }
});

test('ordinary and muted repeats stay compact, and slide exemptions remain', () => {
    for (const flags of [{}, { pm: true }, { mt: true }, { fhm: true }, { bn: 0, bnv: [{ t: 0, v: 0 }] }]) {
        const notes = [{ s: 1, f: 3, ...flags }];
        assert.equal(suppress(true, false, notes), true);
        assert.equal(suppress(false, false, notes), false);
        assert.equal(suppress(true, true, notes), false);
    }
});

test('the chord draw path uses technique-aware suppression without changing synth deferral', () => {
    assert.match(src, /const suppressRepeatGems = repeatChordMaySuppressGems\(isRepeat, chordLinksSlide, chordNotes\)/);
    assert.match(src, /drawNote\([\s\S]*?suppressRepeatGems \|\| suppressSynthChord,/);
});
