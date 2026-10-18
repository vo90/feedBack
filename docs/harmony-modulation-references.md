# Independent modulation references

`tools/harmony_modulation_reference_points.json` freezes selected external key
annotations for six local songs before inspection of the new predictor outputs.
The freeze was **2026-10-18 15:22:24 UTC**; its SHA-256 is
`ddcdf6b4134f9e9963b61fc9d000dd2784faff71edd0c629a8debb7a9dbdf660`.
None of the six pack paths occurs in the earlier 53-pack development manifest.
This is a small, deliberately selected evaluation set, not a random sample or
an independent listening study. Once used to adjust the algorithm it becomes
development data and must not continue to be described as untouched holdout.

| Song | Selected reference regions | Purpose |
|---|---|---|
| Queen — We Are the Champions | C minor → E-flat major → F major, repeated | Sectional key changes |
| The Beatles — Something | C major → A major → C major | Bridge modulation and return |
| The Beatles — Lucy in the Sky with Diamonds | First A / B-flat / G cycle | Tonal changes with an ambiguous bridge boundary |
| Queen — Bicycle Race | First B-flat minor / A-flat / F / A-flat sequence | Multiple contrasting regions |
| Queen — Crazy Little Thing Called Love | Selected D-major verses/bridge | Borrowed-chord false-switch control |
| Queen — Another One Bites the Dust | Selected E-minor verse/refrain spans | Stationary-tonic, sparse-evidence control |

The intervals contain **11 unambiguous reference change boundaries**. Remaining
song portions are unscored; a gap is not an assertion that no change occurs.

## Provenance and ambiguity

The primary source is [Isophonics' human reference annotations](https://isophonics.net/content/reference-annotations),
with per-file URLs and hashes recorded in the JSON. Queen annotations refer to
*Greatest Hits I*, Parlophone 0777 7 8950424. The curator rates its key annotations
as moderate confidence and warns that Beatles files can omit changes.

[Alan W. Pollack's analysis of Something](https://www.icce.rug.nl/~soundscapes/DATABASES/AWP/s.shtml)
corroborates the main C/A/C scheme but identifies another brief A shift in the
outro; that ending is excluded.
[His Lucy analysis](https://www.icce.rug.nl/~soundscapes/DATABASES/AWP/litswd.shtml)
places G in the bridge before the refrain. The reference accepts B-flat or G
during that transition and excludes later cycles where the key file omits an
A return. Neither choice was informed by predictor results.

[Licensed Crazy Little Thing score metadata](https://www.musicnotes.com/sheetmusic/queen/crazy-little-thing-called-love/MN0064358)
supports D major; an [original bass-transcription analysis](https://freebasstranscriptions.com/transcriptions/bass-transcription-queen-crazy-little-thing-called-love/)
explains its B-flat/C chords as modal interchange. [Licensed Another One Bites
the Dust score metadata](https://www.musicnotes.com/sheetmusic/queen/another-one-bites-the-dust/MN0066010)
supports E minor. Conventional key agreement does **not** establish that one
diatonic scale suits every chord; modal color remains relevant.

The original Isophonics redistribution license is unspecified. This repository
contains selected factual ranges, source metadata and links, not the downloaded
annotation archives, chord files, charts or audio.

## Local timing and pitch alignment

Local verification files are under
`C:\Dev\feedback-workspace\verification\songsterr-harmony-modulations-20261018`.
`modulation-manifest.json` records pack paths, whole-pack hashes, source revisions,
and independent alignment anchors. Each anchor compares a published human chord
onset with an authored chart event and its observed MIDI pitch classes. The
source adapter was used to read charts; the predictor was not called. Whole-pack
hashing reads container bytes; no audio was decoded or listened to.

The transform is `chart = chart_offset + (reference - reference_offset) * rate`.
All selected packs use rate 1 and no pitch transposition. Offset checks have
maximum recorded residuals of 0.045–0.213 seconds; declared timing uncertainty is
0.5 seconds. Bicycle Race has an additional early verse check with a 0.269-second
residual. These are chart-to-annotation correspondences, not proof that the
masters are acoustically identical. Bohemian Rhapsody and Play the Game were
screened but excluded because their complete alignment was not established.

Report exact key agreement, abstention, same-collection agreement and transition
timing separately. Do not call these numbers scale accuracy or listening accuracy.
