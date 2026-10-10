// Execute the production bundle/draw/clock functions without a DOM or WebGL.
// rAF timestamps are diagnostic metadata, never an audio or wall-clock anchor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'static/highway.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
function extract(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, signature);
    let at = source.indexOf('{', start), depth = 0;
    do {
        if (source[at] === '{') depth++;
        else if (source[at] === '}') depth--;
        at++;
    } while (depth && at < source.length);
    assert.equal(depth, 0, signature);
    return source.slice(start, at);
}

function highway() {
    const draws = [], queued = [], defaults = [];
    const noop = () => {};
    const hwState = {
        canvas: { offsetParent: {} }, ready: true, _lastVisible: true,
        _frameIdx: 0, _chartAnchorPerfNow: NaN, _chartLastAdvanceAt: 0,
        _playbackRate: 1, _rendererDrawFailures: 0, songInfo: {},
        _renderer: { draw: b => draws.push({ bundle: b, frame: b.frameTimestampMs, time: b.currentTime }) },
    };
    const context = vm.createContext({
        hwState, performance: { now: () => 1000 },
        requestAnimationFrame: callback => queued.push(callback),
        api: { getPresentationTime: () => 12.25 },
        _CHART_MAX_INTERP_MS: 100, _PAUSED_FRAME_INTERVAL_MS: 100,
        _defaultRenderer: { draw: b => defaults.push(b) },
        _effectiveRenderScale: () => 1,
        _emitVisibilityIfChanged: noop, _adaptRenderScale: noop, _updatePerfHud: noop,
        _rendererNeedsContinuousFrames: () => false,
        project: noop, boundFretX: noop, bsearch: noop, bsearchTime: noop,
        boundNoteState: noop, _getNoteStateProvider: noop,
    });
    vm.runInContext(`const _bundleReused = {};
        ${extract(core, 'function _makeBundle(')}
        ${extract(core, 'function draw(')}
        globalThis.harness = { draw, init: () => _makeBundle(), peek: () => _bundleReused,
            useDefault() { hwState._renderer = _defaultRenderer; } };`, context);
    return { ...context.harness, hwState, draws, queued, defaults };
}

function visualClock() {
    let wall = 0, reads = 0, allocations = 0;
    const context = vm.createContext({
        performance: { now() { reads++; return wall; } },
        Float64Array: function (length) { allocations++; return new Float64Array(length); },
        _clkAudioT: NaN, _clkPerf: NaN, _clkRate: 1,
        _clkFramePerf: NaN, _clkRateAudioT: NaN, _clkRatePerf: NaN, _frameNow: 0,
    });
    vm.runInContext(`${extract(renderer, 'function createPresentationClock()')}
        const _presentationClock = createPresentationClock();
        ${extract(renderer, 'function smoothNow(bundle)')}
        globalThis.harness = { sample: smoothNow, clock: _presentationClock };`, context);
    return { ...context.harness, setWall(value) { wall = value; },
        reads: () => reads, allocations: () => allocations };
}

test('draw propagates its own timestamp; reused initialization bundles always clear it', () => {
    const h = highway();
    const initial = h.init();
    assert.ok(Number.isNaN(initial.frameTimestampMs));
    h.draw(500.25);
    assert.equal(h.draws[0].bundle, initial);
    assert.equal(h.draws[0].frame, 500.25);
    assert.equal(h.draws[0].time, 12.25);
    h.queued.at(-1)(510.25);
    assert.equal(h.draws[1].frame, 510.25, 'the queued callback receives its own timestamp');
    assert.equal(h.init(), initial, 'renderer initialization reuses the same bundle');
    assert.ok(Number.isNaN(initial.frameTimestampMs), 'initialization must not retain the last drawn frame');
    h.draw(0);
    assert.equal(h.draws.at(-1).frame, 0, 'zero is a valid frame timestamp');
});

test('absent and invalid manual draw timestamps clear earlier metadata without coercion', () => {
    const h = highway();
    for (const invalid of [undefined, null, NaN, Infinity, -Infinity, '125', {}]) {
        h.draw(125);
        h.draw(invalid);
        assert.ok(Number.isNaN(h.draws.at(-1).frame));
        assert.equal(h.draws.at(-1).time, 12.25);
    }
});

test('skipped/default draws do not publish timestamps; highway instances do not share metadata', () => {
    const a = highway(), b = highway();
    a.draw(101); b.draw(202);
    assert.notEqual(a.peek(), b.peek());
    a.hwState.ready = false;
    a.draw(303);
    assert.equal(a.draws.length, 1);
    assert.equal(a.peek().frameTimestampMs, 101);
    a.hwState.ready = true; a.hwState._lastVisible = false;
    a.draw(404);
    assert.equal(a.draws.length, 1);
    a.init();
    assert.ok(Number.isNaN(a.peek().frameTimestampMs));
    assert.equal(b.peek().frameTimestampMs, 202);
    const d = highway();
    d.useDefault(); d.draw(505);
    assert.equal(d.defaults.length, 1);
    assert.equal(d.defaults[0], undefined);
    assert.equal(Object.keys(d.peek()).length, 0, 'default renderer still bypasses bundle construction');
});

test('the same diagnostic row records independent rAF and wall clocks without changing visual timing', () => {
    const actual = visualClock(), reference = visualClock();
    actual.clock.trace(true); reference.clock.trace(true);
    const cases = [
        [0, 10, {}], [10, 10.01, {}], [20, 9.99, { state: 'paused' }],
        [600, 10.01, { sampledAt: 10, freshAt: 10 }], [610, 10.61, {}],
        [620, 2, { epoch: 2 }], [630, 1, { epoch: 2, state: 'rewind' }],
        [640, .5, { epoch: 3, state: 'count-in' }],
        [900, 2, { epoch: 4, state: 'ended', endTime: 2 }],
    ];
    for (const [wall, raw, options] of cases) {
        actual.setWall(wall); reference.setWall(wall);
        const bundle = { currentTime: raw, transport: { epoch: 1, state: 'playing', rate: 1,
            position: raw, sampledAt: wall, freshAt: wall, sequence: wall, generation: 1,
            endTime: Infinity, ...options } };
        const expected = reference.sample(bundle);
        assert.equal(actual.sample({ ...bundle, frameTimestampMs: wall + 100 }), expected,
            'a frame clock 100ms ahead must have no effect on the presentation clock');
    }
    const a = actual.clock.diagnostics(), b = reference.clock.diagnostics();
    const frameIndex = a.fields.indexOf('frameTimestampMs');
    assert.equal(frameIndex, 11, 'existing diagnostic column indices stay unchanged');
    assert.equal(actual.reads(), cases.length, 'smoothNow still samples wall time exactly once');
    for (let i = 0; i < cases.length; i++) {
        assert.deepEqual(Array.from(a.rows[i].slice(0, frameIndex)), Array.from(b.rows[i].slice(0, frameIndex)));
        assert.equal(a.rows[i][a.fields.indexOf('wallMs')], cases[i][0]);
        assert.equal(a.rows[i][frameIndex], cases[i][0] + 100);
        assert.ok(Number.isNaN(b.rows[i][frameIndex]));
    }
});

test('clock trace metadata resets and remains independent, opt-in and bounded', () => {
    const a = visualClock(), b = visualClock();
    function sample(h, at, frame) {
        h.setWall(at);
        return h.sample({ currentTime: at / 1000, frameTimestampMs: frame,
            transport: { epoch: 1, state: 'playing', position: at / 1000, sampledAt: at, freshAt: at, rate: 1 } });
    }
    sample(a, 0, 100);
    assert.equal(a.clock.diagnostics(), null);
    assert.equal(a.allocations(), 0, 'disabled diagnostics allocate no typed-array storage');
    a.clock.trace(true); b.clock.trace(true);
    for (let i = 0; i < 4100; i++) sample(a, i * 10, i * 10 + 100);
    sample(b, 25, 222);
    const d = a.clock.diagnostics();
    assert.equal(d.count, 4100); assert.equal(d.rows.length, 4096);
    assert.equal(d.rows[0][11], 140); assert.equal(d.rows.at(-1)[11], 41090);
    assert.equal(b.clock.diagnostics().rows[0][11], 222);
    assert.equal(a.allocations(), 1, 'recording reuses one fixed ring');
    a.clock.reset(); sample(a, 0, undefined);
    assert.equal(a.clock.diagnostics().count, 1);
    assert.ok(Number.isNaN(a.clock.diagnostics().rows[0][11]));
    a.clock.trace(false); sample(a, 10, 110);
    assert.equal(a.clock.diagnostics(), null);
    assert.equal(a.allocations(), 1);
});
