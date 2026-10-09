// A single backing file can use the native transport on every output backend.
// Packs with listed stems keep their browser mixer; decoder rejection is handled by
// the caller, which can retain browser playback without changing the device.
export function shouldUseNativeBacking(songAudio, engineRunning) {
    return !!(engineRunning && (songAudio?.juceEligible || songAudio?.feedpakFullMix));
}
