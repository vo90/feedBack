# Authored targeted slide intervals

New FeedForge Songsterr imports can carry `slide_interval: {start, end}` on a
note with `sl`. Seconds are relative to the attack, bounded by the sustain.
The field describes the authored slide-bearing segment, not an exact gesture
speed. Invalid present data is rejected by the loader; absent data preserves
the existing whole-sustain slide behavior, including PSARC-converted songs.

The 3D highway holds the original fret before `start`, uses the existing cubic
sine easing until `end`, then stays at the destination. This applies to the
note head, ribbon, linked/chord views and trail crossing calculations. Short
intervals get bounded extra contour samples. Fret spacing and left-handed
mirroring still use the existing geometry functions. Visibility widths,
fades, muted-note rules and scoring are unchanged.

The generated hand-position policy is shared byte-for-byte with FeedForge.
Its lane trajectory uses these bounds too, so a held note cannot be left
behind by an early-moving lane. Bend curves remain separate. The 2D renderer
continues to display a static slide direction arrow.

Loader/wire tests cover note and chord transport, strict bounds and defaults.
Geometry tests cover both directions, slides to open strings, short intervals,
legacy slides and pooled chord/ribbon/crossing paths. Real source replay and
packaged-import receipts are retained in the task's verification directory.
