# Authored ghost notes on the guitar/bass highway

This change preserves an explicitly authored `ghost: true` through the song
model, FeedPak arrangement loader and note/chord wire serialization. It means a
parenthesized/quiet attack; it does not imply a dead/muted note, tie, new pitch,
extra attack or grading rule. Absent, false and non-boolean values do not enable
the marker. A note may independently have both `ghost` and `mt`/`fhm`.

## Display

The 3D gem's existing outline and core meshes contain two curved parentheses.
They use shared geometry; there is no floating fret number, sprite, extra mesh
or per-note draw call. The body keeps its usual gradient and the core brackets
use a pale string tint for contrast. Palette updates repaint both. Accent and
extended-string fallback materials retain their existing string-color behavior.

Because the brackets belong to the actual meshes, they share gem position,
approach rotation, slide/bend movement, open-string/chord scaling, hit scale,
visibility, culling, pooling and trail order. The existing physical-order pass
can move the complete marked gem behind a covering trail in every visibility
mode. Bracket extents participate in the fretted/open and rotated-gem footprint
calculations; ordinary notes keep their geometry and appearance.

Open-string slabs keep their thin bodies, but their side parentheses keep
normal-gem curve proportions instead of stretching with the slab. Each pooled
mesh owns at most one reusable open-ghost geometry; source string/palette colors
refresh when the mesh is reused. Actual geometry bounds include the taller
curves, and the chart matcher includes fixed side extents plus the renderer's
minimum open-slab width. Wide, narrow, chord and muted open ghosts share this
path. Whole-note/hit scaling and physical draw order remain inherited.

The existing mute symbol remains visible on a dead-plus-ghost gem. Explicit
LinkNext continuations still suppress their attack at every playback phase.
Ordinary ties never acquire ghost flags. Repeated-chord simplification retains
gems with ghost cues, and reused chord scratch objects reset omitted flags.

The 2D highway writes `(12)` for a pitched ghost, `(0)` for an open-string ghost
and `(X)` for a dead-plus-ghost note. Ghost-bearing chords use the full note path
so compact repeat/mute boxes cannot silently remove the marking. Existing fret
labels and 3D fretboard-preview settings are unchanged.

## Verification

- `python -m pytest tests/test_highway_ghost_notes.py`: 11 tests cover strict
  booleans, independent mute/ghost/tie meaning, individual/chord round trips and
  the real FeedPak loader. The minimal semantic examples correspond to Rats
  Rain bar 2, Fire bar 33 and the already-merged Fire bar 50 tied sustain; they
  are not a full musical transcription fixture or a fresh source download.
- `node --test tests/js/highway_ghost_notes.test.js`: 8 tests execute the actual
  vendored Three.js geometry and palette update, real 2D note drawing, repeated
  chord/LinkNext decisions, scratch reset and rotated ordering footprints.
  The open-note regression verifies curve aspect, a thin body, real geometry
  bounds, palette/string updates and bounded per-mesh reuse.
- 148 existing targeted JavaScript tests passed for current trail visibility,
  physical ordering, open-chord bounds, repeats, muted bounds, coincident notes,
  known-target slides/LinkNext, prebends, sustain culling/rails and chord caches.
- 185 existing Python song/FeedPak loading tests passed.

Browser review is separate from these unit tests. Initial real WebGL review
found outline-only brackets insufficiently legible; pale core brackets were
added. The updated paused scene shows parentheses around the gem and retains
the white mute X on a dead-plus-ghost note. Full combined gesture/orientation
and moving-scene acceptance remains part of the integration review, not an
assumption based on source tests.

This branch does not change FeedForge, StaffView, slide-out rendering, audio,
scoring, the installed runtime or any song library.
