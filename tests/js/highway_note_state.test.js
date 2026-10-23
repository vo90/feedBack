// Source-level guards for the per-note judgment hook (feedBack#254):
// highway.setNoteStateProvider / getNoteStateProvider / getNoteState,
// bundle.getNoteState, isDefaultRenderer, and the _noteState
// normalization rules. The createHighway closure owns canvas + WebGL
// lifecycle that's too heavy for a vm sandbox. Wiring is source-checked;
// small judgment/culling blocks run independently of the graphics setup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const highwayJs = path.join(__dirname, '..', '..', 'static', 'highway.js');
// R3c: _noteState moved to static/js/highway-state-primitives.js and gained an explicit
// hwState first parameter — it has to, because createHighway() is a factory and a module
// cannot import per-instance state without two panels sharing it.
const primitivesJs = path.join(__dirname, '..', '..', 'static', 'js', 'highway-state-primitives.js');
const highway3dJs = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

// Brace-balanced extraction (same helper shape as highway_visibility.test.js).
function extractBlock(src, signature) {
    const start = src.indexOf(signature);
    assert.ok(start !== -1, `signature '${signature}' not found`);
    const openBrace = src.indexOf('{', start);
    assert.ok(openBrace !== -1, `opening brace after '${signature}' not found`);
    let depth = 1;
    let i = openBrace + 1;
    while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
    }
    assert.ok(depth === 0, `unbalanced braces after '${signature}'`);
    return src.slice(start, i);
}


// R3c: highway.js is being carved into modules, so its source is no longer ONE file. Read the
// whole set rather than re-pinning at whichever file currently holds a function — re-pinning
// just breaks again next time, and a source-shape assertion that silently stops finding its
// target is indistinguishable from one that passes.
function highwaySources() {
    const root = path.join(__dirname, '..', '..');
    const jsDir = path.join(root, 'static', 'js');
    const parts = [fs.readFileSync(path.join(root, 'static', 'highway.js'), 'utf8')];
    for (const f of fs.readdirSync(jsDir).sort()) {
        if (f.startsWith('highway-') && f.endsWith('.js')) parts.push(fs.readFileSync(path.join(jsDir, f), 'utf8'));
    }
    return parts.join('\n');
}

test('highway declares the note-state provider slot', () => {
    const src = highwaySources();
    assert.match(src, /hwState\._noteStateProvider\s*=\s*null/, 'missing _noteStateProvider (provider slot, null = none)');
});

test('public API exposes setNoteStateProvider / getNoteStateProvider / getNoteState / isDefaultRenderer', () => {
    const src = highwaySources();
    assert.match(src, /setNoteStateProvider\s*\(\s*fn\s*\)\s*\{[^}]*hwState\._noteStateProvider\s*=/, 'setNoteStateProvider must assign _noteStateProvider');
    assert.match(src, /setNoteStateProvider\s*\(\s*fn\s*\)\s*\{[^}]*typeof\s+fn\s*===\s*['"]function['"][^}]*:\s*null/, 'setNoteStateProvider must coerce non-functions (incl. null) to null');
    assert.match(src, /getNoteStateProvider\s*\(\s*\)\s*\{\s*return\s+hwState\._noteStateProvider/, 'getNoteStateProvider must return the slot');
    assert.match(src, /getNoteState\s*\(\s*note\s*,\s*chartTime\s*\)\s*\{\s*return\s+_noteState\s*\(/, 'getNoteState must delegate to _noteState');
    assert.match(src, /isDefaultRenderer\s*\(\s*\)\s*\{\s*return\s+hwState\._renderer\s*===\s*_defaultRenderer\s*\|\|\s*hwState\._renderer\s*==\s*null/, 'isDefaultRenderer must be (_renderer === _defaultRenderer || _renderer == null)');
});

test('_makeBundle exposes getNoteState (stable reference, no per-frame alloc)', () => {
    const src = highwaySources();
    const fn = extractBlock(src, 'function _makeBundle(');
    // The bundle field must point straight at _noteState — not a fresh
    // arrow each frame (the per-frame allocation the review flagged).
    // R3c: _noteState now takes hwState first, so the bundle hands out a per-INSTANCE bound
    // view created ONCE in the factory (boundNoteState) rather than the raw function. The
    // contract that matters is unchanged and still asserted: ONE stable reference, never a
    // fresh arrow per frame (feedBack#254). Assert it is a bare identifier, not an inline
    // function expression.
    assert.match(fn, /getNoteState\s*[:=]\s*(?:boundNoteState|_noteState)\b/,
        'bundle.getNoteState must be a stable reference (a name), not a per-frame arrow');
    assert.doesNotMatch(fn, /getNoteState\s*[:=]\s*(?:\(|function)/,
        'bundle.getNoteState must NOT be a fresh function per frame');
});

test('_makeBundle exposes getNoteStateProvider as a stable reference (feedBack#254)', () => {
    const src = highwaySources();
    const fn = extractBlock(src, 'function _makeBundle(');
    // Same allocation discipline as getNoteState: highway_3d uses this
    // bundle field to tell "provider attached" from "no provider but
    // getNoteState still exists and returns null", so a per-frame arrow
    // here would both burn allocations on the hot path and could trip
    // identity-based guards in renderer code.
    assert.match(
        fn,
        /getNoteStateProvider\s*[:=]\s*_getNoteStateProvider\b/,
        'bundle.getNoteStateProvider must be the stable _getNoteStateProvider reference (not a per-frame arrow)'
    );
    // Sanity: the stable accessor exists per-createHighway-instance
    // (alongside _noteStateProvider in the closure) and returns the
    // slot, so renderers see a live "is a provider registered?" view.
    assert.match(
        src,
        /function\s+_getNoteStateProvider\s*\(\s*\)\s*\{\s*return\s+hwState\._noteStateProvider\s*;?\s*\}/,
        '_getNoteStateProvider must be defined as a stable named function returning _noteStateProvider'
    );
});

test('_noteState normalizes provider output as documented', () => {
    const src = highwaySources();
    const fn = extractBlock(fs.readFileSync(primitivesJs, 'utf8'), 'function _noteState(hwState, note, chartTime)');
    assert.match(fn, /if\s*\(\s*!hwState\._noteStateProvider\s*\)\s*return\s+null/, 'must short-circuit when no provider is registered');
    assert.match(fn, /try\s*\{[\s\S]*_noteStateProvider\s*\([\s\S]*catch[\s\S]*return\s+null/, 'must call the provider inside try/catch and return null on throw');
    assert.match(fn, /state\s*!==\s*['"]hit['"]\s*&&\s*state\s*!==\s*['"]active['"]\s*&&\s*state\s*!==\s*['"]miss['"]/, 'must reject states other than hit/active/miss');
    assert.match(fn, /Math\.max\(\s*0\s*,\s*Math\.min\(\s*1\s*,\s*raw\.alpha\s*\)\s*\)/, 'must clamp alpha to [0,1]');
    assert.match(fn, /if\s*\(\s*alpha\s*<=\s*0\s*\)\s*return\s+null/, 'must return null when alpha resolves to <= 0');
    assert.match(fn, /const\s+live\s*=\s*\(raw\s*&&\s*typeof\s+raw\s*===\s*['"]object['"]\s*&&\s*raw\.live\s*===\s*true\)/, 'must pass through the provider live flag');
    assert.match(fn, /return\s*\{\s*state\s*,\s*alpha\s*,\s*color\s*,\s*live\s*\}/, 'must return the normalized { state, alpha, color, live }');
});

test('default 2D renderer threads note state into drawNote / drawSustains / chord path', () => {
    const src = highwaySources();
    // drawNote takes the trailing `ns` param.
    // R3c: drawNote moved to ./static/js/highway-draw.js and gained hwState as its FIRST arg
    // (createHighway is a factory — a module cannot import per-instance state without two
    // panels sharing it). The contract asserted here is unchanged: `ns` is still the TRAILING
    // parameter, which is what the note-state threading depends on.
    assert.match(src, /function\s+drawNote\(\s*hwState\s*,\s*W\s*,\s*H\s*,\s*x\s*,\s*y\s*,\s*scale\s*,\s*string\s*,\s*fret\s*,\s*opts\s*,\s*ns\s*\)/,
        'drawNote must take hwState first and keep ns as the trailing param');
    // drawNotes / drawSustains / drawChords gate the lookup on the provider.
    // R3c: _noteState gained an explicit hwState first arg (it lives in a module now, and
    // createHighway is a factory). The CONTRACT here is unchanged and still the point: skip
    // the lookup entirely when no provider is set — a per-visible-note call on every frame.
    assert.match(src, /_noteStateProvider\s*\?\s*_noteState\(\s*hwState\s*,\s*n\s*,\s*n\.t\s*\)\s*:\s*null/,
        'visible-note paths must skip the lookup when no provider is set');
    // Same, for the chord path: keyed by the CHORD's time (ch.t), not the note's, and still
    // gated on the provider. Only the hwState arg is new.
    assert.match(src, /_noteStateProvider\s*\?\s*_noteState\(\s*hwState\s*,\s*cn\s*,\s*ch\.t\s*\)\s*:\s*null/,
        'chord-note path must key the lookup by the chord time and gate on the provider');
});

test('3D highway honors provider verdicts and legacy fallback without lighting guidance-only notes', () => {
    const src = fs.readFileSync(highway3dJs, 'utf8');
    assert.match(src, /_ndGetNoteState\s*=\s*\(bundle\s*&&\s*typeof\s+bundle\.getNoteState\s*===\s*['"]function['"]\)\s*\?\s*bundle\.getNoteState\s*:\s*null/, 'update() must capture bundle.getNoteState into _ndGetNoteState');
    const query = extractBlock(src, 'if (!guidanceOnly && !scrape && _ndGetNoteState)');
    const showHit = src.match(/const\s+_showHit\s*=\s*[^;]+;/);
    assert.ok(showHit, 'missing _showHit declaration');
    // Execute the production provider lookup and final hit expression. No
    // canvas, materials or sustain latch are needed for these short notes.
    const evaluate = new Function('guidanceOnly', 'verdict', 'hit', 'fret', 'inGhostWin', 'hasProvider = true', `
        const n = { t: 1, f: fret }, sourceNote = n, scrape = false;
        const _ndProbed = false, _ndProbedState = null;
        let _ndGood = false, _ndState = null, _ndCs = null, _ndCsIsObj = false;
        let calls = 0;
        const _ndGetNoteState = hasProvider ? () => { calls++; return verdict; } : null;
        ${query}
        ${showHit[0]}
        return { showHit: _showHit, calls };
    `);
    const cases = [
        { name: 'miss overrides both proximity and preview', verdict: 'miss', hit: true, ghost: true, expected: false },
        { name: 'object miss overrides proximity', verdict: { state: 'miss' }, hit: true, expected: false },
        { name: 'hit lights a note outside proximity', verdict: 'hit', expected: true },
        { name: 'active object lights a note outside proximity', verdict: { state: 'active' }, expected: true },
        { name: 'no verdict falls back to proximity', hit: true, expected: true },
        { name: 'no verdict falls back to a fretted preview', ghost: true, expected: true },
        { name: 'open notes have no fretted preview', fret: 0, ghost: true, expected: false },
        { name: 'no verdict outside proximity and preview stays unlit', expected: false },
    ];
    for (const { name, verdict = null, hit = false, fret = 3, ghost = false, expected } of cases) {
        assert.deepEqual(evaluate(false, verdict, hit, fret, ghost), { showHit: expected, calls: 1 }, name);
        assert.deepEqual(evaluate(true, verdict, hit, fret, ghost), { showHit: false, calls: 0 },
            `guidance-only: ${name}`);
        if (verdict === null) {
            assert.deepEqual(evaluate(false, null, hit, fret, ghost, false), { showHit: expected, calls: 0 },
                `no provider: ${name}`);
            assert.deepEqual(evaluate(true, null, hit, fret, ghost, false), { showHit: false, calls: 0 },
                `guidance-only without provider: ${name}`);
        }
    }
});

test('3D highway captures _ndHasProvider via bundle.getNoteStateProvider (feedBack#254)', () => {
    const src = fs.readFileSync(highway3dJs, 'utf8');
    // Detect-mode behavior — verdict-window cull extension, chord-frame
    // hold floor, and the smart drawNote cull — must be gated on a real
    // provider being registered, not on the always-present bundle.
    // getNoteState. Capture via bundle.getNoteStateProvider() with a
    // fallback to the getNoteState-existence check so downlevel hosts
    // (no getNoteStateProvider) still behave as before.
    assert.match(
        src,
        /_ndHasProvider\s*=\s*\(bundle\s*&&\s*typeof\s+bundle\.getNoteStateProvider\s*===\s*['"]function['"]\)[\s\S]{0,80}bundle\.getNoteStateProvider\s*\(\s*\)\s*!=\s*null[\s\S]{0,80}:\s*!!_ndGetNoteState/,
        'update() must derive _ndHasProvider from bundle.getNoteStateProvider() with a fallback to _ndGetNoteState'
    );
    // Verdict-window cull and chord-frame hold floor + smart drawNote
    // cull must all gate on _ndHasProvider (not _ndGetNoteState alone).
    assert.match(src, /ndVerdictT0\s*=\s*_ndHasProvider/, 'ndVerdictT0 outer-loop extension must gate on _ndHasProvider');
    assert.match(src, /if\s*\(\s*_ndHasProvider\s*&&\s*chordTailHoldS\s*<\s*NOTEDETECT_GEM_VERDICT_WINDOW/,
        'chord-frame hold floor must gate on _ndHasProvider');
});

test('3D smart culling extends real verdicts but never probes expired guidance-only notes', () => {
    const src = fs.readFileSync(highway3dJs, 'utf8');
    const cull = extractBlock(src, 'if (_overLinger && (!hasSus || now > susEnd) && !arpGhostShouldRun)');
    const windowDeclaration = src.match(/const\s+NOTEDETECT_GEM_VERDICT_WINDOW\s*=\s*[^;]+;/);
    assert.ok(windowDeclaration, 'missing verdict-window constant');
    const verdictWindow = new Function(`${windowDeclaration[0]} return NOTEDETECT_GEM_VERDICT_WINDOW;`)();
    const evaluate = new Function('context', `
        const { guidanceOnly, _ndHasProvider, dt, arpGhostShouldRun, _ndGetNoteState } = context;
        const _overLinger = true, hasSus = false, now = 1, susEnd = 0;
        ${windowDeclaration[0]}
        const n = { t: now + dt, s: 0 }, sourceNote = n;
        const _susVerdictLatch = new Map();
        let _ndProbed = false, _ndProbedState = null;
        ${cull}
        return { probed: _ndProbed, verdict: _ndProbedState };
    `);
    const cases = [
        { name: 'hit remains visible within verdict window', verdict: 'hit', keep: true, calls: 1 },
        { name: 'active object remains visible within verdict window', verdict: { state: 'active' }, keep: true, calls: 1 },
        { name: 'miss remains visible within verdict window', verdict: 'miss', keep: true, calls: 1 },
        { name: 'silent provider does not extend lifetime', verdict: null, calls: 1 },
        { name: 'invalid verdict does not extend lifetime', verdict: 'unknown', calls: 1 },
        { name: 'provider exception does not extend lifetime', throws: true, calls: 1 },
        { name: 'no registered provider is not probed', provider: false, calls: 0 },
        { name: 'verdict past the window is not probed', dt: -verdictWindow - 0.001, calls: 0 },
        { name: 'verdict exactly at the window remains eligible', dt: -verdictWindow, verdict: 'hit', keep: true, calls: 1 },
        { name: 'expired guidance-only note is not probed', guidance: true, verdict: 'hit', calls: 0 },
        { name: 'active arpeggio guidance keeps its projection without probing', guidance: true, arp: true, keep: true, calls: 0 },
    ];
    for (const { name, guidance = false, provider = true, dt = -0.2, arp = false, verdict = null, throws = false, keep = false, calls: expectedCalls } of cases) {
        let calls = 0;
        const result = evaluate({ guidanceOnly: guidance, _ndHasProvider: provider, dt, arpGhostShouldRun: arp,
            _ndGetNoteState() { calls++; if (throws) throw new Error('provider unavailable'); return verdict; } });
        assert.equal(result !== undefined, keep, name);
        assert.equal(calls, expectedCalls, `${name}: provider calls`);
        if (keep) assert.deepEqual(result, { probed: calls > 0, verdict: calls > 0 ? verdict : null },
            `${name}: retain the probe result for the later draw path`);
    }
});
