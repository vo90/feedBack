// Isolated DOM/CSS tests: routes serve repository assets in memory, without a
// backend, library, saved settings, or the default Docker browser-test server.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    testMatch: 'loop-panel.spec.js',
    workers: 1,
    reporter: 'list',
    use: {
        browserName: 'chromium',
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        screenshot: 'only-on-failure',
    },
});
