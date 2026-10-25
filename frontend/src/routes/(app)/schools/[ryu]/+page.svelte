<script lang="ts">
	// A school's categories: Taijutsu, Muto Dori, Buki (those it has).
	import CatalogView from '#lib/browse/CatalogView.svelte';
	import Breadcrumbs from '#lib/Breadcrumbs.svelte';
	import CardPage from '#lib/CardPage.svelte';
	import CatalogCard from '#lib/cards/CatalogCard.svelte';
	import { categoryEmblems } from '#lib/categories/emblems.js';
	import { catalogCrumbs, catalogHref, categoriesOf } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const path = $derived({ ryu: params.ryu });
</script>

<CatalogView {path}>
	{#snippet children(c)}
		<CardPage title={t('categories.title')} items={categoriesOf(c, path.ryu)} empty={t('categories.none')}>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(c, path)} />
			{/snippet}
			{#snippet card(category)}
				<CatalogCard
					item={category}
					image={categoryEmblems.url(category.id)}
					href={catalogHref({ ...path, category: category.id })}
				/>
			{/snippet}
		</CardPage>
	{/snippet}
</CatalogView>
