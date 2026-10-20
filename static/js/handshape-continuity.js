// Phrase difficulty data can clip one authored handshape into several pieces.
// Recover continuity only with evidence from the arrangement's original span;
// touching shapes alone do not distinguish a continuation from a new gesture.
export function joinPhraseHandShapes(fragments, originalShapes) {
    const timeEpsilon = 1e-6;
    // Phrase bounds are rounded to milliseconds on the playback wire, whereas
    // handshape bounds retain their original precision.
    const phraseEpsilon = 0.000501;
    const start = h => Number(h.start_time ?? h.startTime);
    const end = h => Number(h.end_time ?? h.endTime);
    const flag = value => value === true || value === 1 || value === '1';
    const signature = h => {
        const id = h.chord_id ?? h.chordId;
        if (id == null || !Number.isInteger(Number(id)) || Number(id) < 0) return null;
        const metadata = { ...h };
        for (const key of ['chord_id', 'chordId', 'start_time', 'startTime',
            'end_time', 'endTime', 'arp']) delete metadata[key];
        // Keep future/extension metadata distinct too. Do not infer equivalence
        // from chord names: different template IDs can encode different grips.
        return JSON.stringify([Number(id), flag(h.arp),
            Object.keys(metadata).sort().map(key => [key, metadata[key]])]);
    };
    const valid = h => Number.isFinite(start(h)) && Number.isFinite(end(h))
        && end(h) > start(h);
    const originalsBySignature = new Map();
    for (const h of originalShapes || []) {
        const key = signature(h);
        if (key === null || !valid(h)) continue;
        if (!originalsBySignature.has(key)) originalsBySignature.set(key, []);
        originalsBySignature.get(key).push(h);
    }
    const ordered = fragments.slice().sort((a, b) => start(a.shape) - start(b.shape));
    const runs = new Map();
    const result = [];
    for (const fragment of ordered) {
        const { shape, phrase, phraseIndex } = fragment;
        const lo = start(shape), hi = end(shape);
        const key = signature(shape);
        const candidates = key !== null && valid(shape)
            ? (originalsBySignature.get(key) || []).filter(h =>
                start(h) <= lo + timeEpsilon && end(h) >= hi - timeEpsilon)
            : [];
        // Overlapping authored spans are ambiguous. Leave their onsets intact.
        const original = candidates.length === 1 ? candidates[0] : null;
        const previous = original && runs.get(original);
        const boundary = Number(phrase.start_time);
        if (previous
            && previous.phraseIndex + 1 === phraseIndex
            && Math.abs(Number(previous.phrase.end_time) - boundary) <= phraseEpsilon
            && Math.abs(end(previous.shape) - lo) <= timeEpsilon
            && Math.abs(lo - boundary) <= phraseEpsilon
            && Math.abs(end(previous.shape) - Number(previous.phrase.end_time)) <= phraseEpsilon
            && start(original) < lo - timeEpsilon && end(original) > lo + timeEpsilon) {
            // Copy only the display interval. Never extend into a hidden
            // difficulty slice or mutate the authored/phrase objects.
            const joined = { ...previous.shape };
            if ('end_time' in joined || !('endTime' in joined)) joined.end_time = hi;
            if ('endTime' in joined) joined.endTime = hi;
            result[previous.outputIndex] = joined;
            runs.set(original, { ...fragment, shape: joined, outputIndex: previous.outputIndex });
        } else {
            const outputIndex = result.push(shape) - 1;
            if (original) runs.set(original, { ...fragment, outputIndex });
        }
    }
    return result;
}
