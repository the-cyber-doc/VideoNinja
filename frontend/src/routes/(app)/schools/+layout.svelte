<script lang="ts">
	// Every page of the catalogue: the search box at the top right.
	import SearchBox from '#lib/search/SearchBox.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="search-bar"><SearchBox /></div>
{@render children()}

<style>
	.search-bar {
		display: flex;
		justify-content: flex-end;
		margin-bottom: var(--space-2);
	}
</style>
