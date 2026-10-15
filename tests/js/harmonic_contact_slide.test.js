const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
function note() {return {t:24,s:3,f:4,sus:7.75,sl:7,slide_interval:{start:7.5,end:7.75},
    harmonic_changes:{version:1,events:[{start:2,end:7.75,source_id:'contact',
        target:{kind:'artificial',node:5,interval:24,policy:'harmonic'}}]}};}
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
function extract(name) {
    const start=source.indexOf('function '+name+'('),open=source.indexOf('{',start);let depth=0;
    assert.ok(start>=0,name);
    for(let i=open;i<source.length;i++) {
        if(source[i]==='{')depth++;
        else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
    }
}

test('contact plus slide follows chart time, independent of sampling, seeks, loops and playback speed',async()=>{
    const h=await import('../../static/js/harmonic-contacts.js');
    for(const target of [2,7,24])for(const duration of [.000002,.01,.25,2]) {
        const n=note();n.sl=target;n.sus=7.5+duration;n.slide_interval.end=n.sus;
        n.harmonic_changes.events[0].end=n.sus;
        const before=JSON.stringify(n),event=h.harmonicContacts(n)[0];assert.ok(event);
        const points=[0,2,7.5,7.5+duration/2,n.sus];
        for(const speed of [.5,1,1.5,2])for(const elapsed of [...points,...points.toReversed(),...points]) {
            const chartElapsed=(elapsed/speed)*speed;
            const p=Math.max(0,Math.min(1,(chartElapsed-7.5)/duration));
            const expected=4+(target-4)*Math.sin(p*Math.PI/2)**3;
            assert.ok(Math.abs(h.harmonicContactFret(n,chartElapsed)-expected)<1e-8);
        }
        assert.equal(h.harmonicContactLabel(n,event),'AH 9','contact onset remains before the slide');
        assert.equal(h.harmonicContactLabel(n,event,n.sus),`AH ${target+5}`);
        assert.equal(h.harmonicAttackDeadline(n,n.t,.2,8),26,'only original picked attack');
        assert.equal(h.harmonicContactAt(n,n.sus+.01),null);
        assert.equal(JSON.stringify(n),before);
    }
});

test('unsupported or malformed contact slides cannot silently invent motion',async()=>{
    const h=await import('../../static/js/harmonic-contacts.js');
    const changes=[{sl:0},{sl:25},{sl:4},{sl:'7'},{sl:NaN},{sl:7,slu:9},
        {f:0},{f:25},{slide_interval:null},{slide_interval:{start:2,end:7.75}},
        {slide_interval:{start:NaN,end:7.75}},{slide_interval:{start:7.5,end:8}},
        {slide_interval:{start:7.5,end:7.75,extra:true}},
        ...['ho','po','vb','tr','bn','bt','whammy','slide_out'].map(k=>({[k]:true})),
        ...['bnv','vibrato_marks','tremolo_marks','slide_in_marks','slide_out_marks','pick_scrape_marks']
            .map(k=>({[k]:[{}]}))];
    for(const patch of changes)assert.deepEqual(h.harmonicContacts({...note(),...patch}),[],JSON.stringify(patch));
    const legacy=note();delete legacy.sl;delete legacy.slide_interval;
    assert.equal(h.harmonicContacts(legacy).length,1);
    assert.equal(h.harmonicContactFret(legacy,7.7),4);
});

test('2D contact outline, colored sustain and chord ownership share the moving position',async()=>{
    const {drawHarmonicContact2D}=await import('../../static/js/highway-draw.js');
    const {project}=await import('../../static/js/highway-geometry.js');
    const {fretX}=await import('../../static/js/highway-state-primitives.js');
    for(const chord of [false,true])for(const now of [24,30,31.5,31.625,31.75,30]) {
        const n=note();if(chord)delete n.t;
        const calls=[],ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
        const state={currentTime:now,ctx,displayMaxFret:24};
        drawHarmonicContact2D(state,1000,600,n,24);
        assert.ok(calls.every(c=>c.slice(1).every(x=>typeof x!=='number'||Number.isFinite(x))));
        if(now===31.75) {assert.equal(calls.length,0);continue;}
        assert.equal(calls.filter(c=>c[0]==='fill').length,1,'one moving sustain');
        assert.equal(calls.filter(c=>c[0]==='strokeRect').length,now<26?1:0,'no fresh picked gem at slide start');
        const elapsed=Math.max(2,now-24),p=project(Math.max(26,now)-now);
        const weight=Math.sin(Math.max(0,Math.min(1,(elapsed-7.5)/.25))*Math.PI/2)**3;
        const expectedX=fretX(state,4+3*weight,p.scale,1000)-Math.max(2,6*p.scale);
        assert.ok(calls.some(c=>c[0]==='moveTo'&&Math.abs(c[1]-expectedX)<1e-8),
            JSON.stringify({chord,now,expectedX,moves:calls.filter(c=>c[0]==='moveTo')}));
    }
});

test('2D early sustain remains visible when delayed contact is beyond the view',async()=>{
    const {drawHarmonicContact2D}=await import('../../static/js/highway-draw.js');
    const n=note();n.sus=100;n.slide_interval={start:99,end:100};
    Object.assign(n.harmonic_changes.events[0],{start:90,end:100});
    const calls=[],ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
    drawHarmonicContact2D({currentTime:24,ctx,displayMaxFret:24},1000,600,n);
    assert.equal(calls.filter(c=>c[0]==='fill').length,1);
    assert.equal(calls.filter(c=>c[0]==='strokeRect').length,0);
    assert.ok(calls.length<20,'bounded work even for long holds');
});

test('2D note/chord sustain owners draw exactly one body and keep ordinary brightness',async()=>{
    const {drawSustains}=await import('../../static/js/highway-draw.js');
    for(const chord of [false,true]) {
        const n=note(),calls=[],values={};
        const ctx=new Proxy(values,{get:(obj,key)=>key in obj?obj[key]:(...args)=>calls.push([key,...args]),
            set:(obj,key,value)=>{obj[key]=value;calls.push(['set',key,value]);return true;}});
        const state={currentTime:31.6,ctx,displayMaxFret:24,_xfNotes:null,_filteredNotes:null,
            _xfChords:null,_filteredChords:null,notes:chord?[]:[n],chords:chord?[{t:n.t,notes:[n]}]:[]};
        if(chord)delete n.t;
        drawSustains(state,1000,600);
        assert.equal(calls.filter(c=>c[0]==='fill').length,1);
        const firstFill=calls.findIndex(c=>c[0]==='fill');
        assert.deepEqual(calls.slice(0,firstFill).filter(c=>c[0]==='set'&&c[1]==='globalAlpha').at(-1),
            ['set','globalAlpha',1]);
    }
});

test('2D held note follows its contact sustain without changing attack identity',async()=>{
    const h=await import('../../static/js/harmonic-contacts.js');
    const {fretX}=await import('../../static/js/highway-state-primitives.js');
    const drawSource=fs.readFileSync(path.join(__dirname,'../../static/js/highway-draw.js'),'utf8');
    const start=drawSource.indexOf('export function drawNotes('),end=drawSource.indexOf('export function drawStrumGroups(',start);
    const body=drawSource.slice(start,end).replace('export function','function');
    const calls=[],make=new Function('harmonicContacts','harmonicContactSlide','harmonicContactFret','fretX','calls',`
        const VISIBLE_SECONDS=3,bsearch=(rows,t)=>rows.findIndex(n=>n.t>=t)<0?rows.length:rows.findIndex(n=>n.t>=t);
        const isPickScrape=()=>false,playingFret2D=n=>n.f,drawUnisonBends=()=>{};
        const drawNote=(...args)=>calls.push(args),project=()=>null;
        ${body};return drawNotes;`);
    const draw=make(h.harmonicContacts,h.harmonicContactSlide,h.harmonicContactFret,fretX,calls);
    const n=note(),state={currentTime:31.625,displayMaxFret:24,_xfNotes:null,_filteredNotes:null,notes:[n]};
    draw(state,1000,600);
    assert.equal(calls.length,1);assert.equal(calls[0][7],4);assert.equal(calls[0][8],n);
    assert.ok(Math.abs(calls[0][3]-fretX(state,4+3*Math.SQRT1_2**3,1,1000))<1e-8);
});

test('3D contact outline uses the existing slide path in uniform/log and mirrored views',async()=>{
    const h=await import('../../static/js/harmonic-contacts.js');
    const make=new Function('fretMid','notePositionX',
        ['slideTrailEnd','targetedSlideInterval','appendTargetedSlideContourTimes','slideOffsetWorldX'].map(extract).join('\n')+
        ';return {offset:slideOffsetWorldX,samples:appendTargetedSlideContourTimes};');
    for(const log of [false,true])for(const mirrored of [false,true]) {
        const pos=f=>(mirrored?-1:1)*(log?180*(1-2**(-f/12)):f*6);
        const api=make(pos,n=>pos(n.f)),n=note(),samples=[];
        api.samples(n,24,31.75,samples);assert.equal(samples.length,8);
        for(const elapsed of [0,2,7.5,7.625,7.75]) {
            const weight=(h.harmonicContactFret(n,elapsed)-n.f)/(n.sl-n.f);
            assert.ok(Math.abs(api.offset(n,n.t+elapsed)-(pos(n.sl)-pos(n.f))*weight)<1e-8);
        }
    }
    const ribbon=extract('slideRibbonUpdatePair');
    assert.match(ribbon,/sustainTrailCenterXAt/);
    assert.match(ribbon,/contactInset=contact && Tk>=n.t\+contact.start/);
    assert.match(source,/_scrChordNote\.harmonic_changes = cn\.harmonic_changes/);
    assert.match(source,/_scrChordNote\.slide_interval = cn\.slide_interval/);
});
