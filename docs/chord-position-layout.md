# Chord boxes and generated hand positions

## Implementation plan

1. Give fretted chord frames a shared shape-local bound: lowest fretted note,
   at least four fret cells, extended only for that shape. Use the same bounds
   for shared holds, handshape guides, open members and trail visibility.
   Clamp at the end of the modeled neck while retaining four cells.
2. Generate chord-aware position anchors in FeedForge. Chord attacks establish
   their own preferred position; overlapping sounding material and slide
   corridors remain covered. Release excess width when its demand ends.
   Single-note passages retain stable positions and bounded legato previews.
3. Backport the same pure position algorithm into the game for load-time
   compatibility. Only refresh hash-verified, FeedForge-owned anchors from
   older guidance. Do not modify archive files, musical events, authored
   anchors, edited guidance, or unknown policies. Handle difficulty levels.
4. Validate behavior with unit/integration regressions, all 14 current test
   library songs read-only, and background rendering checks where available.

## Acceptance examples

| Notes | Box |
|---|---|
| 5, 7, 7 | 5–8 |
| 7, 8 | 7–10 |
| 3, 5, 5 | 3–6 |
| 5, 10 | 5–10 |
| 22, 24 | 21–24 (neck boundary) |

In Rats, the 3→8 slide at 105.5375 lasts until 105.78625. Its 3–8
lane must not survive into the following 7–8, 3–5 and 5–7 chords unless
another sounding note independently requires those frets.

Open-only shapes inherit a contextual position. Mixed open/fretted shapes use
the fretted members. Unpitched mutes do not establish a position. Arpeggio
frames retain their complete template shape. Camera easing remains separate
from chord geometry and must consume the corrected positions in all modes.

## Cause and implemented behavior

The renderer previously reused a covering position anchor as the chord frame.
That made a chord inherit both the unused frets on the left and excess width
from an earlier slide or chord. The generator also retained a wide anchor until
three narrow attacks spanned at least one second. The combination explains the
reported boxes even though all their notes were technically inside the lane.

`chordShapeLaneBounds` now supplies the bounds for frames, held-chord guides,
authored strum groups, open chord members, trail footprints and hit-edge flashes.
Each shape starts at its lowest fretted member and occupies at least four cells.
It has no dependency on another chord's width. An all-open shape uses four cells
at the contextual anchor position. The neck-end clamp is the explicit exception
to placing the lowest note in the first cell.

Generated lanes give each chord attack a preferred position at its lowest
fretted note. They widen only for currently sounding material, including a
known slide corridor, and release excess width when that demand ends. A genuine
overlapping sustain can therefore keep the lane wider than a chord's own box.
Single-note passages retain the existing stable-position and compact explicit
hammer-on/pull-off anticipation rules. An open-only attack also releases a
previous wide span. Camera interpolation is unchanged.

## Existing imports and shared policy

FeedForge owns the canonical pure `generated_hand_positions.py`. The game
contains a byte-identical compatibility copy and its MIT license. Update both
copies together; the library audit rejects divergent source bytes.

New imports record `positionPolicy: chord-local-v1` in their guidance receipt
and import recipe. Explicit regeneration upgrades older owned positions. The
game refreshes old positions in memory only when both music and guidance hashes
match the recognized FeedForge receipt. Authored anchors, edited data, unknown
policies and unsupported inputs retain their original positions. Phrase-level
guidance is checked with inherited chart metadata and clipped to its window.
The load adapter changes no notes, timings, templates or archive files.

## Verification

- 848 highway JavaScript tests passed, including partial-hit frame feedback.
- 202 Python loader, wire-format and arrangement tests passed; the final
  compatibility-only run passed all 11 cases after adding a future-policy guard.
- 82 targeted FeedForge guidance tests passed.
- Full FeedForge suite: 4,424 passed, five skipped, one subprocess import-path
  failure. That remaining end-to-end test passed with the isolated checkout's
  `src` supplied through `PYTHONPATH`. The earlier general-purpose environment
  also lacked the required `yt-dlp-getpot-wpc` distribution; the full run used
  the existing prepared FeedForge build environment instead.
- Read-only audit: 64 arrangements in 14 songs; 50 changed position layouts.
  Independent active-fret coverage checks passed, canonical policy copies
  matched, and all source music and archive hashes were unchanged.
- Actual headless WebGL: 50 RS+ cases and four Current-style Rats cases passed,
  including both camera modes and left-handed views. Checks measure the rendered
  chord meshes as well as the helper results; screenshots were inspected.

Reproduce the library audit with `tools/audit_generated_positions.py --library
<read-only library> --feedforge-source <checkout> --out <report directory>`.
Pass its `rats-after.json` to the browser harness using `--position-chart`.
Use `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` to select an existing
Playwright installation and headless browser without launching the game.

## Runtime boundary

Implementation and tests run in isolated worktrees. Runtime integration is a
separate step: merge the reviewed Core and FeedForge commits into the selected
Songsterr branches, build FeedForge from that revision, and use the paired-runtime
plan/apply/seal/check lifecycle before launching. Keep the previous package and
refresh history; preserve the real library and both app profiles.
