<script lang="ts">
	// One comment: author, date and time, language (flag), text.
	import Flag from '../Flag.svelte';
	import { i18n, isLang, LANGUAGES, t } from '../i18n.svelte';

	export interface Comment {
		id: number;
		user: string;
		/** ISO 8601 with the UTC offset (the author's timezone): "2026-10-23T12:13:38+02:00". */
		created_at: string;
		lang: string;
		text: string;
	}

	let { comment }: { comment: Comment } = $props();
	const date = $derived(new Date(comment.created_at));
	const when = $derived(
		new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
	);
	const language = $derived(
		t('language.current', {
			name: isLang(comment.lang) ? LANGUAGES[comment.lang] : comment.lang
		})
	);
</script>

<article class="comment">
	<header>
		<strong>{comment.user}</strong>
		<time datetime={date.toISOString()}>{when}</time>
		<span class="lang" role="img" aria-label={language} title={language}>
			{#if isLang(comment.lang)}
				<Flag lang={comment.lang} width={16} />
			{:else}
				{comment.lang}
			{/if}
		</span>
	</header>
	<p lang={comment.lang}>{comment.text}</p>
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
	time {
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
</style>
