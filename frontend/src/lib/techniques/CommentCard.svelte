<script lang="ts">
	// One comment: author, language (flag), modification time, text. Its author
	// (with the "comment" access) can edit it in place or delete it.
	import Flag from '../Flag.svelte';
	import { i18n, isLang, LANGUAGES, t } from '../i18n.svelte';
	import CommentForm from './CommentForm.svelte';
	import type { Comment, CommentIn } from '../api/types';

	let {
		comment,
		editable = false,
		onsave,
		ondelete
	}: {
		comment: Comment;
		editable?: boolean;
		onsave?: (comment: CommentIn) => Promise<unknown>;
		ondelete?: () => void;
	} = $props();

	let editing = $state(false);
	const date = $derived(new Date(comment.modified_at));
	const edited = $derived(Date.parse(comment.modified_at) !== Date.parse(comment.created_at));
	const when = $derived(
		new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
	);
	const language = $derived(
		t('language.current', {
			name: isLang(comment.lang) ? LANGUAGES[comment.lang] : comment.lang
		})
	);

	async function save(changed: CommentIn) {
		await onsave?.(changed);
		editing = false;
	}
</script>

<article class="comment">
	<header>
		<strong>{comment.user}</strong>
		<time datetime={date.toISOString()}>{when}</time>
		{#if edited}<span class="edited">{t('comments.edited')}</span>{/if}
		<span class="lang" role="img" aria-label={language} title={language}>
			{#if isLang(comment.lang)}
				<Flag lang={comment.lang} width={16} />
			{:else}
				{comment.lang}
			{/if}
		</span>
	</header>
	{#if editing && isLang(comment.lang)}
		<CommentForm initial={{ text: comment.text, lang: comment.lang }} onsave={save} oncancel={() => (editing = false)} />
	{:else}
		<p lang={comment.lang}>{comment.text}</p>
		{#if editable}
			<div class="actions">
				<button type="button" class="secondary" onclick={() => (editing = true)}>{t('comments.edit')}</button>
				<button type="button" class="secondary" onclick={() => ondelete?.()}>{t('comments.delete')}</button>
			</div>
		{/if}
	{/if}
</article>

<style>
	.comment {
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	time,
	.edited {
		color: var(--muted);
	}
	.lang {
		margin-left: auto;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: var(--muted);
	}
	p {
		margin: 0.4rem 0 0;
		white-space: pre-line; /* keep the author's line breaks */
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.actions button {
		padding: 0.25rem 0.6rem;
		font-size: 0.85rem;
	}
</style>
