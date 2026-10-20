const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { solve } = require('./highway-bend-layout-fixture.js');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function extract(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0);
    const end = src.indexOf('\n        }', start) + '\n        }'.length;
    return src.slice(start, end);
}
function marker(string, inverted, stringCount = 6, groupNotes = null) {
    const start = src.indexOf('                const bendLayout = _bendLayout.byNote.get(n);');
    const end = src.indexOf('\n                if (rsPlusNotation) {', start);
    assert.ok(start >= 0 && end > start);
    const mesh = { material: {}, scale: { set() {} }, position: { set(x,y,z) { this.x=x;this.y=y; } }, rotation: {} };
    const notes = groupNotes || [{s:string,f:7,t:0,sus:1,bn:2}];
    const n = notes.find(n => n.s === string);
    const fn = new Function('s', '_invertedCached', 'nStr', 'mesh', 'n', '_bendLayout', `
        const _bendLayoutForceNeutral=false, _bendLayoutJob=null, _bendNeutralMat={neutral:true};
        const _linkedBendStarts=new WeakMap();
        const validString = s => Number.isInteger(s) && s >= 0 && s < nStr;
        ${extract('hwyBendLayoutDirection')}
        ${extract('bendVisualDirY')}
        // The extracted drawNote block attaches technique ink to its gem record.
        ${extract('trailYieldRegisterAttachment')}
        const trailYieldGemRecord={_trailYieldAttachmentCount:0,_trailYieldAttachmentOrder:Infinity};
        const rsPlusNotation=false;
        const NH=1, NW=1, K=.1, x=5, y=10, now=.5, techniqueYNow=.5, noteZ=-1, approachRot=.2;
        const bendSemisAtTime=()=>1;
        const activePalette=Array(nStr).fill(0xffffff), pTechPlane={get:()=>mesh};
        const bendChevronMat=()=>({}), _spriteMat2MeshMat=()=>({}), techniqueMarkerRenderOrder=20;
        const registrations=[];
        const _registerIncomingLabelOccluder=(registeredMesh,z)=>registrations.push({mesh:registeredMesh,z});
        let yo=11;
        ${src.slice(start,end)}
        return {dir:bendVisualDirY(s,n), y:mesh.position.y, rotation:mesh.rotation.z, yo, mesh, registrations,
            attachments:trailYieldGemRecord._trailYieldAttachments};
    `);
    return fn(string, inverted, stringCount, mesh, n, solve(notes, [], stringCount));
}

for (const count of [4, 6, 7, 8]) {
    for (const inverted of [false, true]) {
        test(`${count}-string bend chevrons agree with bend movement (inverted=${inverted})`, () => {
            for (let s=0;s<count;s++) {
                const m=marker(s,inverted,count);
                assert.equal(Math.sign(m.y-10.5),m.dir);
                assert.ok(Math.abs(Math.cos(m.rotation-.2)-m.dir)<1e-9);
                assert.equal(m.registrations.length,1,'the rendered bend mark participates in label clearance');
                assert.equal(m.registrations[0].mesh,m.mesh,'registration uses the actual pooled bend mesh');
                assert.equal(m.registrations[0].z,-1,'clearance compares the mark at its note event depth');
                assert.equal(m.attachments.length,1,'the bend mark stays attached to its gem');
                assert.equal(m.attachments[0],m.mesh,'attachment uses the actual pooled bend mesh');
                assert.equal(m.mesh.renderOrder,20,'an unconstrained attachment keeps its technique layer');
                if(m.dir<0) assert.equal(m.yo,11,'downward chevron does not reserve upper label space');
            }
        });
    }
}

test('the default low string points down and high string points up', () => {
    assert.equal(marker(0,false).dir,-1);
    assert.equal(marker(5,false).dir,1);
});

test('grouped blue and orange markers agree with the shared thin-string direction', () => {
    const notes=[{s:2,f:7,t:0,sus:1,bn:.5},{s:3,f:9,t:0,sus:1,bn:.5}];
    for(const inverted of [false,true]) for(const n of notes) {
        assert.equal(marker(n.s,inverted,6,notes).dir,inverted?1:-1);
    }
});

test('neither-direction group uses a stationary pitch cue on the existing pooled plane', () => {
    const notes=[1,2,3,4].map(s=>({s,f:7,t:0,sus:1,bn:2}));
    for(const n of notes) {
        const result=marker(n.s,false,6,notes);
        assert.equal(Math.abs(result.dir),0);
        assert.equal(result.y,10.5);
        assert.equal(result.mesh.position.x,6.7);
        assert.equal(result.mesh.material.opacity,.775);
        assert.equal(result.registrations.length,1);
        assert.equal(result.attachments.length,1);
    }
});
