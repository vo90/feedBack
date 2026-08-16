const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./test_utils');

const APP_JS = path.join(__dirname, '..', '..', 'static', 'app.js');
const ADJUST_VOLUME = extractFunction(fs.readFileSync(APP_JS, 'utf8'), 'function _adjustSongVolume(');

function loadAdjustVolume(startVolume) {
    let volume = startVolume;
    const writes = [];
    const sandbox = {
        window: {
            feedBack: {
                audio: {
                    readSongVolume: () => volume,
                    getFaders: () => [{
                        id: 'song',
                        setValue(value) {
                            volume = value;
                            writes.push(value);
                        },
                    }],
                },
            },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(`${ADJUST_VOLUME}\nglobalThis.adjustSongVolume = _adjustSongVolume;`, sandbox);
    return { adjust: sandbox.adjustSongVolume, writes, read: () => volume };
}

test('held volume-up reaches 100 and repeated events at the limit are no-ops', () => {
    const control = loadAdjustVolume(0);

    for (let repeat = 0; repeat < 1000; repeat += 1) control.adjust(1);

    assert.equal(control.read(), 100);
    assert.equal(control.writes.length, 100, 'only the 100 audible changes reach the mixer');
    assert.deepEqual(control.writes, Array.from({ length: 100 }, (_, index) => index + 1));
});

test('held volume-down reaches zero and repeated events at the limit are no-ops', () => {
    const control = loadAdjustVolume(100);

    for (let repeat = 0; repeat < 1000; repeat += 1) control.adjust(-1);

    assert.equal(control.read(), 0);
    assert.equal(control.writes.length, 100, 'only the 100 audible changes reach the mixer');
    assert.deepEqual(control.writes, Array.from({ length: 100 }, (_, index) => 99 - index));
});
