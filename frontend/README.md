# Video Ninja — Frontend

SvelteKit (Svelte 5, TypeScript) built with `adapter-static` as an SPA shell
(`fallback: index.html`, `ssr = false`). The shell is public and contains no
data; catalogue and media are fetched with a session. See the root `CLAUDE.md`.

Requires Node ≥ 22.17 (CI uses Node 24).

```bash
npm ci
npm run dev      # https://localhost:5173 (self-signed), /api proxied to :8000
npm run check    # svelte-check (types)
npm run build    # static output in build/
```
