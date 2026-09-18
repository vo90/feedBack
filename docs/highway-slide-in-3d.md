# Destination-only slide-ins in the 3D highway

The renderer consumes the same optional `slide_in_marks` contract documented in
`highway-slide-in-transport-2d.md`. It preserves real attack times, sustain lengths,
frets, chord membership, tie state and scoring identity. There are no synthetic
notes, target gems, playable start pitches or camera fret-range additions.

Each fretted destination has a visual approach of at most 220 ms and 0.8 fret
cell. The ribbon fades from transparent to the normal trail opacity and widens
from 72% to the ordinary width at the known destination. Left-handed rendering
mirrors its direction once. The approach clips at song zero and the visible
horizon while retaining its original phase. A zero-sustain destination supports
the same cue. An initial destination at song zero and an open-string destination
retain their metadata without a fabricated negative-time or fretted approach.

Internal tied destinations stay inside the existing sustain and after the
previous incoming endpoint. Closely spaced cues use two transparent rings and
a 0.2 microsecond geometry seam to disconnect the previous destination from the
next unknown origin. This does not change any authored time. Ordinary sustain
intervals retain their normal shape and opacity. Known-target slides, timed
slide-outs, bends, vibrato, ghosts and repeated chord cues retain their existing
render paths. Pooled ribbon alpha is reset on ordinary reuse.

Incoming contours participate as both source and target in crossing tests,
visibility narrowing and physical render ordering. The existing chart-static
event index carries an additional visual start extent; its real event time and
end are unchanged. Mode-3 front priority uses the real attack time, not the
decorative lead-in start. Using the latter would misclassify earlier attacks and
form a cyclic trail-order graph in dense mixed-string passages. The regression
suite reproduces that failure and checks the repaired finite ordering.

The render scan extends only 220 ms past the ordinary horizon, visiting incoming
trails without emitting a head or label. Chord views are private render values;
linked bend and vibrato context is inherited without altering source members.
Existing visibility settings and physical string order also apply to this short
suffix. Cues do not add hit-line tolerance or extend a note after its real end.

Focused verification:

```text
node --test tests/js/highway_3d_slide_in.test.js tests/js/highway_3d_coincident_repeat_notes.test.js
```

The tests exercise production ribbon geometry, validation, song-zero and horizon
clipping, immutable source notes/chords, known slide coexistence, pooled alpha,
repeat scratch reset, crossing in both directions, all visibility modes and the
observed dense ordering cycle. Actual WebGL acceptance is recorded separately in
the workspace verification directory; these unit tests do not claim GPU proof.
