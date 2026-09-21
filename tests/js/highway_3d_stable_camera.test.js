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
        let wall = 0, fixturePoints = [], regionFixture = null, regionRows = null, lastRegionTime = NaN, curX = 60;
        const S_GAP = 4, NH = 3, _textSizeMul = 1, _frameNow = 0;
        const pNote = null, pSus = null, pSusRibbon = null, pChordBox = null,
            pRsChordFrame = null, pArpBracket = null, pSusRail = null, pTechPlane = null;
        const _incomingFloorLabelCount = 0, _incomingFloorLabels = [];
        let _incomingFixedFretLabels = {};
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
        ${extractFunction('stableCollectGeometry').replace('function stableCollectGeometry(', 'function collectRealRegionGeometry(')}
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
        // controller's playing-area target from secondary note geometry.
        function stablePlayingRegion(bundle, renderTime) {
            lastRegionTime = renderTime;
            if (regionRows?.length) {
                let region = regionRows[0];
                for (const row of regionRows) if (row.time <= renderTime) region = row;
                return region;
            }
            if (regionFixture) return regionFixture;
            const minX = Math.min(...fixturePoints.map(p => p[0]));
            const maxX = Math.max(...fixturePoints.map(p => p[0]));
            return { valid: fixturePoints.length > 0, x: (minX + maxX) / 2, minX, maxX,
                dMin: minX / 10, dMax: maxX / 10, time: 0, source: 'fixture', row: null };
        }
        function stableApplyPose() { curX = _stableCam.x; }
        const bundle = { currentTime: 0, isPlaying: true, notes: [], chords: [], anchors: [] };
        return {
            setPoints(points) { fixturePoints = points; },
            setRegion(minX, maxX, time = 0) {
                regionFixture = { valid: true, x: (minX + maxX) / 2, minX, maxX,
                    dMin: minX / 10, dMax: maxX / 10, time, source: 'anchor',
                    row: { time, dMin: minX / 10, dMax: maxX / 10 } };
            },
            setRegionTimeline(rows) {
                regionRows = rows.map(({time,minX,maxX}) => ({valid:true,time,minX,maxX,x:(minX+maxX)/2,
                    dMin:minX/10,dMax:maxX/10,source:'anchor',row:null}));
            },
            regionLookupTime() { return lastRegionTime; },
            setFocus(x, minX = x, maxX = x) {
                regionFixture = {valid:true,x,minX,maxX,dMin:minX/10,dMax:maxX/10,time:0,source:'fixture',row:null};
            },
            noRegion() { regionFixture = {valid:false,x:0,minX:Infinity,maxX:-Infinity,time:0,row:null}; },
            replaceAnchors(rows = []) { bundle.anchors = rows; },
            appendAnchor(row) { bundle.anchors.push(row); },
            settings(values) {
                if ('follow' in values) stableCameraFollow = values.follow;
                if ('preset' in values) stableCameraPreset = values.preset;
                if ('lefty' in values) _leftyCached = values.lefty;
                if ('aspect' in values) cam.aspect = values.aspect;
                if ('strings' in values) nStr = values.strings;
                if ('pan' in values) cameraSmoothing = values.pan;
                if ('rate' in values) bundle.playbackRate = values.rate;
            },
            frame(time, elapsed = 1 / 60, playing = true, frameTime) {
                wall += elapsed; bundle.currentTime = time; bundle.isPlaying = playing;
                stableCamUpdate(bundle, frameTime); return { ..._stableCam };
            },
            solve(x, distance, prediction = 0, margin = .90, fixed = false) {
                stableCollectGeometry(); return { ...stableSolve(x, distance, prediction, margin, fixed) };
            },
            interval(distance, prediction = 0, margin = .90, fixed = null) {
                stableCollectGeometry(); return { ...stableIntervalAt(distance, prediction, margin, fixed) };
            },
            collectRegion(region, labels = []) {
                _incomingFixedFretLabels = {};
                for (const {fret, x, y, z, size} of labels) {
                    _incomingFixedFretLabels[fret] = { visible: true, isSprite: true, userData: {},
                        material: {opacity: 1}, center: {x: .5, y: 1}, updateWorldMatrix() {},
                        matrixWorld: {elements: [size,0,0,0,0,size,0,0,0,0,1,0,x,y,z,1]} };
                }
                collectRealRegionGeometry(region);
                const points = [];
                for (let i = 0; i < _stableCam.pointCount; i += 3) {
                    points.push(Array.from(_stablePoints.slice(i, i + 3)));
                }
                return points;
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
            changeSong() { _songKey += '-next'; bundle.notes = []; bundle.chords = []; bundle.anchors = []; },
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
    for (const fps of [10, 20, 60, 120]) {
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

test('small geometry fluctuations inside an unchanged area do not move a settled camera', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset }); h.setRegion(10, 30);
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

test('pause and follow-off hold an unfinished return without preventing later settling', () => {
    const original = [[10, 13, 0], [30, 13, 0]];
    for (const hold of ['pause', 'follow-off']) {
        const h = harness(); h.setPoints(original);
        const initial = h.frame(0, 0);
        h.setPoints([[110, 13, 0], [130, 13, 0]]);
        advanceCamera(h, 0, 3);
        h.setPoints(original);
        const settling = advanceCamera(h, 3, .75);
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
    h.noRegion(); const entry = [[190,13,-230]]; h.setPoints(entry);
    const rest = h.frame(.1, .1);
    assert.equal(rest.x, initial.x, 'silence holds the playing position');
    assert.ok(rest.distance > initial.distance, 'an off-axis entry needs more room');
    assertFits(h, entry, rest, 0, .92);
    h.frame(.1, .1, false);
    const paused = h.frame(.1, 2, false);
    assert.equal(paused.distance, rest.distance, 'paused previews do not change pose');
});

test('open strings, fretted notes and chords within one playing area leave the camera steady', () => {
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        const sign = lefty ? -1 : 1;
        const h = harness(); h.settings({ preset, lefty });
        h.setRegion(Math.min(20 * sign, 50 * sign), Math.max(20 * sign, 50 * sign));
        h.setPoints([[35 * sign, 13, 0]]);
        const initial = h.frame(0, 0);
        const passages = [
            [[20 * sign, 13, 0]],
            [[20 * sign, 23, 0], [50 * sign, 23, 0]], // open-string lane rail
            [[20 * sign, 19, 0], [40 * sign, 15, 0]], // fretted chord
            [[50 * sign, 7, 0]],
            [], // no attack between strokes
        ];
        for (let i = 1; i <= 600; i++) {
            h.setPoints(passages[Math.floor(i / 6) % passages.length]);
            const state = h.frame(i / 60, 1 / 60);
            assert.equal(state.x, initial.x, `${preset}/${lefty}: attack ${i} moved the camera`);
            assert.equal(state.targetX, initial.targetX);
            assert.equal(state.distance, initial.distance, 'ordinary lane contents do not pulse the zoom');
        }
    }
});

test('a disjoint playing-area change follows during a rest and settles without waiting for a note', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset }); h.setRegion(20, 50); h.setPoints([]);
        const original = h.frame(108.7, 0);
        h.setRegion(100, 130, 108.72);
        const first = h.frame(108.75, .05);
        assert.ok(first.x > original.x, 'the current chart area immediately starts a smooth move');
        assert.ok(first.x < 115, 'ordinary playback must not snap to the new area');
        const settled = advanceCamera(h, 108.75, 1, 60);
        assert.ok(Math.abs(settled.x - 115) < Math.abs(original.x - 115) * .05,
            `${preset}: after one second camera is not 95% settled: ${settled.x}`);
        assert.equal(settled.focusValid, true, 'a current area remains valid without attacks');
        assert.equal(settled.focusX, 115);
    }
});

test('a currently marked area remains primary while upcoming geometry moves within another area', () => {
    const h = harness(); h.setRegion(20, 50); h.setPoints([]);
    const initial = h.frame(0, 0);
    for (let i = 1; i <= 120; i++) {
        h.setPoints([[110 + Math.sin(i) * 10, 13, -500]]);
        const state = h.frame(i / 60, 1 / 60);
        assert.equal(state.x, initial.x, 'future geometry must not anticipate the next chart position');
    }
    h.setRegion(100, 130, 2);
    assert.ok(h.frame(2.05, .05).x > initial.x, 'following starts at the effective area boundary');
});

test('equal-bounds markers do not restart a playing-area transition', () => {
    const h = harness(); h.setRegion(20, 50); h.frame(0, 0);
    h.setRegion(100, 130, 0);
    let previous = 35;
    for (let i = 1; i <= 120; i++) {
        h.setRegion(100, 130, i / 60);
        const state = h.frame(i / 60, 1 / 60);
        assert.ok(state.x > previous, `same bounds restarted or stopped transition at ${i / 60}s`);
        previous = state.x;
    }
    assert.ok(Math.abs(previous - 115) < .15);
});

test('a width-only playing-area change updates the preferred centre', () => {
    const h = harness(); h.setRegion(20, 50); h.frame(0, 0);
    h.setRegion(20, 80, .1);
    const state = advanceCamera(h, 0, 2, 60);
    assert.equal(state.focusX, 50);
    assert.ok(Math.abs(state.x - 50) < .1, JSON.stringify(state));
});

test('small overlapping areas get a short persistence delay only when the current view safely contains them', () => {
    const h = harness(); h.setRegion(20, 60); h.frame(0, 0);
    h.setRegion(25, 65, 0);
    assert.equal(h.frame(.1, .1).x, 40, 'brief adjacent area should not start a pan');
    assert.equal(h.frame(.2, .1).x, 40, 'delay is split at its exact boundary');
    const moved = h.frame(.3, .1);
    assert.ok(moved.x > 40 && moved.x < 45, 'persistent adjacent area begins a smooth pan after 0.2s');
    const settled = advanceCamera(h, .3, 2, 60);
    assert.ok(Math.abs(settled.x - 45) < .05);
});

test('a brief overlapping area that reverts before the delay does not cause a camera excursion', () => {
    const h = harness(); h.setRegion(20, 60); h.frame(0, 0);
    h.setRegion(25, 65, 0);
    assert.equal(h.frame(.1, .1).x, 40);
    h.setRegion(20, 60, .1);
    const returned = advanceCamera(h, .1, 1, 60);
    assert.equal(returned.x, 40);
});

test('continuing nearby region changes cannot perpetually postpone following', () => {
    const h = harness(); h.setRegion(20, 60); h.frame(0, 0);
    let state;
    for (let i = 1; i <= 10; i++) {
        h.setRegion(24 + i, 64 + i, i / 10);
        state = h.frame(i / 10, .1);
        if (i >= 4) assert.ok(state.x > 40, `area change ${i} restarted the persistence timer`);
    }
    assert.ok(state.x > 48, JSON.stringify(state));
});

test('disjoint changes and threatened visibility bypass the overlapping-area delay', () => {
    const disjoint = harness(); disjoint.setRegion(20, 60); disjoint.frame(0, 0);
    disjoint.setRegion(100, 140, 0);
    assert.ok(disjoint.frame(.05, .05).x > 40, 'disjoint transition begins on the first frame');

    const threatened = harness(); threatened.setRegion(20, 60); threatened.frame(0, 0);
    threatened.setRegion(25, 65, 0);
    const points = [[240, 13, 0]];
    threatened.setPoints(points);
    const state = threatened.frame(.05, .05);
    assert.ok(state.x > 40, 'secondary geometry outside the safe view bypasses the delay');
    assertFits(threatened, points, state, 0, .92);
});

test('playing-area transition and persistence use elapsed seconds consistently at 10 to 120 FPS', () => {
    for (const bounds of [[25, 65], [100, 140]]) {
        const states = [];
        for (const fps of [10, 20, 60, 120]) {
            const h = harness(); h.setRegion(20, 60); h.frame(0, 0);
            h.setRegion(...bounds);
            states.push(advanceCamera(h, 0, 1, fps));
        }
        const xs = states.map(state => state.x);
        assert.ok(Math.max(...xs) - Math.min(...xs) < 1e-8, `${bounds}: ${xs}`);
        assert.ok(Math.abs(xs[0] - (bounds[0] + bounds[1]) / 2) < 4,
            'one second must allow a visible transition to nearly finish');
    }
});

test('playback speed does not change the real-time playing-area damping', () => {
    const xs = [];
    for (const rate of [.5, 1, 1.5]) {
        const h = harness(); h.settings({ rate }); h.setRegion(20, 60); h.frame(0, 0);
        h.setRegion(100, 140);
        let state;
        for (let i = 1; i <= 60; i++) state = h.frame(i / 60 * rate, 1 / 60);
        xs.push(state.x);
    }
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1e-8, JSON.stringify(xs));
});

test('anchor-only replacement and streamed anchor counts invalidate the camera position', () => {
    for (const replace of [true, false]) {
        const h = harness(); h.setRegion(20, 50); h.frame(1, 0);
        h.setRegion(100, 130);
        if (replace) h.replaceAnchors([{ t: 0, fret: 10, width: 4 }]);
        else h.appendAnchor({ t: 0, fret: 10, width: 4 });
        const refreshed = h.frame(1, .1, false);
        assert.equal(refreshed.x, 115,
            `${replace ? 'replacement' : 'stream'}: new effective anchors must reset stale camera state`);
    }
});

test('seek resolves the playing area directly and uninterrupted playback converges to the same view', () => {
    for (const preset of ['straight', 'angled']) {
        const played = harness(); played.settings({ preset }); played.setRegion(20, 50); played.frame(0, 0);
        played.setRegion(100, 130, .1);
        const settled = advanceCamera(played, 0, 5, 60);
        const sought = harness(); sought.settings({ preset }); sought.setRegion(20, 50); sought.frame(0, 0);
        sought.setRegion(100, 130, .1);
        assertSameComposition(settled, sought.frame(5, 1 / 60), preset);
    }
});

test('the geometry collector protects an empty area and its gold numbers without collecting distant grey numbers', () => {
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        const sign = lefty ? -1 : 1;
        const h = harness(); h.settings({ preset, lefty, aspect: .5 }); h.frame(0, 0);
        const region = {valid: true, minX: Math.min(90 * sign, 130 * sign),
            maxX: Math.max(90 * sign, 130 * sign), dMin: 9, dMax: 13};
        const points = h.collectRegion(region, [
            {fret: 10, x: 100 * sign, y: -10, z: 0, size: 12},
            {fret: 24, x: 400 * sign, y: -10, z: 0, size: 12},
        ]);
        assert.ok(points.length > 0, 'an empty lane must still produce framing constraints');
        assert.ok(Math.min(...points.map(p => p[0])) <= region.minX - 3);
        assert.ok(Math.max(...points.map(p => p[0])) >= region.maxX + 3);
        assert.ok(Math.min(...points.map(p => p[1])) < -20, 'gold glyph bottom is part of the envelope');
        assert.ok(Math.max(...points.map(p => p[1])) >= 26, 'the top string and gem height are protected');
        assert.ok(points.every(p => Math.abs(p[0]) < 150), 'unrelated grey fret 24 must not widen the area');
        h.setPoints(points);
        const fit = h.solve(110 * sign, 100, 0, .68, true);
        assertFits(h, points, fit, 0, .68);
    }
});

test('the playing-area lookup crosses a boundary with the visible render clock before the next audio timestamp', () => {
    const h = harness();
    h.setRegionTimeline([{time:0,minX:20,maxX:50},{time:1,minX:100,maxX:130}]);
    const initial = h.frame(.989, 0, true, .992);
    assert.equal(initial.focusX, 35);
    const crossed = h.frame(.989, .016, true, 1.008);
    assert.equal(h.regionLookupTime(), 1.008, 'camera and rendered lane must resolve the same current area');
    assert.equal(crossed.focusX, 115, 'the visually current new lane is already the camera target');
    assert.ok(crossed.x > initial.x && crossed.x < 115, 'the boundary begins a smooth pan, not a seek snap');
    assert.equal(crossed.lastTime, .989, 'the audio time still controls seek and rate bookkeeping');
});

test('render-clock interpolation does not replace raw audio in playback-rate estimates', () => {
    const rendered = harness(), raw = harness();
    rendered.setRegion(20, 50); raw.setRegion(20, 50);
    rendered.frame(0, 0, true, .01); raw.frame(0, 0);
    for (let i = 1; i <= 120; i++) {
        const wallTime = i / 60;
        const audioTime = Math.floor(wallTime / .023) * .023;
        const interpolated = rendered.frame(audioTime, 1 / 60, true, wallTime + .01);
        const reference = raw.frame(audioTime, 1 / 60);
        assert.equal(interpolated.rate, reference.rate);
        assert.equal(interpolated.rateTime, reference.rateTime);
        assert.equal(interpolated.lastTime, audioTime);
        assert.equal(rendered.regionLookupTime(), wallTime + .01);
    }
});

test('a raw audio seek still snaps even if the supplied render clock changes only slightly', () => {
    const h = harness();
    h.setRegionTimeline([{time:0,minX:20,maxX:50},{time:1,minX:100,maxX:130}]);
    h.frame(5, 0, true, .99);
    const sought = h.frame(10, .016, true, 1.006);
    assert.equal(sought.x, 115, 'the five-second audio jump must retain seek semantics');
    assert.equal(h.regionLookupTime(), 1.006, 'the area itself still comes from the supplied render clock');
    assert.equal(sought.lastTime, 10);
    assert.equal(sought.rateTime, 10);
});

test('the stable camera update entry point forwards the shared floor render clock', () => {
    const run = new Function(`
        const cameraMode = 'stable', _frameNow = 108.735;
        let call;
        function stableCamUpdate(bundle, frameTime) { call = {bundle, frameTime}; }
        ${extractFunction('camUpdate')}
        return bundle => { camUpdate(bundle); return call; };
    `)();
    const bundle = {currentTime:108.719,isPlaying:true};
    const call = run(bundle);
    assert.equal(call.bundle, bundle);
    assert.equal(call.frameTime, 108.735);
});
