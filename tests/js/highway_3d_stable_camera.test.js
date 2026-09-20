const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}

function harness() {
    const constants = ['STABLE_CAMERA_FOV', 'STABLE_CAMERA_PITCH', 'STABLE_CAMERA_YAW', 'STABLE_CAMERA_SHIFT']
        .map(name => source.match(new RegExp(`const ${name} = [^;]+;`))[0]).join('\n');
    const stateStart = source.indexOf('const _stableCam = {');
    const stateEnd = source.indexOf('function stableAddPoint(', stateStart);
    assert.ok(stateStart >= 0 && stateEnd > stateStart);
    return new Function(`
        const K = 1, TS = 230, AHEAD = 3, CAM_LOCK_CENTER_FRET = 6;
        ${constants}
        ${source.slice(stateStart, stateEnd)}
        let _stableCameraResetSerial = 0, stableCameraPreset = 'straight', stableCameraFollow = true;
        let _leftyCached = false, _songKey = 'song', nStr = 6, cameraSmoothing = .5, zoomSmoothing = .5;
        let wall = 0, fixturePoints = [], curX = 60;
        const cam = { aspect: 16 / 9 };
        const T = { Vector3: class {} }; // sprite collection uses matrix scalars only
        const performance = { now: () => wall * 1000 };
        const sY = string => (3 + (nStr - 1 - string) * 4) * K;
        const xFretMid = fret => fret * 10;
        const dZ = time => -time * TS;
        ${extractFunction('stableAddPoint')}
        ${extractFunction('stableCollectObject')}
        ${extractFunction('stableConstrain')}
        ${extractFunction('stableIntervalAt')}
        ${extractFunction('stableSolve')}
        ${extractFunction('stableCamUpdate')}
        function stableCollectGeometry() {
            _stableCam.pointCount = fixturePoints.length * 3;
            _stableCam.minX = Infinity; _stableCam.maxX = -Infinity;
            fixturePoints.forEach((point, index) => {
                _stablePoints.set(point, index * 3);
                _stableCam.minX = Math.min(_stableCam.minX, point[0]);
                _stableCam.maxX = Math.max(_stableCam.maxX, point[0]);
            });
        }
        function stableApplyPose() { curX = _stableCam.x; }
        const bundle = { currentTime: 0, isPlaying: true, notes: [], chords: [] };
        return {
            setPoints(points) { fixturePoints = points; },
            settings(values) {
                if ('follow' in values) stableCameraFollow = values.follow;
                if ('preset' in values) stableCameraPreset = values.preset;
                if ('lefty' in values) _leftyCached = values.lefty;
                if ('aspect' in values) cam.aspect = values.aspect;
                if ('strings' in values) nStr = values.strings;
                if ('pan' in values) cameraSmoothing = values.pan;
            },
            frame(time, elapsed = 1 / 60, playing = true) {
                wall += elapsed; bundle.currentTime = time; bundle.isPlaying = playing;
                stableCamUpdate(bundle); return { ..._stableCam };
            },
            solve(x, distance, prediction = 0, margin = .90, fixed = false) {
                stableCollectGeometry(); return { ...stableSolve(x, distance, prediction, margin, fixed) };
            },
            interval(distance, prediction = 0, margin = .90, fixed = null) {
                stableCollectGeometry(); return { ...stableIntervalAt(distance, prediction, margin, fixed) };
            },
            spritePoints({ x, y, z, size, centerY }) {
                for (const bin of _stableBins) {
                    bin.minX = bin.minY = bin.minZ = Infinity;
                    bin.maxX = bin.maxY = bin.maxZ = -Infinity;
                }
                stableCollectObject({ visible: true, isSprite: true, userData: {}, material: { opacity: 1 },
                    center: { x: .5, y: centerY }, updateWorldMatrix() {},
                    matrixWorld: { elements: [size, 0, 0, 0, 0, size, 0, 0, 0, 0, 1, 0, x, y, z, 1] } });
                const points = [];
                for (const bin of _stableBins) if (Number.isFinite(bin.minX)) {
                    for (let i = 0; i < 8; i++) points.push([i & 1 ? bin.maxX : bin.minX,
                        i & 2 ? bin.maxY : bin.minY, i & 4 ? bin.maxZ : bin.minZ]);
                }
                return points;
            },
            projected(point, x, distance, prediction = 0) {
                const b = _stableBasis, dx = point[0] - x, y = point[1] - b.y;
                const z = Math.max(point[2], Math.min(0, point[2] + prediction * TS));
                const depth = distance - b.bx * dx - b.by * y - b.bz * z;
                const tangent = Math.tan(STABLE_CAMERA_FOV * Math.PI / 360);
                return { x: (b.rx * dx + b.rz * z) / (depth * tangent * cam.aspect),
                    y: (b.ux * dx + b.uy * y + b.uz * z) / (depth * tangent) - STABLE_CAMERA_SHIFT,
                    depth };
            },
            reset() { ++_stableCameraResetSerial; },
            changeSong() { _songKey += '-next'; bundle.notes = []; bundle.chords = []; },
        };
    `)();
}

function assertFits(h, points, fit, prediction = 0, margin = .90) {
    assert.ok(Number.isFinite(fit.x) && Number.isFinite(fit.distance));
    for (const point of points) {
        const p = h.projected(point, fit.x, fit.distance, prediction);
        assert.ok(p.depth >= .02 - 1e-7, JSON.stringify(p));
        assert.ok(Math.abs(p.x) <= margin + 1e-6, JSON.stringify(p));
        assert.ok(Math.abs(p.y) <= .90 + 1e-6, JSON.stringify(p));
    }
}

test('the fit solver frames both signs, both presets and narrow panes with finite results', () => {
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        for (const aspect of [.5, 8 / 9, 16 / 9, 32 / 9]) {
            const h = harness(); h.settings({ preset, lefty, aspect }); h.frame(0);
            const sign = lefty ? -1 : 1;
            const points = [[-110 * sign, -16, 0], [135 * sign, 63, -50],
                [28 * sign, 6, -650], [-80 * sign, 30, -240]];
            h.setPoints(points);
            for (const prediction of [0, .7, 1.2]) {
                const fit = h.solve(30 * sign, 100, prediction);
                assertFits(h, points, fit, prediction);
                const interval = h.interval(fit.distance, prediction);
                assert.equal(interval.valid, true);
                assert.ok(fit.x >= interval.min - 1e-6 && fit.x <= interval.max + 1e-6);
            }
        }
    }
});

test('fitting keeps an already feasible center and widens rather than moving a fixed center', () => {
    const h = harness(); h.frame(0);
    h.setPoints([[20, 13, 0], [40, 13, -10]]);
    const ordinary = h.solve(30, 100);
    assert.deepEqual(ordinary, { x: 30, distance: 100 });
    const points = [[-220, -15, 0], [220, 70, 0]];
    h.setPoints(points);
    const fixed = h.solve(-40, 100, 0, .9, true);
    assert.equal(fixed.x, -40);
    assert.ok(fixed.distance > 100);
    assertFits(h, points, fixed);
});

test('nearby large label corners remain in the collector and fit at their true positive depth', () => {
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        const h = harness(); h.settings({ preset, lefty }); h.frame(0);
        const size = 5.95 * 1.5;
        for (const centerY of [.5, 1]) {
            const points = h.spritePoints({ x: lefty ? -160 : 160, y: -2.6, z: .5, size, centerY });
            assert.ok(points.length > 0);
            const bottom = -2.6 - centerY * size * Math.cos(25 * Math.PI / 180);
            assert.ok(Math.abs(Math.min(...points.map(p => p[1])) - bottom) < 1e-8,
                'camera-facing bottom corners must not disappear past the play line');
            assert.ok(Math.max(...points.map(p => p[2])) > 2,
                'fixture exercises the old two-K collector cutoff');
            h.setPoints(points);
            for (const prediction of [0, 1.2]) {
                assertFits(h, points, h.solve(0, 100, prediction), prediction);
            }
        }
    }
});

test('an empty chart gets a finite resting camera without requiring chart anchors', () => {
    const h = harness(), s = h.frame(0);
    assert.equal(s.initialized, true);
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.distance));
    const held = h.frame(1, 1);
    assert.equal(held.x, s.x); assert.equal(held.distance, s.distance);
});

test('pause holds the exact camera pose even when newly received geometry changes', () => {
    const h = harness(); h.setPoints([[20, 13, 0]]);
    const initial = h.frame(1);
    h.setPoints([[190, 40, 0]]);
    for (let i = 0; i < 20; i++) {
        const paused = h.frame(1, .1, false);
        assert.equal(paused.x, initial.x); assert.equal(paused.distance, initial.distance);
    }
});

test('follow off preserves pose across playing and seeking until an explicit reset', () => {
    const h = harness(); h.setPoints([[20, 13, 0]]);
    const initial = h.frame(1);
    h.settings({ follow: false }); h.setPoints([[190, 40, 0]]);
    for (const time of [1.1, 1.2, 8, 2]) {
        const fixed = h.frame(time, .1);
        assert.equal(fixed.x, initial.x); assert.equal(fixed.distance, initial.distance);
    }
    h.reset();
    const reset = h.frame(2, 1 / 60, false);
    assert.notEqual(reset.x, initial.x);
    assertFits(h, [[190, 40, 0]], { x: reset.x, distance: reset.distance });
});

test('following seeks reframe once and a changed song frames its own geometry', () => {
    const h = harness(); h.setPoints([[20, 13, 0]]); h.frame(1);
    const points = [[190, 40, 0], [210, 7, -20]]; h.setPoints(points);
    const seek = h.frame(8, 1 / 60);
    assertFits(h, points, { x: seek.x, distance: seek.distance });
    const paused = h.frame(8, .1, false);
    assert.equal(paused.x, seek.x); assert.equal(paused.distance, seek.distance);
    h.changeSong(); h.setPoints([[-100, 13, 0]]);
    const song = h.frame(0, 1 / 60, false);
    assert.ok(song.x < 0);
});

test('resize protects geometry while preserving the fixed horizontal center', () => {
    const h = harness(); h.setPoints([[0, 13, 0], [60, 13, 0]]);
    const initial = h.frame(1); h.settings({ follow: false, aspect: .5 });
    const resized = h.frame(1, 1 / 60, false);
    assert.equal(resized.x, initial.x);
    assertFits(h, [[0, 13, 0], [60, 13, 0]], { x: resized.x, distance: resized.distance });
});

test('pan damping follows elapsed time rather than rendered frame count', () => {
    const results = [];
    for (const fps of [10, 30, 60, 120]) {
        const h = harness(); h.setPoints([[0, 13, 0]]); h.frame(0, 0);
        h.setPoints([[75, 13, 0]]);
        let state;
        for (let i = 1; i <= fps; i++) state = h.frame(i / fps, 1 / fps);
        assert.equal(state.correction, false);
        results.push(state.x);
    }
    assert.ok(results[0] > 0, 'the fixture exercises real camera movement');
    assert.ok(Math.max(...results) - Math.min(...results) < 1e-8, JSON.stringify(results));
});

test('the undamped safety guard fits a sudden nearby note when following', () => {
    const h = harness(); h.setPoints([[0, 13, 0]]); h.frame(0, 0);
    const points = [[-240, -18, 0], [240, 100, 0]];
    h.setPoints(points);
    const state = h.frame(.1, .1);
    assert.equal(state.correction, true);
    assertFits(h, points, { x: state.x, distance: state.distance }, 0, .92);
});
