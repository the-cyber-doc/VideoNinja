<script lang="ts">
	// The levels of a school.
	import Breadcrumbs from '#lib/Breadcrumbs.svelte';
	import CardPage from '#lib/CardPage.svelte';
	import CatalogCard from '#lib/cards/CatalogCard.svelte';
	import { catalogCrumbs, findSchool, levelHref, loadCatalog } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import { levelEmblems } from '#lib/levels/emblems.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const catalog = $derived(loadCatalog()); // reads i18n.lang
</script>

{#await catalog}
	<p class="hint centered">{t('common.loading')}</p>
{:then c}
	{@const school = findSchool(c, params.ryu)}
	{#if school}
		<CardPage title={t('levels.title')} items={c.levels}>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(school)} />
			{/snippet}
			{#snippet card(level)}
				<CatalogCard
					item={level}
					image={levelEmblems.url(level.id)}
					href={levelHref(school.id, level.id)}
				/>
			{/snippet}
		</CardPage>
	{:else}
		<Breadcrumbs items={catalogCrumbs()} current={false} />
		<p class="error centered">{t('common.not_found')}</p>
	{/if}
{:catch e}
	<p class="error centered">{e.message}</p>
{/await}
