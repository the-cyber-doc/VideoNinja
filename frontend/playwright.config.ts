import { defineConfig, devices } from '@playwright/test';

// Browser tests. tests/mocked: the API is faked with page.route, run in Chromium and
// WebKit (Safari's engine), service worker blocked (page.route does not see its
// requests). tests/pwa: the service worker itself (install, offline, caches), API
// faked with context.route, Chromium. tests/e2e: real backend, fresh database,
// Chromium only (the flows change the database, so they run once, in order:
// project e2e = account.spec.ts, then project options = the others).
const API_PORT = 8001; // not 8000, so a running dev backend does not interfere
// Not 4173 (`npm run preview`'s default): a preview started by hand would be taken
// for the test build, with an old build and /api going to the dev backend.
const APP_PORT = 4183;
// The same app built under a base path (as served at https://example.org/videoninja/).
const SUBPATH_PORT = 4184;
const SUBPATH = '/videoninja';
// The real containers instead (tools/test-e2e-stack.sh): their address, e.g.
// http://localhost:8080/videoninja/. Only the e2e tests, then tests/stack (an upload
// through tusd and the encoder, served by nginx); no server of our own.
const STACK = process.env.E2E_BASE_URL;
// tests/e2e: account.spec.ts first (it sets the instance up and leaves the admin's
// credentials in .e2e/admin.json), then the specs that log in with them.
const E2E_FIRST = 'account.spec.ts';
// tests/stack: the Videos page's filter and sort first (project "videos"), then the rest.
const STACK_VIDEOS = 'videos.spec.ts';
const STACK_PROJECTS = [
	{
		name: 'e2e',
		testDir: 'tests/e2e',
		testMatch: E2E_FIRST,
		use: { ...devices['Desktop Chrome'], baseURL: STACK },
		retries: 0
	},
	{
		name: 'options',
		testDir: 'tests/e2e',
		testIgnore: E2E_FIRST,
		use: { ...devices['Desktop Chrome'], baseURL: STACK },
		dependencies: ['e2e'],
		retries: 0
	},
	{
		// The Videos page's filter and sort, on videos of its own: before "stack", so they are
		// the only ones (and before its last tests use up the login budget).
		name: 'videos',
		testDir: 'tests/stack',
		testMatch: STACK_VIDEOS,
		use: { ...devices['Desktop Chrome'], baseURL: STACK },
		dependencies: ['e2e', 'options'],
		retries: 0
	},
	{
		name: 'stack',
		testDir: 'tests/stack',
		testIgnore: STACK_VIDEOS,
		use: { ...devices['Desktop Chrome'], baseURL: STACK },
		// The admin account the e2e tests created (.e2e/admin.json); after the Options tests,
		// whose logins its last tests would otherwise rate-limit.
		dependencies: ['e2e', 'options', 'videos'],
		retries: 0
	}
];

export default defineConfig({
	testDir: 'tests',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// CI: one test at a time, so a busy runner does not slow the tests down further.
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: `https://localhost:${APP_PORT}`,
		ignoreHTTPSErrors: true, // self-signed certificate of the preview server
		locale: 'en-US', // the UI follows the browser language: pin it (tests/mocked/i18n.spec.ts changes it)
		trace: 'retain-on-failure'
	},
	projects: STACK
		? STACK_PROJECTS
		: [
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
				{
					name: 'e2e',
					testDir: 'tests/e2e',
					testMatch: E2E_FIRST,
					use: devices['Desktop Chrome'],
					fullyParallel: false,
					// No retry: the first attempt already changed the database (a retried setup
					// finds it done and fails at /setup, hiding the real error).
					retries: 0
				},
				{
					// The other specs of tests/e2e (the Options page), on the database e2e set up.
					name: 'options',
					testDir: 'tests/e2e',
					testIgnore: E2E_FIRST,
					use: devices['Desktop Chrome'],
					dependencies: ['e2e'],
					retries: 0
				},
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
	webServer: STACK
		? undefined
		: [
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
