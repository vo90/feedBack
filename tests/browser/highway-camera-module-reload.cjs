#!/usr/bin/env node
'use strict';

// Isolated loader contract: real Chromium evaluates the production classic
// screen.js and its dynamic imports; mocked modules avoid WebGL/game startup.
// PLAYWRIGHT_MODULE may select an existing installation. No packages are installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'plugins/highway_3d/screen.js'), 'utf8');
const modules = ['camera-semantics.mjs', 'camera-motion.mjs', 'camera-controller.mjs'];
const exportsByModule = {
  'camera-semantics.mjs': ['hwyBuildCameraTimeline', 'hwyBuildCameraStops'],
  'camera-motion.mjs': ['hwyBuildCameraAttackIndex', 'hwyPrepareCameraStops', 'hwyBuildCameraMotion',
    'hwyCameraSegmentAt', 'hwyCameraPlanAt', 'hwyCameraJoinAt', 'hwyCameraResumeAt',
    'hwyCameraRejoin', 'hwyCameraZoom'],
};

function instrument(legacy) {
  const anchor = "            contextType: 'webgl2',\n            supportsHarmonicGuide: true,";
  let body = source.replace(/\r\n/g, '\n');
  assert.equal(body.split(anchor).length, 2, 'Renderer factory bridge anchor must be unique');
  body = body.replace(anchor, `${anchor}
            __loadCameraModules: loadThree,
            __cameraModuleSnapshot() {
                return [hwyBuildCameraTimeline(), hwyCameraPlanAt(), createCameraController()];
            },`);
  if (legacy) {
    const fixedImports = body.match(/import\(CAMERA_MODULE_BASE \+ 'camera-[^']+\.mjs'\)/g) || [];
    assert.equal(fixedImports.length, 3, 'Negative control must replace all three imports');
    body = body.replace(/import\(CAMERA_MODULE_BASE \+ '(camera-[^']+\.mjs)'\)/g,
      (_, name) => `import('/api/plugins/highway_3d/src/${name}')`);
  }
  return body;
}

function mockModule(name, revision) {
  const marker = JSON.stringify(`${name}@${revision}`);
  const count = `window.__moduleEvaluations.push(${marker});\n`;
  if (name === 'camera-controller.mjs') {
    return count + `export function createCameraController() { return ${marker}; }\n`;
  }
  const factory = name === 'camera-semantics.mjs' ? 'createCameraSemantics' : 'createCameraMotion';
  return count + `export function ${factory}() { return { ${
    exportsByModule[name].map(key => `${key}: () => ${marker}`).join(', ')
  } }; }\n`;
}

async function scenario(browser, legacy) {
  const page = await browser.newPage();
  const requests = [], pageErrors = [];
  let revision = 'one';
  page.on('pageerror', error => pageErrors.push(error.message));
  const script = instrument(legacy);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://camera-reload.test') {
      return route.fulfill({ status: 403, body: 'External network disabled' });
    }
    if (url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
    }
    if (url.pathname === '/screen.js') {
      return route.fulfill({ contentType: 'text/javascript', body: script });
    }
    const name = url.pathname.split('/').pop();
    if (modules.includes(name)) {
      assert.match(url.pathname, /^\/api\/plugins\/highway_3d\/(?:g\/camera-\d+\/)?src\//);
      requests.push({ pathname: url.pathname, revision });
      return route.fulfill({ contentType: 'text/javascript', body: mockModule(name, revision) });
    }
    // Non-camera imports are irrelevant to this dependency-loader contract.
    if (url.pathname.endsWith('.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: 'export const fixture = true;' });
    }
    return route.fulfill({ status: 404, body: 'Missing fixture route' });
  });
  try {
    await page.goto('http://camera-reload.test/');
    await page.evaluate(() => { window.__moduleEvaluations = []; });
    const evaluateScreen = query => page.addScriptTag({ url: `/screen.js?${query}` });
    const create = async key => page.evaluate(async key => {
      const renderer = window[key] = window.feedBackViz_highway_3d();
      await renderer.__loadCameraModules();
      return {
        generation: window.__h3dCameraModuleGeneration,
        modules: renderer.__cameraModuleSnapshot(),
        evaluations: window.__moduleEvaluations.length,
      };
    }, key);
    const expected = value => modules.map(name => `${name}@${value}`);
    const snapshots = [];

    await evaluateScreen('v=one');
    const initial = await create('firstRenderer');
    assert.deepEqual(initial.modules, expected('one'));
    assert.equal(initial.generation, 1);
    assert.equal(initial.evaluations, 3);
    snapshots.push(initial);

    revision = 'two';
    await page.evaluate(() => window.firstRenderer.destroy());
    const recreated = await create('recreatedRenderer');
    assert.deepEqual(recreated, initial, 'Renderer recreation must reuse the current module graph');
    assert.equal(requests.length, 3);
    snapshots.push(recreated);

    await evaluateScreen('v=two');
    const upgraded = await create('upgradedRenderer');
    assert.equal(upgraded.generation, 2);
    assert.deepEqual(upgraded.modules, expected(legacy ? 'one' : 'two'),
      'A new script evaluation must load current camera modules');
    assert.equal(upgraded.evaluations, legacy ? 3 : 6);
    assert.deepEqual(await page.evaluate(() => window.recreatedRenderer.__cameraModuleSnapshot()),
      expected('one'), 'The earlier renderer closure must keep its own initialized module functions');
    snapshots.push(upgraded);

    revision = 'one';
    await evaluateScreen('v=one');
    const rollback = await create('rollbackRenderer');
    assert.equal(rollback.generation, 3);
    assert.deepEqual(rollback.modules, expected('one'));
    assert.equal(rollback.evaluations, legacy ? 3 : 9,
      'A rollback must load a fresh graph even when its screen query was used before');
    snapshots.push(rollback);

    assert.deepEqual(pageErrors, []);
    if (!legacy) {
      for (let generation = 1; generation <= 3; generation++) {
        assert.equal(requests.filter(request =>
          request.pathname.startsWith(`/api/plugins/highway_3d/g/camera-${generation}/src/`)).length, 3);
      }
    } else {
      assert.equal(requests.length, 3, 'Negative control must demonstrate fixed-URL module reuse');
    }
    return { scenario: legacy ? 'fixed-url-negative-control' : 'production-generations', snapshots, requests };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  try {
    const results = [];
    results.push(await scenario(browser, false));
    results.push(await scenario(browser, true));
    process.stdout.write(JSON.stringify({ passed: true, results }, null, 2) + '\n');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
