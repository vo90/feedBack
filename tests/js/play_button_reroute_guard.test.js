// Preserve the pre-existing reroute guard while exercising the real resume path.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./helpers/loop-transport-harness');

for (const reroute of [false, true]) {
    test(`rejected browser Play preserves the transport owned by a reroute: ${reroute}`, async () => {
        const h = build({ juce: false });
        const buttonStates = [];
        const button = {
            querySelector() { return {}; },
            setAttribute(name, value) { if (name === 'aria-pressed') buttonStates.push(value === 'true'); },
        };
        h.document.getElementById = id => id === 'btn-play' ? button : null;
        h.window._juceRerouteInProgress = reroute;
        h.io.play = () => { throw new Error('aborted by pause'); };
        await h.api.togglePlay();
        assert.equal(h.S.isPlaying, reroute);
        assert.deepEqual(buttonStates, reroute ? [true] : [true, false]);
    });
}
