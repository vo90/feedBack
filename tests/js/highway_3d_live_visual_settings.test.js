const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8');
function listenerHarness() {
    const start = src.indexOf('_bgListener = (changedKey) => {');
    const end = src.indexOf('_bgSubscribe(_bgListener)', start);
    assert.ok(start >= 0 && end > start);
    return new Function(`
        let loads = 0, rebuilds = 0, _bgListener;
        const _bgLoadSettings = () => loads++;
        const _bgRebuild = () => rebuilds++;
        const _applyVibrancy = () => {}, _applyGlow = () => {};
        const _applyBgTheme = () => {};
        ${src.slice(start, end)}
        return { emit(key) { _bgListener(key); return { loads, rebuilds }; } };
    `)();
}

for (const key of ['notationStyle', 'chordBoxTop', 'hitFx', 'sparks', 'cinematic', 'verdictMarks', 'timingFx',
    'streakFx', 'bloom', 'fpsVisible', 'fretDividersVisible', 'chordDiagramVisible']) {
    test(`${key} immediately refreshes live state without rebuilding the background`, () => {
        const h = listenerHarness();
        assert.deepEqual(h.emit(key), { loads: 1, rebuilds: 0 });
        assert.deepEqual(h.emit(key), { loads: 2, rebuilds: 0 }, 'both toggle directions refresh');
    });
}

test('existing live camera settings and unknown keys retain their behavior', () => {
    const h = listenerHarness();
    assert.deepEqual(h.emit('cameraSmoothing'), { loads: 1, rebuilds: 0 });
    assert.deepEqual(h.emit('notASetting'), { loads: 1, rebuilds: 0 });
});

test('settings refresh applies cinematic lighting as well as flags', () => {
    const start = src.indexOf('function _bgLoadSettings(');
    const end = src.indexOf('\n        function ', start + 1);
    assert.match(src.slice(start, end), /_cinematic\s*=\s*_bgReadSetting\(panelKey, 'cinematic'\)/);
    assert.match(src.slice(start, end), /_applyCinematic\(\)/);
});
