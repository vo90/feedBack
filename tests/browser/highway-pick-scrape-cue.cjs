#!/usr/bin/env node
'use strict';
// Actual WebGL renderer acceptance with in-memory probes; no app/profile/library writes.
// --out <fresh-directory> [--source-ref <revision> --reference]
// PLAYWRIGHT_MODULE may select an existing prepared Playwright installation.
// PLAYWRIGHT_EXECUTABLE_PATH may select its already installed browser binary.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const args = process.argv.slice(2), option = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const repo = path.resolve(__dirname, '../..'), out = path.resolve(option('--out', path.join(repo, 'test-results/scrape-cue')));
const ref = option('--source-ref'), reference = args.includes('--reference');
const source = (ref ? cp.execFileSync('git', ['-C', repo, 'show', ref + ':plugins/highway_3d/screen.js'], {encoding: 'utf8', maxBuffer: 8e6}) : fs.readFileSync(path.join(repo, 'plugins/highway_3d/screen.js'), 'utf8')).replace(/\r\n/g, '\n');
const report = {sourceRef: ref || null, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), reference, rows: [], errors: [], failures: []};
const check = (condition, message) => {if (!condition) report.failures.push(message);};
function once(value, anchor, extra) {assert.equal(value.split(anchor).length, 2, 'Unique probe: ' + anchor); return value.replace(anchor, anchor + extra);}
let served = once(source, 'function flushNoteDraws() {', '\n if(Number.isFinite(window.__forcedCameraX))curX=window.__forcedCameraX;');
served = once(served, 'mark.position.set(sx, y, noteZ + K);', "\n window.__scrapeProbe?.push({kind:'mark',mesh:mark,n});");
const captionAnchor = served.includes('label.position.set(sx, y + NH * 2.0 * cueScale, noteZ + K);')
  ? 'label.position.set(sx, y + NH * 2.0 * cueScale, noteZ + K);'
  : 'label.position.set(sx, y + bendVisualDirY(s) * NH * 2.0 * cueScale, noteZ + K);';
served = once(served, captionAnchor, "\n window.__scrapeProbe?.push({kind:'caption',mesh:label,n});");
served = once(served, 'const body = pSusRibbon.get();', "\n if(isPickScrape(n))window.__scrapeProbe?.push({kind:'ribbon',mesh:body,n});");
served = once(served, 'const core = pNote.get();', "\n window.__scrapeProbe?.push({kind:'gem',mesh:core,n});");
served = once(served, 'function txtMat(text, col, wide, style) {', "\n if(text==='X'||(typeof text==='string'&&text.startsWith('PICK SCRAPE')))window.__scrapeTexts?.push({text,col});");
served = served.replace("contextType: 'webgl2',", `__scrapeAudit(){return {ren,cam,scene,curX,K,NW,TS,xFret,now:_frameNow,
 anchor(n){return typeof pickScrapeAnchorX==='function'?pickScrapeAnchorX(n):curX;},
 bounds(n){const b=[];trailYieldOpenTargetXBounds(n,b);return b;}};},contextType: 'webgl2',`);
const scrape = (s, f = 18, extra = {}) => ({t: 10, s, f, sus: 2, mt: true, sl: -1, slu: -1, pick_scrape_marks: [{direction: 'down', start: 0, end: 2}], ...extra});
const fixture = {notes: [scrape(1), scrape(2), {t: 12, s: 3, f: 14, sus: .5}], chords: [], anchors: [{time: 0, fret: 2, width: 4}, {time: 12, fret: 14, width: 4}]};
async function main() {
  assert.ok(!fs.existsSync(out), 'Use a fresh evidence directory'); fs.mkdirSync(out, {recursive: true});
  const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport: {width: 1600, height: 900}});
    page.on('pageerror', e => report.errors.push(e.stack));
    await page.addInitScript(() => {window.__wall = 1000; Object.defineProperty(performance, 'now', {value: () => window.__wall, configurable: true});});
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://scrape-cue.test') return route.fulfill({status: 403, body: 'External network blocked'});
      if (u.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;background:#101820}canvas{width:100vw;height:100vh;display:block}</style><canvas id="highway"></canvas><script src="/screen.js"></script>'});
      if (u.pathname === '/screen.js') return route.fulfill({contentType: 'text/javascript', body: served});
      const file = path.resolve(repo, '.' + decodeURIComponent(u.pathname));
      if (file.startsWith(repo + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({contentType: file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(file)});
      return route.fulfill({status: 404, body: 'Missing fixture asset'});
    });
    await page.goto('http://scrape-cue.test');
    await page.evaluate(async fixture => {
      for (const [k,v] of Object.entries({cameraMode: 'stable', notationStyle: 'rsplus', style: 'off', glow: 0, bloom: false, cinematic: false, chordDiagramVisible: false, projectionVisible: false})) localStorage.setItem('h3d_bg_' + k, String(v));
      window.makeBundle = chart => ({...chart, currentTime: 9, isPlaying: false, playbackRate: 1, chordTemplates: [], handShapes: [], beats: [], sections: [], lyrics: [], stringCount: 6, tuning: Array(6).fill(0), songInfo: {arrangement: 'Lead'}, lefty: false, inverted: false, renderScale: 1, bgReactive: false});
      window.bundle = makeBundle(fixture); window.r = feedBackViz_highway_3d(); r.init(document.getElementById('highway'), bundle); await r.readyPromise;
      const a = r.__scrapeAudit(); window.rawRender = a.ren.render.bind(a.ren); a.ren.render = () => {};
      window.step = (time, forced, draw = false) => {
        window.__forcedCameraX = forced; window.__scrapeProbe = []; window.__scrapeTexts = []; bundle.currentTime = time; window.__wall += 1000 / 60; r.draw(bundle);
        const a = r.__scrapeAudit();
        if (draw) rawRender(a.scene, a.cam);
        const objects = window.__scrapeProbe.map(({kind,mesh,n}) => {
          mesh.updateWorldMatrix(true, false);
          const row = {kind, s: n.s, f: n.f, t: n.t, x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, anchor: a.anchor(n), bounds: a.bounds(n)};
          if (kind === 'ribbon') {
            const p = mesh.geometry.attributes.position.array, count = mesh.geometry.userData.ribbonSlices;
            row.points = Array.from({length: count + 1}, (_, i) => ({x: (p[i * 12] + p[i * 12 + 3]) / 2, z: p[i * 12 + 2]}));
          }
          return row;
        });
        return {time, cameraX: a.curX, NW: a.NW, expected: (a.xFret(1) + a.xFret(5)) / 2, objects, texts:window.__scrapeTexts, glError: a.ren.getContext().getError()};
      };
    }, fixture);
    const rows = await page.evaluate(() => [step(9, -.8), step(9, .8), step(11.4, .4), step(8, -.4), step(9, .8)]);
    report.rows.push(...rows);
    const firstMark = row => row.objects.find(o => o.kind === 'mark');
    const delta = Math.abs(firstMark(rows[0]).x - firstMark(rows[1]).x);
    check(reference ? delta > 1 : delta < 1e-10, reference ? 'Baseline camera attachment not reproduced' : 'X moved when only camera position changed');
    if (!reference) {
      for (const row of rows) {
        const marks = row.objects.filter(o => o.kind === 'mark'), captions = row.objects.filter(o => o.kind === 'caption'), ribbons = row.objects.filter(o => o.kind === 'ribbon');
        check(marks.length === 2 && ribbons.length === 2 && captions.length === 1, 'Expected two strings/trails and one caption at ' + row.time);
        check(marks.every(o => Math.abs(o.x - row.expected) < 1e-10), 'Cue does not use onset lane at ' + row.time);
        check(captions[0]?.y > Math.max(...marks.map(o => o.y)), 'Caption must be above affected strings');
        for (const ribbon of ribbons) check(ribbon.points.every(p => Math.abs(p.x - ribbon.anchor) <= row.NW * .081), 'Ribbon left compact onset anchor');
        check(!row.glError, 'WebGL error');
        const colors = row.texts.filter(t => t.text === 'X').map(t => t.col);
        check(colors.length === 2 && colors[0] !== colors[1] && colors.every(c => c !== '#ffffff'), 'Scrape Xs lost their string colors');
        check(row.texts.some(t => t.text === 'PICK SCRAPE ↘'), 'Source down direction missing from rendered caption');
      }
      const a = rows[0].objects.find(o => o.kind === 'ribbon'), b = rows[1].objects.find(o => o.kind === 'ribbon');
      assert.deepEqual(a.points, b.points, 'Actual ribbon geometry must ignore camera X');
      assert.deepEqual(rows[1].objects.filter(o=>o.kind!=='gem'), rows[4].objects.filter(o=>o.kind!=='gem'), 'Scrape geometry differs after seeking and pool reuse');
      const variants = await page.evaluate(fixture => {
        const rows = [];
        for (const lefty of [false,true]) for (const inverted of [false,true]) for (const f of [0,18,34,127]) {
          bundle = makeBundle({...fixture, notes: fixture.notes.map(n => n.mt ? {...n, f} : n)}); bundle.lefty = lefty; bundle.inverted = inverted;
          rows.push({lefty,inverted,f,...step(9, .7)});
        }
        bundle = makeBundle({...fixture, notes: [], chords: [{t: 10, notes: fixture.notes.slice(0,2)}]}); rows.push({name: 'chord-members', ...step(9, .7)});
        bundle = makeBundle({...fixture, notes: [], chords: [{t: 10, notes: [...fixture.notes.slice(0,2),{t:10,s:4,f:5,sus:1}]}]}); rows.push({name: 'mixed-chord', ...step(9, .7)});
        bundle = makeBundle({...fixture, anchors: [], notes: fixture.notes.slice(0,2)}); rows.push({name: 'anchor-fallback', ...step(9, .7)});
        bundle = makeBundle({...fixture, notes: [fixture.notes[0], {...fixture.notes[1], sus: 1, pick_scrape_marks: [{direction:'down',start:0,end:1}]}]}); rows.push({name: 'different-duration', ...step(9, .7)});
        bundle = makeBundle(fixture); h3dBgSetCameraMode('lookahead'); rows.push({name: 'lookahead', ...step(9, .7)}); h3dBgSetCameraMode('stable');
        return rows;
      }, fixture);
      report.rows.push(...variants);
      for (const row of variants) {
        const marks = row.objects.filter(o => o.kind === 'mark'), captions = row.objects.filter(o => o.kind === 'caption');
        check(marks.length === 2, 'Missing strings for ' + JSON.stringify({name:row.name,lefty:row.lefty,inverted:row.inverted,f:row.f}));
        check(captions.length === (row.name === 'different-duration' ? 2 : 1), 'Incorrect caption grouping');
        if (row.name !== 'anchor-fallback') check(marks.every(o => Math.abs(o.x - row.expected) < 1e-10), 'Hidden fret/orientation/camera mode changed anchor');
        else check(marks.every(o => Number.isFinite(o.x) && Math.abs(o.x - .7) > .01), 'Fallback follows camera');
        check(captions.every(c => c.y > Math.max(...marks.filter(m => m.t === c.t && (row.name !== 'different-duration' || m.s === c.s)).map(m => m.y))), 'Variant caption below a member');
      }
      const mixed = variants.find(v=>v.name==='mixed-chord');
      check(mixed.objects.some(o=>o.kind==='gem'&&o.s===4&&o.f===5), 'Ordinary mixed-chord member disappeared');
      check(!mixed.objects.some(o=>o.kind==='gem'&&[1,2].includes(o.s)), 'Scrape became a fretted gem');
      const reversals = await page.evaluate(fixture => {
        bundle=makeBundle({...fixture,notes:fixture.notes.slice(0,2).map(n=>({...n,pick_scrape_marks:[{direction:'up',start:0,end:1},{direction:'down',start:1,end:2}]}))});
        return [step(10.9),step(11),step(10.9)];
      },fixture);
      report.rows.push(...reversals);
      for (let i=0;i<reversals.length;i++) check(reversals[i].texts.some(t=>t.text===(i===1?'PICK SCRAPE ↘':'PICK SCRAPE ↗')), 'Rendered caption reversal/seek mismatch');
      for (const inverted of [false,true]) {
        await page.evaluate(({fixture,inverted}) => {bundle = makeBundle(fixture);bundle.inverted = inverted;step(9.6, undefined, true);}, {fixture,inverted});
        await page.screenshot({path:path.join(out, inverted ? 'inverted.png' : 'normal.png')});
      }
    }
    check(report.errors.length === 0, 'Browser errors');
  } finally {await browser.close();fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));}
  console.log(JSON.stringify({reference, cases:report.rows.length, failures:report.failures, errors:report.errors}));
  if (report.failures.length || report.errors.length) process.exitCode = 1;
}
main().catch(e => {report.errors.push(e.stack);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
