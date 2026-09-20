# Destination-only slide-ins: transport and 2D display

`slide_in_marks` is an optional authoritative array on a note or chord member:

```json
{
  "t": 10,
  "s": 0,
  "f": 7,
  "sus": 1.5,
  "slide_in_marks": [
    { "direction": "up", "time": 0 },
    { "direction": "down", "time": 1.25 }
  ]
}
```

Each `time` is seconds from the owning attack to a known destination onset. Zero
is valid, including on a note without sustain. Later entries can describe tied
segments inside the sustain without adding attacks. Chord members use the chord
onset. Direction `up` approaches from a lower fret; `down` approaches from a
higher fret. Neither implies a known source fret, source time, speed, or duration.

The core reader and writer require an array of objects with exact `up`/`down`
direction and finite numeric, non-boolean times. Accepted times must be
nonnegative and strictly increasing. They cannot exceed sustain by more than
0.000501 seconds, the same half-millisecond wire-rounding tolerance used for
slide-outs. Invalid individual entries are dropped; accepted precision is
preserved on the wire. An invalid present array becomes `[]`. An absent array
stays omitted; there is no scalar fallback. Extra object fields are not carried
into the normalized marks.

The existing FeedPak loader and highway wire path already share the note model
decoder/encoder, including chord members. No parallel loader format is needed.
Incoming marks coexist with `sl`, `slu`, `slide_out`, and `slide_out_marks`.
They do not modify `t`, `sus`, tie state, target frets, or grading inputs.

The 2D highway draws a short incoming ribbon ending exactly at the known fret
and endpoint. Its maximum 220 ms lead-in and 0.8 fret-cell sideways approach are
display conventions, not source data. Opacity rises smoothly from 0 to 1 while
width rises from 72% to 100% of the normal sustain width. Canvas mirroring applies
the same left-handed transform as other 2D highway geometry.

An initial mark may precede its attack, but never song time zero. A later mark
stays after the owning attack and the previous incoming endpoint. Display clips
accepted rounding excess to sustain without changing the wire data. Viewport
clipping retains the original gesture phase and uses the ordinary projection's
50 ms hit-line tolerance. Cues are drawn independently of the sustain-length
gate, so a zero-sustain note still has an approach. At song time zero, an initial
mark retains its metadata but has no approach length. Open-string destinations
retain their marks without a fabricated fretted approach.

The sustain pass respects transformed and difficulty-filtered note/chord
collections. Valid marks also prevent repeat-chord simplification from hiding
the authored technique. This cue remains display-only; it creates no endpoint
gem or additional scored attack.

Verification uses disposable FeedPak fixtures and the actual 2D drawing
functions with a recording canvas:

```text
python -m pytest tests/test_song_slide_in.py tests/test_song_slide_out.py
node --test tests/js/highway_slide_in_2d.test.js
```
