# Song import consumer compatibility

This isolated core change is based on `eef58c88c315b59375926bbfc8740cd18cb958f9`.
It does not require FeedForge to load game code, install a plugin, or edit a
running game's checkout. No library, runtime or optional plugin is modified.

## Arrangement identity

Manifest `type: lead`, `rhythm`, and `bass` are retained in the fast scanner
and determine smart role names even when display names identify the musicians.
Raw creator names remain intact. Generic `guitar` does not invent a lead role.
Explicit types supply role tuning and participate in both legacy and smart
library filters. Display sorting keeps the original manifest index.

Already indexed packs need a library rescan to acquire the new type and tuning
metadata. This branch does not automatically write or rescan a real library.

## Additive note fields

* `ghost: true`: a pitched, parenthesized note; independent of `mt`/`fhm`
  dead-note muting. Omitted when false.
* `slide_out: "up" | "down"`: a targetless slide gesture. Omitted when absent or
  invalid. It never becomes an invented `sl`/`slu` destination fret.

Both fields survive the game model, pack load and WebSocket wire, including
chord notes. The 2D highway displays parenthesized frets and a direction label.
The 3D highway displays the same semantics as a technique marker, resetting
reused chord-note scratch state so a following plain note cannot inherit them.
These are visual performance instructions; no amplitude grading is added.

The 2D viewport uses the actual visible note/chord range when no authored hand
anchors exist, including sustaining and slide-target notes. This is view logic,
not fabricated fretting-hand metadata. Authored anchors keep their existing path.

Bend pitch values and curves stay in semitones. Conventional 2D bend labels
are in whole tones: 1 semitone is `½`, 2 semitones is `full`.

## Older and separate consumers

Older game builds silently ignore the new gesture fields and may miss role
filters/tunings for custom names or crop high-fret charts with no anchors.
The FeedForge verification report must identify those capabilities rather than
claiming every installed player displays them. This change does not claim an
official FeedPak schema version bump or negotiate support with remote players.

The core notation transport already preserves unknown note fields. StaffView
is a separate plugin repository and its notation rendering is not changed here.
Third-party editors that reconstruct charts can discard unknown extensions;
retaining the external source/verification report remains necessary for repair.

## Verification

Focused Python fixtures exercise real pack loading, scanner metadata, SQLite
role filters, pitch-preserving note/chord round trips and default omission.
Node tests exercise the actual 2D draw path, no-anchor viewport functions,
3D marker text and scratch-state reset. No app or WebGL visual smoke test is
claimed by these headless tests.
