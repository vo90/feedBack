# Chord technique shared holds

## Implementation plan

1. Represent known palm-muted chord durations with the existing shared hold
   border. Keep mute symbols and attack cues; standalone notes keep their trails.
2. Compare complete, contiguous, explicitly marked hammer-on/pull-off sequences
   when deciding whether chord strings have a common release. Retain the moving
   strings' gems and trails and suppress only the redundant ordinary trails.
3. Preserve unequal-release exceptions, ambiguous events, other moving
   techniques, arpeggio handling, legacy unknown-duration safeguards, and input
   note/scoring data. Build the decision once per chart, not every draw.
4. Verify pure hold decisions, actual trail eligibility, and WebGL rendering in
   Current and RS+ styles. Include the two Green Lung examples, multi-step and
   multi-string legato, open-string pull-offs, repeats, seeks and invalid links.

## Intended behavior

- A chord border communicates its shared hold; palm mute does not by itself
  require a separate sustain ribbon.
- Hammer-on/pull-off notes retain their own technique symbols and trails.
- Differing releases or independent motion keep the trails needed to explain
  them. Uncertain links never extend a shared hold.
- Dead-note strikes do not gain sustains. Single notes remain unchanged.
- All changes are presentation-only; authored sustains remain untouched.

## Implementation details

The chart-static hold resolver now accepts palm-muted members with known
durations. A handshape alone still cannot invent a duration for a muted hit.
Repeated uniformly muted chords can use the existing compact repeat frame and
its mute symbol; mixed muting keeps the individual marked gems visible.

For legato, the resolver examines the next event on each string. An explicit
hammer-on or pull-off destination, the correct fret direction, positive known
durations and a contiguous boundary (the existing 1 ms link tolerance) are
required. No `ln` flag is required when the destination itself explicitly marks
HO/PO, but `ln` alone never proves a hammer-on/pull-off. The backwards scan
resolves long chains without repeated traversal. Exact duplicate events are
accepted; conflicting coincident events, intervening picks, genuine overlaps,
gaps, invalid durations and other motion techniques retain individual notation.

Only the display's comparison duration uses the complete sequence. Ordinary
members that share its release use the border; legato members keep their trails
and gems, including incoming HO/PO members of another chord. A chord containing
only independent technique members retains its existing individual notation.
Existing majority-release, arpeggio, overlap and dead-note rules still apply.

## Verification

Regression coverage includes explicit palm-muted chords, mixed muting, standalone
open notes, repeated mute symbols, multi-step HO/PO, open-string pull-offs,
multiple moving strings, chord destinations, duplicates, unequal releases and
ambiguous timing. Frozen chart fixtures verify that input data is unchanged.

The existing WebGL acceptance harness checks both Current and RS+ styles, trail
visibility, shared-border endpoints, seeking and cache reuse. Its optional
`--evil-chart` input accepts an extracted Hybrid Lead arrangement from the
reported Green Lung import for read-only acceptance of both screenshot passages.
No song fixture, audio, generated runtime or library data belongs in this commit.

Acceptance on 2026-10-01: 285 related Node tests passed; 48 WebGL cases passed
in each of Current and RS+ (96 total), including both actual imported passages.
Screenshots confirmed the retained mute marks, removed palm-muted chord trails,
and independent blue legato trails beside the shared chord border. The running
Songsterr integration and the original FeedPak were not modified by these checks.
