# Delayed artificial harmonic followed by a slide

A note can retain its one `harmonic_changes` v1 contact together with a pitched
`sl` destination and `slide_interval`. The package requires the
`harmonic_contact_slide` consumer capability. No new picked note is introduced.
The ordinary attack stays at its original fret; the artificial-harmonic contact
begins before the separately timed slide, keeping its explicit harmonic node.

The loader accepts this combination only for fretted origins and destinations
within 1–24, different origin and destination frets, an explicit interval wholly
within the sustain and strictly after the contact. Mixed bend, vibrato, tremolo,
whammy, HOPO, scrape and unpitched slide paths are excluded from this extension.
Existing stationary contacts and older packages keep their original behavior.
The converter separately verifies source ties, stable harmonic identity and the
destination; the game validates the resulting wire contract.

The 3D highway already positions the contact outline using the owning sustain's
slide trajectory. Its quiet harmonic rim follows the same ribbon, including
chord notes, different fret spacing, left-handed views and visibility narrowing.
The AH instruction at the contact onset continues to show the touch position
at that onset. It is not a second picked gem or an extra chord box.

The 2D contact sustain now follows that same cubic-sine slide progression, with
bounded boundary samples even for short slides. It does not leave a second
stationary sustain behind. The shared contact API also exposes the held fret
at a supplied elapsed chart time, and its label helper accepts that elapsed
time when a consumer needs the corresponding touch position. No wall-clock or
frame-history state is used, so seeking, looping and speed changes retain the
same result at the same chart time. The native and browser attack-scoring rule
is unchanged: a contact never creates a new attack opportunity.

Generated hand-position guidance already follows `sl` and `slide_interval`;
the contact does not change its left-hand fret requirements. The right-hand
touch instruction is not used as a fretting-hand lane position.

Tests cover note/chord wire transport, malformed and unsupported combinations,
old stationary contacts, chart-time seeking/speed, 2D motion and clipping, and
the existing 3D ribbon geometry under normal, mirrored and logarithmic views.
This display trajectory is the game's existing slide convention, not a claim
about an exact recorded performance's slide speed or harmonic acoustics.
