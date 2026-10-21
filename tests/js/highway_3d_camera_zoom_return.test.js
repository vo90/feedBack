const test = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi, harness} = require('../helpers/highway_camera_harness.cjs');

const {hwyCameraZoom} = cameraApi();
const near = (actual, expected, message, tolerance = 1e-8) =>
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} versus ${expected}`);
const zoomState = () => ({distance: 300, zoomVelocity: 0, quietZoomTime: 0, zoomRequired: 300});
const ease = u => u * u * u * (10 + u * (-15 + 6 * u));

function advanceZoom(state, required, frames, dt = 1 / 120) {
    for (let frame = 0; frame < frames; frame++) hwyCameraZoom(state, required, dt, .5);
    return state;
}

test('relaxing the requirement during inward zoom cannot change position or velocity at zero elapsed time', () => {
    const state = advanceZoom(zoomState(), 200, 110);
    const before = {...state};
    assert.ok(before.distance > 200 && before.distance < 300);
    assert.ok(before.zoomVelocity < 0, 'the fixture must already be returning inward');
    hwyCameraZoom(state, 100, 0, .5);
    near(state.distance, before.distance, 'a closer requirement cannot teleport the camera');
    near(state.zoomVelocity, before.zoomVelocity, 'the captured return keeps its current velocity');
});

test('a constant zoom requirement retains the existing quiet hold and finite easing curve', () => {
    const state = zoomState();
    for (let frame = 1; frame <= 180; frame++) {
        hwyCameraZoom(state, 200, 1 / 120, .5);
        const u = Math.max(0, Math.min(1, (frame / 120 - .5) / .8));
        near(state.distance, 300 - 100 * ease(u), `distance at frame ${frame}`);
        near(state.zoomVelocity, -100 * 30 * u * u * (1 - u) ** 2 / .8,
            `velocity at frame ${frame}`);
    }
    assert.equal(state.distance, 200, 'an unchanged requirement still settles exactly');
});

test('successive closer requirements finish the captured curve and then reach the latest target finitely', () => {
    const changing = zoomState(), reference = zoomState();
    for (let frame = 1; frame <= 156; frame++) {
        const required = frame <= 90 ? 200 : Math.max(100, 200 - (frame - 90) * 2);
        hwyCameraZoom(changing, required, 1 / 120, .5);
        hwyCameraZoom(reference, 200, 1 / 120, .5);
        near(changing.distance, reference.distance, `captured position at frame ${frame}`);
        near(changing.zoomVelocity, reference.zoomVelocity, `captured velocity at frame ${frame}`);
    }
    near(changing.distance, 200, 'the first segment reaches its original centre');
    near(changing.zoomVelocity, 0, 'the handoff reaches rest smoothly');
    let previous = changing.distance;
    for (let frame = 0; frame < 240; frame++) {
        hwyCameraZoom(changing, 100, 1 / 120, .5);
        assert.ok(changing.distance <= previous + 1e-8, 'the follow-up continues inward');
        assert.ok(changing.distance >= 100 - 1e-8, 'the follow-up cannot overshoot');
        previous = changing.distance;
    }
    assert.equal(changing.distance, 100, 'queued changes cannot restart recovery forever');
    near(changing.zoomVelocity, 0, 'completed recovery has no meaningful residual velocity');
});

test('a requirement that relaxes during the quiet hold is used when movement begins', () => {
    const changing = zoomState(), reference = zoomState();
    for (let frame = 1; frame <= 156; frame++) {
        hwyCameraZoom(changing, frame <= 36 ? 200 : 100, 1 / 120, .5);
        hwyCameraZoom(reference, 100, 1 / 120, .5);
        near(changing.distance, reference.distance, `quiet-period target at frame ${frame}`);
    }
    near(changing.distance, 100, 'quiet-period edits do not cause a redundant follow-up');
});

test('another relaxation during a queued follow-up also keeps that segment continuous', () => {
    const changing = advanceZoom(zoomState(), 200, 110);
    let frame = 0;
    while (changing.distance > 175 && frame++ < 400)
        hwyCameraZoom(changing, 100, 1 / 120, .5);
    assert.ok(changing.distance < 175 && changing.distance > 100,
        'the fixture must reach the second inward segment');
    const reference = {...changing};
    hwyCameraZoom(changing, 50, 0, .5);
    near(changing.distance, reference.distance, 'a second queued target cannot change position');
    near(changing.zoomVelocity, reference.zoomVelocity, 'a second queued target cannot change velocity');
    frame = 0;
    while (reference.distance > 100 + 1e-8 && frame++ < 240) {
        hwyCameraZoom(changing, 50, 1 / 120, .5);
        hwyCameraZoom(reference, 100, 1 / 120, .5);
        near(changing.distance, reference.distance, 'the queued segment finishes its own captured path');
        near(changing.zoomVelocity, reference.zoomVelocity, 'the queued segment keeps its velocity');
    }
    near(reference.distance, 100, 'the second segment finishes finitely');
    advanceZoom(changing, 50, 240);
    assert.equal(changing.distance, 50, 'the newest target is not lost after multiple returns');
});

test('a frame crossing a queued return boundary preserves elapsed time', () => {
    const whole = advanceZoom(zoomState(), 200, 144);
    hwyCameraZoom(whole, 100, 0, .5);
    const split = {...whole};
    hwyCameraZoom(whole, 100, .2, .5);
    hwyCameraZoom(split, 100, .1, .5);
    hwyCameraZoom(split, 100, .1, .5);
    near(whole.distance, split.distance, 'one frame and two boundary-split frames have the same position');
    near(whole.zoomVelocity, split.zoomVelocity, 'boundary crossing retains the same velocity');
});

for (const completion of ['large elapsed step', 'ordinary frame boundary overshoot']) {
    test(`a newly closer target cannot spend elapsed time from a completed return: ${completion}`, () => {
        const state = advanceZoom(zoomState(), 200, 108);
        if (completion === 'large elapsed step') hwyCameraZoom(state, 100, 5, .5);
        else {
            // 144 Hz does not divide the captured segment's end exactly; the
            // final ordinary frame therefore carries a small amount past it.
            let frames = 0;
            while (state.distance !== 100 && frames++ < 400)
                hwyCameraZoom(state, 100, 1 / 144, .5);
        }
        assert.equal(state.distance, 100, 'the two known segments must already be complete');
        near(state.zoomVelocity, 0, 'the completed return has reached rest');
        hwyCameraZoom(state, 50, 0, .5);
        near(state.distance, 100, 'a target first observed now cannot use previously elapsed time');
        near(state.zoomVelocity, 0, 'a new target starts at rest when no time has elapsed');
        hwyCameraZoom(state, 50, .1, .5);
        near(state.distance, 100 - 50 * ease(.1 / .8),
            'the fresh gentle segment begins without another quiet wait');
        advanceZoom(state, 50, 120);
        assert.equal(state.distance, 50, 'the fresh segment still reaches its target finitely');
    });
}

test('a renewed wider requirement cancels pending inward travel and remains visible', () => {
    for (const required of [220, 280, 340]) {
        const state = advanceZoom(zoomState(), 200, 110);
        hwyCameraZoom(state, 100, 0, .5); // Queue a closer eventual target.
        const before = state.distance;
        hwyCameraZoom(state, required, 0, .5);
        near(state.distance, before, 'a changed requirement alone is not elapsed motion');
        advanceZoom(state, required, 480);
        near(state.distance, required, `wider ${required} requirement replaces pending inward target`);
        near(state.zoomVelocity, 0, 'repeated excursion settles without residual momentum', 1e-7);
    }
});

for (const [phase, editFrame] of [['quiet hold', 36], ['active return', 108]]) {
    test(`live smoothing changes preserve the captured ${phase} and affect the next segment`, () => {
        const changing = advanceZoom(zoomState(), 200, editFrame);
        const reference = {...changing};
        hwyCameraZoom(changing, 200, 0, 1);
        near(changing.distance, reference.distance, 'a smoothing edit is not elapsed motion');
        near(changing.zoomVelocity, reference.zoomVelocity, 'a smoothing edit preserves current velocity');
        for (let frame = editFrame + 1; frame <= 156; frame++) {
            hwyCameraZoom(changing, frame >= 120 ? 100 : 200, 1 / 120, 1);
            hwyCameraZoom(reference, 200, 1 / 120, .5);
            near(changing.distance, reference.distance, `captured timing at frame ${frame}`);
            near(changing.zoomVelocity, reference.zoomVelocity, `captured velocity at frame ${frame}`);
        }
        near(changing.distance, 200, 'the original segment finishes at its original time');
        for (let frame = 0; frame < 12; frame++) hwyCameraZoom(changing, 100, 1 / 120, 1);
        near(changing.distance, 200 - 100 * ease(.1),
            'the follow-up uses the newly selected one-second easing duration');
        for (let frame = 0; frame < 120; frame++) hwyCameraZoom(changing, 100, 1 / 120, 1);
        assert.equal(changing.distance, 100, 'the changed smoothing still permits finite completion');
    });
}

test('the renderer quiet-clock reset invalidates a previously captured destination', () => {
    const state = advanceZoom(zoomState(), 200, 110);
    hwyCameraZoom(state, 100, 0, .5);
    // Reframing and the visibility guard already reset these existing fields.
    // They must not need knowledge of every private captured-segment field.
    state.distance = 350;
    state.quietZoomTime = 0;
    state.zoomVelocity = 0;
    state.zoomRequired = 350;
    for (let frame = 0; frame <= 156; frame++) {
        hwyCameraZoom(state, 80, frame ? 1 / 120 : 0, .5);
        const u = Math.max(0, Math.min(1, (frame / 120 - .5) / .8));
        near(state.distance, 350 - 270 * ease(u), `fresh framing path at frame ${frame}`);
    }
    near(state.distance, 80, 'the discarded target cannot add an obsolete intermediate return');
});

test('cumulative tiny increases cancel an unsafe captured endpoint like one equivalent increase', () => {
    const gradual = advanceZoom(zoomState(), 200, 110);
    const direct = {...gradual};
    for (let step = 1; step <= 100; step++)
        hwyCameraZoom(gradual, 200 + step * .0001, 0, .5);
    hwyCameraZoom(direct, 200.01, 0, .5);
    near(gradual.distance, direct.distance, 'small observations alone do not advance motion');
    for (let frame = 0; frame < 180; frame++) {
        hwyCameraZoom(gradual, 200.01, 1 / 120, .5);
        hwyCameraZoom(direct, 200.01, 1 / 120, .5);
        near(gradual.distance, direct.distance, `cumulative wider requirement at frame ${frame}`);
        near(gradual.zoomVelocity, direct.zoomVelocity, `cumulative wider velocity at frame ${frame}`);
    }
    near(gradual.distance, 200.01, 'the new requirement replaces the stale narrower endpoint');
});

function renderer(preset, rate = 1) {
    const h = harness();
    h.settings({preset, rate, startBeforeMs: 400, arriveAfterMs: 50});
    h.setRegionTimeline([{time: 0, minX: 10, maxX: 50}]);
    return h;
}

function points(x) { return [[30, 13, 0], [x, 13, -30]]; }

function warmReturn(h, rate = 1) {
    let state;
    for (let frame = 0; frame <= 588; frame++) {
        const time = frame / 120;
        h.setPoints(points(time < 4 ? 310 : 200));
        state = h.frame(time, frame ? 1 / (120 * rate) : 0);
    }
    assert.ok(state.zoomVelocity < 0, 'renderer fixture must be midway through zoom recovery');
    return state;
}

for (const preset of ['straight', 'angled']) {
    for (const rate of [.5, 1, 2]) {
        test(`${preset} at ${rate}x: disappearing geometry preserves the active return, then settles`, () => {
            const changed = renderer(preset, rate), reference = renderer(preset, rate);
            const before = warmReturn(changed, rate);
            warmReturn(reference, rate);
            const evidence = changed.planCache().cameraEvidence;
            const areas = changed.planCache().tappingAreas;
            changed.setPoints(points(30));
            const atChange = changed.frame(4.9, 0);
            near(atChange.distance, before.distance, 'geometry disappearing cannot snap inward');
            near(atChange.zoomVelocity, before.zoomVelocity, 'geometry disappearing retains return velocity');
            let settled = atChange;
            for (let frame = 1; frame <= 360; frame++) {
                const time = 4.9 + frame / 120;
                settled = changed.frame(time, 1 / (120 * rate));
                const unchanged = reference.frame(time, 1 / (120 * rate));
                if (time <= 5.25) {
                    near(settled.distance, unchanged.distance, 'the current return keeps its original curve');
                    near(settled.zoomVelocity, unchanged.zoomVelocity, 'the current return keeps its velocity');
                }
                assert.equal(changed.planCache().cameraEvidence, evidence, 'zoom never rebuilds chart evidence');
                assert.equal(changed.planCache().tappingAreas, areas, 'zoom never rebuilds tapping evidence');
            }
            const direct = renderer(preset, rate);
            direct.setPoints(points(30));
            near(settled.distance, direct.frame(7.9, 0).distance, 'queued recovery reaches the ordinary close view');
            near(settled.zoomVelocity, 0, 'queued recovery ends finitely');
        });
    }

    test(`${preset}: queued zoom recovery follows song time through a live speed change`, () => {
        for (const rate of [.5, 2]) {
            const changed = renderer(preset), reference = renderer(preset);
            const before = warmReturn(changed);
            warmReturn(reference);
            changed.setPoints(points(30)); reference.setPoints(points(30));
            changed.settings({rate});
            const atChange = changed.frame(4.9, 0);
            reference.frame(4.9, 0);
            near(atChange.distance, before.distance, 'rate and geometry changes preserve position');
            for (let frame = 1; frame <= 360; frame++) {
                const time = 4.9 + frame / 120;
                const a = changed.frame(time, 1 / (120 * rate));
                const b = reference.frame(time, 1 / 120);
                near(a.distance, b.distance, `distance at song time ${time}`);
                near(a.zoomVelocity, b.zoomVelocity, `song-space velocity at ${time}`);
            }
        }
    });

    test(`${preset}: pause holds a queued return and resumes from the same distance`, () => {
        const h = renderer(preset);
        warmReturn(h);
        h.setPoints(points(30));
        const before = h.frame(4.9, 0);
        for (let frame = 0; frame < 120; frame++) {
            const held = h.frame(4.9, 1 / 60, false);
            near(held.distance, before.distance, 'pause freezes a queued return');
        }
        near(h.frame(4.9, 0).distance, before.distance, 'resume itself cannot move the camera');
        let settled;
        for (let frame = 1; frame <= 360; frame++) settled = h.frame(4.9 + frame / 120, 1 / 120);
        near(settled.distance, settled.targetDistance, 'resumed recovery still completes');
    });

    test(`${preset}: repeated outward excursions interrupt a queued return and renew the quiet hold`, () => {
        const h = renderer(preset);
        warmReturn(h);
        h.setPoints(points(30)); h.frame(4.9, 0);
        let lastWide = 0, settled;
        for (let frame = 1; frame <= 360; frame++) {
            const time = 4.9 + frame / 120;
            const wide = time >= 5 && time < 5.2 || time >= 5.4 && time < 5.6;
            const geometry = points(wide ? 310 : 30);
            h.setPoints(geometry);
            settled = h.frame(time, 1 / 120);
            if (wide) {
                lastWide = settled.distance;
                for (const point of geometry) assert.ok(h.viewFits(point, settled),
                    'a captured inward destination cannot prevent necessary outward visibility');
            } else if (time >= 5.6 && time < 6.05) {
                assert.ok(settled.distance >= lastWide - 1e-8,
                    'closely repeated excursions renew the quiet hold before narrowing');
            }
        }
        assert.ok(lastWide > settled.distance * 1.1, 'the fixture must exercise a real outward correction');
        near(settled.distance, settled.targetDistance, 'the final quiet passage still settles finitely');
    });

    test(`${preset}: disabling zoom clears pending recovery across seek and loop wrap`, () => {
        const h = renderer(preset);
        warmReturn(h);
        h.setPoints(points(30));
        const before = h.frame(4.9, 0);
        h.settings({autoZoom: false});
        for (const time of [4.9, 4.92, 12, .2, .22]) {
            const held = h.frame(time, 1 / 60);
            near(held.distance, before.distance, 'disabled zoom retains the selected distance');
            assert.equal(held.zoomVelocity, 0);
        }
        h.settings({autoZoom: true});
        const resumed = h.frame(.22, 0);
        near(resumed.distance, before.distance, 'reenabling zoom cannot restore an old segment discontinuously');
        let settled;
        for (let frame = 1; frame <= 360; frame++) settled = h.frame(.22 + frame / 120, 1 / 120);
        near(settled.distance, settled.targetDistance, 'reenabled zoom starts a fresh finite return');
    });

    test(`${preset}: seek and loop wrap replace a queued recovery with the destination framing`, () => {
        for (const targetTime of [12, .2]) {
            const h = renderer(preset);
            warmReturn(h);
            h.setPoints(points(30)); h.frame(4.9, 0);
            const sought = h.frame(targetTime, 1 / 60);
            const direct = renderer(preset); direct.setPoints(points(30));
            near(sought.distance, direct.frame(targetTime, 0).distance, 'seek establishes the destination view');
            for (let frame = 1; frame <= 240; frame++) {
                const state = h.frame(targetTime + frame / 120, 1 / 120);
                near(state.distance, sought.distance, 'an old queued target cannot reappear after seeking');
                near(state.zoomVelocity, 0, 'seek clears pending zoom motion');
            }
        }
    });
}
