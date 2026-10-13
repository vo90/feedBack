const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 1, end = open + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0, name);
    return source.slice(start, end);
}
const constant = name => {
    const match = source.match(new RegExp(`const ${name} = [^;]+;`));
    assert.ok(match, name);
    return match[0];
};
const { ratio, needs } = new Function(`${constant('FRET_REFERENCE_CLEARANCE')}
    ${extract('hwyFretReferenceSeparationRatio')}
    ${extract('hwyFretReferenceNeedsClearance')}
    return {ratio:hwyFretReferenceSeparationRatio, needs:hwyFretReferenceNeedsClearance};`)();
const views = new Function(`${constant('STABLE_CAMERA_VIEWS')} return STABLE_CAMERA_VIEWS;`)();
const Three = import(pathToFileURL(path.join(__dirname, '../../static/vendor/three/three.module.min.js')).href);
const K = 2.25 / 300, SPEED = 230 * K, AHEAD = 3, REFRESH = 174.963;
// Deliberately different optical bounds, not a claim about platform-specific fonts.
const GREY_INK = { minX: .28, maxX: .72, minY: .19, maxY: .81 };
const GOLD_INK = { minX: .24, maxX: .77, minY: .15, maxY: .83 };

function geometry(config, preset, lefty = false) {
    const view = views[preset], strings = config.strings || 6;
    const pitch = 25 * Math.PI / 180 - Math.atan2(view.pitch, 100);
    const yaw = preset === 'angled' ? (lefty ? -1 : 1) * 14 * Math.PI / 180 : 0;
    const baseline = -((strings - 1) / 2 + .8) * 4 * K - view.panY * K;
    const dMin = Math.max(100 * K, ((strings - 1) * 4 * K + 14 * K) * 2.3) * view.distMul;
    const scale0 = 7 * K * config.text * config.fretScale;
    const maxSize = scale0 * 1.4;
    return { ...config, pitch, yaw, baseline, dMin, scale0, maxSize };
}
function envelope(config, widthMultiplier = 1) {
    return Math.min(...Object.keys(views).map(preset => {
        const g = geometry(config, preset);
        return ratio(g.pitch, g.yaw, g.baseline, g.dMin, SPEED * AHEAD,
            g.maxSize * widthMultiplier, config.aspect, 60);
    }));
}
function boundGap(config, ink = GOLD_INK, widthMultiplier = 1, dx = 0) {
    const g = geometry(config, 'straight');
    const r = envelope(config, widthMultiplier);
    return g.maxSize * (1 - ink.minY + (ink.maxY - ink.minY) / 3) / (SPEED * r)
        + Math.tan(14 * Math.PI / 180) * Math.abs(dx) / SPEED;
}
function camera(T, g, dt, phase, distanceFactor = 1) {
    const d = g.dMin * distanceFactor;
    const sp = Math.sin(g.pitch), cp = Math.cos(g.pitch), sy = Math.sin(g.yaw), cy = Math.cos(g.yaw);
    // Pan independently of the fretboard; include a partly offscreen sprite.
    const q = phase * Math.tan(Math.PI / 6) * g.aspect;
    const r = (q * (d - sp * g.baseline + cy * cp * SPEED * dt) - sy * SPEED * dt)
        / (cy + q * sy * cp);
    const cam = new T.PerspectiveCamera(60, g.aspect, .01, 10000);
    cam.projectionMatrix.elements[9] = .48;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.position.set(-r + sy * cp * d, sp * d, cy * cp * d);
    cam.lookAt(-r, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
}
function inkRect(T, cam, g, dt, ink, dx = 0, widthMultiplier = 1) {
    const sprite = new T.Sprite();
    sprite.center.set(.5, 1);
    const size = g.scale0 * (1 + .4 * dt / AHEAD);
    sprite.position.set(dx, g.baseline, -SPEED * dt);
    sprite.scale.set(size * widthMultiplier, size, 1);
    sprite.updateMatrixWorld(true);
    const centre = new T.Vector3().setFromMatrixPosition(sprite.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, depth: -centre.z };
    // Three's billboard vertex transform: camera-space sprite centre + scaled
    // quad offsets, followed by its actual PerspectiveCamera projection matrix.
    for (const x of [ink.minX, ink.maxX]) for (const y of [ink.minY, ink.maxY]) {
        const corner = centre.clone().add(new T.Vector3((x - sprite.center.x) * sprite.scale.x,
            (y - sprite.center.y) * sprite.scale.y, 0)).applyMatrix4(cam.projectionMatrix);
        out.minX = Math.min(out.minX, corner.x); out.maxX = Math.max(out.maxX, corner.x);
        out.minY = Math.min(out.minY, corner.y); out.maxY = Math.max(out.maxY, corner.y);
    }
    return out;
}
const visibleX = r => r.maxX >= -1 && r.minX <= 1;
const clearance = (a, b) => Math.max(a.minY - b.maxY, b.minY - a.maxY);
const margin = (a, b) => Math.max(a.maxY - a.minY, b.maxY - b.minY) / 3;
const configs = [
    { aspect: 3440 / 1323, text: 1, fretScale: 1, strings: 6 },
    { aspect: 16 / 9, text: .5, fretScale: .32, strings: 4 },
    { aspect: 1, text: 1.5, fretScale: 1.45, strings: 8 },
    { aspect: 3440 / 1323, text: 1.5, fretScale: 1.45, strings: 7 },
    { aspect: 5, text: .6, fretScale: .7, strings: 6 },
];

function caller(config = {}, events = []) {
    return new Function('cfg', 'events', `${constant('FRET_REFERENCE_CLEARANCE')}
        ${constant('STABLE_CAMERA_FOV')}
        ${constant('STABLE_CAMERA_PITCH')}
        ${constant('STABLE_CAMERA_YAW')}
        ${constant('STABLE_CAMERA_VIEWS')}
        ${constant('STABLE_CAMERA_PRESETS')}
        const K=2.25/300, TS=230*K, AHEAD=3, S_GAP=4*K, nStr=cfg.strings||6;
        const _textSizeMul=cfg.text||1, cam={aspect:cfg.aspect||3440/1323};
        const cameraMode=cfg.mode||'stable', highwayCanvas={}, _freeCamFor=()=>({enabled:!!cfg.free});
        const sY=s=>(3+(nStr-1-s)*4)*K, xFret=f=>f*10*K, xFretMid=f=>(f-.5)*10*K;
        const fretLabelScaleForFret=()=>cfg.fretScale||1, FRET_LABEL_GOLD_HEX='gold';
        const _highwayReferenceLabelColor=()=> 'grey';
        const txtMat=(f,color)=>({map:{image:{width:cfg.captionWidth||256,height:256},userData:{
            hwyLabelInk:color==='gold'?cfg.goldInk:cfg.greyInk}}});
        const byFret=Array.from({length:25},()=>[]);
        for(const event of events) byFret[event.fret||5].push(event);
        byFret.forEach(a=>a.sort((a,b)=>a.t-b.t));
        const _fretMarkerGoldCache={byFret};
        ${extract('lowerBoundT')}
        ${extract('hwyFretReferenceSeparationRatio')}
        ${extract('hwyFretReferenceNeedsClearance')}
        ${extract('_fretReferenceHiddenFrets')}
        return {hidden:(time,frets=[3,5,7])=>[..._fretReferenceHiddenFrets(time,frets)]};`
    )({ ...configs[0], greyInk: GREY_INK, goldInk: GOLD_INK, ...config }, events);
}

test('stable ratio is positive and mirror invariant for ordinary supported viewports', () => {
    for (const cfg of configs) for (const preset of Object.keys(views)) {
        const g = geometry(cfg, preset);
        const args = [g.baseline, g.dMin, SPEED * AHEAD, g.maxSize, cfg.aspect, 60];
        const a = ratio(g.pitch, g.yaw, ...args), b = ratio(g.pitch, -g.yaw, ...args);
        assert.ok(Number.isFinite(a) && a > 0);
        assert.ok(Math.abs(a - b) < 1e-14);
    }
    assert.equal(envelope({ ...configs[0], aspect: 20 }), 0);
});

test('real Three projection respects the scalar bound throughout a 174.963 Hz approach', async () => {
    const T = await Three;
    let checked = 0;
    for (const cfg of configs) for (const preset of Object.keys(views)) for (const lefty of [false, true]) {
        const g = geometry(cfg, preset, lefty), r = envelope(cfg);
        for (let frame = 0; frame <= Math.ceil(AHEAD * REFRESH); frame++) {
            const dt = Math.max(0, AHEAD - frame / REFRESH), u = frame / (AHEAD * REFRESH);
            const cam = camera(T, g, dt, Math.sin(u * Math.PI * 4) * 1.002,
                1 + 30 * Math.sin(u * Math.PI * 2) ** 2);
            const rect = inkRect(T, cam, g, dt, GREY_INK);
            if (!visibleX(rect)) continue;
            const actual = Math.cos(g.yaw) * (cam.position.y - g.baseline) / rect.depth;
            assert.ok(actual + 1e-12 >= r, `${preset}/${cfg.aspect}/${dt}: ${actual} < ${r}`);
            checked++;
        }
    }
    assert.ok(checked > 9000, `insufficient visible poses: ${checked}`);
});

test('actual 76.996 ms pair is omitted for its full approach in either temporal order', async () => {
    const T = await Three, beatTime = 220.673996;
    // Recording issue1: gold {t:220.597,s:0,f:3,ig:true,po:true}, measure165.
    const offset = beatTime - 220.597;
    assert.ok(Math.abs(offset - .076996) < 1e-10);
    for (const delta of [-offset, offset]) {
        const h = caller({}, [{ t: beatTime + delta, text: '3', fret: 3, node: null }]);
        const hiddenForWholeWave = h.hidden(beatTime);
        assert.deepEqual(hiddenForWholeWave, [3]);
        let violatesMargin = 0, sampled = 0;
        for (const preset of Object.keys(views)) {
            const g = geometry(configs[0], preset);
            for (let frame = 0; frame <= Math.ceil(AHEAD * REFRESH); frame++) {
                const greyDt = Math.max(0, AHEAD - frame / REFRESH), goldDt = greyDt + delta;
                if (goldDt < 0 || goldDt > AHEAD) continue;
                const cam = camera(T, g, greyDt, 0, 1);
                const grey = inkRect(T, cam, g, greyDt, GREY_INK);
                const gold = inkRect(T, cam, g, goldDt, GOLD_INK);
                if (clearance(grey, gold) < margin(grey, gold)) violatesMargin++;
                assert.equal(hiddenForWholeWave.includes(3), true);
                sampled++;
            }
        }
        assert.ok(sampled > 900 && violatesMargin > 0);
    }
});

test('positive ink gap smaller than one-third numeral height is still omitted', async () => {
    const T = await Three, cfg = configs[0], g = geometry(cfg, 'straight');
    const dt = .5, cam = camera(T, g, dt, 0, 1);
    const low = inkRect(T, cam, g, dt, GREY_INK);
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
        const delta = (lo + hi) / 2, upper = inkRect(T, cam, g, dt + delta, GOLD_INK);
        if (clearance(low, upper) < margin(low, upper) / 2) lo = delta; else hi = delta;
    }
    const delta = (lo + hi) / 2, upper = inkRect(T, cam, g, dt + delta, GOLD_INK);
    assert.ok(clearance(low, upper) > 0, 'fixture must not overlap');
    assert.ok(clearance(low, upper) < margin(low, upper), 'fixture must be inside safety margin');
    assert.equal(needs(delta, AHEAD, SPEED, envelope(cfg), g.maxSize, GOLD_INK), true);
    assert.deepEqual(caller({}, [{ t: 185 + delta, fret: 5, text: '5' }]).hidden(185), [5]);
});

test('retained pairs have a full one-third-height gap across approach, pan, zoom and timing order', async () => {
    const T = await Three;
    let checked = 0;
    for (const cfg of configs) {
        const delta = boundGap(cfg) * 1.015;
        assert.ok(delta < AHEAD, 'fixture must retain a co-approaching reference');
        const h = caller(cfg, [{ t: 100 + delta, text: '5', fret: 5 }]);
        assert.deepEqual(h.hidden(100), []);
        for (const preset of Object.keys(views)) for (const lefty of [false, true]) for (const reverse of [false, true]) {
            const g = geometry(cfg, preset, lefty);
            for (let frame = 0; frame <= Math.ceil((AHEAD - delta) * REFRESH); frame++) {
                const dt = Math.max(0, AHEAD - delta - frame / REFRESH);
                const u = frame / Math.max(1, (AHEAD - delta) * REFRESH);
                const cam = camera(T, g, dt, Math.sin(u * Math.PI * 6) * .99,
                    1 + 20 * Math.sin(u * Math.PI * 2) ** 2);
                const grey = inkRect(T, cam, g, reverse ? dt + delta : dt, GREY_INK);
                const gold = inkRect(T, cam, g, reverse ? dt : dt + delta, GOLD_INK);
                if (!visibleX(grey) || !visibleX(gold)) continue;
                assert.ok(clearance(grey, gold) + 1e-12 >= margin(grey, gold),
                    `${preset}/${cfg.aspect}/${reverse}/${dt}: clearance ${clearance(grey,gold)} < ${margin(grey,gold)}`);
                checked++;
            }
        }
    }
    assert.ok(checked > 5000, `insufficient retained pair projections: ${checked}`);
});

test('opposing glyph descent/height extrema reserve the larger values independently', async () => {
    const T = await Three, cfg = configs[0], g = geometry(cfg, 'straight'), r = envelope(cfg);
    const a = { minX: .2, maxX: .8, minY: .2, maxY: .5 };
    const b = { minX: .2, maxX: .8, minY: .3, maxY: 1 };
    const oldExtent = Math.max(.8 + .3 / 3, .7 + .7 / 3);
    const fullExtent = .8 + .7 / 3;
    const delta = g.maxSize * (oldExtent + fullExtent) / 2 / (SPEED * r);
    assert.equal(needs(delta, AHEAD, SPEED, r, g.maxSize, a), false);
    assert.equal(needs(delta, AHEAD, SPEED, r, g.maxSize, b), false);
    assert.equal(needs(delta, AHEAD, SPEED, r, g.maxSize, a, b), true);
    assert.equal(needs(delta, AHEAD, SPEED, r, g.maxSize, b, a), true);
    assert.deepEqual(caller({ greyInk: a, goldInk: b }, [{ t: 100 + delta, fret: 5, text: '5' }]).hidden(100), [5]);
    const retainedDelta = g.maxSize * fullExtent / (SPEED * r) * 1.015;
    assert.equal(needs(retainedDelta, AHEAD, SPEED, r, g.maxSize, a, b), false);
    let checked = 0;
    for (const preset of Object.keys(views)) for (const reverse of [false, true]) {
        const pose = geometry(cfg, preset);
        for (let frame = 0; frame <= Math.ceil((AHEAD - retainedDelta) * REFRESH); frame++) {
            const dt = Math.max(0, AHEAD - retainedDelta - frame / REFRESH), u = frame / REFRESH;
            const cam = camera(T, pose, dt, Math.sin(u * 4) * .99, 1 + Math.sin(u * 2) ** 2 * 20);
            const grey = inkRect(T, cam, pose, reverse ? dt + retainedDelta : dt, a);
            const gold = inkRect(T, cam, pose, reverse ? dt : dt + retainedDelta, b);
            if (!visibleX(grey) || !visibleX(gold)) continue;
            assert.ok(clearance(grey, gold) + 1e-12 >= margin(grey, gold));
            checked++;
        }
    }
    assert.ok(checked > 900);
});

test('horizon boundaries exclude never-co-visible pairs before harmonic-X compensation', () => {
    for (const delta of [-AHEAD, AHEAD, -AHEAD - .001, AHEAD + .001]) {
        assert.equal(needs(delta, AHEAD, SPEED, 0, .1, GOLD_INK), false);
        for (const node of [null, 20]) {
            const h = caller({ free: true }, [{ t: 100 + delta, fret: 5, text: '5', node }]);
            assert.deepEqual(h.hidden(100), [], `delta=${delta} node=${node}`);
        }
    }
    for (const delta of [-AHEAD + .001, AHEAD - .001]) {
        assert.deepEqual(caller({ free: true }, [{ t: 100 + delta, fret: 5, text: '5' }]).hidden(100), [5]);
    }
});

test('caller includes natural-harmonic contact-X allowance and expanded caption width', async () => {
    const T = await Three, cfg = configs[0], node = 15;
    const dx = (node - (5 - .5)) * 10 * K, width = 2;
    const ordinaryGap = boundGap(cfg), harmonicGap = boundGap(cfg, GOLD_INK, width, dx);
    const between = (ordinaryGap + harmonicGap) / 2;
    assert.deepEqual(caller({}, [{ t: 100 + between, fret: 5, text: '5', node: null }]).hidden(100), []);
    assert.deepEqual(caller({ captionWidth: 512 }, [{ t: 100 + between, fret: 5, text: '15', node }]).hidden(100), [5]);
    const delta = harmonicGap * 1.02;
    assert.ok(delta < AHEAD);
    assert.deepEqual(caller({ captionWidth: 512 }, [{ t: 100 + delta, fret: 5, text: '15', node }]).hidden(100), []);
    let checked = 0;
    for (const preset of Object.keys(views)) for (const lefty of [false, true]) for (const reverse of [false, true]) {
        const g = geometry(cfg, preset, lefty);
        for (let frame = 0; frame <= Math.ceil((AHEAD - delta) * REFRESH); frame++) {
            const dt = Math.max(0, AHEAD - delta - frame / REFRESH), u = frame / REFRESH;
            const cam = camera(T, g, dt, Math.sin(u * 5) * .9, 1 + Math.sin(u * 2) ** 2 * 12);
            const grey = inkRect(T, cam, g, reverse ? dt + delta : dt, GREY_INK);
            const gold = inkRect(T, cam, g, reverse ? dt : dt + delta, GOLD_INK, dx, width);
            if (!visibleX(grey) || !visibleX(gold)) continue;
            assert.ok(clearance(grey, gold) + 1e-12 >= margin(grey, gold));
            checked++;
        }
    }
    assert.ok(checked > 500);
});

test('unpredictable legacy/free cameras omit co-approaching matches but keep unrelated references', () => {
    for (const config of [{ mode: 'steady' }, { mode: 'lookahead' }, { free: true }, { aspect: 20 }]) {
        assert.deepEqual(caller(config, [{ t: 102.9, fret: 5, text: '5' }]).hidden(100), [5]);
        assert.deepEqual(caller(config, [{ t: 103.1, fret: 5, text: '5' }]).hidden(100), []);
        assert.deepEqual(caller(config, []).hidden(100), []);
    }
});
