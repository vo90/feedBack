# Selective RS+ outline implementation plan

## Accepted behavior

Ordinary fretted note heads, including visible chord members, use one thin graphite rim. Bend chevrons and enabled RS+ slide arrows use one fine contrasting outline around the original string-colored fill. Palm-mute marks receive the same narrow dark contour already used by fret-hand mute marks.

Preserve the original body geometry and colors, accent brightness/width, hit/miss feedback, trail opacity and edges, open-string bars/stems, authored ghost brackets, chord boxes and chord-wide mute cues, hold rails, arpeggio guides, labels, and Current notation. Near-black custom fills use a single muted light outline. Ordering changes are explicitly outside this work.

## Steps

1. Replace the earlier broad proposal with the accepted selective styling. Remove the extra body/frame/guide shaders, restore baseline trail materials, and retain the existing cached glyph/material paths.
2. Update the notation documentation. Adapt existing technique and material tests to check a single outline, preserved glyph gaps, palette changes, unchanged semantic cues, and material reuse.
3. Validate the final production source using the existing isolated WebGL harness: matching 4K design scenes, 1080p/custom-palette/compound-symbol checks, moving sustains, and Current/RS+ style reuse. Run the relevant highway unit suite and compare rendered output with the accepted preview and baseline where appropriate.
4. Review the final diff and record results. Commit only this change locally; integration, runtime updates and publication remain separate actions.

## Acceptance

- The ordinary-note and bend appearance matches the accepted flat preview.
- Accent, hit/miss and open-string semantics remain identifiable and unchanged.
- Chord/guide styling and sustain palette/opacity match the original baseline.
- Technique masks retain their silhouettes, spaces and hollow centers, including combined marks and stacked bends.
- Palette changes and repeated style switching do not leave stale colors/materials.
- No additional geometry, shader passes or per-frame texture construction.
- Final renderer checks and relevant automated tests pass; any limitations are recorded.

## Result

Completed. The earlier extra body/frame/guide shaders and stronger trail opacity have been removed. The accepted single-outline appearance is implemented using existing materials and masks. Small palm-mute endpoint insets preserve antialiasing space in combined masks. Non-accent hit/miss rims explicitly retain their original width.

Validation:

- `node --test tests/js/highway_3d*.test.js`: 743 passed, zero failures.
- Six native 4K scenes plus five 1080p palette/compound/open/feedback scenes passed the real WebGL checks.
- Four 4K scenes (bends, sustains, moving trails and open holds) are byte-identical to the approved preview. The palm-mute spacing correction is intentional.
- Original chord frame geometry/materials/uniforms and sampled draw-call, triangle, geometry and texture counts are unchanged.
- Fifteen orientation/style-reuse records passed, covering standalone, chord and arpeggio notes, left-handed/inverted display and verdicts.
- Recorded real-time RAF playback and scored-chord samples passed. This isolated browser check is not a live-game FPS benchmark.
- Five Current-notation screenshots are byte-identical to the original baseline.
- JavaScript syntax and diff whitespace checks passed, treating the existing CRLF line endings as line endings.

Evidence is stored outside the source checkout in the verification artifact `rsplus-flat-implementation-20260926`, including `acceptance.json`, `unit.log`, screenshots and the motion recording. The older direction-only slide-out arrow retains its existing drawing path. No ordering, live runtime, integration or publication changes are included.
