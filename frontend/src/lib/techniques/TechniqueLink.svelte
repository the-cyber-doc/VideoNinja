<script lang="ts">
	// A link icon to a technique's page (after its name or a segment's times); nothing when
	// the technique is not set or not in the catalogue.
	import { catalogHref, pathOf, type Catalog } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import Icon from '../Icon.svelte';

	let { catalog, technique }: { catalog: Catalog | null; technique: string | null | undefined } = $props();

	const path = $derived(catalog && technique ? pathOf(catalog, technique) : undefined);
</script>

{#if path?.technique}
	<a
		class="technique-link"
		href={catalogHref(path)}
		title={t('technique.open_page')}
		aria-label={t('technique.open_page')}
	>
		<Icon name="link" size={16} />
	</a>
{/if}

<style>
	.technique-link {
		display: inline-flex;
		align-items: center;
		vertical-align: middle;
		color: var(--accent);
	}
</style>
