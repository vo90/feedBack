const {test} = require('node:test');
const assert = require('node:assert/strict');
const {cameraApi} = require('../helpers/highway_camera_harness.cjs');
const {compileTandemRuns} = require('../../plugins/highway_3d/src/camera-tapping.mjs');
const api = cameraApi();
const row = (time, fret, last = fret + 3) => ({time, firstFret:fret, lastFret:last,
    minX:(fret-1)*10, maxX:last*10, x:(fret+1)*10, preferred:(fret+1)*10});
const notes = (frets, start=1, spacing=.1) => frets.map((f,index)=>({t:start+index*spacing,s:3,f,tp:true}));
function compile(frets, change=()=>{}) {
    const chart={rows:[row(0,5),row(1,9,17),row(5,14)],notes:notes(frets),stringCount:6};
    change(chart);
    const evidence=api.hwyCompileCameraEvidence(chart.rows,{context:chart});
    return {chart,evidence,areas:api.hwyCompileTappingAreas(evidence,chart)};
}
const summary=area=>[area.start,area.end,area.firstFret,area.lastFret];

test('two exact all-tap cycles centre the played area, including tap-first rotations and internal returns',()=>{
    for(const cycle of [[9,17],[17,9],[9,12,17],[17,12,9],[9,12,9,17],[9,9,17,9,17,17]]) {
        const result=compile([...cycle,...cycle]);
        assert.deepEqual(result.areas.map(summary),[[1,5,9,17]],JSON.stringify(cycle));
        for(const threshold of [0,200,500,3000]) {
            const stops=api.hwyApplyCameraThreshold(result.evidence,{excursionThreshold:threshold});
            const focused=api.hwyApplyTappingAreas(stops,result.areas,{xFret:f=>10*f});
            assert.equal(focused.find(stop=>stop.kind==='tapping-area').x,125);
        }
    }
});

test('an irregular prefix cannot hide the repeated all-tap figure, and an unrelated suffix ends it',()=>{
    const result=compile([11,13,9,12,17,9,12,17,9,14]);
    assert.deepEqual(result.areas.map(summary),[[1.2,1.9,9,17]]);
});

test('a single copy, incomplete second copy, narrow repetition and advancing runs do not qualify',()=>{
    for(const frets of [[9,12,17],[9,12,17,9,12],[9,12,9,12],
        [9,10,11,12,13,14,15,16,17],[9,14,10,15,11,16,12,17],[17,12,16,11,15,10,14,9]]) {
        assert.deepEqual(compile(frets).areas,[],JSON.stringify(frets));
    }
});

test('all-tap proof still matches strings and techniques and requires every chord member to be tapped',()=>{
    for(const change of [chart=>chart.notes[4].s=2,chart=>chart.notes[4].ho=true,
        chart=>{chart.chords=chart.notes.map(({t,...note})=>({t,notes:[note,{s:2,f:12}]}));chart.notes=[];}]) {
        assert.deepEqual(compile([9,12,17,9,12,17],change).areas,[]);
    }
    const chord=compile([9,12,17,9,12,17],chart=>{
        chart.chords=chart.notes.map(({t,...note})=>({t,notes:[note]}));chart.notes=[];
    });
    assert.deepEqual(chord.areas.map(summary),[[1,5,9,17]]);
    const wideChord=compile([9,9,9,9],chart=>{
        chart.chords=chart.notes.map(({t,...note})=>({t,notes:[note,{s:2,f:17,tp:true}]}));chart.notes=[];
    });
    assert.deepEqual(wideChord.areas.map(summary),[[1,5,9,17]],'uniform wide tapped chords retain a cheap proof');
});

test('rests cannot prove a phrase through a rotated all-tap cycle',()=>{
    for(const frets of [[9,17,9,17],[17,9,17,9],[9,12,17,9,12,17]]) {
        const result=compile(frets,chart=>chart.notes.forEach((note,index)=>{if(index>=frets.length/2)note.t+=2;}));
        assert.deepEqual(result.areas,[]);
    }
});

test('compressed proofs retain a valid suffix after a rest and the valid phase of an uneven rhythm',()=>{
    for(const times of [[1,6.1,6.2,6.3,6.4],[1,1.1,1.4,1.5,1.8]]) {
        const result=compile([9,17,9,17,9],chart=>{
            chart.rows[2].time=8;
            chart.notes.forEach((note,index)=>note.t=times[index]);
        });
        assert.deepEqual(result.areas.map(summary),[[times[1],8,9,17]]);
    }
});

test('adjacent proven all-tap variants share a known-pitch connector and one centre',()=>{
    const result=compile([9,11,16,9,11,16,11,9,12,17,9,12,17,9,12,17,9]);
    assert.deepEqual(result.areas.map(summary),[[1,5,9,17]]);
    assert.equal(result.areas[0].signatures.length,2);
    const novel=compile([9,11,16,9,11,16,13,9,12,17,9,12,17,9,12,17]);
    assert.equal(novel.areas.length,2);
    for(const [a,b] of [[[9,12,17],[9,12,16]],[[9,12,16],[9,12,17]],[[9,17],[9,16]]]) {
        const adjacent=compile([...a,...a,...b,...b]);
        assert.deepEqual(adjacent.areas.map(summary),[[1,5,9,17]],'a complete next proof reclaims the old matching tail');
    }
});

test('section, host and progressive ownership boundaries cannot lend all-tap proof',()=>{
    const frets=[9,12,17,9,12,17];
    for(const change of [chart=>chart.sections=[{time:1.3}],
        chart=>chart.rows.splice(2,0,row(1.3,10,17)),
        chart=>chart.rows=[row(0,1,9),row(.5,5,13),row(1,9,17),row(5,14,21)]]) {
        assert.deepEqual(compile(frets,change).areas,[]);
    }
});

test('an all-tap continuation preserves mixed ownership and uses its unowned suffix',()=>{
    const result=compile([9,17,9,17,9,17,9,17],chart=>{
        delete chart.notes[0].tp;delete chart.notes[2].tp;
    });
    assert.deepEqual(result.areas.map(summary),[[1,1.4,9,17],[1.4,5,9,17]]);
});

test('threshold-held host keeps the existing riff home instead of activating an all-tap area',()=>{
    const result=compile([9,17,9,17],chart=>chart.rows[2]=row(1.5,5));
    assert.equal(result.areas.length,1);
    const stops=api.hwyApplyCameraThreshold(result.evidence,{excursionThreshold:1000});
    assert.equal(api.hwyApplyTappingAreas(stops,result.areas,{xFret:f=>10*f}),stops);
});

test('exact tandem proof retains all starts and periods on short exhaustive inputs',()=>{
    for(let length=2;length<=9;length++) for(let bits=0;bits<2**length;bits++) {
        const keys=Array.from({length},(_,index)=>(bits>>index)&1), proofs=compileTandemRuns(keys);
        for(const proof of proofs) for(let index=proof.first+proof.period;index<proof.last;index++) {
            assert.equal(keys[index],keys[index-proof.period]);
        }
        for(let first=0;first<length;first++) for(let period=1;first+2*period<=length;period++) {
            if(keys.slice(first,first+period).every((key,index)=>key===keys[first+period+index])) {
                assert.ok(proofs.some(proof=>proof.period===period&&proof.first<=first&&proof.last>=first+2*period));
            }
        }
    }
});
