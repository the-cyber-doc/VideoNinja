<script lang="ts">
	import { COPYRIGHT_HOLDER, DOCKER_URL, GITHUB_URL, LICENSE_URL, build, buildDate, version } from '#lib/about.js';
	import { api } from '#lib/api.js';
	import { url } from '#lib/base.js';
	import { i18n, t } from '#lib/i18n.svelte.js';

	/** From the server: the running database's version, and the latest this release ships. */
	interface About {
		db_version: number;
		db_schema: number;
	}

	let server = $state<About | null>(null);
	api<About>('/api/about')
		.then((about) => (server = about))
		.catch(() => {}); // offline: "—"

	const date = $derived(new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(buildDate));
</script>

<main class="card">
	<h1>{t('about.title')}</h1>
	<p class="app">
		<img src={url('/favicon.svg')} alt="" width="48" height="48" />
		<span>Video Ninja</span>
	</p>
	<ul>
		<li>{t('about.version', { version })}</li>
		<li>{t('about.build', { build, date })}</li>
		<li>
			{t('about.db_version', { n: server?.db_version ?? '—' })}
			{#if server && server.db_version < server.db_schema}
				<span class="hint">{t('about.db_schema', { n: server.db_schema })}</span>
			{/if}
		</li>
	</ul>
	<ul class="links">
		<li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t('about.source')}</a></li>
		<li><a href={DOCKER_URL} target="_blank" rel="noopener noreferrer">{t('about.image')}</a></li>
	</ul>
	<p class="legal">
		© {buildDate.getUTCFullYear()}
		{COPYRIGHT_HOLDER} ·
		<a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">{t('about.license')}</a>
	</p>
</main>

<style>
	.app {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 1.3rem;
		font-weight: 600;
		margin: 0 0 1rem;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.35rem;
	}
	.hint,
	.legal {
		color: var(--muted);
	}
	.legal {
		font-size: 0.9rem;
		margin: 0;
	}
</style>
