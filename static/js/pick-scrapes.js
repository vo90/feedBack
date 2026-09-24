// Unpitched, visual-only gesture. Geometry is illustrative; source frets are
// retained in the chart but never become a destination, pitch or camera target.
export function isPickScrape(n) {
    return n?.mt === true && Array.isArray(n.pick_scrape_marks) && n.pick_scrape_marks.length > 0;
}

export function scrapeAt(n, relativeTime) {
    return n.pick_scrape_marks.find(m => relativeTime >= m.start && relativeTime <= m.end);
}

export function scrapeProgress(mark, relativeTime) {
    return Math.max(0, Math.min(1, (relativeTime - mark.start) / (mark.end - mark.start)));
}

export function scrapePosition(mark, progress) {
    const direction = mark.direction === 'up' ? 1 : -1;
    return direction * (2 * progress - 1) + .07 * Math.sin(progress * Math.PI * 36);
}

export function scrapeFade(n, mark, progress) {
    // A direction change inside a held scrape is a continuous gesture.
    if (n.pick_scrape_marks.some(m => m !== mark && Math.abs(m.start - mark.end) < 1e-6)) return 1;
    return Math.min(1, Math.max(0, (1 - progress) / .16));
}
