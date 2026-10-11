'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8').replace(/\r\n/g,'\n');
const updateStart=source.indexOf('        function update(bundle)');
const helperName='accumulateFrameNoteState';
// Frozen inline frame-state block from Core 8ec0096ca5007a38a8eae5019b6032c655aca7e5.
// This reference is independent of the extracted production helper.
const body=String.raw`            // Compute sustain / anticipation / fret heat / per-string glow.
            // Use lowerBoundT to skip notes far in the past (>30s sustain is
            // unrealistic); break once notes are >2s ahead (nothing beyond
            // contributes to fretHeat/anticipation/strGlow).
            if (notes) {
                const _fsLo = lowerBoundT(notes, now - 30);
                for (let _ni = _fsLo; _ni < notes.length; _ni++) {
                    const n = notes[_ni];
                    if (!validString(n.s) || !isRenderableNote(n)) continue;
                    const dt = n.t - now;
                    if (dt > 2.0) break;
                    const susEnd = n.t + (n.sus || 0);
                    if (dt > 0 && dt < 0.6)
                        noteState.stringAnticipation[n.s] = Math.max(noteState.stringAnticipation[n.s], 1 - dt / 0.6);
                    if (isPlayableFret(n.f) && n.f > 0 && !isUnpitchedMute(n)) {
                        if (now >= n.t && now <= susEnd) noteState.fretHeat[n.f] = 1;
                        else if (n.t > now) noteState.fretHeat[n.f] = Math.max(noteState.fretHeat[n.f], Math.max(0, 1 - dt / 2));
                    }
                    if (now >= n.t && now <= susEnd) noteState.stringSustain[n.s] = true;
                    const sustained = dt < 0 && (n.sus || 0) > 0 && now <= susEnd;
                    const hitDist = Math.abs(dt);
                    if (hitDist < 0.15 || sustained) {
                        const hitFade = sustained ? 0.7 : (1 - hitDist / 0.15);
                        noteState.strGlow[n.s] = Math.max(noteState.strGlow[n.s], 1.0 + hitFade * 1.5);
                    }
                }
            }
            if (chords) {
                // Skip chords further than 30s in the past (covers any sustained chord).
                const _cfsLo = lowerBoundT(chords, now - 30);
                for (let _cni = _cfsLo; _cni < chords.length; _cni++) {
                    const ch = chords[_cni];
                    if (!ch.notes) continue;
                    const dt = ch.t - now;
                    if (dt > 2.0) break;
                    const chordNotes = filterValidNotes(ch.notes);
                    if (chordNotes.length === 0) continue;
                    let maxSus = 0;
                    for (const n of chordNotes) if ((n.sus || 0) > maxSus) maxSus = n.sus;
                    const susEnd = ch.t + maxSus;
                    for (const cn of chordNotes) {
                        if (dt > 0 && dt < 0.6)
                            noteState.stringAnticipation[cn.s] = Math.max(noteState.stringAnticipation[cn.s], 1 - dt / 0.6);
                        if (isPlayableFret(cn.f) && cn.f > 0 && !isUnpitchedMute(cn)) {
                            if (now >= ch.t && now <= susEnd) { noteState.fretHeat[cn.f] = 1; continue; }
                            if (ch.t > now) noteState.fretHeat[cn.f] = Math.max(noteState.fretHeat[cn.f], Math.max(0, 1 - dt / 2));
                        }
                    }
                    if (now >= ch.t && now <= susEnd)
                        for (const cn of chordNotes) noteState.stringSustain[cn.s] = true;
                    const sustained = dt < 0 && maxSus > 0 && now <= susEnd;
                    const hitDist = Math.abs(dt);
                    if (hitDist < 0.15 || sustained) {
                        const hitFade = sustained ? 0.7 : (1 - hitDist / 0.15);
                        for (const cn of chordNotes) {
                            noteState.strGlow[cn.s] = Math.max(noteState.strGlow[cn.s], 1.0 + hitFade * 1.5);
                        }
                    }
                }
            }

`;

// The chosen actual helper functions contain no brace characters in strings/comments.
function productionFunction(name) {
  const at = source.indexOf(`function ${name}(`);
  assert(at >= 0, name);
  let brace = source.indexOf('{', at), depth = 1, i = brace + 1;
  for (; depth && i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  assert.equal(depth, 0, name);
  return source.slice(at, i);
}
const dependencies = ['lowerBoundT', 'isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute',
  'isRenderableNote', 'validString', 'filterValidNotes'].map(productionFunction).join('\n');
const helper=productionFunction('accumulateFrameNoteState');
const callStart=source.indexOf('            pbBeg(1);\n',updateStart);
const callEnd=source.indexOf('            pbEnd(1);',callStart)+'            pbEnd(1);'.length;
const handoff=source.slice(callStart,callEnd);
const stateStart = source.indexOf('            const noteState = {', updateStart);
const stateEnd = source.indexOf('\n            };', stateStart) + '\n            };'.length;
const stateDeclaration = source.slice(stateStart, stateEnd);
assert(stateStart > updateStart && stateEnd < callStart);
let fixtureSerial = 0;
const make = (variant, nStr = 6, events = []) => {
  const wrapperName = variant === 'inline' ? 'frameStateInline' : 'frameStateExtracted';
  const compiled = new Function('initialStrings', 'console', 'events', `
    const NFRETS=24, S_COL=new Array(8);
    let nStr=initialStrings, _oobStringWarned=false, _filterValidNotesCache=new WeakMap();
    const _scrStringSustain=new Array(8).fill(false);
    const _scrStringAnticipation=new Array(8).fill(0);
    const _scrFretHeat=new Array(25).fill(0);
    const _scrStrGlow=new Array(8).fill(.5);
    const _scrAccentFillBoost=new Array(8).fill(0);
    const pbBeg=id=>events.push(['begin',id]), pbEnd=id=>events.push(['end',id]);
    ${dependencies}
    ${variant === 'extracted' ? helper : ''}
    function ${wrapperName}(notes,chords,now) {
      _scrStringSustain.fill(false,0,nStr); _scrStringAnticipation.fill(0,0,nStr);
      _scrFretHeat.fill(0); _scrStrGlow.fill(.5,0,nStr); _scrAccentFillBoost.fill(0,0,nStr);
      ${stateDeclaration}
      ${variant === 'inline' ? 'pbBeg(1);'+body+'pbEnd(1);' : handoff}
    }
    return { fn:${wrapperName}, helper:${variant === 'extracted' ? helperName : 'null'},
      snapshot:()=>({stringSustain:_scrStringSustain.slice(),stringAnticipation:_scrStringAnticipation.slice(),
        fretHeat:_scrFretHeat.slice(),strGlow:_scrStrGlow.slice(),accentFillBoost:_scrAccentFillBoost.slice()}),
      setStrings:value=>{nStr=value;_filterValidNotesCache=new WeakMap();},
      helpers:{lowerBoundT,isPlayableFret,isPlainDeadNote,isUnpitchedMute,isRenderableNote,validString,filterValidNotes}
    };
    // Unique compilation prevents custom-iterator parity cases or NeverOptimizeFunction
    // in an earlier sensitivity arm from sharing feedback/optimization-disable state.
    //# sourceURL=frame-state-${variant}-fixture-${++fixtureSerial}.js
  `);
  return compiled(nStr, {warn: s => events.push(['warning', s])}, events);
};

let checks = 0;
function compare(label, scenario, strings = 6) {
  const output = ['inline', 'extracted'].map(variant => {
    const events = [], h = make(variant, strings, events);
    let error = null;
    try { scenario(h, events); } catch (e) { error = [e.name, e.message]; }
    return {state:h.snapshot(), events, error};
  });
  assert.deepEqual(output[1], output[0], label);
  checks++;
  return output[0];
}
function parity() {
  const note = (t, extra = {}) => ({t,s:0,f:3,sus:0,...extra});
  for (const strings of [6,7,8]) {
    for (const boundary of [-30, -0.15, 0, 0.15, 0.6, 2]) {
      for (const epsilon of [-1e-10,0,1e-10]) {
        const dt = boundary + epsilon;
        compare(`boundary ${strings}/${dt}`, h => {
          const notes = [note(100 + dt, {sus:30,s:strings-1})];
          const chords = [{t:100+dt,notes:[note(0,{s:strings-1,sus:30}),note(0,{s:0,f:0,sus:0})]}];
          h.fn(notes,chords,100);
        }, strings);
      }
    }
  }
  const properties = [
    {}, {f:0}, {f:-0}, {f:24}, {f:25}, {f:127}, {f:127,mt:true}, {f:3,mt:true},
    {f:3,mt:true,hm:true}, {f:3,mt:true,harmonic_target:7}, {f:3,mt:true,harmonic_changes:[1]},
    {f:3,mt:true,sl:5}, {f:3,mt:true,pick_scrape_marks:[1]}, {f:NaN}, {f:Infinity}, {f:'3'},
    {s:-1}, {s:6}, {s:7}, {s:8}, {s:'0'}, {s:0.5}, {s:NaN}, {s:Infinity},
    {sus:-0}, {sus:NaN}, {sus:Infinity}, {sus:-2}, {sus:'2'},
  ];
  for (let i=0;i<properties.length;i++) for (const now of [99.9,100,100.1,102]) {
    compare(`semantics ${i}/${now}`, h => h.fn([note(100,properties[i])],
      [{t:100,notes:[note(0,{sus:.05}),note(0,{s:1,f:5,sus:2}),note(0,properties[i])]}],now));
  }
  compare('null empty and scalar time cases', h => {
    for (const now of [-Infinity, Infinity, NaN, -0]) {
      h.fn(null,null,now); h.fn([],[],now); h.fn([note(0)], [{t:0,notes:[note(0)]}],now);
    }
  });
  compare('cache reset and mutable chart semantics', h => {
    const members = [note(0,{s:6,sus:2}),note(0,{s:0,f:3})], chord={t:100,notes:members}, notes=[note(100)];
    h.fn(notes,[chord],100); h.setStrings(7); h.fn(notes,[chord],100.1);
    members[0].f=8; members[1].sus=3; members.push(note(0,{s:2,f:9})); notes[0].t=101;
    h.fn(notes,[chord],100.2); h.setStrings(6); h.fn(notes,[chord],100.3);
  });
  const heat = compare('maximum sustain applies to all chord members', h => h.fn(null,
    [{t:100,notes:[note(0,{s:0,f:3,sus:.1}),note(0,{s:1,f:5,sus:2})]}],101)).state;
  assert.equal(heat.stringSustain[0],true);assert.equal(heat.stringSustain[1],true);
  assert.equal(heat.fretHeat[3],1);assert.equal(heat.fretHeat[5],1);
  for (const failure of ['none','sus','fret']) {
    const out = compare('custom iterator/getter ordering ' + failure, (h, events) => {
      let visits=0;
      const members=[note(0,{s:0,sus:2}),note(0,{s:1,sus:1})].map((n,i)=>new Proxy(n,{get(t,k,r){
        if(typeof k==='string')events.push(['get',i,k]);
        if(failure==='sus'&&k==='sus'&&++visits===2)throw new Error('sus failure');
        return Reflect.get(t,k,r);
      }}));
      members[Symbol.iterator]=function(){
        events.push(['iterator']);let i=0;
        return {next(){events.push(['next',i]);if(failure==='fret'&&events.filter(x=>x[0]==='iterator').length===2&&i===1)
          return {done:false,value:new Proxy(members[i++],{get(t,k,r){if(k==='f')throw new Error('fret failure');return Reflect.get(t,k,r);}})};
          return i<members.length?{done:false,value:members[i++]}:{done:true};},
          return(){events.push(['return']);return {done:true};}};
      };
      h.fn(null,[{t:100,notes:members}],100.1);
    });
    if(failure!=='none') { assert(out.error);assert(out.events.some(x=>x[0]==='return')); }
  }
  compare('nested getter call retains same shared-array effects', (h, events) => {
    let nested=false;
    const n=note(100);
    // Object spread would evaluate an accessor, so define it on the actual input.
    nested=false;Object.defineProperty(n,'sus',{get(){if(!nested){nested=true;events.push(['enter']);h.fn([note(100,{s:4,f:12,sus:2})],null,100.1);events.push(['exit',h.snapshot()]);}return 1;}});
    h.fn([n],null,100.1);
  });
  compare('invalid note throws at the same read', h=>h.fn([null],null,100));
  return checks;
}


test('frame-state helper and call preserve the frozen block and profiler boundaries',()=>{
  const actualBody=helper.slice(helper.indexOf('\n')+1,helper.lastIndexOf('        }'));
  assert.equal(actualBody,body);
  assert.equal(handoff,'            pbBeg(1);\n            accumulateFrameNoteState(notes, chords, now, noteState);\n            pbEnd(1);');
  assert(!/\b(return|this|arguments|await|yield)\b/.test(body));
});
test('178 frame-state cases preserve numerical state, cache/getter/iterator and nested-call semantics',()=>{
  assert.equal(parity(),178);
});
