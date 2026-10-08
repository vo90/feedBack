const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeHarness, deferred } = require('./helpers/native-backing-harness');

test('a matching single-stem owner prepares silently and controls the actual native player', async () => {
    const h = nativeHarness(), lease = await h.acquire();
    assert.ok(lease); assert.equal(h.host.snapshot().ownerId, 'stems');
    assert.equal(h.host.snapshot().state, 'ready');
    assert.deepEqual(h.calls, [['stop'], ['gain', 0], ['load', '/local/full.ogg']]);
    assert.equal(await lease.seek(12), true); assert.equal(lease.currentTime, 12);
    assert.equal(await lease.setRate(.75), true); assert.equal(h.player._speed, .75);
    assert.equal(await lease.setGain(.4), true);
    assert.equal(await lease.play(), true); assert.equal(h.player._polling, true);
    assert.equal(await lease.pause(), true); assert.equal(h.player._polling, false);
    assert.equal(await h.acquire({ ownerId: 'another' }), null, 'cannot steal the active player');
});

test('unsupported host, stopped engine, unmatched/multistem and core-owned sources stay browser-owned', async () => {
    for (const setup of [h => h.setRunning(false), h => h.setCoreNative(true),
        h => h.setSong({}), h => { delete h.api.setBackingSpeed; }]) {
        const h = nativeHarness(); setup(h);
        assert.equal(await h.acquire(), null); assert.equal(h.calls.some(c => c[0] === 'load'), false);
        assert.equal(h.host.snapshot(), null);
    }
});

test('the Desktop API needs no pitch toggle; an optional host toggle is honored and rejected speed is surfaced', async () => {
    const h = nativeHarness();
    assert.equal(h.api.setBackingPreservePitch, undefined, 'match the actual Desktop preload surface');
    const lease = await h.acquire();
    assert.ok(lease);
    assert.equal(await lease.setRate(.8), true);
    h.api.setBackingPreservePitch = async value => h.calls.push(['pitch', value]);
    assert.equal(await lease.setRate(.7), true);
    assert.deepEqual(h.calls.at(-1), ['pitch', true]);
    h.api.setBackingSpeed = async () => false;
    await assert.rejects(lease.setRate(.5), /Native speed unavailable/);
    assert.equal(h.player._speed, .7);
});

test('codec rejection releases ownership without starting native playback', async () => {
    const h = nativeHarness(); h.api.loadBackingTrack = async () => false;
    assert.equal(await h.acquire(), null); assert.equal(h.host.snapshot(), null);
    assert.equal(h.calls.some(c => c[0] === 'play'), false);
});

test('a refreshed metadata object for the same song does not invalidate a live lease', async () => {
    const h = nativeHarness(), lease = await h.acquire();
    h.setSong({ singleStemUrl: h.url });
    assert.equal(await lease.play(), true); await h.host.check(); assert.equal(lease.isCurrent(), true);
});

test('release invalidates queued old commands and physically stops before the next core load', async () => {
    const h = nativeHarness(), lease = await h.acquire();
    h.calls.length = 0;
    const gate = deferred(); const waiting = h.queue(() => gate.promise);
    const oldGain = lease.setGain(.8), oldSeek = lease.seek(50), oldPlay = lease.play();
    const released = h.host.releaseCurrent();
    const replacement = h.queue(() => h.api.loadBackingTrack('/new.ogg'));
    gate.resolve(); await waiting;
    assert.deepEqual(await Promise.all([oldGain, oldSeek, oldPlay]), [false, false, false]);
    await Promise.all([released, replacement]);
    assert.deepEqual(h.calls, [['stop'], ['load', '/new.ogg']]);
    await lease.release(); assert.deepEqual(h.calls, [['stop'], ['load', '/new.ogg']]);
});

test('song change during asynchronous decoding cannot commit the old lease or stop a later load', async () => {
    const h = nativeHarness(), gate = deferred(), entered = deferred();
    h.api.loadBackingTrack = async path => { h.calls.push(['load', path]); entered.resolve(); await gate.promise; return true; };
    const pending = h.acquire(); await entered.promise;
    const release = h.host.releaseCurrent(); h.setCurrent(false);
    const next = h.queue(() => { h.calls.push(['new-owner-load']); });
    gate.resolve(); assert.equal(await pending, null); await Promise.all([release, next]);
    assert.deepEqual(h.calls.slice(-2), [['stop'], ['new-owner-load']]);
    assert.equal(h.host.snapshot(), null);
});

test('engine stop reports confirmed silence; stop failure while running forbids audible fallback', async () => {
    for (const stopped of [true, false]) {
        const h = nativeHarness(), lost = [];
        const lease = await h.acquire({ onLost: event => lost.push(event) });
        await lease.seek(17); h.api.stopBacking = async () => { throw Error('driver'); };
        h.setRunning(!stopped);
        if (stopped) await h.host.check(); else await lease.release('failed');
        assert.equal(lost.length, 1); assert.equal(lost[0].stopped, stopped); assert.equal(lost[0].position, 17);
        assert.equal(h.host.snapshot(), null);
    }
});

test('natural end notifies once per play and retired ownership cannot notify the new song', async () => {
    const h = nativeHarness(); let ends = 0;
    const lease = await h.acquire({ onEnded: () => ends++ });
    await lease.play(); h.player._sourceEnded = true;
    await h.host.check(); await h.host.check(); assert.equal(ends, 1);
    await lease.release(); await h.host.check(); assert.equal(ends, 1);
});

test('a core metadata takeover revokes plugin commands before loading and ignores its late cleanup', async () => {
    const h = nativeHarness(), lease = await h.acquire(); await lease.play(); h.calls.length = 0;
    assert.equal(await h.loadCore('/core.ogg'), true);
    assert.equal(h.host.snapshot(), null); assert.equal(await lease.setGain(0), false);
    await lease.release();
    assert.deepEqual(h.calls, [['stop'], ['load', '/core.ogg']]);
});
