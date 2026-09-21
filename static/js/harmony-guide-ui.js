/** Permanent 3D harmony HUD and a local, song-timed correction editor. */
import { createHarmonyTimeline, resolveHarmony } from './harmony-guide-model.js';
import { parseGuideTime, formatGuideTime, parseGuideChord, guideChordText } from './harmony-guide-controller.js';

const SCALES = [
    ['', 'Choose from key'], ['major', 'Major'], ['natural_minor', 'Natural minor'],
    ['harmonic_minor', 'Harmonic minor'], ['melodic_minor', 'Melodic minor'],
    ['dorian', 'Dorian'], ['phrygian', 'Phrygian'], ['lydian', 'Lydian'],
    ['mixolydian', 'Mixolydian'], ['locrian', 'Locrian'],
    ['minor_pentatonic', 'Minor pentatonic'], ['major_pentatonic', 'Major pentatonic'],
];
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}
function button(text, onClick, className = 'hg-button') {
    const node = element('button', className, text);
    node.type = 'button'; node.addEventListener('click', onClick); return node;
}
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function countdown(beats, seconds) {
    if (Number.isFinite(beats) && beats > 0) return `in ${Math.max(1, Math.ceil(beats - 0.001))} beats`;
    return Number.isFinite(seconds) ? `in ${Math.max(0, Math.ceil(seconds))}s` : '';
}

export function validateGuideRows(keyRows, chordRows, duration = Infinity) {
    const errors = [], keys = [], harmony = [];
    const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    for (const [index, row] of keyRows.entries()) {
        const t = parseGuideTime(row.time), key = row.key.trim();
        if (t == null || t > max) errors.push(`Key row ${index + 1}: enter a time within the song.`);
        else if (!/^[A-Ga-g][#b♯♭]?(?:m|\s+(?:major|minor))?$/.test(key)) errors.push(`Key row ${index + 1}: use a key such as C, Am or F# minor.`);
        else keys.push({ t, key, ...(row.scale ? { scale: row.scale } : {}) });
    }
    for (const [index, row] of chordRows.entries()) {
        const t = parseGuideTime(row.time);
        const chord = t == null ? null : parseGuideChord(row.chord, t);
        if (t == null || t > max) errors.push(`Chord row ${index + 1}: enter a time within the song.`);
        else if (!chord || chord.unknown) errors.push(`Chord row ${index + 1}: use a chord such as Am, F, C/E or N.C.`);
        else harmony.push(chord);
    }
    for (const [name, events] of [['Key', keys], ['Chord', harmony]]) {
        const seen = new Set();
        for (const event of events) {
            if (seen.has(event.t)) errors.push(`${name} rows cannot share the same start time (${formatGuideTime(event.t)}).`);
            seen.add(event.t);
        }
        events.sort((a, b) => a.t - b.t);
    }
    if (!errors.length) {
        const timeline = createHarmonyTimeline({ keys, harmony });
        for (const t of new Set([...keys, ...harmony].map(event => event.t))) {
            const state = resolveHarmony(timeline, t);
            if (state.scaleStatus === 'conflict') errors.push(`At ${formatGuideTime(t)} the scale and chord disagree. Adjust the scale region or chord.`);
            if (state.scaleStatus === 'unsupported') errors.push(`At ${formatGuideTime(t)} the key or scale is not supported for note guidance.`);
            if (state.current?.supported === false && harmony.some(e => e.t === t && e.root)) {
                errors.push(`At ${formatGuideTime(t)} the chord quality is not recognised. Use a supported chord or a simpler reviewed label.`);
            }
        }
    }
    return { keys, harmony, errors: [...new Set(errors)] };
}

/** DOM queries happen at mount only. update() writes cached nodes on change. */
export function createHarmonyGuideUI(container, controller) {
    const root = element('div', 'hg-root');
    root.addEventListener('keydown', event => event.stopPropagation());
    const toggle = button('Harmony guide', () => {
        try { controller.setOptions({ enabled: true }); refreshControls(); }
        catch (error) { toggle.title = error.message; }
    }, 'hg-enable');
    toggle.setAttribute('aria-label', 'Enable song harmony guide');
    const strip = element('section', 'hg-strip');
    strip.setAttribute('aria-label', 'Song harmony guide');
    const context = element('div', 'hg-context');
    const key = element('strong', 'hg-key', 'Key unavailable');
    const scale = element('span', 'hg-scale', 'Scale unavailable');
    context.append(key, scale);
    const current = element('div', 'hg-current');
    current.title = 'The song’s current chord and root to focus on';
    const currentLabel = element('span', 'hg-eyebrow', 'NOW');
    const chord = element('strong', 'hg-chord', '—');
    const target = element('span', 'hg-target');
    current.append(currentLabel, chord, target);
    const progression = element('div', 'hg-progression');
    const nextLabel = element('span', 'hg-eyebrow', 'UP NEXT');
    const nextLine = element('div', 'hg-next-line');
    const upcoming = Array.from({ length: 4 }, () => element('span', 'hg-next-chord'));
    nextLine.append(...upcoming); progression.append(nextLabel, nextLine);
    const controls = element('div', 'hg-controls');
    controls.append(button('Edit', openEditor), button('×', () => {
        try { controller.setOptions({ enabled: false }); refreshControls(); }
        catch (error) { toggle.title = error.message; }
    }, 'hg-close'));
    controls.lastChild.setAttribute('aria-label', 'Hide harmony guide');
    strip.append(context, current, progression, controls);
    const footer = element('div', 'hg-footer');
    const provenance = element('span', 'hg-source');
    const status = element('span', 'hg-status');
    footer.append(provenance, status);
    const legend = element('div', 'hg-legend');
    const scaleLegend = element('span', 'hg-legend-note', 'Scale note');
    const tonicLegend = element('span', 'hg-legend-tonic', 'Scale tonic');
    const targetLegend = element('span', 'hg-legend-target', 'Chord root');
    tonicLegend.title = 'Home note of the suggested scale';
    targetLegend.title = 'Current root or target note from the song’s harmony';
    legend.append(scaleLegend, tonicLegend, targetLegend);
    root.append(toggle, strip, footer, legend); container.append(root);

    let supported = false, observer = null, dialog = null, lastGeneration = -1;
    const mainPlayer = container.id === 'player';
    const playerHud = mainPlayer ? container.querySelector('#player-hud') : null;
    const updateInset = () => {
        const inset = playerHud ? Math.ceil(playerHud.getBoundingClientRect().height) + 8 : 14;
        root.style.setProperty('--hg-top', `${inset}px`);
    };
    updateInset();
    if (playerHud && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(updateInset); observer.observe(playerHud);
    }
    function refreshControls() {
        root.hidden = !supported;
        toggle.hidden = controller.options.enabled;
        strip.hidden = footer.hidden = !controller.options.enabled;
        if (!controller.options.enabled) legend.hidden = true;
    }
    refreshControls();

    function closeEditor() { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } }
    function openEditor() {
        if (dialog) return;
        dialog = element('dialog', 'hg-editor');
        dialog.setAttribute('aria-label', 'Edit song harmony');
        const content = element('form', 'hg-editor-content'); content.method = 'dialog';
        const errors = element('p', 'hg-error'); errors.setAttribute('role', 'alert');
        const heading = element('div', 'hg-editor-heading');
        heading.append(element('h2', '', 'Song harmony'), button('Close', closeEditor));
        content.append(heading, element('p', 'hg-help',
            'Set the song’s musical context and chord changes. Times use seconds or m:ss. Each row continues until the next. Use “A note” for a root-only target, or N.C. for no chord. Changes are saved locally for this version of the song.'));
        const preferences = element('div', 'hg-preferences');
        function checkbox(text, name) {
            const label = element('label', 'hg-check'); const input = element('input');
            input.type = 'checkbox'; input.checked = controller.options[name];
            input.addEventListener('change', () => { try { controller.setOptions({ [name]: input.checked }); } catch (error) { errors.textContent = error.message; } });
            label.append(input, document.createTextNode(text)); return label;
        }
        const mode = element('select');
        for (const [value, text] of [['beats', 'Beats'], ['seconds', 'Song seconds']]) {
            const option = element('option', '', text); option.value = value; mode.append(option);
        }
        mode.value = controller.options.thresholdMode; mode.setAttribute('aria-label', 'Rest threshold unit');
        const threshold = element('input'); threshold.type = 'number'; threshold.step = '0.5';
        threshold.setAttribute('aria-label', 'Minimum rest length');
        function thresholdMode() {
            const seconds = mode.value === 'seconds';
            threshold.min = seconds ? '0.5' : '1'; threshold.max = seconds ? '60' : '64';
            threshold.value = seconds ? controller.options.minimumSeconds : controller.options.minimumBeats;
        }
        thresholdMode();
        mode.addEventListener('change', () => {
            try { controller.setOptions({ thresholdMode: mode.value }); thresholdMode(); } catch (error) { errors.textContent = error.message; }
        });
        threshold.addEventListener('change', () => {
            try { controller.setOptions({ [mode.value === 'seconds' ? 'minimumSeconds' : 'minimumBeats']: Number(threshold.value) }); thresholdMode(); }
            catch (error) { errors.textContent = error.message; }
        });
        const restLabel = element('label', 'hg-threshold', 'Show scale during rests of at least ');
        const labels = element('select'); labels.setAttribute('aria-label', 'Gem labels');
        for (const [value, text] of [['degrees', 'Scale degrees'], ['notes', 'Note names'], ['none', 'No labels']]) {
            const option = element('option', '', text); option.value = value; labels.append(option);
        }
        labels.value = controller.options.labelMode;
        labels.addEventListener('change', () => {
            try { controller.setOptions({ labelMode: labels.value }); }
            catch (error) { labels.value = controller.options.labelMode; errors.textContent = error.message; }
        });
        const labelChoice = element('label', 'hg-check', 'Gem labels'); labelChoice.append(labels);
        restLabel.append(threshold, mode); preferences.append(restLabel, checkbox('Position shapes', 'showPositions'), labelChoice);
        content.append(preferences);
        content.append(element('p', 'hg-help', 'R marks the scale root. Numbers are intervals from that root; ♭3 means a minor third. The gold outline follows the song’s current chord without changing the degree labels.'));
        const columns = element('div', 'hg-editor-columns');
        const keyRows = [], chordRows = [];
        const keysPanel = element('section'), chordsPanel = element('section');
        keysPanel.append(element('h3', '', 'Key & scale regions'));
        chordsPanel.append(element('h3', '', 'Chord progression'));
        const keysList = element('div', 'hg-rows'), chordsList = element('div', 'hg-rows');
        keysPanel.append(keysList); chordsPanel.append(chordsList);
        function makeRow(kind, event) {
            const list = kind === 'key' ? keyRows : chordRows;
            if (list.length >= 500) { errors.textContent = 'Use at most 500 rows per track.'; return; }
            const node = element('div', `hg-edit-row hg-edit-row--${kind}`);
            const time = element('input'); time.value = formatGuideTime(event.t || 0);
            time.setAttribute('aria-label', `${kind} start time`); time.placeholder = '0:00'; time.inputMode = 'decimal';
            const value = element('input'); value.value = kind === 'key' ? event.key || '' : guideChordText(event);
            value.setAttribute('aria-label', kind === 'key' ? 'Musical key' : 'Chord');
            value.placeholder = kind === 'key' ? 'Am' : 'Am / F / C/E';
            node.append(time, value);
            let select = null;
            if (kind === 'key') {
                select = element('select'); select.setAttribute('aria-label', 'Suggested scale');
                for (const [id, name] of SCALES) { const option = element('option', '', name); option.value = id; select.append(option); }
                if (event.scale && !SCALES.some(([id]) => id === event.scale)) {
                    const option = element('option', '', event.scale); option.value = event.scale; select.append(option);
                }
                select.value = event.scale || ''; node.append(select);
            }
            const row = { node, time, value, select };
            const remove = button('×', () => { node.remove(); list.splice(list.indexOf(row), 1); }, 'hg-row-remove');
            remove.setAttribute('aria-label', `Remove ${kind} row`); node.append(remove); list.push(row);
            (kind === 'key' ? keysList : chordsList).append(node);
        }
        const data = controller.getData();
        for (const event of data.keys) makeRow('key', event);
        for (const event of data.harmony) makeRow('chord', event);
        keysPanel.append(button('+ Key change', () => makeRow('key', { t: 0, key: '', scale: '' })));
        chordsPanel.append(button('+ Chord change', () => makeRow('chord', { t: 0, root: 'C', quality: 'maj' })));
        columns.append(keysPanel, chordsPanel); content.append(columns);
        content.append(errors);
        if (!controller.canSave) errors.textContent = 'Song identity is unavailable. Reload the song before saving corrections.';
        const actions = element('div', 'hg-editor-actions');
        if (controller.hasOverride) actions.append(button('Use feedpak annotations', () => {
            try { controller.clearOverride(); closeEditor(); } catch (error) { errors.textContent = error.message; }
        }));
        actions.append(button('Cancel', closeEditor));
        const saveButton = button('Save locally', () => {
            const result = validateGuideRows(
                keyRows.map(row => ({ time: row.time.value, key: row.value.value, scale: row.select.value })),
                chordRows.map(row => ({ time: row.time.value, chord: row.value.value })), controller.songEnd);
            if (result.errors.length) { errors.textContent = result.errors.join(' '); return; }
            try { controller.saveOverride(result); closeEditor(); } catch (error) { errors.textContent = error.message; }
        }, 'hg-button hg-button--primary');
        saveButton.disabled = !controller.canSave || data.keys.length > 500 || data.harmony.length > 500;
        actions.append(saveButton); content.append(actions);
        content.addEventListener('submit', event => event.preventDefault());
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
        dialog.append(content); container.append(dialog); dialog.showModal();
    }
    return {
        setSupported(value) { supported = !!value; if (!supported) closeEditor(); refreshControls(); },
        update(guide) {
            if (lastGeneration !== controller.generation) { lastGeneration = controller.generation; refreshControls(); }
            if (!supported) return;
            if (!guide.state) {
                setText(key, 'Song harmony'); setText(scale, 'Waiting for song data');
                setText(chord, '—'); setText(target, ''); target.hidden = true;
                setText(nextLabel, 'UP NEXT');
                for (const node of upcoming) node.hidden = true;
                setText(provenance, ''); setText(status, ''); legend.hidden = true;
                return;
            }
            if (!guide.enabled) return;
            const state = guide.state;
            setText(scaleLegend, guide.options.labelMode === 'degrees' ? 'Scale degree' : 'Scale note');
            setText(tonicLegend, guide.options.labelMode === 'degrees' ? 'R · Scale tonic' : 'Scale tonic');
            setText(key, state.key ? `Key: ${state.key.label}` : 'Key unavailable');
            setText(scale, state.scale ? `Scale: ${state.scale.label}`
                : state.scaleStatus === 'conflict' ? 'Scale needs review' : 'Scale unavailable');
            setText(chord, state.current?.label || '—');
            setText(target, state.current?.status === 'chord' && state.current.root ? `Root ${state.current.root}` : '');
            target.hidden = !target.textContent;
            setText(currentLabel, state.current?.status === 'note' ? 'TARGET NOTE' : 'NOW');
            for (let i = 0; i < upcoming.length; i++) {
                const event = state.upcoming?.[i]; upcoming[i].hidden = !event;
                if (event) setText(upcoming[i], event.label);
            }
            setText(nextLabel, state.upcoming?.length ? `UP NEXT · ${countdown(guide.nextBeats, guide.nextSeconds)}` : 'NO UPCOMING CHANGE');
            const hasData = !!state.key || !!(state.current && state.current.status !== 'unknown');
            setText(provenance, controller.hasOverride ? 'Your local guide' : hasData ? 'Feedpak annotations' : 'No harmony annotations');
            let message = !hasData ? 'Add harmony to this song with Edit' : '';
            if (guide.rest?.active && guide.alpha > 0) {
                const remaining = countdown(guide.rest.reentryInBeats, guide.rest.reentryInSeconds);
                message = remaining ? `Room to improvise · Chart resumes ${remaining}` : 'Room to improvise';
            } else if (state.scaleStatus === 'conflict') message = 'Review the scale and chord in Edit';
            setText(status, message);
            legend.hidden = !(guide.alpha > 0 && state.scale);
        },
        destroy() { observer?.disconnect(); closeEditor(); root.remove(); },
    };
}
