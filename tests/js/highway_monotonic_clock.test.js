// Verify static/highway.js's getTime() interpolates smoothly via
// performance.now() between setTime() calls (so plugins observe sub-
// frame clock motion despite audio.currentTime's coarse step
// quantization — browsers refresh the reported value at ~20+ ms
// granularity even though the underlying audio thread runs faster).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nativeHarness } = require('./helpers/native-backing-harness');

const HIGHWAY_JS = path.join(__dirname, '..', '..', 'static', 'highway.js');

// Brace-balanced extraction so source-level tests stay robust to body
// growth. Returns the full method-or-block text including its braces.
function extractBlock(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start !== -1, `signature '${signature}' not found`);
    const openBrace = src.indexOf('{', start);
    assert.ok(openBrace !== -1, `opening brace after '${signature}' not found`);
    let depth = 1;
    let i = openBrace + 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.ok(depth === 0, `unbalanced braces after '${signature}'`);
    return src.slice(start, i);
}

// Build a sandbox with the chart-clock state and the extracted setTime,
// freezeTime, and getTime methods so behavioral tests can exercise the real
// implementation in isolation.
function buildClockSandbox(perfNowImpl) {
    // The lifted per-instance state now lives on `hwState` (the R3c H lift);
    // the extracted setTime/getTime bodies reference hwState.<slot>. The const
    // _CHART_MAX_INTERP_MS was NOT lifted, so it stays a top-level global here.
    const hwState = {
        chartTime: 0,
        currentTime: 0,
        avOffsetSec: 0,
        // Per-song chart offset (loose-folder format only). Tests pin
        // this at 0 so the clock-behaviour assertions can stay
        // expressed in raw audio time without offset bookkeeping.
        songOffset: 0,
        // Match production: NaN sentinels for "no prior anchor" so
        // the first setTime call always re-anchors (even setTime(0))
        // and so getTime() before any setTime returns chartTime.
        _chartAnchorAudioT: NaN,
        _chartAnchorPerfNow: NaN,
        _chartLastAdvanceAt: 0,
        _chartObservedRate: 1,
        _presentationEpoch: 0,
        _playbackState: null,
        _nativeClock: null,
        _transportBundle: {},
        songInfo: {duration: 300},
    };
    const sandbox = {
        hwState,
        _CHART_MAX_INTERP_MS: 100,
        performance: { now: perfNowImpl },
    };
    vm.createContext(sandbox);
    const src = highwaySources();
    const setTimeBody = extractBlock(src, 'setTime(t) {');
    const setRateBody = extractBlock(src, 'setPlaybackRate(playbackRate) {');
    const freezeTimeBody = extractBlock(src, 'freezeTime(t) {');
    const getTimeBody = extractBlock(src, 'getTime() {');
    // Strip trailing comma if present (object-literal method declarations).
    const cleanup = (s) => s.replace(/,?\s*$/, '');
    vm.runInContext(`
        globalThis.api = { ${extractBlock(src, 'resetPresentation(reason) {')} };
        globalThis.setTime = function ${cleanup(setTimeBody)};
        globalThis.setPlaybackRate = function ${cleanup(setRateBody)};
        globalThis.freezeTime = function ${cleanup(freezeTimeBody)};
        globalThis.getTime = function ${cleanup(getTimeBody)};
        api.getTime = getTime;
        api.getPresentationTime = function ${extractBlock(src, 'getPresentationTime(inputAgeMs = 0, eventAtMs = performance.now()) {')};
        api.isPresentationComplete = function ${extractBlock(src, 'isPresentationComplete() {')};
        globalThis.setPlaybackState = function ${extractBlock(src, 'setPlaybackState(state) {')};
        globalThis.setPlaybackSample = function ${extractBlock(src, 'setPlaybackSample(clock, playing) {')};
        globalThis.setAvOffset = function ${extractBlock(src, 'setAvOffset(ms) {')};
        globalThis.timingBundle = function() {
            const b = {};
            ${src.slice(src.indexOf('        b.transport = null;'), src.indexOf('        // Chart content (filter-aware'))}
            return b;
        };
        globalThis.drawTimingBundle = function() {
            ${src.slice(src.indexOf('        // Both renderers use the output presentation clock'),
                src.indexOf('        // Skip bundle allocation when the default renderer is active'))}
            return timingBundle();
        };
    `, sandbox);
    return sandbox;
}

function rendererClock() {
    const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
    const start = src.indexOf('    function createPresentationClock() {');
    return vm.runInNewContext(`(${src.slice(start, src.indexOf('    // End presentation clock.', start)).trim()})`)();
}

test('paused native seek keeps the actual highway rest gate on the sought chart position', async () => {
    const modelSource = fs.readFileSync(path.join(__dirname, '../../static/js/harmony-guide-model.js'), 'utf8');
    const {prepareRestWindows, resolveRest} = await import('data:text/javascript;base64,'
        + Buffer.from(modelSource).toString('base64'));
    // A Yesterday-style lead rest, with occupied context on each side.
    const rests = prepareRestWindows({notes: [{t:0, sus:26.706}, {t:29.117, sus:10}],
        beats: Array.from({length:80}, (_, i) => ({time:i / 2})), duration:40});
    const h = nativeHarness(), lease = await h.acquire();
    await lease.play();
    h.player._acceptSnapshot({position:34.28926725, ageMs:0, sequence:1, generation:1,
        playing:true, presentation:{version:2, position:34.2150696, ageMs:0,
            playing:true, routeGeneration:1}}, 0);
    await lease.pause();
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(h.player.currentTime);
    sb.setPlaybackSample(h.player.getClockSnapshot(), false);
    assert.equal(resolveRest(rests, sb.api.getPresentationTime()).active, false);

    await lease.seek(27.739026692708332);
    sb.api.resetPresentation('timeline');
    for (now of [100, 1000, 10000]) {
        // Same bridge as app.js: chart time then the native output snapshot.
        sb.setTime(h.player.currentTime);
        sb.setPlaybackSample(h.player.getClockSnapshot(), false);
        const shown = sb.api.getPresentationTime();
        assert.equal(shown, h.player.currentTime);
        assert.equal(resolveRest(rests, shown).opacity, 1);
    }
    await lease.seek(29.117);
    sb.api.resetPresentation('timeline');
    sb.setTime(h.player.currentTime);
    sb.setPlaybackSample(h.player.getClockSnapshot(), false);
    assert.equal(resolveRest(rests, sb.api.getPresentationTime()).active, false);
});

test('native output samples remain smooth through the actual core-to-renderer timing bridge', () => {
    for (const hz of [30, 60, 100, 144]) for (const rate of [.5, 1, 2]) for (const offset of [-150, 0, 100]) {
        let now = 0;
        const sb = buildClockSandbox(() => now), clock = rendererClock();
        sb.setPlaybackRate(rate); sb.setAvOffset(offset);
        let previous;
        for (let frame = 0; frame < hz * 3; frame++) {
            now = frame * 1000 / hz;
            const sampledAt = Math.floor(now / 80) * 80;
            // Low output latency: the audible position reaches the last raw
            // sample well before the next IPC delivery. It must not stop there.
            const position = 10 + (sampledAt - 12) * rate / 1000;
            sb.setPlaybackSample({position, sampledAt, freshAt: sampledAt, rate,
                duration: 300, sequence: sampledAt, generation: 1, playing: true,
                timingVersion: 2, maxPosition: position + .012 * rate}, true);
            const expected = 10 + (now - 12 + offset) * rate / 1000;
            const raw = sb.api.getPresentationTime();
            const shown = clock.sample(raw, now, sb.timingBundle().transport);
            assert.ok(Math.abs(raw - expected) < 1e-8);
            assert.ok(Math.abs(shown - expected) < 1e-8);
            if (previous !== undefined) assert.ok(Math.abs(shown - previous - rate / hz) < 1e-8);
            previous = shown;
        }
    }
});

test('live native presentation remains bounded at source loss, pause and actual duration', () => {
    let now = 1000;
    const sb = buildClockSandbox(() => now), clock = rendererClock();
    const sample = {position: 10, sampledAt: now, freshAt: now, rate: 1,
        duration: 300, sequence: 1, generation: 1, playing: true, timingVersion: 2, maxPosition: 10.01};
    sb.setPlaybackSample(sample, true);
    for (; now <= 3000; now += 10) {
        const raw = sb.api.getPresentationTime();
        assert.ok(Math.abs(raw - (10 + Math.min(now - 1000, 250) / 1000)) < 1e-8);
        assert.ok(clock.sample(raw, now, sb.timingBundle().transport) <= 10.25 + 1e-8);
    }
    sb.setPlaybackSample({...sample, position: 11, sampledAt: now, freshAt: now, playing: false}, false);
    now += 1000; assert.equal(sb.api.getPresentationTime(), 11);
    sb.setPlaybackSample({...sample, position: 299.99, sampledAt: now, freshAt: now}, true);
    now += 200; assert.equal(sb.api.getPresentationTime(), 300);
});

test('presentation and judgment use one rate-scaled reference without moving the raw transport clock', () => {
    for (const rate of [.5, .75, 1, 1.5, 2]) for (const offset of [0, -100, -500, 100]) {
        const sb = buildClockSandbox(() => 1000);
        sb.setPlaybackRate(rate); sb.setAvOffset(offset); sb.setTime(20);
        const clock = {position: 10 + (2 - offset) * rate / 1000, sampledAt: 1000, freshAt: 1000,
            rate, duration: 300, sequence: 7, generation: 2, playing: true, timingVersion: 2, maxPosition: 20};
        sb.setPlaybackSample(clock, true);
        assert.equal(sb.getTime(), 20);
        assert.ok(Math.abs(sb.api.getPresentationTime(2) - 10) < 1e-10);
        assert.ok(Math.abs(sb.api.getPresentationTime() - (10 + .002 * rate)) < 1e-10);
    }
});

test('negative calibration lets the final heard notes finish after native EOF, with a bounded clock', () => {
    for (const rate of [.5, 1, 2]) {
        let now = 1000;
        const sb = buildClockSandbox(() => now);
        sb.setPlaybackRate(rate); sb.setAvOffset(-500); sb.setTime(10);
        const clock = {position: 10, sampledAt: 1000, freshAt: 1000, rate, duration: 10,
            sequence: 7, generation: 2, playing: false, ended: true, timingVersion: 2, maxPosition: 10};
        sb.setPlaybackSample(clock, true);
        assert.equal(sb.api.isPresentationComplete(), false);
        assert.equal(sb.timingBundle().isPlaying, true);
        assert.equal(sb.api.getPresentationTime(), 10 - .5 * rate);
        now = 1400;
        assert.ok(Math.abs(sb.api.getPresentationTime() - (10 - .1 * rate)) < 1e-10);
        now = 1500;
        assert.equal(sb.api.isPresentationComplete(), true);
        assert.equal(sb.api.getPresentationTime(), 10);
        now = 5000; assert.equal(sb.api.getPresentationTime(), 10);
    }
});

test('pausing the calibrated EOF tail holds the displayed position', () => {
    let now = 1000;
    const sb = buildClockSandbox(() => now);
    sb.setPlaybackRate(1); sb.setAvOffset(-500); sb.setTime(10);
    const clock = {position:10, sampledAt:1000, freshAt:1000, rate:1, duration:10,
        sequence:7,generation:2,playing:false,ended:true,timingVersion:2,maxPosition:10};
    sb.setPlaybackSample(clock,true);
    now = 1200; sb.setPlaybackSample(clock,false);
    now = 1800; assert.equal(sb.api.getPresentationTime(),9.7);
});

test('native presentation adds song and AV offsets once without changing judgement time', () => {
    let now = 1000;
    const sb = buildClockSandbox(() => now);
    sb.hwState.songOffset = .2;
    sb.setAvOffset(30); sb.setTime(10.1);
    const clock = {position: 10, sampledAt: 900, freshAt: 900, rate: 1,
        duration: 300, sequence: 7, generation: 2, playing: true};
    sb.setPlaybackSample(clock, true);
    const bundle = sb.timingBundle();
    assert.ok(Math.abs(bundle.transport.position - 10.23) < 1e-10);
    assert.equal(bundle.transport.endTime, 300.23);
    assert.ok(Math.abs(sb.getTime() - 10.3) < 1e-10);
    assert.equal(clock.position, 10, 'host must not modify the shared transport sample');
    clock.position = 50;
    assert.ok(Math.abs(sb.timingBundle().transport.position - 10.23) < 1e-10);
});

test('tick updates cannot release an in-flight seek or deliberate rewind', () => {
    const sb = buildClockSandbox(() => 1000);
    for (const state of ['seeking', 'rewind']) {
        sb.setPlaybackState(state); sb.setPlaybackSample(null, true);
        assert.equal(sb.timingBundle().transport.state, state);
    }
    sb.api.resetPresentation('seek'); sb.setTime(2); sb.setPlaybackState('paused');
    assert.equal(sb.timingBundle().transport.epoch, 1);
    assert.equal(sb.timingBundle().transport.position, 2);
    assert.equal(sb.timingBundle().isPlaying, false);
});

test('browser/stems anchors carry explicit state and calibration resets the epoch', () => {
    const sb = buildClockSandbox(() => 1000);
    sb.setTime(10); sb.setPlaybackRate(.5); sb.setPlaybackSample(null, true);
    assert.equal(sb.timingBundle().transport.sampledAt, 1000);
    assert.equal(sb.timingBundle().transport.rate, .5);
    sb.setPlaybackState('paused');
    assert.equal(sb.timingBundle().isPlaying, false);
    sb.setAvOffset(-50);
    assert.equal(sb.timingBundle().transport.epoch, 1);
    assert.equal(sb.timingBundle().transport.position, 9.975); // 50 physical ms at half speed
});

test('browser draw and renderer interpolate each anchored sample exactly once', () => {
    for (const rate of [1, .75]) for (const avMs of [-120, 0, 80]) for (const songOffset of [0, .3]) {
        let now = 0, nextPoll = 0, poll = 0, frame = 0;
        const sb = buildClockSandbox(() => now), clock = rendererClock();
        sb.hwState.songOffset = songOffset;
        sb.setPlaybackRate(rate); sb.setAvOffset(avMs);
        let previous, lastFrame = 0;
        const frames = [6, 14, 9, 20, 7, 10, 11], polls = [17, 31, 12, 29, 16];
        for (let frameAt = 0; frameAt < 3000; frameAt += frames[frame++ % frames.length]) {
            while (nextPoll <= frameAt) {
                now = nextPoll;
                sb.setTime(10 + now * rate / 1000); sb.setPlaybackSample(null, true);
                nextPoll += polls[poll++ % polls.length];
            }
            now = frameAt;
            const bundle = sb.drawTimingBundle(), t = bundle.transport;
            assert.ok(Math.abs(t.position - (10 + t.sampledAt * rate / 1000 + songOffset + avMs * rate / 1000)) < 1e-10,
                'position must describe the timestamped audio anchor, even after draw updated currentTime');
            const raw = sb.api.getPresentationTime();
            const shown = clock.sample(raw, now, t);
            const expected = 10 + now * rate / 1000 + songOffset + avMs * rate / 1000;
            assert.ok(Math.abs(shown - expected) < 1e-10, `${rate}x browser presentation drift at ${now}ms`);
            if (previous !== undefined) assert.ok(Math.abs((shown - previous) * 1000 / (now - lastFrame) - rate) < 1e-8);
            assert.equal(sb.getTime(), raw - avMs * rate / 1000, 'visual correction does not change judgment time');
            previous = shown; lastFrame = now;
        }
    }
});

test('browser anchored presentation preserves pause, explicit seek, tempo changes and source-loss bounds', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now), clock = rendererClock();
    sb.hwState.songOffset = .2; sb.setPlaybackRate(1); sb.setAvOffset(-100);
    const draw = () => clock.sample(sb.api.getPresentationTime(), now, sb.drawTimingBundle().transport);
    sb.setTime(10); sb.setPlaybackSample(null, true); assert.equal(draw(), 10.1);
    now = 80; sb.setTime(10.08); const beforePause = draw();
    sb.setPlaybackSample(null, false); now = 180;
    assert.equal(draw(), beforePause);
    now = 1000; assert.equal(draw(), beforePause);
    sb.api.resetPresentation('seek'); sb.setTime(20); sb.setPlaybackState('paused');
    assert.ok(Math.abs(draw() - 20.1) < 1e-10, 'explicit paused seek repositions once');
    now = 1010; sb.setTime(20.01); sb.setPlaybackSample(null, true); draw();
    now = 1110; sb.setTime(20.11); draw();
    sb.setPlaybackRate(.75); sb.setAvOffset(0); sb.setTime(20.11);
    const changed = draw();
    for (const frameAt of [1117, 1130, 1141, 1160]) {
        now = frameAt;
        assert.ok(Math.abs(draw() - changed - (now - 1110) * .75 / 1000) < 1e-10);
    }
    now = 1360; const lastFresh = draw();
    now = 1500; assert.equal(draw(), lastFresh, 'source loss retains the finite 250 ms extrapolation cap');
    now = 3000; assert.equal(draw(), lastFresh);
    now = 3010; sb.setTime(21.5); sb.setPlaybackSample(null, true);
    assert.ok(Math.abs(draw() - 21.7) < 1e-10, 'fresh source recovery clears accumulated hold lag');
});


// R3c: highway.js is being carved into modules, so its source is no longer ONE file. Read the
// whole set. Re-pinning these assertions at whichever file currently holds a constant just
// means they break again on the next carve — and worse, a source-shape assertion that silently
// stops finding its target is indistinguishable from one that passes.
function highwaySources() {
    const root = path.join(__dirname, '..', '..');
    const jsDir = path.join(root, 'static', 'js');
    const parts = [fs.readFileSync(path.join(root, 'static', 'highway.js'), 'utf8')];
    for (const f of fs.readdirSync(jsDir).sort()) {
        if (f.startsWith('highway-') && f.endsWith('.js')) {
            parts.push(fs.readFileSync(path.join(jsDir, f), 'utf8'));
        }
    }
    return parts.join('\n');
}

test('highway declares chart anchor + stall-detect + rate state', () => {
    const src = highwaySources();
    // Both anchor fields use NaN sentinels — _chartAnchorAudioT in
    // particular MUST start as NaN, not 0, otherwise setTime(0) on the
    // very first 60 Hz tick fails the `t !== _chartAnchorAudioT` check
    // and never re-anchors, leaving the clock uninitialized.
    assert.match(src, /hwState\._chartAnchorAudioT\s*=\s*NaN/, 'missing _chartAnchorAudioT (NaN sentinel)');
    assert.match(src, /hwState\._chartAnchorPerfNow\s*=\s*NaN/, 'missing _chartAnchorPerfNow (NaN sentinel)');
    assert.match(src, /hwState\._chartLastAdvanceAt\s*=\s*0/, 'missing _chartLastAdvanceAt (pause detection)');
    assert.match(src, /hwState\._chartObservedRate\s*=\s*1/, 'missing _chartObservedRate (playback rate awareness)');
    assert.match(src, /(?:export\s+)?const\s+_CHART_MAX_INTERP_MS\s*=\s*100/, 'missing _CHART_MAX_INTERP_MS cap');
});

test('getTime scales interpolation by _chartObservedRate (speed-slider safe)', () => {
    const src = highwaySources();
    const m = src.match(/getTime\(\)\s*\{[\s\S]+?\n\s*\},/);
    assert.ok(m, 'getTime() body not found');
    const slice = m[0];
    assert.match(
        slice,
        /hwState\._chartObservedRate\s*\*\s*elapsedMs/,
        'getTime must scale interpolation by observed rate so audio.playbackRate != 1 stays accurate',
    );
});

test('setTime re-anchors and updates _chartLastAdvanceAt only when t actually changes', () => {
    const src = highwaySources();
    // Repeated setTime calls with the same value must not refresh the
    // anchor (else interpolation stutters); they also must not refresh
    // _chartLastAdvanceAt (else getTime would never detect a stalled
    // audio clock as paused).
    // The implementation may capture performance.now() into a local
    // (e.g. newPerfNow) and assign that to both fields; accept either
    // direct or via-local writes.
    const m = src.match(/if\s*\(\s*t\s*!==\s*hwState\._chartAnchorAudioT\s*\)\s*\{[\s\S]+?\}\s*\},/);
    assert.ok(m, 'if (t !== _chartAnchorAudioT) block not found inside setTime');
    const block = m[0];
    assert.match(block, /hwState\._chartAnchorAudioT\s*=\s*t/, 'must assign _chartAnchorAudioT = t');
    assert.match(block, /hwState\._chartAnchorPerfNow\s*=/, 'must assign _chartAnchorPerfNow');
    assert.match(block, /hwState\._chartLastAdvanceAt\s*=/, 'must assign _chartLastAdvanceAt');
});

test('getTime falls back to chartTime when audio has stalled (paused)', () => {
    const src = highwaySources();
    // Find the actual getTime body. Match the whole brace-balanced
    // method (using a generous greedy slice to ensure we capture both
    // the stall check and the interpolation expression below it).
    const m = src.match(/getTime\(\)\s*\{[\s\S]+?\n\s*\},/);
    assert.ok(m, 'getTime() body not found');
    const slice = m[0];
    // Must check stall-since-last-advance against the cap.
    assert.match(
        slice,
        /nowP\s*-\s*hwState\._chartLastAdvanceAt\s*>\s*_CHART_MAX_INTERP_MS/,
        'getTime must short-circuit when audio has stalled past the cap',
    );
    // Must interpolate when active.
    assert.match(slice, /performance\.now\(\)|nowP/, 'getTime must use perfNow');
    // Rate-scaled formula: _chartAnchorAudioT + (_chartObservedRate * elapsedMs) / 1000
    assert.match(
        slice,
        /_chartAnchorAudioT\s*\+\s*\(\s*hwState\._chartObservedRate\s*\*\s*elapsedMs\s*\)\s*\/\s*1000/,
        'getTime must compute anchor + rate-scaled elapsed during play',
    );
});

test('api.stop() clears the chart anchor state so re-init starts fresh', () => {
    const src = highwaySources();
    // Use the brace-balanced extractor so the assertions are scoped to
    // the actual stop() body — a fixed-size slice would falsely match
    // resets that landed in an adjacent method.
    const stopBlock = extractBlock(src, 'stop() {');
    assert.match(stopBlock, /hwState\._chartAnchorAudioT\s*=\s*NaN/, 'stop() must reset _chartAnchorAudioT to the NaN sentinel');
    assert.match(stopBlock, /hwState\._chartAnchorPerfNow\s*=\s*NaN/, 'stop() must reset _chartAnchorPerfNow to the NaN sentinel');
    assert.match(stopBlock, /hwState\._chartLastAdvanceAt\s*=\s*0/, 'stop() must reset _chartLastAdvanceAt');
    assert.match(stopBlock, /hwState\._chartObservedRate\s*=\s*1/, 'stop() must reset _chartObservedRate to 1x');
});

// ── Behavioral tests (run extracted setTime/getTime in vm sandbox) ──────

test('transport rate survives a legacy one-argument offset wrapper', () => {
    const sb = buildClockSandbox(() => 0);
    const original = sb.setTime;
    sb.setTime = t => original(t + 0.1);
    sb.setPlaybackRate(0.5);
    sb.setTime(10);
    assert.equal(sb.hwState._playbackRate, 0.5);
    assert.equal(sb.getTime(), 10.1);
    sb.setPlaybackRate(1.5);
    sb.setTime(11);
    assert.equal(sb.hwState._playbackRate, 1.5);
    for (const rate of [undefined, NaN, 0, -1, Infinity]) {
        sb.setPlaybackRate(rate);
        sb.setTime(12);
        assert.equal(sb.hwState._playbackRate, undefined);
        assert.equal(sb.getTime(), 12.1);
    }
    const src = fs.readFileSync(HIGHWAY_JS, 'utf8');
    assert.match(extractBlock(src, 'function _makeBundle('), /b\.playbackRate\s*=\s*hwState\._playbackRate/);
    assert.match(extractBlock(src, 'stop() {'), /hwState\._playbackRate\s*=\s*undefined/);
});

test('behavior: getTime interpolates smoothly between two anchors at 1x', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    // First anchor at audioT=10, perf=0.
    sb.setTime(10);
    // Browser hasn't refreshed audio.currentTime; setTime called again
    // with the same value at perf=16. Anchor must NOT move.
    now = 16;
    sb.setTime(10);
    // Plugin reads at perf=24 — interpolated 24ms from anchor.
    now = 24;
    const t = sb.getTime();
    assert.ok(Math.abs(t - (10 + 0.024)) < 0.001, `expected ~10.024, got ${t}`);
});

test('behavior: getTime returns chartTime when audio has stalled (paused)', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(10);
    now = 16; sb.setTime(10);
    // 200ms after the last advance — well past the 100ms cap. Even
    // though setTime is still being called every 16ms with the same
    // value (the 60Hz tick), getTime must report raw chartTime.
    now = 200;
    const t = sb.getTime();
    assert.equal(t, 10, `paused getTime must be chartTime (10), got ${t}`);
});

test('behavior: freezeTime prevents count-in drift until audio genuinely advances', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(10);
    now = 40;
    assert.ok(sb.getTime() > 10, 'live clock should interpolate before the freeze');

    sb.freezeTime(10);
    now = 80;
    assert.equal(sb.getTime(), 10, 'frozen count-in clock must stay exactly at A');
    assert.ok(Number.isNaN(sb.hwState._chartAnchorPerfNow), 'freeze must disable the live interpolation anchor');

    // A same-position tick before the backing engine starts must not unfreeze.
    sb.setTime(10);
    now = 120;
    assert.equal(sb.getTime(), 10, 'same-position transport samples must preserve the freeze');

    // The first real audio advance restores the normal smooth clock.
    sb.setTime(10.02);
    assert.equal(sb.hwState._chartAnchorAudioT, 10.02);
    assert.equal(sb.hwState._chartAnchorPerfNow, 120);
    now = 140;
    assert.ok(sb.getTime() > 10.02, 'advancing audio must resume interpolation');
});

test('behavior: getTime adjusts for non-1x playback rate (observed)', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    // Establish initial anchor.
    sb.setTime(10);
    // Audio advanced 0.025s in 50ms real time → observed rate = 0.5.
    now = 50;
    sb.setTime(10.025);
    // Read 25ms after the latest anchor: chart should advance by
    // rate * elapsed = 0.5 * 0.025 = 0.0125 → 10.0375.
    now = 75;
    const t = sb.getTime();
    assert.ok(Math.abs(t - 10.0375) < 0.0005, `expected ~10.0375 (rate-scaled), got ${t}`);
});

test('behavior: seek discontinuity resets observed rate to 1x', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(10);
    now = 50;
    sb.setTime(10.025); // observed rate ≈ 0.5
    assert.ok(Math.abs(sb.hwState._chartObservedRate - 0.5) < 0.001, `prior segment must measure ≈0.5, got ${sb.hwState._chartObservedRate}`);
    // Seek: large t jump in same perf delta — observed-rate clamp
    // rejects this segment, resets to 1.
    now = 70;
    sb.setTime(120); // dPerf=20ms, dT=110s → observed=5500 (out of clamp)
    assert.equal(sb.hwState._chartObservedRate, 1, 'seek must reset rate to 1x');
});

test('behavior: getTime caps interpolation at _CHART_MAX_INTERP_MS', () => {
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(10);
    now = 50;
    sb.setTime(10.05); // observed rate ~1
    // Long pause-like gap with NO setTime call. getTime should detect
    // (now - _chartLastAdvanceAt > 100) and return chartTime.
    now = 200;
    const t = sb.getTime();
    assert.equal(t, 10.05, 'beyond cap must fall back to chartTime');
});

test('behavior: setTime(0) on first tick anchors correctly (boot edge case)', () => {
    // Regression: _chartAnchorAudioT used to start at 0, so setTime(0)
    // on the very first 60 Hz tick failed the `t !== _chartAnchorAudioT`
    // check and skipped the re-anchor branch entirely. _chartAnchorPerfNow
    // would stay NaN, and getTime would propagate NaN to plugins.
    let now = 16; // realistic first-tick perf
    const sb = buildClockSandbox(() => now);
    sb.setTime(0);
    // Anchor must now be initialized.
    assert.equal(sb.hwState._chartAnchorAudioT, 0, 'setTime(0) on first tick must set anchor.audioT');
    assert.equal(sb.hwState._chartAnchorPerfNow, 16, 'setTime(0) on first tick must set anchor.perfNow');
    // getTime should return a finite value, not NaN.
    const t = sb.getTime();
    assert.ok(!Number.isNaN(t), `getTime must not return NaN after setTime(0); got ${t}`);
});

test('behavior: getTime before any setTime returns chartTime (no NaN)', () => {
    // Regression: getTime called during early boot (before the first
    // 60 Hz tick) used to compute `nowP - NaN` and propagate NaN. Must
    // bail to chartTime when the anchor is still the NaN sentinel.
    let now = 0;
    const sb = buildClockSandbox(() => now);
    const t = sb.getTime();
    assert.equal(t, 0, 'getTime before any setTime must return chartTime, not NaN');
    assert.ok(!Number.isNaN(t), 'getTime must not return NaN');
});

test('behavior: long anchor gap resets observed rate to 1x', () => {
    // After a long gap (e.g. tab inactive, paused for a while), the
    // next setTime() shouldn't carry forward the prior segment's
    // observed rate — it likely reflects a different playback state.
    let now = 0;
    const sb = buildClockSandbox(() => now);
    sb.setTime(10);
    now = 50;
    sb.setTime(10.025); // observed rate ≈ 0.5
    assert.ok(Math.abs(sb.hwState._chartObservedRate - 0.5) < 0.001, 'first segment measured 0.5x');
    // Long gap (1 second) before next setTime — out of the dPerf < 0.5
    // window, so the rate must reset to 1.
    now = 1100;
    sb.setTime(10.5);
    assert.equal(sb.hwState._chartObservedRate, 1, 'long anchor gap must reset rate to 1x');
});
