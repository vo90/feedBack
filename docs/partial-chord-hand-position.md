# Preserve hand positions for partial chords

## Problem

A two-note chord at D7/G7 lies inside its authored 7–10 position, but its
handshape references the parent D5 template A5/D7/G7. The evidence model accepts
the handshape after finding two matching strings, then includes every template
fret in the lane demand. Combining the unsupported A5 with 7–10 creates a
5–10 floor and chord box, including every fret-hand-muted repeat.

## Implementation plan

1. Add minimal regression fixtures for a partial chord whose parent template
   includes an unplayed outside fret. Check the accepted contextual handshape,
   supported fret demand, unchanged authored position and immutable input.
   Demonstrate failure on the current implementation before changing it.
2. Separate contextual handshape acceptance from lane-width evidence. Keep
   accepted shapes and their original templates, IDs, times and decisions.
   Derive each grip's positive fret bounds only from template strings with
   matching musical contacts in the supported interval. Reuse the existing
   checks for separate picks, incoming sustained contacts, slide arrivals,
   interrupted strings and excluded synthetic/dead-note evidence.
3. Keep the existing shared lane composition and cache. A containing authored
   position remains unchanged; genuinely supported outside contacts can still
   widen it. Floor, gold fret range and chord/muted-repeat frames continue to
   consume the same timeline in both camera modes.
4. Test unused low and high template members, partially matched open chords,
   fret-hand/palm mutes, separately picked full grips, sustained contacts,
   expired/interrupted evidence, slide arrivals, authored position changes,
   reverse seeks and difficulty replacement. Do not weaken existing geometry
   or musical-coverage assertions to accommodate a narrower box.
5. Run focused policy and actual renderer tests, the highway JavaScript suite,
   and isolated WebGL checks in Current and RS+ notation with both camera
   modes. Read the reported library chart without modifying it and verify
   that 367.325012–369.744995 stays at 7–10. Check rendered muted-repeat bounds
   and inspect screenshots. Record results and any remaining limitations here.

## Acceptance criteria

- D7/G7 inside 7–10 stays at 7–10 even when contextual D5 includes unused A5.
- An unused template member alone never widens the lane, regardless of whether
  the current notes are muted, open or pitched.
- A5 actually picked in the grip interval or carried into it can still provide
  evidence for the wider grip; genuinely sounding outside notes remain covered.
- Existing accepted context and source musical/annotation data are preserved.
- Both camera modes use identical policy; seeking and difficulty changes do
  not retain a previous wider position.

Implementation is confined to this Core branch. The installed runtime and
real song archives are not edited by these tests; runtime promotion is separate.

## Validation

Implemented by deriving positive grip frets from the existing matched-string
set instead of all template members. Contextual acceptance, evidence decisions,
real-note demands, lane composition and renderer caches are unchanged.

- Before the fix, nine new policy tests and eight new renderer/cache tests
  reproduced unsupported width expansion. Their genuine-contact positive
  controls passed. All 24 new JavaScript tests pass with the fix.
- All 1,961 highway JavaScript tests pass. This includes prior picked-grip,
  sustain, slide, open-string and position regressions, plus both camera modes,
  both fret-spacing modes, reverse seeks and equal-size difficulty replacement.
- Actual WebGL: the Current and RS+ suites each pass 101 scenarios and 129
  seek samples, with no browser errors. Eight new scenarios check partial
  chords, muted repeat meshes and genuinely sustained outside contacts in
  both camera modes and left-handed views. Baseline runs fail on the four
  unplayed-A5 scenarios while passing the four genuine-A5 controls. Frame
  widths/centres, shared floor bounds and mute-symbol widths are measured;
  before/after and positive-control screenshots were inspected.
- Read-only replay of seven complete library lead charts in four camera/fret-
  spacing combinations checks 9,580 chord onsets. Eighty frames narrow (the
  twenty reported attacks in each combination), none grow, and there are no
  played-chord coverage failures or frame/floor mismatches. Every attack and
  sampled gap in 367.325012–369.744995 changes from 5–10 to 7–10. Accepted
  handshapes, evidence decisions and real event demands are identical to the
  baseline. Input hashes and all seven archive SHA-256 hashes are unchanged.
- Production and browser-harness syntax checks, whitespace validation and
  an independent code review pass with no actionable findings.

The library replay is a bounded sample, not an exhaustive audit of every song.
Local verification artifacts are retained outside the repository, including
the replay script, results, archive hashes and WebGL screenshots. No song data
or installed runtime files were modified.
