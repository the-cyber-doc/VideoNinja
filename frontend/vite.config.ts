import adapter from '@sveltejs/adapter-static';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

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
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		// Dev only: the FastAPI server (uvicorn on :8000) answers /api.
		proxy: { '/api': 'http://localhost:8000' }
	}
});
