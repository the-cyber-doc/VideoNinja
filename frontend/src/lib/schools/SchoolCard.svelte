<script lang="ts">
	// A school: kanji, then romaji, centred over the school's emblem.
	// With `href` the whole card is a link (opening the school, later).
	import type { School } from '../catalog.svelte';
	import { emblemUrl } from './emblems';

	let { school, href }: { school: School; href?: string } = $props();
	// Quoted: small emblems are inlined as data: URLs, with quotes and parentheses.
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="school-card"
	data-school={school.id}
	style:background-image={`url("${emblemUrl(school.id)}")`}
>
	<span class="kanji" lang="ja">{school.kanji}</span>
	<span class="romaji">{school.romaji}</span>
</svelte:element>

<style>
	.school-card {
		aspect-ratio: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.5rem;
		text-align: center;
		color: var(--text);
		text-decoration: none;
		background-color: var(--surface);
		background-position: center;
		background-repeat: no-repeat;
		background-size: 80%;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	a.school-card:hover,
	a.school-card:focus-visible {
		border-color: var(--accent);
		outline: none;
	}
	.kanji {
		font-size: 1.6rem;
		font-weight: 700;
		line-height: 1.2;
	}
	.romaji {
		font-size: 0.95rem;
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
