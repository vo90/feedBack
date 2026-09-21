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
    screenSrc.slice(screenSrc.indexOf('    function slideTrailEnd('), screenSrc.indexOf('    // Camera tgtDist building blocks')) +
    extractFn(screenSrc, 'noteHasVibrato') +
    extractFn(screenSrc, 'noteHasVisibleMotionSustain') +
    extractFn(screenSrc, 'noteHasRepeatTechniqueCue') +
    extractFn(screenSrc, 'chordMuteKind') +
    extractFn(screenSrc, 'repeatChordMaySuppressGems') +
    '\nreturn repeatChordMaySuppressGems;',
)();

test('ordinary rapid repeat chords retain compact gem suppression', () => {
    assert.equal(maySuppress(true, false, [
        { s: 3, f: 9 },
        { s: 5, f: 0 },
    ]), true);
});

test('Are You Dead Yet 34.678s sustained repeat keeps both note heads', () => {
    const members = [
        { s: 1, f: 5, sus: 0.156 },
        { s: 2, f: 7, sus: 0.156 },
    ];
    assert.equal(maySuppress(true, false, members), false);
    assert.equal(maySuppress(true, false, members.map(n => ({ ...n, pm: true }))), false);
});

test('one visible fretted sustain keeps the complete repeated chord', () => {
    assert.equal(maySuppress(true, false, [
        { s: 0, f: 0, sus: 0 },
        { s: 1, f: 5, sus: 0.156 },
        { s: 2, f: 7, sus: 0 },
    ]), false);
});

test('repeat presentation agrees with the existing chord trail cutoff', () => {
    for (const sus of [undefined, 0, -0.1, 0.005, 0.01, NaN, Infinity]) {
        assert.equal(maySuppress(true, false, [{ s: 1, f: 5, sus }]), true, String(sus));
    }
    assert.equal(maySuppress(true, false, [{ s: 1, f: 5, sus: 0.010001 }]), false);
    // Ordinary open chord members have no separate sustain ribbons.
    assert.equal(maySuppress(true, false, [
        { s: 0, f: 0, sus: 0.5 }, { s: 1, f: 0, sus: 0.5 },
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
