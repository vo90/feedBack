const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function blockAt(marker, from = 0) {
    const start = src.indexOf(marker, from);
    assert.ok(start >= 0, marker);
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed block: ' + marker);
}
function between(start, end) {
    const first = src.indexOf(start), last = src.indexOf(end, first);
    assert.ok(first >= 0 && last > first, start);
    return src.slice(first, last);
}
function vector() {
    return { values: [], set(...values) { this.values = values; return this; } };
}
function color() {
    return { setHex(value) { this.hex = value; return this; },
        setRGB(...value) { this.rgb = value; return this; },
        lerp(value, amount) { this.mix = amount; return this; } };
}
function mesh() {
    const uniforms = Object.fromEntries(['uRim', 'uRadius', 'uPad', 'uOpenTop',
        'uHalo', 'uOpacity'].map(key => [key, { value: 0 }]));
    uniforms.uSize = { value: vector() };
    uniforms.uColor = { value: color() };
    return { visible: true, position: vector(), scale: vector(), rotation: vector(),
        material: { color: color(), emissive: color(), uniforms, opacity: 1, emissiveIntensity: 1 } };
}

function frameHarness() {
    // Execute the actual pooled renderer and frame dispatch, so opacity or
    // style changes made during drawing cannot hide behind a helper-only test.
    return new Function('mesh', `
        ${blockAt('function pool(')}
        const groups = {};
        function trackedPool(name) {
            const group = { meshes: [], add(m) { this.meshes.push(m); } };
            groups[name] = group;
            return pool(group, mesh);
        }
        const pChordBox = trackedPool('currentRims');
        const pHaloBar = trackedPool('currentHalos');
        const pChordFrameFill = trackedPool('fills');
        const pRsChordFrame = trackedPool('rounded');
        const pools = [pChordBox, pHaloBar, pChordFrameFill, pRsChordFrame];
        let rsPlusNotation = false, glowMul = 0, _bloom = false;
        function notationSoftGlow() { return rsPlusNotation && _bloom ? glowMul : 0; }
        function renderOrderForLayerAtZ(z, layer) {
            return z * 100 + ['CHORD_FILL', 'CHORD_FRAME', 'CHORD_EDGE_GLOW'].indexOf(layer);
        }
        ${blockAt('function drawRsPlusChordFrame(')}
        return function render(options = {}) {
            rsPlusNotation = options.style !== 'current';
            glowMul = options.glow ?? 0;
            _bloom = options.soft ?? false;
            pools.forEach(p => p.reset());
            const chDt = options.dt ?? .5, AHEAD = 3, K = 1;
            const chordTailMul = options.tail ?? 1;
            const isRepeat = !!options.repeat;
            const compactRepeatFrame = isRepeat && !options.retained;
            const fullChordBoxH = 24, height = compactRepeatFrame ? 12 : 24;
            const width = options.width ?? 30, cx = 17, yBot = 2, yTop = yBot + height;
            const cY = (yBot + yTop) / 2, z = -chDt * 2;
            const chordNotes = [{ ac: !!options.accent }];
            const CHORD_FRAME_RIM_MIN = .055, CHORD_FRAME_RIM_FRAC_H = .028;
            const CHORD_FRAME_RIM_Z_MIN = .048, CHORD_FRAME_RIM_Z_SCAL = .68;
            const chordHighwayLavenderArpVisual = !!options.arpeggio;
            const ARPEGGIO_RIM_BLUE_HEX = 0xa58aff, CHORD_BOX_TEAL_HEX = 0x00d2d5;
            const chordFrameGradTex = 'teal', chordFrameGradTexArp = 'purple';
            ${between('const fade = rsPlusNotation', '// Capture the neutral frame color')}
            ${between('const repDim =', 'const chordName = chordTemplateLabel')}
            return Object.fromEntries(Object.entries(groups).map(([name, group]) =>
                [name, group.meshes.filter(m => m.visible)]));
        };
    `)(mesh);
}

test('RS+ frame edge and interior contrast stay constant across distance and plain repeats', () => {
    const render = frameHarness();
    for (const dt of [.02, 1.5, 2.99]) {
        for (const repeat of [false, true]) {
            const result = render({ dt, repeat });
            assert.equal(result.currentRims.length, 0);
            assert.equal(result.currentHalos.length, 0);
            assert.equal(result.rounded.length, 1);
            assert.equal(result.rounded[0].material.uniforms.uOpacity.value, 1);
            assert.equal(result.fills[0].material.opacity, 1);
        }
    }
});

test('rounded frames keep exact anchor bounds and compact repeats retain an open top', () => {
    const render = frameHarness();
    for (const width of [8, 30, 65]) {
        for (const repeat of [false, true]) {
            const frame = render({ width, repeat }).rounded[0];
            const height = repeat ? 12 : 24;
            assert.deepEqual(frame.scale.values, [width, height, 1]);
            assert.deepEqual(frame.position.values.slice(0, 2), [17, 2 + height / 2]);
            assert.deepEqual(frame.material.uniforms.uSize.value.values, [width, height]);
            assert.equal(frame.material.uniforms.uOpenTop.value, repeat ? 1 : 0);
            assert.ok(frame.material.uniforms.uRadius.value <= Math.min(width, height) * .18);
        }
    }
    assert.equal(render({ repeat: true, retained: true }).rounded[0].material.uniforms.uOpenTop.value, 0);
});

test('accent frame emphasis survives Glow zero without changing bounds or opacity', () => {
    const render = frameHarness();
    const ordinary = render().rounded[0].material.uniforms.uRim.value;
    const accented = render({ accent: true }).rounded[0];
    assert.ok(accented.material.uniforms.uRim.value > ordinary * 1.5);
    assert.deepEqual(accented.scale.values, [30, 24, 1]);
    assert.equal(accented.material.uniforms.uOpacity.value, 1);
});

test('soft frame glow requires both controls and is bounded outside the unchanged crisp frame', () => {
    const render = frameHarness();
    for (const options of [{ glow: 0, soft: true }, { glow: 1, soft: false }]) {
        assert.equal(render(options).rounded.length, 1);
    }
    const result = render({ glow: 1, soft: true, accent: true });
    assert.equal(result.rounded.length, 2);
    const [rim, halo] = result.rounded;
    const u = halo.material.uniforms;
    assert.equal(u.uHalo.value, 1);
    assert.ok(u.uOpacity.value > 0 && u.uOpacity.value <= .3);
    assert.equal(u.uPad.value, u.uRim.value * 2.5);
    assert.deepEqual(rim.scale.values, [30, 24, 1]);
    assert.deepEqual(halo.scale.values, [30 + 2 * u.uPad.value, 24 + 2 * u.uPad.value, 1]);
    assert.equal(rim.material.uniforms.uOpacity.value, 1);
});

test('Current style round trips preserve its bars, accent halo and opacity policy', () => {
    const render = frameHarness();
    const options = { style: 'current', dt: 1.5, repeat: true, accent: true, retained: true };
    const before = render(options);
    const baseline = { rims: before.currentRims.length, halos: before.currentHalos.length,
        edge: before.currentRims[0].material.opacity, fill: before.fills[0].material.opacity };
    assert.ok(baseline.rims > 0 && baseline.halos > 0);
    assert.equal(baseline.edge, .5);
    assert.equal(baseline.fill, .5 * .78);
    assert.equal(render({ glow: 1, soft: true }).currentRims.length, 0);
    const after = render(options);
    assert.equal(after.rounded.length, 0);
    assert.deepEqual({ rims: after.currentRims.length, halos: after.currentHalos.length,
        edge: after.currentRims[0].material.opacity, fill: after.fills[0].material.opacity }, baseline);
    assert.equal(frameHarness()({ glow: 0 }).rounded.length, 1, 'a second panel owns independent pools');
});

test('event tail multiplier still retires frame effects without a distance fade', () => {
    const result = frameHarness()({ tail: .25, glow: 1, soft: true });
    assert.equal(result.fills[0].material.opacity, .25);
    assert.equal(result.rounded[0].material.uniforms.uOpacity.value, .25);
    assert.equal(result.rounded[1].material.uniforms.uOpacity.value, .075);
});

const flashStart = src.indexOf('// ── Fret-wire hit flash (apply)');
const flash = new Function('mesh', 'rsPlusNotation', 'glowMul', '_hitFx', `
    const fretWireMats = [mesh().material, mesh().material];
    const mRimFlash = [mesh().material];
    const _fwLo = 0, _fwHi = 1, _fwHitGlow = [1, .5], _rimFlashIn = [1];
    const _fwHitColor = {}, _fwHitEmissive = {};
    const FRET_WIRE_HIT_INTENSITY = 4.2, FRET_WIRE_HIT_OP = 1;
    ${blockAt('for (let _i = 0; _i < 2; _i++) {', flashStart)}
    ${blockAt('for (let _s = 0; _s < mRimFlash.length; _s++) {', flashStart)}
    return { wires: fretWireMats, rims: mRimFlash };
`);

test('RS+ wire and note-rim emission obey Glow and Hit feedback intensity independently', () => {
    for (const [glow, hit] of [[0, 1], [1, 0], [0, 0]]) {
        const result = flash(mesh, true, glow, hit);
        for (const mat of [...result.wires, ...result.rims]) assert.equal(mat.emissiveIntensity, 0);
    }
    const low = flash(mesh, true, .25, .5), high = flash(mesh, true, 1, 1);
    assert.ok(low.wires[0].emissiveIntensity > 0);
    assert.ok(low.wires[0].emissiveIntensity < high.wires[0].emissiveIntensity);
    assert.ok(high.wires[0].emissiveIntensity <= 1.5);
    assert.equal(flash(mesh, false, 0, 0).wires[0].emissiveIntensity, 4.2);
    assert.equal(flash(mesh, false, 0, 0).rims[0].emissiveIntensity, 4.2);
});
