<script lang="ts">
	// Every result of a search (the boxes' "See all results"): the query in the URL (?q=),
	// edited here too; the results by group, each hit shown in the page's language.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { i18n, t, type MessageKey } from '#lib/i18n.svelte.js';
	import { searcher } from '#lib/search/app.js';
	import { results } from '#lib/search/search.js';
	import Snippet from '#lib/search/Snippet.svelte';

	const query = $derived(page.url.searchParams.get('q') ?? '');
	let loaded = $state(false);
	$effect(() => {
		void searcher.refresh().then(() => (loaded = true));
	});
	$effect(() => searcher.lookup(query));
	const remote = $derived(searcher.remoteHits(query));
	const groups = $derived.by(() => {
		void searcher.version;
		return results(searcher.hits(query), searcher.sources.catalogs[i18n.lang], searcher.sources, Infinity, remote);
	});

	function typed(e: Event) {
		const q = (e.currentTarget as HTMLInputElement).value;
		const to = new URL(page.url.href);
		if (q) to.searchParams.set('q', q);
		else to.searchParams.delete('q');
		void goto(to, { replace: true, reset: false });
	}
</script>

<div class="page">
	<h1>{t('search.title')}</h1>
	<input
		type="search"
		value={query}
		oninput={typed}
		placeholder={t('search.placeholder')}
		aria-label={t('search.label')}
		autocomplete="off"
		spellcheck="false"
	/>
	{#if query.trim() && searcher.remoteFailed}
		<p class="hint centered">{t('search.text_unavailable')}</p>
	{:else if query.trim() && !remote && groups.length}
		<p class="hint centered">{t('search.searching_text')}</p>
	{/if}
	{#if !query.trim()}
		<p class="hint centered">{t('search.hint')}</p>
	{:else if searcher.failed}
		<p class="hint centered">{t('search.unavailable')}</p>
	{:else if !loaded || (!remote && !searcher.remoteFailed && !groups.length)}
		<p class="hint centered">{t('common.loading')}</p>
	{:else if !groups.length}
		<p class="hint centered" role="status">{t('search.none')}</p>
	{:else}
		<p class="hint centered" role="status">
			{t('search.count', { n: groups.reduce((sum, g) => sum + g.total, 0) })}
		</p>
		{#each groups as g (g.group)}
			<section aria-labelledby="results-{g.group}">
				<h2 id="results-{g.group}">{t(`search.group.${g.group}` as MessageKey)} <span class="hint">{g.total}</span></h2>
				<ul>
					{#each g.hits as hit (hit.key)}
						<li data-kind={hit.kind}>
							<a href={hit.href}>{hit.title}</a>
							<span class="detail">
								{#if g.group === 'catalog'}{t(`search.kind.${hit.kind}` as MessageKey)} ·{/if}
								{hit.detail}
							</span>
							{#if hit.snippet}<Snippet text={hit.snippet} />{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<style>
	.page {
		max-width: 48rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-4);
	}
	h1 {
		text-align: center;
		margin: 0;
	}
	h2 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-lg);
	}
	input {
		width: 100%;
	}
	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	li a {
		font-weight: 600;
	}
	.detail {
		font-size: var(--text-sm);
		color: var(--muted);
	}
</style>
