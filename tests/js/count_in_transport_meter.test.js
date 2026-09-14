// The meter/pickup calculation must remain wired into the shared countdown
// after merging playback ownership. Exercise the actual transport and loops.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('./helpers/loop-transport-harness');

function songBeats(beatsPerBar, pickup = 0) {
    const beats = [];
    const bars = pickup ? [pickup, beatsPerBar, beatsPerBar, beatsPerBar] : [beatsPerBar, beatsPerBar, beatsPerBar];
    bars.forEach((length, measure) => {
        for (let index = 0; index < length; index++) {
            beats.push({ time: beats.length * 0.5, measure: index === 0 ? measure : -1 });
        }
    });
    return beats;
}

const meters = [
    { name: '3/4', beatsPerBar: 3, clicks: 3 },
    { name: '4/4 with a one-beat pickup', beatsPerBar: 4, pickup: 1, clicks: 3 },
    { name: '6/8', beatsPerBar: 6, clicks: 6 },
];

for (const juce of [false, true]) {
    for (const meter of meters) {
        for (const entry of ['song', 'initial-loop', 'repeat-loop']) {
            test(`${entry} counts ${meter.name} through the owned ${juce ? 'JUCE' : 'HTML5'} start`, async () => {
                const h = build({ juce });
                h.window.highway.getBeats = () => songBeats(meter.beatsPerBar, meter.pickup);
                const displayed = [];
                h.document.createElement = () => ({
                    remove() {},
                    set innerHTML(value) {
                        const number = value.match(/>(\d+)<\/span>/);
                        if (number) displayed.push(Number(number[1]));
                    },
                });
                if (entry === 'song') {
                    await h.api.startSongCountIn();
                } else {
                    await h.api.setLoop(0, 5);
                    if (entry === 'repeat-loop') {
                        await h.api.togglePlay();
                        h.calls.length = 0;
                        assert.equal(await h.api.handleLoopBoundary(5), true);
                    } else {
                        assert.equal(await h.api.startLoop(), true);
                    }
                }
                const start = h.api.getCountInStart();
                assert.ok(start);
                // 400ms rewind on repeats, 500ms lead-in, then one interval
                // after each displayed count before physical playback starts.
                const startsAt = (entry === 'repeat-loop' ? 400 : 0) + 500 + meter.clicks * 500;
                await h.advance(startsAt - 1);
                assert.equal(h.backing(), false);
                assert.deepEqual(displayed, Array.from({ length: meter.clicks }, (_, index) => index + 1));
                assert.equal(h.calls.includes('play'), false);
                await h.advance(1);
                assert.equal((await start.completion).completed, true);
                assert.equal(h.backing(), true);
                assert.equal(h.calls.filter(call => call === 'play').length, 1);
            });
        }
    }
}

test('canceling a six-beat count still releases ownership and prevents its later start', async () => {
    const h = build();
    h.window.highway.getBeats = () => songBeats(6);
    await h.api.setLoop(0, 5);
    await h.api.startLoop();
    const start = h.api.getCountInStart();
    await h.advance(2500);
    assert.equal(h.backing(), false);
    h.api.clearLoop();
    assert.equal((await start.completion).status, 'cancelled');
    await h.advance(2000);
    assert.equal(h.backing(), false);
    assert.equal(h.api.isCountingIn(), false);
});
