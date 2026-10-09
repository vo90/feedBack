const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

test('ghost centering retains optical position, shares measurements and bounds memory', () => {
    const start = source.indexOf('    const hwyGlyphCenters = new Map();');
    const end = source.indexOf('    // Explicit transport epochs', start);
    const ctx = vm.createContext({});
    vm.runInContext(source.slice(start, end) + '\nglobalThis.centers = hwyGlyphCenters;', ctx);
    let reads = 0;
    const doc = {createElement() { return {getContext(kind, options) {
        assert.equal(kind, '2d'); assert.equal(options.willReadFrequently, true);
        return {fillText() {}, getImageData(x, y, w, h) {
            reads++; const data = new Uint8ClampedArray(w * h * 4);
            data[(1 * w + 2) * 4 + 3] = 255;
            return {data};
        }};
    }}; }};
    const first = ctx.hwyGhostInkCenter(doc, 'bold 80px Arial', '1', 4, 4);
    assert.equal(first.x, .32 + 2); assert.equal(first.y, 3);
    assert.equal(ctx.hwyGhostInkCenter(doc, 'bold 80px Arial', '1', 4, 4), first);
    assert.equal(reads, 1, 'a new renderer/colour must reuse the same CPU measurement');
    ctx.hwyGhostInkCenter(doc, 'bold 90px Arial', '1', 4, 4);
    assert.equal(reads, 2, 'font metrics are part of the key');
    for (let i = 0; i < 300; i++) ctx.hwyGhostInkCenter(doc, 'Arial', String(i), 4, 4);
    assert.equal(ctx.centers.size, 256);
});

test('sizing applies DPR and dimensions in one operation and skips unchanged buffers', () => {
    const start = source.indexOf('        let lastSizedRenderer = null');
    const end = source.indexOf('            // Pin the overlay', start);
    const calls = [], ren = {domElement: {style: {}}, setDrawingBufferSize: (...args) => calls.push(args)};
    const ctx = vm.createContext({ren, cam: {}, wrap: {}, devicePixelRatio: 1.25, _renderScale: 1, _ssActive: () => false});
    vm.runInContext(source.slice(start, end) + '\n}', ctx);
    ctx.applySize(1200, 800); ctx.applySize(1200, 800);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0], [1200, 800, 1.25]);
    assert.equal(ren.domElement.style.width, '1200px');
    ctx._renderScale = .5; ctx.applySize(1200, 800);
    assert.equal(calls.length, 2); assert.equal(calls[1][2], .625);
    ctx.applySize(800, 800); assert.equal(calls.length, 3);
    ctx.ren = {...ren}; ctx.applySize(800, 800); assert.equal(calls.length, 4);
    ctx.applySize(0, 0); assert.equal(calls.length, 4);
});
