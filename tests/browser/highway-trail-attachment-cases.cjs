'use strict';

// Synthetic charts only. These cover paths that the single-family matrix cannot.
module.exports = function cases({base, member, fixture, chordFixture}) {
    const result = [];
    const add = (name, bundle, style, mode) => result.push({name, bundle, style, mode, image:false, reset:false});
    for (const style of ['current', 'rsplus']) for (const mode of [0, 1, 2, 3]) {
        for (const kind of ['ordinary-pm','open-pm','repeat','repeat-pm','repeat-fh',
            'repeat-retained','repeat-mixed','hold','open-hold','arp']) {
            add(`${style}-${mode}-chord-${kind}`, chordFixture(kind), style, mode);
        }
        for (const arpeggio of [false, true]) {
            const b = chordFixture('ordinary-pm');
            b.notes.push(member({t:10.8, s:1, f:5, pm:true}));
            if (arpeggio) b.handShapes = [{chord_id:0,start_time:10.8,end_time:12.3,arpeggio:true}];
            add(`${style}-${mode}-duplicate-${arpeggio}`, b, style, mode);
        }
        for (const fret of [0,127]) for (const role of ['target','source','chord-target','chord-source','linked','coincident']) {
            const b = fixture('identity', {f:role==='target'?fret:5, mt:true, sus:1.2});
            if (role==='source') Object.assign(b.notes[0], {f:fret,mt:true});
            if (role.startsWith('chord')) {
                const t = role==='chord-target'?10.8:10.1, s = role==='chord-target'?1:0;
                b.notes = b.notes.filter(n=>n.t!==t);
                b.chordTemplates = [{name:'Muted chord',frets:[fret,5,7,-1,-1,-1]}];
                b.chords = [{t,id:0,notes:[member({s,f:fret,mt:true,sus:1.2}),member({s:s+1,f:5,sus:.8,bn:1})]}];
            }
            if (role==='linked') {
                Object.assign(b.notes[1],{f:fret,ln:true,sus:.6});
                b.notes.push(member({t:11.4,s:1,f:fret,mt:true,sus:.8}));
            }
            if (role==='coincident') {
                b.notes[1].f=fret;
                b.notes.push(member({t:10.8,s:1,f:fret===0?127:0,mt:true,sus:.7}));
            }
            b.notes.sort((a,b)=>a.t-b.t);
            add(`${style}-${mode}-f${fret}-${role}`, b, style, mode);
        }
        for (const s of [0,2]) {
            const b=fixture('control',{s,pm:true});
            if(s===2)b.notes[0].s=3;
            add(`${style}-${mode}-physical-control-${s}`,b,style,mode);
        }
        const b=fixture('linked',{ln:true,sl:8,sus:.6,pm:true});
        b.notes.push(member({t:11.4,s:1,f:8,sus:.8,sl:6,pm:true}));
        b.notes.sort((a,b)=>a.t-b.t);
        for(const t of [10.6,10.8,11.4,11.7,12.3,10.6])add(`${style}-${mode}-link-${result.length}`,{...b,currentTime:t},style,mode);
    }
    for(const fret of [5,127])for(const style of ['rsplus','current','rsplus'])for(const mode of [1,3,0,2,1]){
        const b=fixture('cached',{f:fret,mt:fret===127,pm:true,ac:true,sus:.65});
        b.auditChartKey='retained-chart-'+fret;
        for(const t of [8,10.6,10.8,11,11.45,11.6,14,10.6])add(`cached-${result.length}`,{...b,currentTime:t},style,mode);
        for(const inverted of [true,false])for(const lefty of [true,false])add(`layout-${result.length}`,{...b,inverted,lefty},style,mode);
    }
    for(const settings of [
        {trailYieldEnabled:false,trailYieldGemInFront:true,trailYieldIncludeTrails:true},
        {trailYieldEnabled:true,trailYieldGemInFront:false,trailYieldIncludeTrails:true},
        {noteStemsVisible:false,openStringStemsVisible:false},
        {slideArrowApproachVisible:false,slideArrowNeckVisible:false},
    ])for(const style of ['current','rsplus']){
        const b=fixture('flags',{f:0,pm:true});b.auditSettings=settings;
        add(`flags-${result.length}`,b,style,1);
    }
    return result;
};
