# Video Ninja — Frontend

SvelteKit (Svelte 5, TypeScript) built with `adapter-static` as an SPA shell
(`fallback: index.html`, `ssr = false`). The shell is public and contains no
data; catalogue and media are fetched with a session. See the root `README.md`.

Requires Node ≥ 22.17 (CI and the Docker build use Node 26).

```bash
npm ci
npm run dev      # https://localhost:5173 (self-signed), /api proxied to :8000
npm run check    # svelte-check (types)
npm run lint     # Prettier (layout) + ESLint; `npm run format` fixes what it can
npm run build    # static output in build/ (+ .br/.gz)
npm test         # unit tests (Vitest) + browser tests (Playwright)
npm run test:coverage   # unit tests with coverage (floors in vite.config.ts)
```

Tests: see "Frontend tests" in the root `README.md`.
