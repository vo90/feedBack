const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');

function extract(name) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw Error(name);
}

const visibility = new Function(`
    const NFRETS = 24;
    let _trailYieldEventsByFret;
    ${['isPlayableFret', 'isPlainDeadNote', 'isUnpitchedMute', 'hwyBuildTrailEventEndIndex', 'hwyBuildTrailYieldEvents',
        'trailYieldEventForNote'].map(extract).join('\n')}
    return {
        build(...args) { return _trailYieldEventsByFret = hwyBuildTrailYieldEvents(...args); },
        find: trailYieldEventForNote,
    };
`)();

test('unpitched mutes use open visibility footprints without rewriting authored identity', () => {
    const note = Object.freeze({ t: 10, s: 1, f: 127, mt: true, sus: 2 });
    const events = visibility.build([note], [], 6);
    assert.equal(events[0]?.length, 1);
    const event = events[0][0];
    assert.equal(event.f, 0);
    assert.equal(event.sourceFret, 127);
    assert.equal(event.sourceNote, note);
    assert.equal(visibility.find(note), event);
    assert.equal(note.f, 127);
    assert.equal(event.end, 12);
    assert.equal(event.trailVisible, false);
});

test('coincident real open and unpitched events stay distinct but exact chord copies deduplicate', () => {
    for (const reversed of [false, true]) {
        const notes = [{t: 10, s: 1, f: 0, sus: 1}, {t: 10, s: 1, f: 127, mt: true, sus: 2}];
        if (reversed) notes.reverse();
        const members = notes.map(({t, ...n}) => n);
        const events = visibility.build(notes, [{t: 10, notes: members}], 6)[0];
        assert.equal(events.length, 2);
        for (const note of notes) {
            const event = visibility.find(note);
            assert.equal(event.sourceFret, note.f);
            assert.equal(event.end, note.t + note.sus);
            assert.ok(event.standalone && event.chordMeta);
            assert.equal(visibility.find({...note}, note), event, 'scratch views keep authored fret identity');
        }
        assert.notEqual(visibility.find(notes[0]), visibility.find(notes[1]));
    }
});

test('unpitched chord members count toward open bounds without extending the fretted span', () => {
    const chord = {t: 10, notes: [{s: 0, f: 127, mt: true}, {s: 1, f: 5}, {s: 2, f: 7}]};
    const event = visibility.build([], [chord], 6)[0]?.[0];
    assert.ok(event);
    assert.deepEqual(event.chordMeta, {size: 3, minF: 5, maxF: 7});
    assert.equal(visibility.find({...chord.notes[0], t: chord.t}, chord.notes[0]), event);
});

test('invalid sentinel notes remain excluded', () => {
    const events = visibility.build([
        {t: 10, s: 0, f: 127}, {t: 10, s: 0, f: 128, mt: true},
        {t: 10, s: 8, f: 127, mt: true}, {t: 10, s: 0, f: -1, mt: true},
    ], [], 6);
    assert.equal(events.flat().length, 0);
});

test('mixed scrape and unpitched chord members preserve only the playable fretted span', () => {
    const chord = {t: 10, notes: [
        {s: 0, f: 127, mt: true},
        {s: 1, f: 19, mt: true, sus: 1,
            pick_scrape_marks: [{direction: 'down', start: 0, end: 1}]},
        {s: 2, f: 5}, {s: 3, f: 7},
    ]};
    const original = JSON.stringify(chord);
    const events = visibility.build([], [chord], 6);
    const mute = events[0].find(event => event.sourceNote === chord.notes[0]);
    const scrape = events[0].find(event => event.sourceNote === chord.notes[1]);
    assert.ok(mute && scrape, 'both visual-only members retain an open visibility footprint');
    assert.deepEqual(mute.chordMeta, {size: 4, minF: 5, maxF: 7});
    assert.deepEqual(scrape.chordMeta, mute.chordMeta);
    assert.equal(scrape.sourceFret, 19);
    assert.equal(visibility.find({...chord.notes[1], t: chord.t}, chord.notes[1]), scrape,
        'scrape trail keeps its authored identity despite its open visual footprint');
    assert.equal(JSON.stringify(chord), original, 'visibility must not rewrite authored notes');
});

test('unpitched visibility preserves linked membership, suppressed heads and chord hold ownership', () => {
    const note = {t: 10, s: 1, f: 127, mt: true, sus: 2};
    const membership = {path: {start: 9, end: 12}};
    const options = {suppressedAttacks: new Set([note]), linkedPaths: {byNote: new Map([[note, membership]])}};
    const event = visibility.build([note], [], 6, options)[0]?.[0];
    assert.ok(event);
    assert.equal(event.gemVisible, false);
    assert.equal(event.trailVisible, false);
    assert.equal(event.linkedPath, membership);
    const held = visibility.build([], [{t: 10, notes: [note]}], 6, {...options, trailVisible: () => false})[0][0];
    assert.equal(held.trailVisible, false);
    assert.equal(held.sourceNote, note);
});

function ordering() {
    return new Function(`
        let _trailYieldFrameId = 1;
        const renderOrderForLayerAtZ = (z, layer) => z + {
            NOTE_OUTLINE_BEHIND_TRAIL: .15, NOTE_CORE_BEHIND_TRAIL: .20,
            NOTE_FACE_BEHIND_TRAIL: .25,
        }[layer];
        function trailYieldConstrainOwnTrailBehindGem() {}
        ${['trailYieldApplyBehindLayerRecord', 'trailYieldApplyBehindLayers',
            'trailYieldSetTargetGemBehind', 'trailYieldRegisterGem',
            'trailYieldRegisterAttachment'].map(extract).join('\n')}
        return {register: trailYieldRegisterGem, attach: trailYieldRegisterAttachment,
            demote: trailYieldSetTargetGemBehind, nextFrame() {_trailYieldFrameId++;}};
    `)();
}

test('late attachments and duplicate emissions follow successively tighter final constraints', () => {
    const h = ordering(), event = {}, records = [];
    h.demote(event, 539.149);
    for (let i = 0; i < 2; i++) {
        const core = {renderOrder: 654.65}, face = {renderOrder: 654.70};
        const record = h.register(event, 654, {renderOrder: 654.60}, core, face);
        const meshes = [{renderOrder: 654.70}, {renderOrder: 654.70}];
        for (const mesh of meshes) h.attach(record, mesh);
        records.push({record, core, face, meshes});
    }
    assert.notEqual(records[0].record, records[1].record);
    h.demote(event, 510.149);
    for (const {core, face, meshes} of records) for (const mesh of meshes) {
        assert.ok(mesh.renderOrder > core.renderOrder);
        assert.ok(mesh.renderOrder > face.renderOrder);
        assert.ok(mesh.renderOrder < 510.149);
    }
});

test('reusing a record clears old attachments and restores unconstrained natural order', () => {
    const h = ordering(), event = {}, old = {renderOrder: 654.70};
    const register = () => h.register(event, 654, {renderOrder: 654.60}, {renderOrder: 654.65}, null);
    const first = register(); h.attach(first, old); h.demote(event, 500);
    const storage = first._trailYieldAttachments, oldOrder = old.renderOrder;
    h.nextFrame(); const next = register();
    assert.equal(next._trailYieldAttachments, storage);
    assert.equal(next._trailYieldAttachmentCount, 0);
    assert.equal(storage[0], null);
    const fresh = {renderOrder: 654.70}; h.attach(next, fresh);
    assert.equal(fresh.renderOrder, 654.70);
    h.demote(event, 400);
    assert.equal(old.renderOrder, oldOrder);
    assert.ok(fresh.renderOrder < 400);
});
