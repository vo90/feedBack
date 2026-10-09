const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {extractFunction} = require('./test_utils');
const session = fs.readFileSync(path.join(__dirname, '../../static/js/session.js'), 'utf8');
const highway = fs.readFileSync(path.join(__dirname, '../../static/highway.js'), 'utf8');

function build() {
    const connections = [], timers = [], stops = [], elements = new Map();
    const sb = { S: {}, console: {log() {}}, URLSearchParams, location: {protocol:'http:',host:'test'},
        artAbortController:null, audio:{pause(){},src:''}, currentFilename:'',
        document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'Previous song'});return elements.get(id);}},
        setTimeout(fn,ms){timers.push({fn,ms});},
        window:{feedBack:{emit(){}},highway:{stop(){},init(){},connect(url){connections.push(url);},getRenderScale(){return 1;}}},
        jucePlayer:{stop(){return new Promise(r=>stops.push(r));}},
    };
    for (const name of ['_recordPlaybackBridge','_clearAutoplayHold','_cancelCountIn','_resetJuceAudioShimChain',
        '_resetAudioSeekState','setPlayButtonState','_resetPlaybackSpeedForNewSong','clearLoop','_resetSectionPracticeLog',
        '_hideSectionPracticeBar','_clearAutoExit','showScreen','_scheduleSectionPracticeRetries','loadSavedLoops']) sb[name]=()=>{};
    sb._resolvePlayerOrigin=()=> 'home'; sb._getArrangementNamingMode=()=> 'default';sb._songEventPayload=()=>({});
    vm.createContext(sb);
    vm.runInContext(extractFunction(session,'async function playSong'),sb);
    return {sb,connections,timers,stops,elements};
}
test('load clears stale title immediately and yields without a fixed 500ms delay',async()=>{
    const h=build();const p=h.sb.playSong('first',2);
    assert.equal(h.elements.get('hud-title').textContent,'Loading song…');
    assert.equal(h.elements.get('hud-arrangement').textContent,'');
    assert.equal(h.timers[0].ms,0);
    h.timers.shift().fn();await p;
    assert.equal(h.connections.length,1);assert.match(h.connections[0],/first\?arrangement=2/);
});
test('rapid A to B to C only connects C',async()=>{
    const h=build();const pending=['A','B','C'].map(f=>h.sb.playSong(f));
    h.timers.forEach(t=>t.fn());await Promise.all(pending);
    assert.equal(h.connections.length,1);assert.match(h.connections[0],/\/C\?/);
});
test('superseded native stop completion cannot reset the new session',async()=>{
    const h=build();h.sb.window._juceMode=true;
    const a=h.sb.playSong('A'), b=h.sb.playSong('B');
    h.stops[1]();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    h.timers.forEach(t=>t.fn());await b;
    h.sb.window._juceMode=true;h.sb.audio.src='new-song';
    h.stops[0]();await a;
    assert.equal(h.sb.window._juceMode,true);assert.equal(h.sb.audio.src,'new-song');
    assert.equal(h.connections.length,1);assert.match(h.connections[0],/\/B\?/);
});
test('navigation cancellation while yielding prevents connection',async()=>{
    const h=build();const p=h.sb.playSong('cancelled');
    // Execute the real navigation invalidation before the rest of its DOM work.
    vm.runInContext(extractFunction(session,'async function showScreen').split('// ──')[0]+'}',h.sb);
    await h.sb.showScreen('home');
    h.timers.forEach(t=>t.fn());await p;
    assert.equal(h.connections.length,0);
});
test('late messages from an old socket are ignored after reconnect and after stop',async()=>{
    const sockets=[],errors=[];
    const sb={hwState:{_wsGen:0},window:{},console:{log(){},error(){}},
        WebSocket:class{constructor(){sockets.push(this);}close(){}},cancelAnimationFrame(){},
        _destroyCurrentIfInited(){},api:{resetPresentation(){}}};
    vm.createContext(sb);
    vm.runInContext('api.connect=function '+extractFunction(highway,'connect(wsUrl, opts = {})')+';api.stop=function '+extractFunction(highway.slice(highway.indexOf('\n        stop() {')),'stop()')+';',sb);
    sb.api.connect('A',{onError:e=>errors.push(e)});const old=sockets[0];
    sb.api.stop();old.onmessage({data:JSON.stringify({error:'after-stop'})});
    await sb.hwState._msgChain;
    sb.api.connect('B',{onError:e=>errors.push(e)});
    old.onmessage({data:JSON.stringify({error:'after-reconnect'})});
    sockets[1].onmessage({data:JSON.stringify({error:'current'})});
    await sb.hwState._msgChain;
    assert.deepEqual(errors,['current']);
});
