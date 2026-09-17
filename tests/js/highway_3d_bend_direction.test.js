const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    const end = src.indexOf('\n        }', start) + '\n        }'.length;
    return src.slice(start, end);
}
function marker(string, inverted, stringCount = 6) {
    const start = src.indexOf('                if (_bendPeak > 0) {');
    const end = src.indexOf('\n                if (rsPlusNotation) {', start);
    assert.ok(start >= 0 && end > start);
    const mesh = { material: {}, scale: { set() {} }, position: { set(x,y,z) { this.y=y; } }, rotation: {} };
    const fn = new Function('s', '_invertedCached', 'nStr', 'mesh', `
        const validString = s => Number.isInteger(s) && s >= 0 && s < nStr;
        ${extract('bendVisualDirY')}
        const rsPlusNotation=false;
        const _bendPeak=2, NH=1, K=.1, x=5, y=10, techniqueYNow=.5, noteZ=-1, approachRot=.2;
        const activePalette=Array(nStr).fill(0xffffff), pTechPlane={get:()=>mesh};
        const bendChevronMat=()=>({}), _spriteMat2MeshMat=()=>({}), techniqueMarkerRenderOrder=20;
        let yo=11;
        ${src.slice(start,end)}
        return {dir:bendVisualDirY(s), y:mesh.position.y, rotation:mesh.rotation.z, yo};
    `);
    return fn(string, inverted, stringCount, mesh);
}

for (const count of [4, 6, 7, 8]) {
    for (const inverted of [false, true]) {
        test(`${count}-string bend chevrons agree with bend movement (inverted=${inverted})`, () => {
            for (let s=0;s<count;s++) {
                const m=marker(s,inverted,count);
                assert.equal(Math.sign(m.y-10.5),m.dir);
                assert.ok(Math.abs(Math.cos(m.rotation-.2)-m.dir)<1e-9);
                if(m.dir<0) assert.equal(m.yo,11,'downward chevron does not reserve upper label space');
            }
        });
    }
}

test('the default low string points down and high string points up', () => {
    assert.equal(marker(0,false).dir,-1);
    assert.equal(marker(5,false).dir,1);
});
