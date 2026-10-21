import { defineConfig, devices } from '@playwright/test';

// Browser tests. tests/mocked: the API is faked with page.route, run in Chromium and
// WebKit (Safari's engine). tests/e2e: real backend, fresh database, Chromium only
// (the flows change the database, so they run once, in order).
const API_PORT = 8001; // not 8000, so a running dev backend does not interfere

export default defineConfig({
	testDir: 'tests',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'https://localhost:4173',
		ignoreHTTPSErrors: true, // self-signed certificate of the preview server
		trace: 'retain-on-failure'
	},
	projects: [
		{ name: 'chromium', testDir: 'tests/mocked', use: devices['Desktop Chrome'] },
		{ name: 'webkit', testDir: 'tests/mocked', use: devices['Desktop Safari'] },
		{ name: 'e2e', testDir: 'tests/e2e', use: devices['Desktop Chrome'], fullyParallel: false }
	],
	webServer: [
		{
			// Built app over https, /api proxied to the test backend.
			command: 'npm run build && npm run preview -- --port 4173 --strictPort',
			url: 'https://localhost:4173',
			ignoreHTTPSErrors: true,
			env: { API_URL: `http://localhost:${API_PORT}` },
			reuseExistingServer: !process.env.CI,
			timeout: 120_000
		},
		{
			command: `sh tests/e2e/backend.sh ${API_PORT}`,
			url: `http://localhost:${API_PORT}/health`,
			reuseExistingServer: false // always a fresh database
		}
	]
});
