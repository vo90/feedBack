# Instrument input profiles

## Behavior

- Guitar and Bass are built-in instruments with independent input levels. No
  setup or naming is required for a player with one instrument.
- Add instrument walks through Guitar/Bass, name, recommended input calibration,
  and review. Skip for now uses normal gain and marks the instrument not
  calibrated. Only Save instrument creates/selects the new profile. Cancel
  preserves the current selection and calibration.
- The header and Settings → Audio retain selection and management. The header
  shows a distinct guitar or bass icon, including for custom names. There is no
  instrument picker in the song Audio popover. Audio settings consolidation is
  deferred.
- Selection updates the game family, library perspective and tuner context,
  retaining the appropriate Guitar Lead/Rhythm or Bass role's string/tuning
  settings. Automatic song selection stays within the selected family and
  reports when no matching arrangement exists. Explicit arrangement requests
  retain their existing behavior.
- Instrument changes and gain edits are blocked from song loading through
  playback, pause and results. Leaving the player releases the lock. A song
  cannot start midway through a profile mutation.
- Gains belong to instrument + input backend/device/channel. A new setup starts
  at unity. Reconnecting an input invalidates an unfinished measurement even
  when its name has not changed. Hardware gain/volume changes require a new
  check; they cannot be detected automatically.

## Ownership and compatibility

Core owns `window.feedBack.guitarProfiles` (also exposed as `instrumentProfiles`)
through `/api/guitar-profiles`. The compatibility names and `guitar-profiles.json`
remain so existing tone plugins continue to share one gain owner. Schema v2 adds
instrument type, two protected defaults, remembered choices by family, and the
last Guitar role. Writes use revision checks, a process lock and atomic file
replacement. Corrupt storage is reported and preserved.

Schema v1 migrates once. Its default receives the existing game's Guitar/Bass
family and keeps its calibration. Other saved names and gains are preserved;
named instruments ask once for Guitar or Bass instead of guessing from names.
The other built-in default starts at unity. Old detector/Rig input gain migrates
once and waits for an actual route when input is unavailable. Limits are 32
profiles and 64 input setups per profile (a full v1 store may retain 33 profiles
when the additional built-in default is introduced).

The service serializes writes and synchronizes native gain and game family before
committing a selection. A synchronous session gate prevents song-start races.
Failed writes refetch durable state and reconcile gain/family to it. A failed
native apply is not recorded as successful calibration. Recovery failures remain
visible instead of reporting success.

`captureContext()` / `saveGain()` handle existing instruments.
`captureDraftContext(type)` / `verifyDraftContext()` bind unsaved measurements to
the current selection and input. Input setup may change before measurement; the
route is fixed once capture starts. NoteDetect's `measureInstrumentGain()` returns
a measurement or null on cancellation without saving a profile or applying draft
gain. `createInstrument()` saves identity and optional calibration together.

Desktop's dedicated calibration stage precedes detector/tuner taps and uses a
10 ms ramp; tone drive follows those taps. Raw hardware meters remain unscaled.
Rig and NAM share the profile calibration while retaining their own tone drive.
External hardware tone mode still receives calibrated detection without enabling
in-game effects. The complete NoteDetect tuning/timing wizard remains available.

## Validation

Automated coverage includes migration, both defaults, typed creation with Skip or
measurement, cancellation, persistence, independent routes/gains, classification,
delete/duplicate, stale contexts, native/disk failures, family synchronization and
rollback, input reconnects, session races, UI workflows/icons, and arrangement
routing. Tests cover both browser and native calibration paths. Existing Desktop
calibration/IPC coverage remains applicable because the native stage is unchanged.

The isolated candidate records the exact Core, Desktop, NoteDetect, Rig and NAM
revisions. It uses its own profile, logs and disposable library; the normal
Songsterr runtime is not overwritten.

## Hardware acceptance

1. Calibrate built-in Guitar or Bass without adding anything; restart and verify
   the selected default and gain return.
2. Add a named instrument with Skip; confirm normal gain. Then calibrate it from
   Settings → Audio, and add another through the recommended calibration flow.
3. Cancel the add flow and calibration at different stages. Confirm no partial
   instrument or changed saved gain remains.
4. Switch between quiet/hot guitars and bass with consistent hardware gain and
   instrument volume. Verify names, type icons, gain recall, detection and tone.
5. Open songs with both families and with only one. Confirm matching automatic
   arrangements, clear missing-family feedback, and no switching until leaving
   the player (including paused and results states).
6. Change input channel/device, verify the new setup needs calibration, then
   switch back and verify its previous gain. Try a reconnect during capture.
7. Switch Rig/NAM presets and external Helix tone mode. Confirm input calibration
   remains independent of tone drive. Correct already clipped signals at the
   hardware input before calibrating.

Physical playing and listening remain necessary to judge real instrument levels.