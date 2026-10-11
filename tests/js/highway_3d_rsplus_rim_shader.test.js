const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'plugins/highway_3d/screen.js'),'utf8').replace(/\r\n/g,'\n');
function extract(name){
 const start=source.indexOf('function '+name+'('),open=source.indexOf('{',start);assert.ok(start>=0,name);let depth=0;
 for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&!--depth)return source.slice(start,i+1);}throw Error('Unclosed '+name);
}
const fields=['gRsNote','gRsNoteGhost','gRsNoteGrad','gRsNoteGhostGrad','gRsNoteHalo','rsHaloTexture','mRsBody','mRsRim','mRsAccentRim','mRsHitRim','mRsSus','mRsSusHit','mRsSusEdge','mRsMissRim','mRsOpenStem','mRsHalo'];
async function setup(palette=[0xeedd33,0x2277ff,0x111111,0xff0000,0xffffff,0x00ffcc,0x771199,0]){
 const T=await import(pathToFileURL(path.join(root,'static/vendor/three/three.module.min.js')).href);
 return new Function('T','activePalette',`
  const NW=10,NH=8,ND=2;let vibrancy=.9,glowMul=.15,rsNotationPaletteSig='';
  let ${fields.join(',')};
  ${extract('hwyGhostNoteOutlineGeometry')}
  ${extract('hwyGhostNoteWithBodyGeometry')}
  const gNoteGhost=hwyGhostNoteOutlineGeometry(T,NW,NH,ND);
  ${extract('_applyRsNotationPalette')}
  ${extract('_initRsNotation')}
  _initRsNotation();
  return {T,${fields.join(',')},gNoteGhost,retint(palette,v,g){activePalette=palette;vibrancy=v;glowMul=g;_applyRsNotationPalette();}};
 `)(T,palette);
}
function materialJSON(m){const j=m.toJSON();for(const key of ['uuid','metadata','map','textures','images'])delete j[key];return j;}


test('RS+ flat rims have no color attributes and every ordinary/ghost gradient owns its color storage',async()=>{
 const a=await setup();
 for(const [base,gradients] of [[a.gRsNote,a.gRsNoteGrad],[a.gRsNoteGhost,a.gRsNoteGhostGrad]]){
  assert.equal(base.attributes.color,undefined,'flat rim geometry needs no vertex color input');
  for(const g of gradients){
   assert.notEqual(g,base);
   assert.equal(g.attributes.color.itemSize,3);assert.equal(g.attributes.color.normalized,false);
   assert.equal(g.attributes.color.count,g.attributes.position.count);
   for(const k of ['position','normal','uv'])assert.deepEqual(g.attributes[k].array,base.attributes[k].array);
   assert.deepEqual(g.groups,base.groups);assert.deepEqual(g.drawRange,base.drawRange);
  }
  assert.equal(new Set(gradients.map(g=>g.attributes.color.array)).size,gradients.length);
 }
 const gradients=[...a.gRsNoteGrad,...a.gRsNoteGhostGrad];
 assert.equal(new Set(gradients.map(g=>g.attributes.color.array)).size,gradients.length,'ordinary and ghost gradients never alias');
 assert.ok(a.gRsNoteGrad[0].attributes.color.array.some(v=>v!==1),'authored gradient is not replaced by white');
 assert.ok(a.gRsNoteGhostGrad[0].attributes.color.array.some(v=>v!==1),'authored ghost gradient is not replaced by white');
 assert.equal(a.gNoteGhost.attributes.color,undefined,'Current-style ghost geometry remains unchanged');
});

test('flat RS+ rims and reused controls omit vertex colors while gradient bodies enable them',async()=>{
 const a=await setup();
 for(const k of ['mRsRim','mRsAccentRim'])for(let i=0;i<a[k].length;i++){
  const rim=a[k][i],body=a.mRsBody[i];assert.equal(rim.vertexColors,false);assert.equal(body.vertexColors,true);
  const r=materialJSON(rim),b=materialJSON(body);delete r.color;delete b.color;delete r.vertexColors;delete b.vertexColors;
  assert.deepEqual(r,b,'same remaining material state apart from diffuse color and vertex-color selection');
  assert.equal(rim.map,null);assert.equal(body.map,null);
  assert.equal(rim.onBeforeCompile,body.onBeforeCompile);
  assert.equal(rim.customProgramCacheKey(),body.customProgramCacheKey());
 }
 for(const k of ['mRsHitRim','mRsMissRim','mRsOpenStem','mRsSus','mRsSusHit','mRsSusEdge','mRsHalo']){
  for(const m of Array.isArray(a[k])?a[k]:[a[k]])assert.equal(m.vertexColors,false,k+' can use geometry without a color attribute');
 }
 for(const m of [...a.mRsRim,...a.mRsAccentRim]){
  assert.equal(m.transparent,true);assert.equal(m.opacity,1);assert.equal(m.depthWrite,false);
  assert.equal(m.depthTest,true);assert.equal(m.side,a.T.FrontSide);assert.equal(m.fog,false);assert.equal(m.toneMapped,false);
 }
});

test('palette/vibrancy/glow changes retint gradients and rim uniforms without adding flat color storage or changing geometry',async()=>{
 const a=await setup();
 const bases=[a.gRsNote,a.gRsNoteGhost];
 const geometry=bases.map(g=>Object.fromEntries(['position','normal','uv'].map(k=>[k,g.attributes[k].array.slice()])));
 const originalGradient=a.gRsNoteGrad[0].attributes.color.array.slice();
 const originalRim=a.mRsRim[0].color.clone(),originalAccent=a.mRsAccentRim[0].color.clone();
 for(const [p,v,g] of [[[0,0xffffff,0xff0044,0x0022ff,0x00ff44,0xbb11aa,0x222222,0xffff00],0,0],[[0x112233,0x8899aa],1,1],[[0xeedd33,0x123456,0x030303],.35,.77]]){
  a.retint(p,v,g);
  for(let i=0;i<bases.length;i++){
   assert.equal(bases[i].attributes.color,undefined);
   for(const k of ['position','normal','uv'])assert.deepEqual(bases[i].attributes[k].array,geometry[i][k]);
  }
  for(const k of ['gRsNoteGrad','gRsNoteGhostGrad'])for(let i=0;i<p.length;i++)assert.ok(a[k][i].attributes.color.array.every(Number.isFinite));
 }
 assert.notDeepEqual(a.gRsNoteGrad[0].attributes.color.array,originalGradient);
 assert.notDeepEqual(a.mRsAccentRim[0].color,originalAccent);
 a.retint([0],.9,.15);assert.notDeepEqual(a.mRsRim[0].color,originalRim,'black fills select a contrasting light rim');
});
