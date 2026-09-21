'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const screen = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = screen.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = screen.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < screen.length; i++) {
        if (screen[i] === '{') depth++;
        else if (screen[i] === '}' && --depth === 0) return screen.slice(start, i + 1);
    }
    throw Error('Unbalanced function ' + name);
}
async function three() {
    return import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);
}
function rsGeometry(T) {
    return new Function('T', `
        const NW=10, NH=8, ND=2, activePalette=[0x0077ff];
        let vibrancy=1, glowMul=0, rsNotationPaletteSig='';
        let gRsNote, gRsNoteGhost, gRsNoteGrad, gRsNoteGhostGrad, gRsNoteHalo, rsHaloTexture;
        let mRsBody,mRsRim,mRsAccentRim,mRsHitRim,mRsHalo,mRsSus,mRsSusHit,mRsSusEdge,mRsMissRim,mRsOpenStem;
        ${extract('hwyGhostNoteOutlineGeometry')}
        ${extract('hwyGhostNoteWithBodyGeometry')}
        ${extract('_initRsNotation')}
        ${extract('_applyRsNotationPalette')}
        const gNoteGhost=hwyGhostNoteOutlineGeometry(T,NW,NH,ND);
        _initRsNotation();
        return {body:gRsNote,ghost:gRsNoteGhost,bodyGrad:gRsNoteGrad[0],ghostGrad:gRsNoteGhostGrad[0],current:gNoteGhost,
            recolor(hex) {activePalette[0]=hex;_applyRsNotationPalette();},
            dispose() {
                for(const g of [gRsNote,gRsNoteGhost,...gRsNoteGrad,...gRsNoteGhostGrad,gRsNoteHalo,gNoteGhost])g.dispose();
                for(const a of [mRsBody,mRsRim,mRsAccentRim,mRsHitRim,mRsHalo,mRsSus,mRsSusHit,mRsSusEdge])for(const m of a)m.dispose();
                mRsMissRim.dispose();mRsOpenStem.dispose();rsHaloTexture.dispose();
            }};
    `)(T);
}

test('RS+ ghost brackets retain the exact rounded body and its palette colors', async () => {
    const T = await three();
    const h = rsGeometry(T);
    for (const name of ['position', 'normal', 'uv']) {
        const body = h.body.attributes[name].array;
        assert.deepEqual(h.ghost.attributes[name].array.slice(0, body.length), body);
    }
    assert.ok(h.ghost.attributes.position.count > h.body.attributes.position.count);
    assert.ok(Math.abs(h.ghost.boundingBox.max.x - 7.4) < 1e-5);
    for (const color of [0x0077ff, 0xff6600]) {
        h.recolor(color);
        const base = h.bodyGrad.attributes.color.array;
        assert.deepEqual(h.ghostGrad.attributes.color.array.slice(0, base.length), base);
        const gp = h.ghostGrad.attributes.position, gc = h.ghostGrad.attributes.color;
        for (let i = h.body.attributes.position.count; i < gp.count; i++) {
            assert.ok(Math.abs(gp.getX(i)) > 5.1);
            assert.ok(gc.getX(i) > 0.8 && gc.getY(i) > 0.8 && gc.getZ(i) > 0.8);
        }
    }
    h.dispose();
});

test('pooled open ghost geometry switches styles without stale topology or cache growth', async () => {
    const T = await three();
    const h = rsGeometry(T);
    const shape = new Function(extract('hwyShapeOpenGhostGeometry') + ';return hwyShapeOpenGhostGeometry;')();
    const mesh = new T.Mesh(h.current);
    mesh.scale.set(8, 0.15, 0.6);
    const owned = [];
    for (const template of [h.current, h.ghostGrad, h.current, h.ghostGrad]) {
        shape(mesh, template, 80, 1, 10, owned);
        assert.equal(mesh.geometry.attributes.position.count, template.attributes.position.count);
        assert.equal(owned.length, 1);
        assert.ok(Math.abs(mesh.geometry.boundingBox.max.x * mesh.scale.x - 42.4) < 1e-5, String(mesh.geometry.boundingBox.max.x * mesh.scale.x));
        assert.ok(Math.abs(mesh.geometry.boundingBox.max.y * mesh.scale.y - 4.64) < 1e-5);
    }
    owned[0].dispose(); mesh.material.dispose(); h.dispose();
});

test('slide-out fade variants support both RS+ Basic and Current Standard materials', async () => {
    const T = await three();
    const fade = new Function(`const _slideRibbonFadeMaterials=new Map();
        ${extract('slideRibbonFadeMaterial')} return slideRibbonFadeMaterial;`)();
    for (const source of [new T.MeshBasicMaterial({color:0x3388ff,opacity:0.62,transparent:true}),
        new T.MeshStandardMaterial({color:0x3388ff,emissive:0x123456,emissiveIntensity:0.4,opacity:0.7,transparent:true})]) {
        const variant = fade(source);
        assert.notEqual(variant, source);
        assert.equal(variant.type, source.type);
        assert.equal(variant.vertexColors, true);
        assert.equal(source.vertexColors, false);
        source.color.setHex(0xffaa33); source.opacity = 0.35;
        assert.equal(fade(source), variant);
        assert.equal(variant.color.getHex(), 0xffaa33);
        assert.equal(variant.opacity, 0.35);
        if (source.emissive) assert.equal(variant.emissive.getHex(), source.emissive.getHex());
        variant.dispose(); source.dispose();
    }
});
