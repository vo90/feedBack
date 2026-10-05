// Core bar-expression API shared by renderers and optional scoring consumers.
// Source pitch is never clamped to fit the visual envelope.
export const WHAMMY_VERSION = 1;

export function barSegment(note, elapsed) {
    if (note?.whammy?.version !== 1 || note.whammy.policy !== 'optional'
        || !Array.isArray(note.whammy.segments) || !Number.isFinite(elapsed)) return null;
    const t = Math.max(0, elapsed);
    // Later segments own a shared boundary, including an explicit zero reset.
    for (let i=note.whammy.segments.length-1;i>=0;i--) {
        const m=note.whammy.segments[i];
        if (t >= m.start-1e-7 && t <= m.end+1e-7) return m;
    }
    return null;
}

export function barPitch(note, elapsed) {
    const m=barSegment(note,elapsed), p=m?.curve;
    if (!Array.isArray(p)||!p.length) return 0;
    const t=Math.max(0,elapsed);
    if(t<=p[0].t) return p[0].v;
    for(let i=1;i<p.length;i++) if(t<=p[i].t) {
        const a=p[i-1],b=p[i],d=b.t-a.t;
        return d>0 ? a.v+(b.v-a.v)*(t-a.t)/d : b.v;
    }
    return p[p.length-1].v;
}

export function barVisual(note, elapsed) {
    const m=barSegment(note,elapsed);
    if (!m) return 0;
    const wave=m.vibrato ? Math.sin((elapsed-m.start)*Math.PI*10)*(m.vibrato==='wide'?.45:.2) : 0;
    // Bound geometry only. One octave does not cross every string lane.
    return 2.5*Math.tanh((barPitch(note,elapsed)+wave)/2.5);
}

export function hasBar(note) {
    return note?.whammy?.version===1 && note.whammy.policy==='optional' && note.whammy.segments?.length>0;
}

export function barBoundaries(note) {
    return hasBar(note) ? note.whammy.segments.flatMap(m=>[m.start,m.end,...m.curve.map(p=>p.t)]) : [];
}

export const whammyApi=Object.freeze({version:WHAMMY_VERSION,segment:barSegment,pitch:barPitch,visual:barVisual,has:hasBar,boundaries:barBoundaries});
