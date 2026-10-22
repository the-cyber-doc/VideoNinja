<script lang="ts">
	// Inline SVG flag of a language, 3:2 (wider flags are cropped to fit). Decorative:
	// the button or menu entry around it carries the language name.
	import type { Lang } from './i18n.svelte';

	let { lang, width = 24 }: { lang: Lang; width?: number } = $props();
	// The Union Jack's clip paths need ids unique on the page (the flag is shown twice).
	const id = $props.id();
</script>

<svg
	class="flag"
	{width}
	height={(width * 2) / 3}
	viewBox={lang === 'fr' ? '0 0 3 2' : '0 0 60 30'}
	preserveAspectRatio="xMidYMid slice"
	aria-hidden="true"
>
	{#if lang === 'fr'}
		<rect width="1" height="2" fill="#002654" />
		<rect x="1" width="1" height="2" fill="#fff" />
		<rect x="2" width="1" height="2" fill="#ce1126" />
	{:else}
		<clipPath id="{id}-diag">
			<path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
		</clipPath>
		<rect width="60" height="30" fill="#012169" />
		<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6" />
		<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#{id}-diag)" stroke="#c8102e" stroke-width="4" />
		<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10" />
		<path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6" />
	{/if}
</svg>

<style>
	.flag {
		display: block;
		flex: none;
		border-radius: 2px;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.15);
	}
</style>
