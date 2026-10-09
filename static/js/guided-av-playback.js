// A running device flag does not prove the output is consuming audio (for
// example after an HDMI endpoint sleeps). Require fresh rendered progress.
export function calibrationOutputAdvancing(s) {
    return !!(s?.valid && s.ageMs < 150 && s.position > .001
        && s.presentation?.version === 2 && s.presentation.playing
        && s.presentation.ageMs < 150);
}

export async function startCalibrationPlayback({api, lease, volume, active,
    onLease, recover, status, wait = ms => new Promise(r => setTimeout(r, ms))}) {
    const original = lease.profile;
    const sameSetup = p => p?.output?.persistent
        && p.output.key === original.output.key && p.output.routeKey === original.output.routeKey
        && p.input?.key === original.input?.key && p.perOutputSetup === original.perOutputSetup;
    async function started() {
        await api.playCalibrationTrial(lease.token, volume);
        // Bounded wait; no main-thread sleeping and no guess from isAudioRunning.
        for (let i = 0; i < 25 && active(); i++) {
            const s = await api.pollCalibration(lease.token);
            if (!s) throw new Error('The output changed. Close calibration and start again.');
            if (s.failed) throw new Error('The calibration audio could not be read. Close the guide and try again.');
            if (calibrationOutputAdvancing(s)) return true;
            await wait(40);
        }
        return false;
    }
    if (await started()) return active();
    if (!active()) return false;
    if (!recover() || !await api.isAudioRunning() || !sameSetup(await api.getCalibration()))
        throw new Error('The selected output is not playing audio. Close calibration and apply your audio settings again.');
    const d = await api.getCurrentDevice();
    if (!d?.input || !d.output || !Number.isFinite(d.sampleRate) || !Number.isFinite(d.inputBlockSize))
        throw new Error('The selected audio setup is unavailable. Close calibration and select your devices again.');
    status('Reconnecting your selected audio setup…');
    // Release the temporary source before reconfiguration. Keep the same
    // explicit endpoints and format, and never adopt a different setup's value.
    onLease(null);
    await api.finishGuidedCalibration(lease.token);
    if (!active()) return false;
    if (!await api.isAudioRunning() || !sameSetup(await api.getCalibration()))
        throw new Error('The output changed. Close calibration and start again.');
    const result = await api.setDevice({inputType:d.inputType, inputDevice:d.input,
        outputType:d.outputType, outputDevice:d.output, sampleRate:d.sampleRate, bufferSize:d.inputBlockSize});
    if (!active()) return false;
    if (!result?.ok || !sameSetup(await api.getCalibration()))
        throw new Error('Could not reconnect the selected audio setup. Close calibration and check your audio settings.');
    lease = await api.beginGuidedCalibration();
    if (!active()) {await api.finishGuidedCalibration(lease.token);return false;}
    onLease(lease);
    if (!sameSetup(lease.profile)) throw new Error('The output changed. Close calibration and start again.');
    if (!await started()) {
        if (!active()) return false;
        throw new Error('The selected output is still not playing audio. Close calibration and check that the device is connected and available.');
    }
    return active();
}
