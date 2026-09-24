# Visual pick scrapes

An optional `pick_scrape_marks` array on a muted (`mt: true`) note contains
`{direction: "up" | "down", start: seconds, end: seconds}` intervals relative to
the attack. The same extension is valid on chord members. Intervals must be
nonempty, finite, ordered, nonoverlapping and within the sustain. Invalid
extensions fail loading rather than becoming normal scored notes.

Direction describes motion towards higher/lower fret positions, not a pick
stroke. The source fret is retained for provenance but is not a playable pitch,
fret endpoint, physical distance, or camera target. Missing source frets retain
the existing unpitched mute sentinel. Tied intervals can change direction without
creating an attack. Repeats and recording retiming preserve interval boundaries.

The highways draw an X and a compact PICK SCRAPE label, plus a rough trail whose
depth follows the authored duration. Sideways reach is a bounded illustration.
There is no arrow, fret numeral or destination gem. Left-handed mode mirrors the
path. The 3D trail uses the existing visibility, occlusion, ordering and minimum
width rules; artistic taper and visibility narrowing combine by their minimum,
not multiplication. Adjacent direction changes remain continuous.

Note Detection excludes these events from browser and Desktop targets,
judgments and practice denominators. They earn no automatic credit and cause no
misses. Ordinary members of mixed chords are still scored. Desktop native DSP
does not change: it never receives a scrape target.

The Tab View GP5 display export uses dead-note Xs with a PICK SCRAPE direction
label. GP5 has no equivalent typed timed gesture and this view retains its
existing rhythmic quantization limits. Exact intervals and original source
evidence remain in the FeedPak. Old players may display only an ordinary mute;
the import compatibility report identifies the required consumer support.
