'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./test_utils');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const fn = name => extractFunction(source, `function ${name}`);

function harness() {
    return new Function(`
        const NFRETS = 24, AHEAD = 3, K = 1, OPEN_NOTE_PAD_X = 2;
        let nStr = 6, lefty = false, inverted = false, _arpBracketGuideCache = null;
        const calls = [];
        const validString = s => Number.isInteger(s) && s >= 0 && s < nStr;
        const xFret = f => (lefty ? -1 : 1) * f;
        const xNote = n => (lefty ? -1 : 1) * (n.f - .5);
        const sY = s => inverted ? s : nStr - 1 - s;
        function drawArpBrackets(x, y, dt, end, now, string, open, halfWidth) {
            calls.push({x, y, dt, end, now, string, open, halfWidth});
        }
        ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'usesUnfrettedPosition',
            'truthyChartFlag', 'chordTemplateMarkedArpeggio', 'handShapeMarkedArpeggio',
            'hsStart', 'hsEnd', 'hsChordIdNorm', 'chordNotesFromTemplate',
            'getChartAnchorAt', 'laneBoundsFromAnchor', 'anchorLaneBoundsAt',
            'chordFallbackLaneBounds', 'chordShapeLaneBounds', 'firstVisibleChordGuide',
            'ensureArpeggioBracketGuides', 'drawHandShapeArpBrackets'].map(fn).join('\n')}
        return {
            ensure: ensureArpeggioBracketGuides,
            draw(now, model) { calls.length = 0; drawHandShapeArpBrackets(now, model); return calls.slice(); },
            set(options) {
                if ('strings' in options) nStr = options.strings;
                if ('lefty' in options) lefty = options.lefty;
                if ('inverted' in options) inverted = options.inverted;
            },
        };
    `)();
}
const shape = (start, end, chord_id = 0, extra = {}) => ({ start_time: start, end_time: end, chord_id, ...extra });
const templates = [
    { name: 'Dm', frets: [-1,5,7,7,6,-1], arp: true },
    { name: '', frets: [-1,5,7,-1,-1,-1] },
];
const anchors = [{ time: 0, fret: 5, width: 4 }];

test('reported Dm passages show every template string before a late yellow note enters lookahead', () => {
    const h = harness();
    const handShapes = [
        shape(88.365997, 90.877998), shape(88.386002, 89.626999, 1),
        shape(98.498001, 100.888), shape(98.517998, 99.768997, 1),
    ];
    const model = h.ensure(handShapes, templates, anchors);
    assert.equal(model.rows.length, 2, 'only the authored arpeggios own brackets');
    // First yellow standalone note occurs at 90.777; the second is at
    // 100.928, outside its handshape. Neither controls shape visibility.
    for (const [start, end, times] of [
        [88.365997, 90.877998, [85.4,87.4,87.76,87.8,88,88.366,90.7]],
        [98.498001, 100.888, [95.55,97.4,98,99,100.7]],
    ]) {
        for (const now of times) {
            const draws = h.draw(now, model);
            assert.deepEqual(draws.map(d => d.string), [1,2,3,4], `complete, unique shape at ${now}`);
            assert.ok(draws.every(d => d.dt === start - now && d.end === end));
        }
    }
    for (const now of [85.36,90.877998,94,100.888,105]) assert.equal(h.draw(now, model).length, 0);
    assert.deepEqual(h.draw(87.4, model).map(d => d.string), [1,2,3,4], 'rewind restores complete shape');
});

test('explicit guidance needs neither a chord row nor successful note-pattern inference', () => {
    const h = harness();
    const short = h.ensure([shape(10,10.04)], templates, anchors);
    assert.deepEqual(h.draw(9,short).map(d => d.string), [1,2,3,4]);
    const unmarked = templates.map(t => ({...t, arp:false}));
    const none = h.ensure([shape(10,12)], unmarked, anchors);
    assert.equal(h.draw(9,none).length, 0, 'inferred unmarked shapes must remain bracket-free');
    const marked = h.ensure([shape(10,12,0,{arpeggio:'true'})], unmarked, anchors);
    assert.equal(h.draw(9,marked).length, 4, 'explicit handshape flag is authoritative');
});

test('each occurrence is independent and duplicate metadata cannot double opacity', () => {
    const h = harness();
    const model = h.ensure([shape(13,15),shape(10,12),shape(10,11.5),shape(10,12.2)],templates,anchors);
    assert.deepEqual(model.rows.map(r => [r.start,r.end]), [[10,12.2],[13,15]]);
    const overlap = h.draw(11,model);
    assert.equal(overlap.length,8,'two distinct occurrences can be previewed together');
    for (const dt of [-1,2]) assert.deepEqual(overlap.filter(d=>d.dt===dt).map(d=>d.string),[1,2,3,4]);
    assert.equal(h.draw(12.2,model).length,4,'expired occurrence cannot suppress next occurrence');
});

test('open brackets retain onset anchor bounds through later anchors and orientation changes', () => {
    const h = harness();
    const localAnchors = [{time:0,fret:3,width:4},{time:10.5,fret:12,width:6}];
    const localTemplates = [{frets:[-1,0,5,5,-1,-1],arp:true}];
    const handShapes = [shape(10,13)];
    const model = h.ensure(handShapes,localTemplates,localAnchors);
    const first = h.draw(9,model);
    const open = first.find(d=>d.open);
    assert.equal(open.x,4, 'fret-wire bounds 2..6 at handshape start');
    assert.ok(open.halfWidth>0);
    const later = h.draw(11,model).find(d=>d.open);
    assert.equal(later.x,open.x);
    assert.equal(later.halfWidth,open.halfWidth);
    h.set({lefty:true,inverted:true});
    assert.equal(h.ensure(handShapes,localTemplates,localAnchors),model,'orientation is applied live');
    const mirrored = h.draw(11,model);
    for(let i=0;i<first.length;i++){
        assert.equal(mirrored[i].x,-first[i].x);
        assert.equal(mirrored[i].y,5-first[i].y);
        assert.equal(mirrored[i].halfWidth,first[i].halfWidth);
    }
});

test('unanchored open shapes have stable finite bounds without consulting the camera', () => {
    const h = harness();
    for(const frets of [[0,0,-1,-1,-1,-1],[-1,0,12,14,-1,-1]]){
        const model=h.ensure([shape(10,12)],[{frets,arp:true}],[]);
        for(const now of [8,10,11]){
            const open=h.draw(now,model).find(d=>d.open);
            assert.ok(Number.isFinite(open.x)&&Number.isFinite(open.halfWidth)&&open.halfWidth>0);
            assert.equal(open.x,h.draw(9,model).find(d=>d.open).x);
        }
    }
});

test('chart reference and string-count replacements invalidate only the cached guide index', () => {
    const h=harness(), handShapes=[shape(10,12)];
    const expanded=[{frets:[0,2,4,5,7,9,11,12],arp:true}];
    const model=h.ensure(handShapes,expanded,anchors);
    assert.equal(h.ensure(handShapes,expanded,anchors),model);
    assert.equal(h.draw(9,model).length,6);
    h.set({strings:8});
    const eight=h.ensure(handShapes,expanded,anchors);
    assert.notEqual(eight,model);
    assert.equal(h.draw(9,eight).length,8);
    const nextAnchors=[{time:0,fret:10,width:4}];
    const shifted=h.ensure(handShapes,expanded,nextAnchors);
    assert.notEqual(shifted,eight);
    assert.notEqual(h.draw(9,shifted)[0].x,h.draw(9,eight)[0].x);
    const unmarked=expanded.map(t=>({...t,arp:false}));
    assert.equal(h.ensure(handShapes,unmarked,nextAnchors).rows.length,0);
    assert.equal(h.ensure([],expanded,nextAnchors).rows.length,0);
    const appendable=[shape(10,12)];
    const original=h.ensure(appendable,expanded,nextAnchors);
    appendable.push(shape(20,22));
    const appended=h.ensure(appendable,expanded,nextAnchors);
    assert.notEqual(appended,original);
    assert.equal(h.draw(19,appended).length,8,'streamed handshape growth cannot leave the index stale');
});

test('invalid spans, unsupported frets and absent templates cannot create brackets', () => {
    const h=harness();
    const handShapes=[shape(10,10),shape(11,10),shape(NaN,12),shape(10,Infinity),shape(10,12,5),shape(20,22)];
    const malformed=[{frets:[-1,0,24,25,127,3.5],arp:true}];
    const before=JSON.stringify({handShapes,malformed});
    const model=h.ensure(handShapes,malformed,[]);
    assert.equal(model.rows.length,1);
    assert.deepEqual(h.draw(19,model).map(d=>d.string),[1,2]);
    assert.equal(JSON.stringify({handShapes,malformed}),before,'authored data stays unchanged');
});

test('indexed traversal skips expired chart history and seeks into long holds', () => {
    const h=harness();
    const handShapes=Array.from({length:2000},(_,i)=>shape(i*5,i*5+1));
    const model=h.ensure(handShapes,templates,anchors);
    let reads=0;
    const rows=new Proxy(model.rows,{get(target,key){if(/^[0-9]+$/.test(String(key)))reads++;return target[key];}});
    assert.equal(h.draw(9995,{...model,rows}).length,4);
    assert.ok(reads<5,`must skip expired rows rather than scan all ${reads}`);
    const nested=h.ensure([shape(10,100),shape(20,21),shape(30,31)],templates,anchors);
    assert.equal(h.draw(90,nested).length,4,'old long hold remains discoverable');
    assert.equal(h.draw(19,nested).length,8,'backward seek includes the shorter occurrence');
});
