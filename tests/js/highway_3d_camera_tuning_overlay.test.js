const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
const keys = ['stableCameraStartBeforeMs', 'stableCameraArriveAfterMs',
    'stableCameraExcursionThreshold'];

// The production helper builds ordinary elements. This DOM implements tree
// traversal and bubbling so keyboard tests exercise the ancestor boundary,
// rather than invoking its listener directly and assuming it protects the app.
function makeDocument() {
    class Element {
        constructor(tagName) {
            this.tagName = tagName.toUpperCase();
            this.children = []; this.parentNode = null; this.listeners = new Map();
            this.attributes = new Map(); this.dataset = {}; this.style = {};
            this.value = ''; this.textWrites = 0; this.textContent = ''; this.className = '';
            this.hidden = false; this.disabled = false; this.checked = false;
        }
        get textContent() { return this._textContent; }
        set textContent(value) { this._textContent = value; this.textWrites++; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        append(...children) { for (const child of children) this.appendChild(child); }
        remove() {
            if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
            this.parentNode = null;
        }
        contains(node) { return node === this || this.children.some(child => child.contains(node)); }
        setAttribute(name, value) {
            this.attributes.set(name, String(value));
            if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
            if (name === 'id') this.id = String(value);
        }
        getAttribute(name) {
            if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
            return this.attributes.get(name) ?? null;
        }
        matches(selector) {
            const tag = selector.match(/^[a-z]+/i)?.[0];
            if (tag && this.tagName !== tag.toUpperCase()) return false;
            if (selector.startsWith('#')) return this.id === selector.slice(1);
            if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
            return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)]
                .every(([, name, value]) => value === undefined ? this.getAttribute(name) !== null : this.getAttribute(name) === value);
        }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
        addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
        removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
        dispatchEvent(event) {
            event.target ??= this;
            event.currentTarget = this;
            for (const fn of [...this.listeners.get(event.type) || []]) fn.call(this, event);
            if (event.bubbles && !event.cancelBubble) this.parentNode?.dispatchEvent(event);
            return !event.defaultPrevented;
        }
        emit(type, properties = {}) {
            const event = {type, bubbles: true, defaultPrevented: false, cancelBubble: false,
                preventDefault() { this.defaultPrevented = true; },
                stopPropagation() { this.cancelBubble = true; }, ...properties};
            this.dispatchEvent(event); return event;
        }
        focus() { document.activeElement = this; }
        click() { if (!this.disabled) this.emit('click'); }
    }
    const document = new Element('document');
    document.body = document.appendChild(new Element('body'));
    document.activeElement = document.body;
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.querySelector('#' + id);
    return document;
}

function load(initial = {}, {blocked = false} = {}) {
    const document = makeDocument(), writes = [], data = new Map(Object.entries(initial));
    const window = document.createElement('window');
    document.parentNode = window;
    window.feedBackTour = {register() {}};
    const errors = [];
    const sandbox = {document, window, performance: {now: () => 0},
        console: {log() {}, warn() {}, error(...args) { errors.push(args); }},
        localStorage: {getItem(key) { return data.get(key) ?? null; }, setItem(key, value) {
            if (blocked) throw new Error('Storage unavailable');
            data.set(key, String(value)); writes.push([key, String(value)]);
        }},
        CustomEvent: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
    };
    const anchor = 'window.feedBackViz_highway_3d = createFactory;';
    assert.equal(source.split(anchor).length, 2);
    vm.runInNewContext(source.replace(anchor, `${anchor}\nwindow.testCameraOverlay = {
        create: createStableCameraTuningOverlay, listeners: _bgListeners,
        read: _bgReadSetting, write: _bgWriteGlobal };`), sandbox);
    const api = window.testCameraOverlay;
    const overlays = [];
    function create(panelIndex = null) {
        const host = document.body.appendChild(document.createElement('div'));
        const canvas = document.createElement('canvas'); canvas.panelIndex = panelIndex;
        window.feedBackSplitscreen = {panelIndexFor: value => value?.panelIndex};
        const overlay = api.create(host, () => canvas, 'test-' + overlays.length);
        const query = selector => overlay.root.querySelector(selector);
        const input = (key, type = 'range') => query(`[data-camera-setting="${key}"][data-camera-input="${type}"]`);
        const toggle = query('[data-camera-tuning-toggle]');
        const panel = query('[data-camera-tuning-panel]');
        const instance = {...overlay, host, canvas, query, input, toggle, panel};
        overlays.push(instance); return instance;
    }
    return {document, window, writes, data, api, create, errors};
}

function stored(key) { return 'h3d_bg_' + key; }
function values(overlay) { return keys.map(key => Number(overlay.input(key).value)); }

test('only exact start, exact arrival and threshold are exposed without rewriting saved preferences', () => {
    const initial = {h3d_bg_cameraMode:'stable', h3d_bg_stableCameraPreparationMs:'850',
        h3d_bg_stableCameraDepartureDelay:'500', h3d_bg_stableCameraTravelExtra:'40',
        h3d_bg_stableCameraSettleLimit:'250', h3d_bg_stableCameraPreparationMode:'auto'};
    const h=load(initial), o=h.create();
    assert.deepEqual(values(o),[850,0,500]);
    for(const key of ['stableCameraPreparationMode','stableCameraPreparationMs','stableCameraDepartureDelay',
        'stableCameraTravelExtra','stableCameraSettleLimit','stableCameraLongSwitchFrets'])
        assert.equal(o.query(`[data-camera-setting="${key}"]`),null,key);
    assert.equal(o.query('[data-camera-tuning-preset]'),null);
    assert.deepEqual(h.writes,[]);
    assert.deepEqual(Object.fromEntries(h.data),initial);
    assert.equal(o.panel.hidden,true); o.toggle.click();
    assert.equal(o.panel.hidden,false); assert.equal(o.toggle.getAttribute('aria-expanded'),'true');
    assert.match(o.query('[data-camera-duration]').textContent,/850 ms/);
});

test('new start inherits old per-pane preparation only until explicitly set', () => {
    const h=load({h3d_bg_cameraMode:'stable',h3d_bg_stableCameraPreparationMs:'800',
        h3d_bg_panel1_stableCameraPreparationMs:'1200', h3d_bg_main_stableCameraPreparationMs:'900'});
    const main=h.create(),split=h.create(1);
    assert.equal(main.input(keys[0]).value,'900'); assert.equal(split.input(keys[0]).value,'1200');
    h.window.h3dBgSetStableCameraStartBeforeMs(600);
    assert.equal(main.input(keys[0]).value,'600'); assert.equal(split.input(keys[0]).value,'600');
    split.input(keys[0],'number').value='750'; split.input(keys[0],'number').emit('change');
    h.window.h3dBgSetStableCameraStartBeforeMs(500);
    assert.equal(main.input(keys[0]).value,'500'); assert.equal(split.input(keys[0]).value,'750');
    assert.equal(h.data.get('h3d_bg_panel1_stableCameraPreparationMs'),'1200');
    assert.equal(h.data.get('h3d_bg_main_stableCameraPreparationMs'),'900');
});

test('slider changes commit only on release and derive duration from committed times', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),range=o.input(keys[0]),number=o.input(keys[0],'number');
    range.value='600';range.emit('input');assert.equal(number.value,'600');assert.deepEqual(h.writes,[]);
    range.emit('change');assert.deepEqual(h.writes,[[stored(keys[0]),'600']]);
    const arrival=o.input(keys[1],'number');arrival.value='100';arrival.emit('change');
    assert.match(o.query('[data-camera-duration]').textContent,/700 ms/);
    assert.deepEqual(values(o),[600,100,500]);
    assert.deepEqual(h.errors,[]);
});

test('numeric controls quantize, clamp and persist across reopening', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create();
    for(const [key,raw,value] of [[keys[0],'1012',1000],[keys[1],'-25',0],[keys[2],'743',750]]) {
        const input=o.input(key,'number');input.value=raw;input.emit('change');
        assert.equal(Number(input.value),value); assert.equal(Number(o.input(key).value),value);
    }
    for(const key of keys){const input=o.input(key,'number');assert.equal(input.max,'3000');input.value='99999';input.emit('change');}
    assert.deepEqual(values(o),[3000,3000,3000]);
    o.destroy();assert.deepEqual(values(h.create()),[3000,3000,3000]);
});

test('global and scoped edits synchronize while preserving main and split overrides', () => {
    const h=load({h3d_bg_cameraMode:'stable',h3d_bg_main_stableCameraStartBeforeMs:'400'}),main=h.create(),split=h.create(1);
    main.input(keys[0],'number').value='600';main.input(keys[0],'number').emit('change');
    assert.deepEqual(h.writes,[['h3d_bg_main_'+keys[0],'600']]);
    h.window.h3dBgSetStableCameraArriveAfterMs(200);
    assert.equal(main.input(keys[1]).value,'200');assert.equal(split.input(keys[1]).value,'200');
    split.input(keys[1],'number').value='75';split.input(keys[1],'number').emit('change');
    h.window.h3dBgSetStableCameraArriveAfterMs(100);
    assert.equal(split.input(keys[1]).value,'75');assert.equal(main.input(keys[1]).value,'100');
    assert.equal(h.data.get('h3d_bg_panel1_'+keys[1]),'75');
});

test('numeric Enter and blur commit once without losing unfinished edits to unrelated changes', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),number=o.input(keys[0],'number');
    number.value='600';number.emit('input');h.window.h3dBgSetStableCameraArriveAfterMs(100);
    assert.equal(number.value,'600');assert.equal(h.api.read('main',keys[0]),700);
    number.emit('keydown',{key:'Enter'});number.emit('change');number.emit('blur');
    assert.deepEqual(h.writes,[[stored(keys[1]),'100'],[stored(keys[0]),'600']]);
    number.value='800';number.emit('input');number.emit('blur');number.emit('change');
    assert.equal(h.writes.length,3);assert.equal(h.writes.at(-1)[1],'800');
});

test('overlay controls protect transport shortcuts and Escape restores focus', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),events=[];
    h.document.addEventListener('keydown',e=>events.push(e.key));h.document.addEventListener('keyup',e=>events.push(e.key));
    o.toggle.click();
    for(const el of [o.input(keys[0]),o.input(keys[1],'number'),o.query('[data-camera-setting="stableCameraPreset"]')]) {
        for(const key of ['ArrowLeft','ArrowRight',' ','Enter','Tab']){el.emit('keydown',{key});el.emit('keyup',{key});}
    }
    assert.deepEqual(events,[]);
    assert.equal(o.input(keys[0]).emit('keydown',{key:'Escape'}).defaultPrevented,true);
    assert.equal(o.panel.hidden,true);assert.equal(h.document.activeElement,o.toggle);
    h.document.body.emit('keydown',{key:' '});assert.deepEqual(events,[' ']);
});

test('both Stable views share controls and Follow-off prevents edits', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create();
    const preset=o.query('[data-camera-setting="stableCameraPreset"]'),follow=o.query('[data-camera-setting="stableCameraFollow"]');
    preset.value='angled';preset.emit('change');follow.checked=false;follow.emit('change');
    const count=h.writes.length;
    for(const key of keys){const input=o.input(key,'number');assert.equal(input.disabled,true);input.value='1000';input.emit('change');}
    assert.equal(h.writes.length,count);follow.checked=true;follow.emit('change');
    assert.deepEqual(values(o),[700,0,500]);assert.equal(preset.value,'angled');
    o.toggle.click();h.window.h3dBgSetCameraMode('steady');assert.equal(o.root.hidden,true);assert.equal(o.panel.hidden,true);
    h.window.h3dBgSetCameraMode('stable');assert.equal(o.root.hidden,false);assert.deepEqual(values(o),[700,0,500]);
});

test('blocked storage keeps scoped live settings and teardown removes subscriptions', () => {
    const h=load({h3d_bg_cameraMode:'stable'},{blocked:true}),initial=h.api.listeners.size,main=h.create(),split=h.create(2);
    split.input(keys[0],'number').value='800';split.input(keys[0],'number').emit('change');
    assert.equal(h.api.read('panel2',keys[0]),800);assert.equal(h.api.read('main',keys[0]),700);assert.deepEqual(h.writes,[]);
    split.destroy();split.destroy();assert.equal(h.api.listeners.size,initial+1);
    split.input(keys[0],'number').value='900';split.input(keys[0],'number').emit('change');
    assert.equal(h.create(2).input(keys[0]).value,'800');main.destroy();assert.equal(h.document.body.contains(main.root),false);
    assert.deepEqual(h.errors,[]);
});

const exactTiming={mode:'direct',fallbackReason:null,requestedStartBeforeMs:600,requestedArriveAfterMs:100,
    nominalStart:9.3,nominalEnd:10,start:9.4,end:10.1,appliedLeadMs:600,appliedDurationMs:700,
    appliedLatenessMs:100,actualArriveAfterMs:100,waypointCount:1};

test('readout distinguishes exact timing from retained crowded-sequence handling', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),field=name=>o.query(`[data-camera-timing-field="${name}"]`);
    o.setTiming(exactTiming,{decision:'follow',reason:'lasting-lane'},'scheduled');o.toggle.click();
    assert.equal(field('starts').textContent,'Starts 600 ms before the first lane.');
    assert.equal(field('travel').textContent,'Travel: 700 ms through 1 lane.');
    assert.equal(field('lateness').textContent,'Next lane reached 100 ms after it begins.');
    assert.equal(field('limit').textContent,'Exact start and arrival applied.');
    assert.equal(field('departure').textContent,'Song departure: 9.400 s.');
    assert.match(field('arrival').textContent,/10.100 s/);
    for(const [reason,word] of [['progressive-journey','short lanes'],['previous-lane','preceding lane'],['adjacent-journey-overlap','overlaps']]) {
        o.setTiming({...exactTiming,mode:'chart-paced-fallback',fallbackReason:reason},
            {decision:'hold',reason:'repeated-cycle',home:{firstFret:5}},'local-rejoin');
        assert.match(field('limit').textContent,new RegExp(word));assert.match(field('limit').textContent,/do not apply here yet/);
        assert.match(field('decision').textContent,/Hold lane 5: matching repeated short cycles/);
        assert.match(field('mode').textContent,/smoothly rejoining/);
    }
    o.setTiming(null);assert.match(field('starts').textContent,/No current or upcoming/);
    for(const name of ['requested','travel','lateness','limit','departure','arrival'])assert.equal(field(name).textContent,'');
    assert.deepEqual(h.writes,[]);
});

test('controls precede diagnostics and exact duration is a readout, not another input', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),report=o.query('[data-camera-timing]'),details=o.query('[data-camera-timing-details]');
    const fieldset=report.parentNode,index=fieldset.children.indexOf(report);
    for(const key of keys){let row=o.input(key);while(row.parentNode!==fieldset)row=row.parentNode;assert.ok(fieldset.children.indexOf(row)<index);}
    assert.equal(details.tagName,'DETAILS');assert.equal(details.getAttribute('open'),null);
    assert.equal(o.query('[data-camera-duration]').tagName,'P');
    assert.equal(o.root.querySelectorAll('[data-camera-input="number"]').length,3);
});

test('warm frames and closed panels do not rewrite diagnostics', () => {
    const h=load({h3d_bg_cameraMode:'stable'}),o=h.create(),lines=o.root.querySelectorAll('[data-camera-timing-field]');
    const writes=()=>lines.reduce((n,l)=>n+l.textWrites,0),decision={decision:'follow',reason:'lasting-lane'};
    const closed=writes();o.setTiming(exactTiming,decision,'scheduled');assert.equal(writes(),closed);
    o.toggle.click();const open=writes();assert.ok(open>closed);
    for(let i=0;i<120;i++)o.setTiming(exactTiming,decision,'scheduled');assert.equal(writes(),open);
    o.toggle.click();o.setTiming({...exactTiming,mode:'chart-paced-fallback',fallbackReason:'adjacent-journey-overlap'},decision,'paused');
    assert.equal(writes(),open);o.toggle.click();assert.match(o.query('[data-camera-timing-field="limit"]').textContent,/overlaps/);
    assert.match(o.query('[data-camera-timing-field="mode"]').textContent,/Paused/);
    const final=writes();o.destroy();o.setTiming(exactTiming);assert.equal(writes(),final);assert.deepEqual(h.writes,[]);
});
