// Pins the renderOrder of fret-number labels and connector/drop lines in
// plugins/highway_3d/screen.js.
//
// The 3D highway uses depth-proportional renderOrder values so near entities
// paint over far entities while same-depth sublayers stay deterministic. Fret
// numbers must be labels, not gem peers: they render above the note symbols so
// incoming gems never partially cover the digits.
//
// Same-note ordering:
//   renderOrderForLayerAtZ(z, CHORD_FRAME)       chord frame edge
//   renderOrderForLayerAtZ(noteZ, CONNECTOR_LINE)      connector / drop line
//   renderOrderForLayerAtZ(noteZ, NOTE_OUTLINE)        gem outline
//   renderOrderForLayerAtZ(noteZ, NOTE_CORE)           gem core
//   renderOrderForLayerAtZ(noteZ, TECHNIQUE_MARKER)    technique marker
//   renderOrderForLayerAtZ(noteZ, NOTE_FRET_LABEL)     primary fret number
//   renderOrderForLayerAtZ(noteZ, ARP_NOTE_FRET_LABEL) arpeggio fret-number tie-breaker
//
// Source-level regex checks; no Three.js or DOM required.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCREEN_JS = path.join(__dirname, '..', '..', 'plugins', 'highway_3d', 'screen.js');

let _src;
/** Returns the cached 3D highway screen source under test. */
function src() {
    if (!_src) _src = fs.readFileSync(SCREEN_JS, 'utf8');
    return _src;
}

test('connector line uses the named connector layer', () => {
    assert.match(
        src(),
        /line\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*noteZ\s*,\s*_isArpNote\s*\?\s*'ARP_CONNECTOR_LINE'\s*:\s*'CONNECTOR_LINE'\s*\)\s*;/,
        'pConnectorLine renderOrder must use the connector layer names',
    );
});

test('primary fret label renders above gem core and technique markers', () => {
    assert.match(
        src(),
        /fretLabel\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*noteZ\s*,\s*_isArpNote\s*\?\s*'ARP_NOTE_FRET_LABEL'\s*:\s*'NOTE_FRET_LABEL'\s*\)\s*;/,
        'pNoteFretLabel renderOrder must use the fret-label layer names',
    );
});

test('synthetic chord fret label uses the same label layer as primary labels', () => {
    assert.match(
        src(),
        /fl2\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*noteZ\s*,\s*_isArp2\s*\?\s*'ARP_NOTE_FRET_LABEL'\s*:\s*'NOTE_FRET_LABEL'\s*\)\s*;/,
        'fl2 renderOrder must use the same fret-label layer names',
    );
});

test('drop line uses the named connector layer below gems', () => {
    assert.match(
        src(),
        /dl\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*noteZ\s*,\s*'CONNECTOR_LINE'\s*\)\s*;/,
        'pDropLine renderOrder must use CONNECTOR_LINE',
    );
});

test('chord-loop fret labels render above same-depth gem symbols', () => {
    assert.match(
        src(),
        /lbl\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*z\s*,\s*'CHORD_FRET_LABEL'\s*\)\s*;/,
        'chord-loop fret label must use CHORD_FRET_LABEL',
    );
});

test('chord frame and note outline use named depth-layer helper calls', () => {
    assert.match(src(), /const\s+chordFrameRenderOrder\s*=\s*renderOrderForLayerAtZ\(\s*z\s*,\s*'CHORD_FRAME'\s*\)\s*;/);
    assert.match(src(), /outline\.renderOrder\s*=\s*renderOrderForLayerAtZ\(\s*noteZ\s*,\s*noteOutlineLayer\s*\)\s*;/);
});

test('no fixed low renderOrder assignments remain for affected label paths', () => {
    const s = src();
    assert.doesNotMatch(s, /fretLabel\.renderOrder\s*=\s*(?:16|23)\s*;/);
    assert.doesNotMatch(s, /fl2\.renderOrder\s*=\s*(?:16|23)\s*;/);
    assert.doesNotMatch(s, /lbl\.renderOrder\s*=\s*21\s*;/);
    assert.doesNotMatch(s, /line\.renderOrder\s*=\s*_isArpNote\s*\?\s*22\s*:\s*15\s*;/);
    assert.doesNotMatch(s, /dl\.renderOrder\s*=\s*22\s*;/);
});
