const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
const names = ['imPMTech', 'imFHTech', 'imPMXFill', 'imPMXLines', 'imFHXFill', 'imFHXLines'];
const start = source.indexOf('// \u2500\u2500 Finalise InstancedMesh batches');
const end = source.indexOf('pbEnd(5);', start);
assert.ok(start >= 0 && end > start, 'batch finalization block exists');
const finalize = new Function(...names, '_imPMTechCount', '_imFHTechCount', source.slice(start, end));
const three = import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let end = source.indexOf('{', start) + 1, depth = 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        else if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0);
    return source.slice(start, end);
}

async function fixture() {
    const T = await three, parent = new T.Group(), disposed = [];
    const batches = names.map((name, i) => {
        const geometry = new T.PlaneGeometry(2, 3);
        geometry.setAttribute('instanceAlpha', new T.InstancedBufferAttribute(new Float32Array(8).fill(.625), 1));
        const material = new T.MeshBasicMaterial({ transparent: true, opacity: .75 });
        const mesh = new T.InstancedMesh(geometry, material, 8);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.renderOrder = 700 + i;
        mesh.position.set(i, 2, -3);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        parent.add(mesh);
        for (const object of [mesh, geometry, material]) object.addEventListener('dispose', () => disposed.push(name));
        return mesh;
    });
    parent.updateMatrixWorld(true);
    return { parent, batches, disposed };
}

test('empty technique batches reactivate on positive counts and retain buffer update semantics', async () => {
    const { batches } = await fixture();
    for (const [pm, fh] of [[0, 0], [3, 5], [0, 0], [2, 1]]) {
        const versions = batches.map(mesh => [mesh.instanceMatrix.version, mesh.geometry.getAttribute('instanceAlpha').version]);
        finalize(...batches, pm, fh);
        for (let i = 0; i < batches.length; i++) {
            const expected = i === 0 ? pm : i === 1 ? fh : 0;
            assert.equal(batches[i].count, expected);
            assert.equal(batches[i].visible, expected > 0);
            const increment = i < 2 && expected > 0 ? 1 : 0;
            assert.equal(batches[i].instanceMatrix.version, versions[i][0] + increment);
            assert.equal(batches[i].geometry.getAttribute('instanceAlpha').version, versions[i][1] + increment);
        }
    }
});

test('finalization preserves batch assets, matrix settings, contents, parentage and lifecycle', async () => {
    const { parent, batches, disposed } = await fixture();
    const snapshots = batches.map(mesh => ({
        geometry: mesh.geometry, material: mesh.material, matrix: mesh.instanceMatrix,
        matrixBytes: Array.from(mesh.instanceMatrix.array), alpha: mesh.geometry.getAttribute('instanceAlpha'),
        alphaBytes: Array.from(mesh.geometry.getAttribute('instanceAlpha').array),
        positions: Array.from(mesh.geometry.attributes.position.array), world: mesh.matrixWorld.elements.slice(),
        settings: [mesh.matrixAutoUpdate, mesh.matrixWorldAutoUpdate, mesh.frustumCulled, mesh.renderOrder, mesh.instanceMatrix.usage],
    }));
    // Retired strum batches keep their forced-zero contract even after stale
    // positive state; they must not keep submitting a zero-instance draw.
    finalize(...batches, 4, 2);
    finalize(...batches, 0, 0);
    assert.deepEqual(parent.children, batches);
    for (let i = 0; i < batches.length; i++) {
        const mesh = batches[i], before = snapshots[i];
        assert.strictEqual(mesh.parent, parent);
        assert.strictEqual(mesh.geometry, before.geometry);
        assert.strictEqual(mesh.material, before.material);
        assert.strictEqual(mesh.instanceMatrix, before.matrix);
        assert.strictEqual(mesh.geometry.getAttribute('instanceAlpha'), before.alpha);
        assert.deepEqual(Array.from(mesh.instanceMatrix.array), before.matrixBytes);
        assert.deepEqual(Array.from(before.alpha.array), before.alphaBytes);
        assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), before.positions);
        assert.deepEqual(mesh.matrixWorld.elements, before.world);
        assert.deepEqual([mesh.matrixAutoUpdate, mesh.matrixWorldAutoUpdate, mesh.frustumCulled, mesh.renderOrder, mesh.instanceMatrix.usage], before.settings);
    }
    assert.deepEqual(disposed, []);
});

test('uninitialized or disposed batch slots remain safe', async () => {
    finalize(null, null, null, null, null, null, 0, 0);
    const { batches } = await fixture();
    for (let i = 0; i < batches.length; i++) {
        const slots = Array(6).fill(null);
        slots[i] = batches[i];
        finalize(...slots, 2, 3);
        assert.equal(batches[i].visible, i < 2);
    }
});

test('camera collection visits the same active pools and labels across batch visibility transitions', async () => {
    const { batches } = await fixture();
    const poolNames = ['pNote', 'pSus', 'pSusRibbon', 'pChordBox', 'pRsChordFrame', 'pArpBracket', 'pSusRail', 'pTechPlane'];
    const active = poolNames.map(name => ({ name, visible: true }));
    const label = { name: 'live floor label', visible: true }, seen = [];
    const scope = {
        ...Object.fromEntries(names.map((name, i) => [name, batches[i]])),
        ...Object.fromEntries(poolNames.map((name, i) => [name, { forEachActive(visitor) { visitor(active[i]); } }])),
        stableSupportReset() { seen.length = 0; }, stableCollectObject(object) { seen.push(object); },
        _incomingFloorLabelCount: 2, _incomingFloorLabels: [{ time: 0, sprite: {} }, { time: 1, sprite: label }],
        _frameNow: 1, _stableBins: [], _stableCam: {}, _stablePointSamples: 0,
        _stableViewPoints: [], _stablePoints: new Float64Array(0),
    };
    const collect = new Function(...Object.keys(scope), `return (${extractFunction('stableCollectGeometry')});`)(...Object.values(scope));
    for (const counts of [[0, 0], [2, 3], [0, 0]]) {
        finalize(...batches, ...counts);
        collect(null);
        assert.deepEqual(seen, [...active, label]);
        assert.deepEqual(scope._stableCam, { pointCount: 0, viewPointCount: 0 });
    }
});
