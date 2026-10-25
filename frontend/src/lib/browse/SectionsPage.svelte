<script lang="ts">
	// A school's sections (scrolls, groups) in a category, or of a weapon under Buki.
	import Breadcrumbs from '../Breadcrumbs.svelte';
	import CardPage from '../CardPage.svelte';
	import CatalogCard from '../cards/CatalogCard.svelte';
	import { catalogCrumbs, catalogHref, lastPart, sectionsOf, type CatalogPath } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import { sectionEmblems } from '../sections/emblems';
	import CatalogView from './CatalogView.svelte';

	let { path }: { path: CatalogPath } = $props();
</script>

<CatalogView {path}>
	{#snippet children(c)}
		<CardPage title={t('sections.title')} items={sectionsOf(c, path.ryu, path.category!, path.weapon)}>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(c, path)} />
			{/snippet}
			{#snippet card(section)}
				<CatalogCard
					item={section}
					image={sectionEmblems.url(lastPart(section.id))}
					href={catalogHref({ ...path, section: lastPart(section.id) })}
				/>
			{/snippet}
		</CardPage>
	{/snippet}
</CatalogView>
