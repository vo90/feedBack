# Optional bar expression (version 1)

`Note.whammy` is transported without changing written fret, attack count or
harmonic targets. Its fields are `version: 1`, `policy: "optional"`, and ordered
`segments`. Each segment has note-relative song seconds `start`, `end`, a
`source_id`, a performed ownership `group`, and a signed-semitone `curve` of
`{t,v}` points. `vibrato: "slight" | "wide"` is optional. Empty curves require
vibrato. An absent interval means neutral bar pitch. Later segments own shared
boundaries. Values are validated, never clamped for storage or scoring.

FeedForge retains the raw source and independently verifies the normalized
extension. Songsterr's special two-point preset, last duplicate coordinate,
50-tone-units/semitone scale and precise percentage coordinates are resolved
before conversion. Its first-tone reset before a hidden tied continuation is
materialized as a constant segment, including unmarked continuations. This does
not create another attack or extend written/tied duration for let-ring.

Rendering is schematic: the 3D trail moves vertically, the 2D trail sways about
its fixed-fret centreline, and BAR uses the existing compact contact-label path.
Geometry is bounded with tanh; pitch values are not. Qualitative vibrato has an
illustrative wave, not invented source pitch depth/rate. Existing 3D taper,
crossing and minimum-width policies apply to contour samples. With simultaneous
exact bar and finger bends, the bar contour takes visual precedence and the bend
cue remains; the two pitch values must not be added and claimed as source audio.

Optional consumers advertise whammy capability 1. One event can match its
ordinary technique-aware pitch or the authored pitch at source song time.
Chord members sharing a performed group use one coherent alternative. No broad
intermediate-pitch window, trajectory requirement or additional sustain score is
introduced. Playback-rate-correct native clocks and browser clocks agree.

Qualitative bar vibrato, simultaneous bar/finger-bend or targeted-slide gestures,
and legacy natural harmonics without exact pitch are deterministically visual
only. Events whose valid targets descend below MIDI 22 (about 29 Hz) also fall
outside the shared verified short-window range and are visual only. This floor
uses the current tuning, capo and harmonic target, not input confidence.
Exclude these events before judging, from accuracy/streak denominators and
all-visual chord counts. Silence or a miss must never change eligibility. Located
counts are exposed by Note Detection's `getWhammyCoverage()` and stats. An old
native addon cannot silently grade the extension as ordinary notes.

Tab View attaches source expressions to verified GP note identities. Exact
beat-wide curves enter the pinned alphaTab model; partial or competing gestures
retain source data and a BAR caption with an explicit display limitation. The
existing quantized GP bridge is a display export, not the source of game timing.
