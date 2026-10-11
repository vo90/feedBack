'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function between(startText, endText) {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `Missing FPS source section: ${startText}`);
    return source.slice(start, end);
}
const declarations = between('let _fpsLastT = 0;', 'let _fpsTextCache = null;');
const frame = between('// 1. FPS counter (always top-right', '// 2. Section HUD.');

// Execute the production sampling AND display block. Only drawing/environment
// dependencies are replaced; no copied estimator serves as the implementation.
function harness() {
    const state = {now: 1000}, draws = [];
    const tick = new Function('performance', 'draws', `
        ${declarations}
        const lyricsCanvas = {width: 1200, height: 800}, lyricsCtx = {};
        const lyricsBottom = 0, _v3TopRightChromeBottom = () => 0;
        const _drawFpsCounter = (ctx, value, right, y) => {
            draws.push({value, right, y}); return 22;
        };
        return fpsVisible => {
            const cornerStack = {tr: 0};
            const stackPush = (pos, height) => {cornerStack[pos] += height + 8;};
            ${frame}
            return {display: _fpsDisplay, sampledAt: _fpsLastSampleT,
                lastFrameAt: _fpsLastT, stacked: cornerStack.tr};
        };
    `)({now: () => state.now}, draws);
    return {
        draws,
        tick(now, visible = true) {state.now = now; return tick(visible);},
        advance(dt, count, visible = true) {
            let result;
            for (let i = 0; i < count; i++) result = this.tick(state.now + dt, visible);
            return result;
        },
    };
}
function close(actual, expected, tolerance = 1e-8) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('uniform cadence reads its frame-count / elapsed-time rate', () => {
    for (const dt of [10, 1000 / 60, 25]) {
        const h = harness();
        assert.equal(h.tick(1000).display, 0);
        const result = h.advance(dt, 120);
        close(result.display, 1000 / dt);
        assert.equal(h.draws.at(-1).value, result.display);
        assert.equal(result.stacked, 30);
        assert.deepEqual({right: h.draws.at(-1).right, y: h.draws.at(-1).y}, {right: 1192, y: 56});
    }
});

test('alternating short/long intervals do not inflate a 100 Hz readout to 133 FPS', () => {
    const h = harness(); h.tick(1000);
    let now = 1000;
    const settled = [];
    for (let i = 0; i < 2000; i++) {
        now += i % 2 ? 15 : 5;
        const result = h.tick(now);
        if (i >= 1000) settled.push(result.display);
    }
    assert.equal(2000 * 1000 / (now - 1000), 100);
    // A 30-frame EMA has a small alternating phase ripple; it is not a
    // fixed-window frame count and need not report exactly 100 each sample.
    assert.ok(settled.every(fps => fps > 99 && fps < 101));
});

test('a long interval contributes its elapsed time and the readout recovers', () => {
    const h = harness(); h.tick(1000); h.advance(10, 120);
    const afterHitch = h.advance(1000, 1);
    close(afterHitch.display, 1000 / (10 + (1000 - 10) / 30));
    const recovered = h.advance(10, 600);
    close(recovered.display, 100, 1e-5);
});

test('zero/backward intervals are ignored while the existing timestamp lifecycle is retained', () => {
    const h = harness(); h.tick(1000); h.advance(10, 120);
    const same = h.tick(2200), backward = h.tick(2190);
    assert.equal(same.display, 100); assert.equal(backward.display, 100);
    assert.equal(backward.lastFrameAt, 2190);
    close(h.advance(10, 60).display, 100);
});

test('hidden sampling stays current without drawing or refreshing the displayed value', () => {
    const h = harness(); h.tick(1000, false);
    const hidden = h.advance(20, 120, false);
    assert.equal(hidden.display, 0); assert.equal(hidden.sampledAt, 0);
    assert.equal(hidden.stacked, 0); assert.equal(h.draws.length, 0);
    const shown = h.advance(20, 1, true);
    close(shown.display, 50); assert.equal(h.draws.length, 1);
});

test('display refresh keeps the strict 250 ms boundary and renderer instances start independently', () => {
    const h = harness(); h.tick(1000);
    const boundary = h.advance(10, 25);
    assert.equal(boundary.display, 0); assert.equal(boundary.sampledAt, 1000);
    const next = h.tick(1251);
    assert.ok(next.display > 0); assert.equal(next.sampledAt, 1251);
    const fresh = harness();
    assert.equal(fresh.tick(5000).display, 0);
    close(fresh.advance(20, 30).display, 50);
    // performance.now()==0 retains the original first-timestamp sentinel.
    const zero = harness(); zero.tick(0); zero.tick(10);
    close(zero.advance(10, 26).display, 100);
});
