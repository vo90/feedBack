const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../plugins/highway_3d/screen.js'),'utf8');
const helpers=source.slice(source.indexOf('    function naturalNode('),source.indexOf('    /** World-space width'));
for(const log of [false,true])test(`touch positions use fret wires (${log?'log':'uniform'})`,()=>{
    const h=new Function(`const fretX=f=>${log?'100*(1-2**(-f/12))':'10*f'};
        const fretMid=f=>(fretX(f-1)+fretX(f))/2; ${helpers}
        return {naturalNode,notePositionX,harmonicLabel,fretX,fretMid};`)();
    const n=Object.freeze({f:3,hm:true,hn:3.2,hps:31});
    assert.equal(h.notePositionX(n),h.fretX(3.2));
    assert.ok(h.notePositionX(n)>h.fretX(3)&&h.notePositionX(n)<h.fretX(4));
    assert.equal(h.harmonicLabel(n),'3.2');
    assert.equal(h.harmonicLabel({...n,hn:3.1999999999999993}),'3.2');
    assert.equal(h.notePositionX({f:3,hm:true}),h.fretMid(3));
    assert.equal(n.f,3);
});
test('chord scratch resets both fields and source identity stays separate',()=>{
    assert.match(source,/_scrChordNote.hn = cn.hn/);
    assert.match(source,/_scrChordNote.hps = cn.hps/);
    assert.match(source,/const xNote = n => \(_leftyCached \? -1 : 1\) \* notePositionX\(n\)/);
});
test('fretted harmonic contact is guidance, not another fret position',()=>{
    const h=new Function(`const fretX=f=>10*f; const fretMid=f=>10*f-5; ${helpers}
        return {harmonicContactLabel,notePositionX,harmonicLabel};`)();
    for(const [kind,label] of [['artificial','AH'],['tapped','TH']]) {
        const n=Object.freeze({f:17,harmonic_target:{kind,node:14.7,interval:34,policy:'harmonic'}});
        assert.equal(h.harmonicContactLabel(n),label+' 31.7');
        assert.equal(h.notePositionX(n),165);
        assert.equal(h.harmonicLabel(n),17);
    }
    for(const kind of ['pinch','semi','feedback'])
        assert.equal(h.harmonicContactLabel({f:7,harmonic_target:{kind,node:12}}),'');
});
