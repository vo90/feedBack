# Guidance ownership v1

Status: isolated implementation; no library migration or runtime deployment.

The additive `ext.guidanceProvenance` extension belongs to each arrangement or
phrase level. Ownership is independent for `anchors`, `handshapes`, `chords`
and `templates`. Its envelope is `{version: 1, fields: {<field>: <record>}}`.
Unknown extensions and future versions must survive saves. An unsupported
version cannot authorize generation or authored-lane rendering.

Each record has `origin` (`source`, `user`, `generated`, `unknown`, or `mixed`),
`producer`, and `sha256` of that field. Generated records add `policy` and
`inputSha256`, covering the present tuning/capo/centOffset/notes/chords/templates
keys. Lane input hashes also cover beats, which drive open-string preparation.
`intentionalEmpty: true` explicitly protects an empty collection. Ordinary
legacy empty arrays retain the existing missing-guidance interpretation.

Hashing uses sorted, compact UTF-8 JSON, rejects non-finite values, and treats
integral floats and integers identically. It does not round time. Digests detect
content changes; they do not authenticate authorship. Origin and applicability
are separate: a note edit can stale generated guidance without changing origin.

Uniform collections use one record. Mixed collections also carry a `rows` array
with origin and digest per row; the collection digest binds ordering. No row can
inherit another row's authority after sorting, deletion or insertion. Edits match
unchanged rows by content; ambiguous matches retain unknown ownership. A known
copy/clip operation may record `parentSha256`. No general editing history is stored.

## Producers and saves

- Archive conversion declares the supplied chart guidance at each difficulty.
- Songsterr import declares inferred chord grouping separately from positions
  and handshapes. Generation never changes the imported musical instructions.
- Practice generation regenerates generated fields and preserves supplied
  fields independently. Generated handshapes do not authorize replacing lanes.
- Hybrid composition preserves intact ownership before explicitly regenerating
  eligible positions against the final selection.
- Editor saves compare the current chart to its original display projection.
  Unchanged fields/rows retain the raw precision and original metadata. A lane
  edit owns only changed rows. Explicit auto-position fallback is generated.
  An unchanged save preserves difficulty ladders and unknown extensions.
- The shared stdlib implementation is `lib/guidance_provenance.py` in Core,
  `src/feedback_converter/guidance_provenance.py` in FeedForge, and
  `guidance_provenance.py` in Editor. Keep these copies byte-identical.

## Playback and compatibility

Core validates raw JSON before numeric normalization. Only compact resolved
`guidanceOrigin` travels with playback anchors, including difficulty anchors.
It is not a persistent ownership receipt. Loading/saving new versioned charts
does not regenerate them. The existing restricted legacy in-memory position
compatibility path remains unchanged for historical receipts only.

Recognized legacy `chartGuidance` receipts own only their listed fields. A
handshape-only receipt cannot classify anchors. Failed, unsupported or missing
evidence retains compatible rendering; it never becomes proof of authorship.
Old converted packs with lost ownership need source verification before opting
into authored-lane alignment. There is no whole-library migration in this change.

The 3D renderer resolves authored bounds once for each effective chart. Frames,
repeat boxes, open members, holds and hit edges use the same anchor geometry;
invalid authored spans expand safely without rewriting the chart. Generated and
unknown spans retain their existing shape-local rule. Holds keep onset geometry.
Transforms may retain exact rows; replaced/retimed rows without supported lineage
lose authority conservatively. Difficulty/array replacement and streaming growth
invalidate cached geometry; frames and seeks never hash or generate guidance.

The Back In Black mismatched A5/G5 handshape is a separate data-reference defect.
This contract cannot invent its sustain or silently repair the original pack.

## Validation and rollout

Exercise no-op save/reload, source/generated/mixed fields, selected difficulty,
stale inputs, future versions, intentional empties, edited rows and generation
boundaries. Compare actual WebGL frames in both notation styles, both cameras
and handedness, including holds and repeat boxes. Benchmark loading and dense
rendering against the integration baseline. Use disposable libraries only.

Older readers ignore this optional extension. Older writers may discard it, so
unknown ownership must always remain safe. Integrate compatible producers and
consumers together after review; never deploy the earlier source-format switch.
Code rollback does not require rewriting song files. Publishing, runtime
integration and actual-library corrections require separate authorization.
