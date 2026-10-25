<script lang="ts">
	// The weapons a school teaches.
	import CatalogView from '#lib/browse/CatalogView.svelte';
	import Breadcrumbs from '#lib/Breadcrumbs.svelte';
	import CardPage from '#lib/CardPage.svelte';
	import CatalogCard from '#lib/cards/CatalogCard.svelte';
	import { BUKI, catalogCrumbs, catalogHref, weaponsOf } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import { weaponEmblems } from '#lib/weapons/emblems.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const path = $derived({ ryu: params.ryu, category: BUKI });
</script>

<CatalogView {path}>
	{#snippet children(c)}
		<CardPage title={t('weapons.title')} items={weaponsOf(c, path.ryu)}>
			{#snippet top()}
				<Breadcrumbs items={catalogCrumbs(c, path)} />
			{/snippet}
			{#snippet card(weapon)}
				<CatalogCard item={weapon} image={weaponEmblems.url(weapon.id)} href={catalogHref({ ...path, weapon: weapon.id })} />
			{/snippet}
		</CardPage>
	{/snippet}
</CatalogView>
