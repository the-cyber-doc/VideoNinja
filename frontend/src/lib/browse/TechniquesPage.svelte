<script lang="ts">
	// The techniques of a section. No background image.
	import Breadcrumbs from '../Breadcrumbs.svelte';
	import CardPage from '../CardPage.svelte';
	import CatalogCard from '../cards/CatalogCard.svelte';
	import { catalogCrumbs, catalogHref, lastPart, techniquesOf, type CatalogPath } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import CatalogView from './CatalogView.svelte';

	let { path }: { path: CatalogPath } = $props();
</script>

<CatalogView {path}>
	{#snippet children(c, { section })}
		<CardPage title={t('techniques.title')} items={techniquesOf(c, section!.id)} empty={t('techniques.none')}>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(c, path)} />
			{/snippet}
			{#snippet card(technique)}
				<CatalogCard item={technique} href={catalogHref({ ...path, technique: lastPart(technique.id) })} />
			{/snippet}
		</CardPage>
	{/snippet}
</CatalogView>
