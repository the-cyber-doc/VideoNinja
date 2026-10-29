<script lang="ts">
	// A school, category, weapon, section or technique: kanji, then romaji, centred,
	// over an optional background image (emblem). With `href` the card's face is a
	// link. With `segments` (those of its branch), bottom right: whether they are
	// saved on this device, and a button to download or remove them (OfflineToggle,
	// beside the link: a button cannot be inside it).
	import type { Segment } from '../catalog.svelte';
	import { offline } from '../offline.svelte';
	import OfflineToggle from '../OfflineToggle.svelte';

	let {
		item,
		image,
		href,
		segments
	}: {
		item: { id: string; kanji: string; romaji: string };
		image?: string;
		href?: string;
		segments?: Segment[];
	} = $props();
</script>

<div class="catalog-card" data-id={item.id} style:background-image={image ? `url("${image}")` : undefined}>
	<!-- Quoted url(): small emblems are inlined as data: URLs, with quotes and parentheses. -->
	<svelte:element this={href ? 'a' : 'div'} {href} class="face">
		<span class="kanji" lang="ja">{item.kanji}</span>
		<span class="romaji">{item.romaji}</span>
	</svelte:element>
	{#if segments?.length && offline.available}
		<span class="corner"><OfflineToggle {segments} /></span>
	{/if}
</div>

<style>
	.catalog-card {
		position: relative;
		aspect-ratio: 1;
		background-color: var(--surface);
		background-position: center;
		background-repeat: no-repeat;
		background-size: 80%;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.catalog-card:has(a.face:hover),
	.catalog-card:has(a.face:focus-visible) {
		border-color: var(--accent);
	}
	.face {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		height: 100%;
		padding: var(--space-2);
		text-align: center;
		color: var(--text);
		text-decoration: none;
		border-radius: inherit;
	}
	a.face:focus-visible {
		outline: none;
	}
	.corner {
		position: absolute;
		right: var(--space-2);
		bottom: var(--space-2);
	}
	.kanji {
		font-size: var(--text-display);
		font-weight: 700;
		line-height: 1.2;
	}
	.romaji {
		font-size: var(--text-label);
		font-weight: 600;
	}
	.kanji,
	.romaji {
		/* Readable over the emblem's lines. */
		text-shadow:
			0 0 6px var(--surface),
			0 0 12px var(--surface);
	}
</style>
