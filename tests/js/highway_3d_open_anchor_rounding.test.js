const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}
const names = ['getChartAnchorAt', 'getNoteAnchorAt', 'laneBoundsFromAnchor',
    'anchorLaneBoundsAt', 'noteAnchorLaneBoundsAt', 'openNoteLaneBoxW',
    'anchorPlayedFretInclusiveSpan', 'playedFretSpanCoversShape', 'chordFallbackLaneBounds',
    'chordShapeLaneBounds', 'trailOpenLayoutAt', 'trailYieldAddTargetXBounds', 'trailYieldOpenTargetXBounds'];
const harness = new Function(`
    const NFRETS=24, NW=5, K=1, OPEN_NOTE_PAD_X=2, curX=99;
    const ACCENT_RIM_XY_SCALE_MUL=1.09;
    ${source.match(/const CHORD_ANCHOR_TIME_EPS = [^;]+;/)[0]}
    let _drawAnchors=[], lefty=false, rsPlusNotation=true;
    const fretX=f=>f*10, xFret=f=>lefty ? -fretX(f) : fretX(f);
    ${names.map(extract).join('\n')}
    return { exact:getChartAnchorAt, event:getNoteAnchorAt, bounds:noteAnchorLaneBoundsAt,
        layout(anchors,time,mirror=false,meta=null) {
            _drawAnchors=anchors;lefty=mirror;
            return {pair:Array.from(trailOpenLayoutAt(time,meta,anchors,new Float64Array(2))),
                width:openNoteLaneBoxW(time),
                footprint:(()=>{const b=new Float64Array(2);
                    trailYieldOpenTargetXBounds({t:time,standalone:!meta,chordMeta:meta},b);
                    return Array.from(b);})()};
        } };
`)();

test('Cirice wire-rounded first open uses the same destination as the next two opens', () => {
    const anchors=[{time:0,fret:1,width:4},{time:291.04125,fret:12,width:4}];
    for (const time of [291.041,291.37,291.706]) {
        assert.deepEqual(harness.bounds(anchors,time),{dMin:11,dMax:15});
        assert.equal(harness.event(anchors,time),anchors[1]);
    }
    assert.equal(harness.exact(anchors,291.041),anchors[0], 'continuous lane boundaries keep source timing');
});

test('rounding in either direction and the half-millisecond boundary resolve one onset', () => {
    for (const [original,wire] of [[291.04125,291.041],[212.3925,212.393],[10.0005,10],[10.0005,10.001]]) {
        const anchors=[{time:0,fret:2,width:4},{time:original,fret:12,width:4}];
        assert.equal(harness.event(anchors,wire),anchors[1]);
    }
});

test('notes genuinely before the boundary keep their lane and later lanes are not borrowed', () => {
    const anchors=[{time:0,fret:2,width:4},{time:10.000502,fret:12,width:4},
        {time:10.01,fret:18,width:4}];
    assert.equal(harness.event(anchors,10),anchors[0]);
    assert.equal(harness.event(anchors,10.001),anchors[1]);
    assert.equal(harness.event(anchors,10.009),anchors[1]);
    assert.equal(harness.event(anchors,10.01),anchors[2]);
});

test('open width, trail centre and occlusion footprint agree at rounded narrow/wide boundaries', () => {
    for (const width of [1,4,7]) for (const lefty of [false,true]) {
        const anchors=Object.freeze([Object.freeze({time:0,fret:1,width:4}),
            Object.freeze({time:10.00025,fret:12,width})]);
        const actual=harness.layout(anchors,10,lefty);
        const expectedCenter=(lefty?-1:1)*(110+(width*10)/2);
        assert.deepEqual(actual.pair,[expectedCenter,width*10+4]);
        assert.equal(actual.width,actual.pair[1]);
        assert.ok(Math.abs((actual.footprint[0]+actual.footprint[1])/2-expectedCenter)<1e-10);
        assert.ok(Math.abs(actual.footprint[1]-actual.footprint[0]-actual.width*.96)<1e-10);
    }
});

test('open chord and standalone trail layouts share the rounded onset lookup', () => {
    const anchors=[{time:0,fret:1,width:4},{time:10.00025,fret:12,width:4}];
    for (const meta of [null,{size:1,minF:Infinity,maxF:-Infinity},{size:2,minF:12,maxF:15}]) {
        const actual=harness.layout(anchors,10,false,meta);
        assert.equal(actual.pair[0],130);
        assert.equal((actual.footprint[0]+actual.footprint[1])/2,130);
    }
});

test('missing anchors keep the existing fallback and do not mutate chart data', () => {
    assert.equal(harness.event([],10),null);
    assert.equal(harness.bounds(null,10),null);
    assert.deepEqual(harness.layout([],10).pair,[99,44]);
});
