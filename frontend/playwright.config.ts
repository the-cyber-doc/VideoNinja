import { defineConfig, devices } from '@playwright/test';

// Browser tests. tests/mocked: the API is faked with page.route, run in Chromium and
// WebKit (Safari's engine), service worker blocked (page.route does not see its
// requests). tests/pwa: the service worker itself (install, offline, caches), API
// faked with context.route, Chromium. tests/e2e: real backend, fresh database,
// Chromium only (the flows change the database, so they run once, in order).
const API_PORT = 8001; // not 8000, so a running dev backend does not interfere
// Not 4173 (`npm run preview`'s default): a preview started by hand would be taken
// for the test build, with an old build and /api going to the dev backend.
const APP_PORT = 4183;
// The same app built under a base path (as served at https://example.org/videoninja/).
const SUBPATH_PORT = 4184;
const SUBPATH = '/videoninja';

export default defineConfig({
	testDir: 'tests',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `https://localhost:${APP_PORT}`,
		ignoreHTTPSErrors: true, // self-signed certificate of the preview server
		locale: 'en-US', // the UI follows the browser language: pin it (tests/mocked/i18n.spec.ts changes it)
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			testDir: 'tests/mocked',
			use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' }
		},
		{
			name: 'webkit',
			testDir: 'tests/mocked',
			use: { ...devices['Desktop Safari'], serviceWorkers: 'block' }
		},
		{
			name: 'pwa',
			testDir: 'tests/pwa',
			use: {
				...devices['Desktop Chrome'],
				// ignoreHTTPSErrors is not enough: Chrome refuses to register a service
				// worker served with a self-signed certificate without this flag.
				launchOptions: { args: ['--ignore-certificate-errors'] }
			}
		},
		{ name: 'e2e', testDir: 'tests/e2e', use: devices['Desktop Chrome'], fullyParallel: false },
		{
			// The service worker tests again, and the links and API paths, under a base path.
			name: 'subpath',
			testDir: 'tests',
			testMatch: ['pwa/**/*.spec.ts', 'subpath/**/*.spec.ts'],
			use: {
				...devices['Desktop Chrome'],
				baseURL: `https://localhost:${SUBPATH_PORT}${SUBPATH}/`,
				launchOptions: { args: ['--ignore-certificate-errors'] }
			}
		}
	],
	webServer: [
		{
			// Built app over https, /api proxied to the test backend.
			command: `npm run build && npm run preview -- --port ${APP_PORT} --strictPort`,
			url: `https://localhost:${APP_PORT}`,
			ignoreHTTPSErrors: true,
			env: { API_URL: `http://localhost:${API_PORT}` },
			reuseExistingServer: false, // always the current code
			timeout: 120_000
		},
		{
			command: `npm run build && npm run preview -- --port ${SUBPATH_PORT} --strictPort`,
			url: `https://localhost:${SUBPATH_PORT}${SUBPATH}/`,
			ignoreHTTPSErrors: true,
			env: { BASE_PATH: SUBPATH, BUILD_NAME: 'subpath', API_URL: `http://localhost:${API_PORT}` },
			reuseExistingServer: false,
			timeout: 120_000
		},
		{
			command: `sh tests/e2e/backend.sh ${API_PORT}`,
			url: `http://localhost:${API_PORT}/health`,
			reuseExistingServer: false // always a fresh database
		}
	]
});
