<script lang="ts">
	// The techniques of a school at a level. No background image (yet).
	import Breadcrumbs from '#lib/Breadcrumbs.svelte';
	import CardPage from '#lib/CardPage.svelte';
	import CatalogCard from '#lib/cards/CatalogCard.svelte';
	import {
		catalogCrumbs,
		findLevel,
		findSchool,
		loadCatalog,
		techniqueHref,
		techniquesOf
	} from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const catalog = $derived(loadCatalog()); // reads i18n.lang
</script>

{#await catalog}
	<p class="hint centered">{t('common.loading')}</p>
{:then c}
	{@const school = findSchool(c, params.ryu)}
	{@const level = findLevel(c, params.level)}
	{#if school && level}
		<CardPage
			title={t('techniques.title')}
			items={techniquesOf(c, school.id, level.id)}
			empty={t('techniques.none')}
		>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(school, level)} />
			{/snippet}
			{#snippet card(technique)}
				<CatalogCard item={technique} href={techniqueHref(school.id, level.id, technique.id)} />
			{/snippet}
		</CardPage>
	{:else}
		<Breadcrumbs items={catalogCrumbs(school)} current={false} />
		<p class="error centered">{t('common.not_found')}</p>
	{/if}
{:catch e}
	<p class="error centered">{e.message}</p>
{/await}
