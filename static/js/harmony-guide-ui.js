/** Permanent 3D harmony HUD and a local, song-timed correction editor. */
import { createHarmonyTimeline, resolveHarmony } from './harmony-guide-model.js';
import { parseGuideTime, formatGuideTime, parseGuideChord, guideChordText } from './harmony-guide-controller.js';
import { createGuidePlacementStore, DEFAULT_GUIDE_PLACEMENT, guidePanelPosition,
    guidePlacementFromPoint } from './harmony-guide-placement.js';

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

export function guideTargetPresentation(event) {
    const possible = (event?.source === 'charts' || event?.estimated_from_charts === true)
        && event.confidence === 'low' && event.rootPc != null;
    return {
        heading: possible ? event.status === 'note' ? 'POSSIBLE ROOT' : 'POSSIBLE CHORD'
            : event?.status === 'note' ? 'TARGET NOTE' : 'NOW',
        upcoming: `${event?.label || 'Unknown'}${possible ? ' ?' : ''}`,
    };
}

export function validateGuideRows(keyRows, chordRows, duration = Infinity, scaleRows = null) {
    const errors = [], keys = [], harmony = [], scales = [];
    const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    const bounds = (row, event, name) => {
        if (row.end != null && row.end !== '') {
            const end = parseGuideTime(row.end);
            if (end == null || end <= event.t || end > max) errors.push(`${name}: the end must follow the start and remain within the song.`);
            else event.end = end;
        }
        return event;
    };
    for (const [index, row] of keyRows.entries()) {
        const t = parseGuideTime(row.time), key = row.key.trim();
        if (t == null || t > max) errors.push(`Key row ${index + 1}: enter a time within the song.`);
        else if (!/^[A-Ga-g][#b♯♭]?(?:m|\s+(?:major|minor))?$/.test(key) && !/^(\?|unknown)$/i.test(key)) errors.push(`Key row ${index + 1}: use a key such as C, Am, F# minor or ?.`);
        else keys.push(bounds(row, /^(\?|unknown)$/i.test(key) ? { t, unknown: true }
            : { t, key, ...(row.scale ? { scale: row.scale } : {}) }, `Key row ${index + 1}`));
    }
    for (const [index, row] of chordRows.entries()) {
        const t = parseGuideTime(row.time);
        const chord = t == null ? null : parseGuideChord(row.chord, t);
        if (t == null || t > max) errors.push(`Chord row ${index + 1}: enter a time within the song.`);
        else if (!chord) errors.push(`Chord row ${index + 1}: use a chord such as Am, F, C/E, ? or N.C.`);
        else {
            // Unedited derived voicings may contain a corroborated extension
            // beyond their printed chord name. Keep it when reviewing a track;
            // replacing the label intentionally replaces that pitch evidence.
            if (['charts', 'local'].includes(row.source) && row.original
                && row.chord.trim() === guideChordText(row.original)) {
                if (Array.isArray(row.original.chord_tones)) chord.chord_tones = [...row.original.chord_tones];
                if (row.original.display_label) chord.display_label = row.original.display_label;
                if (row.source === 'charts' || row.original.estimated_from_charts) {
                    chord.estimated_from_charts = true;
                    chord.confidence = row.original.confidence;
                }
            }
            harmony.push(bounds(row, chord, `Chord row ${index + 1}`));
        }
    }
    for (const [index, row] of (scaleRows || []).entries()) {
        const t = parseGuideTime(row.time), root = row.root.trim();
        if (t == null || t > max) errors.push(`Scale row ${index + 1}: enter a time within the song.`);
        else if (/^(\?|unknown)$/i.test(root)) scales.push(bounds(row, { t, unknown: true }, `Scale row ${index + 1}`));
        else if (!/^[A-Ga-g][#b♯♭]?$/.test(root) || !row.type) errors.push(`Scale row ${index + 1}: choose a root and scale, or ? for unknown.`);
        else scales.push(bounds(row, { t, root, type: row.type }, `Scale row ${index + 1}`));
    }
    for (const [name, events] of [['Key', keys], ['Chord', harmony], ['Scale', scales]]) {
        const seen = new Set();
        for (const event of events) {
            if (seen.has(event.t)) errors.push(`${name} rows cannot share the same start time (${formatGuideTime(event.t)}).`);
            seen.add(event.t);
        }
        events.sort((a, b) => a.t - b.t);
    }
    if (!errors.length) {
        const timeline = createHarmonyTimeline({ overrides: { keys, harmony, ...(scaleRows ? { scales } : {}) } });
        for (const t of new Set([...keys, ...harmony, ...scales].map(event => event.t))) {
            const state = resolveHarmony(timeline, t);
            if (state.scaleStatus === 'conflict') errors.push(`At ${formatGuideTime(t)} the scale and chord disagree. Adjust the scale region or chord.`);
            if (state.scaleStatus === 'unsupported') errors.push(`At ${formatGuideTime(t)} the key or scale is not supported for note guidance.`);
            if (state.current?.supported === false && harmony.some(e => e.t === t && e.root)) {
                errors.push(`At ${formatGuideTime(t)} the chord quality is not recognised. Use a supported chord or a simpler reviewed label.`);
            }
        }
    }
    return { keys, harmony, ...(scaleRows ? { scales } : {}), errors: [...new Set(errors)] };
}

/** DOM queries happen at mount only. update() writes cached nodes on change. */
export function createHarmonyGuideUI(container, controller, { canvas = null, storage = null } = {}) {
    const root = element('div', 'hg-root');
    root.addEventListener('keydown', event => event.stopPropagation());
    root.addEventListener('keyup', event => event.stopPropagation());
    const panel = element('div', 'hg-panel');
    panel.addEventListener('pointerdown', event => event.stopPropagation());
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
    const move = button('', () => {}, 'hg-move');
    move.setAttribute('aria-label', 'Move harmony guide');
    const grip = element('span', 'hg-grip'); grip.setAttribute('aria-hidden', 'true'); move.append(grip);
    const moveHelp = 'Drag to move. Arrow keys move; Shift moves faster. Enter saves, Escape cancels, Home resets to the top.';
    move.title = moveHelp;
    const reset = button('↥', resetPlacement, 'hg-reset');
    reset.title = 'Reset harmony guide to the top';
    reset.setAttribute('aria-label', 'Reset guide position');
    controls.append(reset, button('Edit', openEditor), button('×', () => {
        try { controller.setOptions({ enabled: false }); refreshControls(); }
        catch (error) { toggle.title = error.message; }
    }, 'hg-close'));
    controls.lastChild.setAttribute('aria-label', 'Hide harmony guide');
    strip.append(move, context, current, progression, controls);
    const footer = element('div', 'hg-footer');
    const provenance = element('span', 'hg-source');
    const status = element('span', 'hg-status');
    const retry = button('Retry analysis', () => { void controller.retryAnalysis(); });
    retry.hidden = true; footer.append(provenance, status, retry);
    const legend = element('div', 'hg-legend');
    const scaleLegend = element('span', 'hg-legend-note', 'Scale note');
    const tonicLegend = element('span', 'hg-legend-tonic', 'Scale tonic');
    const targetLegend = element('span', 'hg-legend-target', 'Chord root');
    tonicLegend.title = 'Home note of the suggested scale';
    targetLegend.title = 'Current root or target note from the song’s harmony';
    legend.append(scaleLegend, tonicLegend, targetLegend);
    const announcement = element('span', 'hg-sr-only');
    announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
    panel.append(strip, footer, legend, announcement);
    root.append(toggle, panel); container.append(root);

    let supported = false, observer = null, dialog = null, editorIdentity = null, lastGeneration = -1;
    const mainPlayer = container.id === 'player';
    const playerHud = mainPlayer ? container.querySelector('#player-hud') : null;
    const hudSides = playerHud ? [...playerHud.children].slice(0, 2) : [];
    const placementStore = createGuidePlacementStore(storage);
    let placement = placementStore.get(), layoutFrame = null, destroyed = false;
    let drag = null, keyboardStart = null;
    let metrics = null, position = { left: 0, top: 0 };
    // The renderer reads this stable object; all DOM measurements stay in the
    // observer-driven layout pass, never in the highway's draw loop.
    const layout = { topInset: 0, viewportHeight: 0 };
    const scheduleLayout = () => {
        if (!destroyed && layoutFrame == null) layoutFrame = requestAnimationFrame(measureLayout);
    };
    function publishPosition() {
        if (!metrics) return;
        position = guidePanelPosition(placement, metrics.viewport, metrics.panel, metrics.hud);
        panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`;
        panel.dataset.placement = placement.mode;
        layout.topInset = supported && controller.options.enabled && placement.mode === 'top'
            ? Math.min(metrics.viewport.height, position.top + metrics.panel.height + 8) : 0;
    }
    function measureLayout() {
        layoutFrame = null;
        if (destroyed || !supported) return;
        const view = (canvas || container).getBoundingClientRect();
        if (!view.width || !view.height) { layout.topInset = 0; return; }
        const parent = root.offsetParent || container;
        const parentRect = parent.getBoundingClientRect();
        root.style.left = `${view.left - parentRect.left - parent.clientLeft + parent.scrollLeft}px`;
        root.style.top = `${view.top - parentRect.top - parent.clientTop + parent.scrollTop}px`;
        root.style.width = `${view.width}px`; root.style.height = `${view.height}px`;
        layout.viewportHeight = view.height;
        const side = node => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return rect.width && rect.height ? { left: rect.left - view.left, right: rect.right - view.left,
                top: rect.top - view.top, bottom: rect.bottom - view.top } : null;
        };
        const hud = { left: side(hudSides[0]), right: side(hudSides[1]) };
        const viewport = { width: view.width, height: view.height };
        // Keep the collapsed control near the top, alongside the right HUD box,
        // rather than below a potentially tall performance/queue column.
        const toggleWidth = toggle.offsetWidth, toggleHeight = toggle.offsetHeight;
        const toggleRight = hud.right ? hud.right.left - 12 : view.width - 12;
        toggle.style.left = `${Math.max(12, Math.min(view.width - toggleWidth - 12, toggleRight - toggleWidth))}px`;
        toggle.style.top = `${Math.max(12, Math.min(view.height - toggleHeight - 12, hud.right?.top || 12))}px`;
        metrics = { viewport, hud, panel: { width: panel.offsetWidth, height: panel.offsetHeight } };
        publishPosition();
        if (drag) {
            drag.origin = { ...position }; drag.startX = drag.lastX; drag.startY = drag.lastY;
        }
    }
    function savePlacement(message = 'Harmony guide position saved.') {
        const saved = placementStore.save(placement);
        move.title = saved ? moveHelp : `${moveHelp} Position is available for this session; browser storage is unavailable.`;
        setText(announcement, saved ? message : 'Position changed for this session. Browser storage is unavailable.');
    }
    function resetPlacement() {
        cancelDrag(); keyboardStart = null;
        placement = { ...DEFAULT_GUIDE_PLACEMENT };
        publishPosition(); savePlacement('Harmony guide returned to the top.');
    }
    function cancelDrag() {
        if (!drag) return;
        const previous = drag; drag = null;
        placement = previous.placement;
        panel.classList.remove('hg-panel--dragging');
        if (move.hasPointerCapture(previous.id)) move.releasePointerCapture(previous.id);
        publishPosition();
    }
    move.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !metrics || drag) return;
        event.preventDefault(); move.focus({ preventScroll: true });
        keyboardStart = null;
        drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
            lastX: event.clientX, lastY: event.clientY, origin: { ...position }, placement: { ...placement }, moved: false };
        move.setPointerCapture(event.pointerId); panel.classList.add('hg-panel--dragging');
    });
    move.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id || !metrics) return;
        drag.lastX = event.clientX; drag.lastY = event.clientY;
        const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        placement = guidePlacementFromPoint({ left: drag.origin.left + dx, top: drag.origin.top + dy }, metrics.viewport, metrics.panel);
        publishPosition();
    });
    move.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.id) return;
        const moved = drag.moved; drag = null;
        panel.classList.remove('hg-panel--dragging');
        if (move.hasPointerCapture(event.pointerId)) move.releasePointerCapture(event.pointerId);
        if (moved) {
            const dock = guidePanelPosition(DEFAULT_GUIDE_PLACEMENT, metrics.viewport, metrics.panel, metrics.hud);
            placement = guidePlacementFromPoint(position, metrics.viewport, metrics.panel, { snap: 16, dock });
            publishPosition(); savePlacement();
        }
    });
    move.addEventListener('pointercancel', cancelDrag);
    move.addEventListener('lostpointercapture', cancelDrag);
    move.addEventListener('keydown', event => {
        if (event.key === 'Home') { event.preventDefault(); resetPlacement(); return; }
        if (event.key === 'Escape') {
            event.preventDefault(); cancelDrag();
            if (keyboardStart) { placement = keyboardStart; keyboardStart = null; publishPosition(); }
            setText(announcement, 'Move cancelled.'); return;
        }
        if (event.key === 'Enter' && keyboardStart) {
            event.preventDefault(); keyboardStart = null; savePlacement(); return;
        }
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction || !metrics) return;
        event.preventDefault();
        if (!keyboardStart) keyboardStart = { ...placement };
        const step = event.shiftKey ? 32 : 8;
        placement = guidePlacementFromPoint({ left: position.left + direction[0] * step,
            top: position.top + direction[1] * step }, metrics.viewport, metrics.panel);
        publishPosition();
    });
    move.addEventListener('blur', () => { if (keyboardStart) { keyboardStart = null; savePlacement(); } });
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(scheduleLayout);
        for (const node of new Set([container, canvas, playerHud, panel, ...hudSides].filter(Boolean))) observer.observe(node);
    }
    window.addEventListener('resize', scheduleLayout);
    document.addEventListener('fullscreenchange', scheduleLayout);
    function refreshControls() {
        root.hidden = !supported;
        toggle.hidden = controller.options.enabled;
        panel.hidden = !controller.options.enabled;
        if (!supported || !controller.options.enabled) { layout.topInset = 0; cancelDrag(); }
        if (!controller.options.enabled) legend.hidden = true;
        scheduleLayout();
    }
    refreshControls();

    function closeEditor() { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } editorIdentity = null; }
    function openEditor() {
        if (dialog) return;
        editorIdentity = controller.songIdentity;
        dialog = element('dialog', 'hg-editor');
        dialog.setAttribute('aria-label', 'Edit song harmony');
        const content = element('form', 'hg-editor-content'); content.method = 'dialog';
        const errors = element('p', 'hg-error'); errors.setAttribute('role', 'alert');
        const heading = element('div', 'hg-editor-heading');
        heading.append(element('h2', '', 'Song harmony'), button('Close', closeEditor));
        content.append(heading, element('p', 'hg-help',
            'Times use seconds or m:ss. An optional end marks where evidence stops; otherwise a row continues until the next. Use “A note” for a root-only target, ? for unknown, or N.C. for no chord. Only changed tracks are saved locally for this version of the song.'));
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
        const keyRows = [], chordRows = [], scaleRows = [];
        const keysPanel = element('section'), chordsPanel = element('section'), scalesPanel = element('section');
        keysPanel.append(element('h3', '', 'Key & scale regions'));
        chordsPanel.append(element('h3', '', 'Chord progression'));
        scalesPanel.append(element('h3', '', 'Independent scale regions'));
        const keysList = element('div', 'hg-rows'), chordsList = element('div', 'hg-rows');
        const scalesList = element('div', 'hg-rows'); scalesPanel.append(scalesList);
        keysPanel.append(keysList); chordsPanel.append(chordsList);
        function makeRow(kind, event) {
            const list = kind === 'key' ? keyRows : kind === 'scale' ? scaleRows : chordRows;
            if (list.length >= 500) { errors.textContent = 'Use at most 500 rows per track.'; return; }
            const node = element('div', `hg-edit-row hg-edit-row--${kind}`);
            const time = element('input'); time.value = formatGuideTime(event.t || 0);
            time.setAttribute('aria-label', `${kind} start time`); time.placeholder = '0:00'; time.inputMode = 'decimal';
            const end = element('input'); end.value = Number.isFinite(event.end) ? formatGuideTime(event.end) : '';
            end.setAttribute('aria-label', `${kind} end time`); end.placeholder = 'End'; end.inputMode = 'decimal';
            const value = element('input'); value.value = event.unknown ? '?' : kind === 'key' ? event.key || ''
                : kind === 'scale' ? event.root || '' : guideChordText(event);
            value.setAttribute('aria-label', kind === 'key' ? 'Musical key' : kind === 'scale' ? 'Scale root' : 'Chord');
            value.placeholder = kind === 'key' ? 'Am' : kind === 'scale' ? 'A / ?' : 'Am / F / C/E';
            node.append(time, end, value);
            let select = null;
            if (kind !== 'chord') {
                select = element('select'); select.setAttribute('aria-label', kind === 'key' ? 'Suggested scale' : 'Independent scale');
                for (const [id, name] of SCALES) { const option = element('option', '', name); option.value = id; select.append(option); }
                if (event.scale && !SCALES.some(([id]) => id === event.scale)) {
                    const option = element('option', '', event.scale); option.value = event.scale; select.append(option);
                }
                select.value = kind === 'key' ? event.scale || '' : event.type || ''; node.append(select);
            }
            const row = { node, time, end, value, select, original: event,
                source: data.sources?.[kind === 'key' ? 'keys' : kind === 'scale' ? 'scales' : 'harmony'] };
            const remove = button('×', () => { node.remove(); list.splice(list.indexOf(row), 1); }, 'hg-row-remove');
            remove.setAttribute('aria-label', `Remove ${kind} row`); node.append(remove); list.push(row);
            (kind === 'key' ? keysList : kind === 'scale' ? scalesList : chordsList).append(node);
        }
        const data = controller.getData();
        for (const event of data.keys) makeRow('key', event);
        for (const event of data.harmony) makeRow('chord', event);
        for (const event of data.scales || []) makeRow('scale', event);
        const readRows = () => ({
            keys: keyRows.map(row => ({ time: row.time.value, end: row.end.value, key: row.value.value, scale: row.select.value })),
            harmony: chordRows.map(row => ({ time: row.time.value, end: row.end.value, chord: row.value.value,
                original: row.original, source: row.source })),
            scales: scaleRows.map(row => ({ time: row.time.value, end: row.end.value, root: row.value.value, type: row.select.value })),
        });
        const initialRows = readRows();
        keysPanel.append(button('+ Key change', () => makeRow('key', { t: 0, key: '', scale: '' })));
        chordsPanel.append(button('+ Chord change', () => makeRow('chord', { t: 0, root: 'C', quality: 'maj' })));
        scalesPanel.append(button('+ Scale change', () => makeRow('scale', { t: 0, root: 'A', type: 'natural_minor' })));
        columns.append(keysPanel, chordsPanel, scalesPanel); content.append(columns);
        content.append(errors);
        if (!controller.canSave) errors.textContent = 'Song identity is unavailable. Reload the song before saving corrections.';
        const actions = element('div', 'hg-editor-actions');
        if (controller.hasOverride) actions.append(button('Use song annotations and analysis', () => {
            try { controller.clearOverride(); closeEditor(); } catch (error) { errors.textContent = error.message; }
        }));
        actions.append(button('Cancel', closeEditor));
        const saveButton = button('Save locally', () => {
            if (editorIdentity !== controller.songIdentity) { closeEditor(); return; }
            const rows = readRows();
            const changed = Object.keys(rows).filter(name => JSON.stringify(rows[name]) !== JSON.stringify(initialRows[name]));
            if (!changed.length) { closeEditor(); return; }
            const result = validateGuideRows(rows.keys, rows.harmony, controller.songEnd,
                rows.scales.length || changed.includes('scales') ? rows.scales : null);
            if (result.errors.length) { errors.textContent = result.errors.join(' '); return; }
            const patch = Object.fromEntries(changed.map(name => [name, result[name] || []]));
            try { controller.saveOverride(patch); closeEditor(); } catch (error) { errors.textContent = error.message; }
        }, 'hg-button hg-button--primary');
        saveButton.disabled = !controller.canSave || data.keys.length > 500 || data.harmony.length > 500 || data.scales?.length > 500;
        actions.append(saveButton); content.append(actions);
        content.addEventListener('submit', event => event.preventDefault());
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
        dialog.append(content); container.append(dialog); dialog.showModal();
    }
    return {
        getLayout() { return layout; },
        setCanvas(value) {
            if (canvas === value) return;
            if (canvas && canvas !== container) observer?.unobserve(canvas);
            canvas = value;
            if (canvas) observer?.observe(canvas);
            scheduleLayout();
        },
        setSupported(value) {
            if (supported === !!value) return;
            supported = !!value; if (!supported) closeEditor(); refreshControls();
        },
        update(guide) {
            if (dialog && editorIdentity !== controller.songIdentity) closeEditor();
            if (lastGeneration !== controller.generation) { lastGeneration = controller.generation; refreshControls(); }
            if (!supported) return;
            if (!guide.state) {
                setText(key, 'Song harmony'); setText(scale, 'Waiting for song data');
                setText(chord, '—'); setText(target, ''); target.hidden = true;
                setText(nextLabel, 'UP NEXT');
                for (const node of upcoming) node.hidden = true;
                setText(provenance, ''); setText(status, ''); legend.hidden = true; retry.hidden = true;
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
            setText(currentLabel, guideTargetPresentation(state.current).heading);
            for (let i = 0; i < upcoming.length; i++) {
                const event = state.upcoming?.[i]; upcoming[i].hidden = !event;
                if (event) setText(upcoming[i], guideTargetPresentation(event).upcoming);
            }
            setText(nextLabel, state.upcoming?.length ? `UP NEXT · ${countdown(guide.nextBeats, guide.nextSeconds)}` : 'NO UPCOMING CHANGE');
            const hasData = !!state.key || !!state.scale || !!(state.current && state.current.status !== 'unknown');
            const sources = new Set(Object.values(state.source || {}).filter(Boolean));
            if (state.current?.estimated_from_charts) sources.add('charts');
            setText(provenance, [sources.has('local') && 'Your local guide', sources.has('feedpak') && 'Feedpak annotations',
                sources.has('charts') && 'From charts'].filter(Boolean).join(' · ') || 'Song harmony');
            const analysis = controller.analysis || { status: 'idle' };
            retry.hidden = !['failed', 'cancelled'].includes(analysis.status);
            let message = ['queued', 'running'].includes(analysis.status) ? 'Analysing charts…'
                : analysis.status === 'failed' ? 'Analysis unavailable · Try again'
                    : analysis.status === 'cancelled' ? 'Analysis cancelled'
                        : analysis.status === 'unavailable' ? 'Charts do not provide enough evidence'
                            : analysis.status === 'partial' && (!state.key || !state.scale || !state.current?.root) ? 'Partial guidance · Limited chart evidence'
                                : !hasData ? 'Harmony unavailable for this passage' : '';
            retry.title = analysis.error || '';
            if (guide.rest?.active && guide.alpha > 0 && !['queued', 'running', 'failed', 'cancelled'].includes(analysis.status)) {
                const remaining = countdown(guide.rest.reentryInBeats, guide.rest.reentryInSeconds);
                message = remaining ? `Room to improvise · Chart resumes ${remaining}` : 'Room to improvise';
            } else if (state.scaleStatus === 'conflict') message = 'Review the scale and chord in Edit';
            setText(status, message);
            legend.hidden = !(guide.alpha > 0 && state.scale);
        },
        destroy() {
            destroyed = true; cancelDrag(); layout.topInset = 0;
            observer?.disconnect();
            if (layoutFrame != null) cancelAnimationFrame(layoutFrame);
            window.removeEventListener('resize', scheduleLayout);
            document.removeEventListener('fullscreenchange', scheduleLayout);
            closeEditor(); root.remove();
        },
    };
}
