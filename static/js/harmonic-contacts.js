// Additive one-contact contract. Fret position and initial attack never move.
export { createHarmonicContactOverlay as createOverlay } from './harmonic-contact-overlay.js';
const pitches = new Map([[12,12],[7,19],[19,19],[5,24],[24,24],[4,28],[9,28],[16,28],
    [3.2,31],[2.7,34],[5.8,34],[9.6,34],[14.7,34],[21.7,34],[2.4,36],[8.2,36],[17,36]]);
const keys = (x,k) => x && typeof x==='object' && !Array.isArray(x)
    && Object.keys(x).sort().join(',')===k;
export function harmonicContacts(note) {
    const c=note?.harmonic_changes;
    if (!keys(c,'events,version') || c.version!==1 || !Array.isArray(c.events) || c.events.length!==1
        || !Number.isInteger(note.f) || note.f<0 || note.f>48 || !Number.isFinite(note.sus) || note.sus<=0
        || ['hm','hp','mt','fhm'].some(k=>note[k])
        || ['harmonic_target','hn','hps','harmonic_alias'].some(k=>note[k]!==undefined)) return [];
    const e=c.events[0],h=e?.target;
    if(!keys(e,'end,source_id,start,target') || !Number.isFinite(e.start) || !Number.isFinite(e.end)
        || e.start<=0 || e.end<=e.start || Math.abs(e.end-note.sus)>0.0000011
        || typeof e.source_id!=='string' || !e.source_id.length || e.source_id.length>512
        || !keys(h,'interval,kind,node,policy') || h.kind!=='artificial' || h.policy!=='harmonic'
        || !Number.isFinite(h.node) || !Number.isInteger(h.interval) || pitches.get(h.node)!==h.interval) return [];
    return c.events;
}
export function harmonicContactAt(note,elapsed) {
    const e=harmonicContacts(note)[0];
    return e && Number.isFinite(elapsed) && elapsed>=e.start-1e-9 && elapsed<=e.end+1e-9 ? e : null;
}
export function harmonicContactLabel(note,event) {
    return `AH ${Number((note.f+event.target.node).toFixed(3))}`;
}
export function harmonicAttackDeadline(note,onset,tolerance,grace=0) {
    const e=harmonicContacts(note)[0];
    return Math.min(onset+tolerance+grace,e?onset+e.start:Infinity);
}
export const harmonicContactsApi=Object.freeze({version:1,events:harmonicContacts,at:harmonicContactAt,
    label:harmonicContactLabel,attackDeadline:harmonicAttackDeadline});
