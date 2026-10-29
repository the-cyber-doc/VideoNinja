<script lang="ts">
	// A page of the catalogue at `path`: waits for the catalogue, shows "not found"
	// (with the breadcrumbs of what exists) if a step is unknown, else `children`
	// with the catalogue and what the path names.
	import ErrorMessage from '../ErrorMessage.svelte';
	import type { Snippet } from 'svelte';
	import Breadcrumbs from '../Breadcrumbs.svelte';
	import { catalogCrumbs, loadCatalog, resolvePath, type Catalog, type CatalogPath } from '../catalog.svelte';
	import { t } from '../i18n.svelte';

	let {
		path,
		children
	}: { path: CatalogPath; children: Snippet<[Catalog, ReturnType<typeof resolvePath>]> } = $props();
	const catalog = $derived(loadCatalog()); // reads i18n.lang
</script>

{#await catalog}
	<p class="hint centered">{t('common.loading')}</p>
{:then c}
	{@const named = resolvePath(c, path)}
	{#if named.found}
		{@render children(c, named)}
	{:else}
		<Breadcrumbs items={catalogCrumbs(c, path)} current={false} />
		<ErrorMessage error={t('common.not_found')} role={null} centered />
	{/if}
{:catch e}
	<ErrorMessage error={e} role={null} centered />
{/await}
