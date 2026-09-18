const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function fn(name) {
    const start = src.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' exists');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}
function constant(name) {
    const match = src.match(new RegExp('const ' + name + ' = ([\\d.]+);'));
    assert.ok(match, name + ' exists');
    return Number(match[1]);
}

// Run drawNote's real timing, culling, suppression and Y-position code up to
// the geometry setup, then evaluate its actual gem gate. This needs no fake
// Three.js scene, and will catch a pose fix that accidentally extends a gem's
// life or makes a linked continuation visible. External renderer state and
// note-detection responses are the only inputs supplied by this harness.
function harness({ inverted = false, eventTimes = [], verdict } = {}) {
    const draw = fn('drawNote');
    const cutoff = draw.indexOf('const noteZ =');
    assert.ok(cutoff > 0);
    const gate = draw.match(/if \((!effSkipBody && !arpGhostOnlyMode && !_overLinger)\)/);
    assert.ok(gate, 'drawNote has an explicit gem visibility gate');
    return new Function('_invertedCached', '_scrEventTimes', 'verdict', `
        const nStr = 6, NFRETS = 24, S_COL = Array(6), _oobStringWarned = true;
        const BEND_ENV_RISE_FRAC = ${constant('BEND_ENV_RISE_FRAC')};
        const BEND_ENV_RELEASE_FRAC = ${constant('BEND_ENV_RELEASE_FRAC')};
        const NEXT_ON_STRING_T_EPS = ${constant('NEXT_ON_STRING_T_EPS')};
        const BEND_LINK_TIME_EPS = ${constant('BEND_LINK_TIME_EPS')};
        const VIBRATO_HALF_WAVE_S = ${constant('VIBRATO_HALF_WAVE_S')};
        const NOTEDETECT_GEM_VERDICT_WINDOW = ${constant('NOTEDETECT_GEM_VERDICT_WINDOW')};
        const GHOST_HOLD_AFTER_ONSET = ${constant('CHORD_HWY_LINGER_S')};
        const BEND_HALFSTEP_WORLD_Y = 3.2;
        const _drawNextByString = null, sY = s => s;
        const _scrEventTimesLen = _scrEventTimes.length;
        const _susVerdictLatch = new Map();
        const _ndHasProvider = verdict !== undefined;
        let probes = 0;
        const _ndGetNoteState = () => { probes++; return verdict; };
        let _linkedBendStarts = new WeakMap(), _linkedBendEnds = new WeakMap();
        let _linkedVibratoRuns = new WeakMap();
        ${['validString', 'isPlayableFret', 'isUnpitchedMute', 'isRenderableNote',
            '_firstEventTimeGreaterThan', 'hwyShouldSuppressNoteBody',
            'bnvSampleAt', 'bendCurveStartSemis', 'bendCurveSemisAt',
            'bendSemisAtElapsed', 'bendSemisAtTime', 'bendVisualDirY',
            'noteHasVibrato', 'vibratoSemisAtTime', 'prebendOffsetWorld',
            'techniqueYOffsetWorld', 'hwyLinkNextTargetNotes',
            'resolveLinkedBendEnds', 'resolveLinkedBendStarts',
            'resolveLinkedVibratoRuns'].map(fn).join('\n')}
        ${draw.slice(0, cutoff)}
            return {
                offset: techniqueYNow, sustained, hit, hitFade,
                deadline: _lingerDeadline, bodyVisible: ${gate[1]},
                arpGhostOnlyMode, effSkipBody,
            };
        }
        return {
            pose(n, now, options = {}) {
                return drawNote(n, now, undefined, false, options.skipBody || false,
                    options.linger ?? .10, undefined, options.fromChord || false,
                    undefined, false, options.arpBounds || null, -Infinity,
                    false, options.explicitLinkTarget || false);
            },
            sample: techniqueYOffsetWorld,
            direction: bendVisualDirY,
            link(notes) {
                const links = new Map();
                const targets = hwyLinkNextTargetNotes(notes, [], 1e-6, links);
                _linkedBendEnds = resolveLinkedBendEnds(links);
                _linkedBendStarts = resolveLinkedBendStarts(links, _linkedBendEnds);
                _linkedVibratoRuns = resolveLinkedVibratoRuns(links);
                return targets;
            },
            latch: _susVerdictLatch,
            probeCount: () => probes,
        };
    `)(inverted, [...eventTimes].sort((a, b) => a - b), verdict);
}

const held = changes => ({
    t: 10, s: 3, f: 7, sus: .05,
    bnv: [{ t: 0, v: 1 }, { t: .05, v: 1 }], ...changes,
});
const end = n => n.t + n.sus;
function close(actual, expected) {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9,
        `expected ${expected}, received ${actual}`);
}

test('a short held bend keeps its terminal pose until the existing linger deadline', () => {
    const h = harness(), n = held();
    const original = JSON.stringify(n);
    for (const now of [10.05, 10.050001, 10.075, 10.1]) {
        const pose = h.pose(n, now);
        assert.equal(pose.bodyVisible, true);
        close(pose.offset, 3.2);
        close(pose.deadline, 10.1);
        assert.equal(pose.sustained, now <= end(n));
    }
    assert.equal(h.pose(n, 10.100001), undefined);
    assert.equal(JSON.stringify(n), original, 'the authored curve and sustain do not change');
});

test('released and scalar bends stay released instead of returning to their prebend', () => {
    const h = harness();
    for (const n of [
        held({ bnv: [{ t: 0, v: 1 }, { t: .05, v: 0 }] }),
        held({ bn: 2, bnv: undefined }),
    ]) {
        assert.ok(h.sample(n, n.t + .025) > 0);
        close(h.pose(n, 10.075).offset, 0);
    }
});

test('post-sustain sampling clamps even when an authored curve contains later points', () => {
    const h = harness();
    const n = held({ bnv: [{ t: 0, v: 1 }, { t: .1, v: 2 }] });
    const terminal = h.sample(n, end(n));
    assert.ok(h.sample(n, 10.075) > terminal);
    close(h.pose(n, 10.075).offset, terminal);
    close(h.pose(n, 10.09).offset, terminal);
});

test('standalone vibrato and bend-plus-vibrato freeze their final phase during linger', () => {
    for (const bnv of [undefined, held().bnv]) {
        const h = harness(), n = held({ vb: true, bnv });
        const terminal = h.sample(n, end(n));
        assert.ok(Math.abs(h.sample(n, 10.075) - terminal) > .1);
        for (const time of [10.050001, 10.075, 10.099]) {
            close(h.pose(n, time).offset, terminal);
        }
    }
});

test('approach and active motion remain chart-time based in every string orientation', () => {
    for (const inverted of [false, true]) {
        const h = harness({ inverted });
        for (const s of [0, 3, 5]) {
            const n = held({ s, bnv: [{ t: 0, v: 1 }, { t: .05, v: 2 }] });
            close(h.pose(n, 9.9).offset, 3.2 * h.direction(s));
            close(h.pose(n, 10).offset, 3.2 * h.direction(s));
            close(h.pose(n, 10.025).offset, h.sample(n, 10.025));
            close(h.pose(n, 10.075).offset, h.sample(n, end(n)));
        }
    }
});

test('seeking back through linger never changes the next sampled position', () => {
    const h = harness(), n = held({ vb: true });
    for (const time of [10.075, 9.9, 10.025, 10.09, 10, 10.05, 10.025]) {
        const expected = time <= n.t ? 3.2 : h.sample(n, Math.min(time, end(n)));
        close(h.pose(n, time).offset, expected);
    }
});

test('notes without sustain keep the normal position and original lifetime', () => {
    const h = harness();
    for (const sus of [0, undefined]) {
        const n = held({ sus, vb: true });
        for (const time of [9.9, 10, 10.075]) close(h.pose(n, time).offset, 0);
        assert.equal(h.pose(n, 10.100001), undefined);
    }
});

test('a next event still truncates extra linger and long sustains gain no extra lifetime', () => {
    const h = harness({ eventTimes: [10, 10.07, 11] });
    const short = held();
    close(h.pose(short, 10.06).offset, 3.2);
    close(h.pose(short, 10.06).deadline, 10.07);
    assert.equal(h.pose(short, 10.070001), undefined);
    const long = held({ sus: .5 });
    assert.equal(h.pose(long, 10.4).bodyVisible, true);
    close(h.pose(long, 10.4).deadline, 10.5);
    assert.equal(h.pose(long, 10.500001), undefined);
});

test('note-state verdicts and arpeggio persistence cannot resurrect an expired gem', () => {
    const n = held();
    for (const verdict of ['hit', { state: 'active' }, 'miss']) {
        const h = harness({ verdict });
        h.latch.set(Math.round(n.t * 1e4) * 10 + n.s, 'hit');
        assert.equal(h.pose(n, 10.075).bodyVisible, true);
        assert.equal(h.probeCount(), 0);
        assert.equal(h.pose(n, 10.11).bodyVisible, false);
        assert.equal(h.probeCount(), 1);
        assert.equal(h.latch.size, 0);
    }
    const h = harness();
    const arp = h.pose(n, 10.11, { arpBounds: { start: 10, end: 11 } });
    assert.equal(arp.arpGhostOnlyMode, true);
    assert.equal(arp.bodyVisible, false);
});

test('linked targets remain hidden while ordinary skipped repeats appear at impact', () => {
    const a = held({ ln: true });
    const b = held({ t: end(a), bnv: [{ t: 0, v: 1 }, { t: .05, v: 1 }] });
    const h = harness({ eventTimes: [a.t, b.t] });
    assert.equal(h.link([a, b]).has(b), true);
    for (const now of [b.t - .01, b.t, b.t + .025, b.t + .075]) {
        const pose = h.pose(b, now, { explicitLinkTarget: true });
        assert.equal(pose.effSkipBody, true);
        assert.equal(pose.bodyVisible, false);
    }
    assert.equal(h.pose(b, b.t - .01, { skipBody: true }).bodyVisible, false);
    assert.equal(h.pose(b, b.t, { skipBody: true }).bodyVisible, true);
    assert.equal(h.pose(b, b.t + .075, { skipBody: true }).bodyVisible, true);
});

test('chord members share the same terminal pose without changing their chosen linger', () => {
    const h = harness(), n = held();
    const options = { fromChord: true, linger: .15 };
    close(h.pose(n, 10.125, options).offset, 3.2);
    close(h.pose(n, 10.125, options).deadline, 10.15);
    assert.equal(h.pose(n, 10.150001, options), undefined);
});
