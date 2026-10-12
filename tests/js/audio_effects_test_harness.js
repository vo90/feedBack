const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createWindow, ROOT } = require('./capabilities_test_harness');

const CAPABILITIES_JS = path.join(ROOT, 'static', 'capabilities.js');
const AUDIO_EFFECTS_JS = path.join(ROOT, 'static', 'capabilities', 'audio-effects.js');

function loadAudioEffects(options = {}) {
    const window = createWindow(options);
    const context = vm.createContext(window);
    vm.runInContext(fs.readFileSync(CAPABILITIES_JS, 'utf8'), context, { filename: CAPABILITIES_JS });
    // Existing effects fixtures model an opted-in user. Dedicated policy tests
    // override/remove this state to exercise desktop startup/off transitions.
    window.feedBack.ampSims = options.ampSims || {
        snapshot: () => ({ ready: true, enabled: true, generation: 1, applicable: true, error: null }),
        subscribe: () => () => {},
    };
    vm.runInContext(fs.readFileSync(AUDIO_EFFECTS_JS, 'utf8'), context, { filename: AUDIO_EFFECTS_JS });
    window.__vmContext = context;
    return window;
}

function diagnosticsSnapshot(window) {
    return window.feedBack.audioEffects.snapshot();
}

module.exports = { loadAudioEffects, diagnosticsSnapshot, ROOT };
