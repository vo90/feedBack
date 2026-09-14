// Regression coverage for repeated chords whose moving sustain ribbon must
// retain a visible note head (Back In Black lead, 228.354s).

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

const maySuppress = new Function(
    '"use strict";' +
    extractFn(screenSrc, 'noteHasVibrato') +
    extractFn(screenSrc, 'noteHasVisibleMotionSustain') +
    extractFn(screenSrc, 'noteHasRepeatTechniqueCue') +
    extractFn(screenSrc, 'repeatChordMaySuppressGems') +
    '\nreturn repeatChordMaySuppressGems;',
)();

test('ordinary rapid repeat chords retain compact gem suppression', () => {
    assert.equal(maySuppress(true, false, [
        { s: 3, f: 9 },
        { s: 5, f: 0 },
    ]), true);
});

test('Back In Black repeated vibrato chord keeps its note heads', () => {
    assert.equal(maySuppress(true, false, [
        { s: 3, f: 9, sus: 0.727, vb: true },
        { s: 5, f: 0, sus: 0.727 },
    ]), false);
});

test('other moving sustain techniques also keep repeated chord gems', () => {
    assert.equal(maySuppress(true, false, [{ sus: 0.4, bn: 0.5 }]), false);
    assert.equal(maySuppress(true, false, [{ sus: 0.4, bnv: [{ t: 0, v: 0 }] }]), false);
    assert.equal(maySuppress(true, false, [{ sus: 0.4, tr: true }]), false);
});

test('non-repeats and slide-linked repeats are never suppressed here', () => {
    assert.equal(maySuppress(false, false, [{ s: 3, f: 9 }]), false);
    assert.equal(maySuppress(true, true, [{ s: 3, f: 9 }]), false);
});

test('chord rendering passes the targeted decision into drawNote', () => {
    assert.match(
        screenSrc,
        /const suppressRepeatGems = repeatChordMaySuppressGems\([\s\S]*?isRepeat, chordLinksSlide, chordNotes\);[\s\S]*?drawNote\([\s\S]*?skipLabel,[\s\S]*?suppressRepeatGems \|\| suppressSynthChord,/,
    );
});
