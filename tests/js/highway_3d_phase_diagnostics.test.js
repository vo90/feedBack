'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const hostSource = fs.readFileSync(path.join(__dirname, '../../static/highway.js'), 'utf8');
function slice(from, to) {
    const a = source.indexOf(from), b = source.indexOf(to, a);
    assert.ok(a >= 0 && b > a, from);
    return source.slice(a, b);
}
const ringSource = slice('    function createPhaseRing(', '    // End renderer phase ring.');
const benchSource = slice('        const _perfBench =', '\n        function pool(');
const drawSource = slice('            draw(bundle) {', '            // Explicit start after warmup;');
const apiSource = slice('            startPhaseDiagnostics()', '            setClockDiagnostics(');
const noop = () => {};

function harness(search = '?h3dbench=ring') {
    let now = 0, reads = 0, storage = 0;
    const logs = [];
    class Storage extends Float64Array {
        constructor(n) { super(n); storage++; }
        static get [Symbol.species]() { return Float64Array; }
    }
    const ctx = vm.createContext({
        URLSearchParams, Float64Array: Storage, location: { search },
        performance: { now() { reads++; return now; }, timeOrigin: 123000 },
        console: { log: s => logs.push(s) },
    });
    vm.runInContext(ringSource + benchSource + `
        globalThis.marks = { pbBeg, pbEnd, pbReportTick, pbFrameBeg, pbFrameEnd, pbCameraBeg, pbCameraEnd };
        globalThis.api = { ${apiSource} };
        globalThis.ring = _phaseRing;
    `, ctx);
    return { ctx, marks: ctx.marks, api: ctx.api, ring: ctx.ring, logs,
        at(n) { now = n; }, advance(n) { now += n; },
        get reads() { return reads; }, get storage() { return storage; } };
}
function bundle() {
    return { currentTime: 12.5, playbackRate: .75, isPlaying: true,
        transport: { epoch: 3, sequence: 47, generation: 5, freshAt: 99 } };
}
function row(snapshot, index = 0) {
    return Object.fromEntries(snapshot.columns.map((key, i) => [key, snapshot.rows[index][i]]));
}

test('fake-clock bounds preserve nested phases and copy only frame metadata', () => {
    const h = harness(), b = bundle(), m = h.marks;
    assert.equal(h.reads, 0, 'creation does not start recording');
    assert.equal(h.api.startPhaseDiagnostics(), true);
    h.at(100); m.pbFrameBeg(b);
    h.at(101); m.pbBeg(0);
    h.at(102); m.pbBeg(1);
    h.at(103); m.pbEnd(1);
    h.at(106); m.pbEnd(0);
    h.at(107); m.pbCameraBeg();
    h.at(109); m.pbCameraEnd();
    h.at(110); m.pbBeg(6, 1);
    h.at(114); m.pbEnd(6);
    h.at(116); m.pbFrameEnd();
    b.currentTime = 900; b.transport.sequence = 999;
    const snapshot = h.api.getPhaseDiagnostics(), r = row(snapshot);
    assert.equal(snapshot.timeOrigin, 123000);
    assert.equal(snapshot.capacity, 4096);
    assert.equal(snapshot.rows.length, 1);
    assert.equal(r.complete, 1);
    assert.equal(r.chartTime, 12.5); assert.equal(r.sequence, 47);
    assert.equal(r.epoch, 3); assert.equal(r.generation, 5);
    assert.equal(r.rate, .75); assert.equal(r.playing, 1); assert.equal(r.freshAtMs, 99);
    assert.equal(r.drawEndMs - r.drawBeginMs, 16);
    assert.equal(r.updateEndMs - r.updateBeginMs, 5);
    assert.equal(r.stateEndMs - r.stateBeginMs, 1);
    assert.equal(r.cameraEndMs - r.cameraBeginMs, 2);
    assert.equal(r.renderEndMs - r.renderBeginMs, 4);
    assert.equal(r.renderMode, 1);
    assert.ok(Number.isNaN(r.nextBeginMs), 'absent phases are not zero-duration work');
    assert.equal(h.storage, 1, 'all frame writes reuse the one ring');
    assert.deepEqual(h.logs, []);
});

test('ring wraps in order, reports overwritten frames and leaves failed draws incomplete', () => {
    const h = harness(''), ring = vm.runInContext('createPhaseRing(3)', h.ctx);
    ring.start();
    for (let i = 0; i < 5; i++) {
        h.at(i * 10); ring.frameBegin(bundle());
        ring.begin(0);
        if (i !== 3) { h.at(i * 10 + 3); ring.end(0); ring.frameEnd(); }
    }
    const snapshot = ring.take();
    assert.equal(snapshot.totalFrames, 5); assert.equal(snapshot.overwritten, 2);
    assert.deepEqual(Array.from(snapshot.rows, r => r[0]), [2, 3, 4]);
    assert.equal(row(snapshot, 1).complete, 0);
    assert.ok(Number.isNaN(row(snapshot, 1).drawEndMs));
    assert.ok(Number.isNaN(row(snapshot, 1).updateEndMs));
    assert.equal(row(snapshot, 2).complete, 1);
});

test('pull freezes before snapshot allocation, is detached, and start explicitly resets', () => {
    const h = harness(), m = h.marks;
    h.api.startPhaseDiagnostics(); h.at(10); m.pbFrameBeg(bundle());
    h.at(12); m.pbFrameEnd(); h.at(20);
    // Attempt a renderer mark from Array.from itself: take must already be frozen.
    let allocations = 0;
    h.ctx.Array = class extends Array {
        static from(input) { allocations++; m.pbFrameBeg(bundle()); return Array.from(input); }
    };
    const snapshot = h.api.getPhaseDiagnostics(), reads = h.reads;
    assert.equal(allocations, 1);
    assert.equal(snapshot.totalFrames, 1);
    assert.equal(snapshot.stoppedAtMs, 20);
    h.at(30); m.pbFrameBeg(bundle()); m.pbBeg(0); m.pbEnd(0); m.pbFrameEnd();
    assert.equal(h.reads, reads, 'frozen marks make no clock reads');
    snapshot.rows[0][0] = 999; snapshot.columns[0] = 'changed';
    const again = h.api.getPhaseDiagnostics();
    assert.equal(again.rows[0][0], 0); assert.equal(again.columns[0], 'frame');
    assert.equal(again.stoppedAtMs, 20);
    h.api.startPhaseDiagnostics();
    const reset = h.api.getPhaseDiagnostics();
    assert.equal(reset.totalFrames, 0); assert.equal(reset.rows.length, 0);
    assert.equal(h.storage, 1);
});

for (const search of ['', '?h3dbench=0', '?h3dbench=unknown']) {
    test(`disabled mode binds empty marks and allocates no ring (${search || 'no flag'})`, () => {
        const h = harness(search), m = h.marks;
        const unreadable = new Proxy({}, { get() { assert.fail('disabled mark read bundle'); } });
        for (let i = 0; i < 3; i++) {
            m.pbFrameBeg(unreadable); m.pbBeg(0); m.pbEnd(0); m.pbCameraBeg();
            m.pbCameraEnd(); m.pbBeg(6, 2); m.pbEnd(6); m.pbFrameEnd(); m.pbReportTick();
        }
        assert.equal(h.api.startPhaseDiagnostics(), false);
        assert.equal(h.api.getPhaseDiagnostics(), null);
        assert.equal(h.storage, 0); assert.equal(h.reads, 0);
        assert.equal(m.pbBeg, m.pbEnd); assert.equal(m.pbEnd, m.pbReportTick);
        assert.deepEqual(h.logs, []);
    });
}

test('legacy console mode retains seven segments and new frame/camera marks do nothing', () => {
    const h = harness('?h3dbench=1'), m = h.marks;
    m.pbFrameBeg(bundle()); m.pbCameraBeg(); m.pbCameraEnd(); m.pbFrameEnd();
    assert.equal(h.reads, 0);
    assert.equal(h.api.startPhaseDiagnostics(), false);
    assert.equal(h.api.getPhaseDiagnostics(), null);
    h.at(1); m.pbReportTick();
    for (let i = 0; i < 7; i++) { h.at(2); m.pbBeg(i, 2); h.at(4); m.pbEnd(i); }
    h.at(5001); m.pbReportTick();
    assert.equal(h.logs.length, 1);
    for (const name of ['frame', 'state', 'next', 'mat', 'noteDraw', 'chordDraw', 'render']) {
        assert.ok(h.logs[0].includes(`${name} p50=2.00 p95=2.00 max=2.00`));
    }
    assert.ok(!h.logs[0].includes('camera'));
});

function drawHarness(composer = false) {
    const h = harness(), c = h.ctx;
    Object.assign(c, {
        _isReady: true, _ctxLost: false, _chartPrewarmed: true,
        _invertedCached: false, _leftyCached: false, _leftyForBoard: false,
        _invertedForBoard: false, nStr: 6, _renderScale: 1,
        resolveStringCount: () => 6, _prewarmRsNotation: noop, highwayCanvas: null,
        coincidentSustainView: bundle => bundle,
        update() { h.marks.pbBeg(0); h.advance(4); h.marks.pbEnd(0); },
        camUpdate() { h.advance(2); }, _layoutIncomingFretLabels: noop,
        bgGroup: null, bcCtrl: null, _juiceLastT: 0, _sparkUpdate: noop,
        _streakHeat: 0, _streakHits: 0, _usesRsDefaultHighway: () => false,
        rsPlusNotation: !composer, _bloom: composer, _ssActive: () => false,
        _bloomEnsure: () => ({ render() { h.advance(3); } }),
        canvasSize: () => null, T: { ACESFilmicToneMapping: 1, NoToneMapping: 0 },
        ren: { render() { h.advance(3); } }, scene: {}, cam: {},
        drawTechniqueCaptions: noop, lyricsCtx: { clearRect: noop },
        // Harmony rendering has its own geometry/lifecycle suite. Keep these
        // optional overlays inert while measuring the production phase clock.
        updateHarmonicGuide: noop, drawHarmonicGuideLabels: noop, harmonicGuideTopInset: () => 0,
        lyricsCanvas: { width: 10, height: 10 }, drawNotedetectLabels: noop, drawScoreFx: noop,
        _fpsLastT: 0, fpsVisible: false, sectionHudVisible: false,
        toneHudVisible: false, chordDiagramVisible: false,
        window: { highway: { fireDrawHooks() { h.advance(1); } } },
    });
    vm.runInContext(`globalThis.renderer = { ${drawSource} };`, c);
    return h;
}

for (const composer of [false, true]) {
    test(`production draw records camera and ${composer ? 'composer' : 'direct'} render, including trailing hooks`, () => {
        const h = drawHarness(composer);
        h.api.startPhaseDiagnostics(); h.at(100);
        h.ctx.renderer.draw(bundle());
        const r = row(h.api.getPhaseDiagnostics());
        assert.equal(r.drawEndMs - r.drawBeginMs, 10);
        assert.equal(r.updateEndMs - r.updateBeginMs, 4);
        assert.equal(r.cameraEndMs - r.cameraBeginMs, 2);
        assert.equal(r.renderEndMs - r.renderBeginMs, 3);
        assert.equal(r.renderMode, composer ? 2 : 1);
        assert.equal(r.complete, 1);
    });
}

test('production draw skips not-ready/context-lost frames and preserves thrown errors', () => {
    const h = drawHarness(); h.api.startPhaseDiagnostics();
    h.ctx._isReady = false; h.ctx.renderer.draw(bundle());
    h.ctx._isReady = true; h.ctx._ctxLost = true; h.ctx.renderer.draw(bundle());
    h.ctx._ctxLost = false;
    const error = new Error('camera failed');
    h.ctx.camUpdate = () => { throw error; };
    assert.throws(() => h.ctx.renderer.draw(bundle()), e => e === error);
    const snapshot = h.api.getPhaseDiagnostics();
    assert.equal(snapshot.totalFrames, 1);
    assert.equal(row(snapshot).complete, 0);
    assert.ok(Number.isNaN(row(snapshot).cameraEndMs));
});

test('disposal disables old methods and a recreated renderer owns independent storage', () => {
    const h = harness(); h.api.startPhaseDiagnostics(); h.marks.pbFrameBeg(bundle());
    const destroyStart = slice('            destroy() {\n                if (_phaseRing)', '                _presentationClock.trace(false);');
    vm.runInContext(destroyStart.replace('destroy()', 'function disposeRenderer()') + '}', h.ctx);
    h.ctx.disposeRenderer();
    const reads = h.reads;
    h.marks.pbFrameEnd(); h.marks.pbCameraBeg();
    assert.equal(h.api.startPhaseDiagnostics(), false);
    assert.equal(h.api.getPhaseDiagnostics(), null);
    assert.equal(h.reads, reads);
    const next = harness(); assert.equal(next.api.startPhaseDiagnostics(), true);
    assert.equal(next.api.getPhaseDiagnostics().totalFrames, 0);
});

test('public host delegates on demand and tolerates renderers without diagnostics', () => {
    const start = hostSource.indexOf('        startPhaseDiagnostics()');
    const end = hostSource.indexOf('        setTime(', start);
    assert.ok(start >= 0 && end > start);
    const state = { _renderer: null };
    const api = new Function('hwState', `return {${hostSource.slice(start, end)}};`)(state);
    assert.equal(api.startPhaseDiagnostics(), false); assert.equal(api.getPhaseDiagnostics(), null);
    let calls = 0;
    const result = { rows: [] };
    state._renderer = { startPhaseDiagnostics() { calls++; return true; }, getPhaseDiagnostics() { calls++; return result; } };
    assert.equal(calls, 0);
    assert.equal(api.startPhaseDiagnostics(), true); assert.equal(api.getPhaseDiagnostics(), result);
    assert.equal(calls, 2);
});
