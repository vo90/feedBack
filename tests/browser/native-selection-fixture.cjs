// Real mouse input is required: setBaseAndExtent does not reproduce Chromium's
// rescoping of native shadow selections to the visible host's parent.
const nativeCases = ['open', 'closed', 'nested'].flatMap(mode =>
    ['label', 'input', 'contenteditable'].flatMap(kind =>
        ['explicit', 'observer'].map(boundary => ({ mode, kind, boundary }))));

function setupNativeSelection({ mode, kind, boundary }) {
    window.__selectionService?.dispose();
    document.body.innerHTML = '<div id="host"></div><button>Outside</button>';
    const service = window.__selectionService = window.__selectionModule.selectionLifecycle();
    let root = document.getElementById('host').attachShadow({ mode: mode === 'closed' ? 'closed' : 'open' });
    const release = mode === 'closed' ? service.registerShadowRoot(root) : () => {};
    const roots = [root];
    if (mode === 'nested') {
        root.innerHTML = '<div id="inner"></div>';
        root = root.getElementById('inner').attachShadow({ mode: 'open' });
        roots.push(root);
    }
    root.innerHTML = '<section id="panel">' + (kind === 'input' ? '<input value="abcdef">'
        : kind === 'contenteditable' ? '<div contenteditable="true">abcdef</div>' : '<span>abcdef</span>') + '</section>';
    const panel = root.getElementById('panel'), field = panel.firstElementChild;
    field.style.cssText = 'font:24px monospace;display:inline-block;margin:30px';
    window.__nativeSelection = { service, root, roots, panel, field, release, kind, boundary };
    return field.getBoundingClientRect().toJSON();
}

async function verifyNativeSelection() {
    const { service, root, roots, panel, field, release, kind, boundary } = window.__nativeSelection;
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    const shape = () => {
        const s = getSelection(), r = s.getComposedRanges({ shadowRoots: roots })[0];
        return { direction: s.direction, start: r?.startOffset, end: r?.endOffset,
            inside: !!r && (panel.contains(r.startContainer) || panel.contains(r.endContainer)),
            field: [field.selectionStart, field.selectionEnd, field.selectionDirection] };
    };
    // Allow the native selectionchange to establish the ancestry observer.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = shape();
    assert(before.inside, 'mouse drag must create a real selection inside the shadow panel');
    assert(kind === 'input' ? before.field[2] === 'backward' : before.direction === 'backward', 'backward mouse selection');
    if (boundary === 'explicit') service.prepareToHide(panel);
    panel.hidden = true;
    if (boundary === 'explicit') service.finishVisibilityChange();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    assert(getSelection().rangeCount === 0, 'hidden native shadow selection must be released');
    if (kind !== 'label') assert(root.activeElement !== field, 'hidden editor must blur');
    if (kind === 'input') assert(JSON.stringify(shape().field) === JSON.stringify(before.field), 'input offsets and direction survive hiding');
    panel.hidden = false;
    if (kind !== 'label') {
        field.focus();
        const returned = shape();
        if (kind === 'contenteditable') assert(returned.inside && returned.direction === before.direction &&
            returned.start === before.start && returned.end === before.end, 'contenteditable bookmark restores the actual shadow endpoints: ' + JSON.stringify({ before, returned }));
        else assert(JSON.stringify(returned.field) === JSON.stringify(before.field), 'input caret survives return');
    }
    release();
    service.dispose();
    return { passed: true, kind, boundary, before };
}

module.exports = { nativeCases, setupNativeSelection, verifyNativeSelection };
