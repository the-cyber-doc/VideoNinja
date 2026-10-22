<script lang="ts">
	import CardPage from '#lib/CardPage.svelte';
	import CatalogCard from '#lib/cards/CatalogCard.svelte';
	import { loadCatalog, schoolHref } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import { schoolEmblems } from '#lib/schools/emblems.js';

	// Reloaded when the language changes (descriptions are translated by the server).
	const schools = $derived(loadCatalog().then((catalog) => catalog.schools)); // reads i18n.lang
</script>

<CardPage title={t('schools.title')} items={schools}>
	{#snippet card(school)}
		<CatalogCard item={school} image={schoolEmblems.url(school.id)} href={schoolHref(school.id)} />
	{/snippet}
</CardPage>
