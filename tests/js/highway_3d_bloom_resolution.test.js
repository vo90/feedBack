const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function harness(initialRatio = 1) {
    const start = src.indexOf('        function _bloomResize(');
    assert.ok(start >= 0, 'bloom buffer synchronization must exist');
    const end = src.indexOf('\n        }', start) + '\n        }'.length;
    const calls = [];
    const composer = {
        ratio: initialRatio, width: 0, height: 0,
        setPixelRatio(ratio) { this.ratio = ratio; calls.push(['ratio', ratio]); },
        setSize(w, h) { this.width = w; this.height = h; calls.push(['size', w, h]); },
    };
    const renderer = { ratio: initialRatio, getPixelRatio() { return this.ratio; } };
    const sandbox = { ren: renderer, _composer: composer, _bloomW: 0, _bloomH: 0, _bloomPixelRatio: 0 };
    vm.createContext(sandbox);
    vm.runInContext(src.slice(start, end) + '\nthis.resize = _bloomResize;', sandbox);
    return { resize: sandbox.resize, composer, renderer, calls };
}

test('bloom buffers follow full/reduced/full quality at unchanged CSS size', () => {
    const h = harness();
    for (const ratio of [1, 0.25, 1]) {
        h.renderer.ratio = ratio;
        h.resize(1831, 1100);
        assert.equal(h.composer.ratio, ratio);
        assert.equal(Math.floor(h.composer.width * h.composer.ratio), Math.floor(1831 * ratio));
        assert.equal(Math.floor(h.composer.height * h.composer.ratio), Math.floor(1100 * ratio));
    }
});

test('a composer initialized at reduced quality recovers full resolution', () => {
    const h = harness(0.25);
    h.resize(1831, 1100);
    h.renderer.ratio = 1;
    h.resize(1831, 1100);
    assert.equal(h.composer.ratio, 1);
    assert.equal(h.composer.width * h.composer.ratio, 1831);
});

test('DPR and CSS resize changes are synchronized without reallocating steady frames', () => {
    const h = harness(2);
    h.resize(800, 600);
    const initializedCalls = h.calls.length;
    h.resize(800, 600);
    assert.equal(h.calls.length, initializedCalls);
    h.renderer.ratio = 1.25;
    h.resize(960, 540);
    assert.equal(h.composer.ratio, 1.25);
    assert.deepEqual([h.composer.width, h.composer.height], [960, 540]);
    const resizedCalls = h.calls.length;
    h.resize(0, 0);
    assert.equal(h.calls.length, resizedCalls, 'hidden canvas must not collapse targets');
});

test('initialization and every bloom render synchronize dimensions', () => {
    assert.match(src, /_composer = comp;\s*_bloomResize\(w, h\)/);
    assert.match(src, /if \(comp\)\s*\{[\s\S]*?_bloomResize\(bsz\.w, bsz\.h\)[\s\S]*?comp\.render\(\)/);
});
