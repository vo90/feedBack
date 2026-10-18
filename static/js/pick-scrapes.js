// Unpitched, visual-only gesture. Geometry is illustrative; source frets are
// retained in the chart but never become a destination, pitch or camera target.
export function isPickScrape(n) {
    return n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0;
}

export function scrapeAt(n, relativeTime) {
    // At a tied boundary the new direction owns the cue. Searching backwards
    // also keeps fractional clock cancellation from hiding a valid endpoint.
    for (let i = n.pick_scrape_marks.length - 1; i >= 0; i--) {
        const mark = n.pick_scrape_marks[i];
        if (relativeTime >= mark.start - 1e-9 && relativeTime <= mark.end + 1e-9) return mark;
    }
}

export function scrapeCueMark(n, relativeTime) {
    return scrapeAt(n, relativeTime)
        || n.pick_scrape_marks.find(mark => mark.start > relativeTime);
}

export function scrapeCaption(n, relativeTime) {
    const mark = scrapeCueMark(n, relativeTime);
    // Preserve the source's up/down notation without claiming a fret path or
    // a physical bridge/nut direction. This symbol is readable in lefty too.
    return 'PICK SCRAPE' + (mark?.direction === 'up' ? ' ↗' : mark?.direction === 'down' ? ' ↘' : '');
}

export function scrapeGroupKey(n, onset = n.t) {
    // Only matching gestures share a caption: same attack, duration and every
    // direction interval. Source frets and string numbers do not define it.
    return `${onset}:${n.sus}:` + n.pick_scrape_marks
        .map(mark => `${mark.start}:${mark.end}:${mark.direction}`).join('|');
}

export function scrapeProgress(mark, relativeTime) {
    return Math.max(0, Math.min(1, (relativeTime - mark.start) / (mark.end - mark.start)));
}

export function scrapePosition(mark, progress) {
    // A compact rough texture around the fixed anchor, never a fret-to-fret
    // sweep. Direction belongs in the cue, not in invented travel distance.
    if (progress <= 0 || progress >= 1) return 0;
    return .055 * Math.sin(progress * Math.PI * 36) + .025 * Math.sin(progress * Math.PI * 14);
}

export function scrapeFade(n, mark, progress) {
    // A direction change inside a held scrape is a continuous gesture.
    if (n.pick_scrape_marks.some(m => m !== mark && Math.abs(m.start - mark.end) < 1e-6)) return 1;
    return Math.min(1, Math.max(0, (1 - progress) / .16));
}
