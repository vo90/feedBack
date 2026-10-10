const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.join(__dirname,'../..');
function extract(src,name){const start=src.indexOf('function '+name+'(');assert.ok(start>=0);let depth=1,end=src.indexOf('{',start)+1;while(depth&&end<src.length){if(src[end]==='{')depth++;else if(src[end]==='}')depth--;end++;}return src.slice(start,end);}
test('FPS layout reads are bounded, reflect hidden/replaced chrome, and invalidate on resize',()=>{
 const source=fs.readFileSync(path.join(root,'plugins/highway_3d/screen.js'),'utf8');let now=0,reads=0;const els={};
 function el(bottom){return {isConnected:true,offsetParent:{},getBoundingClientRect(){reads++;return {bottom}}};}
 els['v3-upnext']=el(140);els['v3-live-performance-hud']=el(180);els['hud-time']=el(90);
 const c=vm.createContext({performance:{now:()=>now},document:{getElementById:id=>els[id]},window:{feedBack:{uiVersion:'v3'}},highwayCanvas:{getBoundingClientRect(){reads++;return {top:20}}}});
 vm.runInContext('let _v3HudEls=null,_v3HudBottom=0,_v3HudMeasureAt=-Infinity;'+extract(source,'_v3TopRightChromeBottom'),c);const sample=()=>vm.runInContext('_v3TopRightChromeBottom()',c);
 assert.equal(sample(),160);const count=reads;for(now=1;now<100;now++)assert.equal(sample(),160);assert.equal(reads,count);
 els['v3-live-performance-hud'].offsetParent=null;assert.equal(sample(),120);
 els['v3-upnext'].isConnected=false;els['v3-upnext']=el(220);assert.equal(sample(),200);
 vm.runInContext('_v3HudMeasureAt=-Infinity',c);els['v3-upnext'].offsetParent=null;assert.equal(sample(),70);
 assert.match(extract(source,'applySize'),/_v3HudMeasureAt = -Infinity/);
 c.window.feedBack.uiVersion='v2';assert.equal(sample(),0);
});
test('practice controls preserve displayed state without repetitive writes, including replacement elements',()=>{
 const source=fs.readFileSync(path.join(root,'static/js/section-practice.js'),'utf8');let writes=0;const elements={};
 function element(){const values={textContent:'',disabled:false,checked:false};return Object.defineProperties({},Object.fromEntries(Object.keys(values).map(k=>[k,{get:()=>values[k],set:v=>{writes++;values[k]=v}}])));}
 for(const id of ['label','prev','next','whole'])elements['section-practice-'+(id==='whole'?id:'piece-'+id)]=element();
 const c=vm.createContext({document:{getElementById:id=>elements[id]},_sectionPracticeRanges:[1,2,3],_sectionPracticeActiveParent:0,_sectionPracticeWholeSection:false,_sectionPracticeSelected:0,_sectionPracticeCurrentPartIndex:()=>c._sectionPracticeSelected});
 vm.runInContext(extract(source,'_syncSectionPracticePieceUi'),c);const sync=()=>vm.runInContext('_syncSectionPracticePieceUi()',c);sync();const count=writes;for(let i=0;i<200;i++)sync();assert.equal(writes,count);
 assert.equal(elements['section-practice-piece-label'].textContent,'Part 1 of 3');assert.equal(elements['section-practice-piece-prev'].disabled,true);
 c._sectionPracticeSelected=2;sync();assert.equal(elements['section-practice-piece-label'].textContent,'Part 3 of 3');assert.equal(elements['section-practice-piece-next'].disabled,true);assert.equal(elements['section-practice-piece-prev'].disabled,false);
 elements['section-practice-piece-label']=element();sync();assert.equal(elements['section-practice-piece-label'].textContent,'Part 3 of 3');
 c._sectionPracticeWholeSection=true;sync();assert.equal(elements['section-practice-whole'].checked,true);assert.equal(elements['section-practice-piece-next'].disabled,false);
 c._sectionPracticeActiveParent=-1;sync();assert.equal(elements['section-practice-piece-label'].textContent,'Part — of —');assert.equal(elements['section-practice-piece-prev'].disabled,true);
});
