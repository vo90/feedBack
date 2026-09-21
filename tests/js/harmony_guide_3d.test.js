// Exercise the native harmonic-guide geometry with the same vendored Three.js
// as the app. No mocked GL context or snapshot of implementation output: these
// tests inspect world-space placement, musical-role counts and GPU disposal.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
let T;
before(async () => { T = await import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js'))); });

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`unbalanced function ${name}`);
}

const select = new Function(`${extract('selectHarmonicGuidePosition')}; return selectHarmonicGuidePosition;`)();
const edges = new Function(`const NFRETS = 24, S_GAP = 4;
    ${extract('buildHarmonicPositionEdges')}; return buildHarmonicPositionEdges;`)();
const shapes = [
    { id: 'one', label: 'Position 1', centerFret: 5, spans: [{ string: 0, minFret: 4, maxFret: 6 }] },
    { id: 'two', label: 'Position 2', centerFret: 8, spans: [{ string: 0, minFret: 7, maxFret: 9 }] },
];

function makeGuideHarness(options = {}) {
    const functions = ['selectHarmonicGuidePosition', 'buildHarmonicPositionEdges', 'initHarmonicGuide',
        'harmonicGuideInstance', 'updateHarmonicGuide', 'drawHarmonicGuideLabels', 'disposeHarmonicGuide'].map(extract).join('\n');
    return new Function('T', 'options', `
        const K = 0.0075, S_GAP = 4 * K, NFRETS = 24;
        const NW = 5*K, NH = 3*K, ND = 0.25*K;
        const MAX_RENDER_STRINGS = 8, nStr = options.stringCount || 6;
        const _HARMONY_MARKER_CAP = MAX_RENDER_STRINGS * (NFRETS + 1), _HARMONY_EDGE_CAP = MAX_RENDER_STRINGS * 16;
        const activePalette = [0xef5261,0xf1d663,0x62bfe4,0xe3995a,0x81c67b,0xb39aec,0xff99ab,0xafffff];
        const gNote = new T.BoxGeometry(NW, NH, ND);
        const gNoteGrad = activePalette.slice(0, 6).map(color => {
            const geometry = gNote.clone(), values = [];
            const tint = new T.Color(color), position = geometry.getAttribute('position');
            for (let i = 0; i < position.count; i++) {
                const value = tint.clone().multiplyScalar(position.getY(i) > 0 ? 1 : 0.5);
                values.push(value.r, value.g, value.b);
            }
            geometry.setAttribute('color', new T.Float32BufferAttribute(values, 3));
            return geometry;
        });
        const mStr = activePalette.map((color, s) => new T.MeshBasicMaterial({
            color: s < 6 ? 0xffffff : color, vertexColors: s < 6, transparent: true, opacity: 1,
        }));
        const renderOrderForLayerAtZ = (z, layer) => layer === 'NOTE_CORE' ? 700.5 : 700.4;
        const scene = new T.Scene(), cam = new T.PerspectiveCamera(45, 1.8, 0.01, 100), _probe = new T.Vector3();
        cam.position.set(0.35, 0.3, 1.5); cam.lookAt(0.35, 0.07, 0); cam.updateMatrixWorld();
        const xFretMid = f => (options.lefty ? -1 : 1) * (f === 0 ? -2*K : (f - 0.5) * 10*K);
        const sY = s => (3 + (options.inverted ? s : nStr-1-s)*4) * K;
        const fretColumnWorldW = () => 10*K;
        let _harmonyGroup = null, _harmonyBatches = null, _harmonyTransform = null, _harmonyColor = null;
        let _harmonyActivePosition = null, _harmonyAlpha = 0, _harmonyLabelCount = 0;
        const _harmonyLabels = [], _harmonyEdges = [], _harmonyPositionLabels = [];
        const _harmonyLabelRects = new Float32Array(12);
        ${functions}
        return {
            update: updateHarmonicGuide, labels: drawHarmonicGuideLabels, dispose: disposeHarmonicGuide, scene, cam,
            nativeGeometry: { gNote, gNoteGrad }, nativeMaterials: mStr,
            snapshot: () => ({ group: _harmonyGroup, batches: _harmonyBatches, alpha: _harmonyAlpha,
                labels: _harmonyLabels.slice(0, _harmonyLabelCount), active: _harmonyActivePosition }),
        };
    `)(T, options);
}

function positionOf(mesh, index) {
    const matrix = new T.Matrix4(); mesh.getMatrixAt(index, matrix);
    return new T.Vector3().setFromMatrixPosition(matrix);
}

test('camera position selection holds through overlap and changes after crossing the deadband', () => {
    assert.equal(select(shapes, null, 5).id, 'one');
    assert.equal(select(shapes, 'one', 6.7).id, 'one');
    assert.equal(select(shapes, 'one', 7.1).id, 'two');
    assert.equal(select(shapes, 'removed', 8).id, 'two');
    assert.equal(select([], 'one', 5), null);
    assert.equal(select(shapes, 'one', NaN), null);
});

test('position outline follows each string span and mirrors without changing the shape', () => {
    const p = { spans: [{ string: 0, minFret: 5, maxFret: 7 }, { string: 1, minFret: 6, maxFret: 8 }] };
    const normal = edges(p, 2, f => f * 10, s => s * 4, () => 10, []);
    const mirrored = edges(p, 2, f => -f * 10, s => -s * 4, () => 10, []);
    assert.equal(normal.length / 4, 8, 'two vertical sides per row, two step connectors and top/bottom closure');
    assert.deepEqual(mirrored, normal.map(v => -v));
    assert.ok(normal.includes(45.7) && normal.includes(84.3), 'outline follows the outer played fret on each row');
    assert.ok(normal.includes(55.7), 'the second string begins at its own span, not the first string span');
});

test('position outline closes separated valid rows and rejects out-of-neck data', () => {
    const p = { spans: [{ string: 0, minFret: 5, maxFret: 7 },
        { string: 1, minFret: -2, maxFret: 9 }, { string: 2, minFret: 6, maxFret: 8 }] };
    const output = [Infinity];
    assert.equal(edges(p, 3, f => f, s => s * 4, () => 1, output), output, 'reuses the caller buffer');
    assert.equal(output.length / 4, 8, 'two closed outlines around the separated valid rows');
    assert.ok(output.every(Number.isFinite));
});

test('absent or disabled guide leaves a normal 3D scene untouched', () => {
    const h = makeGuideHarness();
    h.update(undefined);
    h.update({ enabled: false, alpha: 1, markers: [{ string: 0, fret: 5 }] });
    h.update({ enabled: true, alpha: NaN, markers: [{ string: 0, fret: 5 }] });
    assert.equal(h.scene.children.length, 0);
    assert.equal(h.snapshot().group, null);
});

test('scale tonic and current song target are distinct roles at stationary fret coordinates', () => {
    const h = makeGuideHarness();
    const markers = [
        { string: 0, fret: 5, note: 'A', isTonic: true, isTarget: false },
        { string: 1, fret: 6, note: 'F', isTonic: false, isTarget: true },
        { string: 2, fret: 7, note: 'A', isTonic: true, isTarget: true },
        { string: 3, fret: 8, note: 'B', isTonic: false, isTarget: false },
    ];
    h.update({ enabled: true, alpha: 0.6, markers });
    const { batches: b } = h.snapshot();
    assert.equal(h.scene.children[0].children.length, 13, 'full guide has eight native gem batches plus five outlines');
    assert.equal(b.strings.count, 4); assert.equal(b.tonic.count, 2); assert.equal(b.target.count, 2);
    assert.equal(b.gem0.count, 0, 'scale tonic stays hollow while another note is the song target');
    assert.equal(b.gem1.count, 1, 'current chord root is filled');
    assert.equal(b.gem2.count, 1, 'coincident tonic and target is filled with both outlines');
    assert.equal(b.gem3.count, 0, 'ordinary scale notes are hollow');
    const at = positionOf(b.strings, 0);
    assert.ok(Math.abs(at.x - 0.3375) < 1e-6);
    assert.ok(Math.abs(at.y - 0.1725) < 1e-6);
    assert.equal(at.z, 0, 'scale map remains on the playing line');
    assert.equal(b.gem1.material.opacity, 0.6 * 0.9);
    assert.equal(b.target.material.depthWrite, false);
    assert.equal(b.target.material.fog, false);
    h.update({ enabled: true, alpha: 1, markers: [{ string: 0, fret: 5, note: 'A', isTonic: true }] });
    assert.equal(b.strings.count, 1); assert.equal(b.gem1.count, 0);
    assert.equal(b.target.count, 0, 'old chord targets do not linger');
    assert.equal(b.tonic.count, 1);
    assert.equal(b.gem2.count, 0, 'old filled targets clear when the song target changes');
    h.dispose();
});

test('guide gems borrow the native string gradients while owning their fade materials', () => {
    const h = makeGuideHarness({ stringCount: 8 });
    h.update({ enabled: true, alpha: 0.5, markers: [
        { string: 0, fret: 5 }, { string: 6, fret: 5 }, { string: 7, fret: 7 },
    ] });
    const { batches } = h.snapshot();
    assert.equal(batches.gem0.geometry, h.nativeGeometry.gNoteGrad[0]);
    assert.equal(batches.gem0.geometry.getAttribute('color').count, 24);
    assert.equal(batches.gem0.material.vertexColors, true);
    assert.equal(batches.gem6.geometry, h.nativeGeometry.gNote);
    assert.equal(batches.gem6.material.vertexColors, false);
    assert.notEqual(batches.gem0.material, h.nativeMaterials[0]);
    assert.equal(h.nativeMaterials[0].opacity, 1, 'guide fading never changes a playable note');
    h.nativeMaterials[7].color.set(0x112233);
    h.update({ enabled: true, alpha: 1, markers: [{ string: 7, fret: 7 }] });
    assert.equal(batches.gem7.material.color.getHex(), 0x112233, 'flat extended strings follow live palette changes');
    assert.equal(batches.tonic.geometry.type, 'ShapeGeometry');
    for (const mesh of [batches.strings, batches.tonic, batches.target]) mesh.geometry.computeBoundingBox();
    const width = mesh => mesh.geometry.boundingBox.max.x - mesh.geometry.boundingBox.min.x;
    assert.ok(width(batches.target) > width(batches.tonic));
    assert.ok(width(batches.tonic) > width(batches.strings));
    h.dispose();
});

test('left-handed and inverted layouts preserve marker string/fret identity', () => {
    const h = makeGuideHarness({ lefty: true, inverted: true });
    h.update({ enabled: true, alpha: 1, markers: [{ string: 0, fret: 5, note: 'A' }] });
    const at = positionOf(h.snapshot().batches.strings, 0);
    assert.ok(Math.abs(at.x + 0.3375) < 1e-6);
    assert.ok(Math.abs(at.y - 0.0225) < 1e-6);
    assert.equal(at.z, 0);
    h.dispose();
});

test('open-string guide markers use the native open-note column, including mirrored layouts', () => {
    for (const lefty of [false, true]) {
        const h = makeGuideHarness({ lefty });
        h.update({ enabled: true, alpha: 1, markers: [{ string: 0, fret: 0, note: 'E', isTonic: true }] });
        const { batches } = h.snapshot();
        const at = positionOf(batches.strings, 0);
        assert.ok(Math.abs(at.x - (lefty ? 0.015 : -0.015)) < 1e-6);
        assert.equal(at.z, 0);
        assert.equal(batches.tonic.count, 1);
        assert.equal(batches.gem0.frustumCulled, false, 'no stale batch bounds clip open-string or high-fret instances');
        const matrix = new T.Matrix4(); batches.strings.getMatrixAt(0, matrix);
        const size = new T.Vector3().setFromMatrixScale(matrix);
        assert.ok(size.x <= 0.701 && size.y <= 0.701, 'open note is a compact gem, never a chart-wide slab');
        h.dispose();
    }
});

test('native eight-string tuning labels agree with standard F# and Drop E pitch mapping', () => {
    const constants = source.slice(source.indexOf('const _NOTE_NAMES_SHARP'), source.indexOf('function _baseOpenStringMidis'));
    const pitchLabels = new Function(`const MAX_RENDER_STRINGS = 8; ${constants}
        ${extract('_baseOpenStringMidis')}
        ${extract('_midiToPitchLabel')}
        ${extract('_openStringPitchLabelsForTuning')}
        return _openStringPitchLabelsForTuning;`)();
    const info = { arrangement: 'Lead' };
    assert.deepEqual(pitchLabels({ tuning: Array(8).fill(0) }, info, 8),
        ['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    assert.equal(pitchLabels({ tuning: [-2, 0, 0, 0, 0, 0, 0, 0] }, info, 8)[0], 'E1');
    assert.equal(pitchLabels({ tuning: Array(8).fill(0), capo: 2 }, info, 8)[0], 'G#1');
});

test('note-name preference hides letters while keeping harmonic markers', () => {
    const h = makeGuideHarness();
    const guide = { enabled: true, alpha: 1, options: { labelMode: 'notes' },
        markers: [{ string: 0, fret: 5, note: 'A', degreeLabel: 'R', isTonic: true }] };
    h.update(guide);
    assert.equal(h.snapshot().labels[0].text, 'A');
    h.update({ ...guide, options: { labelMode: 'notes', showNoteNames: false } });
    assert.equal(h.snapshot().labels[0].text, '');
    assert.equal(h.snapshot().batches.tonic.count, 1);
    h.dispose();
});

test('default degree labels keep R on the scale tonic while the current song root changes', () => {
    const h = makeGuideHarness();
    const markers = [
        { string: 0, fret: 5, note: 'A', degreeLabel: 'R', isTonic: true },
        { string: 1, fret: 8, note: 'F', degreeLabel: '\u266d6', isTarget: true },
        { string: 2, fret: 6, note: 'G#', degreeLabel: '\u266f4' },
        { string: 3, fret: 5, note: 'G', degreeLabel: 'arbitrary text' },
    ];
    h.update({ enabled: true, alpha: 1, markers });
    assert.deepEqual(h.snapshot().labels.map(m => m.text), ['R', '\u266d6', '\u266f4', '']);
    h.update({ enabled: true, alpha: 1, markers, options: { labelMode: 'notes' } });
    assert.deepEqual(h.snapshot().labels.map(m => m.text), ['A', 'F', 'G#', 'G']);
    h.update({ enabled: true, alpha: 1, markers, options: { labelMode: 'none' } });
    assert.ok(h.snapshot().labels.every(m => m.text === ''));
    assert.equal(h.snapshot().batches.strings.count, 4);
    assert.equal(h.snapshot().batches.tonic.count, 1);
    assert.equal(h.snapshot().batches.target.count, 1);
    h.dispose();
});

test('projected position labels prioritize the current shape without overlapping neighbours', () => {
    const h = makeGuideHarness();
    h.update({ enabled: true, alpha: 1, markers: [{ string: 0, fret: 5 }], positions: [
        { ...shapes[0], centerFret: 5 }, { ...shapes[1], centerFret: 5.05 },
    ] });
    const drawn = [];
    const ctx = { save() {}, restore() {}, strokeText() {},
        measureText: text => ({ width: text.length * 8 }),
        fillText: text => drawn.push(text) };
    h.labels(ctx, 1200, 700);
    assert.equal(drawn.length, 1, 'neighbouring labels do not stack on the active label');
    assert.equal(drawn[0], shapes[0].label);
    h.dispose();
});

test('malformed marker data cannot place out-of-range notes or overflow GPU batches', () => {
    const h = makeGuideHarness({ stringCount: 4 });
    const markers = [{ string: 5, fret: 5 }, { string: -1, fret: 2 }, { string: 0, fret: 25 },
        { string: 0, fret: NaN }, { string: 0, fret: 5.5 }, null,
        ...Array.from({ length: 300 }, () => ({ string: 0, fret: 5, note: 'A' }))];
    h.update({ enabled: true, alpha: 1, markers });
    assert.equal(h.snapshot().batches.gem0.count, 0, 'unselected scale notes have no fill');
    assert.equal(h.snapshot().batches.strings.count, 25, 'rejected overflow gems cannot leave stray outlines');
    h.update({ enabled: true, alpha: 1, markers: markers.map(m => m && ({ ...m, isTarget: true })) });
    assert.equal(h.snapshot().batches.gem0.count, 25, 'filled targets share the same per-string capacity');
    h.dispose();
    const fullNeck = makeGuideHarness({ stringCount: 8 });
    fullNeck.update({ enabled: true, alpha: 1, markers: Array.from({ length: 200 }, (_, i) =>
        ({ string: Math.floor(i / 25), fret: i % 25 })) });
    assert.equal(fullNeck.snapshot().batches.strings.count, 200, 'all valid frets fit the full neck budget');
    fullNeck.dispose();
});

test('guide hiding and teardown release every GPU resource including instance buffers', () => {
    const h = makeGuideHarness();
    const guide = { enabled: true, alpha: 1, markers: [{ string: 0, fret: 5 }], positions: shapes };
    h.update(guide);
    const { group, batches } = h.snapshot();
    let disposedInstances = 0, disposedMaterials = 0, disposedGeometries = 0, disposedNativeGeometries = 0;
    const geometries = new Set();
    for (const mesh of Object.values(batches)) {
        mesh.addEventListener('dispose', () => disposedInstances++);
        mesh.material.addEventListener('dispose', () => disposedMaterials++);
        if (!mesh.userData.harmonicGuideBorrowedGeometry) geometries.add(mesh.geometry);
    }
    for (const geo of [h.nativeGeometry.gNote, ...h.nativeGeometry.gNoteGrad]) {
        geo.addEventListener('dispose', () => disposedNativeGeometries++);
    }
    for (const geo of geometries) geo.addEventListener('dispose', () => disposedGeometries++);
    h.update({ ...guide, enabled: false });
    assert.equal(group.visible, false);
    h.update(guide);
    assert.equal(h.snapshot().group, group, 'toggle reuses already allocated resources');
    h.dispose(); h.dispose();
    assert.equal(disposedInstances, 13);
    assert.equal(disposedMaterials, 13);
    assert.equal(disposedGeometries, geometries.size);
    assert.equal(disposedNativeGeometries, 0, 'normal note geometry remains owned by the renderer');
    assert.equal(h.scene.children.length, 0);
    assert.equal(h.snapshot().group, null);
});

test('native guide is opt-in, uses the final camera and cleans up with renderer swaps', () => {
    assert.match(source, /supportsHarmonicGuide:\s*true/);
    assert.match(source, /camUpdate\(bundle\);\s*updateHarmonicGuide\(bundle\.harmonicGuide\)/);
    assert.match(extract('updateHarmonicGuide'), /cam\.updateMatrixWorld\(\)/);
    assert.match(extract('teardown'), /disposeHarmonicGuide\(\)/);
    assert.match(extract('teardown'), /for \(const g of _ownedSharedGeos\) g\?\.dispose\?\.\(\);\s*_ownedSharedGeos.length = 0;\s*gNoteGrad = \[\]/,
        'renderer owner releases borrowed gradients even if no chart mesh ever used their string');
    assert.doesNotMatch(extract('updateHarmonicGuide'), /drawNote\(|getNoteState|noteState|\.push\(.*\bnotes\b|dZ\(/,
        'guide rendering neither creates travelling chart notes nor reads live-input scoring');
});

test('top dock reserves lyric space at native canvas resolution while floating and hidden guides do not', () => {
    const render = new Function(`let _lyrRowsCache = null;
        ${extract('harmonicGuideTopInset')}
        ${extract('drawLyrics')}
        return { inset: harmonicGuideTopInset, lyrics: drawLyrics };`)();
    assert.equal(render.inset({ topInset: 100, viewportHeight: 800 }, 1600), 200);
    for (const layout of [null, {}, { topInset: NaN, viewportHeight: 800 },
        { topInset: 100, viewportHeight: 0 }, { topInset: 0, viewportHeight: 800 }]) {
        assert.equal(render.inset(layout, 800), 0);
    }
    const calls = [];
    const ctx = { measureText: text => ({ width: text.length * 8 }), beginPath() {},
        moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
        fillText: (text, x, y) => calls.push({ text, x, y }) };
    const lyrics = [{ t: 0, d: 20, w: 'Room to improvise+' }];
    render.lyrics(lyrics, 1, ctx, 1440, 800, 0);
    const originalY = calls.pop().y;
    const bottom = render.lyrics(lyrics, 1, ctx, 1440, 800, 180);
    assert.ok(calls.pop().y > 180);
    assert.ok(bottom > 180 && bottom < 800);
    render.lyrics(lyrics, 1, ctx, 1440, 800, 0);
    assert.equal(calls.pop().y, originalY, 'moving the panel away from its top dock restores natural lyric placement');
    const drawnBefore = calls.length;
    assert.equal(render.lyrics(lyrics, 1, ctx, 600, 160, 150), 0,
        'a banner that cannot fit below the dock is omitted');
    assert.equal(calls.length, drawnBefore, 'lyrics never move behind the guide to fit a short canvas');
});
