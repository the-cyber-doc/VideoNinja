<script lang="ts" generics="K extends string">
	// A pane's order: the key, then the direction, worded for that key ("Newest first").
	import { t } from '../i18n.svelte';

	let {
		sort = $bindable(),
		keys,
		keyLabel,
		dirLabel
	}: {
		sort: { key: K; dir: 'asc' | 'desc' };
		keys: readonly K[];
		keyLabel: (key: K) => string;
		dirLabel: (key: K, dir: 'asc' | 'desc') => string;
	} = $props();

	const id = $props.id();
</script>

<fieldset>
	<legend>{t('filter.sort')}</legend>
	<!-- Explicit labels: a wrapping one would add the chosen option to the select's name. -->
	<div class="sort">
		<label for="{id}-sort">{t('filter.sort_by')}</label>
		<label for="{id}-dir">{t('filter.sort_dir')}</label>
		<select id="{id}-sort" bind:value={sort.key}>
			{#each keys as key (key)}
				<option value={key}>{keyLabel(key)}</option>
			{/each}
		</select>
		<select id="{id}-dir" bind:value={sort.dir}>
			<option value="asc">{dirLabel(sort.key, 'asc')}</option>
			<option value="desc">{dirLabel(sort.key, 'desc')}</option>
		</select>
	</div>
</fieldset>

<style>
	.sort {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-1) var(--space-2);
	}
</style>
