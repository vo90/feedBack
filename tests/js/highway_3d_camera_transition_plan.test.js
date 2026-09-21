const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`), open = source.indexOf('{', start);
    assert.ok(start >= 0);
    let depth = 1, end = open + 1;
    while (depth) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    return source.slice(start, end);
}
const { build, at, rejoin, zoom } = new Function(`
    ${['hwyBuildCameraStops', 'hwyCameraPlanAt', 'hwyCameraRejoin', 'hwyCameraZoom'].map(extract).join('\n')}
    return {build:hwyBuildCameraStops,at:hwyCameraPlanAt,rejoin:hwyCameraRejoin,zoom:hwyCameraZoom};
`)();
const row = (time, x, width = 4) => ({ time, x, minX: x - width / 2, maxX: x + width / 2 });
const fits = () => true;
const sample = (stops, time, rate = 1) => at(stops, time, rate, .5);

test('A-B-A skips a readable short detour without changing chart rows', () => {
    const rows = [row(0, 9), row(2, 13), row(2.601, 9)];
    rows.forEach(Object.freeze); Object.freeze(rows);
    const stops = build(rows, 1, fits);
    assert.deepEqual(stops.map(r => r.x), [9]);
    assert.equal(rows[1].x, 13);
    for (let t = 0; t < 5; t += .01) assert.equal(sample(stops, t).x, 9);
});

test('A-B-C removes an unnecessary opposite-direction excursion', () => {
    const stops = build([row(0, 9), row(2, 13), row(2.601, 3)], 1, fits);
    assert.deepEqual(stops.map(r => r.x), [9, 3]);
    let previous = 9;
    for (let t = 1; t < 4; t += .01) {
        const { x } = sample(stops, t); assert.ok(x <= previous + 1e-10); previous = x;
    }
    assert.equal(previous, 3);
});

test('a short position is retained when a shared view is not readable', () => {
    const stops = build([row(0, 9), row(2, 13), row(2.601, 3)], 1, () => false);
    assert.deepEqual(stops.map(r => r.x), [9, 13, 3]);
});

test('holding eligibility uses real duration at different playback speeds', () => {
    const rows = [row(0, 9), row(2, 13), row(2.6, 9)];
    assert.equal(build(rows, .5, fits).length, 3);
    assert.equal(build(rows, 1, fits).length, 1);
    assert.equal(build(rows, 2, fits).length, 1);
});

test('temporary one-sided extension stays centred but a persistent extension reframes', () => {
    const a = row(0, 10), b = row(2, 11, 6), c = row(2.315, 10);
    assert.equal(build([a, b, c], 1, fits).length, 1);
    assert.deepEqual(build([a, b], 1, fits).map(r => r.x), [10, 11]);
});

test('holding decisions cannot see a distant return elsewhere in the song', () => {
    const stops = build([row(0, 2), row(2, 6), row(2.4, 7), row(10, 2)], 1, fits);
    assert.equal(stops[1].x, 6);
});

test('a very remote short area is not suppressed merely because it returns', () => {
    assert.deepEqual(build([row(0, 2), row(2, 20), row(2.3, 2)], 1, fits).map(r => r.x), [2, 20, 2]);
});

test('rapid related positions do not restart the same target repeatedly', () => {
    const rows = [row(0, 3), ...Array.from({ length: 40 }, (_, i) => row(2 + i * .1, i % 2 ? 3 : 4)), row(6, 3)];
    assert.equal(build(rows, 1, fits).length, 1);
});

test('progressive short changes continue following rather than staying at an old position', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(i * .2, i));
    const stops = build(rows, 1, fits);
    assert.equal(stops.length, 20);
    assert.equal(sample(stops, 5).x, 19);
    let previous = 0;
    for (let t = 0; t < 5; t += .01) {
        const { x } = sample(stops, t); assert.ok(x >= previous - 1e-10); previous = x;
    }
});

test('finite easing begins 600ms early and finishes without residual drift', () => {
    const stops = build([row(0, 3), row(2, 7)], 1, fits);
    assert.equal(sample(stops, 1.4).x, 3);
    assert.ok(sample(stops, 1.7).x > 3);
    assert.ok(sample(stops, 2).x > 6);
    assert.equal(sample(stops, 2.11).x, 7);
    assert.equal(sample(stops, 10000).x, 7);
});

test('scheduled pan has continuous velocity and acceleration at its endpoints', () => {
    const stops = build([row(0, 3), row(2, 11)], 1, fits), e = 1e-6;
    for (const t of [1.4, 2.5]) {
        const l = sample(stops, t - e), m = sample(stops, t), r = sample(stops, t + e);
        assert.ok(Math.abs(l.velocity - r.velocity) < 1e-7);
        assert.ok(Math.abs((r.velocity - l.velocity) / (2 * e)) < .002);
        assert.ok(Math.abs(m.x - (l.x + r.x) / 2) < 1e-9);
    }
});

test('overlapping transitions preserve position and velocity continuity', () => {
    const stops = build([row(0, 3), row(2, 7), row(2.2, 11), row(2.4, 15)], 1, fits);
    for (const t of [1.5, 1.7, 1.9, 2.1, 2.3, 2.5]) {
        assert.ok(Math.abs(sample(stops, t + 1e-7).velocity - sample(stops, t - 1e-7).velocity) < .001);
    }
});

test('seeking and low or variable frame rates evaluate the same trajectory', () => {
    const stops = build([row(0, 3), row(2, 11), row(4, 7)], 1, fits);
    const expected = sample(stops, 1.9);
    for (const fps of [10, 20, 30, 60, 120]) {
        for (let i = 0; i < fps * 2; i++) sample(stops, i / fps);
        assert.deepEqual(sample(stops, 1.9), expected);
    }
});

test('transition timing stays constant in real seconds at supported speeds', () => {
    const reference = sample(build([row(0, 3), row(2, 11)], 1, fits), 1.8);
    for (const rate of [.5, 1, 1.5, 2]) {
        const stops = build([row(0, 3), row(2 * rate, 11)], rate, fits);
        const result = sample(stops, 1.8 * rate, rate);
        assert.ok(Math.abs(result.x - reference.x) < 1e-8);
        assert.ok(Math.abs(result.velocity - reference.velocity) < 1e-8);
    }
});

test('mirrored world coordinates yield mirrored movement and detour decisions', () => {
    const rows = [row(0, 9), row(2, 13), row(2.6, 3)];
    const mirror = rows.map(r => ({ ...r, x: -r.x, minX: -r.maxX, maxX: -r.minX }));
    const a = build(rows, 1, fits), b = build(mirror, 1, fits);
    for (let t = 0; t < 4; t += .05) assert.ok(Math.abs(sample(a, t).x + sample(b, t).x) < 1e-8);
});

test('duplicate bounds have no effect on the scheduled transition', () => {
    const rows = [row(0, 3), row(2, 11)];
    const a = build(rows, 1, fits), b = build([...rows, row(2.01, 11), row(2.02, 11)], 1, fits);
    assert.deepEqual(a, b);
});

test('catch-up after lifecycle changes is stable across frame rates', () => {
    const results = [];
    for (const fps of [10, 20, 60, 120]) {
        let state = { offset: 20, velocity: -5 };
        for (let i = 0; i < fps; i++) state = rejoin(state.offset, state.velocity, 1 / fps);
        results.push(state);
    }
    assert.ok(Math.max(...results.map(r => r.offset)) - Math.min(...results.map(r => r.offset)) < 1e-10);
    assert.ok(Math.abs(results[0].offset) < .001);
});

test('empty and one-position charts have finite resting plans', () => {
    assert.deepEqual(sample([], 20), { x: 0, velocity: 0, valid: false });
    assert.deepEqual(sample(build([row(3, 9)], 1, fits), 0), { x: 9, velocity: 0, valid: true });
});

test('normal transition is 700ms with a lower peak speed and the same arrival deadline', () => {
    const stops = build([row(0, 3), row(2, 7)], 1, fits);
    assert.equal(sample(stops, 1.4).velocity, 0);
    assert.ok(Math.abs(sample(stops, 1.75).velocity - 4 * 1.875 / .7) < 1e-9);
    assert.ok(sample(stops, 1.75).velocity < 4 * 1.875 / .6);
    assert.equal(sample(stops, 2.1).x, 7);
});

test('necessary zoom waits 500ms and returns fully over 800ms at every frame rate', () => {
    for (const fps of [10, 20, 60, 120]) {
        const state = {distance: 2, quietZoomTime: 0};
        for (let i = 1; i <= Math.round(1.4 * fps); i++) {
            zoom(state, 1, 1 / fps);
            if (i / fps <= .5) assert.ok(Math.abs(state.distance - 2) < 1e-10);
        }
        assert.equal(state.distance, 1);
        assert.equal(state.zoomRequired, 1);
    }
});

test('renewed wide requirements cancel a narrowing return', () => {
    const state = {distance: 2, quietZoomTime: 0};
    for (let i = 0; i < 9; i++) zoom(state, 1, .1);
    assert.ok(state.distance > 1 && state.distance < 2);
    const before = state.distance;
    zoom(state, 2, .1);
    assert.equal(state.quietZoomTime, 0);
    assert.ok(state.distance > before);
});
