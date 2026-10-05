import test from 'node:test';
import assert from 'node:assert/strict';
import {barPitch,barSegment,barVisual,barBoundaries} from '../../static/js/whammy.js';

const note={whammy:{version:1,policy:'optional',segments:[
    {start:0,end:1,curve:[{t:0,v:-2},{t:1,v:2}]},
    {start:1,end:2,curve:[{t:1,v:0},{t:2,v:-16}]},
    {start:3,end:4,curve:[],vibrato:'wide'}]}};
test('signed source pitch and exact shared-boundary ownership',()=>{
    assert.equal(barPitch(note,0),-2);assert.equal(barPitch(note,.5),0);
    assert.equal(barPitch(note,1),0);assert.equal(barPitch(note,2),-16);
    assert.equal(barSegment(note,2.5),null);
    assert.equal(barPitch(note,-.1),-2);
});
test('only visual excursion is bounded; vibrato adds no authored pitch',()=>{
    assert.ok(Math.abs(barVisual(note,2))<2.5);
    assert.equal(barPitch(note,2),-16);
    assert.notEqual(barVisual(note,3.05),0);
    assert.equal(barPitch(note,3.05),0);
    assert.ok(barBoundaries(note).includes(3));
});
test('ordinary notes retain zero bar motion',()=>{
    assert.equal(barPitch({},1),0);assert.equal(barVisual({},1),0);
    assert.deepEqual(barBoundaries({}),[]);
});
