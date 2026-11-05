<script lang="ts">
	// The text around a match (the server's full text): the matches marked. Plain text only
	// (never HTML from the server).
	import { snippetParts } from './search';

	let { text }: { text: string } = $props();
	const parts = $derived(snippetParts(text));
</script>

<span class="snippet"
	>{#each parts as part, i (i)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</span
>

<style>
	.snippet {
		font-size: var(--text-sm);
		color: var(--text);
		overflow-wrap: anywhere;
	}
	mark {
		background: var(--mark);
		color: inherit;
		border-radius: var(--radius-xs);
	}
</style>
