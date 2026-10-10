// Focused Canvas 2D regression; no server, WebGL, app profile, or song library.
// PLAYWRIGHT_MODULE / PLAYWRIGHT_CHROMIUM_EXECUTABLE may use existing runtimes.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const between = (a, b) => {
    const start = source.indexOf(a), end = source.indexOf(b, start);
    assert.ok(start >= 0 && end > start, `Missing source section: ${a}`);
    return source.slice(start, end);
};
const cacheSource = between('let _fpsTextCache = null;', '// The FPS readout is pinned');
const frameSource = between('// 1. FPS counter (always top-right', '// 2. Section HUD.');
// Original direct drawing, retained as an independent pixel oracle.
const referenceDraw = `function _drawFpsCounter(ctx, value, right, y) {
    const txt = value.toFixed(1) + ' fps';
    ctx.save();
    ctx.font = 'bold 14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    const width = Math.ceil(ctx.measureText(txt).width) + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(right - width, y, width, 22);
    ctx.fillStyle = value >= 55 ? '#7fff9a' : value >= 30 ? '#ffe84d' : '#ff6b6b';
    ctx.fillText(txt, right - 8, y + 4);
    ctx.restore();
    return 22;
}`;

test('FPS bitmap preserves pixels, live layout, sampling, canvas state and cache lifecycle', async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    try {
        const page = await browser.newPage();
        const result = await page.evaluate(({ cacheSource, frameSource, referenceDraw }) => {
            const failures = [], cases = [];
            const check = (ok, label) => { if (!ok) failures.push(label); };
            const factory = cached => {
                const lyricsCanvas = document.createElement('canvas');
                lyricsCanvas.width = 512; lyricsCanvas.height = 320;
                document.body.append(lyricsCanvas);
                const lyricsCtx = lyricsCanvas.getContext('2d', { willReadFrequently: false });
                return new Function('lyricsCanvas', 'lyricsCtx', 'state',
                    (cached ? cacheSource : 'let _fpsTextCache = null; function _invalidateFpsTextCache() {} ' + referenceDraw)
                    + `\nlet _fpsLastT = 0, _fpsEma = 100, _fpsDisplay = 100, _fpsLastSampleT = 100;
                    let cornerStack;
                    const performance = { now: () => state.clock };
                    const _v3TopRightChromeBottom = () => state.chrome;
                    const stackPush = (pos, h) => { if (h > 0) cornerStack[pos] += h + 8; };
                    document.fonts.addEventListener('loadingdone', _invalidateFpsTextCache);
                    return {
                        canvas: lyricsCanvas, ctx: lyricsCtx, state,
                        entry: () => _fpsTextCache,
                        display: () => _fpsDisplay,
                        setDisplay: value => { _fpsDisplay = value; _fpsLastSampleT = state.clock; },
                        invalidate: _invalidateFpsTextCache,
                        draw: () => {
                            cornerStack = { tl: 0, tr: 0, bl: 0, br: 0 };
                            const fpsVisible = state.visible, lyricsBottom = state.lyrics;
                            ${frameSource}
                            return cornerStack.tr;
                        }
                    };`)(lyricsCanvas, lyricsCtx, { clock: 100, chrome: 0, lyrics: 0, visible: true });
            };
            const actual = factory(true), expected = factory(false);
            const pair = [actual, expected];
            const drawBackdrop = ctx => {
                ctx.save(); ctx.resetTransform();
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                ctx.restore();
                ctx.fillStyle = '#244c7a'; ctx.fillRect(390, 0, 110, 180);
                ctx.save(); ctx.font = 'italic 17px serif'; ctx.fillStyle = '#df9124';
                ctx.fillText('other HUD', 315, 100); ctx.restore();
            };
            const compare = label => {
                for (const p of pair) drawBackdrop(p.ctx);
                const states = pair.map(p => [p.ctx.font, p.ctx.fillStyle, p.ctx.textAlign,
                    p.ctx.textBaseline, p.ctx.globalAlpha, p.ctx.getTransform().toString()]);
                const heights = pair.map(p => p.draw());
                check(heights[0] === heights[1], label + ': corner stack');
                for (let i = 0; i < pair.length; i++) {
                    const p = pair[i];
                    check(JSON.stringify(states[i]) === JSON.stringify([p.ctx.font, p.ctx.fillStyle,
                        p.ctx.textAlign, p.ctx.textBaseline, p.ctx.globalAlpha, p.ctx.getTransform().toString()]),
                        label + ': restores context ' + i);
                    p.ctx.fillRect(360, 125, 9, 7);
                    p.ctx.fillText('next', 350, 150);
                }
                const w = actual.canvas.width, h = actual.canvas.height;
                const a = actual.ctx.getImageData(0, 0, w, h).data;
                const b = expected.ctx.getImageData(0, 0, w, h).data;
                let different = 0, maxDelta = 0, outsideGlyphs = 0;
                const entry = actual.entry();
                const x = entry ? w - 8 - entry.width + entry.left : 0;
                const y = Math.round(Math.max(8 + h * .06, actual.state.lyrics + 8,
                    actual.state.chrome + 8)) + (entry?.top || 0);
                for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
                    different++; maxDelta = Math.max(maxDelta, Math.abs(a[i] - b[i]));
                    const px = (i >>> 2) % w, py = Math.floor((i >>> 2) / w);
                    if (!entry || px < x || px >= x + entry.canvas.width
                        || py < y || py >= y + entry.canvas.height) outsideGlyphs++;
                }
                // Rasterizing glyphs once introduces at most one 8-bit rounding
                // step when their premultiplied pixels are composited. Everything
                // outside the glyph surface and every direct fallback is exact.
                const direct = !actual.state.visible || actual.ctx.globalAlpha !== 1
                    || !actual.ctx.getTransform().isIdentity || actual.ctx.shadowColor !== 'rgba(0, 0, 0, 0)'
                    || actual.ctx.filter !== 'none' || actual.ctx.globalCompositeOperation !== 'source-over';
                check(maxDelta <= (direct ? 0 : 1) && outsideGlyphs === 0,
                    label + ': ' + different + ' changed bytes, max delta ' + maxDelta + ', outside glyphs ' + outsideGlyphs);
                cases.push({ label, different, maxDelta, outsideGlyphs });
            };

            for (const p of pair) p.state.visible = false;
            compare('disabled FPS leaves other HUD pixels unchanged');
            check(actual.entry() === null, 'disabled FPS does not allocate a bitmap');
            for (const p of pair) p.state.visible = true;
            compare('first visible draw');
            let entry = actual.entry();
            check(entry && entry.canvas.width < 160 && entry.canvas.height < 40, 'cache is a small glyph surface');
            const font = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
            const measure = actual.ctx.measureText;
            let fontAssignments = 0, measurements = 0;
            Object.defineProperty(actual.ctx, 'font', { configurable: true,
                get() { return font.get.call(this); },
                set(value) { fontAssignments++; font.set.call(this, value); } });
            actual.ctx.measureText = function (...args) { measurements++; return measure.apply(this, args); };
            for (let i = 0; i < 20; i++) actual.draw();
            check(fontAssignments === 0 && measurements === 0, 'cached frames avoid overlay font assignment and measurement');
            delete actual.ctx.font;
            actual.ctx.measureText = measure;
            for (const p of pair) { p.state.chrome = 63; p.state.lyrics = 72; p.state.clock = 110; }
            compare('live chrome and lyrics move unchanged text');
            check(actual.entry() === entry, 'placement changes reuse glyphs');
            for (const p of pair) p.state.clock = 350;
            compare('250 ms boundary retains displayed sample');
            check(actual.entry() === entry && actual.display() === 100, 'sampling boundary remains strict');
            for (const p of pair) p.state.clock = 351;
            compare('next sample updates value');
            check(actual.entry() !== entry, 'new sampled text invalidates bitmap');

            for (const value of [0, 29.99, 30, 54.96, 55, 99.9, 1000.1]) {
                entry = actual.entry();
                for (const p of pair) p.setDisplay(value);
                compare('value/color ' + value);
                check(actual.entry() !== entry, 'changed text or color invalidates ' + value);
            }
            for (const alpha of [0, 0.35, 1]) {
                for (const p of pair) p.ctx.globalAlpha = alpha;
                compare('inherited alpha ' + alpha);
            }
            for (const p of pair) { p.ctx.direction = 'rtl'; p.ctx.letterSpacing = '1px'; }
            entry = actual.entry();
            compare('inherited text shaping');
            check(actual.entry() !== entry, 'text shaping changes invalidate bitmap');
            for (const p of pair) { p.ctx.direction = 'ltr'; p.ctx.letterSpacing = '0px'; }
            entry = actual.entry();
            document.fonts.dispatchEvent(new Event('loadingdone'));
            check(actual.entry() === null, 'loaded fonts invalidate cache');
            compare('font reload');
            check(actual.entry() !== entry, 'font reload creates fresh glyphs');
            const offscreen = window.OffscreenCanvas;
            window.OffscreenCanvas = undefined;
            actual.invalidate();
            compare('HTML canvas fallback');
            check(actual.entry().canvas instanceof HTMLCanvasElement, 'works without OffscreenCanvas');
            window.OffscreenCanvas = offscreen;

            for (const mode of ['scale', 'shadow', 'filter', 'composite']) {
                entry = actual.entry();
                for (const p of pair) {
                    p.ctx.save();
                    if (mode === 'scale') p.ctx.setTransform(1.1, 0, 0, 1.1, 0.25, 0.5);
                    if (mode === 'shadow') { p.ctx.shadowColor = '#f90'; p.ctx.shadowBlur = 3; }
                    if (mode === 'filter') p.ctx.filter = 'blur(1px)';
                    if (mode === 'composite') p.ctx.globalCompositeOperation = 'xor';
                }
                compare('direct fallback for ' + mode);
                check(actual.entry() === entry, mode + ' keeps existing cache without using it');
                for (const p of pair) p.ctx.restore();
            }
            for (const p of pair) {
                p.canvas.width = 640; p.canvas.height = 360; p.invalidate();
                p.state.chrome = 5; p.state.lyrics = 0;
            }
            check(actual.entry() === null, 'resize releases cached surface');
            compare('resized canvas resets state and uses current position');
            entry = actual.entry();
            for (const p of pair) p.state.visible = false;
            compare('disabled after enabled still draws other HUD');
            check(actual.entry() === entry, 'hidden frame does not redraw glyphs');
            return { failures, cases };
        }, { cacheSource, frameSource, referenceDraw });
        assert.deepEqual(result.failures, [], JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ pixelCases: result.cases.length,
            maxChannelDelta: Math.max(...result.cases.map(c => c.maxDelta)),
            outsideGlyphChanges: result.cases.reduce((n, c) => n + c.outsideGlyphs, 0) }));
    } finally { await browser.close(); }
});

test('actual resize, font loading and teardown paths invalidate the FPS cache', () => {
    assert.match(between('function applySize(w, h)', '/* ── Teardown'), /_invalidateFpsTextCache\(\);/);
    assert.match(between('function teardown()', 'function canvasSize('), /_invalidateFpsTextCache\(\);/);
    assert.match(source, /document\.fonts\?\.addEventListener\('loadingdone', _invalidateFpsTextCache\)/);
    assert.match(between('function teardown()', 'function canvasSize('),
        /document\.fonts\?\.removeEventListener\('loadingdone', _invalidateFpsTextCache\)/);
});
