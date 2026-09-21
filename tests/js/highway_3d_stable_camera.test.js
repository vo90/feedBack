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
        let wall = 0, fixturePoints = [], focusFixture = null, curX = 60;
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
        // Resolver behavior is covered separately; these fixtures isolate the
        // controller's primary-focus versus secondary-visibility priorities.
        function stablePlayingFocus() {
            if (focusFixture) return focusFixture;
            const minX = Math.min(...fixturePoints.map(p => p[0]));
            const maxX = Math.max(...fixturePoints.map(p => p[0]));
            return { valid: fixturePoints.length > 0, x: (minX + maxX) / 2, minX, maxX };
        }
        function stableApplyPose() { curX = _stableCam.x; }
        const bundle = { currentTime: 0, isPlaying: true, notes: [], chords: [] };
        return {
            setPoints(points) { fixturePoints = points; },
            setFocus(x, minX = x, maxX = x) { focusFixture = {valid:true,x,minX,maxX}; },
            silence() { focusFixture = {valid:false,x:0,minX:Infinity,maxX:-Infinity}; },
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


function advanceCamera(h, start, seconds, fps = 60) {
    let state;
    for (let i = 1; i <= Math.round(seconds * fps); i++) {
        state = h.frame(start + i / fps, 1 / fps);
    }
    return state;
}

function assertSameComposition(actual, direct, context) {
    // The harness uses K=1 and five-unit gems. Half a unit of lateral
    // residual is a tenth of a gem, not the forty-unit bias in the report.
    assert.ok(Math.abs(actual.x - direct.x) < .5,
        `${context}: x=${actual.x}, direct=${direct.x}`);
    assert.ok(Math.abs(actual.distance - direct.distance) < .15,
        `${context}: distance=${actual.distance}, direct=${direct.distance}`);
}

test('returning to a passage settles to its direct view across presets, handedness and frame rates', () => {
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        const results = [];
        const sign = lefty ? -1 : 1;
        const original = [[10 * sign, 13, 0], [30 * sign, 13, 0]];
        const excursion = [[110 * sign, 13, 0], [130 * sign, 13, 0]];
        for (const fps of [10, 20, 60]) {
            const h = harness(); h.settings({ preset, lefty });
            h.setPoints(original); const initial = h.frame(0, 0);
            h.setPoints(excursion);
            const moved = advanceCamera(h, 0, 3, fps);
            assert.ok(Math.abs(moved.x - initial.x) > 15,
                `${preset}/${lefty}/${fps}: fixture must cause real horizontal movement`);
            h.setPoints(original);
            const returned = advanceCamera(h, 3, 8, fps);
            const direct = harness(); direct.settings({ preset, lefty });
            direct.setPoints(original);
            assertSameComposition(returned, direct.frame(11, 0), `${preset}/${lefty}/${fps}`);
            results.push(returned.x);
        }
        assert.ok(Math.max(...results) - Math.min(...results) < .1,
            `${preset}/${lefty}: settled composition depends on frame rate: ${results}`);
    }
});

test('repeated passages do not retain bias from successive left and right excursions', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset });
        const original = [[10, 13, 0], [30, 13, 0]];
        h.setPoints(original); const initial = h.frame(0, 0);
        let time = 0;
        for (const centre of [120, -80, 160, -110, 120]) {
            h.setPoints([[centre - 10, 13, 0], [centre + 10, 13, 0]]);
            advanceCamera(h, time, 3, 20); time += 3;
            h.setPoints(original);
            const returned = advanceCamera(h, time, 8, 20); time += 8;
            assertSameComposition(returned, initial, `${preset}, excursion ${centre}`);
        }
    }
});

test('small geometry fluctuations do not make a settled camera chase individual notes', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset });
        h.setPoints([[10, 13, 0], [30, 13, 0]]);
        const initial = h.frame(0, 0);
        let maxPan = 0, maxZoom = 0;
        for (let i = 1; i <= 600; i++) {
            const shift = Math.sin(i / 15) * .35;
            h.setPoints([[10 + shift, 13, 0], [30 + shift, 13, 0]]);
            const state = h.frame(i / 60, 1 / 60);
            maxPan = Math.max(maxPan, Math.abs(state.x - initial.x));
            maxZoom = Math.max(maxZoom, Math.abs(state.distance - initial.distance));
        }
        assert.ok(maxPan < .05, `${preset}: tiny note changes moved the camera by ${maxPan}`);
        assert.ok(maxZoom < .05, `${preset}: tiny note changes changed zoom by ${maxZoom}`);
    }
});

test('silence, pause and follow-off hold an unfinished return without preventing later settling', () => {
    const original = [[10, 13, 0], [30, 13, 0]];
    for (const hold of ['silence', 'pause', 'follow-off']) {
        const h = harness(); h.setPoints(original);
        const initial = h.frame(0, 0);
        h.setPoints([[110, 13, 0], [130, 13, 0]]);
        advanceCamera(h, 0, 3);
        h.setPoints(original);
        const settling = advanceCamera(h, 3, .75);
        if (hold === 'silence') h.setPoints([]);
        if (hold === 'follow-off') h.settings({ follow: false });
        let time = 3.75;
        for (let i = 0; i < 180; i++) {
            if (hold !== 'pause') time += 1 / 60;
            const held = h.frame(time, 1 / 60, hold !== 'pause');
            assert.equal(held.x, settling.x, `${hold}: horizontal following must remain frozen`);
            assert.equal(held.distance, settling.distance, `${hold}: zoom must remain frozen`);
        }
        h.setPoints(original); h.settings({ follow: true });
        const returned = advanceCamera(h, time, 8);
        assertSameComposition(returned, initial, hold);
    }
});

test('zoom closes a residual below three percent instead of keeping an inherited wider view', () => {
    const normal = [[-70.5, 13, 0], [70.5, 13, 0]];
    for (const fps of [10, 20, 60]) {
        const h = harness();
        h.setPoints([[-72.5, 13, 0], [72.5, 13, 0]]);
        const wider = h.frame(0, 0);
        const direct = harness(); direct.setPoints(normal);
        const expected = direct.frame(8, 0);
        assert.ok(wider.distance > expected.distance + 1, 'fixture needs a visible zoom difference');
        assert.ok((wider.distance - expected.distance) / wider.distance < .03,
            'fixture must exercise the old three-percent stopping condition');
        h.setPoints(normal);
        const settled = advanceCamera(h, 0, 8, fps);
        assertSameComposition(settled, expected, `zoom at ${fps} FPS`);
    }
});

test('a distant note that fits does not change the primary playing composition', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset });
        h.setFocus(20); h.setPoints([[20, 13, 0]]);
        const original = h.frame(0, 0);
        h.setPoints([[20, 13, 0], [120, 13, -2.8 * 230]]);
        const moved = advanceCamera(h, 0, 3, 20);
        assert.equal(moved.x, original.x, 'future geometry must not steal primary centre');
        assert.equal(moved.distance, original.distance, 'both groups already fit');
        h.reset();
        const direct = h.frame(3, 0);
        assert.equal(direct.x, original.x, 'direct opening uses the same primary position');
    }
});

test('changing distant extrema cannot block return to the current group', () => {
    const h = harness(); h.setFocus(70); h.setPoints([[70, 13, 0]]); h.frame(0, 0);
    h.setFocus(20);
    for (let i = 1; i <= 240; i++) {
        const futureX = Math.floor(i / 18) % 2 ? 120 : 150;
        h.setPoints([[20, 13, 0], [futureX, 13, -2.8 * 230]]);
        h.frame(i / 60, 1 / 60);
    }
    const settled = h.frame(4, 0);
    assert.ok(Math.abs(settled.x - 20) < .1, JSON.stringify(settled));
    assert.equal(settled.distance, 100);
    assert.ok(settled.quietPanTime > 3, 'secondary changes must not restart primary dwell');
});

test('necessary secondary widening preserves the primary centre', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset }); h.setFocus(20);
        const points = [[20, 13, 0], [300, 13, -30]];
        h.setPoints(points); const s = h.frame(0, 0);
        assert.equal(s.x, 20, 'minimum zoom must not take precedence over musical focus');
        assert.ok(s.distance > 100);
        assertFits(h, points, s, .35, .68);
    }
});

test('a medium position change does not stop inside the comfort band before settling', () => {
    const final = [];
    for (const fps of [10, 20, 60, 120]) {
        const h = harness(); h.setPoints([[0, 13, 0]]); h.setFocus(0); h.frame(0, 0);
        h.setPoints([[20, 13, 0]]); h.setFocus(20);
        let previous = 0, state;
        for (let i = 1; i <= fps; i++) {
            state = h.frame(i / fps, 1 / fps);
            assert.ok(state.x > previous, `${fps} FPS: pan stopped at ${i / fps}s`);
            previous = state.x;
        }
        final.push(state.x);
    }
    assert.ok(Math.max(...final) - Math.min(...final) < 1e-8, JSON.stringify(final));
});

test('a distant entry stays visible during silence without taking over the held centre', () => {
    const h = harness(); h.settings({aspect:.5}); h.setFocus(20);
    h.setPoints([[20,13,0]]); const initial = h.frame(0, 0);
    h.silence(); const entry = [[190,13,-230]]; h.setPoints(entry);
    const rest = h.frame(.1, .1);
    assert.equal(rest.x, initial.x, 'silence holds the playing position');
    assert.ok(rest.distance > initial.distance, 'an off-axis entry needs more room');
    assertFits(h, entry, rest, 0, .92);
    h.frame(.1, .1, false);
    const paused = h.frame(.1, 2, false);
    assert.equal(paused.distance, rest.distance, 'paused previews do not change pose');
});
