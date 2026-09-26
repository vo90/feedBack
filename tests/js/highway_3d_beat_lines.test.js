// Execute the production beat-line pass with a reusable line pool. Assert the
// emitted materials and geometry, rather than duplicating its classification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const start = source.indexOf('// ── Beat lines ');
const end = source.indexOf('// ── Section labels ', start);
assert.ok(start >= 0 && end > start, 'production beat-line pass must exist');
const pass = new vm.Script(`'use strict';\n${source.slice(start, end)}`);

function renderer() {
    const lines = [];
    let used = 0;
    const mBeatM = Object.freeze({ name: 'bar' });
    const mBeatQ = Object.freeze({ name: 'beat' });
    const vector = () => ({ set(x, y, z) { this.value = [x, y, z]; } });
    const context = vm.createContext({
        mBeatM, mBeatQ,
        K: 1, S_BASE: 8, NH: 2,
        boardSpanX: () => ({ min: 2, width: 24 }),
        dZ: dt => -dt * 230,
        pBeat: { get() {
            const index = used++;
            return lines[index] ||= { position: vector(), scale: vector(), material: mBeatQ };
        } },
    });
    return {
        lines,
        draw(beats, { now = 0, t0 = now - 0.5, t1 = now + 3 } = {}) {
            used = 0;
            Object.assign(context, { beats, now, t0, t1 });
            pass.runInContext(context);
            return lines.slice(0, used).map(line => ({
                material: line.material.name,
                position: [...line.position.value],
                scale: [...line.scale.value],
            }));
        },
    };
}

const grid = (measures, times = measures.map((_, i) => i * 0.5)) =>
    Object.freeze(measures.map((measure, i) => Object.freeze({ time: times[i], measure })));
const materials = lines => lines.map(line => line.material);

test('only the first beat of each 4/4 bar is bright', () => {
    const beats = grid([1, -1, -1, -1, 2, -1, -1, -1, 3]);
    assert.deepEqual(materials(renderer().draw(beats, { t1: 4 })),
        ['bar', 'beat', 'beat', 'beat', 'bar', 'beat', 'beat', 'beat', 'bar']);
});

test('explicit downbeats support measure zero, changing bar lengths and irregular timing', () => {
    const beats = grid([0, -1, -1, 1, -1, -1, -1, -1, -1, 2, 3],
        [0, 0.12, 0.31, 0.7, 0.8, 1.2, 1.25, 1.4, 1.8, 2.1, 2.6]);
    assert.deepEqual(materials(renderer().draw(beats)),
        ['bar', 'beat', 'beat', 'bar', 'beat', 'beat', 'beat', 'beat', 'beat', 'bar', 'bar']);
});

test('missing, negative and malformed measure values cannot become bright through coercion', () => {
    const values = [0, -1, -2, undefined, null, '3', true, 1.5, NaN, Infinity, -Infinity, {}, [], 4];
    const beats = grid(values, values.map((_, i) => i * 0.1));
    assert.deepEqual(materials(renderer().draw(beats)),
        values.map((_, i) => i === 0 || i === values.length - 1 ? 'bar' : 'beat'));
});

test('a window beginning after a bar line does not accent its first visible ordinary beat', () => {
    const beats = grid([1, -1, -1, -1, 2]);
    const rows = renderer().draw(beats, { now: 1, t0: 0.5, t1: 1.5 });
    assert.deepEqual(materials(rows), ['beat', 'beat', 'beat']);
    assert.deepEqual(rows.map(row => row.position), [[0, 5.5, 115], [0, 5.5, -0], [0, 5.5, -115]]);
    assert.ok(rows.every(row => JSON.stringify(row.scale) === '[28,1,1]'));
});

test('reused lines change material correctly on forward frames, pauses and backward loops', () => {
    const beats = grid([1, -1, -1, -1, 2, -1, -1, -1, 3]);
    const r = renderer();
    const first = r.draw(beats, { now: 0, t0: 0, t1: 1 });
    const firstObject = r.lines[0];
    assert.deepEqual(materials(first), ['bar', 'beat', 'beat']);
    const later = r.draw(beats, { now: 1.5, t0: 1.5, t1: 2.5 });
    assert.equal(r.lines[0], firstObject, 'the same pooled object must be reassigned');
    assert.deepEqual(materials(later), ['beat', 'bar', 'beat']);
    assert.deepEqual(r.draw(beats, { now: 1.5, t0: 1.5, t1: 2.5 }), later, 'paused frame');
    assert.deepEqual(r.draw(beats, { now: 0, t0: 0, t1: 1 }), first, 'backward loop');
});

test('empty or unavailable beat grids emit no lines', () => {
    const r = renderer();
    r.draw(grid([1, -1]));
    assert.deepEqual(r.draw([]), []);
    assert.deepEqual(r.draw(null), []);
    assert.deepEqual(r.draw(undefined), []);
});

test('dense Danzig regression keeps all 20 timestamps and accents only five downbeats', () => {
    // Include the preceding bar to reproduce the actual 160–163 second window.
    const beats = grid(
        [78, -1, -1, -1, 79, -1, -1, -1, 80, -1, -1, -1, 81, -1, -1, -1, 82, -1, -1, -1, 83],
        [159.858994, 160, 160.141006, 160.281998, 160.421997, 160.563004, 160.703995, 160.845001,
            160.985992, 161.126999, 161.268005, 161.408997, 161.550003, 161.690994,
            161.832001, 161.973007, 162.113998, 162.255005, 162.395004, 162.535995, 162.802994],
    );
    const rows = renderer().draw(beats, { now: 160, t0: 160, t1: 163 });
    assert.equal(rows.length, 20);
    assert.deepEqual(rows.flatMap((row, i) => row.material === 'bar' ? [i] : []), [3, 7, 11, 15, 19]);
    assert.deepEqual(rows.map(row => row.position[2]), beats.slice(1).map(beat => -(beat.time - 160) * 230));
});
