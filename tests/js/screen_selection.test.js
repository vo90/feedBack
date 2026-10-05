const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./test_utils');
const { build } = require('./helpers/loop-transport-harness');
const session = fs.readFileSync(path.join(__dirname, '../../static/js/session.js'), 'utf8');

test('showScreen prepares outgoing screens and completes visibility before screen:changed', async () => {
    const events = [];
    const screens = Object.fromEntries(['settings','player'].map(id => [id, {id, classList: {
        remove() { events.push('hide:' + id); }, add() { events.push('show:' + id); },
    }}]));
    const context = vm.createContext({
        selectionLifecycle: () => ({
            prepareToHide(root) { events.push('prepare:' + root.id); },
            finishVisibilityChange() { events.push('finish'); },
        }),
        document: {
            querySelector: () => screens.settings,
            querySelectorAll: () => Object.values(screens),
            getElementById: id => screens[id],
        },
        _bumpLibNavGeneration() {},
        window: { scrollTo() {}, feedBack: { emit(name) { events.push(name); } } },
    });
    vm.runInContext(extractFunction(session, 'async function showScreen('), context);
    await context.showScreen('player');
    assert.deepEqual(events, ['screen:changing','prepare:settings','hide:settings','hide:player','show:player','finish','screen:changed']);
});

for (const juce of [false, true]) test('selection is reconciled before physical start: ' + (juce ? 'native' : 'HTML'), async () => {
    const h = build({juce});
    h.io.play = () => assert.ok(h.selectionChecks.length > 0, 'cleanup precedes audio start');
    await h.api.resumePlayback();
    assert.ok(h.backing());
    const checks = h.selectionChecks.length;
    await h.advance(10000);
    assert.equal(h.selectionChecks.length, checks, 'no cleanup on transport ticks');
});

test('native queue reconciles again after waiting for earlier commands', async () => {
    const h = build();
    let finish;
    h.io.pause = () => new Promise(r => { finish = r; });
    const pausing = h.api.jucePlayer.pause();
    await h.flush();
    const playing = h.api.jucePlayer.play();
    await h.flush();
    assert.equal(h.selectionChecks.length, 0);
    finish();
    await pausing;
    await playing;
    assert.equal(h.selectionChecks.length, 1, 'check runs at actual native command, after the queue wait');
});
