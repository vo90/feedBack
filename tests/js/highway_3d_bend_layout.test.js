const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, direction: effectiveDirection } = require('./highway-bend-layout-fixture.js');
const bend = (s, f = 7, bn = 0.5, t = 0, sus = 1) => ({ s, f, bn, t, sus });
function solve(notes, count = 6, options = {}, chords = []) {
    const gen = build(notes, chords, count, options);
    let step;
    do { step = gen.next(); } while (!step.done);
    return step.value;
}
function directions(notes, count = 6, options = {}, chords = []) {
    const result = solve(notes, count, options, chords);
    return notes.map(note => result.byNote.get(note)?.direction);
}

for (const count of [6, 7, 8]) {
    const offset = count - 6;
    for (const [name, strings, direction] of [
        ['blue/orange', [2, 3], 1],
        ['blue/orange/green', [2, 3, 4], 1],
        ['yellow/blue/orange', [1, 2, 3], 1],
        ['orange/green', [3, 4], -1],
        ['green/purple', [4, 5], -1],
        ['orange/green/purple', [3, 4, 5], -1],
        ['four adjacent lower strings', [0, 1, 2, 3], 1],
    ]) {
        test(`${count} strings: ${name} follows group preference`, () => {
            const notes = strings.map(s => bend(s + offset));
            assert.deepEqual(directions(notes, count), notes.map(() => direction));
        });
    }
}

test('different frets and unequal amounts still share a group and its preferred direction', () => {
    const notes = [bend(2, 7, 0.5), bend(3, 9, 2)];
    const result = solve(notes);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(notes.map(n => result.byNote.get(n).direction), [1, 1]);
});

test('same-fret unequal bends use a fitting direction without crossing', () => {
    assert.deepEqual(directions([bend(2, 7, 0.5), bend(3, 7, 2)]), [1, 1]);
    // The high-side preference crosses; the low-side alternative stays ordered.
    assert.deepEqual(directions([bend(2, 7, 2), bend(3, 7, 0.5)]), [-1, -1]);
});

test('full curves catch both directions crossing despite equal peaks', () => {
    const notes = [bend(2), bend(3)];
    notes[0].bnv = [{ t: 0, v: 0 }, { t: 0.25, v: 2 }, { t: 0.5, v: 0 }, { t: 1, v: 0 }];
    notes[1].bnv = [{ t: 0, v: 0 }, { t: 0.5, v: 0 }, { t: 0.75, v: 2 }, { t: 1, v: 0 }];
    assert.deepEqual(directions(notes), [0, 0]);
});

test('boundaries override preference using each member maximum', () => {
    assert.deepEqual(directions([bend(2, 7, 2), bend(3, 9, 2), bend(4, 9, 2)]), [-1, -1, -1]);
    const notes = [1, 2, 3, 4].map(s => bend(s, 7, 2));
    assert.deepEqual(directions(notes), [0, 0, 0, 0]);
});

test('red and purple remain independent and bend inward', () => {
    assert.deepEqual(directions([bend(0, 7, 1), bend(5, 7, 1)]), [1, -1]);
});

test('red is interior on seven and eight strings and can move toward extra low strings', () => {
    for (const count of [7, 8]) {
        const red = count - 6;
        // Thin-side crossing makes the low-side alternative useful.
        const notes = [bend(red, 7, 1.25), bend(red + 1, 7, 0.1)];
        assert.deepEqual(directions(notes, count), [-1, -1]);
    }
});

test('ordinary sustained strings do not bridge separated bends', () => {
    const notes = [bend(1), { s: 2, f: 7, t: 0, sus: 4 }, bend(3)];
    const result = solve(notes);
    assert.equal(result.groups.length, 2);
    assert.equal(result.byNote.has(notes[1]), false);
});

test('overlapping onsets group transitively, while touching independent attacks do not', () => {
    const notes = [bend(1, 7, 0.5, 0, 1), bend(2, 9, 0.5, 0.8, 1), bend(3, 9, 0.5, 1.6, 1)];
    const result = solve(notes);
    assert.equal(result.groups.length, 1);
    assert.deepEqual(directions([bend(2, 7, 0.5, 0, 1), bend(3, 7, 0.5, 1, 1)]), [1, -1]);
});

test('validated links carry stable direction through a zero-bend continuation', () => {
    const first = bend(3, 7, 0.5, 0, 1);
    const plain = { s: 3, f: 7, t: 1, sus: 1 };
    const last = bend(3, 7, 0.5, 2, 1);
    const lower = bend(2, 9, 0.5, 1.5, 1);
    const links = new Map([
        [plain, { source: first, sourceTime: 0, targetTime: 1 }],
        [last, { source: plain, sourceTime: 1, targetTime: 2 }],
    ]);
    assert.deepEqual(directions([first, plain, last, lower], 6, { links }), [1, 1, 1, 1]);
});

test('linked plain chains without any bend remain absent', () => {
    const a = { s: 2, f: 7, t: 0, sus: 1 }, b = { s: 2, f: 7, t: 1, sus: 1 };
    const result = solve([a, b], 6, { links: new Map([[b, { source: a }]]) });
    assert.equal(result.groups.length, 0);
    assert.equal(result.byNote.has(a), false);
});

test('resolved inherited starts and scalar linked ends affect crossing checks', () => {
    const a = bend(2, 7, 0.5), b = bend(3, 7, 0.5);
    a.bnv = [{ t: 1, v: 0.5 }];
    const starts = new WeakMap([[a, 2]]);
    assert.deepEqual(directions([a, b], 6, { starts }), [-1, -1]);
    const source = bend(2, 7, 2), target = bend(3, 7, 2, 0.9, 1);
    assert.deepEqual(directions([source, target]), [1, 1]);
    assert.deepEqual(directions([source, target], 6, { ends: new WeakMap([[source, 2]]) }), [-1, -1]);
});

test('pre-bends fit their full authored curve and preserve explicit zero onset', () => {
    const a = bend(3, 7, 1);
    a.bt = 2;
    a.bnv = [{ t: 0.5, v: 2 }, { t: 1, v: 0 }];
    const b = bend(4, 7, 0.5);
    assert.deepEqual(directions([a, b]), [-1, -1]);
    a.bnv = [{ t: 0, v: 0 }, { t: 0.5, v: 0.5 }, { t: 1, v: 0 }];
    const result = solve([a, b], 6, { starts: new WeakMap([[a, 9]]) });
    assert.equal(result.byNote.get(a).peak, 0.5);
});

test('chord members use chord onset and retain original note identity', () => {
    const a = bend(2, 7, 0.5, 99), b = bend(3, 9, 0.5, -99);
    const result = solve([], 6, {}, [{ t: 4, notes: [a, b] }]);
    assert.equal(result.groups.length, 1);
    assert.equal(result.byNote.get(a).direction, 1);
    assert.equal(result.byNote.get(b).direction, 1);
    assert.equal(result.groups[0].start, 4);
    assert.equal(result.groups[0].end, 5);
    assert.equal(result.groups[0].members[0].onset, 4);
    assert.equal(a.t, 99);
});

test('large excursions of disconnected groups cannot cross through each other', () => {
    const notes = [bend(0, 7, 3), bend(5, 7, 3)];
    assert.deepEqual(directions(notes), [0, 0]);
});

test('different frets are not false collisions, slides reserve their fret range conservatively', () => {
    assert.deepEqual(directions([bend(0, 7, 3), bend(5, 9, 3)]), [1, -1]);
    const notes = [bend(0, 7, 3), bend(5, 9, 3)];
    notes[0].sl = 9;
    assert.deepEqual(directions(notes), [0, 0]);
});

test('vibrato excursion reserves edge and pair clearance', () => {
    const notes = [bend(2, 7, 1), bend(3, 7, 1)];
    assert.deepEqual(directions(notes, 6, { vibratoRange: () => [-0.6, 0.6] }), [0, 0]);
    const outer = bend(0, 7, 1);
    assert.deepEqual(directions([outer], 6, { vibratoRange: () => [-0.5, 0.5] }), [0]);
});

test('chart data is untouched and repeated preparation is deterministic', () => {
    const notes = [bend(2), bend(3, 9, 1)];
    notes[0].bnv = Object.freeze([Object.freeze({ t: 0.2, v: 0.5 }), Object.freeze({ t: 1, v: 0 })]);
    notes.forEach(Object.freeze);
    Object.freeze(notes);
    const before = JSON.stringify(notes);
    assert.deepEqual(directions(notes), directions(notes));
    assert.equal(JSON.stringify(notes), before);
});

test('giant authored curves use bounded group-local fallback without scanning samples', () => {
    let reads = 0;
    const huge = new Proxy(new Array(100000), { get(target, key) {
        if (/^\d+$/.test(String(key))) reads++;
        return Reflect.get(target, key);
    } });
    const a = bend(2), b = bend(3);
    a.bnv = huge;
    assert.deepEqual(directions([a, b]), [0, 0]);
    assert.equal(reads, 0);
});

test('incomplete pathological grouping safely neutralizes every bend', () => {
    const notes = Array.from({ length: 80 }, (_, i) => bend(i % 6, 7, 0.5, 0, 2));
    const result = solve(notes, 6, { maxComparisons: 8, yieldEvery: 4 });
    assert.equal(result.stats.fallback, 'complexity-grouping');
    assert.ok(notes.every(n => result.byNote.get(n).direction === 0));
    assert.ok(result.stats.comparisons <= 9);
    assert.ok(result.stats.yields > 0);
});

test('collision work is capped and neutral fallback is global and deterministic', () => {
    const notes = [bend(2), bend(3)];
    const result = solve(notes, 6, { maxCurveWork: 1 });
    assert.equal(result.stats.fallback, 'complexity-collision');
    assert.deepEqual(notes.map(n => result.byNote.get(n).direction), [0, 0]);
});

test('generator yields after bounded counted work including sort and link traversal', () => {
    const notes = Array.from({ length: 300 }, (_, i) => bend(i % 6, 7, 0.5, 300 - i, 0.5));
    const gen = build(notes, [], 6, { yieldEvery: 16 });
    let prior = 0, step, yields = 0;
    do {
        step = gen.next();
        if (!step.done) {
            assert.equal(step.value.operations - prior, 16);
            prior = step.value.operations;
            yields++;
        }
    } while (!step.done);
    assert.ok(yields > 100);
    assert.equal(step.value.stats.records, 300);
});

test('record cap stops before touching the rest of a pathological arrangement', () => {
    let untouchedReads = 0;
    const notes = Array.from({ length: 6 }, (_, i) => bend(i));
    Object.defineProperty(notes, 5, { get() { untouchedReads++; throw new Error('remainder must not be read'); } });
    const result = solve(notes, 6, { maxRecords: 4 });
    assert.equal(result.forceNeutral, true);
    assert.equal(result.stats.fallback, 'complexity-records');
    assert.equal(result.stats.records, 4);
    assert.equal(result.groups.length, 0);
    assert.equal(result.byNote.has(notes[0]), false);
    assert.equal(untouchedReads, 0);
});

test('large link maps use an immediate constant-work revision-wide fallback', () => {
    const links = new Map(Array.from({ length: 10 }, (_, i) =>
        [bend(2, 7, 0.5, i + 1), { source: bend(2, 7, 0.5, i) }]));
    const result = solve([], 6, { maxRecords: 4, links });
    assert.equal(result.forceNeutral, true);
    assert.equal(result.stats.fallback, 'complexity-links');
    assert.equal(result.stats.operations, 0);
});

test('total curve-point cap bounds retained memory and skips chart remainder', () => {
    const notes = [bend(2), bend(3), bend(4)];
    Object.defineProperty(notes, 2, { get() { throw new Error('remainder must not be read'); } });
    const result = solve(notes, 6, { maxStoredPoints: 4 });
    assert.equal(result.forceNeutral, true);
    assert.equal(result.stats.fallback, 'complexity-points');
    assert.equal(result.stats.records, 1);
    assert.equal(result.stats.curvePoints, 4);
});

test('published groups retain only lightweight source identities and gesture spans', () => {
    const notes = [bend(2), bend(3)];
    const result = solve(notes);
    assert.deepEqual(Object.keys(result.groups[0].members[0]), ['note', 'onset', 'end', 'peak']);
    assert.equal(result.byNote.get(notes[0]).group, result.byNote.get(notes[1]).group);
    result.groups[0].direction = 0;
    assert.equal(result.byNote.get(notes[1]).group.direction, 0);
});

test('pinning an observed bend neutral also pins a future group that would cross it', () => {
    const future = bend(0, 7, 2.5, 11, 2), observed = bend(2, 7, 1.5, 10, 4);
    const result = solve([future, observed]);
    const a = result.byNote.get(future).group, b = result.byNote.get(observed).group;
    assert.notEqual(a, b);
    assert.deepEqual([a.direction, b.direction], [1, 1]);
    assert.equal(a.neutralComponent, b.neutralComponent);
    b.direction = 0;
    b.neutralComponent.neutral = true;
    assert.deepEqual([effectiveDirection(a), effectiveDirection(b)], [0, 0]);
});

test('neutral dependencies close transitively without merging independently selected groups', () => {
    const notes = [bend(0, 7, 3), bend(2, 7, 3), bend(4, 7, 1.5), bend(5, 7, 1.5)];
    const result = solve(notes, 8);
    assert.equal(result.groups.length, 3);
    assert.ok(result.groups.every(group => group.direction === 1));
    assert.equal(new Set(result.groups.map(group => group.neutralComponent)).size, 1);
    result.groups[2].neutralComponent.neutral = true;
    assert.ok(result.groups.every(group => group.neutralComponent.neutral));
});

test('neutral dependencies do not connect different frets or disjoint gesture times', () => {
    for (const second of [bend(2, 9, 1.5), bend(2, 7, 1.5, 3, 1)]) {
        const first = bend(0, 7, 2.5);
        const result = solve([first, second]);
        const a = result.byNote.get(first).group, b = result.byNote.get(second).group;
        assert.notEqual(a.neutralComponent, b.neutralComponent);
        a.neutralComponent.neutral = true;
        assert.equal(b.neutralComponent.neutral, false);
        assert.equal(b.direction, 1);
    }
});

test('simultaneous duplicate-time jumps inspect both right limits together', () => {
    const a = bend(2), b = bend(3);
    a.bnv = [{t:0,v:0},{t:.5,v:0},{t:.5,v:1},{t:1,v:0}];
    b.bnv = [{t:0,v:1},{t:.5,v:1},{t:.5,v:0},{t:1,v:0}];
    const result = solve([a,b]);
    assert.equal(result.byNote.get(a).direction, 0,
        'thin-side simultaneous jump and thick-side pre-bend both collide');
    assert.equal(result.byNote.get(b).direction, 0);
});

test('Iron Maiden D/G fret-seven half-semitone curves retain pitch and share a thin-side direction', () => {
    const notes = [2, 3].map(s => ({t:34.555,s,f:7,sus:.16,bn:.5,
        bnv:[{t:0,v:0},{t:.08,v:.5},{t:.16,v:0}]}));
    const before = JSON.stringify(notes);
    const result = solve(notes);
    assert.deepEqual(notes.map(n => effectiveDirection(result.byNote.get(n).group)), [1, 1]);
    assert.deepEqual(notes.map(n => result.byNote.get(n).peak), [.5, .5]);
    assert.equal(result.groups.length, 1);
    assert.equal(JSON.stringify(notes), before);
});
