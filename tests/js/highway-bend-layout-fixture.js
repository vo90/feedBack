const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/highway_3d/screen.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function* hwyBuildBendLayout(');
if (start < 0) throw new Error('Missing production bend layout solver');
const open = source.indexOf('{\n', start);
let depth = 1, end = open + 1;
while (depth && ++end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
}
const build = new Function(`${source.slice(start, end + 1)}; return hwyBuildBendLayout;`)();
const directionSource = source.match(/function hwyBendLayoutDirection\(group\) \{[\s\S]*?\n        \}/)?.[0];
if (!directionSource) throw new Error('Missing production bend layout direction helper');
const direction = new Function(`${directionSource}; return hwyBendLayoutDirection;`)();
const copySource = source.match(/function copyBendLayout\(target, source\) \{[\s\S]*?\n        \}/)?.[0];
if (!copySource) throw new Error('Missing production bend layout copy helper');
const copyState = `
    const _bendLayout={byNote:new WeakMap()}, _bendLayoutSources=new WeakMap();
    ${copySource}
`;
function solve(notes, chords = [], count = 6, options = {}) {
    const generator = build(notes, chords, count, options);
    let step;
    do { step = generator.next(); } while (!step.done);
    return step.value;
}
// Renderer extraction tests exercise the real direction lookup with prepared
// single-note layouts by default; linked/chord tests can install a whole plan.
const rendererState = `
    ${directionSource}
    let _bendLayout = {byNote:new WeakMap()};
    const _bendLayoutForceNeutral=false, _bendLayoutJob=null;
    const _bendLayoutSources=new WeakMap();
    function prepareBendLayout(n) {
        if (!n || _bendLayout.byNote.has(n)) return;
        const plan=solveBendLayout([n],[],nStr,{starts:_linkedBendStarts,ends:_linkedBendEnds});
        const entry=plan.byNote.get(n);
        if(entry) _bendLayout.byNote.set(n,entry);
    }
`;
const rendererLookup = `
    const resolvedBendVisualDirY=bendVisualDirY;
    bendVisualDirY=(s,n)=>{prepareBendLayout(n);return resolvedBendVisualDirY(s,n);};
`;
module.exports = { build, solve, direction, rendererState, rendererLookup, directionSource, copyState };
