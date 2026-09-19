# 3D Highway

A 3D note highway visualization for [FeedBack](https://github.com/got-feedback/feedBack) — an alternative to the default 2D highway, with a sense of depth and perspective inspired by stage views in modern rhythm games.

## What you get

- A camera-perspective highway with notes flying down toward a virtual fretboard at the bottom of the screen
- Glowing strings that pulse and brighten on each hit
- Note Detection feedback, including hit/miss outlines and diagnostic
  early/late/sharp/flat labels when the note detection plugin emits enriched
  judgments
- Chord frame-boxes, named-chord labels, and a chord diagram overlay (configurable corner position) so you can read shapes at a glance
- Two complementary barre indicators fire together when a barre chord shape is detected (2+ consecutive strings fretted at the lowest fret, e.g. F `[1,1,2,3,3,1]`, or an outer-edge full-span barre with every intermediate string fretted, e.g. B major `x24442`): a translucent vertical line across the strings on the 3D highway, and a straight bracket drawn inside the first fret space of the chord diagram overlay
- A heat-colored fret number row that lights up around your active playing region
- Selectable color palettes for the strings — pick the look you want
- Audio-reactive ambient background animations (particles, silhouettes, stage lights, geometric — pick one or turn it off)
- Lyrics overlay synced to the song
- Works as the main player view *or* per-panel inside the splitscreen plugin

## Install

3D Highway ships **bundled** with FeedBack — no separate installation needed. Pick **3D Highway** from the visualization picker in the player.

> **Note:** The bundled version is preferred over any user-installed copy with the same plugin ID. If you have an old `feedBack-plugin-3dhighway` clone on disk (from before 3D Highway was promoted to core), it will be ignored at startup — a warning in the server log names the path of the discarded copy. You can safely delete the stale clone.
>
> **Fallback:** In the unlikely event that the bundled copy fails to load its routes (e.g., a broken bundled release), FeedBack will automatically fall back to your user-installed copy and show a yellow "Fallback" badge in the Settings panel. Check the server startup log for the root cause in that case.

## Settings

Most of the visual controls (background style, intensity, audio reactivity, color palette) live on FeedBack's **Settings** screen under the *3D Highway* section.

### Notation style

Choose **Current** to retain the existing appearance, or **RS+ inspired** for rounded, solid note faces and sharp technique symbols. Current remains the default. Changing style keeps your saved string colors, background, and effects settings.

In RS+ inspired, ordinary and accented notes have the same full body opacity throughout their approach. Gems, rims and technique symbols keep a fixed orientation as they travel down the highway, including chord and arpeggio notes. Bend and slide paths still follow the chart. Accents use a stronger rim; each chord member follows its own chart accent flag. Chords use pale neutral panels; plain repeats use closed half-height panels. Chords with techniques that need individual notes retain those notes and full-height frames. Hollow neck previews and purple arpeggio guidance remain visually separate from playable attacks.

| Control | RS+ inspired behavior |
|---|---|
| Vibrancy | Changes color saturation; note faces remain opaque. |
| Glow | Scales decorative highway glow. Zero keeps crisp notes, accent rims, technique symbols, and guidance visible. |
| Soft glow | Adds restrained outer halos without blurring note faces. Requires Glow above zero and works in split-screen. |
| Hit feedback intensity | Controls strike animation and flashes; zero retains the basic verdict cue. |
| Text size | Scales text labels; technique symbols retain their own proportions. |
| Preview visibility | Controls the neck guidance separately from the incoming notes. |

Current retains its existing Glow behavior and full-scene **Glow bloom**, which is disabled in split-screen. RS+ inspired uses local edge halos instead. Background decorations and 2D score effects have separate controls.

The split-screen panel's **3D settings** expose notation style, Glow, and Soft glow / bloom independently for each panel. Global settings apply wherever no panel override is saved.

The note and technique vocabulary follows [Ubisoft's RS+ notehead guide](https://www.ubisoft.com/en-gb/game/rocksmith/plus/news-updates/11LCT7xGpOMZrwjrRMbZbS/rocksmith-notehead-guide). This is an original visual approximation with deliberate readability choices, including no approach-distance dimming of playable notes. It does not change chart data, timing or scoring. Bend chevrons use the string color, without an added amount label; fractional bend values still drive the complete curve. Gems meet the trail at its resolved initial pitch. The bend-start rules below distinguish delayed ordinary bends from explicit pre-bends.

Open strings use colored bars with a vertical pale marker rather than a stretched gem outline. Sustains have narrower colored strokes; full-height purple side brackets with short caps identify arpeggio guidance. With no saved arrow preference, RS+ slides use the trail alone. Explicitly enabled slide arrows remain available, and switching to Current restores its usual defaults.

Pale face symbols have a narrow dark contour so they stay distinct on bright string colors. Natural and pinch harmonics keep their hollow ring shapes with stronger strokes. Combined technique marks retain their proportions and share the face without overlapping or clipping. Palm-mute marks keep their pale edge and string-dark center; bend and slide arrows keep their string color. These masks remain sharp with Glow at zero and add no rendering passes.

With the **Default** highway theme, RS+ inspired uses a graphite floor, grey inner fret dividers, thin teal position edges, muted inlays and grey idle fret labels. Named highway themes keep their chosen floor colors, and background settings remain independent.

Across RS+ highway themes, active and per-note fret labels render their intended gold without the previous cream washout; chord names are white.

### Chord holds and hand positions

Both notation styles distinguish two kinds of guidance:

- **Thick pale rails with a short end cap** mark a shared chord hold. When all
  chord members have the same positive sustain, the rails use that exact duration.
  They remain at the chord's original position even if the hand-position guide moves.
- **Thin teal edges and quiet floor shading** identify the suggested fret region.
  This guidance can continue during picked passages, arpeggios or preparation for
  another chord; its length does not tell you how long every string should ring.

Older charts often omit chord-member durations. An ordinary chord can then use
an authored hand shape with the same string/fret voicing as its legacy hold cue,
even if it has a different template ID. This is the chart's convention, not proof
of an exact mute instruction. A real gap is left visible, and short holds are not
stretched to a minimum display length.

Shared holds replace redundant straight member trails. Different member lengths,
bends, slides and linked continuations keep their individual colored trails,
including open strings. Muted attacks and picked or partial shapes do not acquire
invented ringing holds. If neither explicit timing nor a matching ordinary hand
shape exists, the chord remains a normal readable attack with position guidance;
the renderer does not guess a release time from the next note.

Hold rails are crisp, restrained and independent of decorative glow. Their timing
does not change when a chord approaches, reaches the play line or becomes a repeat.
This display change does not alter chart files, note detection or scoring.

### Incoming fret numbers

Gold fret numbers sit below the chord-box or note-stem base for chords, single
notes and arpeggios. Grey beat-reference numbers use the same baseline. When
a visible gold number identifies the same fret at the same beat, it replaces
the grey number. Coincident chord and single-note gold numbers also combine
into one; reference numbers for other frets and beats remain visible.
They retain the same fret and timing positions. In dense
passages, overlapping nearer gems and technique symbols render over farther
numbers, including when sustain effects change a gem's drawing order.

At the play line, a number hands off to the fixed fretboard row only when the
same fret is visible there and the labels overlap. The fixed number becomes
gold; missing or offscreen row labels never hide the incoming number. The
normal camera fit guard accounts for the visible digits and Text size. If a
matching arrival digit is still partly clipped at the zoom limit, its text is
lifted just inside the screen before the handoff. Manual camera positioning
remains under your control.

### Bend starts and linked slides

An explicit bend sample at note onset sets both the approaching gem's height and
the trail's starting height. When a curve omits that sample, the renderer uses a
fallback: an ordinary bend rises from zero to its first timed target; a release
or pre-bend keeps its first value. A contiguous authored link can instead carry
the preceding note's ending bend into an ordinary continuation whose curve
omits its onset. Authored onset
samples take precedence, including zero. This fills missing visual information
without changing the chart, note detection, or whether a note must be picked.

For example, a linked slide from fret 22 to 24 followed by a delayed bend target
remains one continuous gesture with no second attack gem at fret 24. Explicit
pre-bends still approach at their bent height. Scalar-only bends retain their
existing synthesized rise/hold/release shape.

## Contributing / development

For maintainers and AI assistants working on the codebase, see [`CLAUDE.md`](CLAUDE.md) — it's a navigation guide that maps every visual element to where it lives in `screen.js`, plus the gotchas worth knowing before tweaking.

### Perf bench (`?h3dbench=1`)

Append `?h3dbench=1` to the player URL to enable opt-in `console.log` reporting of `update()` self-time, broken into six segments — `frame` (everything between `pbBeg(0)` at the top of `update()` and `pbEnd(0)` at the bottom; excludes the trailing `pbReportTick()` logging that fires after `pbEnd(0)`), `state` (per-frame state-derivation loop), `next` (next-note-by-string lookahead), `mat` (per-string material writes), `noteDraw` (single-note draw loop), `chordDraw` (chord draw loop). Reported every 5 seconds with p50 / p95 / max per segment and frame count, so before/after numbers on a target chart are reproducible (feedBack#226). Off-by-default; the bench helpers (`pbBeg` / `pbEnd` / `pbReportTick`) are bound to a shared empty-function literal when the renderer instance is created (each `createHighway()` panel re-checks the flag), so the hot-path call sites are no-ops with negligible overhead (typically JIT-inlined).
