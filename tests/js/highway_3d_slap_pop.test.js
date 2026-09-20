const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function markerFactory() {
    const document = {
        createElement() {
            const points = [];
            const context = { beginPath() {}, closePath() {}, fill() {}, stroke() {},
                moveTo(x, y) { points.push([x, y]); }, lineTo(x, y) { points.push([x, y]); } };
            return { points, context, getContext() { return context; } };
        },
    };
    const T = {
        SpriteMaterial: class { constructor(props) { Object.assign(this, props); } },
        CanvasTexture: class { constructor(image) { this.image = image; } },
    };
    return new Function('document', 'T', 'const _techMatCache = new Map();'
        + fn('bassAttackMat') + ';return bassAttackMat;')(document, T);
}

test('slap and pop bars point in opposite directions with distinct cached materials', () => {
    const marker = markerFactory();
    const slap = marker(false, 0xff2233), pop = marker(true, 0xff2233);
    assert.notEqual(slap, pop);
    assert.equal(marker(false, 0xff2233), slap);
    assert.equal(marker(true, 0xff2233), pop);
    assert.notEqual(marker(false, 0x2299ff), slap);
    assert.equal(slap.map.image.width, 256);
    assert.equal(slap.map.image.height, 256);
    const down = slap.map.image.points, up = pop.map.image.points;
    assert.equal(down.length, 6);
    assert.ok(down[1][1] > down[0][1], 'slap center bows down in canvas coordinates');
    assert.ok(up[1][1] < up[0][1], 'pop center bows up');
    for (let i = 0; i < down.length; i++) {
        assert.equal(down[i][0], up[i][0]);
        assert.ok(Math.abs(down[i][1] + up[i][1] - 256) < 1e-9);
    }
    assert.equal(slap.map.image.context.strokeStyle, '#ff2233');
    assert.equal(slap.depthWrite, false);
    assert.equal(slap.depthTest, false);
});

test('optional attack flags do not leak from one reused chord member to the next', () => {
    const start = src.indexOf('Object.assign(_scrChordNote, cn);');
    const end = src.indexOf('drawNote(', start);
    assert.ok(start > 0 && end > start);
    const copy = new Function(`
        const _linkedBendStarts = new WeakMap(), _linkedBendEnds = new WeakMap();
        const _linkedVibratoRuns = new WeakMap();
        const _linkedTrailPaths = { byNote: new WeakMap() };
        return function(_scrChordNote, cn, ch) {
            ${src.slice(start, end)}
            return _scrChordNote;
        };
    `)();
    const scratch = {};
    const slap = Object.freeze({ s: 0, f: 3, slp: true });
    const pop = Object.freeze({ s: 2, f: 5, plk: true });
    const ordinary = Object.freeze({ s: 1, f: 4 });
    copy(scratch, slap, { t: 10 });
    assert.equal(scratch.slp, true);
    assert.equal(scratch.plk, false);
    copy(scratch, pop, { t: 11 });
    assert.equal(scratch.slp, false);
    assert.equal(scratch.plk, true);
    copy(scratch, ordinary, { t: 12 });
    assert.equal(scratch.slp, false);
    assert.equal(scratch.plk, false);
    assert.deepEqual(ordinary, { s: 1, f: 4 });
});
