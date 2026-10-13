// Display-only phrase boundaries. Tokens retain their original identity, text,
// start time and duration; no timing is inferred within a word or syllable.
// Each chart array owns its cache entry, so separate highways cannot overwrite
// one another and discarded songs do not remain reachable through this cache.
const lineCache = new WeakMap();

const OVERSIZED_WORDS = 16;
const OVERSIZED_CHARACTERS = 100;
const OVERSIZED_SECONDS = 12;
const TARGET_WORDS = 8;
const TARGET_CHARACTERS = 60;
const TARGET_SECONDS = 6;
const PHRASE_PAUSE_SECONDS = 0.45;

function visibleText(token) {
    const text = token.w || '';
    return text.endsWith('+') || text.endsWith('-') ? text.slice(0, -1) : text;
}

function boundLine(line, output, authoredEnd) {
    const words = line.words;
    const characters = words.reduce((count, word) => count
        + word.reduce((sum, token) => sum + visibleText(token).length, 0), 0);
    // Authored phrasing can legitimately include a long held final word or
    // more than eight short words. Only replace clearly excessive authored
    // blocks (the same scale Library Doctor warns about), not normal phrasing.
    const tokens = words.reduce((count, word) => count + word.length, 0);
    if (authoredEnd && tokens <= 80 && characters <= 500 && line.end - line.start <= 45) {
        output.push(line);
        return;
    }
    if (words.length <= OVERSIZED_WORDS && characters <= OVERSIZED_CHARACTERS
        && (line.end - line.start <= OVERSIZED_SECONDS || words.length <= 1)) {
        output.push(line);
        return;
    }

    let chunk = null, chunkCharacters = 0, previousText = '';
    for (const word of words) {
        const start = word[0].t;
        const end = word.reduce((latest, token) => Math.max(latest, token.t + token.d), start);
        const wordCharacters = word.reduce((sum, token) => sum + visibleText(token).length, 0);
        // The renderer selects the most recently started phrase. Never create
        // a new boundary while any earlier token is still sounding, including
        // equal-start words. An inseparable long word/overlap may exceed targets.
        const safeBoundary = chunk && start > chunk.start && start >= chunk.end;
        if (safeBoundary) {
            const pause = start - chunk.end;
            const naturalEnd = (pause >= PHRASE_PAUSE_SECONDS || /[.!?;:]$/.test(previousText))
                && (chunk.words.length >= 3 || chunk.end - chunk.start >= 2);
            const exceedsTarget = chunk.words.length >= TARGET_WORDS
                || chunkCharacters + wordCharacters > TARGET_CHARACTERS
                || Math.max(chunk.end, end) - chunk.start > TARGET_SECONDS;
            if (naturalEnd || exceedsTarget) {
                output.push(chunk);
                chunk = null;
                chunkCharacters = 0;
            }
        }
        if (!chunk) chunk = { words: [], start, end };
        chunk.words.push(word);
        chunk.end = Math.max(chunk.end, end);
        chunkCharacters += wordCharacters;
        previousText = visibleText(word[word.length - 1]);
    }
    if (chunk) output.push(chunk);
}

export function buildLyricLines(lyrics) {
    const lines = [];
    let line = null, word = null;
    const flushWord = () => {
        if (word && word.length) line.words.push(word);
        word = null;
    };
    const flushLine = (authoredEnd = false) => {
        flushWord();
        if (line && line.words.length) boundLine(line, lines, authoredEnd);
        line = null;
    };

    for (const token of lyrics) {
        const raw = token.w || '';
        // Preserve authored '+' endings and the existing long-silence fallback.
        // A silence alone cannot divide an explicitly joined syllable chain.
        if (line && !word && token.t - line.end > 4) flushLine();
        if (!line) line = { words: [], start: token.t, end: token.t + token.d };
        if (!word) word = [];
        word.push(token);
        line.end = Math.max(line.end, token.t + token.d);
        if (!raw.endsWith('-')) flushWord();
        if (raw.endsWith('+')) flushLine(true);
    }
    flushLine();
    return lines;
}

export function getLyricLines(lyrics) {
    let lines = lineCache.get(lyrics);
    if (!lines) {
        lines = buildLyricLines(lyrics);
        lineCache.set(lyrics, lines);
    }
    return lines;
}
