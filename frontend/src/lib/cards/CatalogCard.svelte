<script lang="ts">
	// A school, level or technique: kanji, then romaji, centred, over an optional
	// background image (emblem). With `href` the whole card is a link.
	let {
		item,
		image,
		href
	}: { item: { id: string; kanji: string; romaji: string }; image?: string; href?: string } =
		$props();
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="catalog-card"
	data-id={item.id}
	style:background-image={image ? `url("${image}")` : undefined}
>
	<!-- Quoted url(): small emblems are inlined as data: URLs, with quotes and parentheses. -->
	<span class="kanji" lang="ja">{item.kanji}</span>
	<span class="romaji">{item.romaji}</span>
</svelte:element>

<style>
	.catalog-card {
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
	a.catalog-card:hover,
	a.catalog-card:focus-visible {
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
