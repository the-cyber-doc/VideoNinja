<script lang="ts">
	// The comments of a technique, newest first (sorted by the server).
	// Not in the catalogue: loaded from the API each time; offline, the service worker
	// answers with the last copy seen.
	import { api } from '../api';
	import { t } from '../i18n.svelte';
	import CommentCard, { type Comment } from './CommentCard.svelte';

	let { technique }: { technique: string } = $props();
	const comments = $derived(
		api<Comment[]>(`/api/techniques/${encodeURIComponent(technique)}/comments`)
	);
</script>

{#await comments}
	<p class="hint">{t('common.loading')}</p>
{:then list}
	{#if list.length}
		<ol>
			{#each list as comment (comment.id)}
				<li><CommentCard {comment} /></li>
			{/each}
		</ol>
	{:else}
		<p class="hint">{t('technique.no_comments')}</p>
	{/if}
{:catch e}
	<!-- Offline and never seen online: nothing cached. -->
	<p class="error">{navigator.onLine ? e.message : t('common.offline')}</p>
{/await}

<style>
	ol {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
