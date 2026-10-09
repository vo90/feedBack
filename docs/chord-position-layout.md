# Chord boxes and generated hand positions

## Authored archive lane alignment

**Prototype only; superseded by the provenance design below.** The source-format
switch in this branch is not ready for broad runtime integration. The geometry
tests establish the lane-aligned rendering, not a universal origin classifier.

Playback identifies archive-authored FeedPaks by `ext.source.format` equal to
`psarc-manifest2014`, with no generated `chartGuidance` receipt. These charts
send `song_info.chordFrameLayout = "lane"`. Their chord frames, repeat boxes,
holds, handshape guides, open members and trail footprints use the authored
anchor span when it contains every fretted member. Invalid anchors, full-neck
placeholders and lanes that would exclude a note retain shape-local fallback.
The lane at the chord onset owns a sounding hold; later position changes do
not move already struck material.

Generated Songsterr charts, unknown sources and absent policy fields keep the
existing shape-local rule below. The selection changes playback geometry only;
it does not rewrite anchors, notes, timings, templates or archive files. A wrong
handshape reference is still rejected for hold timing: lane alignment must not
invent sustain durations from an unrelated chord.

The Back In Black G5 passage at 71.998 seconds is the regression example:
its authored lane is 2–5, so its boxes now occupy 2–5 rather than 3–6. Its
separate A5 handshape reference remains a chart-data issue.

## Lane provenance investigation (2026-10-08)

### Recommended decision

Select layout from the origin and authority of the **effective anchors**, after
difficulty selection and supported chart transforms. Do not select it from the
song name, input service, whole-arrangement source label, presence of anchors,
or presence of any generated-guidance record.

| Effective lane state | Box behavior |
|---|---|
| Declared source-authored or user-authored | Use the resolved lane at the attack time for the frame, repeats, open members and shared-hold footprint. |
| Verified generated | Preserve the existing generated-position and shape-local box behavior. Switching layout must not trigger position regeneration. |
| Mixed | Resolve the origin of the active lane segment and selected difficulty level. |
| Missing | Use the existing inferred fallback without claiming it is authored. |
| Unknown, conflicting, unsupported or stale evidence | Preserve existing compatibility behavior and report why origin cannot be established. Never silently call it authored. |

Here, authored means the chart supplies an authoritative hand-position plan.
It does not assert that a human manually entered every coordinate. A source
author may have used tools to create the plan.

Authored lanes that exclude playable notes need one shared, safe resolution
used by both the visible lane and its boxes; separate floor and frame repairs
would recreate the mismatch. Sustains retain their attack-time position when
later anchors change. Standalone notes, scoring and musical timing remain
independent of this presentation decision. The missing G5 hold is separate:
anchor provenance cannot turn a mismatched A5 handshape into a valid duration.

### Findings reproduced against the current sources

Investigated Core `35a7e39`, FeedForge `4964880`, and Editor `e6185e7`.
Eight executable probes exercise the real pure guidance functions, difficulty
generator, Core serializer and Editor arrangement writer without library writes.

1. FeedForge already records generation ownership in
   `ext.chartGuidance.fields`. A chart with supplied anchors and missing
   handshapes receives `fields: ["handshapes"]`; its anchors remain unchanged.
   The mere presence of this receipt cannot classify the anchors as generated.
   Conversely, absence of `anchors` from that list does not independently
   prove authorship: the generator knows only that it preserved existing data.
2. The receipt's `sourceAuthored: false` applies to those owned fields, not all
   guidance or all notes in the arrangement.
3. Existing `guidanceSha256` hashes the generated fields together. Editing only
   a handshape invalidates the same digest as editing an anchor, even when the
   anchors are unchanged. Separate anchor integrity is needed for independent
   lane classification.
4. Music edits can leave the guidance digest matching while invalidating
   `musicSha256`. Origin and applicability are separate facts; stale generated
   positions must not become authored just because verification fails.
5. A full chart with preserved 2–5 anchors and generated handshapes can produce
   practice levels with newly generated 3–6 anchors. Four such levels were
   reproduced. An arrangement-wide layout flag cannot represent both.
6. Core's `Arrangement`, `PhraseLevel` and `Anchor` serialization currently
   omits these provenance records. The probe lost the root record and all four
   level records after load/to-wire. Classification must occur before numeric
   normalization and survive through the effective playback lane data.
7. Editor `_arr_dict_to_wire` chooses supplied `anchors_user` or
   `_compute_anchors`, but records neither choice. The two paths produced
   byte-equivalent JSON objects in the probe. Geometry cannot recover lost
   origin. The save builder also reconstructs arrangement fields without
   passing the existing guidance extension through.
8. Songsterr import starts with empty anchors and finalizes them after timing;
   Hybrid materialization regenerates intact owned guidance after composing
   the selected notes. These final output anchors remain generated, even when
   the musical material comes from multiple tracks.

The archive converter's `psarc-manifest2014` tag records arrangement identity
and properties. Its conversion path copies source anchors, but the tag itself
is not an integrity receipt for those anchors or their later edits. It can be
legacy evidence; it is not the general rendering rule.

### Data and lifecycle contract

Introduce versioned **anchor-specific provenance** with origin, producer/version,
and an anchor-content digest. Generated data also records its existing position
policy and relevant input digest. Retain separate origin and validation status.
These are integrity checks, not cryptographic proof of human authorship.

The record is scoped to an anchor collection at arrangement or phrase-level
scope. Mixed collections need per-segment ownership, bound to the collection
digest or stable row identities, so sorting/slicing cannot silently attach a
label to a different lane. Uniform collections may use one default record.
Exact field names and the additive schema belong in the shared format contract
before implementation; avoid another renderer-specific source-format flag.

- Source import declares preserved source lanes; the generator declares only
  the lanes it produces. Generating handshapes cannot relabel existing lanes.
- Copying, clipping or retiming lanes carries their origin with explicit
  transformation lineage. Regenerating lanes creates new generated records.
- Editor saves preserve untouched origin; a lane edit marks affected segments
  user-authored. Explicit regeneration marks replaced segments generated.
  Editing notes or unrelated handshapes must not automatically change lane
  origin. Note changes can invalidate generated applicability separately.
- Hybrid composition and practice-level generation stamp the final lanes,
  after composition. Each selected level/segment retains its own record.
- Core resolves supported evidence on raw chart data before rounding, retains
  it across serialization, and streams compact resolved origin with anchors.
  Difficulty filtering and transforms preserve the association. Unrecognized
  transforms that replace lanes cannot inherit source authority by accident.
- The renderer consumes one resolved layout helper for authored floor/boxes,
  frames, repeats, shared holds, open members, trail footprints and hit edges.
  Cache identity includes lane provenance/revision and effective difficulty.

### Compatibility and acceptance gates

Recognized, intact old `chartGuidance` receipts that explicitly own `anchors`
can resolve as generated. Check their declared scope, fields, supported policy,
content/input digests and phrase window with inherited tuning/templates before
normalization. A receipt owning only handshapes says nothing conclusive about
anchor origin. Broken or unknown receipts remain unverified; never treat a
failed generated check as evidence of authorship.

Older authored packs need documented legacy evidence or verification against
their source/conversion data. When origin was discarded, it cannot always be
recovered automatically. Keep such cases explicitly unknown and preserve their
behavior until reviewed. A file extension or service name is insufficient.

Before broad integration, verify import -> save -> reload -> playback; intact
and edited receipts; unchanged editor saves; single-segment edits; regeneration;
root/phrase-level differences; hybrid/mixed passages; transforms; unknown legacy
data; lefty/inverted views; both camera modes; seek and sustain boundaries.
Compare existing Songsterr frame geometry to the unchanged baseline, including
wide slide corridors, open preparation, held chords and mixed techniques.

The read-only current Master library manifest scan examined 8,002 FeedPaks,
with no read failures and no Songsterr import markers. This does not prove the
absence of unlabelled imports. Real Songsterr-pack acceptance is still pending
their location; the generated-pipeline findings above are executable source
probes, not a claim to have audited those user files.

## Timed slide positions

The shared policy is now `slide-follow-v1`. Known slides produce moving
four-fret positions, widened only when simultaneous notes or the supported
fret-spacing layouts require it. The generator uses the highway's pitched and
unpitched easing, preserving the original timebase even if a replacement pick
ends the old note's guidance. Targetless slide gestures retain their location.

For Cirice at 267.38–272.72s, the fret-13 to fret-0 slide moves the lane from
12–15 down to 1–4. The existing Stable Straight camera consumes those anchors;
its short-detour filter retains a sequence moving in one direction. No camera
controller or renderer change is needed. The ending region remains through
the rest, until new playable material establishes another position.

Plan: generate timed occupied cells; version the policy and preserve ownership
guards; copy the canonical FeedForge algorithm into Core; verify the loader,
archive integrity and actual camera/lane movement. Older generated policies,
including `open-preparation-v2`, upgrade in memory after their hashes pass.
Authored and edited guidance and all musical data remain intact.

Verification for this change: 165 targeted FeedForge tests, 21 Core loader tests,
112 camera/region tests, and a read-only audit of 64 arrangements in 14 songs.
Six production WebGL runs cover uniform/logarithmic spacing at 0.5×, 1× and 2×.
They check the real lane bounds, camera movement, geometry visibility and seek
consistency. Run `tests/browser/highway-stable-camera.cjs --case slide-follow
--slide-fixture <json> --out <fresh-directory>` with an existing Playwright
installation. The fixture specifies `bundle`, `start`, `end`, `capture`,
`startFret`, and `endFret`; private chart fixtures remain outside source control.

The sections below record the earlier chord-position change and its validation.

## Implementation plan

1. Give fretted chord frames a shared shape-local bound: lowest fretted note,
   at least four fret cells, extended only for that shape. Use the same bounds
   for shared holds, handshape guides, open members and trail visibility.
   Clamp at the end of the modeled neck while retaining four cells.
2. Generate chord-aware position anchors in FeedForge. Chord attacks establish
   their own preferred position; overlapping sounding material and slide
   corridors remain covered. Release excess width when its demand ends.
   Single-note passages retain stable positions and bounded legato previews.
3. Backport the same pure position algorithm into the game for load-time
   compatibility. Only refresh hash-verified, FeedForge-owned anchors from
   older guidance. Do not modify archive files, musical events, authored
   anchors, edited guidance, or unknown policies. Handle difficulty levels.
4. Validate behavior with unit/integration regressions, all 14 current test
   library songs read-only, and background rendering checks where available.

## Acceptance examples

| Notes | Box |
|---|---|
| 5, 7, 7 | 5–8 |
| 7, 8 | 7–10 |
| 3, 5, 5 | 3–6 |
| 5, 10 | 5–10 |
| 22, 24 | 21–24 (neck boundary) |

In Rats, the 3→8 slide at 105.5375 lasts until 105.78625. Its 3–8
lane must not survive into the following 7–8, 3–5 and 5–7 chords unless
another sounding note independently requires those frets.

Open-only shapes inherit a contextual position. Mixed open/fretted shapes use
the fretted members. Unpitched mutes do not establish a position. Arpeggio
frames retain their complete template shape. Camera easing remains separate
from chord geometry and must consume the corrected positions in all modes.

## Cause and implemented behavior

The renderer previously reused a covering position anchor as the chord frame.
That made a chord inherit both the unused frets on the left and excess width
from an earlier slide or chord. The generator also retained a wide anchor until
three narrow attacks spanned at least one second. The combination explains the
reported boxes even though all their notes were technically inside the lane.

`chordShapeLaneBounds` now supplies the bounds for frames, held-chord guides,
authored strum groups, open chord members, trail footprints and hit-edge flashes.
Each shape starts at its lowest fretted member and occupies at least four cells.
It has no dependency on another chord's width. An all-open shape uses four cells
at the contextual anchor position. The neck-end clamp is the explicit exception
to placing the lowest note in the first cell.

Generated lanes give each chord attack a preferred position at its lowest
fretted note. They widen only for currently sounding material, including a
known slide corridor, and release excess width when that demand ends. A genuine
overlapping sustain can therefore keep the lane wider than a chord's own box.
Single-note passages retain the existing stable-position and compact explicit
hammer-on/pull-off anticipation rules. An open-only attack also releases a
previous wide span. Camera interpolation is unchanged.

## Existing imports and shared policy

FeedForge owns the canonical pure `generated_hand_positions.py`. The game
contains a byte-identical compatibility copy and its MIT license. Update both
copies together; the library audit rejects divergent source bytes.

New imports record `positionPolicy: chord-local-v1` in their guidance receipt
and import recipe. Explicit regeneration upgrades older owned positions. The
game refreshes old positions in memory only when both music and guidance hashes
match the recognized FeedForge receipt. Authored anchors, edited data, unknown
policies and unsupported inputs retain their original positions. Phrase-level
guidance is checked with inherited chart metadata and clipped to its window.
The load adapter changes no notes, timings, templates or archive files.

## Verification

- 848 highway JavaScript tests passed, including partial-hit frame feedback.
- 202 Python loader, wire-format and arrangement tests passed; the final
  compatibility-only run passed all 11 cases after adding a future-policy guard.
- 82 targeted FeedForge guidance tests passed.
- Full FeedForge suite: 4,424 passed, five skipped, one subprocess import-path
  failure. That remaining end-to-end test passed with the isolated checkout's
  `src` supplied through `PYTHONPATH`. The earlier general-purpose environment
  also lacked the required `yt-dlp-getpot-wpc` distribution; the full run used
  the existing prepared FeedForge build environment instead.
- Read-only audit: 64 arrangements in 14 songs; 50 changed position layouts.
  Independent active-fret coverage checks passed, canonical policy copies
  matched, and all source music and archive hashes were unchanged.
- Actual headless WebGL: 50 RS+ cases and four Current-style Rats cases passed,
  including both camera modes and left-handed views. Checks measure the rendered
  chord meshes as well as the helper results; screenshots were inspected.

Reproduce the library audit with `tools/audit_generated_positions.py --library
<read-only library> --feedforge-source <checkout> --out <report directory>`.
Pass its `rats-after.json` to the browser harness using `--position-chart`.
Use `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH` to select an existing
Playwright installation and headless browser without launching the game.

## Runtime boundary

Implementation and tests run in isolated worktrees. Runtime integration is a
separate step: merge the reviewed Core and FeedForge commits into the selected
Songsterr branches, build FeedForge from that revision, and use the paired-runtime
plan/apply/seal/check lifecycle before launching. Keep the previous package and
refresh history; preserve the real library and both app profiles.
