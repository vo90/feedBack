# Preparing the next passage

Open-string pickups previously inherited the preceding generated hand position.
In Rats at 205.72s, the open low string stayed at frets 5–8 even though the next
pick at 205.96625s needed fret 2. The stable camera also used the same 0.6-second
lead for a busy passage and a plain held chord.

## Implementation

1. Resolve generated hand positions normally, then let a connected plain open
   pickup adopt the next four-fret position at its own onset. The destination
   must be within 0.75 song seconds of the beginning of the open run. A gap over
   1ms between written durations breaks the run. A sounding fretted note, mixed
   chord, technique, wide destination, or distant ending retains its context.
   Note onset, sustain and scoring data never change.
2. Share the identical pure generator with FeedForge. New imports carry
   `open-preparation-v1`; recognize the original unversioned position policy
   and `chord-local-v1` for upgrades. The game checks original music and guidance
   hashes before generating positions in memory. Authored/edited guidance,
   unknown policies and current imports retain their saved positions. Explicit
   FeedForge regeneration upgrades recognized older guidance, including phrase
   windows; ordinary finalization preserves existing receipts.
3. Annotate the stable camera's cached stops with individual lead times. A plain
   chord held until the next position-changing attack can prepare up to 1.2
   real seconds early, after at least 0.3 seconds of initial chord focus. Every
   intervening attack counts, including unpitched muted strikes. Slides, bends,
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

Developed from Core 1885775 and paired with the FeedForge open-preparation
feature. The running game and packaged FeedForge were intentionally left intact.
Integrate the two reviewed commits into their Songsterr source branches and
build FeedForge from that composition. After the user finishes playing, use the
existing combined runtime refresh, seal and check workflow, then launch normally.
The existing refresh tool requires a stopped runtime. No source-to-runtime
copying or hot reload is required or appropriate during an active session.
