const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/input_setup/screen.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const controls=new Map();
 const host={innerHTML:'',querySelector(selector){
   if(!controls.has(selector)) controls.set(selector,{value:'asio',disabled:false,isConnected:true,textContent:'',listeners:{},
     addEventListener(event,fn){this.listeners[event]=fn;}});
   return controls.get(selector);
 }};
 const pending=[];let launches=0;
 const window={noteDetect:{launchCalibration(){launches++;}},feedBack:{capabilities:{command:async(d,c,args)=>{
   if(c==='list-sources')return{payload:{sources:[{logicalSourceKey:'asio',label:'ASIO interface'}]}};
   return new Promise((resolve,reject)=>pending.push({key:args.payload.logicalSourceKey,resolve,reject}));
 }}}};
 vm.runInNewContext(source,{window,document:{getElementById(){return null;}},localStorage:{getItem(){return null;}},
   fetch:async()=>({}),console});
 window.feedBackInputSetup.mount(host,{instruments:['guitar']});await settle();
 return {pending,control:s=>host.querySelector(s),launches:()=>launches};
}
test('first displayed source is selected before calibration can launch',async()=>{
 const f=await fixture(),button=f.control('[data-is-cal]');
 assert.equal(button.disabled,true);assert.equal(f.pending[0].key,'asio');
 const click=button.listeners.click();await settle();assert.equal(f.launches(),0);
 f.pending[0].resolve({outcome:'handled'});await click;
 assert.equal(f.launches(),1);
});
test('failed selection is visible and cannot launch calibration on the wrong source',async()=>{
 const f=await fixture();f.pending[0].resolve({outcome:'degraded',reason:'Disconnected'});await settle();
 const retry=f.control('[data-is-cal]').listeners.click();await settle();
 f.pending[1].resolve({outcome:'degraded',reason:'Disconnected'});await retry;assert.equal(f.launches(),0);
 assert.equal(f.control('[data-is-audio-status]').textContent,'Disconnected');
});
test('rapid selections are serialized and calibration waits for the last one',async()=>{
 const f=await fixture(),select=f.control('[data-is-audio]'),button=f.control('[data-is-cal]');
 select.value='second';select.listeners.change();
 select.value='third';select.listeners.change();
 assert.equal(f.pending.length,1);
 f.pending[0].resolve({outcome:'handled'});await settle();assert.equal(f.pending[1].key,'second');
 assert.equal(button.disabled,true);
 f.pending[1].resolve({outcome:'handled'});await settle();assert.equal(f.pending[2].key,'third');
 f.pending[2].resolve({outcome:'handled'});await settle();assert.equal(button.disabled,false);
 await button.listeners.click();assert.equal(f.launches(),1);
});
