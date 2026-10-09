// Read-only analysis adapter. It never creates an AudioContext or changes the
// playback route. Samples are a bounded native mono tap with output gains, not a graph
// node: recording/routing consumers must negotiate a separate capability.
export function createNativeBackingAnalyser(api, isActive, gain = () => 1, now = () => performance.now()) {
    if (typeof api?.getBackingAnalysis !== 'function') return null;
    let size = 256, lastRequest = -Infinity, received = -Infinity, busy = false;
    let samples = new Float32Array(2048), magnitudes = new Float64Array(size / 2), serial = 0, transformed = -1;
    let real = new Float64Array(size), imaginary = new Float64Array(size);
    const adapter = {
        nativeAnalysis: true, minDecibels: -100, maxDecibels: -30, smoothingTimeConstant: .8,
        get fftSize() { return size; },
        set fftSize(value) {
            if (!Number.isInteger(value) || value < 32 || value > 2048 || (value & (value - 1))) throw new RangeError('Native analysis FFT size must be a power of two from 32 to 2048');
            size = value; real = new Float64Array(size); imaginary = new Float64Array(size);
            magnitudes = new Float64Array(size / 2); transformed = -1;
        },
        get frequencyBinCount() { return size / 2; },
        // No AudioNode operations: disconnecting an observation has no effect
        // on playback, while connect explicitly rejects unsupported graph use.
        disconnect() {}, connect() { throw new TypeError('Native analysis is a read-only tap'); },
        getFloatTimeDomainData(target) {
            const live = refresh(), scale = live ? gain() : 0;
            for (let i = 0; i < target.length; i++) target[i] = i < size ? samples[samples.length - size + i] * scale : 0;
        },
        getByteTimeDomainData(target) {
            const live = refresh(), scale = live ? gain() : 0;
            for (let i = 0; i < target.length; i++) target[i] = Math.max(0, Math.min(255, Math.floor(128 * (1 + (i < size ? samples[samples.length - size + i] * scale : 0)))));
        },
        getFloatFrequencyData(target) { frequency(target, false); },
        getByteFrequencyData(target) { frequency(target, true); },
    };
    function refresh() {
        if (!isActive()) { received = -Infinity; magnitudes.fill(0); return false; }
        const time = now();
        if (!busy && time - lastRequest >= 1000 / 30) {
            busy = true; lastRequest = time;
            Promise.resolve().then(() => api.getBackingAnalysis()).then(value => {
                if (isActive() && value?.length === 2048 && Array.from(value).every(Number.isFinite)) {
                    samples.set(value); received = now(); serial++;
                }
            }).catch(() => {}).finally(() => { busy = false; });
        }
        return time - received < 250;
    }
    function frequency(target, bytes) {
        const live = refresh();
        if (live && transformed !== serial) {
            transformed = serial;
            for (let i = 0; i < size; i++) {
                const phase = 2 * Math.PI * i / size;
                real[i] = samples[samples.length - size + i] * (.42 - .5 * Math.cos(phase) + .08 * Math.cos(2 * phase));
                imaginary[i] = 0;
            }
            for (let i = 1, j = 0; i < size; i++) {
                let bit = size >> 1;
                for (; j & bit; bit >>= 1) j ^= bit;
                j ^= bit;
                if (i < j) { const temp = real[i]; real[i] = real[j]; real[j] = temp; }
            }
            for (let length = 2; length <= size; length *= 2) {
                for (let start = 0; start < size; start += length) {
                    for (let j = 0; j < length / 2; j++) {
                        const angle = -2 * Math.PI * j / length, a = start + j, b = a + length / 2;
                        const tr = real[b] * Math.cos(angle) - imaginary[b] * Math.sin(angle);
                        const ti = real[b] * Math.sin(angle) + imaginary[b] * Math.cos(angle);
                        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
                        real[a] += tr; imaginary[a] += ti;
                    }
                }
            }
            const smooth = Math.max(0, Math.min(1, adapter.smoothingTimeConstant));
            for (let i = 0; i < magnitudes.length; i++) magnitudes[i] = smooth * magnitudes[i] + (1 - smooth) * Math.hypot(real[i], imaginary[i]) / size;
        }
        for (let i = 0; i < target.length; i++) {
            const db = live && i < magnitudes.length ? 20 * Math.log10(magnitudes[i] * gain()) : -Infinity;
            target[i] = bytes ? Math.max(0, Math.min(255, 255 * (db - adapter.minDecibels) / (adapter.maxDecibels - adapter.minDecibels))) : db;
        }
    }
    return adapter;
}
