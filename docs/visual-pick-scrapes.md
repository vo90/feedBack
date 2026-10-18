# Visual pick scrapes

An optional `pick_scrape_marks` array on a muted (`mt: true`) note contains
`{direction: "up" | "down", start: seconds, end: seconds}` intervals relative to
the attack. The same extension is valid on chord members. Intervals must be
nonempty, finite, ordered, nonoverlapping and within the sustain. Invalid
extensions fail loading rather than becoming normal scored notes.

Direction preserves the source's `up`/`down` scrape notation, separate from a
pick stroke. It does not establish higher/lower fret motion or a verified
physical direction toward the bridge or nut. The source fret is retained for
provenance but is not a playable pitch,
fret endpoint, physical distance, or camera target. Missing source frets retain
the existing unpitched mute sentinel. Tied intervals can change direction without
creating an attack. Repeats and recording retiming preserve interval boundaries.

The highways draw a string-colored X on each affected string and a compact rough
duration ribbon. Matching simultaneous gestures share one white PICK SCRAPE
caption above the uppermost displayed string. Sharing requires the same onset,
sustain duration, and every authored interval and direction; different gestures
keep separate captions. A small `↗` (`up`) or `↘` (`down`) preserves source
notation without prescribing hand travel. The symbol changes at a tied reversal,
including when seeking directly to its boundary.

The ribbon's depth follows the authored duration; its small centered texture is
independent of direction. The X stays at its anchor instead of sweeping sideways.
There is no fret numeral or destination gem. In 3D, the anchor is the center of
the canonical chart guidance lane at the gesture's onset, independent of camera
mode, current camera position, or hidden source fret. Without a guidance lane,
the fixed fallback is the center of fret wires 0 through 4. Every part of the
gesture uses this same world-space anchor throughout its duration and across
seeks. The 2D cue uses the fixed highway center. Left-handed mode mirrors geometry
once, while text and the source direction symbol remain readable. String
inversion changes the display order without changing authored string colors.

The 3D trail uses the existing visibility, occlusion, ordering and minimum
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
