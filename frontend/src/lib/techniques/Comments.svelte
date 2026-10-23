<script lang="ts">
	// The comments of a technique, last modified first (sorted by the server), with
	// "Add a comment" for users with the "comment" access. Not in the catalogue:
	// loaded from the API each time and after every change; offline, the service
	// worker answers with the last copy seen (writing needs a connection).
	import { t } from '../i18n.svelte';
	import { hasAccess } from '../session.svelte';
	import CommentCard, { type Comment } from './CommentCard.svelte';
	import CommentForm from './CommentForm.svelte';
	import { addComment, deleteComment, editComment, listComments, type CommentIn } from './comments';

	let { technique }: { technique: string } = $props();
	let comments = $state<Promise<Comment[]>>(new Promise(() => {}));
	let adding = $state(false);
	let error = $state('');
	const canWrite = $derived(hasAccess('comment'));

	function reload() {
		comments = listComments(technique);
	}
	$effect(reload); // and when the technique changes

	async function add(comment: CommentIn) {
		await addComment(technique, comment);
		adding = false;
		reload();
	}

	async function edit(id: number, comment: CommentIn) {
		await editComment(id, comment);
		reload();
	}

	async function remove(id: number) {
		if (!confirm(t('comments.delete_confirm'))) return;
		error = '';
		try {
			await deleteComment(id);
		} catch (e) {
			error = navigator.onLine ? (e as Error).message : t('comments.offline');
			return;
		}
		reload();
	}
</script>

{#if canWrite}
	{#if adding}
		<div class="new"><CommentForm onsave={add} oncancel={() => (adding = false)} /></div>
	{:else}
		<button type="button" class="add" onclick={() => (adding = true)}>{t('comments.add')}</button>
	{/if}
{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#await comments}
	<p class="hint">{t('common.loading')}</p>
{:then list}
	{#if list.length}
		<ol>
			{#each list as comment (comment.id)}
				<li>
					<CommentCard
						{comment}
						editable={canWrite && comment.mine}
						onsave={(changed) => edit(comment.id, changed)}
						ondelete={() => remove(comment.id)}
					/>
				</li>
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
	.add {
		margin-bottom: 0.75rem;
	}
	.new {
		margin-bottom: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	ol {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
