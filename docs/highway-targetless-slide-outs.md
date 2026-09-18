# Targetless slide-outs

This additive import field preserves source instructions without inventing a
destination fret. It is separate from existing known-target `sl`/`slu` slides.

`slide_out_marks` is an optional array of `{direction, start, end}` objects.
Direction is `up` (higher frets) or `down` (lower frets). Start and end are finite
seconds relative to the note attack, ordered and nonoverlapping within its
sustain. They identify the written source segment, including a final tied
segment; they do not specify exact slide speed. Chord members use chord onset.
The loader tolerates half a millisecond at the sustain boundary because older
wire sustain values round to milliseconds, retaining accepted source precision.

Array presence is authoritative, including an empty array. Malformed marks are
discarded without using the legacy scalar as a timed interval. Legacy
`slide_out: "up"|"down"` alone displays an untimed on-gem direction cue. It does
not invent a timed trail. Reimporting supplies missing segment information.

The 3D visual flourish occupies at most the final 220 ms of each marked source
segment. This is a rendering convention, not inferred performance timing. Its
local span is 80% of one fret cell; no endpoint gem, target label, pitch target
or scoring event is added. The gem stays at the authored fret. The trail fades
to transparency with a subtle 100% to 72% width taper. Any later unmarked
sustain continues normally. Exact contour rings preserve very short segments.

Existing trail visibility settings win: artistic and visibility narrowing use
the smaller envelope, not their product. Geometry, crossing samples and depth
ordering share the same path. The body and outline use matching vertex alpha;
pooled material variants preserve string/verdict colors and glow without
mutating shared material opacity. Existing known-target slides are unchanged.
The 2D highway shows the direction at the authored segment with the same short
fade convention; its existing source sustain remains present.

Coverage includes the Rats Fire/Lead bar 102 tied sustain, both directions,
left-handed paths, decimal boundary precision, short/multiple segments, source
transport, chord scratch reset, repeated chords, and existing visibility and
LinkNext regressions. Full-frame WebGL visual evidence is recorded separately
in the workspace verification output, outside this repository.
