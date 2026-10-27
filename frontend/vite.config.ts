import adapter from '@sveltejs/adapter-static';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { execSync } from 'node:child_process';

// Where the browser sees the app: '' (the domain's root, default) or e.g.
// '/videoninja' (a subfolder; the Docker image's build argument). Build time only.
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');
if (!/^(\/[\w.~-]+)*$/.test(BASE_PATH)) throw new Error(`BASE_PATH must look like /videoninja, not ${BASE_PATH}`);
// BUILD_NAME: a second build next to the usual one (the browser tests build the app
// twice, at the root and under a base path): build-<name>/, .svelte-kit-<name>/.
const suffix = process.env.BUILD_NAME ? `-${process.env.BUILD_NAME}` : '';
// /api and /media reach the backend without the base path (as nginx forwards them).
const toBackend = (target: string) => ({ target, rewrite: (path: string) => path.slice(BASE_PATH.length) });

// Shown on the About page. CI and the Docker image pass APP_VERSION (the release tag, else
// "dev") and APP_COMMIT (a full SHA is shortened); elsewhere they come from git, if there is one.
function git(command: string): string | undefined {
	try {
		return execSync(`git ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return undefined;
	}
}
const APP_VERSION = (process.env.APP_VERSION || git('describe --tags --exact-match') || 'dev').replace(/^v/, '');
const dirty = git('status --porcelain') ? '-dirty' : '';
const commit = process.env.APP_COMMIT;
const APP_COMMIT = commit
	? commit.replace(/^([0-9a-f]{7})[0-9a-f]{33}$/, '$1')
	: (git('rev-parse --short HEAD') ?? 'unknown') + dirty;

export default defineConfig({
	cacheDir: `node_modules/.vite${suffix}`,
	// For the app's code ($lib/base.ts) and the service worker.
	define: {
		__BASE_PATH__: JSON.stringify(BASE_PATH),
		__APP_VERSION__: JSON.stringify(APP_VERSION),
		__APP_BUILD__: JSON.stringify(APP_COMMIT),
		__BUILD_DATE__: JSON.stringify(new Date().toISOString())
	},
	plugins: [
		// Dev over https: the session cookie is Secure (__Host-), as in production.
		basicSsl(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static SPA shell (no data in it); nginx serves it, the app serves data.
			// precompress: .br + .gz next to each file, for gzip_static/brotli_static.
			adapter: adapter({ pages: `build${suffix}`, assets: `build${suffix}`, fallback: 'index.html', precompress: true }),
			outDir: `.svelte-kit${suffix}`,

			// Registered by the app, in production builds only ($lib/pwa.ts).
			serviceWorker: { register: false },

			// Absolute asset paths (/_app/…) in every page: the service worker serves the
			// cached "/" for any URL offline, where relative paths (../_app/…) would break.
			paths: { relative: false, base: BASE_PATH as '' | `/${string}` },

			// Script policy in a <meta> of the page, with the hash of SvelteKit's inline
			// boot script (it changes with every build). nginx sends the rest of the
			// Content-Security-Policy; both apply, so only this exact inline script runs.
			csp: { mode: 'hash', directives: { 'script-src': ['self', 'wasm-unsafe-eval'] } }
		})
	],
	server: {
		// Dev only (nginx in production): the FastAPI server (uvicorn on :8000) answers
		// /api and /media (thumbnails), tusd (:1080) the uploads. API_URL: another
		// backend, e.g. the one started by the browser tests. xfwd: tusd builds upload
		// URLs from X-Forwarded-Host (-behind-proxy). `vite preview` uses the same.
		// tusd's own base path includes BASE_PATH: /files goes to it unchanged.
		proxy: {
			[`${BASE_PATH}/api`]: toBackend(process.env.API_URL ?? 'http://localhost:8000'),
			[`${BASE_PATH}/media`]: toBackend(process.env.API_URL ?? 'http://localhost:8000'),
			[`${BASE_PATH}/files`]: { target: process.env.TUSD_URL ?? 'http://localhost:1080', xfwd: true }
		},
		// Rules shared with the backend, outside frontend/ (see src/lib/validation.ts).
		fs: { allow: ['../server/app/validation.json'] }
	},
	test: {
		// Unit tests next to the code; browser tests (tests/) run with Playwright.
		include: ['src/**/*.test.ts']
	}
});
