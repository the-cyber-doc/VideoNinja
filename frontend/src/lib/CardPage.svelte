<script lang="ts" generics="T extends { id: string | number }">
	// Default layout of the pages listing cards (schools; later levels, techniques…):
	// a title, then same-size cards centred on the screen, last row included.
	// Shows the loading message and the error while `items` is pending or failed,
	// `empty` when there is nothing to show. Optional `top`: above the title
	// (breadcrumbs).
	import type { Snippet } from 'svelte';
	import { t } from './i18n.svelte';

	let {
		title,
		items,
		card,
		empty = '',
		top
	}: {
		title: string;
		items: T[] | Promise<T[]>;
		card: Snippet<[T]>;
		empty?: string;
		top?: Snippet;
	} = $props();
</script>

{@render top?.()}
<h1>{title}</h1>

{#await items}
	<p class="hint">{t('common.loading')}</p>
{:then list}
	{#if !list.length && empty}
		<p class="hint">{empty}</p>
	{/if}
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
		gap: var(--space-4);
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
