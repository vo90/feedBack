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
