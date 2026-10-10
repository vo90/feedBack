// Real MutationObserver coverage; isolated page, no app/server/profile/library.
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname,'../../static/v3/player-chrome.js'),'utf8');
const {extractFunction} = require('../js/test_utils');
// Frozen idle function from d5807829889e865673fb0a0dbe5c751a36fe228c.
const baselineIdle = `function tickIdle() {
        const p = player();
        if (!p) return;
        const playBtn = $('btn-play');
        const playing = playBtn && playBtn.getAttribute('aria-pressed') === 'true';
        // overControls maintained by mouseenter/mouseleave (see start()) —
        // matches(':hover') here forced a per-frame style recalc.
        // Keep the transport up while paused, hovering it, or a popover is open.
        if (openPop || overControls || !playing) { lastMove = now(); return; }
        if (now() - lastMove > IDLE_MS) {
            p.classList.remove('chrome-active');
            p.classList.add('chrome-idle');
        }
    }`;
const baseline = source.replace(extractFunction(source,'function tickIdle('),baselineIdle);

test('idle rAF drops repeated class mutations while wake, repair and lifecycle match baseline', async () => {
    const browser = await chromium.launch({headless:true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
            ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
    try {
        const results = [];
        for (const input of [baseline,source]) {
            const page = await browser.newPage();
            try {
                await page.setContent(`<section id="player" class="screen active unrelated">
                    <div id="player-controls"><button id="btn-play" aria-pressed="true" data-v3-native></button></div>
                    <nav id="v3-player-rail"><button id="tool" data-rail="viz"></button></nav>
                    <div id="v3-rail-pop-viz" class="hidden"></div></section>`);
                results.push(await page.evaluate(async input => {
                    let clock = 0, serial = 0, records = 0, callbacks = 0;
                    const pending = new Map(), snapshots = [];
                    Object.defineProperty(performance,'now',{value:()=>clock});
                    window.requestAnimationFrame = fn => { pending.set(++serial,fn); return serial; };
                    window.cancelAnimationFrame = id => pending.delete(id);
                    const player = document.getElementById('player'), button = document.getElementById('btn-play');
                    const observer = new MutationObserver(list => { records += list.length; callbacks++; });
                    observer.observe(player,{attributes:true,attributeFilter:['class']});
                    const drain = async () => { for(let i=0;i<5;i++)await Promise.resolve(); };
                    const snapshot = label => snapshots.push({label,className:player.className,queuedFrames:pending.size,
                        pop:document.getElementById('v3-rail-pop-viz').className,
                        expanded:document.getElementById('tool').getAttribute('aria-expanded')});
                    const frame = async ms => {
                        clock += ms;
                        const work = Array.from(pending.values()); pending.clear();
                        for(const fn of work)fn(clock);
                        await drain();
                    };
                    (0,eval)(input); await drain(); snapshot('start');
                    await frame(2500); snapshot('exact idle boundary');
                    records = callbacks = 0;
                    await frame(1); snapshot('first idle transition');
                    const transitionRecords = records;
                    records = callbacks = 0;
                    for(let i=0;i<100;i++)await frame(10);
                    const settled = {records,callbacks}; snapshot('100 settled frames');
                    // Repair externally changed tokens, rather than relying on a stale boolean cache.
                    player.classList.remove('chrome-idle'); player.classList.add('chrome-active');
                    await drain(); records = callbacks = 0;
                    await frame(10); snapshot('external token repair');
                    const repairRecords = records;
                    player.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));
                    await drain(); snapshot('mouse wake');
                    button.setAttribute('aria-pressed','false'); await frame(5000); snapshot('paused');
                    button.setAttribute('aria-pressed','true'); await frame(2500); snapshot('resume boundary');
                    await frame(1); snapshot('resume idle');
                    player.dispatchEvent(new Event('touchstart',{bubbles:true}));
                    await drain(); snapshot('touch wake');
                    document.getElementById('tool').click(); await drain();
                    await frame(5000); snapshot('popover holds chrome');
                    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); await drain();
                    await frame(2501); snapshot('popover closes then idle');
                    player.classList.remove('active'); await drain(); snapshot('screen stop');
                    await frame(5000); snapshot('stopped clock advance');
                    player.classList.add('active'); await drain(); snapshot('screen reentry');
                    await frame(2501); snapshot('reentry idle');
                    observer.disconnect();
                    return {snapshots,transitionRecords,repairRecords,settled};
                },input));
            } finally { await page.close(); }
        }
        const [old,next] = results;
        assert.deepEqual(next.snapshots,old.snapshots,'full production chrome lifecycle matches the scalar baseline');
        assert.equal(old.settled.records,200,'real Chromium reports both no-op class writes every idle frame');
        assert.equal(old.settled.callbacks,100);
        assert.deepEqual(next.settled,{records:0,callbacks:0});
        assert.equal(next.transitionRecords,2,'real transition remains observable');
        assert.equal(next.repairRecords,2,'external class changes are repaired on the next frame');
        const state = label => next.snapshots.find(s=>s.label===label);
        assert.match(state('exact idle boundary').className,/chrome-active/);
        assert.match(state('first idle transition').className,/chrome-idle/);
        assert.match(state('paused').className,/chrome-active/);
        assert.match(state('popover holds chrome').className,/chrome-active/);
        assert.equal(state('screen stop').queuedFrames,0);
        assert.doesNotMatch(state('screen stop').className,/chrome-(active|idle)/);
        assert.equal(state('screen reentry').queuedFrames,1,'observer starts exactly one loop');
        assert.match(state('screen reentry').className,/chrome-active/);
    } finally { await browser.close(); }
});
