# Imported arrangements: library and 2D display compatibility

This change retains the library, 2D display and arrangement-type transport
fixes from the original Songsterr compatibility work. Ghost-note and
direction-only slide rendering are maintained separately.

- A FeedPak part named after its player (for example, `Rain`, with type `bass`)
  keeps its source name while the scanner records the explicit role. Smart
  naming and role filters can identify it, and bass/rhythm tuning summaries
  use the appropriate part. XML path flags retain their existing precedence;
  legacy parts without an explicit role still use their names.
- Sorting the library's arrangement metadata preserves original manifest
  indices. Choosing a sorted entry therefore opens the matching loaded part.
- An anchorless 2D chart frames its visible notes, sustained notes, chord
  members/templates and known slide destinations. It reads the active
  difficulty/transform views and expands immediately when a high fret enters
  the window. Existing authored-anchor behavior is unchanged. The imported
  mute sentinel `127` is not a fret for this calculation.
- 2D bend labels convert semitones into conventional whole-tone labels:
  one semitone is `½`, two is `full`. Stored pitches, bend curves and scoring
  are unchanged.
- The `song_info` message includes active `arrangement_type` and each
  arrangement option includes `type`, so consumers can distinguish a part's
  role from its display name. This transport change does not itself switch
  the player's screen.

Already indexed songs need a metadata rescan to acquire the newly recorded
roles and corrected indices. This change does not rewrite the source packs.

## Verification

`test_song_import_library_display.py` exercises actual FeedPak loading,
metadata extraction, scanner enrichment and SQLite filters. The highway
WebSocket test checks arrangement type on the emitted `song_info` message.
`song_import_library_display.test.js` exercises the real 2D note drawing and
viewport functions, alongside pure geometry checks. Adjacent song,
WebSocket, library filter/tuning and chart-transform suites are also run.
