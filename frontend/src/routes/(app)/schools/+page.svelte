<script lang="ts">
	import CardPage from '#lib/CardPage.svelte';
	import { loadCatalog } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import SchoolCard from '#lib/schools/SchoolCard.svelte';

	// Reloaded when the language changes (descriptions are translated by the server).
	const schools = $derived(loadCatalog().then((catalog) => catalog.schools)); // reads i18n.lang
</script>

<CardPage title={t('schools.title')} items={schools}>
	{#snippet card(school)}
		<SchoolCard {school} />
	{/snippet}
</CardPage>
