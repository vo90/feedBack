const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const screen = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/settings.html'), 'utf8');
const key = 'letRingTrailsVisible', storageKey = 'h3d_bg_' + key;

function load(initial = {}, blocked = false) {
    const data = new Map(Object.entries(initial)), writes = [], window = {feedBackTour:{register(){}}};
    const localStorage = {
        getItem(name) { if(blocked)throw Error('blocked'); return data.get(name) ?? null; },
        setItem(name,value) { if(blocked)throw Error('blocked'); writes.push([name,String(value)]);data.set(name,String(value)); },
    };
    const anchor = 'window.feedBackViz_highway_3d = createFactory;';
    assert.equal(screen.split(anchor).length,2);
    vm.runInNewContext(screen.replace(anchor, `${anchor}
        window.api={read:_bgReadSetting,subscribe:_bgSubscribe};`),
    {window,localStorage,performance:{now:()=>0},console:{log(){},warn(){},error(){}}});
    const toggle={checked:true,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}};
    const start=html.indexOf("            const letRingToggle = document.getElementById('h3d-let-ring-trails-visible');");
    const end=html.indexOf('            const notationStemControls',start);
    assert.ok(start>=0 && end>start);
    new Function('document','window','localStorage',html.slice(start,end))(
        {getElementById:()=>toggle},window,localStorage);
    return {window,api:window.api,toggle,data,writes};
}

test('saved booleans and missing or corrupt preferences hydrate consistently without writes',()=>{
    for(const [saved,wanted] of [[null,false],['true',true],['1',true],['false',false],['0',false],['bad',false]]){
        const h=load(saved===null?{}:{[storageKey]:saved});
        assert.equal(h.api.read('main',key),wanted);
        assert.equal(h.toggle.checked,wanted);
        assert.deepEqual(h.writes,[]);
    }
    const control=load().window.feedBackViz_highway_3d.panelControls.find(c=>c.key===key);
    assert.equal(control.type,'toggle');assert.equal(control.default,false);
    assert.doesNotMatch(html.match(/<input\b[^>]*id="h3d-let-ring-trails-visible"[^>]*>/)[0],/\bchecked\b|\bonchange\b/);
});

test('checkbox changes persist and notify once while respecting independent panel choices',()=>{
    const h=load({h3d_bg_notationStyle:'rsplus',['h3d_bg_panel0_'+key]:'true'}),events=[];
    h.api.subscribe(changed=>events.push([changed,h.api.read('main',changed)]));
    for(const visible of [true,false]){
        h.toggle.checked=visible;h.toggle.listeners.change();
        assert.equal(h.api.read('main',key),visible);
        assert.equal(load(Object.fromEntries(h.data)).api.read('main',key),visible);
        assert.equal(h.api.read('panel0',key),true);
    }
    assert.deepEqual(events,[[key,true],[key,false]]);
    assert.deepEqual(h.writes,[[storageKey,'true'],[storageKey,'false']]);
    assert.equal(h.data.get('h3d_bg_notationStyle'),'rsplus');
    h.window.h3dBgSetLetRingTrailsVisible('bad');
    assert.equal(h.api.read('main',key),false);
});

test('the checkbox persists before renderer loading and stays live when storage is blocked',()=>{
    const h=load();delete h.window.h3dBgSetLetRingTrailsVisible;
    h.toggle.checked=true;h.toggle.listeners.change();
    assert.equal(h.data.get(storageKey),'true');
    assert.equal(load(Object.fromEntries(h.data)).toggle.checked,true);
    const blocked=load({},true);
    for(const visible of [true,false]){
        blocked.toggle.checked=visible;blocked.toggle.listeners.change();
        assert.equal(blocked.api.read('main',key),visible);
    }
    assert.deepEqual(blocked.writes,[]);
});
