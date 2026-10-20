# Precise natural harmonics

Optional playable-note extension, used together with `hm: true`:

* `f`: unchanged authored integer tab fret; remains the event identity.
* `hn`: finite touch position in (0,24], measured relative to fret wires.
* `hps`: source sounding pitch offset, integer semitones above the tuned and
  capo-adjusted open string. Both fields are required together.

`{f:3, hm:true, hn:3.2, hps:31}` is not a fretted third-fret fundamental.
The loader rejects malformed pairs instead of degrading to energy-only grading.
Legacy packages without the pair keep their previous handling.

The 3D renderer positions the gem, sustain and landing cue using `fretX(hn)`
with the same handedness and fret-spacing transform as the fret wires. The
natural-harmonic ring is unchanged. Its touch label shows only the number,
preserving decimals (for example, `5` or `3.2`), with no `NH` prefix.
It shares the supplementary-caption style with BAR, AH/TH, pick scrape, wah,
and timed harmonic-contact instructions: bold white Arial with a thin dark
outline, 14 CSS pixels at the default text size. Captions sit about 4 CSS pixels
above the visible marker; collision placement moves them only when needed.
The text-size setting scales all these captions together, independently of
render quality, camera distance, fret width, and string order.
The 2D renderer keeps its harmonic diamond and shows the precise number.

The Note Detection and Desktop feature branches must accompany this core
branch to grade these imports correctly. They preserve source `hps` but grade
known natural partials against their physical frequency ratios, leaving
normal scoring windows and legacy harmonic handling unchanged. This core
branch alone is not a complete scoring upgrade.

No other harmonic types, auto-repair, source fret rounding, or score exemptions
are introduced. Full application packaging and a live guitar/bass acceptance
test remain separate from the isolated render and synthetic DSP tests.
