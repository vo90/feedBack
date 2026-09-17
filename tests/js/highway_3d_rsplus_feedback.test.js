const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

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

test('bulk settings reload retints after the complete palette/vibrancy/glow snapshot and caches unchanged colors', () => {
    class Color {
        constructor(hex = 0) { this.setHex(hex); }
        setHex(hex) { this.r = (hex >> 16 & 255) / 255; this.g = (hex >> 8 & 255) / 255; this.b = (hex & 255) / 255; return this; }
        copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
        lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
    }
    const values = { notationStyle: 'current', palette: 'default', style: 'particles',
        vibrancy: 0.9, glow: 0.15, bgTheme: 'default', hwTheme: 'default' };
    const defaults = [0xeedd33];
    const ctx = { T: { Color }, NH: 1, highwayCanvas: {}, _bgReactiveOptOut: false, rsPlusNotation: false,
        _bgPanelKey: () => 'panel0', _bgReadSetting: (_, key) => values[key], _bgHasStored: () => true,
        PALETTES: { default: defaults }, _customPalette: [0], _bgPaletteSig: defaults.join(','), activePalette: defaults,
        _h3dHexToInt: value => /^#[0-9a-f]{6}$/i.test(value) ? parseInt(value.slice(1), 16) : null,
        _bgMemFallback: {}, BG_DEFAULTS: {}, localStorage: { getItem: () => null },
        _applyCinematic() {}, _applyVibrancy() {}, _applyGlow() {}, trailYieldSettings: {}, vibrancy: 0.1, glowMul: 0.8,
        rsNotationPaletteSig: '', colorWrites: 0, paletteWrites: 0 };
    const colorAttribute = { value: null, setXYZ(_, ...value) { this.value = value; ctx.colorWrites++; } };
    ctx.gRsNoteGrad = [{ attributes: { position: { count: 1, getY: () => 0 },
        normal: { getZ: () => 1 }, color: colorAttribute } }];
    for (const key of ['mRsRim', 'mRsAccentRim', 'mRsHitRim', 'mRsSus', 'mRsSusHit', 'mRsSusEdge', 'mRsHalo']) {
        ctx[key] = [{ color: new Color() }];
    }
    vm.createContext(ctx);
    vm.runInContext(`${fn('_applyRsNotationPalette')}
        function _applyPaletteToMaterials() { paletteWrites++; _applyRsNotationPalette(); }
        ${fn('_bgLoadSettings')}`, ctx);
    ctx._bgLoadSettings();
    assert.equal(ctx.rsPlusNotation, false);
    assert.equal(ctx.vibrancy, 0.9);
    assert.equal(ctx.glowMul, 0.15);
    assert.equal(ctx.colorWrites, 1, 'unchanged global palette still gets the final bulk visual settings');
    const initial = [...colorAttribute.value];
    ctx._bgLoadSettings();
    assert.equal(ctx.colorWrites, 1, 'an unchanged reload does not rewrite vertex colors');

    // A reset or panel-override clear can change both knobs at once.
    values.vibrancy = 0; values.glow = 0;
    ctx._bgLoadSettings();
    assert.notDeepEqual(colorAttribute.value, initial);
    assert.equal(ctx.colorWrites, 2);
    values.palette = 'custom'; values.customColors = '["#1166ff"]';
    values.vibrancy = 1; values.glow = 0.3;
    ctx._bgLoadSettings();
    assert.equal(ctx.activePalette[0], 0x1166ff);
    assert.equal(ctx.paletteWrites, 1);
    assert.ok(colorAttribute.value[2] > colorAttribute.value[0], 'custom blue replaces the previous yellow');
    const prepared = [...colorAttribute.value], writes = ctx.colorWrites;
    values.notationStyle = 'rsplus';
    ctx._bgLoadSettings();
    assert.equal(ctx.rsPlusNotation, true);
    assert.deepEqual(colorAttribute.value, prepared, 'colors prepared while Current was selected stay current on opt-in');
    assert.equal(ctx.colorWrites, writes);
});

test('provider verdict wins over legacy marks, while event-only detection still overrides accent', () => {
    const start = src.indexOf('                const rsMiss = ');
    const end = src.indexOf('                // outline + core share', start);
    assert.ok(start >= 0 && end > start);
    const choose = new Function('_ndCs', '_ndState', '_ndGood', '_ndMatchedMark', '_ndHadHitMark', 'accent', `
        const rsPlusNotation=true, s=0, n={ac:accent}, outline={};
        const mRsMissRim='miss', mRsHitRim=['hit'], mRsAccentRim=['accent'], mRsRim=['normal'];
        ${src.slice(start, end)}
        return outline.material;
    `);
    assert.equal(choose({ state: 'miss' }, 'miss', false, {}, true, true), 'miss');
    assert.equal(choose({ state: 'hit' }, 'hit', true, {}, false, true), 'hit');
    assert.equal(choose(null, null, false, {}, true, true), 'hit');
    assert.equal(choose(null, null, false, {}, false, true), 'miss');
    assert.equal(choose({ state: 'pending' }, 'pending', false, {}, true, true), 'hit');
    assert.equal(choose(null, null, false, null, false, true), 'accent');
    assert.equal(choose(null, null, false, null, false, false), 'normal');
});

test('bulk style round-trip restores shared Current sustain colors and hit intensities without unrelated reload writes', () => {
    class Color {
        constructor(hex = 0) { this.setHex(hex); }
        setHex(hex) { this.r = (hex >> 16 & 255) / 255; this.g = (hex >> 8 & 255) / 255; this.b = (hex & 255) / 255; return this; }
        lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
    }
    const values = { notationStyle: 'current', palette: 'default', style: 'particles',
        vibrancy: 0.2, glow: 0.3, hitFx: 0.8, bgTheme: 'default', hwTheme: 'default' };
    const palette = [0x2255aa];
    const ctx = { T: { Color }, highwayCanvas: {}, rsPlusNotation: false,
        _bgReactiveOptOut: false, _bgPanelKey: () => 'panel0', _bgReadSetting: (_, key) => values[key],
        _bgHasStored: () => true, PALETTES: { default: palette }, activePalette: palette,
        _bgPaletteSig: palette.join(','), _bgMemFallback: {}, BG_DEFAULTS: {},
        localStorage: { getItem: () => null }, _applyCinematic() {}, _applyRsNotationPalette() {},
        _applyPaletteToMaterials() { throw new Error('unchanged palette should be skipped'); },
        trailYieldSettings: {}, vibrancy: 0.2, glowMul: 0.3, _hitFx: 0.8,
        _paletteColorTmp: null, mStr: [{}], mSus: [{}], mGlow: [{ color: new Color() }],
        mAccentCore: [{ color: new Color() }], projMeshArr: [], stringLineGlows: [],
        mStrHitOutline: [], mAccentOutline: [], mWhiteOutline: null, mMissOutline: null,
        mHitBright: [{}], mSusOutline: {}, mHitSusOutline: {}, mTapChevron: null, mBarre: null,
        mAccentHaloNear: [], mAccentHaloMid: [], mAccentHaloFar: [] };
    vm.createContext(ctx);
    vm.runInContext(fn('_bgLoadSettings') + '\n' + fn('_applyVibrancy') + '\n' + fn('_applyGlow'), ctx);
    ctx._applyVibrancy(); ctx._applyGlow();
    const color = () => [ctx.mGlow[0].color.r, ctx.mGlow[0].color.g, ctx.mGlow[0].color.b];
    const currentColor = color(), currentHit = ctx.mHitBright[0].emissiveIntensity,
        currentSustainEdge = ctx.mHitSusOutline.emissiveIntensity;
    let vibrancyApplies = 0, glowApplies = 0;
    const applyVibrancy = ctx._applyVibrancy, applyGlow = ctx._applyGlow;
    ctx._applyVibrancy = () => { vibrancyApplies++; applyVibrancy(); };
    ctx._applyGlow = () => { glowApplies++; applyGlow(); };
    ctx._bgLoadSettings();
    assert.equal(vibrancyApplies, 0);
    assert.equal(glowApplies, 0, 'ordinary Current reloads retain their old apply behavior');

    values.notationStyle = 'rsplus'; values.vibrancy = 0.45; values.glow = 0.15;
    ctx._bgLoadSettings();
    assert.equal(ctx.rsPlusNotation, true);
    assert.notDeepEqual(color(), currentColor);
    assert.notEqual(ctx.mHitBright[0].emissiveIntensity, currentHit);
    assert.equal(vibrancyApplies, 1);
    assert.equal(glowApplies, 1);

    // Simulates removing a panel style override during a bulk background reset,
    // without sending the dedicated notationStyle notification.
    values.notationStyle = 'current'; values.vibrancy = 0.2; values.glow = 0.3;
    ctx._bgLoadSettings();
    assert.equal(ctx.rsPlusNotation, false);
    assert.deepEqual(color(), currentColor);
    assert.equal(ctx.mHitBright[0].emissiveIntensity, currentHit);
    assert.equal(ctx.mHitSusOutline.emissiveIntensity, currentSustainEdge);
    assert.equal(vibrancyApplies, 2);
    assert.equal(glowApplies, 2);
});

test('Glow zero blocks new RS+ sparks and immediately hides sparks already alive', () => {
    const ctx = { rsPlusNotation: true, glowMul: 0, _hitFx: 0.7, _SPARK_N: 4, K: 1,
        _sparkLife: new Float32Array(4), _sparkPos: new Float32Array(12),
        _sparkVel: new Float32Array(12), _sparkCol: new Float32Array(12),
        _sparkPts: { material: {}, geometry: { attributes: { position: {}, color: {} } }, visible: false } };
    vm.createContext(ctx);
    vm.runInContext(fn('_sparkBurst') + '\n' + fn('_sparkUpdate'), ctx);
    ctx._sparkBurst(1, 2, 3, 0xffdd33, 3);
    assert.equal(ctx._sparkLife.some(v => v > 0), false);
    ctx.glowMul = 0.5; ctx._hitFx = 0;
    ctx._sparkBurst(1, 2, 3, 0xffdd33, 3);
    assert.equal(ctx._sparkLife.some(v => v > 0), false);
    ctx._hitFx = 0.8;
    ctx._sparkBurst(1, 2, 3, 0xffdd33, 3); ctx._sparkUpdate(0);
    assert.equal(ctx._sparkLife.filter(v => v > 0).length, 3);
    assert.equal(ctx._sparkPts.visible, true);
    assert.ok(Math.abs(ctx._sparkPts.material.opacity - 0.32) < 1e-12);
    ctx.glowMul = 0; ctx._sparkUpdate(0);
    assert.equal(ctx._sparkPts.visible, false);
    assert.equal(ctx._sparkPts.material.opacity, 0);
    ctx.rsPlusNotation = false; ctx._sparkUpdate(0);
    assert.equal(ctx._sparkPts.visible, true, 'Current retains its original spark brightness');
    assert.equal(ctx._sparkPts.material.opacity, 0.8);
});
