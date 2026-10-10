# Hand-shape guides must not create attacks

## Implementation plan

1. Reproduce the C and D passages reported in Boston's *Don't Look Back*,
   Lead arrangement, using small chart fixtures.
2. Treat every synthesized hand shape as positional guidance. Do not depend
   on the presence of nearby single notes or widen the 28 ms merge tolerance.
3. Preserve chord names, fingering projections and authored arpeggio guidance;
   remove synthesized attack bodies, ordinary strum boxes and incoming attack
   fret numbers. Keep authored notes, chord members and their timings intact.
4. Carry an explicit guidance flag through the deferred note draw queue so
   attack bodies cannot return at the play line. Exclude guides from note
   verdict queries, hit feedback and trail-overlap participation.
5. Verify the reported passages, approach/arrival/rewind, pooled draw reuse,
   real chord attacks and the existing 3D renderer regression suites.

## Evidence and implementation

The C hand shapes start at 45.601002 and 116.606003 seconds; their actual
two-string attacks occur at 45.632999 and 116.637001. The D shape starts at
55.688, followed by its two-string attack at 55.720001. These 31–32 ms gaps
exceed the renderer's 28 ms coincidence tolerance. No matching standalone
note occurs inside the old 260 ms suppression window, so full template
chords became visible alongside the real partial chords.

Synthetic chords now always suppress their ordinary strum presentation.
The note drawing queue receives `guidanceOnly`, which suppresses heads and
trails throughout their lifetime and does not request scoring feedback.
Ordinary shape names use a separate muted label when no enclosure is drawn.
Existing fretboard projections and explicitly authored arpeggio enclosures
remain available. Real attacks use the unchanged default drawing path.

## Validation

All 936 tests in `tests/js/highway_3d*.test.js` pass; JavaScript syntax and
Git whitespace checks also pass.

- The five new chart/queue regressions fail against the original renderer.
- All three reported passages retain exactly two authored attack heads.
- Guidance stays non-playable through approach, arrival, linger and rewind.
- Empty and delayed passages do not generate fallback attacks.
- Reused draw records restore normal heads and sustains for real notes.
- Regression coverage also checks dispatch, label suppression and verdict
  culling; the existing chord, arpeggio, sustain, slide and technique suites pass.

This is a renderer-only source change. Song packages and scoring inputs are
unchanged. Validation uses executable renderer tests, not an interactive
in-game visual inspection. The running runtime has not been updated.
