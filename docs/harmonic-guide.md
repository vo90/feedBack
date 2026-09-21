# Song harmony guide (3D)

Select **3D Highway**, load a song and click **Harmony guide**. While enabled,
the header shows the song key, suggested scale, current chord or target note,
and the next four changes. Smaller windows show fewer upcoming changes.
The countdown uses the song's beat map, with seconds as the fallback.

The target comes from the song's harmony annotations. It never follows the
microphone, detected notes, the selected arrangement's individual notes or
scoring. A slash chord such as C/E still targets C; E is its bass note.

During a sufficiently long rest in the selected arrangement, the guide shows
scale notes directly on the existing foreground strings and frets:

- Each scale note uses the regular 3D gem shape and string-colour gradient.
  The default label is its interval from the scale root: R for the root,
  with correctly altered degrees such as ♭3 or ♯4.
- A white border identifies the scale tonic.
- A gold outline identifies the current chord's root or target note. Both
  borders appear together when the current target is also the scale tonic.
- Soft outlines identify supported fingering positions. The position closest
  to the camera's centre is stronger; adjacent positions remain quieter.

All scale notes in the visible fret range can appear. These are stationary
guide gems, with no travelling chart notes or scoring targets. The camera
continues to follow its usual arrangement or manual controls.

## Rest and display settings

**Edit** opens the local guide editor. The default minimum rest is four beats;
the alternative is three song seconds. Both values are adjustable. A known
qualifying rest reveals the guide near its start, rather than waiting for the
threshold to elapse. Sustains and authored linked holds count as occupied time.
The guide fades over the last beat before chart notes resume, or half a second
when no usable beat map exists. It remains hidden during shorter gaps.

The permanent header remains visible while chart notes are playing. Position
outlines can be toggled independently. **Gem labels** selects scale degrees,
note names, or no labels. Degree labels always refer to the suggested scale:
A natural minor uses R, 2, ♭3, 4, 5, ♭6, ♭7. Its F target gem therefore keeps
♭6 when highlighted over an F chord, while A remains R. Pentatonic scales keep
their actual intervals (R, ♭3, 4, 5, ♭7 for minor pentatonic), not numbers 1–5.
The enable state and
display preferences are stored in this browser/profile. Switching to another
visualisation hides the guide; closing the player releases its DOM and GPU
resources.

## Song data and local corrections

The first release reads standard optional feedpak manifest entries `keys` and
`harmony`. Their events use song-timeline seconds. For example:

```yaml
keys: keys.json
harmony: harmony.json
```

```json
{"version":1,"events":[{"t":0,"key":"Am","scale":"natural_minor"}]}
```

```json
{"version":1,"events":[
  {"t":0,"root":"A","quality":"min"},
  {"t":8,"root":"F","quality":"maj"},
  {"t":16,"root":"C","quality":"maj"},
  {"t":24,"root":"G","quality":"maj"}
]}
```

Each event continues until the next. A null/omitted root event explicitly means
N.C.; a missing harmony event means unknown. A root with no quality is a target
note, without an inferred major or minor chord.

Use **Edit** to add missing annotations or correct them. Times accept seconds
or `m:ss`; chord examples include `Am`, `F`, `C/E`, `A note` and `N.C.`.
Use a key row to change the scale for a later song region. Saving checks the
complete timeline for unsupported chords and conflicting scale/chord tones.

Corrections are stored locally, never written into the song pack. They are
keyed by song identity and source revision, so different libraries and changed
source songs do not silently inherit an old guide. **Use feedpak annotations**
removes that song's local correction. If browser storage or source identity is
unavailable, the editor reports that it cannot save.

## Musical limits

The default suggestion is major or natural minor from the annotated key.
Additional supported scales include the diatonic modes, harmonic/melodic minor
and major/minor pentatonic. Compatibility checks every known chord tone,
including a slash bass, against the suggested scale. Conflicting or unsupported
data leaves the scale guidance unavailable until reviewed. A globally correct
key does not automatically make one scale suitable for every borrowed chord.

Position outlines are provided for major/natural-minor CAGED and five major/
minor pentatonic positions in standard six-string tuning, including uniform
transposition and capo. Natural-minor outlines use relative-major CAGED shapes.
Other scales, string counts and altered tunings still show correct scale-note
locations, but do not receive invented position outlines.

This release does not analyse audio or infer chords from an incomplete
instrument arrangement. Songs without annotations require local setup.
2D support and automatic audio analysis remain future work.

## Implementation and verification

`lib/harmony.py` sanitises the optional track and identifies source revisions;
the loader and highway WebSocket expose it without changing chart grading.
The pure `harmony-guide-model.js` resolves harmony, positions and rest windows.
The per-highway controller caches prepared data, and `harmony-guide-ui.js`
owns the header/editor. The native 3D renderer draws bounded reusable marker
batches at its existing string/fret coordinates and projects readable labels.

Tests cover loading, malformed/missing metadata, revision invalidation,
musical conflicts, all supported position families in all twelve keys,
tuning/capo, sustains, loops/tempo, local storage, editor validation, native
geometry and browser lifecycle. Browser tests use a deterministic song stream;
they do not write to a real music library.
