const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function between(start, end, from = 0) {
    const a = src.indexOf(start, from), b = src.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return src.slice(a, b);
}
function fn(name) {
    const start = src.indexOf('function ' + name + '('), open = src.indexOf('{', start);
    assert.ok(start >= 0, name);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed ' + name);
}
function vector() {
    return { x: 0, y: 0, z: 0,
        set(x, y, z) { Object.assign(this, { x, y, z }); return this; },
        multiplyScalar(n) { this.x *= n; this.y *= n; this.z *= n; return this; } };
}
function mesh() {
    return { visible: true, position: vector(), scale: vector(), rotation: vector(),
        material: { color: { setHex(hex) { this.hex = hex; } } } };
}
function close(actual, expected) {
    assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

function harness() {
    // Execute actual material construction and the contiguous pooled gem draw
    // path. Mock only Three objects and unrelated trail bookkeeping.
    const materialStart = src.indexOf('function _initRsNotation(');
    return new Function('mesh', `
        const NW = 5, NH = 3, ND = .25, K = 1, S_GAP = 4, AHEAD = 3;
        const activePalette = [0xff2222,0xffdd33,0x3388ff,0xff8822,0x44cc55,0xcc22dd,0xffffff,0x888888];
        const T = { MeshBasicMaterial: class { constructor(options) {
            Object.assign(this, options); this.type = 'MeshBasicMaterial';
        } } };
        let mRsBody, mRsRim, mRsAccentRim, mRsHitRim, mRsSus, mRsSusHit, mRsSusEdge, mRsMissRim, mRsOpenStem;
        ${between('const basic = (color', '// An outside-only', materialStart)}
        const mRsHalo = activePalette.map(() => ({name:'rs-halo'}));
        const mStr = activePalette.map(() => ({name:'current-body'}));
        const mAccentCore = activePalette.map(() => ({name:'current-accent'}));
        const mAccentOutline = activePalette.map(() => ({name:'current-accent-rim'}));
        const gNote = {name:'box'}, gRsNote = {name:'rounded'}, gRsNoteHalo = {name:'halo'};
        const gNoteGrad = activePalette.map(() => ({name:'current-gradient'}));
        const gRsNoteGrad = activePalette.map(() => ({name:'rs-gradient'}));
        ${fn('pool')}
        const groups = {};
        function trackedPool(name) {
            const group = {meshes:[], add(m) {this.meshes.push(m);}};
            groups[name] = group; return pool(group, mesh);
        }
        const pNote = trackedPool('notes'), pNoteEdge = trackedPool('edges');
        const pAccentHalo = trackedPool('halos'), pConnectorLine = trackedPool('connectors');
        const pDropLine = trackedPool('drops');
        const pools = [pNote,pNoteEdge,pAccentHalo,pConnectorLine,pDropLine];
        const hwyTrailYieldGemLayer = (a,b,layer) => layer;
        const renderOrderForLayerAtZ = () => 4;
        const trailYieldRegisterGem = () => {}, trailOrderRegisterUpcomingGem = () => {};
        return function draw(options = {}) {
            pools.forEach(p => p.reset());
            const rsPlusNotation = options.style !== 'current';
            const nStr = options.strings ?? 6, s = options.string ?? 0;
            const sY = index => (options.inverted ? nStr-1-index : index) * S_GAP;
            const n = {f:options.fret ?? 0, ac:!!options.accent, s};
            const x = 30, y = sY(s), techniqueYNow = options.offset ?? 0;
            const dt = options.dt ?? .1, noteZ = -10 * dt;
            const fromChord = !!options.chord, _leftyCached = !!options.lefty;
            const openWScale = options.width ?? 1;
            const ACCENT_RIM_XY_SCALE_MUL = 1.09, ACCENT_RIM_Z_SCALE_MUL = 1.06;
            ${between('const openSlabThickMul =', '// Ghost preview window:')}
            const rimXY = !rsPlusNotation && n.ac ? ACCENT_RIM_XY_SCALE_MUL : 1;
            const rimZ = !rsPlusNotation && n.ac ? ACCENT_RIM_Z_SCALE_MUL : 1;
            const _ndState = options.verdict ?? null, _ndCs = _ndState ? {} : null;
            const _ndGood = _ndState === 'hit', _ndMatchedMark = null, _ndHadHitMark = false;
            const _ndOutline = {name:'current-rim'}, _ndFaceMat = _ndState ? [{name:'verdict'}] : null;
            const _hitPunch = 1, trailYieldTargetEvent = null, trailYieldGemInFront = false, _trailYieldFrameId = 1;
            const notationSoftGlow = () => options.glow ?? 0;
            ${between('const outline = pNote.get();', '// Fret digits on fretted')}
            if (n.f > 0) {
                const labelY = Math.min(sY(0),sY(nStr-1)) - S_GAP * .8;
                const alpha = 1, _isArpNote = false;
                ${between('if (!fromChord) {', '// Regular chord notes', src.indexOf('// ── Per-note fret connector label'))}
            }
            const showDropLine = options.drop !== false, skipBody = !!options.skipBody;
            const explicitLinkTarget = !!options.linked;
            ${between('const _wantDropLine =', '// ── Board ghost:')}
            return {outline, core, halo:noteHaloMesh, edges:noteFaceMesh,
                connectors:groups.connectors.meshes.filter(m => m.visible),
                drops:groups.drops.meshes.filter(m => m.visible),
                counts:Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,g.meshes.length])),
                floor:Math.min(sY(0),sY(nStr-1))-S_GAP*.55,
                materials:{stem:mRsOpenStem,miss:mRsMissRim,hit:mRsHitRim[s]},
                y:y+techniqueYNow};
        };
    `)(mesh);
}

test('RS+ open bars keep opaque bodies and thin stems inside the playable width in either handedness', () => {
    const draw = harness();
    for (const width of [.22, 1, 2]) for (const lefty of [false,true]) {
        for (const accent of [false,true]) for (const dt of [.02,1.5,2.99]) {
            const r = draw({width,lefty,accent,dt});
            const barWidth = r.core.scale.x * 5, stemWidth = r.outline.scale.x * 5;
            close(barWidth, 40 * width);
            close(stemWidth, .3);
            close(r.outline.position.x, 30 + (lefty ? 1 : -1) * (barWidth-stemWidth)/2);
            assert.ok(r.outline.position.x-stemWidth/2 >= 30-barWidth/2-1e-10);
            assert.ok(r.outline.position.x+stemWidth/2 <= 30+barWidth/2+1e-10);
            assert.ok(stemWidth < barWidth*.04, 'the pale mesh is a vertical stem, not long horizontal caps');
            assert.equal(r.outline.material, r.materials.stem);
            assert.equal(r.outline.geometry.name, 'box');
            assert.equal(r.core.geometry.name, 'rs-gradient');
            assert.equal(r.core.material.type, 'MeshBasicMaterial');
            assert.equal(r.core.material.opacity, 1);
            assert.equal(r.core.material.fog, false);
            assert.equal(r.core.material.toneMapped, false);
            assert.equal(r.core.material.vertexColors, true);
            close(r.core.scale.y*3, accent ? .675 : .45);
        }
    }
});

test('standalone stems reach the floor on all strings while chord stems stay local to their bars', () => {
    const draw = harness();
    for (const strings of [4,6,7,8]) for (const inverted of [false,true]) {
        for (let string=0;string<strings;string++) for (const chord of [false,true]) {
            const r = draw({strings,inverted,string,chord,offset:.7});
            const halfHeight = r.outline.scale.y*3/2;
            close(r.outline.position.y+halfHeight, r.y+1.35);
            close(r.outline.position.y-halfHeight, chord ? r.y-1.35 : r.floor);
        }
    }
});

test('accent open halos and verdict edges follow bar height without stretching along the floor stem', () => {
    const draw = harness();
    for (const accent of [false,true]) for (const verdict of ['hit','miss']) {
        const r = draw({accent,verdict,glow:1,string:5});
        assert.equal(r.outline.material, r.materials[verdict]);
        close(r.edges.scale.y, r.core.scale.y*1.02);
        if (verdict === 'hit') {
            assert.ok(r.halo);
            close(r.halo.scale.x, r.core.scale.x);
            close(r.halo.scale.y, r.core.scale.y);
            assert.ok(r.halo.scale.y < r.outline.scale.y*.04);
        } else assert.equal(r.halo, null);
    }
    assert.equal(draw({accent:true,glow:0}).halo, null);
    assert.equal(draw({accent:false,glow:1}).halo, null);
});

test('shared gem pools restore Current and fretted RS+ geometry and materials after open stems', () => {
    const draw = harness();
    const snapshot = r => JSON.stringify([r.outline.geometry,r.outline.material,r.outline.position,
        r.outline.scale,r.core.geometry,r.core.material,r.core.position,r.core.scale]);
    for (const accent of [false,true]) {
        const baseline = draw({style:'current',accent});
        const before = snapshot(baseline), reused = baseline.outline;
        const open = draw({accent,lefty:true,string:5,glow:1});
        assert.equal(open.outline,reused);
        const fretted = draw({fret:4,accent});
        assert.equal(fretted.outline,reused);
        assert.equal(fretted.outline.geometry.name,'rounded');
        assert.notEqual(fretted.outline.material,fretted.materials.stem);
        close(fretted.outline.position.x,30);
        assert.equal(snapshot(draw({style:'current',accent})),before);
        assert.equal(draw().counts.notes,2, 'no extra mesh is allocated for the open stem');
    }
});

test('RS+ standalone fret connectors reach displaced gems and Current keeps its shorter guide', () => {
    const draw = harness();
    for (const inverted of [false,true]) for (const offset of [-2.5,0,1.5,3]) {
        const r = draw({fret:12,string:3,offset,inverted});
        assert.equal(r.connectors.length,1);
        const line = r.connectors[0];
        close(line.position.y+line.scale.y,r.core.position.y);
        assert.equal(draw({fret:12,chord:true,offset,inverted}).connectors.length,0);
        const current = draw({style:'current',fret:12,string:3,offset,inverted});
        const c = current.connectors[0];
        close(c.scale.y,(current.core.position.y-offset-c.position.y)*.5);
    }
});

test('RS+ chord drop lines meet displaced gems without adding linked or disabled guides', () => {
    const draw = harness();
    for (const inverted of [false,true]) for (const offset of [-2.5,0,1.5,3]) {
        const r = draw({fret:14,string:3,offset,inverted,chord:true});
        assert.equal(r.drops.length,1);
        const line = r.drops[0];
        close(line.position.y+line.scale.y,r.core.position.y);
        const current = draw({style:'current',fret:14,string:3,offset,inverted,chord:true});
        const c = current.drops[0];
        close(c.scale.y,(current.core.position.y-offset-c.position.y)*.5);
    }
    for (const options of [{linked:true},{skipBody:true},{drop:false},{dt:-.01}]) {
        assert.equal(draw({fret:14,chord:true,...options}).drops.length,0);
    }
    assert.equal(draw({fret:0,chord:true}).drops.length,0);
});
