// Physical-instrument changes and song loading share this synchronous gate.
// A paused/ended song still owns its instrument until the player is torn down.
export function createInstrumentSession() {
    let locked = false, generation = 0, mutations = 0;
    const listeners = new Set();
    const emit = () => {
        for (const listener of listeners) {
            try { listener(locked); } catch (_) { /* Keep the gate independent of UI errors. */ }
        }
    };
    const assertUnlocked = () => {
        if (locked) throw new Error('Leave the current song before changing instruments.');
    };
    return {
        isLocked: () => locked,
        assertUnlocked,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        acquireMutation() {
            assertUnlocked();
            ++mutations;
            let released = false;
            return () => {
                if (!released) { released = true; --mutations; }
            };
        },
        beginSong() {
            if (mutations) throw new Error('Finish saving or calibrating your instrument before opening a song.');
            locked = true;
            ++generation;
            emit();
            return generation;
        },
        endSong(token) {
            if (token !== generation || !locked) return;
            locked = false;
            emit();
        },
    };
}

const host = window.feedBack = window.feedBack || {};
export const instrumentSession = host.instrumentSession || (host.instrumentSession = createInstrumentSession());
window.dispatchEvent(new CustomEvent('feedback:instrument-session-ready'));
