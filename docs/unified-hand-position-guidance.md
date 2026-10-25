# One displayed hand-position lane

## Implementation plan

Preserve valid authored hand positions. Do not force every chord to its lowest
fret: the Die With Your Boots On 3/5 chords remain in their valid 2–5 position.
Remove independently drawn handshape floor strips. A supported complete grip
may extend the single main lane; unsupported guidance must not produce phantom
positions, synthetic chord frames, or arpeggio brackets.

1. Add a pure, chart-static handshape evidence model. Compare actual string/fret
   contacts, compatible incoming holds, and timed slide destinations with the
   complete referenced template. Distinguish supported, contradicted, and
   unresolved shapes. Keep the musical input unchanged, including notes,
   chords, timing, techniques, templates, and the archived source records.
2. Compose supported grip demands into the existing resolved position timeline.
   Retain containing positions. Extend only to the actual required frets, not
   the padding of a second four-fret guide. Restore the underlying timeline at
   each grip end and handle simultaneous demands deterministically.
3. Integrate the same cached evidence and effective timeline into both camera
   modes. Main floor, gold fret row, chord boxes, and chord/open-note geometry
   consume the composed positions. Synthetic frames, handshape brackets and
   associated positional metadata consume only accepted presentation shapes.
   Remove the additional handshape-floor rendering path. Preserve genuine
   musical sustain trails and hold timing.
4. Cache by effective notes/chords/anchors/handshapes/templates and streamed
   counts/string count. Seeking and per-frame updates reuse chart-static work;
   arrangement, difficulty, and relevant display-view replacement invalidate it.
5. Test the pure policy, renderer integration and cache lifecycle. Re-run the
   existing highway regressions; replay the prior bounded real-library sample
   read-only; inspect isolated WebGL screenshots in both notation styles and
   camera modes. Use anonymized minimal chart fragments for tracked tests.

## Acceptance examples

| Case | Required result |
|---|---|
| Valid 3/5 power chord in an authored 2–5 position | Keep 2–5; no new shift |
| Picked full grip 3,5,7 over a 3–6 lane | One 3–7 lane during the grip |
| Stale 5/7 handshape over actual repeated 7/9 chords | No stale guide; retain correct 7–10 lane |
| Stale five-string shape over a different pitched/muted chord | No phantom old position |
| Slide 2→5 followed by matching 4/5 contacts | Retain supported target guidance; cover actual required frets |
| Unsupported overlapping lower-string arpeggio | No competing lane or fabricated grip |
| Held notes spanning a real position change | Preserve their actual musical trails |
| Backward seek or difficulty change | Deterministic positions; no stale cache |

The real song library and installed runtime are not implementation targets.
Source changes stay in this isolated Core branch. No publication or runtime
promotion is part of this change.

## Validation results

The implementation follows the plan above. Guidance is compiled once from the
effective arrangement/difficulty and cached across playback and seeking. A
template needs matching contacts on at least two of its strings; notes may be
picked separately, carried into the interval, or reached by a timed slide.
Partial chords do not by themselves invalidate a larger grip. A clearly
incompatible replacement chord clips or rejects the old presentation interval.
Unresolved shapes do not create synthetic frames or positional ghosts.
Rejected metadata can still supply an unambiguous end boundary that prevents
arpeggio inference from borrowing notes from the next passage. That boundary
never supplies a chord shape, blue frame or positional guide.

The single lane also includes simultaneous real fretted contacts while a
supported grip is active. Their demands end at the clipped musical sustain;
zero-length attacks retain a 1.002 ms interval for exact-onset coverage. A
historical resolved chord anchor does not imply a note is still sounding.
Existing musical sustain rails remain distinct from hand-position guidance.

- Highway JavaScript regressions: 1,891 passed, four existing failures. All four
  were reproduced on the unchanged integration baseline: the audio barrier
  source assertion, two note-state source assertions, and the frozen
  presentation-clock hash assertion. No new failure remains.
- Existing isolated WebGL hold suite: 86 cases passed in each notation style
  (172 total), including sustain timing, slides, legato, muted/open notes,
  left-handed/inverted layouts, bass and eight strings. Unsupported-preview
  expectations were replaced with explicit absence assertions and a supported
  picked-arpeggio positive control.
- A new browser regression first reproduced a lost real chord gem when a
  rejected handshape's timing boundary was discarded. Keeping only that
  negative boundary restores the real gem without restoring the rejected blue
  frame. Both the JavaScript and actual-WebGL regression pass.
- The focused policy, independent fixture and renderer-cache tests cover
  replacement metadata, source immutability, backward seeks, streamed growth,
  difficulty changes, overlapping grips and simultaneous remote notes.
- Source syntax checks and `git diff --check` pass.
- Read-only library replay: 630 unique charts from 306 packages (647
  arrangement entries, including 17 duplicates), in both camera modes. No
  actual-chord or accepted-grip coverage failures, loader errors, or input
  mutations. The model accepted 98,386 handshapes, contradicted 77 and left
  1,634 unresolved. This classification controls presentation only.
- Cross-camera visual matrix: 28 cases and 44 forward/backward seek samples
  passed for the representative songs and muted/open/sustain controls. The checks
  compare the displayed main floor, gold fret span, chord frames and arpeggio
  cues; the separate cyan handshape floor pass has been removed.

Real-library replay and the cross-camera screenshot matrix are recorded in
the local implementation verification artifacts. The replay is a bounded
sample, not a claim that every arrangement in the library has been checked.
The final timing-boundary and empty-cache corrections affect renderer
integration, not the replayed lane-composition policy. Final browser checks
cover those corrections; the policy module used by the replay is unchanged.
A final nine-chart representative replay also passed on the completed renderer,
with unchanged inputs and no chord or supported-grip coverage failures in either
camera mode.

## Sliding chord correction

The initial composition treated each slide's source and destination as a single
simultaneous contact span for its entire sustain. Because both chord frames and
the main floor correctly consume the same position, this enlarged both of them:
a 3/5 chord sliding to 15/17 could create a 3–17 box. The correction belongs in
the shared position demands, rather than in a separate box-width override.

Keep handshape validation and slide-destination evidence unchanged. A moving
note supplies its source at onset (the existing 1.002 ms exact-onset interval),
but its travel path is not a held grip. A valid authored `slide_interval` retains
the actual stationary source prefix and destination tail. Both are clipped by
the next pick on the same string; an interrupted slide remains classified as
moving even when it can no longer provide destination evidence. A link flag by
itself does not invent a destination hold after the written sustain. Ordinary
stationary notes retain their full clipped duration and can still require a
genuinely wide position alongside another supported grip.

The existing position timeline, camera visibility constraints, and sustain
ribbons continue to describe movement. No new lane is drawn, and no frame-only
bounds are introduced. The source chart, accepted handshapes, slide timing,
geometry and authored positions are unchanged.

Regression coverage includes both camera pipelines with their actual region
builder and cache, both fret-spacing modes, short upward and downward slides,
long pitched and unpitched slides, delayed slide intervals, interruptions,
stationary remote holds, difficulty replacement, and reverse seeks. Actual
WebGL checks compare main-floor and frame bounds and inspect the moving
ribbon's path, endpoints and camera visibility in both notation styles.

Correction validation:

- All 1,947 highway JavaScript tests pass across 160 test files. The new policy
  regressions fail against the previous module. Two existing sustain tests also
  needed their harness parameter updated to the renderer's current
  `trailOpenWScale` name; their behavioral assertions are unchanged.
- A read-only replay of ten complete library charts covers 265 sliding chords
  and 3,972 total chord onsets in each of four camera/spacing combinations.
  In every combination, 242 slide frames narrow, 23 remain unchanged, none grow,
  and no chord-onset coverage failure or frame/main-lane mismatch occurs.
  Input hashes and the complete accepted-handshape, decision and validated-grip
  arrays remain identical.
- Chasing Light's 88.207 s upward slide changes from 3–7 to 3–6, followed by
  its authored 5–8 destination position. Its 90.846 s downward slide changes
  from 2–6 to 3–6. Other checks include Everything Zen (1–12 to 1–4),
  Digital Bath (12–17 to 14–17), Stray Cat Strut (1–16 to 13–16), and
  Always Alright's already compact 2–5 position, which stays unchanged.
- The complete isolated WebGL hold suite passes in both notation styles,
  including twelve new slide scenarios per style, forward/backward seek
  samples, exact ribbon paths/endpoints and viewport containment. The new
  compact-width checks reproduce the old failure on the unchanged baseline.
