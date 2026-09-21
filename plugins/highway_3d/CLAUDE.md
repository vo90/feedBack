# 3D Highway Plugin — AI Maintainer Guide

This guide tells future AI assistants where each visual element lives in `screen.js`, what controls it, and the gotchas to watch for. The goal is for small polishes (color tweaks, sizing, animation timing, add/remove a label) to land in the right place on the first try without grep spelunking.

The whole renderer is **one file** — `screen.js`, wrapped in an IIFE, registered as `window.feedBackViz_highway_3d` (a feedBack#36 setRenderer factory). No imports beyond Three.js loaded from the vendored `/static/vendor/three/three.module.min.js` (pinned r170; swapped from CDN when bundled into core).

**Styling (feedBack `styles` capability).** This plugin owns its Tailwind CSS: it ships `assets/plugin.css` and declares `"styles": "assets/plugin.css"` in `plugin.json`, so core's prebuilt `static/tailwind.min.css` no longer scans it (it's excluded from core's content globs). The frontend injects `assets/plugin.css` as a `<link>` when the renderer activates. This is the one maintainer-time build step: after you add/change a Tailwind class in `screen.js` or `settings.html`, run `bash build-tailwind.sh` (pinned `tailwindcss@3.4.19`, `corePlugins.preflight=false` — utilities only) and **bump the `version` in `plugin.json`** so the injected `<link>`'s `?v=` cache-buster fetches the fresh file. The generated `assets/plugin.css` is committed; end users never build. See [docs/plugin-styles.md](../../docs/plugin-styles.md).

> **Navigation note:** This guide references functions by name and uses the existing banner comments (`/* ── Scene initialisation ─ */`, etc.) as section anchors. Line numbers are deliberately avoided so this stays correct as the file evolves. Use `Grep` for the function name or banner text to jump to a section.

## File structure at a glance

**Bend onset semantics.** `bendCurveStartSemis` and `bendCurveSemisAt` supply a
render-only start when the authoritative `bnv` curve omits t=0. Precedence is an
authored onset sample (even zero), then release/pre-bend intent `bt=1/2/3`, then
a validated contiguous predecessor's ending bend, otherwise zero. Inheritance
fills a missing curve onset. `bnvSampleAt`
retains its generic endpoint-clamping contract. `bendSemisAtTime` and
`prebendOffsetWorld` use the same resolved curve for trail and gem alignment.
`hwyLinkNextTargetNotes` optionally collects predecessor records while retaining
its existing attack-suppression rules. Bend inheritance separately requires a
positive sustain ending within 1 ms of the next onset; ambiguous sources do not
supply a starting value. `resolveLinkedBendStarts` runs once per arrangement in
lane order and stores values in a per-renderer WeakMap. Chord scratch and muted
drawing views must carry that cached start. `resolveLinkedBendEnds` first resolves
scalar-only source endpoints from a unique contiguous destination's explicit
onset (t=0 or pre-bend/release intent). It rejects ambiguous destinations, invalid
samples and endpoints above the source peak. The scalar's final fallback phase
meets that pitch instead of releasing to zero; unrelated scalar bends retain
their existing envelope. Carry the endpoint cache through scratch/muted views
and clear both caches at teardown. Never mutate authored notes or allocate/rebuild
these relationships in the ribbon-sampling loop. Timing, ribbon samples and
scoring remain unchanged; real unlinked gaps remain visible.

The file is laid out top-to-bottom as:

1. **Constants block** — palette (`S_COL`), scale (`SCALE`, `K`), fret/string counts, geometry sizes, camera, fog
2. **Pure helpers** — `fretX`, `fretMid`, `dZ`, `computeBPM`
3. **Three.js loader** — `loadThree()` (loads vendored `/static/vendor/three/three.module.min.js`, memoized)
4. **Splitscreen helpers** — `_ssActive`, `_ssIsCanvasFocused` (read `window.feedBackSplitscreen`)
5. **`createFactory()`** — the rest of the file is one big closure
   - Per-instance state (Three.js refs, pools, camera state, lifecycle flags)
   - `txtMat()` text-sprite cache, `pool()` factory
   - `drawChordDiagram()` — 2D canvas chord diagram (top-left overlay)
   - `drawLyrics()` — 2D canvas lyrics renderer (top centre)
   - `initScene()` — one-time WebGL setup: scene, camera, lights, materials, pools
   - `buildBoard()` — static fretboard geometry: strings, fret wires, fret dots, board plane
   - `updateStringHighlights()` — per-frame string emissive glow + opacity
   - `update(bundle)` — the big per-frame function: notes, chords, beats, lane, fret labels
   - `drawNote()` — single note: outline, body, sustain, drop line, technique labels, projection
   - `camUpdate()` — smooth camera lerp + self-correcting NDC look-at
   - `applySize()` — DPR + canvas size + aspect clamping
   - `teardown()` — dispose all GPU resources + reset state
   - `canvasSize()` — resilient canvas-dimension lookup
   - **Returned API** — `init / draw / resize / destroy` (setRenderer contract)

## Incoming fret-label layout

`_setIncomingFloorLabelMap` top-anchors the three gold incoming-label paths and
adjacent teaching labels after pool reuse. `_layoutIncomingFretLabels` runs
**after** `update` (including trail-order finalization) and `camUpdate`. It
uses cached texture ink bounds for the fixed-row handoff and conservative
projected core/outline/technique bounds for overlap. Only label priorities are
lowered; do not replace the shared depth buckets or alter gem/trail orders.
Register new incoming technique meshes with `_registerIncomingLabelOccluder`.
The geometry-bound cache assumes their vertices remain static after creation;
mutable trails must not be registered without invalidating those bounds.
Per-renderer records and vectors are reused and cleared at teardown. The fret
row's existing camera fit guard measures glyph bottoms rather than only the
row centre. At arrival, a partially clipped matching row digit is lifted just
inside the viewport before handoff; wholly offscreen rows remain ineligible.
The pool resets that temporary Sprite centre on the next update.
`_registerFretColumnMarker` gives grey reference markers the same top anchor.
After confirming a gold label is visible/projectable, layout suppresses grey
markers for the same positive fret within 1 ms of the authored onset. Store
actual `ch.t`/`n.t` and `b.time`; keep only the first drawable gold identity
across chord and note paths each layout frame. Do not use clamped render Z or 40 ms density
buckets. Teaching marks have no fret/time identity and never suppress a marker.
Marker records are per renderer, reused, reset each update and cleared at teardown.

## Coordinate system

- **+X** runs along the fretboard (low frets → high frets, `fretX(f)` and `fretMid(f)`).
- **+Y** is up (string Y is `sY(s)`, low strings have lower Y when not inverted).
- **+Z** is toward the camera. Notes spawn at negative Z and approach Z=0 (the hit line). Past notes would be at positive Z, but `noteZ` is clamped via `Math.min(0, dZ(dt))` in `drawNote()` so they stop at the string plane.
- **Camera** sits at roughly `(curX + 20*K, h*0.95, dist*0.75)` — positive Z, slightly above and behind the play line, looking toward `(curX, curLookY, -FOCUS_D * 0.35)`.

`dZ(dt) = -dt * TS` — the closer to "now," the closer to Z=0. `TS = 200*K` is the world-units-per-second scroll rate.

## The K scale and why everything is multiplied by it

`SCALE = 2.25`, `K = SCALE / 300 ≈ 0.0075`. **Almost every world-space dimension is expressed as `N * K`** so the whole scene scales as one unit. Tweaking `SCALE` alone resizes the entire highway. If you change a literal world dimension, write it as `N * K` to keep it consistent — naked numeric literals in Three.js geometry creation calls (e.g. inside `BoxGeometry`) are an obvious smell.

Concrete sizes (search the constants block for the names):

| Const | Value (world units) | Meaning |
|---|---|---|
| `STR_THICK` | `0.25 * K` | String thickness |
| `S_BASE` / `S_GAP` | `3 * K` / `4 * K` | Lowest-string Y / inter-string gap |
| `NW`, `NH`, `ND` | `5 * K`, `3 * K`, `0.5 * K` | Note width / height / depth |
| `TS` | `200 * K` | Scroll speed (world units per second) |
| `AHEAD` / `BEHIND` | `3.0` / `0.5` | Seconds visible ahead / behind hit line |
| `CAM_DIST_BASE` / `CAM_H_BASE` | `240 * K` / `150 * K` | Reference camera distance / height |
| `FOG_START` / `FOG_END` | `200 * K` / `670 * K` | Fog kicks in past hit line, swallows by the horizon |

## "I want to change X" — quick lookup

Each entry names the function or banner you should grep for, plus key sub-blocks (also marked with banner comments inside the function).

### Strings
- **String colors** → `S_COL` / `PALETTES` and the per-instance `activePalette`. Eight-element palette; string 0 is the lowest-pitched guitar string (low E in standard tuning). `MAX_RENDER_STRINGS` keys off `S_COL.length`.
- **String count for the active arrangement** → `resolveStringCount(bundle)` (top-level helper). Reads `bundle.stringCount` (feedBack#93) with a `bass`-name fallback. Don't reintroduce `tuning.length` — see Pitfall #4.
- **String thickness / gap / base Y** → `STR_THICK`, `S_BASE`, `S_GAP` constants.
- **String-to-Y mapping (respects invert)** → the `sY(s)` arrow function inside `createFactory()`. Single source of truth for "where on Y is string s."
- **Static string mesh creation** → `buildBoard()`, the `// Thin Line strings (glow layer)` and `// BoxGeometry strings — emissive glow ...` comment blocks. Two layers: low-opacity `Line` for soft glow, `BoxGeometry` mesh per string with its own material clone (kept in `stringLines[]` for live emissive updates).
- **Live string glow / pulse** → `updateStringHighlights(noteState)`. Tunables: `BASE_GLOW`, `MAX_GLOW`, `IDLE_OP`. Driven by `noteState.stringSustain` and `noteState.stringAnticipation`.

### Fretboard
- **Fret count** → `NFRETS` constant. Increasing requires nothing else.
- **Fret X positioning** → `fretX(f)` and `fretMid(f)` (top-level helpers). Logarithmic guitar-fret spacing within `SCALE`.
- **Fretboard plane / fret wires / fret dots** → `buildBoard()`, separate banner-style comment blocks (`// Fret wires`, `// Fret dots`). The dark background plane is the first thing built; main fret wires use `0xbbbbff` / opacity 0.8, minor wires `0x666688` / opacity 0.4. Single/double dots: `DOTS` array + `DDOTS` set in the constants block.
- **RS+ default highway surface** → `_usesRsDefaultHighway()`, `RSPLUS_DEFAULT_HIGHWAY`, `_applyBgTheme()` and the lane pass in `update()`. Only RS+ with `hwThemeId === 'default'` gets the graphite floor, grey inner dividers, cyan outer rails and muted inlays. `_highwayReferenceLabelColor()` supplies grey idle labels. Named highway themes and the background axis remain independent; style/theme round-trips restore Current materials. Reuse `mRsLaneDivider` and existing lane pools rather than allocating materials per frame.
- **Fret-row label colors / sizing** (the heat-coloured row of fret numbers below the board) → `update()`, `// ── Dynamic fret number row ──` block. Active = `#ffe84d`, inactive = `#9ab8cc`, opacity / scale driven by `noteState.fretHeat[f]`. Text rendering (font, outline, shadow) is governed by the `'fretRow'` preset in `TXT_STYLES` — see "Tweaking text-sprite styling".
- **Active-fret cooldown** → `FRET_COOLDOWN` constant. How long after the last note in a fret it stays in the active set.

### Notes
- **Single-note rendering** → `drawNote()`. Handles outline, core body, open-string variant, sustain trail, lane drop line, all technique labels, fret connector label, and the board projection. Each visual block has its own banner comment (`// ── Outline ──`, `// ── Core (filled note body) ──`, `// ── Sustain trail ──`, `// ── Lane drop line ──`, `// ── Technique labels ──`, `// ── Per-note fret connector label ──`, `// ── Board projection ──`).
- **Note geometry / size** → Current uses `gNote` / `gNoteGrad`; RS+ inspired uses rounded `gRsNote` / `gRsNoteGrad`. Per-note scale and open-string widths are in `drawNote()`. Keep footprint/bounds helpers in sync with silhouette changes.
- **Note approach orientation** → search `approachRot` inside `drawNote()`. RS+ inspired keeps gems, rims and attached technique symbols at their landing orientation throughout the approach. Current maps `dt / AHEAD` to `[0, π/2]`; open strings skip the rotation. Bend/slide trajectories and the bend chevron's direction are independent of this decorative turn.
- **Note color** → Current's playable core selects `mStr[s]` or `mAccentCore[s]` from the authored accent flag; `mGlow` is also used by active sustain paths and must not be treated as interchangeable with a playable body. RS+ inspired selects `mRsBody[s]`, with palette-derived vertex colors, opacity 1, no fog, and no scene-light dependence. See `_applyRsNotationPalette()` and `_applyVibrancy()`.
- **Sustain trail** → the sustain blocks in `drawNote()` build ribbons/segments using chart-driven bend, vibrato, tremolo and slide paths. RS+ inspired uses `mRsSus`, `mRsSusHit` and `mRsSusEdge`; Current retains its existing materials. Changing appearance must not change time sampling, slide destinations, linked continuation ownership, or trail-yield behavior.
- **Lane drop line** → `// ── Lane drop line ──` block in `drawNote()`. Vertical line from each upcoming note down to the fretboard plane in the string's color.
- **Per-note fret connector label** → `// ── Per-note fret connector label ──` in `drawNote()`. Uses the `'noteFret'` preset for numbers below the board. Finger/degree teaching labels live beside that row. Flying note bodies do not carry fret digits; `showFretOnNote` controls ghost digits with `fretNumberGhostScope`.
- **Technique markers** → `// ── Technique labels ──` in `drawNote()`. Current retains `triMat`, `bendChevronMat`, mute/harmonic factories and the tap geometry. RS+ inspired uses `rsPlusTechniqueFlags`, `rsPlusTechniqueCells`, `drawRsPlusTechniqueGlyph` and `rsPlusTechniqueMat`: cached 512px sRGB masks with no baked glow. A combined mask gives each authored family a separate face cell. Masks become pooled planes through `_spriteMat2MeshMat`, which preserves their fog/tone-mapping policy. RS+ bends use filled string-colored chevrons following `bendVisualDirY`, without amount text. Fractional chart values still drive `bendSemisAtTime` and the complete path.
- **Open-string note** → special-cased throughout `drawNote()`: `n.f === 0`. A wide bar using `openX` and chord box width when supplied. Unpitched muted notes use this local drawing treatment without changing source note identity.
- **Board projection ("ghost" preview)** → the `Board ghost` block in `drawNote()`. `projMeshArr` / `projGlowArr` hold up to three preview slots per string. `projectionVisible` gates previews; reset their visibility every frame. Chord/arpeggio finger hints and ordinary fret hints have distinct scope/timing. In RS+ inspired, a technique-bearing attack suppresses a coincident ghost digit so it cannot cover the face symbol. See `techniqueCoversGhost` and `drawGhostFretLabel`.
- **Note-hit feedback** → the provider-verdict block in `drawNote()`, `_sparkBurst`, `_rimFlashIn` and the fret-wire flash pass in `update()`. Current uses string-colored rim flashes plus its existing side fill; RS+ inspired uses its own crisp verdict rim and restrained strike punch. `_sparks` and `_hitFx` gate bursts. Verdict symbols are queued into `_ndLabels`; score pops are separate 2D effects. Do not route either style's playable face through the old bright-body path.

### Chords
- **Chord rendering loop** → `update()`, `// ── Chords ──` block. Iterates `bundle.chords`, calls `drawNote()` per chord-note, then draws the frame box, name label, and barre indicator.
- **Chord linger after hit** → the chord loop's `chordTailMul` and the `linger` argument passed to `drawNote()`. Keep event cleanup separate from approach opacity; the RS+ style removes approach fading, not post-event cleanup.
- **Chord frame-box** → the chord loop's `compactRepeatFrame`, `drawRsPlusChordFrame()` and `pRsChordFrame`. Current retains distance/repeat dimming. RS+ inspired uses pale neutral rims and a lightly transparent fill (`chordFrameGradTexRs`), stable approach opacity and stronger accent borders. Full chords use closed full-height panels; plain repeats use closed half-height panels. Explicit arpeggios use full-height purple side brackets with short caps instead of full-width top/bottom bars.
- **Chord name label** → in the same chord loop, search `chordName`. Cached with the `'chord'` preset in `txtMat()`: Current uses gold `#e8d080`; RS+ uses white `#f3f4f6`. Anchored above the chord box.
- **Barre indicator** (white vertical line at the barre fret during linger) → in the chord loop, gated on `/barre/i.test(chordName) && chDt <= 0`. Position is `fretMid(bFret)` where `bFret` is the lowest fretted string.
- **Repeat-chord detection** → `prevChordSig` / `prevChordTime` inside the chord loop. Same shape within 0.5 s may be a repeat, but `retainsChordGems` and technique-aware suppression preserve members needed to convey slides, bends, vibrato, harmonics and other techniques. Only gem-suppressed repeats become half-height; retained techniques keep full-height frames. RS+ inspired keeps repeat panels closed and does not dim them just because they repeat.
- **Chord diagram (top-left 2D overlay)** → `drawChordDiagram()`, called from the `lyricsCtx` block at the bottom of the returned `draw()`. The chord-to-display is selected in `update()` under `// ── Chord diagram: track most recently hit chord ──` and stashed in `_diagChord` (most recently hit named chord within the 0.55 s linger window).

### Camera
- **Reference values** → `CAM_H_BASE`, `CAM_DIST_BASE`, `REF_ASPECT`, `FOCUS_D`, `CAM_LERP_BASE` in the constants block.
- **Smooth lerp + look-at** → `camUpdate()`. BPM-scaled lerp speed (`CAM_LERP_BASE * bpm/120`).
- **Self-correcting framing** → bottom half of `camUpdate()`. Projects the fretboard mid-Y to NDC, nudges `tgtLookY` until that point sits at NDC Y ≈ `DESIRED_NDC_Y` (lower third of frame). This is what lets the camera adapt automatically to ultra-wide split-screen panels.
- **Aspect compensation** → `aspectScale = Math.max(1, REF_ASPECT / Math.max(cam.aspect, 0.5))` in `applySize()`. Clamped to ≥ 1 so wide panels keep baseline depth (don't dolly in flat). Removing the `Math.max(1, …)` is the bug we already fixed; don't reintroduce it.

### Beats and sections
- **Beat lines** (downbeats highlighted) → `update()`, `// ── Beat lines ──` block. `mBeatM` (full opacity 0.25) for measure starts, `mBeatQ` (0.07) for other beats.
- **Section labels** → `update()`, `// ── Section labels ──` block. Cyan (`#00cccc`) sprite at fret 12, above the highest string.

### Scene colors (two independent axes: Background + Highway)
- **Scene-color themes** → `BG_THEMES` table near the top of `createFactory()`. One combined table is the single source of truth, but it drives **two independent axes that share the same id-set**:
  - **Background axis** — setting key `bgTheme`, setter `window.h3dBgSetBgTheme`, state `bgThemeId`. Owns `clear` (WebGL clear color) + `fog`.
  - **Highway axis** — setting key `hwTheme`, setter `window.h3dBgSetHwTheme`, state `hwThemeId`. Owns `board` (fretboard/highway-surface plane) + optional `lane`/`laneDim` (the lit lane strip).
  Any background id can mix with any highway id; picking the same id in both gives the original "matched" look. Per-axis accessors are `_bgBackgroundColors(id)` / `_bgHighwayColors(id)` (both alias `_bgThemeColors`). Both axes default to `'default'` (byte-identical to the original look).
- **Applying a theme** → `_applyBgTheme()`. Background half sets clear+fog from `bgThemeId` (skipped under the venue scene); highway half sets the board plane + lane materials (`mLaneOdd`/`mLaneEven`) from `hwThemeId`. Re-run on init, `buildBoard()`, and the settings listener (which fires for **both** `bgTheme` and `hwTheme`), so changing either dropdown retints only its half live.
- **Backward-compat migration** → `_bgLoadSettings()`: the first time it loads with no stored `hwTheme` (`_bgHasStored` false), it seeds `hwThemeId` from `bgThemeId` **and persists `hwTheme` once** (a one-time backfill, written without `_bgEmitChange`). So a pre-split single-`bgTheme` pick is byte-identical right after the upgrade, and from then on the two axes are fully independent — changing the Background dropdown never drags the Highway surface, and the settings UI's Highway value can't disagree with what's rendered. settings.html shows the same first-load value via `storedHwTheme == null ? bgTheme : coerceHwTheme(...)`.
- **Adding/removing a theme** → edit `BG_THEMES` (the colors) AND `settings.html`'s `SCENE_THEMES` array (the `{id,label}` list — the single source the two dropdowns' `<option>`s and the `VALID_BG_THEMES` validator are both generated from). Keep the two id-sets aligned.

### Highway lane (the highlighted strip under active frets)
- **Lane drawing** → `update()`, `// ── Dynamic highway lane ──` block. `pLane` is a single quad on the fretboard plane; `pLaneDivider` is thin vertical lines at each fret inside the lane. Width keys off the active-fret range; min width ≈ 4 frets.
- **Lane intensity** → `highwayIntensity` accumulated from upcoming notes (further notes dim it, near notes light it).
- **Lane color** → the lit quad color is `mLaneOdd.color` (stock `HWY_LANE_STRIPE_ODD_HEX = 0x103B5C`), the dimmer alternating row `mLaneEven.color` (`HWY_LANE_STRIPE_EVEN_HEX = 0x08283C`). These are now **theme-aware**: `_applyBgTheme()` recolors them from the active HIGHWAY theme's optional `lane`/`laneDim` fields, falling back to the stock hexes when a highway theme omits them. (`_laneTargetColor`, set in `initScene()`, is kept in sync with the lit color but has no live consumer today.)

### Lyrics & overlays
- **Lyrics overlay** → `drawLyrics()`. 2D canvas, top centre, semi-transparent rounded background, syllable-level highlighting (current syllable in white, played in muted, upcoming in dim).
- **Chord diagram overlay** → `drawChordDiagram()` (see "Chords" above). 2D canvas, top-left, fades over the 0.55 s linger window. Respects `inverted` (column 0 is high-e when inverted, low-E otherwise).
- **The `lyricsCanvas`** is created in `initScene()` with `z-index:1`, appended to `wrap` **after** `ren.domElement` — this is the empirically-correct stacking order for all browsers/contexts (including splitscreen panels with `position:relative; overflow:hidden`). Don't reorder; see Pitfall #5.

### Splitscreen
- **Focus dim** → `_isFocused` flag, manipulated by `_updateFocusState()`. Fades ambient + directional light intensity in non-focused panels.
- **Per-panel resize fallback** → search `_lastHwW` in the returned `draw()`. The renderer self-detects when the highway canvas backing-store dimensions change and re-runs `applySize()`. Needed because the splitscreen plugin overrides `hw.resize` and never calls `renderer.resize()`.
- **Reduced DPR in split** → `applySize()` clamps DPR to 1.25 when splitscreen is active vs 2 otherwise (search `baseDPR`). Keeps four-panel quad layout from melting GPUs.

### Splitscreen panel controls/settings
- Per-panel background overrides use `localStorage` keys shaped as `h3d_bg_panel<N>_<key>`. When present, they override the global `h3d_bg_<key>` value for panel `N`; when absent, the global value still applies.
- Keep per-panel keys to `BG_DEFAULTS` entries that `_bgLoadSettings()` reads. Do not add panel-only keys outside that load path.
- `panelControls` is a static, host-readable, curated descriptor list for controls a host can expose per panel. It documents the supported per-panel surface; the renderer still loads values through `_bgLoadSettings()`.
- The curated list includes `notationStyle` (`current` / `rsplus`), `glow`, `bloom`, and the camera controls. The splitscreen host renders `{ id, label }` select options, writes the panel key, then calls the matching `h3dBgSet*` setter with the unchanged global value to emit the refresh notification. Do not replace that value with the panel value: it would overwrite every inheriting panel's preference.
- The `notationStyle` listener must reload settings **before** `_applyVibrancy()` and `_applyGlow()`. An unchanged palette is skipped by the signature guard in `_bgLoadSettings()`; those explicit apply calls still retint the selected style and restore Current's material parameters when switching back.
- `_bgLoadSettings()` also detects a style change during a bulk rebuild/reset and reapplies shared material colors/intensities after loading the complete snapshot. This covers resets that bypass the dedicated style listener without changing unrelated Current reload behavior.
- Current's full-scene bloom remains disabled in splitscreen. RS+ inspired uses local halos, so each panel's `bloom` flag means Soft glow and remains usable there.
- Asset/background image keys remain global-only. Do not make uploaded or selected asset references panel-scoped unless that contract is explicitly widened.
- Host refresh nudges that call toggle setters must pass real booleans, not strings such as `'false'`, so setters can distinguish `true` from `false`.

### Notation style and effects contract

- `BG_DEFAULTS.notationStyle` is `current`; `NOTATION_STYLE_IDS`, `_bgCoerce()` and `h3dBgSetNotationStyle()` validate/store the selection. `_bgLoadSettings()` resolves the per-instance `rsPlusNotation` flag through the usual panel → global-memory → global-storage → default precedence. Style changes never write palette, background, Glow, or Vibrancy preferences.
- RS+ playable faces use opacity 1 and remain independent of distance fog, cinematic lighting, and the accent flag. `_applyRsNotationPalette()` changes saturation/vertex shading and rim colors, not body opacity. Current materials retain their existing appearance and transparency.
- `notationSoftGlow()` is nonzero only for RS+ inspired with Soft glow enabled and Glow above zero. The draw path bypasses the full-scene bloom compositor for this style. Local halos sit outside the crisp note/frame rims; a bright yellow or custom white face must never become an automatic halo source.
- Glow scales decorative highway glow; essential faces, symbols, frame edges and preview outlines remain legible at zero. Hit feedback intensity scales strike motion/flash/sparks; basic verdict cues remain. Cinematic lighting still affects the environment. 2D score/milestone effects and background decorations retain their own controls.
- Keep glyph/artwork masks free of baked blur and mark CanvasTexture CSS colors as `SRGBColorSpace`. `_techMatCache` owns RS+ technique textures/materials in a separate negative-key namespace, including disposal of each cached `h3dTechMeshMat` base; `_techMeshMatClones` owns the per-mesh conversions. Keys include string color. Pale face symbols add a narrow dark contour across palettes; palm mute retains its own pale edge/string-dark center and off-face arrows stay solid string color. Compound cells use uniform scale and centered incomplete rows. Check actual ink bounds, including strokes, when changing padding; nominal two-mark cells slightly overlap but their ink must not. New style resources must be covered by pool reset and teardown paths; chord fill textures and frame shaders are shared and reused.
- RS+ attack combinations use one padded mask rather than overlapping several full-size symbols. The static attack precedence matches Current for contradictory imported flags. Accent rims and chart-driven sustain techniques remain independent of the face mask.
- `settings.html` hydrates the style dropdown and changes descriptions of Vibrancy, Glow and Bloom to match the selected style. The Bloom title becomes **Soft glow** in RS+ inspired. Text size applies to text labels; RS+ glyph masks use square world planes so circle/triangle proportions are not stretched to gem aspect ratio. Some reference glyphs deliberately cross the gem edges.
- RS+ open/muted bars reuse their outline mesh as the vertical stem: hide it inside a visible enclosing ordinary chord frame; otherwise extend it fully to the floor. Never select a short tick via `fromChord`, which also includes standalone hand-shape/arpeggio association. Accent changes the bar thickness, not its horizontal extent. Keep lefty mirroring, stem bounds, halos and verdict faces consistent. The original open rim remains available for Current.
- `prebendOffsetWorld()` samples the same onset envelope as the trail. Do not require the first imported curve point to be exactly at time zero: the trail clamps a later first point back to onset.
- Regression entry points: `highway_3d_rsplus_settings.test.js` (coercion, panel refresh, storage failure, UI hydration), `highway_3d_rsplus_techniques.test.js` (mask combinations, contrast, caching/teardown, fractional bends), `highway_3d_rsplus_highway_theme.test.js` (default-only surface and theme/style round-trips), the RS+ chord tests, and the existing live-settings/bend/repeat/trail suites. Screenshot and motion review are still required for proportions, layering, and readability.

## The `bundle` object

Every per-frame renderer call receives a `bundle` from feedBack core. Fields used by this plugin:

- `currentTime` — playback time in seconds (drives `dt` for everything)
- `notes`, `chords`, `beats`, `sections` — chart arrays (already difficulty-filtered by core)
- `chordTemplates` — array indexed by `ch.id`; each `{ name, frets: [N] }`
- `lyrics` — syllable array `[{ w, t, d }, …]`
- `inverted` — display flag honored via `sY(s)` (low-string-on-top vs the default low-string-on-bottom)
- `lyricsVisible` — gate for lyrics overlay
- `renderScale` — pixel-ratio multiplier from the user's quality setting
- `songInfo.arrangement` — used as the bass-name fallback in `resolveStringCount()`; other song metadata also supports overlays and tuning-label fallbacks.
- `stringCount` — feedBack#93; always prefer this over deriving from tuning/arrangement
- `lefty` — display flag consumed by this renderer from `bundle.lefty`. Captured into `_leftyCached` before each frame so `xFret()`, `xFretMid()`, `boardSpanX()`, board geometry, note placement, and the camera shoulder offset mirror the fret axis for left-handed mode. A runtime lefty flip rebuilds board state and mirrors `curX`/`tgtX` plus the lookahead camera X cache so the camera does not drift across the neck.
- `getNoteState(note, chartTime)` — per-note scorer verdict, captured as `_ndGetNoteState` and resolved in `drawNote()` alongside event-driven marks and compatibility fallbacks. `'hit'` / `'active'` and `'miss'` select style-specific rim/side feedback and sustain treatment; they must not erase the string color or technique glyph. Preserve the existing source identity and chart-time lookup when changing visuals. Object verdicts can also carry `{ points, mult, popKey }`: points and multiplier feed the score pop, while `popKey` deduplicates shared chord judgments and sustained verdicts. Guard optional fields for older providers.

`tuning` and `capo` feed only the nut's open-string pitch labels. They prefer the bundle's effective values; `songInfo` remains the original metadata fallback. Note placement never reads them.

Core reuses the bundle OBJECT across frames (mutated in place); never cache it or compare its identity between frames — field values are only valid for the current draw call. Field-identity caches on ARRAY fields (this plugin's `_mergeCacheChordsRef === bundle.chords` etc.) remain valid: arrays still swap reference when chart data changes. Core also exposes `bundle.lowerBoundT(arr, time)` (lower-bound on `.t`, notes/chords) and `bundle.lowerBoundTime(arr, time)` (on `.time`, beats/anchors/sections) — prefer these over the local `lowerBoundT` helper when a downlevel-host fallback isn't needed.

### Score FX (notedetect game-scoring layer)

- **"+N" score pops** → `_fxSpawnPop()` from `drawNote()` (just after the provider verdict-override block), drawn by `drawScoreFx()` (called from the `lyricsCtx` block in `draw()`, right after `drawNotedetectLabels()`). Fixed 24-slot pool (`_fxPops`), deduped per `popKey` via the TTL'd `_fxSeen` map (pruned in `drawScoreFx`). Pops rise/fade over 700 ms; font size scales with the multiplier tier.
- **Session FX** → `notedetect:fx` events (`{ fxType: 'multiplier'|'milestone'|'streakBreak', ... }`). notedetect dispatches each detail object twice in the same task: on `window` (unscoped, first) and as a bubbling CustomEvent from its per-panel instanceRoot (scoped, second). The listener (`_fxOnFx`, bound with the other notedetect listeners) treats element-targeted copies as authoritative — accepted only when their root lives in this panel's container — and **defers the window copy by a task** (`setTimeout 0`): if the element copy (same detail reference) arrived meanwhile it's dropped as a duplicate, otherwise it's the compat fallback for a detector whose root isn't in the DOM. This keeps splitscreen panels from rendering each other's FX even for the first event of a session. Effects: milestone → particle burst from a 4-slot Float32Array pool (`_fxBursts`), multiplier tier-up → expanding ring pulse at the strike-line centre, streak break → brief red wash.
- **Skin palette** → `_fxResolvePalette()` reads `localStorage['feedBack_notedetect_skin']` (`neon`/`esports`/`metal` → `_FX_PALETTES`) at listener-bind time and on the `notedetect:skin` bus event. The display fonts are document-loaded by notedetect's stylesheet, so the overlay canvas can reference the family names directly.
- Everything lives on the 2D overlay layer — no Three.js geometry, no `txtMat()` cache traffic, nothing to dispose; `teardown()` deactivates the pools and removes both listeners.
- **This block is the reference implementation for other renderer plugins** (drum highway, piano, custom highways) that want score pops / session FX: copy the `_fxOnFx` dedup+scoping listener, the `popKey`-keyed seen-map (cleared on backward seek), and the `_FX_PALETTES` skin mapping. The full consumer contract (events, payloads, provider verdict fields, theming variables) is documented in feedBack-plugin-notedetect's `CLAUDE.md`.

If a bundle field is missing here, check `_makeBundle()` in the core's `static/highway.js`. This plugin is bundled in the same repository under `plugins/highway_3d/`.

## Per-string state arrays

Several frame-local arrays are sized to `nStr`:

```js
const noteState = {
    stringSustain:    new Array(nStr).fill(false),
    stringAnticipation: new Array(nStr).fill(0),
    fretHeat:         new Array(NFRETS + 1).fill(0),
    strGlow:          new Array(nStr).fill(0.5),
};
```

Anything that indexes a per-string array MUST be guarded by `validString(s)`. The function checks that `s` is an integer in `[0, nStr)` (returning `false` otherwise so the caller can skip), warns once when an out-of-range index is seen, and keeps the `mStr / mGlow / mSus / projMeshArr` lookups safe. It does NOT clamp — out-of-range strings are dropped, not silently mapped to a valid one. `filterValidNotes(notes)` is the chord-note equivalent (allocates only when something would actually be dropped).

## RS+ readability sizing

RS+ default-theme inner dividers use `rsLaneDividerMaterial()` with a shared
plane and analytic pixel coverage. Preserve their authored Z endpoints and
clamp the interpolated width in the fragment shader so splitting a segment
does not change its appearance. `uViewport` uses the actual drawing-buffer
size, including render scale and DPR. The 2.01 render order keeps these lines
above coincident extension lines (2) and below inlays (3), independent of
transparent distance sorting. Every `pLaneDivider` caller must restore the
geometry through `setLaneDividerGeometry()` when a pooled mesh changes role.
`tests/browser/highway-rsplus-dividers.cjs` checks actual GPU pixel continuity,
segment joins, style reuse, resizing, clipping and bounded GPU resources.

`RSPLUS_SUSTAIN_STROKE_SCALE` keeps individual ribbons and their edge padding
at 60% of Current's dimensions. `sustainMotionWidth` divides out that same scale
so tremolo sweep and its visibility bounds remain independent of stroke weight.
Shared chord-hold rails have separate sizing. The user's visibility minimum is
shared by both styles; do not silently adjust it when tuning RS+ appearance.

`drawRsPlusTechniqueGlyph` receives the face-cell scale when caching a mask.
Compound symbols use bounded stroke compensation, with palm-mute endpoints
inset to preserve their painted footprint. Keep hollow harmonic centers and
test the actual composite mask's ink bounds, not scaled standalone masks.

## Linked sustain visibility

`hwyBuildLinkedTrailPaths` builds renderer-only paths once when chart arrays change,
using the strict `bendLinks` entries from `hwyLinkNextTargetNotes`. The broader
continuation-head suppression set is deliberately independent: a suppressed head
alone does not prove a continuous drawable trail. Do not mutate chart notes or
reuse these paths for scoring or authored sustain duration.

`_linkedTrailPaths.byNote` carries membership through temporary chord-note and
mute-normalization objects. Reset or delete that membership when reusing scratch
objects, and clear the graph on teardown. Piece lookup is binary and must work
when seeking backward or when the path's original attack is off screen.

Visibility samples each piece through the existing `sustainTrailCenterXAt` model,
and only the path's final endpoint is terminal. Body and outline must use the same
visibility envelope at joins. The local query includes taper/recovery margins;
mode-3 future depth priority remains independently cached per original event.

Obstacle indexes distinguish visible attack heads from emitted trails. Hidden
continuations contribute no phantom gem, while an emitted continuation trail may
still overlap another trail. The trail-eligibility callback is the extension point
for renderers that suppress member trails or emit open chord-member trails.
Fret and string indexes use max-end trees to skip expired ranges, including those
behind an old long-running target. Keep these indexes chart-static, retain bounded
visible-window queries, and avoid scanning complete linked chains each frame.

When chord-hold guidance suppresses member ribbons,
`hwyBuildIndependentTrailOrigins` excludes them from linked paths and the hold
model excludes them from trail obstacles. Independent open chord members remain
eligible. `trailOpenLayoutAt` must match the actual chord/standalone rail spans,
including fallback bounds and rounded anchor timing. Rebuild this metadata when
the cached hold model changes; never infer a rendered trail from sustain alone.

`hwyTrailPriorityWorldZ` treats trail-first targets as foreground constraints,
not replacement positions: a target may raise the emitted segment's natural
sorting depth but must never move it backward. This also applies when an open
note after the sustain end causes endpoint narrowing; intervening notes must not
gain foreground priority as a side effect. Gem-first and attached-trail-first
options keep their target-depth rules. Preserve ordinary-gem ordering repair
before the physical-string relationship pass. Width envelopes and authored
timing are independent of this ordering constraint.

## Object pools

Pools live as closure refs (`pNote`, `pSus`, `pLbl`, `pBeat`, `pSec`, `pFretLbl`, `pLane`, `pLaneDivider`, `pChordBox`, `pChordLbl`, `pBarreLine`, `pNoteFretLabel`, `pConnectorLine`, `pDropLine`, `pSusOutline`).

The pool factory `pool(parent, mk)` returns `{ get(), reset() }`. **Every pool MUST be `.reset()`-ed at the top of `update()`** — otherwise objects from the previous frame stay visible. When you add a new pool, add the reset call too. Search for the existing block of `.reset()` calls at the top of `update()` to find where to add yours.

If a pool's mesh has per-instance state (its own material clone, its own texture map), set those fields each `get()` call so a recycled instance picks up the right values. The "first context wins" trap is real — recycled sprites that retain a stale `material.map` from a previous frame won't repaint. The chord-name label loops on this (search `lbl.material.map !== mat.map`) by checking before swapping.

## Key gotchas / pitfalls

1. **Adding a new pool? Reset it.** The reset block at the top of `update()` is easy to miss when adding a new pool elsewhere.
2. **`txtMat()` is cache-keyed by `(style, text, color, wide)` plus its color-space variant.** RS+ `noteFret`, `fretRow` and `chord` labels use a separate `|srgb` entry; Current retains its existing key and texture encoding. Calling with numeric `text` works (coerced via `String(...)`), but new label content creates a new texture forever. Don't generate dynamic per-frame text through `txtMat()` or you'll leak GPU memory. Static chord names and fret numbers are suitable cache entries. The `style` arg picks a `TXT_STYLES` preset — see below.
3. **Disposal in `teardown()` matters.** Three.js doesn't garbage-collect GPU resources. Every `material.dispose()`, `geometry.dispose()`, `map.dispose()`, and `ren.dispose()` call there is load-bearing. `teardown()` is called from `init()` (when re-initing), `destroy()` (setRenderer swap or `highway.stop()`), and on init failure.
4. **Don't use `tuning.length` for string count.** `bundle.tuning` (and `arr.tuning` server-side) is always 6 elements even for bass — feedBack pre-fills the array with zeros for unused strings. Use `bundle.stringCount` (feedBack#93), with `/bass/i.test(arrangement)` as the only acceptable fallback. There's a comment in `resolveStringCount()` documenting this.
5. **lyricsCanvas DOM order.** The 2D overlay canvas is appended to `wrap` AFTER `ren.domElement` and given `z-index:1`. This is the empirically-correct order — earlier versions had it before the WebGL canvas, which broke in splitscreen panels with `position:relative; overflow:hidden`. Don't reorder without testing both modes.
6. **Preview and attack are different layers.** A ghost digit may legitimately use the preview layer, but must not cover a coincident incoming technique mark. RS+ inspired handles this with `techniqueCoversGhost`; preserve it when changing preview timing or note footprints.
7. **`renderOrder` on pooled transparent objects is sticky.** Use `renderOrderForLayerAtZ()` and the named layer contract for note bodies, rims, trails and technique marks. Reassign the layer on every pool use; a far note's marker must not draw over a nearer chord.
   - **Corollary: `depthTest: false` alone does not put a sprite on top.** It only removes depth-buffer comparison. Follow the named transparent ordering policy rather than assigning a universal order of 1000 to technique planes. Opacity 1 also does not justify moving all note materials into the opaque queue.
8. **`ch.id` may be missing.** Some chord events lack an `id` (or it doesn't index into `chordTemplates`). Always optional-chain: `bundle.chordTemplates?.[ch.id]?.name`. The chord diagram + name label both gate on a non-empty result.
9. **The `aspectScale` clamp (`Math.max(1, …)`).** Without it, ultra-wide split-screen panels (top/bottom layout, ~5:1 aspect) yield aspectScale ≈ 0.33, which dollies the camera way in and kills highway depth. The clamp keeps wide panels at baseline depth and only allows narrow panels to dolly the camera back.
10. **The `_oobStringWarned` flag is reset on `nStr` change** in the returned `draw()` — switching from guitar (6) to bass (4) re-arms the warning so a malformed bass chart still gets logged.
11. **`renderOrder` values for the lane and dividers are explicit** in `update()` (`lane.renderOrder = 1`, `div.renderOrder = 2`). The lane plane needs to draw above the static fretboard plane (which has no renderOrder), and dividers need to draw above the lane.

## Tweaking colors safely

The eight-color palette `S_COL` is the single source of truth for per-string color. **Don't hardcode hex values inside `drawNote()` or `update()`** — every per-string color reference is either an entry in `S_COL` or one of the per-string material arrays (`mStr`, `mGlow`, `mSus`, `mProj`, `mProjGlow`) built from it.

Palettes already support custom string colors. Use `activePalette` and the existing palette update helpers; do not hardcode a string color because a reference screenshot happens to show that technique on a red, orange, or green string.

Non-string colors (the stock lane hexes `HWY_LANE_STRIPE_ODD_HEX`/`_EVEN_HEX` — now overridable per Highway theme, see "Scene colors" above; fret-row label colors `#ffe84d` / `#9ab8cc`, fret-dot color `0x556677`, lyrics box rgba, Current chord-name gold `#e8d080` / RS+ white `#f3f4f6`, etc.) are scattered as literals — that's intentional for now, since they're scene-wide accents rather than per-string. Pulling them into named constants is fine if you're already in that area.

## Tweaking text-sprite styling

Most text labels are rasterised by `txtMat(text, color, wide, style)`, with appearance driven by `TXT_STYLES`. **Do not edit the body of `txtMat()` to change a single label class** — change its preset. RS+ technique masks are separately cached by `rsPlusTechniqueMat()` and `rsPlusNoteFaceMat()`; they do not inherit text-sprite shadows or add bend-amount text.

RS+ `noteFret`, `fretRow` and `chord` canvas textures are explicitly sRGB. This keeps gold fret text from washing out to cream; chord names use white. The encoding correction is scoped to those RS+ cache variants and leaves Current's text textures unchanged.

Current presets and their callers:

| Preset | Used by | Default look |
|---|---|---|
| `fretRow` | Fret-number row under the board (`update()`, fret-row block) | Arial Black 900, 256px source canvas, 18px dark outline + soft drop-shadow — designed to pop against any background |
| `noteFret` | Per-note connector numbers below the board (`drawNote()`) | Same heavy treatment as `fretRow` |
| `chord` | 3D chord-name labels above chord boxes | bold sans, 128px source, 6px outline; gold in Current, white in RS+ |
| `section` | Section banners ("Verse", "Chorus") at fret 12 | bold sans, 128px source, 6px outline |
| `technique` | Generic technique text and legacy callouts; not the RS+ face masks | bold sans, 128px source, 6px outline |
| `open` | Retained open-string text preset; incoming bars do not currently draw a "0" | bold sans, 128px source, 6px outline |

Style fields:

- `font` / `wideFont` — full CSS font shorthand (weight + size + family); `wideFont` is used when `wide=true` (long-aspect labels: chord names, section names, "↑1/2", "~~~"). Keep both in sync if you change weight or family.
- `srcH` — source-canvas height in px. Wide labels use `srcH * 4` for width. Larger `srcH` keeps glyph strokes crisp after bilinear downsampling onto small sprites — bumping it from 128 → 256 was the difference between thin-and-blurry and crisp on the fret-number presets. **Keep `srcH` power-of-two** (128, 256, 512, …): WebGL1 and Three.js silently disable mipmap generation on NPOT textures and fall back to a non-mipmap min-filter, which causes shimmer/aliasing on labels far down the highway. The 4× width derivation preserves POT-ness too (e.g. 256 → 1024 wide).
- `stroke` / `strokeW` — outline color and line-width in source-canvas px. Set `stroke: null` or `strokeW: 0` to skip the outline (faster cache rasterisation, no contrast halo).
- `shadow` — `{ color, blur, dx, dy }` or `null`. Drawn via canvas 2D `shadowColor` / `shadowBlur` / `shadowOffsetX/Y` *before* the stroke and fill, so it haloes the whole glyph.

**Cache key includes the preset name** (`style|wide|text|color`), so two presets with otherwise-identical text produce two distinct cached materials. Adding a new preset is safe — just add the entry to `TXT_STYLES` and pass its name as the 4th arg at the call site. Forgetting to pass `style` falls back to `'technique'` (the broadest, most generic preset) and is the right default for a brand-new label class.

**Don't generate per-frame distinct text through `txtMat()`** (e.g. interpolated values, tick counters). The cache is unbounded and will leak GPU memory across the session — see Pitfall #2.

## Lifecycle (setRenderer contract)

Per feedBack#36, the factory returns `{ init, draw, resize, destroy }`:

- **`init(canvas, bundle)`** tears down any prior state, sets `highwayCanvas`, lazily loads Three.js, runs `initScene()`, calls `applySize()` (with a `retrySize` rAF loop fallback if the canvas isn't laid out yet).
- **`draw(bundle)`** is gated on `_isReady`. Re-resolves `nStr` / inverted / renderScale, then `update(bundle) → camUpdate(bundle) → ren.render → 2D overlays`. The `_lastHwW/_lastHwH` check at the top auto-resizes when the splitscreen plugin bypasses `resize()`.
- **`resize(w, h)`** is gated on `_isReady`. Just calls `applySize()`.
- **`destroy()`** is idempotent. Sets flags, runs `teardown()`, drops `highwayCanvas`. Tolerates being called on an instance that's been destroyed and re-init'd already (resets `_lastHwW/H`, `_diagChord`, etc.).

The factory **returns a fresh instance per call**, so splitscreen's per-panel `setRenderer(feedBackViz_highway_3d())` gets independent state per panel — important because the chord diagram, projection meshes, etc. are all per-instance.

## Branching / PR conventions

- Feature branches off `main`, descriptive name (e.g. `fix/preview-stacking`, `feat/palette-picker`).
- PR target: target the contributor's own fork by default unless they ask otherwise; confirm before opening a PR upstream. Run `git remote -v` in this directory to see the remotes that are configured locally.
- Commit messages: short imperative subject, optional body explaining *why*. Don't summarize the diff — the diff already does that.
- This plugin is bundled **in-tree** at `plugins/highway_3d/` inside the `got-feedback/feedBack` repository (not a gitlink/submodule). It ships with the default container image. Changes go through the normal feedBack PR process — no separate upstream repo to sync.

## When in doubt

- `screen.js` is one file — `Grep` for the function name or banner text before guessing.
- The constants block at the top is intentionally exhaustive; scan it before introducing a new magic number.
- If a "polish" feels like it should be one or two lines but stretches into restructuring, double-check whether a per-frame state field, pool reset, or `validString()` guard already covers your case.
