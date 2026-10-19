const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { source, extractFunction, harness } = require('../helpers/highway_camera_harness.cjs');

const cameraFrameDtSelection = `// Share the normal visual frame interval, but retain wall timing
            // for every clock fallback and all freshness/rate/seek bookkeeping.
            const frameDt = bundle.transport ? _presentationClock.frameMotionDelta() : NaN;
            const dt = Number.isFinite(frameDt) && frameDt > 0 ? frameDt : Math.min(0.25, elapsed);`;
const wallCameraSource = source.replace(cameraFrameDtSelection, 'const dt = Math.min(0.25, elapsed);');

test('camera retains exact wall-clamped behavior on every clock fallback and legacy transport', () => {
    const cases = [
        ['absent', 20, undefined, {}], ['invalid', 20, NaN, {}],
        ['repeated', 20, 110, {}], ['backward', 20, 100, {}],
        ['origin jump', 20, 220, {}], ['long frame', 20, 400, {}],
        ['wall stall', 400, 500, {}], ['rate', 20, 120, {rate: 2}],
        ['generation', 20, 120, {generation: 2}], ['epoch/seek', 20, 120, {epoch: 2}],
        ['stale', 20, 120, {freshAt: -250}], ['end clamp', 20, 120, {endTime: 10.015}],
        ['legacy', 20, 120, {transport: null}], ['reset', 20, 120, {}],
        ...['paused', 'count-in', 'rewind', 'buffering', 'seeking', 'ended']
            .map(state => [state, 20, 120, {state}]),
    ];
    for (const preset of ['straight', 'angled']) for (const [name, wall, stamp, options] of cases) {
        const current = harness(), old = harness(wallCameraSource);
        for (const h of [current, old]) {
            h.settings({preset, rate: 1}); h.setRegion(20, 60);
            h.clockFrame(10, 0, 100); h.clockFrame(10.01, 10, 110);
            h.setRegion(100, 140);
            if (name === 'reset') h.resetClock();
        }
        const a = current.clockFrame(10.02, wall, stamp, options);
        const b = old.clockFrame(10.02, wall, stamp, options);
        assert.deepEqual(a, b, `${preset}/${name}`);
        assert.deepEqual(current.renderedPose(), old.renderedPose(), `${preset}/${name}: pose`);
        if (name !== 'legacy') assert.ok(Number.isNaN(a.motionDt), name);
    }
});

test('stable camera rejoin, safety, zoom and rest widening follow the same frame grid under callback jitter', () => {
    // Isolate damping from the clock's intentional audio phase correction:
    // sample the real clock, but supply identical already-rendered chart times.
    const scenarios = {
        settled(h, i) { if (!i) { h.setRegion(20, 60); h.setPoints([[20,13,0],[60,13,0]]); } },
        rejoin(h, i) { if (!i) h.setRegion(20, 60); if (i === 100) h.setRegion(100, 140); },
        safety(h, i) {
            if (!i) h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:55,maxX:95}]);
            if (i === 100) h.setPoints([[150,13,0]]);
            if (i === 140) h.setPoints([]);
        },
        zoom(h, i) {
            if (!i) { h.setRegion(20, 60); h.setPoints([[-240,-18,0],[240,100,0]]); }
            if (i === 100) h.setPoints([[20,13,0],[60,13,0]]);
        },
        rest(h, i) {
            if (!i) { h.noRegion(); h.setPoints([[20,13,0],[60,13,0]]); }
            if (i === 100) h.setPoints([[200,100,0]]);
        },
    };
    for (const preset of ['straight', 'angled']) for (const rate of [.5, 1, 2]) {
        for (const [name, setup] of Object.entries(scenarios)) {
            const uniform = harness(), jittered = harness(), old = harness(wallCameraSource);
            for (const h of [uniform, jittered, old]) {
                h.settings({preset, rate, aspect: 3440/1420}); setup(h, 0);
                h.clockFrame(0, 0, 100, {rate}, 0);
            }
            for (let i = 1; i <= 200; ++i) {
                const grid = i * 10, wall = grid + (i % 2 ? 3 : 0);
                for (const h of [uniform, jittered, old]) setup(h, i);
                uniform.clockFrame(grid/1000*rate, grid, grid+100, {rate}, grid/1000*rate);
                const b = jittered.clockFrame(wall/1000*rate, wall, grid+100, {rate}, grid/1000*rate);
                const c = old.clockFrame(wall/1000*rate, wall, grid+100, {rate}, grid/1000*rate);
                assert.equal(b.motionDt, .01);
                assert.deepEqual(jittered.renderedPose(), uniform.renderedPose(), `${preset}/${rate}/${name}/${i}`);
                for (const field of ['lastWall', 'lastTime', 'rateWall', 'rateTime', 'rate', 'epoch', 'clockReset']) {
                    assert.equal(b.state[field], c.state[field], `wall bookkeeping ${field}`);
                }
            }
            // The finite camera trajectory itself is independent of frame dt.
            // Its lifecycle correction no longer has an old wall-damped path
            // that is required to disagree with the presentation-clock path.
        }
    }
});

test('uniform and dropped-frame clocks bound decimal rounding at the zoom quiet-time threshold', () => {
    function project(pose) {
        const dot = (a,b) => a.reduce((sum,n,i) => sum+n*b[i], 0);
        const norm = a => { const n = Math.hypot(...a); return a.map(v => v/n); };
        const forward = norm(pose.target.map((n,i) => n-pose.position[i]));
        const right = norm([-forward[2],0,forward[0]]);
        const up = [right[1]*forward[2]-right[2]*forward[1],
            right[2]*forward[0]-right[0]*forward[2], right[0]*forward[1]-right[1]*forward[0]];
        const relative = [40,13,0].map((n,i) => n-pose.position[i]);
        // Project one common world point at 1420px height. The unchanged lens
        // shift cancels in this same-preset comparison.
        const scale = 1420/2/(dot(relative,forward)*Math.tan(pose.fov*Math.PI/360));
        return [dot(relative,right)*scale, -dot(relative,up)*scale];
    }
    for (const preset of ['straight', 'angled']) for (const intervalMs of [10, 15.625]) {
        const current = harness(), old = harness(wallCameraSource);
        for (const h of [current, old]) {
            h.settings({preset, rate: 1}); h.setRegion(20, 60);
            h.setPoints([[-100,13,0],[150,13,0]]);
        }
        let wallMs = 0;
        for (let i = 0; i < 300; ++i) {
            if (i) wallMs += intervalMs * (i % 30 ? 1 : 3);
            for (const h of [current, old]) {
                if (i === 60) h.setRegion(100, 140);
                if (i === 100) h.setPoints([]);
                h.clockFrame(wallMs/1000, wallMs, wallMs+100);
            }
            const a = current.renderedPose(), b = old.renderedPose();
            // Summed .01 intervals and wall subtraction can lie on opposite
            // sides of .5 by a rounding error. They must take the same quiet
            // return branch rather than gain a whole extra outward frame.
            for (const key of ['position', 'target']) for (let j = 0; j < 3; ++j) {
                assert.ok(Math.abs(a[key][j]-b[key][j]) < .002, `${preset}/${intervalMs}/${i}/${key}/${j}`);
            }
            const pa = project(a), pb = project(b);
            assert.ok(Math.hypot(pa[0]-pb[0],pa[1]-pb[1]) < .01, `${preset}/${intervalMs}/${i}: pixels`);
            if (intervalMs === 15.625) assert.deepEqual(a, b, 'binary-exact uniform interval');
        }
    }
});

test('camera keeps first-frame and recovery fallback independent across renderer instances', () => {
    const a = harness(), b = harness(), wall = harness(wallCameraSource);
    for (const h of [a, b, wall]) { h.settings({rate: 1}); h.setRegion(20, 60); }
    assert.deepEqual(a.clockFrame(10, 0, 100), wall.clockFrame(10, 0, 100));
    b.clockFrame(10, 0, 100);
    for (const h of [a, b, wall]) h.clockFrame(10.01, 10, 110);
    for (const h of [a, b, wall]) h.setRegion(100, 140);
    a.resetClock(); wall.resetClock();
    assert.deepEqual(a.clockFrame(10.02, 23, 120), wall.clockFrame(10.02, 23, 120));
    assert.equal(b.clockFrame(10.02, 23, 120).motionDt, .01);
    for (const [time, wallMs, stamp, options] of [
        [10.4, 400, 500, {freshAt: 0}],
        [10.41, 410, 510, {}],
    ]) {
        const current = a.clockFrame(time, wallMs, stamp, options);
        assert.deepEqual(current, wall.clockFrame(time, wallMs, stamp, options));
        assert.ok(Number.isNaN(current.motionDt));
    }
    assert.equal(a.clockFrame(10.42, 420, 520).motionDt, .01);
});

test('explicit transport epoch prevents raw correction from snapping the stable camera', () => {
    const h = harness();
    h.setPoints([[30, 3, 0], [60, 23, 0]]);
    h.settings({epoch: 1});
    h.frame(10, 1 / 60, true, 10);
    const corrected = h.frame(9.9, 1 / 60, true, 10.016);
    assert.equal(corrected.clockReset, false);
    assert.equal(h.regionLookupTime(), 10.016);
    h.settings({epoch: 2});
    assert.equal(h.frame(10.015, 1 / 60, true, 10.015).clockReset, true);
});

function assertFits(h, points, fit, prediction = 0, margin = .90) {
    assert.ok(Number.isFinite(fit.x) && Number.isFinite(fit.distance));
    for (const point of points) {
        const p = h.projected(point, fit.x, fit.distance, prediction);
        assert.ok(p.depth >= .02 - 1e-7, JSON.stringify(p));
        assert.ok(Math.abs(p.x) <= margin + 1e-6, JSON.stringify(p));
        assert.ok(Math.abs(p.y) <= Math.max(.90, margin) + 1e-6, JSON.stringify(p));
    }
}

test('built-in viewpoints reproduce the saved standard views without Camera Director', () => {
    // Archived preset values, independent of the production preset table.
    for (const [preset, zoom, pitch, panX, panY] of [
        ['straight', .87, 9, 0, 10], ['angled', .9, -1, -4, 3],
    ]) for (const lefty of [false, true]) {
        const h = harness(); h.settings({preset, lefty});
        const state = h.frame(0, 0);
        const pose = h.renderedPose();
        const sign = lefty ? -1 : 1;
        const angle = 25 * Math.PI / 180 - Math.atan(pitch / 100);
        const yaw = preset === 'angled' ? sign * 14 * Math.PI / 180 : 0;
        const radius = state.distance * zoom;
        assert.deepEqual(pose.target, [state.x + panX * sign, 13 + panY, 0]);
        const expected = [pose.target[0] + radius * Math.cos(angle) * Math.sin(yaw),
            pose.target[1] + radius * Math.sin(angle), radius * Math.cos(angle) * Math.cos(yaw)];
        expected.forEach((v, i) => assert.ok(Math.abs(pose.position[i] - v) < 1e-10));
        assert.equal(pose.fov, 60);
        assert.deepEqual(h.renderedPose({enabled:false,distMul:2,pitch:50}), pose);
        const neutral = h.renderedPose({enabled:true,distMul:1,heightMul:1});
        neutral.position.forEach((v,i) => assert.ok(Math.abs(v-pose.position[i]) < 1e-10,
            'neutral Free camera must not apply the built-in preset twice'));
        assert.deepEqual(neutral.target,pose.target);
        const bridge = {enabled:true,distMul:1.2,heightMul:1,pitch:4,panX:5,panY:-2};
        const before = {...bridge}, adjusted = h.renderedPose(bridge);
        assert.deepEqual(bridge, before, 'saved Free camera state remains untouched');
        assert.deepEqual(adjusted.target, [pose.target[0]+5,pose.target[1]-2,0]);
        const delta = adjusted.position.map((v,i) => v-adjusted.target[i]);
        assert.ok(Math.abs(Math.hypot(...delta) - radius*1.2) < 1e-10);
        assert.ok(Math.abs(Math.atan2(delta[1], Math.hypot(delta[0],delta[2]))
            - (angle-Math.atan(.04))) < 1e-10);
    }
});

test('the closer calibrated views protect visible geometry on reset, resize and playback', () => {
    for (const preset of ['straight','angled']) for (const lefty of [false,true]) {
        const h = harness(); h.settings({preset,lefty}); h.setRegion(0,40);
        const points = [[-80,-5,0],[150,35,0],[0,15,-100]];
        h.setPoints(points);
        const opening = h.frame(0,0);
        for (const p of points) assert.ok(h.viewFits(p,opening));
        h.settings({aspect:.5}); const resized = h.frame(0,.016,false);
        assert.equal(resized.x,opening.x);
        for (const p of points) assert.ok(h.viewFits(p,resized));
        const played = h.frame(.05,.05);
        for (const p of points) assert.ok(h.viewFits(p,played));
        h.settings({follow:false});
        const held = h.frame(20,.016), pose = h.renderedPose();
        h.setPoints([[-600,-30,0],[600,70,0]]);
        assert.deepEqual(h.frame(21,.016).distance,held.distance);
        assert.deepEqual(h.renderedPose(),pose,'Follow off keeps the calibrated pose');
    }
});

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
            const pitch = 25 * Math.PI / 180 - Math.atan2(preset === 'straight' ? 9 : -1, 100);
            const bottom = -2.6 - centerY * size * Math.cos(pitch);
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
    assertFits(h, points, { x: state.x, distance: state.distance }, 0, .96);
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
    const normal = [[-90.5, 13, 0], [90.5, 13, 0]];
    for (const fps of [10, 20, 60]) {
        const h = harness();
        h.setPoints([[-92.5, 13, 0], [92.5, 13, 0]]);
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
    const reference = harness(); reference.setFocus(20); reference.setPoints([[20, 13, 0]]);
    const expected = reference.frame(0, 0);
    const h = harness(); h.setFocus(70); h.setPoints([[70, 13, 0]]); h.frame(0, 0);
    h.setFocus(20);
    for (let i = 1; i <= 240; i++) {
        const futureX = Math.floor(i / 18) % 2 ? 120 : 150;
        h.setPoints([[20, 13, 0], [futureX, 13, -2.8 * 230]]);
        h.frame(i / 60, 1 / 60);
    }
    const settled = h.frame(4, 0);
    assert.ok(Math.abs(settled.x - 20) < .1, JSON.stringify(settled));
    assert.equal(settled.distance, expected.distance);
});

test('necessary secondary widening preserves the playing centre', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset }); h.setFocus(20);
        const points = [[20, 13, 0], [300, 13, -30]];
        h.setPoints(points); const s = h.frame(0, 0);
        const fixed = h.solve(20, 100, .6, .82, true);
        assert.equal(s.x, 20, 'secondary visibility cannot choose a lateral compromise');
        assert.ok(s.distance > 100);
        assert.ok(s.distance >= fixed.distance - 1e-8, 'fixed-centre geometry receives the required room');
        assertFits(h, points, s, .6, .82);
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
            assert.ok(state.x >= previous, `${fps} FPS: pan reversed at ${i / fps}s`);
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
    assertFits(h, entry, rest, 0, .96);
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

test('a newly received disjoint playing area rejoins during a rest without waiting for a note', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({ preset }); h.setRegion(20, 50); h.setPoints([]);
        const original = h.frame(108.7, 0);
        h.setRegion(100, 130, 108.72);
        const first = h.frame(108.75, .05);
        assert.equal(first.x, original.x, 'late chart data preserves the pose at the instant of rejoining');
        const next = h.frame(108.8, .05);
        assert.ok(next.x > original.x && next.x < 115, 'the following frames travel smoothly');
        const settled = advanceCamera(h, 108.8, 1, 60);
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
    assert.equal(h.frame(2.05, .05).x, initial.x, 'an unannounced lane change rejoins from the current pose');
    assert.ok(h.frame(2.1, .05).x > initial.x, 'following begins on the next frame');
});

test('equal-bounds markers do not restart a playing-area transition', () => {
    const h = harness(); h.setRegion(20, 50); h.frame(0, 0);
    h.setRegion(100, 130, 0);
    let previous = 35;
    for (let i = 1; i <= 120; i++) {
        h.setRegion(100, 130, i / 60);
        const state = h.frame(i / 60, 1 / 60);
        assert.ok(state.x >= previous, `same bounds reversed transition at ${i / 60}s`);
        if(i>=45) {
            assert.equal(state.x,115, 'equivalent metadata cannot keep restarting the finite rejoin');
            assert.equal(state.rejoinVelocity,0);
        }
        previous = state.x;
    }
    assert.ok(Math.abs(previous - 115) < .15);
});

test('a lasting width extension retains the normal four-fret centre', () => {
    const h = harness(); h.setRegion(20, 60); h.frame(0, 0);
    h.setRegion(20, 80, .1);
    const state = advanceCamera(h, 0, 2, 60);
    assert.equal(state.focusX, 50);
    assert.equal(state.x, 40, 'camera stays between the middle two frets of the four-fret base');
});

test('known short detours and width extensions retain a shared centre', () => {
    for (const rows of [
        [{time:0,minX:20,maxX:60},{time:2,minX:25,maxX:65},{time:2.4,minX:20,maxX:60}],
        [{time:0,minX:20,maxX:60},{time:2,minX:20,maxX:80},{time:2.4,minX:20,maxX:60}],
    ]) {
        const h=harness(); h.setRegionTimeline(rows); const initial=h.frame(0,0);
        for(let i=1;i<=240;i++) assert.equal(h.frame(i/60,1/60).x,initial.x);
    }
});

test('a lasting lane transition begins early, ends finitely and uses the same view after seeking', () => {
    const rows=[{time:0,minX:20,maxX:60},{time:2,minX:100,maxX:140}];
    const h=harness();h.setRegionTimeline(rows);h.frame(0,0);
    const at=[];for(let i=1;i<=180;i++)at.push(h.frame(i/60,1/60));
    assert.equal(at[53].x,40, 'the large move begins 1.1 seconds before its destination');
    assert.ok(at[104].x>40&&at[104].x<120);
    assert.equal(at[119].x,120, 'the destination is reached exactly at its onset');
    assert.equal(at[119].planVelocity,0);
    assert.equal(at[155].x,120);
    const direct=harness();direct.setRegionTimeline(rows);
    assert.equal(at[104].x,direct.frame(1.75,0,false).x);
});

test('changing speed mid-pan preserves pose and velocity without reversing before the lasting arrival',()=>{
    for(const preset of ['straight','angled']) for(const rate of [.5,2]) {
        const h=harness();h.settings({preset,rate:1});
        h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:100,maxX:140}]);
        h.frame(0,0);
        let before;
        for(let i=1;i<=90;i++) before=h.frame(i/60,1/60);
        h.settings({rate});
        let state=h.frame(1.5,0),previous=state.x;
        assert.equal(state.x,before.x,`${preset}/${rate}: rate changes must preserve the current pose`);
        assert.ok(Math.abs(state.planVelocity+state.rejoinVelocity-before.planVelocity-before.rejoinVelocity)<1e-8,
            `${preset}/${rate}: rate changes must preserve the current velocity`);
        for(let i=1;i<=100;i++) {
            state=h.frame(1.5+i*.005,.005/rate);
            assert.ok(state.x>=previous-1e-8,`${preset}/${rate}: camera reversed at ${1.5+i*.005}`);
            assert.ok(state.x<=120+1e-8,`${preset}/${rate}: camera overshot its destination`);
            previous=state.x;
        }
        assert.equal(state.x,120);
        assert.equal(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('a second speed change preserves actual resume velocity even while nominal plans are both resting',()=>{
    const h=harness();h.settings({rate:2});
    h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:100,maxX:140}]);
    h.frame(0,0);
    for(let i=1;i<=50;i++) h.frame(i*.01,.005);
    h.settings({rate:1});h.frame(.5,0);
    let before;
    for(let i=1;i<=10;i++) before=h.frame(.5+i*.01,.01);
    const velocity=before.planVelocity+before.rejoinVelocity;
    assert.ok(velocity>0,'fixture must still be resuming towards the future lane');
    h.settings({rate:.5});
    const changed=h.frame(.6,0),epsilon=.000001;
    assert.equal(changed.x,before.x);
    assert.ok(Math.abs(changed.planVelocity+changed.rejoinVelocity-velocity)<1e-8);
    const next=h.frame(.6+epsilon,epsilon/.5);
    const actualVelocity=(next.x-changed.x)/epsilon*.5;
    assert.ok(Math.abs(actualVelocity-velocity)<.01,
        `rendered velocity changed from ${velocity} to ${actualVelocity}`);
});

test('pause and follow-off retain a pending resumed destination without backtracking',()=>{
    for(const hold of ['pause','follow-off']) {
        const h=harness();h.settings({rate:2});
        h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:100,maxX:140}]);
        h.frame(0,0);
        for(let i=1;i<=50;i++) h.frame(i*.01,.005);
        h.settings({rate:1});h.frame(.5,0);
        let before;
        for(let i=1;i<=10;i++) before=h.frame(.5+i*.01,.01);
        let time=.6;
        if(hold==='follow-off') {h.settings({follow:false});time=.7;}
        const held=h.frame(time,.1,hold!=='pause');
        assert.equal(held.x,before.x);
        h.settings({follow:true});
        let state=h.frame(time,0,true),previous=state.x;
        assert.equal(state.x,before.x);
        const count=Math.round((2-time)/.01);
        for(let i=1;i<=count;i++) {
            state=h.frame(time+(2-time)*i/count,(2-time)/count);
            assert.ok(state.x>=previous-1e-8,`${hold}: resuming travelled backwards`);
            assert.ok(state.x<=120+1e-8,`${hold}: resuming overshot the destination`);
            previous=state.x;
        }
        assert.equal(state.x,120);
        assert.equal(state.planVelocity+state.rejoinVelocity,0);
    }
});

test('safety fitting protects notes during early framing changes', () => {
    const h=harness();h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:100,maxX:140}]);
    h.frame(0,0);h.setPoints([[-150,13,0],[140,13,0]]);
    for(let i=1;i<=180;i++){const state=h.frame(i/60,1/60);assertFits(h,[[-150,13,0],[140,13,0]],state,0,.96);}
});

test('resize reclassification rejoins a new plan without a next-frame position jump', () => {
    const h=harness();
    h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:55,maxX:95},{time:2.6,minX:20,maxX:60}]);
    h.frame(0,0); const before=advanceCamera(h,0,1.9);
    h.settings({aspect:.4}); const resized=h.frame(1.9166667,1/60);
    assert.equal(resized.x,before.x);
    const next=h.frame(1.9333333,1/60);
    assert.ok(Math.abs(next.x-resized.x)<2, 'narrow-view reclassification must smoothly rejoin');
});

test('unexpected geometry widens the view without moving a suppressed excursion', () => {
    const h = harness();
    h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:55,maxX:95},{time:2.3,minX:20,maxX:60}]);
    const initial=h.frame(0,0);
    h.setPoints([[150,13,0]]);
    let state;
    for (let i=1;i<=132;i++) state=h.frame(i/60,1/60);
    assert.equal(state.safetyOffset,0);
    assert.equal(state.x,40, 'actual geometry cannot override the held lane');
    assert.ok(state.distance>initial.distance, 'unexpected geometry is protected through widening');
    assertFits(h,[[150,13,0]],state,0,.96);
    h.setPoints([]);
    const settled=advanceCamera(h,2.2,3);
    assert.ok(Math.abs(settled.x-40)<.01, 'temporary protection cannot leave a persistent offset');
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
    assert.ok(initial.x < 115, 'the early preparation is still in flight before onset');
    assert.equal(crossed.x,115, 'the camera has already arrived when the rendered lane changes');
    assert.equal(crossed.planVelocity,0);
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
    const direct = harness(); direct.setRegionTimeline([{time:0,minX:20,maxX:50},{time:1,minX:100,maxX:130}]);
    assert.equal(sought.x, direct.frame(10,0,false,1.006).x, 'seek samples the same finite transition as a direct opening');
    assert.equal(h.regionLookupTime(), 1.006, 'the area itself still comes from the supplied render clock');
    assert.equal(sought.lastTime, 10);
    assert.equal(sought.rateTime, 10);
});

test('the stable camera update entry point forwards the shared floor render clock', () => {
    const run = new Function(`
        const cameraMode = 'stable', _frameNow = 108.735, letRingTrailsVisible = false;
        const letRingView = (bundle, enabled) => {
            if (enabled !== letRingTrailsVisible) throw new Error('Camera ignored let-ring visibility');
            return bundle;
        };
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

test('five and seven fret passages preserve the centre and smoothly return to calibrated close framing', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({preset});
        h.setRegionTimeline([{time:0,minX:90,maxX:130},{time:2,minX:90,maxX:140},
            {time:5,minX:90,maxX:160},{time:10,minX:90,maxX:130}]);
        const first = h.frame(0, 0);
        assert.equal(first.x, 110);
        let previous = first;
        for (let i = 1; i <= 840; i++) {
            const s = h.frame(i / 60, 1 / 60);
            assert.equal(s.x, 110, `${preset}: width alone moved the centre at ${i / 60}`);
            assert.ok(Math.abs(s.distance - previous.distance) / previous.distance < .01,
                `${preset}: abrupt zoom at ${i / 60}`);
            previous = s;
        }
        assert.equal(previous.distance, first.distance, `${preset}: did not return to close framing`);
    }
});

test('a visible outlier receives necessary zoom while preserving the lane centre', () => {
    const reference = harness(); reference.setRegion(0, 40);
    const close = reference.frame(0, 0);
    const h = harness(); h.setRegion(0, 40);
    h.setPoints([[-10, 13, 0], [130, 13, 0]]);
    const state = h.frame(0, 0);
    assert.ok(state.distance > close.distance);
    assert.equal(state.x,20, 'fitting cannot replace the lane centre with a lateral compromise');
    assertFits(h, [[-10, 13, 0], [130, 13, 0]], state, 0, .82);
});

test('calibrated framing reserves incoming fret digits before the first attack', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({preset, aspect:3440/1323});
        h.setRegion(130, 170);
        const opening = h.frame(0, 0);
        const points = h.spritePoints({x:135, y:3-4*.8, z:0, size:7, centerY:1});
        for (const point of points) assert.ok(h.viewFits(point, opening),
            `${preset}: the first incoming digit would force an emergency zoom`);
        h.setPoints(points);
        for (let i=1;i<=120;i++) {
            const s=h.frame(i/60,1/60);
            assert.ok(Math.abs(s.distance-opening.distance)<1e-6,
                `${preset}: a normal arrival changed the reserved distance`);
        }
    }
});

test('bounded frustum support gives the same fit as every real collected point', () => {
    let seed=83173;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const points=Array.from({length:600},()=>[random()*600-300,random()*140-40,random()*-420+8]);
    for(const preset of ['straight','angled'])for(const aspect of [.72,1.78,2.6])for(const rate of [.5,1,2]){
        const h=harness();h.settings({preset,aspect,rate});h.setRegion(20,60);h.frame(0,0);
        for(const result of h.compareSupportedGeometry(points)){
            assert.equal(result.selectedCount,10);
            assert.ok(result.inputCount>30);
            assert.ok(Math.abs(result.exact.x-result.reduced.x)<1e-8,`${preset}/${aspect}/${rate}: centre`);
            assert.ok(Math.abs(result.exact.distance-result.reduced.distance)<1e-8,`${preset}/${aspect}/${rate}: distance`);
        }
    }
});

test('genuinely wide playing areas remain stable across alternating notes', () => {
    for (const preset of ['straight', 'angled']) {
        const h = harness(); h.settings({preset}); h.setRegion(0, 240);
        h.setPoints([[0, 13, 0], [240, 13, 0]]);
        const first = h.frame(0, 0);
        assert.ok(first.distance > 100, 'this span genuinely cannot fit at close zoom');
        for (let i = 1; i <= 240; i++) {
            h.setPoints([[i % 2 ? 0 : 240, 13, 0]]);
            const s = h.frame(i / 60, 1 / 60);
            assert.ok(Math.abs(s.x - first.x) < 1e-6, 'a shared wide view must not chase attacks');
            assert.ok(Math.abs(s.distance - first.distance) < 1e-6, 'a shared wide view must not breathe');
        }
    }
});

test('far future geometry does not participate and imminent constraints enter continuously', () => {
    const h = harness(); h.setRegion(0, 40); h.frame(0, 0);
    const sprite = z => h.spritePoints({x:500,y:13,z,size:0,centerY:.5});
    assert.deepEqual(sprite(-2.8 * 230), []);
    const entering = sprite(-.899 * 230), later = sprite(-.75 * 230), full = sprite(-.6 * 230);
    assert.ok(entering.every(p => Math.abs(p[0] - 20) < .1), 'no jump at the relevance window edge');
    assert.ok(later.every(p => p[0] > 20 && p[0] < 500));
    assert.ok(full.every(p => Math.abs(p[0] - 500) < 1e-8));
});

test('a long trail crossing the near window is clipped rather than lost or fitted in full', () => {
    const h = harness(); h.frame(0, 0);
    const bins = h.segmentPoints([200,13,20], [-100,13,-1000]);
    assert.ok(bins.length >= 2, 'both endpoints lie outside but the crossing segment is protected');
    assert.ok(bins.every(b => b.minZ >= -.9 * 230 - 1e-7 && b.maxZ <= 8 + 1e-7));
    assert.ok(bins.some(b => Math.abs(b.minZ + .6 * 230) < 1e-7), 'full-strength preview boundary is sampled');
    assert.deepEqual(h.segmentPoints([200,13,-500], [-100,13,-1000]), []);
});

test('near geometry cannot turn a suppressed detour into an opposing safety pan', () => {
    const h = harness();
    h.setRegionTimeline([{time:0,minX:20,maxX:60},{time:2,minX:55,maxX:95},
        {time:2.4,minX:-60,maxX:-20}]);
    let previous = h.frame(0, 0).x;
    for (let i = 1; i <= 180; i++) {
        const time = i / 60;
        h.setPoints(time >= 1.2 && time < 2.4 ? [[160,13,0]] : []);
        const state = h.frame(time, 1 / 60);
        assert.ok(state.x <= previous + 1e-7, 'visibility correction must not reintroduce right/left movement');
        if (time >= 1.2 && time < 2.4) assertFits(h, [[160,13,0]], state, 0, .96);
        previous = state.x;
    }
});

// A frozen pre-optimization collector is the numerical oracle: compare ordered
// samples, support arrays and the actual controller, not a duplicate of the guard.
const collectionBaseline = fs.readFileSync(path.join(__dirname,
    'fixtures/highway_3d_stable_collection.baseline.txt'), 'utf8');
// Exact scalar support helpers from b2dbcb686008f766da0042cbb8ba882ad792ff7b.
// Keep the reference independent of the candidate's numeric-storage handoff.
const supportBaseline = `
        function stableSupportPoint(index, x, y, z, depth, right, up) {
            const q = _stableSupport[index], m = q.maxima, p = _stableViewPoints;
            let slot = index * 15, value = right + q.horizontal * depth;
            if (value > m[0]) { m[0] = value; p[slot] = x; p[slot + 1] = y; p[slot + 2] = z; }
            slot += 3; value = -right + q.horizontal * depth;
            if (value > m[1]) { m[1] = value; p[slot] = x; p[slot + 1] = y; p[slot + 2] = z; }
            slot += 3; value = up + q.top * depth;
            if (value > m[2]) { m[2] = value; p[slot] = x; p[slot + 1] = y; p[slot + 2] = z; }
            slot += 3; value = -up + q.bottom * depth;
            if (value > m[3]) { m[3] = value; p[slot] = x; p[slot + 1] = y; p[slot + 2] = z; }
            slot += 3;
            if (depth > m[4]) { m[4] = depth; p[slot] = x; p[slot + 1] = y; p[slot + 2] = z; }
        }

        function stableCollectViewPoint(x, y, z) {
            const b = _stableViewBasis;
            const dz = Math.max(z, Math.min(0, z + _stableSupport[0].prediction)) - z;
            const depth = b.bx * x + b.by * y + b.bz * z;
            const right = b.rx * x + b.rz * z, up = b.ux * x + b.uy * y + b.uz * z;
            stableSupportPoint(0, x, y, z, depth + b.bz * dz, right + b.rz * dz, up + b.uz * dz);
            stableSupportPoint(1, x, y, z, depth, right, up);
        }
`;
// Exact region collector from d5807829889e865673fb0a0dbe5c751a36fe228c;
// the earlier frozen point helper takes scalar inputs at this final call site.
const regionCollectionBaseline = `function stableCollectGeometry(region) {
            stableSupportReset();
            pNote?.forEachActive(stableCollectObject);
            pSus?.forEachActive(stableCollectObject);
            pSusRibbon?.forEachActive(stableCollectObject);
            pChordBox?.forEachActive(stableCollectObject);
            pRsChordFrame?.forEachActive(stableCollectObject);
            pArpBracket?.forEachActive(stableCollectObject);
            pSusRail?.forEachActive(stableCollectObject);
            pTechPlane?.forEachActive(stableCollectObject);
            for (let i = 0; i < _incomingFloorLabelCount; i++) {
                const record = _incomingFloorLabels[i];
                if (record.time < _frameNow - 0.03) continue;
                stableCollectObject(record.sprite);
            }
            // The plan prepares future lane footprints; collecting them again
            // here would pull toward empty future areas before that planned
            // move. Protect the current lane with fret-centred label corners,
            // avoiding an imaginary low rectangle across its entire width.
            const addRegion = (row, dt) => {
                stableRegionFootprint(row);
                for (let i = 0; i < 48; i += 3) {
                    stableAddPoint(_stableRegionPoints[i], _stableRegionPoints[i + 1],
                        _stableRegionPoints[i + 2] + dZ(dt));
                }
            };
            if (region?.valid) {
                addRegion({minX:region.minX, maxX:region.maxX,
                    firstFret:region.dMin + 1, lastFret:region.dMax}, 0);
                for (let f = region.dMin + 1; f <= region.dMax; f++) {
                    stableCollectObject(_incomingFixedFretLabels[f]);
                }
            }
            let count = 0;
            for (const bin of _stableBins) {
                if (!Number.isFinite(bin.minX)) continue;
                for (let i = 0; i < 8; i++) {
                    _stablePoints[count++] = i & 1 ? bin.maxX : bin.minX;
                    _stablePoints[count++] = i & 2 ? bin.maxY : bin.minY;
                    _stablePoints[count++] = i & 4 ? bin.maxZ : bin.minZ;
                }
            }
            _stableCam.pointCount = count;
            _stableCam.viewPointCount = _stablePointSamples ? _stableViewPoints.length : 0;
        }`;
let referenceSource = source;
for (const name of ['stableSupportReset', 'stableAddPoint', 'stableAddSegment', 'stableCollectObject']) {
    referenceSource = referenceSource.replace(extractFunction(name), extractFunction(name, collectionBaseline));
}
for (const name of ['stableSupportPoint', 'stableCollectViewPoint']) {
    referenceSource = referenceSource.replace(extractFunction(name), extractFunction(name, supportBaseline));
}
referenceSource = referenceSource.replace(extractFunction('stableCollectGeometry'), regionCollectionBaseline);
const realThree = import(pathToFileURL(path.join(__dirname, '../../static/vendor/three/three.module.min.js')).href);

function collectionPair(T, settings = {}) {
    const pair = [harness(source, T), harness(referenceSource, T)];
    for (const h of pair) { h.settings(settings); h.setRegion(20, 60); h.frame(0, 0); }
    return pair;
}

function assertCollectionParity(pair, objects, label) {
    const counts = pair.map(h => { h.setObjects(objects); return h.collectObjects(); });
    assert.deepEqual(pair[0].collection(), pair[1].collection(), label);
    return counts;
}

test('weighted view handoff preserves consecutive accepted and rejected point support', async () => {
    const T = await realThree;
    const points = [[90,40,-172.5], [NaN,2,-100], [-0,-0,-0],
        [12,9,8], [12,9,8 + 1e-10], [1,2,-207 - 2e-7],
        [1,2,-207 - 5e-8], [Infinity,2,-100], [1e308,1e308,-100],
        [-50,-12,-170], [90,40,-172.5], [10,13,-34.5], [2,3,-Infinity]];
    const originals = points.map(p => p.slice());
    for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
        const pair = collectionPair(T, {preset, lefty});
        for (const sequence of [points, points.slice().reverse(), points, [[3,4,-100]], points]) {
            const fits = pair.map(h => h.compareSupportedGeometry(sequence));
            assert.deepEqual(fits[0], fits[1], `${preset}/${lefty}: fitted support`);
            assert.deepEqual(pair[0].collection(), pair[1].collection(),
                `${preset}/${lefty}: ordered weighted points, bins and support`);
        }
        assert.ok(pair[0].collection().raw.some(p => p[2] === -172.5 && p[0] !== 90),
            'the comparison exercises weighted coordinates, not only unchanged inputs');
    }
    assert.deepEqual(points, originals, 'reusing private scratch cannot alter caller geometry');
});

function collectionBox(T, minZ, maxZ) {
    const geometry = new T.BufferGeometry();
    // Explicit bounds let the test include exact near/fade/kink endpoints.
    geometry.boundingBox = new T.Box3(new T.Vector3(-3, 1, minZ), new T.Vector3(7, 9, maxZ));
    return new T.Mesh(geometry, new T.MeshBasicMaterial());
}

test('support handoff preserves exact extrema and tie order across repeated point collections', () => {
    for (const preset of ['straight','angled']) for (const lefty of [false,true]) {
        const pair = collectionPair(null, {preset,lefty,rate:.75});
        const points = [[-0,-0,-0],[0,0,0],[20,13,-25.875],[20,13,-25.875],
            [-37.25,18.125,-155.25],[77.5,-13.5,-155.25+1e-7],
            [120,80,8],[-60,-15,-90],[NaN,0,0],[0,Infinity,0],[0,0,-Infinity]];
        for (const sequence of [points,points.slice().reverse(),[],[[1,2,3]],points]) {
            const fits = pair.map(h => h.compareSupportedGeometry(sequence));
            assert.deepEqual(fits[0],fits[1],`${preset}/${lefty} fits`);
            assert.deepEqual(pair[0].collection(),pair[1].collection(),`${preset}/${lefty} support`);
        }
    }
});

test('collection matches ordered legacy support at clipping, fading and prediction boundaries', async () => {
    const T = await realThree;
    for (const rate of [.1, .5, .75, 1, 2, 4]) {
        const horizon = Math.min(3, .9 * rate), far = -horizon * 230;
        const full = -Math.max(0, horizon - .3 * rate) * 230;
        const predicted = -Math.min(3, .15 * rate) * 230;
        const planes = [far, full, predicted, 0, 8];
        const objects = [];
        for (const plane of planes) for (const epsilon of [0, 1e-11, 1e-7, .25]) {
            objects.push(collectionBox(T, plane-epsilon, plane+epsilon));
            objects.push(collectionBox(T, plane, plane+epsilon));
            objects.push(collectionBox(T, plane-epsilon, plane));
        }
        objects.push(collectionBox(T, far-100, 20), collectionBox(T, far-20, far-1),
            collectionBox(T, 9, 100), collectionBox(T, predicted-2, -1),
            collectionBox(T, NaN, NaN));
        for (const preset of ['straight', 'angled']) for (const lefty of [false, true]) {
            const pair = collectionPair(T, {rate, preset, lefty, aspect:3440/1440});
            assertCollectionParity(pair, objects, `${rate}/${preset}/${lefty}`);
        }
    }
});

test('point scratch preserves region and label support after object and clipped-segment producers', async () => {
    const T = await realThree, pair = collectionPair(T,{preset:'angled',lefty:true});
    const box = collectionBox(T,-240,12), sprite = new T.Sprite(new T.SpriteMaterial());
    sprite.position.set(90,20,-10); sprite.scale.set(16,8,1);
    for (const h of pair) h.setObjects([box,sprite]);
    const region = {valid:true,minX:20,maxX:60,dMin:2,dMax:6};
    const labels = [{fret:3,x:25,y:1,z:8,size:5},{fret:6,x:55,y:3,z:-0,size:8}];
    for (const row of [region,null,{valid:true,minX:-0,maxX:40,dMin:0,dMax:4},region]) {
        const ordered = pair.map(h=>h.collectRegion(row,labels));
        assert.deepEqual(ordered[0],ordered[1]);
        assert.deepEqual(pair[0].collection(),pair[1].collection());
    }
});

test('only full unclipped boxes without a prediction crossing omit their twelve edge checks', async () => {
    const T = await realThree, pair = collectionPair(T);
    // Negative full-strength slab, post-strike slab, exact kink endpoint,
    // and a zero-depth slab: legacy edges add no samples for these bounds.
    for (const [lo, hi] of [[-100,-60], [1,8], [-34.5,-10], [0,0]]) {
        const counts = assertCollectionParity(pair, [collectionBox(T, lo, hi)], `${lo}/${hi}`);
        assert.equal(counts[0].segmentCalls, 0);
        assert.equal(counts[1].segmentCalls, 12);
        assert.equal(counts[0].depthCalls, 3, 'planes computed once per collection');
        assert.ok(counts[1].depthCalls > counts[0].depthCalls);
    }
    for (const [lo, hi] of [[-160,-150], [-35,-34], [-1,1], [7,9], [-220,20]]) {
        const counts = assertCollectionParity(pair, [collectionBox(T, lo, hi)], `${lo}/${hi}`);
        assert.equal(counts[0].segmentCalls, 12, 'faded, crossed or clipped bounds retain edges');
        assert.equal(counts[1].segmentCalls, 12);
    }
});

test('rotated parents, sprites and mutable pooled ribbons retain exact current-vertex support', async () => {
    const T = await realThree, pair = collectionPair(T, {preset:'angled', lefty:true});
    const parent = new T.Group(), box = collectionBox(T, -110, -80);
    const sprite = new T.Sprite(new T.SpriteMaterial()); sprite.scale.set(16, 8, 1);
    sprite.position.set(90, 20, -10); sprite.center.set(.2, 1);
    const geometry = new T.BufferGeometry();
    const positions = new Float32Array(4 * 7 * 3);
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    // Deliberately stale/extreme bounds and unused pooled capacity must not enter.
    geometry.boundingBox = new T.Box3(new T.Vector3(-9999,-9999,-9999), new T.Vector3(9999,9999,9999));
    const ribbon = new T.Mesh(geometry, new T.MeshBasicMaterial());
    parent.add(box, sprite, ribbon);
    const irrelevant = collectionBox(T,-100,-60); irrelevant.userData.stableCameraRelevant=false;
    const transparent = collectionBox(T,-100,-60); transparent.material.opacity=0;
    const halo = collectionBox(T,-100,-60); halo.material.uniforms={uHalo:{value:1}};
    const hidden = collectionBox(T,-100,-60); hidden.visible=false;
    for (let step=0; step<12; step++) {
        parent.position.set(step*3, -step, step*2);
        parent.rotation.set(step*.02, step*.07, -step*.03);
        parent.scale.set(1+step*.04, .8+step*.01, 1-step*.02);
        geometry.userData.ribbonSlices = step%4;
        positions.fill(99999);
        for (let i=0; i<(geometry.userData.ribbonSlices+1)*4; i++) {
            positions[i*3]=30+(i%4)*6+step;
            positions[i*3+1]=2+(i%2)*10;
            positions[i*3+2]=10-Math.floor(i/4)*95-step*7;
        }
        const counts = assertCollectionParity(pair, [box,sprite,ribbon,irrelevant,transparent,halo,hidden], `step${step}`);
        assert.ok(counts[0].segmentCalls >= geometry.userData.ribbonSlices*4,
            'ribbon always visits populated longitudinal segments');
        assert.ok(pair[0].collection().raw.every(p=>Math.abs(p[0])<1000), 'unused/stale vertices excluded');
    }
});

test('legacy and optimized collection drive identical camera poses across playback transitions', async () => {
    const T = await realThree;
    for (const preset of ['straight','angled']) for (const lefty of [false,true]) {
        const pair = collectionPair(T, {preset,lefty});
        const parent = new T.Group(), box = collectionBox(T,-110,-80);
        parent.add(box);
        for (const h of pair) h.setObjects([box]);
        let time=0;
        for (let frame=0; frame<42; frame++) {
            const rate=[1,.75,2,.1,4,.5][Math.floor(frame/7)];
            const elapsed=[.01,.016,.033,.007][frame%4];
            time += elapsed*rate;
            if (frame===16) time=20;
            if (frame===29) time=2;
            parent.position.set(Math.sin(frame*.3)*120, frame%5, frame%3===0 ? 95 : -frame);
            parent.rotation.set(.01*frame,.02*frame,-.015*frame);
            for (const h of pair) h.settings({rate,follow:frame<33,aspect:frame<23?16/9:.72,
                strings:frame<12?6:7,epoch:frame<16?1:frame<29?2:3});
            const states = pair.map(h=>h.frame(time,elapsed,frame!==8&&frame!==9,time+.004));
            assert.deepEqual(states[0],states[1], `${preset}/${lefty}/frame${frame}`);
            assert.deepEqual(pair[0].collection(),pair[1].collection());
            assert.deepEqual(pair[0].renderedPose(),pair[1].renderedPose());
        }
    }
});

test('shared ribbon coordinate storage preserves ordered output between ribbons and changing draw ranges', async () => {
    const T = await realThree, pair = collectionPair(T, {preset:'angled',lefty:true,rate:.75});
    const parent = new T.Group();
    parent.rotation.set(.13,-.21,.08); parent.scale.set(-1.1,.7,1.2);
    const ribbons=[];
    for (let r=0;r<3;r++) {
        const geometry=new T.BufferGeometry();
        geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(4*9*3),3));
        const ribbon=new T.Mesh(geometry,new T.MeshBasicMaterial());
        ribbon.position.set(r*31,-r*3,r*5); parent.add(ribbon); ribbons.push(ribbon);
    }
    for (const slices of [[8,1,0],[0,8,1],[1,0,8],[3,2,4],[0,0,0]]) {
        for (let r=0;r<ribbons.length;r++) {
            const geometry=ribbons[r].geometry, p=geometry.attributes.position.array;
            geometry.userData.ribbonSlices=slices[r]; p.fill(123456);
            for(let i=0;i<(slices[r]+1)*4;i++) {
                p[i*3]=(i%4-1.5)*7+r;
                p[i*3+1]=(i%2)*5-r;
                p[i*3+2]=17-Math.floor(i/4)*43+r*11;
            }
        }
        assertCollectionParity(pair,ribbons,`slices ${slices}`);
        assertCollectionParity(pair,[ribbons[2],ribbons[0],ribbons[1]],`reordered ${slices}`);
    }
    const invalid=[collectionBox(T,-Infinity,Infinity),collectionBox(T,NaN,8)];
    assertCollectionParity(pair,[...invalid,...ribbons],'non-finite objects must not poison subsequent ribbons');
    const partial=ribbons[0], positions=new Float32Array(19*3);
    partial.geometry.setAttribute('position',new T.BufferAttribute(positions,3));
    partial.geometry.userData.ribbonSlices=30;
    for (const value of [NaN,Infinity,-Infinity,-0]) {
        for(let i=0;i<19;i++) {
            positions[i*3]=i%4; positions[i*3+1]=i%2;
            positions[i*3+2]=6-Math.floor(i/4)*45;
        }
        positions[7*3+2]=value;
        assertCollectionParity(pair,[partial,ribbons[1]],`partial ribbon with ${String(value)}`);
    }
});


test('a visibility correction never manufactures velocity from its displacement or frame interval', () => {
    const distances = [];
    for (const fps of [30, 60, 120, 240]) {
        const h = harness(); h.noRegion(); h.setPoints([[0, 13, 0]]); h.frame(0, 0);
        h.setPoints([[-240, -18, 0], [240, 100, 0]]);
        const state = h.frame(1 / fps, 1 / fps);
        assert.equal(state.correction, true);
        assert.equal(state.zoomVelocity, 0, 'the guard must not create momentum when the controller had none');
        distances.push(state.distance);
    }
    assert.ok(Math.max(...distances) - Math.min(...distances) < 1e-8);
});
