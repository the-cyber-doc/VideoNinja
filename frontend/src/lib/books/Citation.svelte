<script lang="ts">
	// A reference as a Chicago bibliography entry (citation.ts), titles in italics, in
	// the page's language (the words around the data; the data as typed).
	import type { Reference } from '../api/types';
	import { i18n, t } from '../i18n.svelte';
	import { citation } from './citation';

	let { reference }: { reference: Reference } = $props();
	const runs = $derived(citation(reference, i18n.lang, t));
</script>

<span class="citation"
	>{#each runs as run, i (i)}{#if run.italic}<i>{run.text}</i>{:else}{run.text}{/if}{/each}</span
>
