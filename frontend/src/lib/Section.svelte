<script lang="ts">
	// A collapsible section of a page (Videos, Options): its title (a heading), an optional count
	// and hint, then its content. The arrow points right collapsed, down expanded (the
	// open state is the details element's: the user's clicks keep it).
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		count = '',
		hint = '',
		open = false,
		children
	}: { title: string; count?: string; hint?: string; open?: boolean; children: Snippet } = $props();
</script>

<details class="section" {open}>
	<summary>
		<h2 class="name">{title}</h2>
		{#if count}<span class="count">{count}</span>{/if}
		<span class="arrow"><Icon name="chevron-down" size={20} /></span>
		{#if hint}<span class="hint">{hint}</span>{/if}
	</summary>
	{@render children()}
</details>

<style>
	.section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-3) var(--space-4);
		cursor: pointer;
		list-style: none; /* the arrow replaces the browser's marker */
	}
	summary::-webkit-details-marker {
		display: none; /* Safari */
	}
	.arrow {
		align-self: center;
		margin-left: auto;
		line-height: 0;
		color: var(--muted);
		transition: transform 0.15s;
	}
	.section:not([open]) .arrow {
		transform: rotate(-90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.arrow {
			transition: none;
		}
	}
	.name {
		margin: 0;
		font-weight: 700;
		font-size: var(--text-lg);
	}
	.count {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--text-sm);
	}
</style>
