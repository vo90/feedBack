// A selected-song batch is explicit. Opening the guide never scans a library.
export function openHarmonyBatch(filenames, { fetcher = (...args) => fetch(...args) } = {}) {
    const songs = [...new Set(filenames.filter(name => typeof name === 'string' && name))];
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'harmony-batch-title');
    dialog.setAttribute('role', 'dialog');
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(540px,90vw);max-height:80vh;border:1px solid #404757;border-radius:18px;padding:24px;background:#151a24;color:#eff2f7;box-shadow:0 24px 80px #0009';
    dialog.innerHTML = '<h2 id="harmony-batch-title" style="font-size:20px;font-weight:650;margin-bottom:8px">Analyse harmony</h2>'
        + '<p style="font-size:13px;color:#aab5c8;line-height:1.5;margin-bottom:18px">Read every instrument chart to estimate keys, chords and scales for the 3D guide. Results stay in this profile.</p>'
        + '<p data-status role="status" aria-live="polite" style="margin-bottom:10px">Starting…</p>'
        + '<progress data-progress style="width:100%;accent-color:#d7ae63"></progress>'
        + '<ol data-results style="max-height:38vh;overflow:auto;font-size:13px;padding:0;list-style:none;margin:14px 0"></ol>'
        + '<p data-hint style="font-size:12px;color:#aab5c8;margin:12px 0">Chart estimates can be incomplete. Authored information and your corrections keep priority.</p>'
        + '<button data-action style="background:#303c51;color:white;border:1px solid #586780;border-radius:8px;padding:8px 16px;cursor:pointer">Cancel analysis</button>';
    document.body.appendChild(dialog);
    dialog.showModal();
    const status = dialog.querySelector('[data-status]');
    const progress = dialog.querySelector('[data-progress]');
    const results = dialog.querySelector('[data-results]');
    const action = dialog.querySelector('[data-action]');
    let id = null, timer = null, finished = false, cancelRequested = false;
    progress.max = songs.length || 1;
    progress.value = 0;

    async function request(url, options) {
        const response = await fetcher(url, options);
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Harmony analysis request failed');
        return data;
    }
    function showError(error) {
        finished = true;
        clearTimeout(timer);
        status.textContent = error.message || 'Harmony analysis is unavailable';
        action.textContent = 'Close';
    }
    function paint(job) {
        progress.value = job.completed;
        const failed = job.items.filter(item => item.status === 'failed').length;
        const partial = job.items.filter(item => item.analysis_status === 'partial').length;
        finished = ['complete', 'cancelled', 'failed'].includes(job.status);
        status.textContent = job.status === 'cancelled' ? 'Analysis cancelled'
            : finished ? `${job.completed - failed} of ${job.total} analysed${failed ? ` · ${failed} failed` : ''}${partial ? ` · ${partial} with gaps` : ''}`
                : `Analysing ${job.completed} of ${job.total} songs…`;
        results.replaceChildren();
        for (const item of job.items) {
            const row = document.createElement('li');
            row.style.cssText = 'padding:7px 0;border-bottom:1px solid #ffffff0c;overflow-wrap:anywhere';
            const name = item.filename.split(/[\\/]/).pop().replace(/\.(feedpak|sloppak)$/i, '');
            const state = item.status === 'complete' ? (item.analysis_status === 'unsupported' ? 'No supported charts'
                : item.analysis_status === 'partial' ? 'Ready · some gaps' : 'Ready') : item.status;
            row.textContent = `${name} — ${item.error || state}`;
            results.appendChild(row);
        }
        action.disabled = false;
        action.textContent = finished ? 'Close' : 'Cancel analysis';
    }
    async function cancel() {
        cancelRequested = true;
        clearTimeout(timer);
        if (!id) { status.textContent = 'Cancelling…'; return; }
        action.disabled = true;
        try {
            paint(await request(`/api/harmony/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }));
        } catch (error) {
            // Keep the job visible and cancellable if its outcome is uncertain.
            status.textContent = `Could not confirm cancellation: ${error.message}`;
            action.disabled = false;
            action.textContent = 'Retry cancellation';
        }
    }
    async function poll() {
        if (cancelRequested) return;
        try {
            const job = await request(`/api/harmony/jobs/${encodeURIComponent(id)}?include_results=false`);
            if (cancelRequested) return;
            paint(job);
            if (!finished && !cancelRequested) timer = setTimeout(poll, 600);
        } catch (error) {
            if (cancelRequested) return;
            status.textContent = `${error.message}. Retrying…`;
            if (!cancelRequested) timer = setTimeout(poll, 2500);
        }
    }
    function dismiss() {
        if (!finished) { void cancel(); return; }
        clearTimeout(timer);
        dialog.close();
        dialog.remove();
    }
    action.addEventListener('click', dismiss);
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    void (async () => {
        try {
            if (!songs.length || songs.length > 100) throw new Error('Select between 1 and 100 local Feedpak songs.');
            const job = await request('/api/harmony/analyse', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: songs, priority: 'batch' }),
            });
            id = job.id;
            if (cancelRequested) { await cancel(); return; }
            paint(job);
            if (!finished) void poll();
        } catch (error) { showError(error); }
    })();
    return dialog;
}
