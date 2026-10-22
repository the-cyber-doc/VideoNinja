import adapter from '@sveltejs/adapter-static';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
			adapter: adapter({ fallback: 'index.html', precompress: true }),

			// Registered by the app, in production builds only ($lib/pwa.ts).
			serviceWorker: { register: false },

			// Absolute asset paths (/_app/…) in every page: the service worker serves the
			// cached "/" for any URL offline, where relative paths (../_app/…) would break.
			paths: { relative: false }
		})
	],
	server: {
		// Dev only: the FastAPI server (uvicorn on :8000) answers /api.
		// API_URL: another backend, e.g. the one started by the browser tests.
		proxy: { '/api': process.env.API_URL ?? 'http://localhost:8000' },
		// Rules shared with the backend, outside frontend/ (see src/lib/validation.ts).
		fs: { allow: ['../server/app/validation.json'] }
	},
	test: {
		// Unit tests next to the code; browser tests (tests/) run with Playwright.
		include: ['src/**/*.test.ts']
	}
});
