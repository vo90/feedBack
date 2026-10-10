const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
const start = source.indexOf('function pool(parent, mk, cameraRelevant = null)');
assert.ok(start >= 0);
let end = source.indexOf('{', start) + 1, depth = 1;
while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
}
assert.equal(depth, 0);
const createPool = new Function(`return (${source.slice(start, end)});`)();
const three = import(pathToFileURL(path.join(root, 'static/vendor/three/three.module.min.js')).href);

function setPose(object, seed) {
    object.position.set(seed * 2, seed - 3, -seed * 4);
    object.rotation.set(seed * .03, seed * .02, -seed * .01);
    object.scale.set(1 + seed * .02, 1.5 + seed * .01, 1);
}

function assertMatrix(actual, expected) {
    assert.deepEqual(actual.matrixWorld.elements, expected.matrixWorld.elements);
    assert.equal(actual.children.length, expected.children.length);
    actual.children.forEach((child, i) => assertMatrix(child, expected.children[i]));
}

test('pooled meshes, sprites and lines retain world transforms after dormant parent changes', async () => {
    const T = await three;
    const factories = [
        () => new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()),
        () => new T.Sprite(new T.SpriteMaterial()),
        () => new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial()),
        () => new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial()),
        () => new T.Points(new T.BufferGeometry(), new T.PointsMaterial()),
        () => { const group = new T.Group(); group.add(new T.Mesh()); return group; },
    ];
    for (const factory of factories) {
        const parent = new T.Group(), referenceParent = new T.Group();
        const reference = factory(); referenceParent.add(reference);
        const pool = createPool(parent, factory).warm(2);
        const object = pool.get();
        setPose(object, 1); setPose(reference, 1);
        parent.updateMatrixWorld(true); referenceParent.updateMatrixWorld(true);
        assertMatrix(object, reference);

        pool.reset();
        setPose(parent, 2); setPose(referenceParent, 2);
        setPose(object, 3); setPose(reference, 3);
        parent.updateMatrixWorld(true); referenceParent.updateMatrixWorld(true);
        assert.equal(object.visible, false);
        assert.strictEqual(pool.get(), object);
        parent.updateMatrixWorld(true);
        assertMatrix(object, reference);

        // Camera bounds use this path before the renderer's full scene pass.
        pool.reset(); setPose(parent, 4); setPose(referenceParent, 4);
        pool.get();
        object.updateWorldMatrix(true, false);
        reference.updateWorldMatrix(true, false);
        assert.deepEqual(object.matrixWorld.elements, reference.matrixWorld.elements);
    }
});

test('dormant and unused high-water slots perform no local/world matrix computations', async () => {
    const T = await three;
    const parent = new T.Group(), counts = { compose: 0, multiply: 0 };
    function countedMesh(counters) {
        const object = new T.Mesh();
        const compose = object.matrix.compose;
        const multiply = object.matrixWorld.multiplyMatrices;
        object.matrix.compose = function (...args) { counters.compose++; return compose.apply(this, args); };
        object.matrixWorld.multiplyMatrices = function (...args) { counters.multiply++; return multiply.apply(this, args); };
        return object;
    }
    const pool = createPool(parent, () => countedMesh(counts)).warm(128);
    parent.updateMatrixWorld(true);
    assert.deepEqual(counts, { compose: 0, multiply: 0 });

    // Grow past the warm size, then return to a sparse passage.
    for (let i = 0; i < 160; i++) setPose(pool.get(), i);
    parent.updateMatrixWorld(true);
    assert.deepEqual(counts, { compose: 160, multiply: 160 });
    pool.reset(); pool.reset();
    counts.compose = counts.multiply = 0;
    for (let frame = 0; frame < 5; frame++) {
        for (let i = 0; i < 8; i++) setPose(pool.get(), frame + i);
        setPose(parent, frame);
        parent.updateMatrixWorld(true);
        pool.reset();
    }
    assert.deepEqual(counts, { compose: 40, multiply: 40 });
    const referenceParent = new T.Group(), referenceCounts = { compose: 0, multiply: 0 };
    for (let i = 0; i < 160; i++) {
        const object = countedMesh(referenceCounts);
        object.visible = i < 8;
        referenceParent.add(object);
    }
    for (let frame = 0; frame < 5; frame++) referenceParent.updateMatrixWorld(true);
    assert.deepEqual(referenceCounts, { compose: 800, multiply: 800 },
        'visibility alone still computes matrices for every retained slot');
    assert.equal(parent.children.length, 160, 'dormant resources remain reachable by teardown');
    let visited = 0;
    parent.traverse(() => visited++);
    assert.equal(visited, 161);
});

test('reuse preserves factory and caller matrix modes, including manually updated parents', async () => {
    const T = await three;
    for (const localAuto of [false, true]) for (const worldAuto of [false, true]) {
        const parent = new T.Group();
        parent.matrixAutoUpdate = false;
        const pool = createPool(parent, () => {
            const object = new T.Mesh();
            object.matrixAutoUpdate = localAuto;
            object.matrixWorldAutoUpdate = worldAuto;
            object.matrix.makeTranslation(2, 3, 4);
            object.matrixWorld.makeTranslation(7, 8, 9);
            return object;
        }).warm(1);
        const object = pool.get();
        assert.equal(object.matrixAutoUpdate, localAuto);
        assert.equal(object.matrixWorldAutoUpdate, worldAuto);
        pool.reset();
        parent.matrix.makeTranslation(10, 20, 30);
        parent.matrixWorldNeedsUpdate = true;
        parent.updateMatrixWorld();
        pool.get();
        // Parent is now unchanged, so it does not force child updates.
        parent.updateMatrixWorld();
        const expected = worldAuto
            ? new T.Matrix4().multiplyMatrices(parent.matrixWorld, object.matrix)
            : new T.Matrix4().makeTranslation(7, 8, 9);
        assert.deepEqual(object.matrixWorld.elements, expected.elements);
        object.matrixAutoUpdate = !localAuto;
        object.matrixWorldAutoUpdate = !worldAuto;
        pool.reset(); pool.get();
        assert.equal(object.matrixAutoUpdate, !localAuto);
        assert.equal(object.matrixWorldAutoUpdate, !worldAuto);
    }
});

test('reuse keeps sprite centres, camera relevance and active visibility behavior', async () => {
    const T = await three;
    let relevant = true;
    const parent = new T.Group();
    const pool = createPool(parent, () => new T.Sprite(), () => relevant);
    const sprite = pool.get();
    sprite.center.set(0, 1);
    pool.reset(); relevant = false;
    assert.strictEqual(pool.get(), sprite);
    assert.deepEqual(sprite.center.toArray(), [.5, .5]);
    assert.equal(sprite.userData.stableCameraRelevant, false);
    const active = [];
    sprite.visible = false; pool.forEachActive(object => active.push(object));
    assert.equal(active.length, 0);
    sprite.visible = true; pool.forEachActive(object => active.push(object));
    assert.deepEqual(active, [sprite]);
});
