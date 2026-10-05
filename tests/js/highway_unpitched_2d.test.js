const {test} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

const modulePromise = import(pathToFileURL(path.join(__dirname, '../../static/js/highway-draw.js')).href);
function state() {
    const labels=[], coordinates=[];
    const ctx = new Proxy({fillText(text,x,y){ labels.push({text,x,y}); },
        moveTo(x,y){coordinates.push([x,y]);}, lineTo(x,y){coordinates.push([x,y]);},
        fillRect(x,y,w,h){coordinates.push([x,y],[x+w,y+h]);},
        measureText(text){return {width:String(text).length*8};}}, {
        get(t,k){return k in t?t[k]:(()=>{});}
    });
    return {ctx,canvas:{width:900,height:900},labels,coordinates,
        currentTime:0, displayMaxFret:24, STRING_COLORS:Array(6).fill('#f00'),
        STRING_DIM:Array(6).fill('#300'),STRING_BRIGHT:Array(6).fill('#fff'),
        _xfNotes:null,_filteredNotes:null,_xfChords:null,_filteredChords:null,_xfChordTemplates:null,
        notes:[],chords:[],chordTemplates:[],_chordRenderInfo:new WeakMap(),
        _frameMismatchWarned:new Set(),_chordFretLineNotes:[],_inverted:false};
}
function onScreen(s) {
    for (const [x,y] of s.coordinates) {
        assert.ok(Number.isFinite(x)&&Number.isFinite(y));
        assert.ok(x>=-100&&x<=1000, `offscreen x=${x}`);
    }
    assert.ok(!s.labels.some(l=>String(l.text).includes('127')));
}

test('standalone unpitched mute and sustain use the existing unfretted lane',async()=>{
    const {drawNotes,drawSustains}=await modulePromise;
    const s=state(), n=Object.freeze({t:0,s:2,f:127,mt:true,sus:1});s.notes=[n];
    drawSustains(s,900,900); drawNotes(s,900,900);
    assert.ok(s.labels.some(l=>l.text==='X'&&l.x===450));
    onScreen(s); assert.equal(n.f,127); assert.equal(n.mt,true);
});

test('mixed and ghost-muted chords keep finite frames and no fabricated fingering',async()=>{
    const {drawChords}=await modulePromise;
    for (const mixed of [true,false]) {
        const s=state();
        const mute=Object.freeze({s:2,f:127,mt:true,ghost:true,sus:0});
        const ch={t:0,id:0,notes:mixed?[{s:1,f:5,sus:0},mute]:[mute,{...mute,s:3}]};
        s.chords=[ch];s.chordTemplates=[{name:'',frets:mixed?[-1,5,127,-1,-1,-1]:[-1,-1,127,127,-1,-1]}];
        drawChords(s,900,900);onScreen(s);
        assert.equal(s._chordRenderInfo.get(ch).baseFret,mixed?5:0);
        assert.ok(s.labels.some(l=>l.text==='(X)'));
        assert.ok(s._chordFretLineNotes.every(n=>n.f!==127));
        assert.equal(mute.f,127);
    }
});

test('all-muted frames inherit the established frame rather than sentinel fret 127',async()=>{
    const {drawChords}=await modulePromise;
    const s=state();
    const a={t:0,id:0,notes:[{s:1,f:5},{s:2,f:7}]};
    const b={t:.5,id:1,notes:[{s:2,f:127,mt:true},{s:3,f:127,mt:true}]};
    s.chords=[a,b];drawChords(s,900,900);onScreen(s);
    assert.equal(s._chordRenderInfo.get(b).baseFret,5);
});
