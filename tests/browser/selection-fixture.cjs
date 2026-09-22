// The same assertions run in standalone Chromium and the managed Electron build.
const cases = [
    'caret', 'forward range', 'backward range', 'multiple text nodes', 'element anchor',
    'hidden Settings tab', 'mouse navigation button', 'focused checkbox', 'focused radio',
    'focused range input', 'focused select', 'focused text input', 'focused textarea',
    'focused unrelated visible input', 'focused contenteditable', 'blurred contenteditable',
    'noneditable island', 'shadow DOM label', 'nested shadow DOM label', 'two outgoing screens',
    'outgoing and visible content', 'same-screen hidden panel', 'hidden popup outside screens',
    'late selection after cleanup', 'removed subtree',
    'visible range', 'opacity', 'aria-hidden', 'offscreen', 'visibility override',
    'visibility hidden', 'content visibility', 'slotted label', 'closed shadow input',
    'observer panel', 'observer removal', 'late microtask', 'late task', 'late frame',
    'replaced editor', 'new pointer intent', 'backward editor', 'no idle work', '100 cycles',
    'closed details', 'visible summary', '100 mounts', 'nested shadow textarea',
    'unassigned light text', 'slot reassignment', 'slot fallback', 'empty selection fast path',
    'cached empty visibility', 'new selection before start event',
];

async function runCase(name) {
    window.__selectionService?.dispose();
    document.body.innerHTML = `<style>.screen{display:none}.screen.active{display:block}.hide{display:none}</style>
        <section id="settings" class="screen active"><div id="panel"><span id="label">Note-gem stems</span><span id="second">Other label</span></div></section>
        <section id="other" class="screen active"><span id="otherText">Other screen text</span></section>
        <section id="player" class="screen"><span>Player</span></section>
        <aside id="persistent">Visible outside screen</aside><button id="navigate">Play</button>`;
    const $ = id => document.getElementById(id);
    const settings = $('settings'), player = $('player'), panel = $('panel');
    const sel = getSelection();
    sel.removeAllRanges();
    const service = window.__selectionService = window.__selectionModule.selectionLifecycle(document);
    const records = [];
    service.setDiagnosticListener?.(r => records.push(r));
    const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const equal = (a, b, message) => {
        if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(name + ': ' + message + ' ' + JSON.stringify({ actual: a, expected: b }));
    };
    let field = null, root = $('label'), anchor = root.firstChild, focus = anchor, a = 4, b = 5;
    let release = null;
    const select = () => sel.setBaseAndExtent(anchor, a, focus, b);
    const navigate = () => {
        service.prepareToHide(settings); service.prepareToHide($('other'));
        settings.classList.remove('active'); $('other').classList.remove('active'); player.classList.add('active');
        service.finishVisibilityChange();
    };
    if (name === 'caret') b = a;
    if (name === 'backward range') [a, b] = [5, 4];
    if (name === 'multiple text nodes') { focus = $('second').firstChild; b = 5; }
    if (name === 'element anchor') { anchor = focus = panel; a = 0; b = 1; }
    if (name === 'hidden Settings tab') panel.classList.add('hide');
    if (name.startsWith('focused ') || ['closed shadow input', 'nested shadow textarea', 'backward editor', 'replaced editor', 'new pointer intent'].includes(name)) {
        const type = name === 'closed shadow input' ? 'text input'
            : name === 'nested shadow textarea' ? 'textarea'
            : ['backward editor', 'replaced editor', 'new pointer intent'].includes(name) ? 'contenteditable' : name.slice(8);
        field = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : type === 'contenteditable' ? 'div' : 'input');
        if (type === 'contenteditable') { field.contentEditable = 'true'; field.textContent = 'editable value'; anchor = focus = field.firstChild; a = 2; b = 6; }
        else if (type === 'select') field.innerHTML = '<option>One</option><option>Two</option>';
        else { field.type = ['radio', 'checkbox'].includes(type) ? type : type === 'range input' ? 'range' : 'text'; field.value = 'abcdef'; }
        let parent = name === 'focused unrelated visible input' ? $('persistent') : settings;
        if (name === 'closed shadow input') {
            const host = document.createElement('div'); parent.append(host);
            parent = host.attachShadow({ mode: 'closed' }); release = service.registerShadowRoot(parent);
        }
        if (name === 'nested shadow textarea') for (let i = 0; i < 2; i++) {
            const host = document.createElement('div'); parent.append(host); parent = host.attachShadow({mode:'open'});
        }
        parent.append(field); field.focus();
        if (name === 'backward editor') [a, b] = [6, 2];
    }
    if (['blurred contenteditable', 'noneditable island'].includes(name)) {
        field = document.createElement('div'); field.contentEditable = 'true';
        field.innerHTML = name === 'noneditable island' ? '<span contenteditable="false">Noneditable text</span>' : 'editable value';
        settings.append(field); anchor = focus = name === 'noneditable island' ? field.firstChild.firstChild : field.firstChild; a = 2; b = 6;
    }
    if (['shadow DOM label', 'nested shadow DOM label', 'slotted label'].includes(name)) {
        let parent = settings;
        for (let i = 0; i < (name === 'nested shadow DOM label' ? 2 : 1); i++) {
            const host = document.createElement('div'); parent.append(host);
            parent = host.attachShadow({ mode: 'open' });
            if (name === 'slotted label') { parent.innerHTML = '<div id="slotparent"><slot></slot></div>'; host.append(root); }
        }
        if (name !== 'slotted label') { root = document.createElement('span'); root.textContent = 'Shadow label'; parent.append(root); anchor = focus = root.firstChild; }
    }
    if (name === 'two outgoing screens') { focus = $('otherText').firstChild; b = 5; }
    if (name === 'outgoing and visible content') { focus = $('persistent').firstChild; b = 5; }
    if (name === 'hidden popup outside screens') { root = document.createElement('div'); root.textContent = 'Popup label'; document.body.append(root); anchor = focus = root.firstChild; a = 2; b = 6; }
    if (name === 'unassigned light text' || name === 'slot reassignment') {
        const host = document.createElement('div'); settings.append(host);
        const shadow = host.attachShadow({mode:'open'});
        shadow.innerHTML = '<slot name="label"></slot>';
        root = document.createElement('span'); root.textContent = 'Slotted text';
        root.slot = name === 'slot reassignment' ? 'label' : 'unmatched'; host.append(root);
        anchor = focus = root.firstChild;
    }
    if (name === 'slot fallback') {
        const host = document.createElement('div'); settings.append(host);
        const shadow = host.attachShadow({mode:'open'});
        shadow.innerHTML = '<slot><span>Fallback text</span></slot>';
        root = shadow.querySelector('span'); anchor = focus = root.firstChild;
    }
    if (name === 'closed details' || name === 'visible summary') {
        root = document.createElement('details'); root.open = true;
        root.innerHTML = '<summary>Visible summary</summary><span>Hidden details</span>'; settings.append(root);
        anchor = focus = root.children[name === 'visible summary' ? 0 : 1].firstChild;
    }
    if (['focused text input', 'focused textarea', 'closed shadow input', 'nested shadow textarea'].includes(name)) field.setSelectionRange(2, 4, 'backward');
    else select();
    if (name === 'blurred contenteditable') { field.blur(); $('navigate').focus(); }
    if (name === 'mouse navigation button') $('navigate').focus();
    const savedField = field?.selectionStart == null ? null : [field.selectionStart, field.selectionEnd, field.selectionDirection, field.value];
    const controlValue = field && !field.isContentEditable ? [field.value, field.checked, field.selectedIndex] : null;
    const shape = () => [sel.anchorNode === anchor, sel.anchorOffset, sel.focusNode === focus, sel.focusOffset];
    const savedShape = shape();
    const visible = ['visible range', 'opacity', 'aria-hidden', 'offscreen', 'visibility override', 'visible summary'].includes(name);
    if (visible) {
        if (name === 'opacity') panel.style.opacity = 0;
        if (name === 'aria-hidden') panel.setAttribute('aria-hidden', 'true');
        if (name === 'offscreen') panel.style.transform = 'translateY(-2000px)';
        if (name === 'visibility override') { panel.style.visibility = 'hidden'; root.style.visibility = 'visible'; }
        if (name === 'visible summary') root.open = false;
        service.reconcileBeforePlayback(); await settle(); equal(shape(), savedShape, 'visible selection preserved');
    } else if (name === 'cached empty visibility') {
        sel.removeAllRanges(); await settle();
        let reads = 0;
        const original = document.getSelection;
        document.getSelection = function () { reads++; return original.call(this); };
        try {
            for (let i = 0; i < 20; i++) service.finishVisibilityChange();
            equal(reads, 0, 'known-empty visibility checks do not flush Chromium selection layout');
        } finally { document.getSelection = original; }
        select(); panel.hidden = true;
        await settle(); equal(sel.rangeCount, 0, 'native selectionchange still reconciles late selection');
    } else if (name === 'new selection before start event') {
        sel.removeAllRanges(); await settle();
        // The queued selectionchange has not run yet. Start must read current
        // state instead of trusting the prior empty-selection result.
        select(); panel.hidden = true;
        service.reconcileBeforePlayback();
        equal(sel.rangeCount, 0, 'playback boundary clears before selectionchange');
    } else if (name === 'empty selection fast path') {
        sel.removeAllRanges(); await settle();
        let focusReads = 0, styleReads = 0, endpointReads = 0;
        const active = document.activeElement, getStyle = window.getComputedStyle;
        Object.defineProperty(document, 'activeElement', {configurable:true, get() { focusReads++; return active; }});
        window.getComputedStyle = (...args) => { styleReads++; return getStyle(...args); };
        for (const key of ['anchorNode', 'focusNode']) Object.defineProperty(sel, key, {
            configurable:true, get() { endpointReads++; return null; },
        });
        try {
            service.finishVisibilityChange(); service.reconcileBeforePlayback();
            equal([focusReads, styleReads, endpointReads], [0, 0, 0], 'empty selection avoids endpoint/editor traversal');
            service.prepareToHide(panel);
            equal(endpointReads, 0, 'hiding with no selection does not read endpoints');
        } finally {
            delete document.activeElement; window.getComputedStyle = getStyle;
            delete sel.anchorNode; delete sel.focusNode;
        }
    } else if (name === 'no idle work') {
        sel.removeAllRanges(); await settle(); records.length = 0;
        for (let i = 0; i < 20; i++) { root.textContent = String(i); await settle(); }
        equal(records.length, 0, 'no selection means no observer or frame work');
    } else if (name === '100 mounts') {
        sel.removeAllRanges();
        for (let i = 0; i < 100; i++) {
            const host = document.createElement('div'); settings.append(host);
            const shadow = host.attachShadow({mode:'closed'}), unregister = service.registerShadowRoot(shadow);
            const input = document.createElement('input'); input.value = 'mount'; shadow.append(input); input.focus(); input.setSelectionRange(2,2);
            service.prepareToHide(host); host.remove(); unregister(); service.finishVisibilityChange();
            await settle();
            equal(records.at(-1).registeredRoots, 0, 'shadow registration released');
            // Removing an input may normalize the native caret to its visible
            // parent. Such a live selection should still be observed.
            equal(sel.anchorNode?.isConnected ?? true, true, 'no detached endpoint');
            sel.removeAllRanges(); service.finishVisibilityChange();
            equal(records.at(-1).watchedNodes, 0, 'all ancestry released once selection is empty');
        }
    } else if (name === '100 cycles') {
        for (let i = 0; i < 100; i++) {
            panel.classList.remove('hide'); select(); service.prepareToHide(panel); panel.classList.add('hide'); service.finishVisibilityChange();
            await settle(); equal(sel.rangeCount, 0, 'cycle selection released');
        }
        equal(records.at(-1).watchedNodes, 0, 'watchers released');
    } else {
        if (name === 'slot fallback') { await settle(); root.getRootNode().host.append(document.createTextNode('Assigned text')); }
        else if (name === 'slot reassignment') { await settle(); root.assignedSlot.name = 'different'; }
        else if (name === 'unassigned light text') service.finishVisibilityChange();
        else if (name === 'closed details') { await settle(); root.open = false; }
        else if (name === 'visibility hidden') { panel.style.visibility = 'hidden'; service.finishVisibilityChange(); }
        else if (name === 'content visibility') { panel.style.contentVisibility = 'hidden'; service.finishVisibilityChange(); }
        else if (name === 'same-screen hidden panel') { service.prepareToHide(panel); panel.classList.add('hide'); service.finishVisibilityChange(); }
        else if (name === 'hidden popup outside screens') { service.prepareToHide(root); root.classList.add('hide'); service.finishVisibilityChange(); }
        else if (name === 'observer panel') { await settle(); panel.classList.add('hide'); }
        else if (name === 'observer removal') { await settle(); panel.remove(); }
        else if (name === 'removed subtree') { panel.remove(); navigate(); }
        else navigate();
        if (name === 'late selection after cleanup') select();
        if (name === 'late microtask') await new Promise(r => queueMicrotask(() => { select(); r(); }));
        if (name === 'late task') await new Promise(r => setTimeout(() => { select(); r(); }, 0));
        if (name === 'late frame') await new Promise(r => requestAnimationFrame(() => { select(); r(); }));
        await settle();
        // A visible browser-normalized caret after removal is harmless. Otherwise
        // all outgoing native ranges must be gone, regardless of focused control.
        const removed = ['removed subtree', 'observer removal'].includes(name);
        if (!removed && name !== 'focused unrelated visible input') equal(sel.rangeCount, 0, 'hidden selection released');
        for (const node of [sel.anchorNode, sel.focusNode]) {
            if (!node) continue;
            equal(node.isConnected, true, 'live endpoint stays connected');
            for (let n = node; n; n = n.assignedSlot || n.parentNode || n.host) {
                if (n.nodeType === 1) equal(getComputedStyle(n).display === 'none', false, 'no retained hidden endpoint');
            }
        }
        if (savedField) equal([field.selectionStart, field.selectionEnd, field.selectionDirection, field.value], savedField, 'field offsets and value');
        if (controlValue) equal([field.value, field.checked, field.selectedIndex], controlValue, 'control state unchanged');
        if (field?.isContentEditable && name !== 'noneditable island') {
            if (name === 'replaced editor') field.innerHTML = '<b>replacement</b>';
            settings.classList.add('active'); service.finishVisibilityChange();
            if (name === 'new pointer intent') field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            field.focus(); await settle();
            if (name === 'replaced editor') equal(sel.anchorNode !== anchor, true, 'no stale replacement bookmark');
            else if (name === 'new pointer intent') equal(JSON.stringify(shape()) === JSON.stringify(savedShape), false, 'pointer owns insertion position');
            else equal(shape(), savedShape, 'editor bookmark direction restored');
        }
    }
    release?.();
    const result = { name, checks: 'passed', records: records.length,
        maxMilliseconds: Math.max(0, ...records.map(r => r.milliseconds)) };
    service.dispose();
    return result;
}

module.exports = { cases, runCase };
