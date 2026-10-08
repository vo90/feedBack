import {createAvComparison, calibrationVisualTime} from './guided-av-model.js';
import {jucePlayer, pausePlayback, _queueBackingCommand} from './transport.js';
import {setAvOffsetMs} from './settings.js';

let opening = false;
export async function openGuidedAv() {
    if (opening || window._guidedAvCalibration) return;
    const api = window.feedBackDesktop?.audio;
    if (!api?.beginGuidedCalibration) return;
    opening = true;
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'guided-av-dialog';
    dialog.setAttribute('aria-labelledby', 'gav-title');
    dialog.innerHTML = `<style>
    .guided-av-dialog{color:#e6edf7;background:#121c2d;border:1px solid #34445c;border-radius:22px;padding:0;width:min(760px,92vw);max-height:92vh;box-shadow:0 30px 100px #0008;font-family:inherit}
    .guided-av-dialog::backdrop{background:#030817c9;backdrop-filter:blur(5px)}
    .gav-wrap{padding:32px}.gav-top{display:flex;justify-content:space-between;gap:16px;align-items:start}.gav-eyebrow{font-size:12px;color:#71ddc5;letter-spacing:.12em;text-transform:uppercase}.gav-title{font-size:28px;font-weight:650;margin:8px 0}.gav-muted{color:#a6b7cc;font-size:14px;line-height:1.6}.gav-device{background:#1b2940;border-radius:12px;padding:12px 16px;margin:20px 0;font-size:13px;color:#b8c9df;overflow-wrap:anywhere}
    .gav-stage{margin:24px 0;background:#0a1322;border:1px solid #26364d;border-radius:16px;overflow:hidden}.gav-track{position:relative;height:150px;margin:0 32px}.gav-line{position:absolute;left:50%;top:32px;bottom:32px;width:3px;background:#526c89;border-radius:4px}.gav-marker{position:absolute;left:50%;top:63px;width:24px;height:24px;border-radius:50%;background:#69e1c5;transform:translateX(-50%);opacity:0;box-shadow:0 0 20px #69e1c540}.gav-caption{text-align:center;min-height:28px;padding:0 16px 14px;color:#9eb1ca;font-size:13px}.gav-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.guided-av-dialog button{border-radius:10px;padding:11px 17px;font-size:14px;font-weight:600;border:1px solid #344760;background:#223149;color:#e6edf7;cursor:pointer}.guided-av-dialog button:hover{background:#30435d}.guided-av-dialog button:focus-visible{outline:3px solid #72e3cc;outline-offset:3px}.guided-av-dialog button:disabled{opacity:.4;cursor:default}.guided-av-dialog .gav-primary{background:#64dbc0;color:#09241e;border-color:#64dbc0}.guided-av-dialog .gav-close{padding:4px 10px;background:transparent;border:0;font-size:25px}.gav-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gav-value{font-size:38px;font-weight:650;margin:10px 0}.gav-error{color:#ffd2a0;min-height:24px;font-size:14px;margin-top:12px}.gav-footer{display:flex;justify-content:space-between;align-items:center;margin-top:20px;gap:12px}.gav-volume{display:flex;align-items:center;gap:12px;margin:16px 0;font-size:13px;color:#a6b7cc}.gav-volume input{accent-color:#69e1c5;width:130px}.gav-hidden{display:none!important}@media(max-width:540px){.gav-wrap{padding:20px}.gav-title{font-size:23px}.gav-choices{grid-template-columns:1fr}.gav-actions button{flex:1}}
    </style><div class="gav-wrap"><div class="gav-top"><div><div class="gav-eyebrow" id="gav-step">Audio / visual calibration</div><h2 id="gav-title" class="gav-title">Find your rhythm</h2></div><button class="gav-close" id="gav-close" aria-label="Close calibration">×</button></div>
    <p class="gav-muted" id="gav-description">Watch the marker cross the line and listen to the click. No guitar or microphone needed. Your song will stay paused.</p>
    <div class="gav-device" id="gav-device">Preparing your active output…</div>
    <div class="gav-volume"><label for="gav-volume">Click volume</label><input id="gav-volume" type="range" min="2" max="60" value="35" aria-label="Click volume"></div>
    <div class="gav-stage"><div class="gav-track"><div id="gav-line" class="gav-line"></div><div id="gav-marker" class="gav-marker"></div></div><div class="gav-caption" id="gav-caption">Each click belongs to one crossing.</div></div>
    <div id="gav-prepare"><p class="gav-muted">Sit where you normally play, using your normal display settings. Start with a comfortable volume.</p><div class="gav-actions"><button id="gav-test">Test clicks</button><button class="gav-primary" id="gav-start">Begin comparison</button></div></div>
    <div id="gav-compare" class="gav-hidden"><p class="gav-muted" id="gav-question">Which came first?</p><div class="gav-choices"><button data-answer="earlier">Sound earlier</button><button data-answer="later">Sound later</button><button data-answer="together">They seem together</button><button data-answer="unsure">Not sure</button></div><div class="gav-actions"><button id="gav-replay">Replay</button><button id="gav-undo">Undo answer</button></div></div>
    <div id="gav-review" class="gav-hidden"><div id="gav-result" class="gav-value"></div><p id="gav-consistency" class="gav-muted"></p><div class="gav-actions"><button id="gav-old">Preview previous</button><button id="gav-new">Preview suggested</button></div><div class="gav-actions"><button id="gav-save" class="gav-primary">Save calibration</button><button id="gav-retry">Try again</button><button id="gav-keep">Keep previous</button></div></div>
    <p id="gav-error" class="gav-error" role="status" aria-live="polite"></p><div class="gav-footer"><span class="gav-muted" id="gav-progress">Prepare · Compare · Review</span><span class="gav-muted">Input timing stays unchanged</span></div></div>`;
    document.body.appendChild(dialog); dialog.showModal();
    const $ = id => dialog.querySelector('#gav-' + id);
    const buttons = [...dialog.querySelectorAll('[data-answer]')];
    let lease = null, model = null, mode = 'prepare', cancelled = false, closing = false;
    let heartbeat = null, frame = null, clock = null, playing = false, trialBusy = false;
    let offset = 0, lastFrame = 0, observed = 0, cueIndex = -1, invalid = false, pollBusy = false;
    let actionGeneration = 0, trialStarted = 0;
    const busy = {busy:true}; window._guidedAvCalibration = busy;
    const setError = text => { $('error').textContent = text; };
    const controls = enabled => buttons.forEach(button => {button.disabled = !enabled;});
    function stopVisual() {
        playing = false; if (frame) cancelAnimationFrame(frame); frame = null;
        $('marker').style.opacity = '0'; $('line').style.background = '#526c89';
    }
    async function close(save = false) {
        if (closing) return;
        closing = true; cancelled = true; actionGeneration++; stopVisual();
        try {
            if (lease) {
                const value = save ? model.result.offsetMs : undefined;
                const response = await api.finishGuidedCalibration(lease.token, value);
                lease = null;
                if (save) {
                    // Commit UI only after Desktop confirms the saved route and value.
                    setAvOffsetMs(response.profile.output.offsetMs, true);
                    window.dispatchEvent(new CustomEvent('feedback:audio-route-changed'));
                }
            }
        } catch (error) {
            if (save) {closing = false; cancelled = false; setError('Could not save. Your previous calibration is kept. Retry Save or choose Keep previous.'); return;}
            console.warn('[calibration] cleanup:', error);
        }
        clearInterval(heartbeat); removeEventListener('visibilitychange', hidden);
        window.removeEventListener('pagehide', hidden);
        window.removeEventListener('keydown', keys, true);
        dialog.close(); dialog.remove();
        if (window._guidedAvCalibration === busy) window._guidedAvCalibration = null;
        opening = false; previousFocus?.focus?.();
    }
    function hidden() {if (document.hidden || !dialog.isConnected) void close();}
    function keys(event) {
        if (!dialog.contains(event.target)) {event.stopImmediatePropagation();return;}
        // Keep game-wide shortcuts from playing a song or changing saved AV.
        if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();void close();}
        else if (['[',']',' '].includes(event.key) && event.target.tagName !== 'BUTTON' && event.target.tagName !== 'INPUT') event.stopImmediatePropagation();
    }
    function renderMode() {
        for (const name of ['prepare','compare','review']) $(name).classList.toggle('gav-hidden', name !== mode);
        $('step').textContent = mode === 'prepare' ? 'Step 1 of 3 · Prepare' : mode === 'compare' ? 'Step 2 of 3 · Compare' : 'Step 3 of 3 · Review';
        $('title').textContent = mode === 'prepare' ? 'Find your rhythm' : mode === 'compare' ? 'Watch. Listen. Compare.' : 'Your suggested alignment';
        $('undo').disabled = !model?.canUndo;
        $('progress').textContent = mode === 'compare' ? `Comparison ${model.count + 1} · ${model.round ? 'Checking consistency' : 'Finding alignment'}` : 'Prepare · Compare · Review';
    }
    function review() {
        mode = 'review'; renderMode(); const r = model.result;
        $('result').textContent = r.consistent ? `${r.offsetMs > 0 ? '+' : ''}${r.offsetMs} ms` : 'Let’s check again';
        $('consistency').textContent = r.consistent ? `The two rounds were ${r.repeatabilityMs} ms apart. Previous setting: ${lease.profile.output.offsetMs} ms. This is perceptual alignment, not a measured hardware delay.` : 'Your answers did not identify a repeatable alignment. Your previous calibration is still saved. You can try again or keep it.';
        $('save').disabled = !r.consistent; $('new').disabled = !r.consistent;
        $('save').textContent = lease.profile.perOutputSetup === false ? 'Save shared calibration' : 'Save calibration';
    }
    function animate(now) {
        if (!playing) return;
        if (now - trialStarted > 12000) {
            stopVisual(); controls(false);
            setError('The timing signal was interrupted. Replay this comparison.'); return;
        }
        if (lastFrame && now - lastFrame > 80) invalid = true;
        lastFrame = now;
        const t = calibrationVisualTime(clock?.getClockSnapshot(), now, offset);
        if (t !== null) {
            const nearest = lease.cues.reduce((best, cue) => Math.abs(t - cue) < Math.abs(t - best) ? cue : best, lease.cues[0]);
            const distance = t - nearest, width = dialog.querySelector('.gav-track').clientWidth;
            $('marker').style.opacity = Math.abs(distance) < .9 ? '1' : '0';
            $('marker').style.transform = `translateX(calc(-50% + ${Math.max(-1, Math.min(1, distance / .9)) * width * .45}px))`;
            $('line').style.background = Math.abs(distance) < .05 ? '#c6fff0' : '#526c89';
            const passed = lease.cues.filter(cue => t >= cue).length;
            if (passed > cueIndex) {cueIndex = passed; observed = passed;}
            if (observed >= 3 && t >= 8.2 && t - offset / 1000 >= 8.2) {
                stopVisual(); controls(!invalid);
                $('caption').textContent = invalid ? 'Timing was interrupted. Replay this comparison.' : 'Think about the click and the crossing, then choose below.';
                return;
            }
        } else if (clock?._presentation && now - clock._sourceAt > 150) invalid = true;
        frame = requestAnimationFrame(animate);
    }
    async function trial(value) {
        if (!lease || trialBusy || cancelled) return;
        trialBusy = true; const generation = ++actionGeneration;
        controls(false); stopVisual(); setError('');
        $('caption').textContent = 'Listen to three clicks. Watch where the marker crosses.';
        try {
            await api.playCalibrationTrial(lease.token, Number($('volume').value) / 100);
            if (cancelled || generation !== actionGeneration) return;
            clock = Object.create(jucePlayer);
            Object.assign(clock, {_polling:true, _speed:1, _dur:10, _presentation:null, _sourceAt:performance.now(),
                _sampleSequence:-1, _nativeGeneration:-1, _clockMapping:null, _clockSnapshot:{}});
            offset = value; observed = 0; cueIndex = -1; invalid = false; lastFrame = 0; playing = true; trialStarted = performance.now();
            frame = requestAnimationFrame(animate);
        } catch (error) {setError('The output is unavailable or changed. Close calibration and apply your output again.');}
        finally {trialBusy = false;}
    }
    async function poll() {
        if (!lease || pollBusy || closing) return;
        pollBusy = true;
        try {
            const polledClock = clock;
            const sent = performance.now(), snapshot = await api.pollCalibration(lease.token), received = performance.now();
            if (!snapshot) {setError('Output changed. Close this guide and start again for the new setup.'); stopVisual(); controls(false); $('save').disabled = true; return;}
            if (clock && clock === polledClock && clock._validSnapshot(snapshot)) {
                const mapped = clock._mapSnapshotTime(snapshot, sent, received);
                if (mapped !== null) clock._acceptSnapshot(snapshot, mapped);
                if (playing && received - sent > 30) invalid = true;
            }
        } catch (_) {invalid = true;}
        finally {pollBusy = false;}
    }
    $('close').onclick = () => void close(); $('keep').onclick = () => void close();
    dialog.addEventListener('cancel', event => {event.preventDefault();void close();});
    $('test').onclick = () => void trial(lease.profile.output.offsetMs);
    $('start').onclick = () => {mode = 'compare';renderMode();void trial(model.candidate);};
    $('replay').onclick = () => void trial(model.candidate);
    $('undo').onclick = () => {model.undo();renderMode();void trial(model.candidate);};
    for (const button of buttons) button.onclick = () => {model.answer(button.dataset.answer); if (model.result) review(); else {renderMode();void trial(model.candidate);}};
    $('retry').onclick = () => {model = createAvComparison(lease.profile.output.offsetMs);mode='compare';renderMode();void trial(model.candidate);};
    $('old').onclick = () => void trial(lease.profile.output.offsetMs);
    $('new').onclick = () => void trial(model.result.offsetMs);
    $('save').onclick = () => void close(true);
    addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', hidden);
    window.addEventListener('keydown', keys, true);
    $('test').disabled = $('start').disabled = true;
    try {
        await pausePlayback(); await jucePlayer.pause(); await _queueBackingCommand(() => true);
        if (cancelled) return;
        lease = await api.beginGuidedCalibration();
        if (cancelled) {await api.finishGuidedCalibration(lease.token);lease=null;return;}
        model = createAvComparison(lease.profile.output.offsetMs);
        $('device').textContent = `${lease.profile.output.label}${lease.profile.perOutputSetup === false ? ' · Shared calibration' : ''}`;
        heartbeat = setInterval(() => void poll(), 40);
        $('test').disabled = $('start').disabled = false; renderMode(); $('start').focus();
    } catch (error) {setError('Could not prepare calibration. Apply your audio output and try again.');}
    finally {opening = false;}
}
