const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let buildLyricLines, getLyricLines;
before(async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../static/js/lyric-lines.js'), 'utf8');
    ({ buildLyricLines, getLyricLines } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
});
const token = (t, w, d = 0.2) => ({ t, d, w });
const sequence = (count, step = 0.5) => Array.from({ length: count }, (_, i) => token(i * step, `unit${i}`));
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
function checkedBuild(input) {
    const before = JSON.stringify(input);
    freeze(input);
    const lines = buildLyricLines(input);
    const flattened = lines.flatMap(line => line.words.flat());
    assert.equal(flattened.length, input.length, 'every input occurrence survives exactly once');
    flattened.forEach((item, i) => assert.equal(item, input[i], 'original token identity and order survive'));
    assert.equal(JSON.stringify(input), before, 'text, start, duration and metadata remain unchanged');
    for (const line of lines) {
        const tokens = line.words.flat();
        assert.ok(tokens.length > 0);
        assert.equal(line.start, tokens[0].t);
        assert.equal(line.end, Math.max(...tokens.map(t => t.t + t.d)));
        assert.deepEqual(Object.keys(line).sort(), ['end', 'start', 'words'], 'no concatenated full-phrase string');
    }
    return lines;
}
function safeFallbackBoundaries(lines) {
    for (let i = 1; i < lines.length; i++) {
        assert.ok(lines[i].start > lines[i - 1].start, 'equal starts cannot create a new phrase');
        assert.ok(lines[i].start >= lines[i - 1].end, 'earlier active tokens cannot be hidden');
    }
}

test('empty input has no phrases and its empty cached result is reused', () => {
    const input = freeze([]);
    assert.deepEqual(buildLyricLines(input), []);
    assert.deepEqual(getLyricLines(input), []);
    assert.equal(getLyricLines(input), getLyricLines(input));
});

test('fallback preserves every frozen token identity, exact timing, text and metadata', () => {
    const input = sequence(112, 0.4).map((t, i) => ({ ...t, d: 0.125 + (i % 3) * 0.025, source: { index: i } }));
    input[4].w = 'syn-';
    input[5].w = 'thetic';
    input[19].w = 'écho?';
    const lines = checkedBuild(input);
    assert.ok(lines.length > 10);
    assert.ok(lines.some(line => line.words.some(word => word.length === 2)));
    safeFallbackBoundaries(lines);
});

test('ordinary authored plus endings retain a fourteen-word phrase and following phrase', () => {
    const input = sequence(18, 0.35);
    input[13].w += '+';
    input[17].w += '+';
    const lines = checkedBuild(input);
    assert.deepEqual(lines.map(l => l.words.length), [14, 4]);
    assert.equal(lines[0].words[13][0], input[13]);
    assert.equal(lines[1].words[0][0], input[14]);
});

test('an authored final word held for thirteen seconds remains in its original phrase', () => {
    const input = [token(0, 'synthetic'), token(0.5, 'phrase'), token(1, 'ending+', 13)];
    const lines = checkedBuild(input);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].words.length, 3);
    assert.equal(lines[0].end, 14);
    assert.equal(lines[0].words[2][0].d, 13);
});

test('a large unmarked block becomes short phrases without dropping its final tokens', () => {
    const input = sequence(120, 0.45);
    const lines = checkedBuild(input);
    assert.ok(lines.length >= 15);
    assert.ok(lines.every(line => line.words.length <= 8));
    assert.ok(lines.every(line => line.end - line.start <= 6));
    assert.equal(lines.at(-1).words.at(-1).at(-1), input.at(-1));
    safeFallbackBoundaries(lines);
});

test('fallback prefers a meaningful pause after a short phrase', () => {
    const input = sequence(24, 0.5);
    for (let i = 3; i < input.length; i++) input[i].t += 1;
    const lines = checkedBuild(input);
    assert.deepEqual(lines[0].words.flat(), input.slice(0, 3));
    assert.equal(lines[1].start, input[3].t);
    safeFallbackBoundaries(lines);
});

test('fallback can end at punctuation before reaching its size target', () => {
    for (const mark of ['.', '!', '?', ';', ':']) {
        const input = sequence(24, 0.5);
        input[2].w += mark;
        const lines = checkedBuild(input);
        assert.deepEqual(lines[0].words.flat(), input.slice(0, 3), mark);
        safeFallbackBoundaries(lines);
    }
});

test('hyphen-joined syllables stay one word even across gaps longer than four seconds', () => {
    const input = [token(0, 'joined-'), token(5, 'synthetic-'), token(10, 'word'),
        ...sequence(24, 0.5).map(t => ({ ...t, t: t.t + 10.5 }))];
    const lines = checkedBuild(input);
    const joined = lines.flatMap(line => line.words).find(word => word.includes(input[0]));
    assert.deepEqual(joined, input.slice(0, 3));
    assert.equal(lines[0].start, 0);
    assert.ok(lines[0].end >= 10.2);
    safeFallbackBoundaries(lines);
});

test('overlapping and equal-start words may exceed phrase targets without hiding active tokens', () => {
    const equal = Array.from({ length: 24 }, (_, i) => token(0, `equal${i}`, 0.5));
    assert.equal(checkedBuild(equal).length, 1);
    const overlap = sequence(50, 0.2);
    overlap[0].d = 5;
    const lines = checkedBuild(overlap);
    assert.ok(lines[0].words.length > 8);
    assert.ok(lines.length > 1);
    safeFallbackBoundaries(lines);
});

test('a gap after a short token cannot flush a longer earlier token that is still active', () => {
    const input = [token(0, 'long', 10), token(1, 'short', 0.1), token(6, 'later', 0.2)];
    const lines = checkedBuild(input);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].end, 10);
    safeFallbackBoundaries(lines);
});

test('a real long silence retains the established separation between short unmarked phrases', () => {
    const input = [token(0, 'first'), token(0.5, 'part'), token(5, 'next'), token(5.5, 'part')];
    const lines = checkedBuild(input);
    assert.deepEqual(lines.map(l => l.words.length), [2, 2]);
    assert.equal(lines[1].start, 5);
});

test('clearly pathological authored blocks use fallback for token, character or duration excess', () => {
    const tooManyTokens = sequence(81, 0.2).map(t => ({ ...t, w: 'x' }));
    const tooManyCharacters = sequence(12, 0.3).map(t => ({ ...t, w: 'synthetic'.repeat(6) }));
    const tooLong = sequence(21, 2.3).map(t => ({ ...t, w: 'x' }));
    for (const input of [tooManyTokens, tooManyCharacters, tooLong]) {
        input.at(-1).w += '+';
        const lines = checkedBuild(input);
        assert.ok(lines.length > 1);
        assert.ok(lines.every(line => line.words.length <= 8));
        safeFallbackBoundaries(lines);
    }
});

test('an indivisible long token can exceed display targets without retiming or truncation', () => {
    const input = [token(4.125, 'synthetic'.repeat(70), 65.75)];
    const lines = checkedBuild(input);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].words.length, 1);
    assert.equal(lines[0].start, 4.125);
    assert.equal(lines[0].end, 69.875);
    assert.equal(lines[0].words[0][0], input[0]);
});

test('cache reuse is identity-based, independent across charts, and needs no scan after seeks', () => {
    const original = freeze(sequence(100, 0.4));
    let rejectReads = false;
    const guarded = new Proxy(original, { get(target, key, receiver) {
        assert.equal(rejectReads, false, `cached chart was scanned at ${String(key)}`);
        return Reflect.get(target, key, receiver);
    } });
    const groups = getLyricLines(guarded);
    const secondInput = freeze(sequence(100, 0.4));
    const second = getLyricLines(secondInput);
    assert.notEqual(groups, second);
    assert.equal(second[0].words[0][0], secondInput[0]);
    rejectReads = true;
    for (const time of [30, 0, 12, 39, 2, 25, -1]) {
        const retrieved = getLyricLines(guarded);
        assert.equal(retrieved, groups);
        // The same precomputed groups support forward/backward consumer lookup.
        const selected = retrieved.findLast(line => line.start <= time);
        assert.equal(selected, groups.findLast(line => line.start <= time));
        assert.equal(getLyricLines(secondInput), second);
    }
    assert.equal(groups[0].words[0][0], original[0]);
});

test('production lyric ingestion prepares the shared cache and replaces it for a fresh message', () => {
    const host = fs.readFileSync(path.join(__dirname, '../../static/highway.js'), 'utf8');
    const start = host.indexOf("case 'lyrics':");
    const end = host.indexOf("case 'tone_changes':", start);
    assert.ok(start >= 0 && end > start, 'actual WebSocket lyric ingestion case exists');
    const receive = new Function('hwState', 'msg', 'getLyricLines',
        `switch (msg.type) { ${host.slice(start, end)} }`);
    const state = {}, first = sequence(100, 0.4);
    first.forEach(freeze);
    const cachedFirst = getLyricLines(first);
    receive(state, { type: 'lyrics', data: first, source: 'notechart' }, getLyricLines);
    assert.equal(state.lyrics, first);
    assert.equal(state.lyrics._lines, cachedFirst);
    assert.equal(state.lyricsSource, 'notechart');
    assert.equal(state.lyrics._lines[0].words[0][0], first[0]);

    const fresh = sequence(100, 0.7);
    fresh.forEach(freeze);
    receive(state, { type: 'lyrics', data: fresh }, getLyricLines);
    assert.equal(state.lyrics, fresh);
    assert.equal(state.lyrics._lines, getLyricLines(fresh));
    assert.notEqual(state.lyrics._lines, cachedFirst);
    assert.equal(state.lyrics._lines[0].words[0][0], fresh[0]);
    assert.equal(state.lyricsSource, '');
    assert.equal(getLyricLines(first), cachedFirst, 'the earlier chart keeps its independent cache');
});
