'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hud = require('../../static/v3/live-performance-hud.js');

function element() {
    let text = '', writes = 0;
    const classes = new Set(['hidden', 'is-idle']), attrs = new Map();
    return {
        get writes() { return writes; },
        get textContent() { return text; },
        set textContent(value) { text = value; writes++; },
        classList: {
            contains: c => classes.has(c),
            add: c => { classes.add(c); writes++; },
            remove: c => { classes.delete(c); writes++; },
        },
        getAttribute: name => attrs.get(name) ?? null,
        setAttribute: (name, value) => { attrs.set(name, value); writes++; },
    };
}

test('unchanged score snapshots leave text, classes and accessibility attributes untouched', () => {
    const els = Object.fromEntries(['root', 'percent', 'hits', 'streak', 'state'].map(k => [k, element()]));
    const stats = hud.calculateLivePerformanceState({ hits: 20, misses: 0, streak: 20 });
    hud.renderHudDom(els, stats);
    const writes = Object.values(els).map(el => el.writes);
    for (let i = 0; i < 100; i++) hud.renderHudDom(els, stats);
    assert.deepEqual(Object.values(els).map(el => el.writes), writes);
    assert.equal(els.percent.textContent, '100%');
    assert.equal(els.state.getAttribute('aria-hidden'), 'false');
    assert.ok(els.root.classList.contains('hidden'), 'unrelated visibility class survives');
    assert.ok(els.root.classList.contains('is-fire'));
    hud.renderHudDom(els, hud.calculateLivePerformanceState({ hits: 20, misses: 1, streak: 0 }));
    assert.equal(els.percent.textContent, '95%');
    assert.equal(els.hits.textContent, 'Hits 20 / 21');
    assert.equal(els.streak.textContent, 'Streak 0');
    assert.ok(!els.root.classList.contains('is-fire'));
    assert.ok(els.root.classList.contains('is-strong'));
});

test('a new element or externally changed DOM is repaired without stale caches', () => {
    const stats = hud.calculateLivePerformanceState({ hits: 1 });
    const els = { percent: element(), state: element(), root: element() };
    hud.renderHudDom(els, stats);
    els.percent.textContent = 'stale';
    els.state.setAttribute('aria-hidden', 'true');
    els.root.classList.add('is-smoke');
    hud.renderHudDom(els, stats);
    assert.equal(els.percent.textContent, '100%');
    assert.equal(els.state.getAttribute('aria-hidden'), 'false');
    assert.ok(!els.root.classList.contains('is-smoke'));
    els.percent = element();
    hud.renderHudDom(els, stats);
    assert.equal(els.percent.textContent, '100%');
    hud.renderHudDom(els, hud.calculateLivePerformanceState());
    assert.equal(els.state.getAttribute('aria-hidden'), 'true');
    assert.equal(els.state.textContent, '');
});
