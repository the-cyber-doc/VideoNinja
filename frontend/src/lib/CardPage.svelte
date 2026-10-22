<script lang="ts" generics="T extends { id: string | number }">
	// Default layout of the pages listing cards (schools; later levels, techniques…):
	// a title, then same-size cards centred on the screen, last row included.
	// Shows the loading message and the error while `items` is pending or failed.
	import type { Snippet } from 'svelte';
	import { t } from './i18n.svelte';

	let { title, items, card }: { title: string; items: Promise<T[]>; card: Snippet<[T]> } =
		$props();
</script>

<h1>{title}</h1>

{#await items}
	<p class="hint">{t('common.loading')}</p>
{:then list}
	<ul>
		{#each list as item (item.id)}
			<li>{@render card(item)}</li>
		{/each}
	</ul>
{:catch e}
	<p class="error">{e.message}</p>
{/await}

<style>
	h1,
	p {
		text-align: center;
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		width: 11rem;
	}
	/* Phones: two cards per row. */
	@media (max-width: 30rem) {
		li {
			width: calc(50% - 0.5rem);
		}
	}
</style>
