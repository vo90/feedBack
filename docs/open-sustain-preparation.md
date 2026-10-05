# Preparing the next passage

Open-string pickups previously inherited the preceding generated hand position.
In Rats at 205.72s, the open low string stayed at frets 5–8 even though the next
pick at 205.96625s needed fret 2. The stable camera also used the same 0.6-second
lead for a busy passage and a plain held chord.

## Implementation

1. Resolve generated hand positions normally, then walk backward from each
   fretted destination through eligible plain open attacks. The whole pickup
   adopts the destination position and width at its first onset, without a
   total-run duration limit. Allow up to one local beat of intervening silence
   (0.5 s without beats, clamped to 0.1–1 s with beats); longer gaps break the
   run. A sounding fretted note, mixed chord or technique retains its context.
   Note onset, sustain and scoring data never change.
2. Share the identical pure generator with FeedForge. New imports carry
   `open-preparation-v2`; recognize the original unversioned position policy,
   `chord-local-v1` and `open-preparation-v1` for upgrades. The game checks original music and guidance
   hashes before generating positions in memory. Authored/edited guidance,
   unknown policies and current imports retain their saved positions. Explicit
   FeedForge regeneration upgrades recognized older guidance, including phrase
   windows; ordinary finalization preserves existing receipts.
3. Annotate the stable camera's cached stops with individual lead times. A quiet
   sustain or silent interval before the next position-changing attack can
   prepare up to 1.2 real seconds early, after at least 0.3 seconds of initial
   attack focus. Every intervening attack counts, including unpitched muted
   strikes. Slides with a destination fret, bends,
   timed vibrato, tremolo, harmonic changes and other technique holds retain
   ordinary focus. Same-string replacement ends an older technique constraint;
   activity on another string remains protected.
4. Add the extra preparation time to the finite easing duration, keeping the
   normal arrival deadline. Fit the upcoming area with the same early schedule.
   Keep current lane/held geometry protection and all pause, seek, rate, mirror,
   follow and zoom guards. Other camera modes retain their existing behavior.

The generator is O(N log N) during import/load. Activity processing is cached
with the camera plan; per-frame evaluation does not rescan musical events.
The renderer still positions all parts of an open cue from the same anchor,
so stems, bars, trails and occlusion footprints agree without separate offsets.

## Validation

Regression tests cover open pickups/runs/chords, gaps, active other strings,
wide destinations, techniques, receipt migration/immutability, intervening mute
attacks, partial chord releases, timed vibrato, replaced technique tails,
playback rates, mirrored motion and overlapping transition continuity.

The read-only library audit covered 64 arrangements in 14 songs. All active
frets remain covered and music/archive hashes are unchanged. Rats now uses
frets 2–5 at the 205.72s open pickup, matching the next fret-2 note.

The v2 audit also covers Cirice's three opens at 212.3925–213.05375s, which
now use the upcoming 12–15 position together. A long rest before those opens
does not break their relationship to the following fretted note. Parent beat
maps are inherited by difficulty levels for the same detached-pick rule.
The v2 generator has 121 passing Forge guidance/import checks and 17 passing
Core compatibility checks; the repeated 14-song/64-arrangement audit preserves
all active-fret coverage and music/archive hashes.

The complete highway JavaScript pass has 875 passing tests; 111 FeedForge
guidance/import tests passed. Core loader/arrangement/archive checks have 224
passes and two scanner failures reproduced on the unchanged baseline (Windows
fixture paths produce an unreadable configuration). ESLint has no errors and
the existing screen.js file-size warning. Ten completed headless cases passed.
An initial concurrent test/browser batch exhausted system allocation; the
sequential JavaScript pass and smaller browser batches completed successfully.

The production renderer harness checks early camera travel, the actual open
gem's X coordinate and geometry visibility before/through arrival. Use small
batches on memory-constrained machines, for example:

```text
node tests/browser/highway-stable-camera.cjs --case sustain-preparation --preparation-preset straight --preparation-style rsplus --preparation-rates 1 --out <fresh-output>
```

`--preparation-lefty` covers mirroring. `--preparation-chart <audit/rats-after.json>`
with `--case preparation-chart` renders the real reported passage. Select
existing dependencies with `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_EXECUTABLE_PATH`.
These tests start their own headless browser and never attach to the live game.

## Activation

Integrate the reviewed commits into their Songsterr source branches and build
FeedForge from that composition. Once restart is authorized, use the
existing combined runtime refresh, seal and check workflow, then launch normally.
The existing refresh tool requires a stopped runtime. No source-to-runtime
copying or hot reload is required or appropriate during an active session.

## Quiet-interval camera extension

Preparation now applies to ordinary single-note holds, overlapping holds,
partial chord releases, finishing directional slide-outs and silence. Each
position-changing attack can receive up to 1.2 real seconds of anticipation,
after at least 0.3 seconds of focus on the latest attack. An intervening attack
resets that focus interval. Bends, timed vibrato, slides with a destination fret
and other significant techniques on any string constrain the extra lead until
their effective sustain ends. Finishing slide-outs alone do not constrain it.
Normal 0.6-second behavior remains the minimum; geometry fitting still keeps
held notes and trails visible. No future destination means no extra movement.
This is Stable-camera timing only; music, lane geometry and transport are
unchanged. Silence before an open pickup uses that pickup's destination lane
as soon as the bounded preparation window opens.

Validation: 884 highway JavaScript tests pass, including 28 focused preparation
checks. Production-renderer cases exercise single and overlapping trails,
silence, directional slide-outs, real Rats/Cirice passages, mirrored/angled
views and 0.5/1/1.5 playback rates. The harness measures populated ribbon
vertices rather than unused pooled-buffer capacity when checking clipping.
Use `--case quiet-preparation` for synthetic cases, or `--case preparation-chart`
with `--preparation-attack`, `--preparation-opens` and `--preparation-fret` to
assert anticipation and open-lane alignment in a private audited chart.

## Rounded open-note onsets

Cirice at 291.04125 seconds exposed a separate renderer boundary bug. The game
serializes its ordinary note onset as 291.041 while retaining the generated
anchor at 291.04125. Exact chart-time lookup consequently placed the first open
in the preceding 1–4 lane, despite the generated pickup correctly using 12–15.

Open event geometry now uses the same half-millisecond onset tolerance already
used for chord onsets. A shared event lookup resolves the bar position/width,
trail layout and visibility footprints, and hit-wire feedback. The strict
chart-time lookup remains unchanged for continuous lane boundaries and authored
handshape times. Note onsets, sustains, scoring and serialized music are unchanged.

Regression coverage includes both rounding directions, the half-millisecond
edge, genuinely earlier notes, narrow/wide lanes, mirrored geometry and a real
Python arrangement load/serialize round trip into the JavaScript lane lookup.
The archive audit also exports `cirice-wire.json` and `rats-wire.json` for the
production renderer. Its open-alignment assertion compares the actual bar,
stem and both trails to an independently specified destination position/width.
The unchanged renderer fails that assertion on the reported Cirice passage;
the corrected renderer passes. Use the wire export, not only the unrounded
chart export, for end-to-end passage acceptance.

## Positionless playing

`positionless-preparation-v1` extends preparation to attacks that require no
particular fret: ordinary and palm-muted opens; open fret-hand mute, accents,
ghost dynamics, tapping, slap/pop and picking marks; plain dead strikes including
editor placeholder frets; open tremolo and whammy effects; and chords/runs mixing
these members. A positive fret with only palm or fret-hand mute remains fretted.
Tremolo on a plain dead strike does not give its hidden editor fret a position.

Slides, scrapes, harmonics/contact targets, bends, finger vibrato and explicit
linked/HOPO gestures retain context. Link protection checks both adjacent notes,
including a target without its own link flag and an open/dead source before an
explicit HOPO target. Effective same-string replacement and active other-string
holds keep their existing protections. The entire eligible run uses the next
fretted attack's lane; long intervening silence still breaks the run and no
destination means no new position. Musical events, technique marks and scoring
data are unchanged.

This is a placement rule. Tremolo, whammy and muted attacks keep the existing
camera activity/focus rules; they do not become silence or quiet holds.

The pure generator remains byte-identical in Core and FeedForge. Intact older
generated guidance, including `slide-follow-v1` with its timed-slide receipt,
upgrades in memory during loading. Authored/edited guidance and unknown/current
policies remain untouched. New imports and explicit regeneration record the new
policy; normal finalization does not silently regenerate an existing receipt.

Validation covers muted groups in Cirice at 186.7125 and 186.880625 seconds,
actual note/chord wire rounding, hidden dead frets, mixed groups, technique and
link boundaries, gap limits, other-string holds, old receipt/phrase migration,
independent active-fret coverage and camera technique focus.
