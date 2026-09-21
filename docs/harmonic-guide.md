# Song harmony guide (3D)

This branch adds **experimental chart analysis** for existing Feedpaks. Enable
the guide and missing information is estimated automatically from all available
instrument arrangements. No re-conversion or manual annotation is required.
The estimates are not a verified transcription of the recording.

Select **3D Highway**, load a song and click **Harmony guide**. While enabled,
the header shows the song key, suggested scale, current chord or target note,
and the next four changes. Smaller windows show fewer upcoming changes.
The countdown uses the song's beat map, with seconds as the fallback.

The panel docks near the top between the song information and right-hand HUD
when there is room. The dock reserves space for native lyrics and overlay cards.
Use **Move harmony guide** to drag the information, status and legend together.
The panel snaps to nearby edges and remembers its position across songs and
restarts, with positions kept inside the canvas when the window changes size.
Floating the panel leaves lyrics in their usual position. **Reset guide position**
returns it to the top dock. With the move handle focused, arrow keys move the
panel, Shift moves faster, Enter saves, Escape cancels and Home resets it.

The target comes from authored harmony, your corrections, or the combined song
charts. It never follows the microphone, detected notes or scoring. A slash
chord such as C/E still targets C; E is its bass note.

During a sufficiently long rest in the selected arrangement, the guide shows
scale notes directly on the existing foreground strings and frets:

- Each scale note uses the regular 3D gem shape. Ordinary scale notes have
  transparent centres and outlines in their string colour.
  The default label is its interval from the scale root: R for the root,
  with correctly altered degrees such as ♭3 or ♯4.
- A white border identifies the scale tonic, which stays hollow until it is
  also the current target.
- The current chord's root or target note is filled with the native string-colour
  gradient and has a gold outline. Both borders appear together when the current
  target is also the scale tonic. Degree labels stay relative to the scale.
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

## Automatic chart analysis

When enabled in 3D, the guide shows `Analysing charts…` while a background job
reads the current Feedpak. Playback stays available. `From charts` identifies
generated information; missing evidence produces partial guidance. The song
key, scale and current chord can each be available independently. For example,
relative major/minor ambiguity can leave the key unknown while their shared
pitch collection still supports a scale suggestion.

The analyser reads all fretted arrangements at full authored difficulty, not
just the selected part. Rhythm chords and timed handshapes can therefore guide
improvisation during a lead rest. Bass can support tentative root suggestions;
it does not automatically establish a chord's major/minor quality. Muted
scratches are excluded from pitch evidence. Explicit sustains and linked holds
are retained. Chord evidence expires instead of continuing through an
unobserved passage forever. Unknown harmony is different from an authored N.C.

In **Songs**, use **Select**, choose up to 100 local Feedpaks, then click
**Analyse harmony**. The batch shows per-song progress and supports cancellation.
Current-song analysis takes priority over queued batch songs. Results are cached
under the active profile's `harmony_analysis` directory; no feedpak is modified.
Changed sources or algorithm versions invalidate cached results. Errors have a
retry action and do not prevent playback.

## Song data and local corrections

The guide reads standard optional feedpak manifest entries `keys` and
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

Legacy authored events continue until the next. A null/omitted root event
explicitly means N.C.; `unknown: true` explicitly means unknown. Events may have
an `end` in chart seconds. Every generated event has a finite end. A root with
no quality is a target note, without an inferred major or minor chord.

Use **Edit** to add missing annotations or correct them. Times accept seconds
or `m:ss`; chord examples include `Am`, `F`, `C/E`, `A note` and `N.C.`.
Key, chord and scale rows are independent, with optional end times. Scale roots
and types can change without relabelling the song key. Saving checks the complete
timeline for unsupported chords and conflicting scale/chord tones. Only changed
tracks become local corrections; editing a chord does not freeze generated keys.

Corrections are stored locally, never written into the song pack. They are
keyed by song identity and source revision, so different libraries and changed
source songs do not silently inherit an old guide. **Use song annotations and
analysis** removes that song's local correction. If browser storage or source identity is
unavailable, the editor reports that it cannot save.

Priority applies independently to keys, chords and scales: a local correction
(including a deliberately empty track), then an authored track, then generated
estimates. An authored key without an explicit scale does not suppress a
generated scale. Deliberate authored unknown spans remain unknown.

## Musical limits

The default suggestion is major or natural minor from the supported key.
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

The initial analyser favours major/natural-minor context, with harmonic minor
over a supported minor-key dominant. It withholds unsupported chromatic scale
suggestions instead of forcing every chord into one scale. It is less reliable
on blues, modal riffs, ambiguous relative keys and long, changing instrumental
pieces. A compatible pitch set alone does not prove a good musical suggestion.
Confidence tiers describe evidence strength, not calibrated probabilities.

FeedForge charts tagged as RS2014 source use physical positive fret numbers;
fret zero is the capo-open string. Analysis and guide gems use that convention.
Other sources preserve Feedback's relative-fret convention; unverified capo
pitches cannot establish confident generated harmony. Fractional global tuning
is preserved separately from nominal note names. Grading is unchanged.

2D, automatic audio analysis, FeedForge export and online annotation import are
future work. External audio pitch-shift plugins must provide an explicit concert
pitch transposition contract before the harmony can follow them. Revoicing or
changing instrument tuning alone does not transpose the inferred song key.

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

`lib/harmony_source.py` is the read-only metadata adapter;
`lib/harmony_analysis.py` is the pure, versioned musical engine;
`lib/harmony_jobs.py` owns cancellable background work and atomic profile caching.
The `/api/harmony/analyse` and `/api/harmony/jobs/{id}` routes expose jobs without
doing inference in rendering or changing the library. The normalized input and
bounded result contract are independent of playback and can support a future
shared conversion engine.

ODLC evaluation distinguishes coverage, fixed chart-reference agreement and
musical accuracy. The experimental preview must not be described as satisfying
the proposed release accuracy gates without independent duration-based musical
review, especially for keys and scale suitability.
