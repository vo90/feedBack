// Perceptual comparison, not an instrumented latency measurement. Each round
// narrows a bracket; two independent rounds check whether the answers repeat.
export function createAvComparison(initial = 0) {
    const origin = Math.max(-1000, Math.min(1000, Math.round(initial)));
    let trials = [], round = 0, prior = [], low = -1000, high = 1000;
    let candidate = origin, step = 80, directions = new Set(), uncertain = 0;
    let result = null;
    const history = [];
    function snapshot() {
        return {trials: [...trials], round, prior: [...prior], low, high, candidate, step,
            directions: [...directions], uncertain, result};
    }
    function finishRound() {
        prior.push({value: candidate, low, high});
        if (!round) {
            round = 1; low = -1000; high = 1000; directions.clear(); step = 80;
            candidate = Math.max(-1000, Math.min(1000, prior[0].value + (prior[0].value > 800 ? -80 : 80)));
        } else {
            const spread = Math.abs(prior[0].value - candidate);
            result = {offsetMs: Math.round((prior[0].value + candidate) / 2),
                repeatabilityMs: spread, consistent: spread <= 30,
                rounds: [...prior], trials: trials.length};
        }
    }
    return {
        get candidate() { return candidate; }, get round() { return round; },
        get count() { return trials.length; }, get result() { return result; },
        get canUndo() { return history.length > 0; },
        answer(answer) {
            if (result || !['earlier','later','together','unsure'].includes(answer)) return;
            history.push(snapshot()); trials.push({offset: candidate, answer, round});
            if (answer === 'unsure') {
                uncertain++;
                if (uncertain >= 3 || trials.length >= 24) result = {consistent:false, trials:trials.length};
                return;
            }
            uncertain = 0;
            if (answer === 'together') { finishRound(); return; }
            // Larger AV correction advances the visual marker. Thus sound
            // earlier than the marker calls for a larger correction.
            if (answer === 'earlier') low = Math.max(low, candidate);
            else high = Math.min(high, candidate);
            directions.add(answer);
            if ((candidate === 1000 && answer === 'earlier') || (candidate === -1000 && answer === 'later')) {
                result = {consistent:false, outOfRange:true, trials:trials.length}; return;
            }
            if (directions.size === 2) {
                candidate = Math.round((low + high) / 2);
                if (high - low <= 10) finishRound();
            } else {
                candidate = Math.max(-1000, Math.min(1000, candidate + (answer === 'earlier' ? step : -step)));
                step = Math.min(320, step * 2);
            }
            if (!result && trials.length >= 24) result = {consistent:false, trials:trials.length};
        },
        undo() {
            const s = history.pop(); if (!s) return;
            ({trials, round, prior, low, high, candidate, step, uncertain, result} = s);
            directions = new Set(s.directions);
        },
    };
}

export function calibrationVisualTime(clock, now, offset) {
    if (!clock || clock.timingVersion !== 2 || !clock.playing || !Number.isFinite(clock.position)
        || !Number.isFinite(clock.sampledAt) || now - clock.freshAt > 150) return null;
    return clock.position + Math.max(0, now - clock.sampledAt) / 1000 + offset / 1000;
}
