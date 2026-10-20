'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extract(name) {
    const match = new RegExp(`function\\*? ${name}\\(`).exec(source);
    assert.ok(match, `${name} must exist in the renderer`);
    const lineStart = source.lastIndexOf('\n', match.index) + 1;
    const indent = source.slice(lineStart, match.index);
    assert.match(indent, /^\s*$/, `${name} begins at its enclosing indentation`);
    const boundary = '\n' + indent + '}';
    const end = source.indexOf(boundary, match.index);
    assert.ok(end > match.index, `${name} must have an enclosing function boundary`);
    return source.slice(match.index, end + boundary.length);
}

const stateStart = source.indexOf('        let _bendLayout =');
const stateEndMarker = 'const _bendWideVibratoRange = Object.freeze([-1.2, 1.2]);';
const stateEnd = source.indexOf(stateEndMarker, stateStart) + stateEndMarker.length;
assert.ok(stateStart >= 0 && stateEnd > stateStart);
const observationStart = source.indexOf('            if (_bendLayoutJob && now >= n.t');
const observationEnd = source.indexOf('            // Preserve source fret/identity', observationStart);
assert.ok(observationStart >= 0 && observationEnd > observationStart);
const scratchStart = source.indexOf('Object.assign(_scrChordNote, cn);');
const scratchEnd = source.indexOf('drawNote(', scratchStart);
assert.ok(scratchStart >= 0 && scratchEnd > scratchStart);
const markerStart = source.indexOf('                const bendLayout = _bendLayout.byNote.get(n);');
const markerEnd = source.indexOf('                if (rsPlusNotation) {', markerStart);
assert.ok(markerStart >= 0 && markerEnd > markerStart);

// Execute the renderer's real scheduler, publication, direction, and copy paths.
// Only the heavyweight layout builder, texture upload, timers, and clock are
// substituted, so asynchronous lifecycle cases can be advanced deterministically.
function harness(options = {}) {
    return new Function('fixture', `
        let nStr = fixture.count || 6, _invertedCached = false, _destroyed = false;
        const _linkedBendStarts = new WeakMap(), _linkedBendEnds = new WeakMap();
        const _linkedVibratoRuns = new WeakMap(), _linkedTrailPaths = {byNote: new WeakMap()};
        ${source.slice(stateStart, stateEnd)}
        const timers = new Map(), callbacks = new Map();
        let nextTimer = 1, clock = 0, builderCalls = 0, builderAdvances = 0, textures = 0, pitchSamples = 0;
        const buildInputs = [];
        const performance = {now: () => clock};
        const setTimeout = callback => {
            const id = nextTimer++;
            timers.set(id, callback);
            callbacks.set(id, callback);
            return id;
        };
        const clearTimeout = id => timers.delete(id);
        const txtMat = label => ({label, map: {image: {width: 64, height: 16}}});
        const ren = {initTexture: () => { textures++; }};
        const noteHasVibrato = note => !!note.vb || !!note.vibrato_marks?.length;
        _bendNeutralMat = txtMat('BEND');
        function* hwyBuildBendLayout(notes, chords, count, options) {
            builderCalls++;
            buildInputs.push({notes, chords, count, options});
            for (let i = 0; i < (fixture.yields ?? 6); i++) {
                builderAdvances++;
                clock += fixture.advanceMs ?? .6;
                yield;
            }
            const members = [...notes, ...(chords || []).flatMap(chord => chord.notes || [])]
                .filter(note => note.bn > 0 || note.bnv?.length);
            const byNote = new WeakMap(), groups = new Map(), components = new Map();
            for (const note of members) {
                const key = note.fixtureGroup || 0;
                let group = groups.get(key);
                if (!group) {
                    const componentKey = fixture.shareComponents ? 0 : key;
                    let component = components.get(componentKey);
                    if (!component) {
                        component = {id: components.size, neutral: false};
                        components.set(componentKey, component);
                    }
                    group = {direction: typeof fixture.direction === 'function'
                        ? fixture.direction(builderCalls) : fixture.direction ?? 1,
                        reason: 'fixture', members: [], neutralComponent: component};
                    groups.set(key, group);
                }
                group.members.push({note});
                byNote.set(note, {group, direction: group.direction, peak: note.bn || .5});
            }
            return {byNote, groups: [...groups.values()], stats: {},
                forceNeutral: !!fixture.forceNeutral};
        }
        ${['hwyBendLayoutDirection', 'resetBendLayout', 'copyBendLayout', 'bendLayoutVibratoRange',
            'prepareBendLayout', 'scheduleBendLayout', 'bendVisualDirY',
            'prebendOffsetWorld', 'techniqueYOffsetWorld'].map(extract).join('\n')}
        const FINGER_BEND_WORLD_Y = 1, BEND_HALFSTEP_WORLD_Y = .8;
        const bendSemisAtTime = note => { pitchSamples++; return note.bn || 0; };
        const vibratoSemisAtTime = () => 0;
        const hwyWhammySemisAt = () => 0;
        function observe(n, now, sourceIdentity = n) {
            ${source.slice(observationStart, observationEnd)}
        }
        function scratch(_scrChordNote, cn, ch) {
            ${source.slice(scratchStart, scratchEnd)}
            return _scrChordNote;
        }
        function marker(n, now = n.t) {
            const mesh = {material: {}, rotation: {}, shown: false,
                scale: {set() {}}, position: {set() {}}};
            const s = n.s, rsPlusNotation = false, NH = 1, NW = 1, K = .1;
            const x = 0, y = 0, techniqueYNow = 0, noteZ = 0, approachRot = 0;
            const activePalette = [], pTechPlane = {get: () => {mesh.shown = true; return mesh;}};
            const bendChevronMat = () => txtMat('ARROW');
            const rsPlusTechniqueMat = bendChevronMat;
            const _spriteMat2MeshMat = (mesh, material) => ({...material});
            const techniqueMarkerRenderOrder = 1, trailYieldGemRecord = {};
            const trailYieldRegisterAttachment = () => {}, _registerIncomingLabelOccluder = () => {};
            let yo = 0;
            ${source.slice(markerStart, markerEnd)}
            return mesh;
        }
        function flushOne() {
            const first = timers.entries().next().value;
            if (!first) return false;
            timers.delete(first[0]);
            first[1]();
            return true;
        }
        function flushAll() {
            let remaining = 10000;
            while (flushOne()) if (--remaining <= 0) throw Error('Scheduler did not settle');
        }
        return {
            schedule: scheduleBendLayout, reset: resetBendLayout, copy: copyBendLayout,
            observe, scratch, marker, flushOne, flushAll,
            direction: note => bendVisualDirY(note.s, note),
            physicalDirection: note => hwyBendLayoutDirection(_bendLayout.byNote.get(note)?.group),
            offset: note => techniqueYOffsetWorld(note, note.t),
            prebend: prebendOffsetWorld,
            trapLayoutReads: () => {
                _bendLayout.byNote.get = () => { throw Error('Unexpected layout lookup'); };
            },
            entry: note => _bendLayout.byNote.get(note),
            origin: note => _bendLayoutSources.get(note),
            inherited: (note, value) => _linkedBendStarts.set(note, value),
            setInverted: value => { _invertedCached = value; },
            setCount: value => { nStr = value; },
            setDestroyed: value => { _destroyed = value; },
            invokeStale: id => callbacks.get(id)(),
            pendingIds: () => [...timers.keys()],
            state: () => ({
                job: _bendLayoutJob, timer: _bendLayoutTimer,
                observed: _bendLayoutObserved.size, groups: _bendLayout.groups.length,
                notes: _bendLayoutNotesRef, chords: _bendLayoutChordsRef,
                count: _bendLayoutStringCount, forceNeutral: _bendLayoutForceNeutral,
                builderCalls, builderAdvances, textures, pitchSamples, buildInputs,
                stats: {..._bendLayoutStats},
            }),
        };
    `)(options);
}

function note(overrides = {}) {
    return {t: 10, s: 2, f: 7, sus: 2, bn: 1, ...overrides};
}

test('preparation starts outside draw and yields between bounded batches before atomic publication', () => {
    const h = harness();
    const n = note(), notes = [n], chords = [];
    h.schedule(notes, chords, new Map());
    assert.equal(h.state().builderCalls, 0, 'scheduling must not advance the chart builder synchronously');
    assert.equal(h.direction(n), 0, 'unprepared bend uses a neutral indication');
    assert.equal(h.flushOne(), true);
    assert.equal(h.state().builderCalls, 1);
    assert.ok(h.state().builderAdvances < 6, 'a batch does not drain an expensive chart');
    assert.equal(h.entry(n), undefined, 'a partially built layout must not leak into drawing');
    assert.equal(h.pendingIds().length, 1, 'unfinished preparation yields back to the event loop');
    h.flushAll();
    assert.ok(h.entry(n));
    assert.equal(h.direction(n), -1);
    assert.equal(h.state().job, null);
    assert.equal(h.pendingIds().length, 0);
    assert.ok(h.state().stats.batches > 1);
});

test('unchanged chart identities reuse work during preparation, playback, and inversion', () => {
    const h = harness();
    const n = note(), notes = [n], chords = [], links = new Map();
    h.schedule(notes, chords, links);
    const firstJob = h.state().job;
    h.schedule(notes, chords, new Map());
    assert.equal(h.state().job, firstJob);
    h.flushAll();
    const group = h.entry(n).group;
    for (let i = 0; i < 20; i++) {
        h.setInverted(i % 2 === 0);
        h.schedule(notes, chords, links);
        assert.equal(h.entry(n).group, group);
        assert.equal(h.direction(n), i % 2 === 0 ? 1 : -1);
    }
    assert.equal(h.state().stats.builds, 1);
    assert.equal(h.state().builderCalls, 1);
    assert.equal(h.pendingIds().length, 0);
});

test('changed notes, chord arrays, or string count invalidate the resolved layout', () => {
    const h = harness({yields: 0});
    const n = note(), notes = [n], chords = [];
    h.schedule(notes, chords, new Map());
    h.flushAll();
    h.schedule([...notes], chords, new Map());
    h.flushAll();
    const replacement = h.state().notes;
    h.schedule(replacement, [{t: 10, notes: [note({s: 3})]}], new Map());
    h.flushAll();
    const replacementChords = h.state().chords;
    h.setCount(8);
    h.schedule(replacement, replacementChords, new Map());
    h.flushAll();
    assert.equal(h.state().stats.builds, 4);
    assert.equal(h.state().builderCalls, 4);
    assert.equal(h.state().buildInputs.at(-1).count, 8);
});

test('same-count array replacement retains source decisions during preparation and publication', () => {
    const h = harness();
    const a = note(), b = note({s: 3}), notes = [a, b], chords = [];
    h.schedule(notes, chords, new Map());
    h.flushAll();
    const originalGroup = h.entry(a).group;
    h.schedule([...notes], chords, new Map());
    assert.equal(h.entry(a).group, originalGroup);
    assert.equal(h.direction(a), -1);
    h.observe(a, 10.5);
    h.flushOne();
    assert.equal(h.direction(a), -1);
    h.flushAll();
    assert.notEqual(h.entry(a).group, originalGroup, 'complete replacement is published');
    assert.equal(h.entry(a).group.direction, 1);
    assert.equal(h.direction(a), -1, 'unchanged active gesture must not become neutral merely because data refreshed');
    assert.equal(h.direction(b), -1);
});

test('a newly incompatible active group never reverses direction when replacement publishes', () => {
    const h = harness({direction: build => build === 1 ? 1 : -1});
    const n = note(), notes = [n], chords = [];
    h.schedule(notes, chords, new Map());
    h.flushAll();
    h.schedule([...notes], chords, new Map());
    assert.equal(h.direction(n), -1);
    h.observe(n, 10.5);
    h.flushAll();
    assert.ok(h.direction(n) === 0, 'conflicting replacement uses neutral cue instead of reversing an active bend');
});

test('replacement preparation cancels old callbacks and refuses stale publication', () => {
    const h = harness();
    const old = note(), fresh = note({s: 3});
    h.schedule([old], [], new Map());
    const staleTimer = h.pendingIds()[0];
    h.flushOne();
    const continuation = h.pendingIds()[0];
    h.schedule([fresh], [], new Map());
    const replacementJob = h.state().job;
    const replacementTimer = h.pendingIds()[0];
    assert.ok(!h.pendingIds().includes(continuation), 'old continuation is cancelled');
    h.invokeStale(staleTimer);
    assert.equal(h.state().job, replacementJob);
    assert.equal(h.state().timer, replacementTimer, 'stale callback cannot erase replacement timer ownership');
    h.flushAll();
    assert.equal(h.entry(old), undefined);
    assert.ok(h.entry(fresh));
    assert.equal(h.state().builderCalls, 2);
});

test('reset releases source identities, groups, and scheduled work without late publication', () => {
    const h = harness();
    const n = note(), view = {};
    h.schedule([n], [], new Map());
    h.copy(view, n);
    h.observe(n, 10.5);
    const staleTimer = h.pendingIds()[0];
    h.reset();
    assert.equal(h.pendingIds().length, 0);
    assert.equal(h.origin(view), undefined);
    assert.equal(h.state().observed, 0);
    assert.equal(h.state().notes, null);
    assert.equal(h.state().chords, null);
    assert.equal(h.state().count, 0);
    assert.equal(h.state().groups, 0);
    h.invokeStale(staleTimer);
    assert.equal(h.state().builderCalls, 0);
    assert.equal(h.entry(n), undefined);
});

test('destroyed renderers cannot advance or publish queued chart preparation', () => {
    const h = harness();
    const n = note();
    h.schedule([n], [], new Map());
    h.setDestroyed(true);
    h.flushAll();
    assert.equal(h.state().builderCalls, 0);
    assert.equal(h.entry(n), undefined);
    h.reset();
    assert.equal(h.state().job, null);
});

test('real chord scratch and copied queue views retain source identity and replace reused entries', () => {
    const h = harness({yields: 0});
    const a = note(), b = note({s: 3}), plain = note({s: 4, bn: 0});
    h.schedule([], [{t: 10, notes: [a, b]}], new Map());
    h.flushAll();
    const scratch = {}, queued = {};
    h.scratch(scratch, a, {t: 10});
    h.copy(queued, scratch);
    assert.equal(h.origin(scratch), a);
    assert.equal(h.origin(queued), a, 'queued views resolve to authored member, not shared scratch');
    assert.equal(h.entry(queued), h.entry(a));
    h.scratch(scratch, b, {t: 10});
    assert.equal(h.entry(scratch), h.entry(b));
    assert.equal(h.entry(queued), h.entry(a), 'later scratch reuse cannot reassign an earlier queued view');
    h.copy(queued, scratch);
    assert.equal(h.origin(queued), b);
    h.scratch(scratch, plain, {t: 10});
    h.copy(queued, scratch);
    assert.equal(h.entry(scratch), undefined);
    assert.equal(h.entry(queued), undefined, 'ordinary pooled notes cannot inherit a previous bend group');
    assert.equal(h.origin(queued), plain);
});

test('a bend observed through a pooled view pins its entire group at publication', () => {
    const h = harness();
    const a = note(), b = note({s: 3}), view = {...a};
    h.schedule([a, b], [], new Map());
    h.copy(view, a);
    h.observe(view, 10.5, view);
    h.flushAll();
    assert.equal(h.entry(a).group, h.entry(b).group);
    assert.equal(h.physicalDirection(a), 0);
    assert.equal(h.entry(a).group.reason, 'active-during-preparation');
    assert.ok(h.direction(a) === 0);
    assert.ok(h.direction(b) === 0, 'unobserved adjacent member follows the authoritative group');
    assert.equal(h.state().observed, 0);
    h.copy(view, a);
    assert.ok(h.direction(view) === 0);
    assert.equal(h.entry(a).direction, 1, 'fixture retains deliberately stale per-entry metadata');
});

test('pinning an active group also neutralizes precomputed collision dependents', () => {
    // These disconnected groups safely move together. Stopping only blue would
    // let the larger, later red bend cross it; the solver marks that dependency.
    const h = harness({shareComponents: true});
    const red = note({t: 11, s: 0, bn: 2.5, fixtureGroup: 0});
    const blue = note({t: 10, s: 2, sus: 4, bn: 1.5, fixtureGroup: 1});
    h.schedule([red, blue], [], new Map());
    h.observe(blue, 10.5);
    h.flushAll();
    assert.notEqual(h.entry(red).group, h.entry(blue).group, 'musical groups remain independent');
    assert.equal(h.entry(red).group.neutralComponent, h.entry(blue).group.neutralComponent);
    assert.equal(h.entry(red).group.neutralComponent.neutral, true);
    assert.ok(h.direction(red) === 0, 'future dependent cannot move across the pinned active string');
    assert.ok(h.direction(blue) === 0);
    assert.equal(h.entry(red).direction, 1, 'stale per-entry direction cannot bypass shared neutral state');
    const queued = {...red};
    h.copy(queued, red);
    assert.ok(h.direction(queued) === 0, 'pooled copies read the same dependency state');
    h.setInverted(true);
    assert.ok(h.direction(queued) === 0, 'display inversion cannot restore a neutralized dependency');
});

test('future and completed gestures are not pinned by the active-note observer', () => {
    const h = harness();
    const future = note({t: 20}), completed = note({t: 1});
    h.schedule([future, completed], [], new Map());
    h.observe(future, 10);
    h.observe(completed, 10);
    assert.equal(h.state().observed, 0);
    h.flushAll();
    assert.equal(h.direction(future), -1);
    assert.equal(h.direction(completed), -1);
});

test('pending observation is bounded and overflow keeps the chart neutral', () => {
    const h = harness();
    const notes = Array.from({length: 513}, () => note());
    h.schedule(notes, [], new Map());
    for (const n of notes) h.observe(n, 10.5);
    assert.equal(h.state().observed, 512);
    assert.equal(h.state().forceNeutral, true);
    h.flushAll();
    assert.ok(h.direction(notes.at(-1)) === 0);
    assert.equal(h.state().observed, 0);
});

test('repeated observation of the same notes at the retention cap does not count as overflow', () => {
    const h = harness();
    const notes = Array.from({length: 512}, () => note());
    h.schedule(notes, [], new Map());
    for (const n of notes) h.observe(n, 10.5);
    for (const n of notes) h.observe(n, 10.6);
    assert.equal(h.state().observed, 512);
    assert.equal(h.state().forceNeutral, false);
});

test('a retained globally neutral layout does not revive lateral movement during array refresh', () => {
    const h = harness();
    const notes = Array.from({length: 513}, (_, i) => note({fixtureGroup: i === 512 ? 1 : 0})), chords = [];
    h.schedule(notes, chords, new Map());
    for (const n of notes) h.observe(n, 10.5);
    h.flushAll();
    const unobserved = notes.at(-1);
    assert.equal(h.entry(unobserved).group.direction, 1, 'overflow note belongs to an unpinned independent group');
    assert.ok(h.direction(unobserved) === 0);
    h.schedule([...notes], chords, new Map());
    assert.ok(h.direction(unobserved) === 0, 'retaining a layout also retains its global neutral mode');
    h.observe(unobserved, 10.5);
    h.flushAll();
    assert.ok(h.direction(unobserved) === 0);
});

test('hot bend sampling only reads resolved entries and never advances preparation or creates textures', () => {
    const h = harness({yields: 0});
    const n = note();
    h.schedule([n], [], new Map());
    h.flushAll();
    const before = h.state();
    for (let i = 0; i < 10000; i++) {
        assert.equal(h.direction(n), -1);
        assert.equal(h.offset(n), -1);
    }
    const after = h.state();
    assert.equal(after.builderCalls, before.builderCalls);
    assert.equal(after.builderAdvances, before.builderAdvances);
    assert.equal(after.textures, before.textures);
    assert.deepEqual(after.stats, before.stats);
    assert.equal(h.pendingIds().length, 0);
});

test('ordinary sustain and empty-curve approach avoid layout lookups and bend sampling', () => {
    const h = harness();
    const ordinary = note({bn: 0}), emptyCurve = note({bn: 0, bnv: []});
    h.trapLayoutReads();
    for (let i = 0; i < 1000; i++) {
        assert.equal(h.offset(ordinary), 0);
        assert.equal(h.offset(emptyCurve), 0);
        assert.equal(h.prebend(ordinary), 0);
        assert.equal(h.prebend(emptyCurve), 0);
    }
    assert.equal(h.state().pitchSamples, 0);
    assert.equal(h.state().builderCalls, 0);
    assert.equal(h.state().textures, 0);
});

test('fallback texture warming is bounded and reuses labels across chart revisions', () => {
    const h = harness({yields: 0, direction: 0});
    const notes = Array.from({length: 40}, (_, i) => note({bn: (i + 1) / 10}));
    h.schedule(notes, [], new Map());
    h.flushAll();
    assert.equal(h.state().textures, 32);
    assert.equal(h.entry(notes[0]).pitchMat.label, '+0.1 st');
    assert.equal(h.entry(notes.at(-1)).pitchMat.label, 'BEND');
    h.schedule([...notes], [], new Map());
    h.flushAll();
    assert.equal(h.state().textures, 32, 'repeated chart preparation must not allocate duplicate label textures');
});

test('ordinary directional bend groups do not allocate unused fallback textures', () => {
    const h = harness({yields: 0});
    const notes = Array.from({length: 40}, (_, i) => note({bn: (i + 1) / 10}));
    h.schedule(notes, [], new Map());
    h.flushAll();
    assert.equal(h.state().textures, 0);
    assert.equal(h.entry(notes[0]).pitchMat, undefined);
});

test('pending curve-only bend keeps a finite neutral marker before its peak is prepared', () => {
    const h = harness();
    const n = note({bn: 0, bnv: [{t: 0, v: 0}, {t: 1, v: 2}]});
    h.schedule([n], [], new Map());
    const marker = h.marker(n);
    assert.equal(marker.shown, true);
    assert.equal(marker.material.label, 'BEND');
    assert.ok(Number.isFinite(marker.material.opacity));
    assert.equal(marker.material.opacity, .55);
    assert.equal(h.state().builderCalls, 0, 'drawing a pending marker does not synchronously prepare its peak');
});
