# Guitar input profiles

## Plan and behavior

1. Keep a permanent `default` profile. A new user sees **Default guitar** and can
   calibrate immediately without naming or adding an instrument. It can be
   renamed, but cannot be deleted. Deleting the selected named guitar returns
   selection to Default.
2. Offer the same selection in the header instrument menu and player Audio
   popover. Settings → Audio exposes management and manual gain. Selecting a
   guitar during playback pauses the song before switching.
3. Store physical guitar identity separately from the existing lead/rhythm/bass
   instrument-role settings. Changing guitar does not change tuning or timing.
4. Store input gain per guitar and input backend/device/channel. Unknown setups
   start at unity with **Check level**. The same setup recalls its saved gain.
   Input hardware generation is part of the in-flight calibration context, so
   even a same-named reconnect invalidates an unfinished measurement.
5. Migrate the old detector engine gain, or legacy Rig calibration when no
   detector engine calibration exists, to Default once. Browser setups prefer
   their old analysis gain. If no input is open, retain migration until the first
   actual input is available. Do not multiply the old trim a second time.
6. Share a short noise → strong playing → preview/save wizard with note_detect.
   The complete input/tuning/timing wizard remains available. Both paths and
   manual gain edits write through one profile owner.
7. Give the native engine a dedicated calibration stage, independent of tone
   drive. Calibration precedes detector/tuner taps; preset drive follows them.
   Apply gain changes with a 10 ms ramp. External hardware mode still uses the
   calibration stage for detection, without enabling in-game effects.

## Ownership and storage

Core owns `window.feedBack.guitarProfiles` and `/api/guitar-profiles`. The store
is `guitar-profiles.json` in the existing isolated application config directory.
Mutations use a revision check, process lock and atomic file replacement. A
damaged store is reported and preserved rather than silently reset. There is a
limit of 32 guitars and 64 input setups per guitar.

The browser service serializes operations and exposes readiness, snapshots,
subscriptions, profile management, `captureContext()` and
`saveGain(gain, context, metadata)`. A context binds the guitar, input route and
revision. Switching, reconnecting or editing gain invalidates older contexts.
Failed native application is not saved as a successful calibration; a failed
save attempts to restore the previous gain.

Desktop provides `setInputCalibrationGain` and `getInputCalibrationGain` for the
primary input source. Existing preset input gain keeps its legacy behavior until
this new setter activates profile mode. Raw hardware channel measurements remain
unscaled. Rig's Input control delegates to Core in profile mode; its amp drive is
kept separate. NAM presets retain their tone gain, with a distinct browser
calibration node only when its capture route matches the profile's route.

This first version supports switching one player's physical guitars. It does
not imply separate calibration for simultaneous multiplayer sources. Hardware
gain knob changes cannot be detected automatically. Pickup/volume changes may
require a check or a separate named profile.

## Automated checks

- Python store/API tests: Default, migration, independent guitars and routes,
  restart persistence, copy/delete, invalid input, stale/concurrent writes,
  corrupt storage and disk failure.
- Core JavaScript tests: application/recall, startup migration, reconnection,
  stale calibration, engine failure and save rollback, avoiding repeated gain
  writes during unchanged-route polling.
- Real browser UI tests: Default calibration entry, settings/player selection
  synchronization, playback pause, gain recall, rename/delete and safe text
  rendering of names.
- note_detect integration tests: short and full wizard, initial input setup,
  cancellation, profile/route/revision changes, browser versus native gain,
  clipping/headroom, and old-host compatibility.
- Desktop native pipeline tests: dry capture independent of preset drive,
  ramp/stereo consistency, input-only capture, device reopen, raw meters and
  external monitoring behavior; IPC validation and TypeScript checks.
- Rig/NAM tests: independent tone drive, profile edits, external mode,
  browser route matching and migration settings.

The coordinated Core, Desktop, note_detect, Rig and NAM revisions must be used
together for acceptance. The isolated candidate runtime records their exact
commits; the normal Songsterr runtime is not overwritten.

## Manual guitar acceptance

1. With one guitar, leave **Default guitar** selected. Run Calibrate, mute strings
   for noise capture, then play several strong normal notes/strums. Save and
   verify both detection and the desired internal or external monitoring path.
2. Restart the candidate and verify Default and its saved gain return without
   creating a guitar.
3. Add a second guitar, calibrate it, then switch between the two several times.
   Confirm their names/gains recall, with no repeated calibration prompts.
4. Load different Rig/NAM tones and verify the selected guitar gain is unchanged.
   With external Helix tone enabled, confirm detection still uses the selected
   guitar and no in-game tone is unexpectedly enabled.
5. Try a quiet guitar and a hot guitar. Verify headroom and the maximum-boost
   message when applicable. Already clipped input must be corrected at hardware.
6. Change input channel/device. Confirm **Check level** for a new setup; switching
   back should restore its saved level. Keep physical gain/volume settings fixed
   while comparing.
7. Cancel calibration and verify saved gain stays unchanged. Switch guitar/input
   during a measurement and confirm that the old measurement cannot be saved.

Use the candidate's disposable settings and song library for acceptance. A real
guitar/listening test remains necessary; automated signals cannot establish the
best subjective gain or pickup setup for a particular instrument.
