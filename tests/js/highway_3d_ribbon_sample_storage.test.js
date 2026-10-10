const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function fn(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}

// Frozen original implementation from da15ac51dbb4b7464a014a37516f006e316f2dc2.
// Both variants use the same real production contour append helpers.
function originalSlideRibbonSampleTimes(n, start, duration, out) {
    out.length = 0;
    const end = start + duration;
    for (let i = 0; i <= SLIDE_RIBBON_SAMPLES; i++) out.push(start + duration * i / SLIDE_RIBBON_SAMPLES);
    appendSlideOutContourTimes(n, start, end, out);
    appendTargetedSlideContourTimes(n, start, end, out);
    appendSlideInContourTimes(n, start, end, out);
    appendPickScrapeContourTimes(n, start, end, out);
    appendBarContourTimes(n, start, end, out);
    if (out.length > SLIDE_RIBBON_SAMPLES + 1) out.sort((a, b) => a - b);
    return out;
}

class Attribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
}
class Geometry {
    constructor() {
        this.userData = {};
        this.attributes = { position: new Attribute(new Float32Array(97 * 12), 3),
            color: new Attribute(new Float32Array(97 * 16).fill(1), 4) };
        this.disposals = 0;
    }
    dispose() { this.disposals++; }
    setAttribute(key, value) { this.attributes[key] = value; }
    setIndex(value) { this.index = value; }
    setDrawRange(start, count) { this.drawRange = { start, count }; }
}

function helpers(original, lefty = false) {
    let motion = source.slice(source.indexOf('    function slideTrailEnd('),
        source.indexOf('    // Camera tgtDist building blocks'));
    if (original) motion = motion.replace(fn('slideRibbonSampleTimes'),
        originalSlideRibbonSampleTimes.toString().replace('originalSlideRibbonSampleTimes', 'slideRibbonSampleTimes'));
    return new Function('T', `
        const SLIDE_RIBBON_SAMPLES=96, _leftyCached=${lefty}, NW=4;
        const fretX=f=>f*10, fretMid=fretX, notePositionX=n=>n.f*10, dZ=t=>-230*t;
        const _slideRibbonTimesScratch=[];
        // Deterministic motion makes every changed sample visible in geometry.
        // It stands in for unrelated technique providers; ribbon/contour code is real.
        const techniqueYOffsetWorld=(n,t)=>Math.sin(t)*2, tremoloOffsetWorldX=(n,t,w)=>n.tr?Math.cos(t)*w:0;
        const window={feedBackHarmonicContacts:{events:n=>n.harmonic_changes.events}};
        const TRAIL_YIELD_DEFAULTS={enabled:true,sameStringEnabled:true,minScale:.3,
            leadTime:.5,taperDuration:.05,holdAfter:.05,recoverDuration:.05,
            endLeadTime:.5,endTaperDuration:.05,sameStringLeadTime:.5};
        ${motion}
        ${fn('hwySmoothstep01')}${fn('hwyTrailYieldAmountAt')}${fn('hwyAppendTrailYieldContourTimes')}
        ${fn('hwySameStringTaperDuration')}${fn('hwySameStringTrailYieldAmountAt')}${fn('hwyAppendSameStringContourTimes')}
        ${fn('sustainTrailCenterXAt')}${fn('ensureSlideRibbonCapacity')}${fn('slideRibbonUpdatePair')}
        return {sample:slideRibbonSampleTimes,draw:slideRibbonUpdatePair,
            scratch:_slideRibbonTimesScratch,settings:TRAIL_YIELD_DEFAULTS};
    `)({ Float32BufferAttribute: Attribute });
}

const plain = { t: 10, s: 2, f: 7, sus: 6 };
const incoming = { ...plain, slide_in_marks: [{ direction: 'up', time: 0 }, { direction: 'down', time: 2 }] };
const outgoing = { ...plain, slide_out_marks: [{ direction: 'down', start: 2.5, end: 3 }, { direction: 'up', start: 5.5, end: 6 }] };
const targeted = { ...plain, sl: 12, slide_interval: { start: .7, end: 3.5 } };
const scrape = { ...plain, mt: true, pick_scrape_marks: [{ start: .2, end: 1.5 }, { start: 3, end: 5.8 }] };
const bar = { ...plain, whammy: { version: 1, segments: [{ start: 0, end: 6,
    curve: [{ t: 0 }, { t: 1.5 }, { t: 1.5 }, { t: 6 }], vibrato: true }] } };
const all = { ...scrape, slide_in_marks: incoming.slide_in_marks,
    slide_out_marks: outgoing.slide_out_marks, whammy: bar.whammy };

test('all contour families retain every ordered sample, including duplicates', () => {
    const a = helpers(true), b = helpers(false);
    for (const note of [plain, incoming, outgoing, targeted, scrape, bar, all]) {
        for (const [start, duration] of [[9.78, 6.22], [10, 6], [11.49, .02], [15.8, .2]]) {
            const old = a.sample(note, start, duration, []);
            const next = b.sample(note, start, duration, []);
            assert.deepEqual(next, old);
        }
    }
    const withDuplicates = b.sample(bar, 10, 6, []);
    assert.ok(withDuplicates.length > 97);
    assert.ok(withDuplicates.some((time, i) => i > 0 && time === withDuplicates[i - 1]),
        'the fixture must contain duplicates; storage reuse must not deduplicate');
});

test('reused ordinary arrays discard long old tails across repeated growth and shrinkage', () => {
    const a = helpers(true), b = helpers(false);
    const old = new Array(4096).fill(99999), next = new Array(4096).fill(99999);
    const sequence = [[all, 9.78, 6.22], [plain, 10, 6], [incoming, 11.99, .01],
        [bar, 10, 6], [plain, 10, 0], [scrape, 10.1, 5.8], [plain, 20, -1]];
    for (let repeat = 0; repeat < 5; repeat++) {
        for (const [note, start, duration] of sequence) {
            assert.equal(a.sample(note, start, duration, old), old);
            assert.equal(b.sample(note, start, duration, next), next);
            assert.deepEqual(next, old);
            assert.ok(!next.includes(99999));
            if (note === plain) assert.equal(next.length, 97);
        }
    }
});

test('base-grid arithmetic preserves signed zero and nonfinite numeric inputs', () => {
    const a = helpers(true), b = helpers(false);
    for (const [start, duration] of [[-0, -0], [-0, 0], [0, -0], [NaN, 1], [1, NaN],
        [Infinity, 1], [1, Infinity], [-Infinity, 1], [1, -Infinity], [Number.MAX_VALUE, Number.MAX_VALUE]]) {
        assert.deepEqual(b.sample(plain, start, duration, []), a.sample(plain, start, duration, []));
    }
    assert.ok(Object.is(b.sample(plain, -0, -0, [1])[0], -0));
});

function geometrySnapshot(geometry) {
    return { userData: { ...geometry.userData }, drawRange: geometry.drawRange,
        disposals: geometry.disposals, index: geometry.index,
        attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, value]) =>
            [key, { array: value.array.slice(), itemSize: value.itemSize, needsUpdate: value.needsUpdate }])) };
}

test('full ribbon output stays byte-identical through contours, contacts, yields and pool resizing', () => {
    for (const lefty of [false, true]) {
        const a = helpers(true, lefty), b = helpers(false, lefty);
        const old = [new Geometry(), new Geometry()], next = [new Geometry(), new Geometry()];
        const contact = { ...incoming, harmonic_changes: { events: [{ start: 2 }] } };
        const sequence = [bar, plain, incoming, outgoing, targeted, contact, { ...plain, tr: true }, plain];
        for (let repeat = 0; repeat < 3; repeat++) for (const note of sequence) {
            const start = note === incoming ? 9.78 : 10, duration = 16 - start;
            for (const [h, geometry] of [[a, old], [b, next]]) {
                h.draw(...geometry, 70, 4.4, 1.4, 4, 1, 5, duration, start, 10.25,
                    note, note.sl == null ? null : { endFret: note.sl, unpitched: false },
                    [11.5, 14], [12, 14.5], 2, 16, h.settings, 15.7, start);
            }
            assert.deepEqual(next.map(geometrySnapshot), old.map(geometrySnapshot));
            assert.deepEqual(b.scratch, a.scratch);
        }
        assert.ok(next[0].disposals > 0, 'fixture exercises actual geometry buffer growth');
    }
});
