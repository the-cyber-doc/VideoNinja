<script lang="ts">
	// Where the page is in the hierarchy, top left: every entry links to its page;
	// with `current` (default) the last one is this page, shown as plain text.
	import { t } from './i18n.svelte';

	let { items, current = true }: { items: { label: string; href: string }[]; current?: boolean } = $props();
</script>

<nav aria-label={t('nav.breadcrumbs')}>
	<ol>
		{#each items as item, i (item.href)}
			<li>
				{#if current && i === items.length - 1}
					<span aria-current="page">{item.label}</span>
				{:else}
					<a href={item.href}>{item.label}</a>
				{/if}
			</li>
		{/each}
	</ol>
</nav>

<style>
	ol {
		display: flex;
		flex-wrap: wrap;
		margin: 0 0 var(--space-2);
		padding: 0;
		list-style: none;
		font-size: var(--text-label);
	}
	li + li::before {
		content: '›';
		padding: 0 var(--space-2);
		color: var(--muted);
	}
	a {
		color: var(--muted);
	}
	a:hover {
		color: var(--text);
	}
	[aria-current] {
		font-weight: 600;
	}
</style>
