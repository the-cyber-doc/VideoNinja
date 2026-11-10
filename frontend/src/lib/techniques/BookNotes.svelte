<script lang="ts">
	// What the books say about a technique, on its page, for every logged-in user: each
	// annotation framed like a comment (the text highlighted, or the region's picture, and
	// its note), its book's reference (Chicago) and page, who made it and when. Book
	// managers also get a link that opens the book on it. Nothing shown when
	// no book mentions the technique. Offline: the service worker's last copy.
	import { techniqueNotes } from '../api/books';
	import type { TechniqueNote } from '../api/types';
	import { url } from '../base';
	import Citation from '../books/Citation.svelte';
	import { looksGarbled } from '../books/quality';
	import { i18n, t } from '../i18n.svelte';
	import { annotationImageUrl } from '../media';

	let { technique }: { technique: string } = $props();
	let notes = $state<TechniqueNote[]>([]);
	$effect(() => {
		notes = [];
		techniqueNotes(technique).then(
			(list) => (notes = list),
			() => (notes = []) // not essential: the page goes on without them
		);
	});
	const when = (iso: string) => new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(new Date(iso));
</script>

{#if notes.length}
	<section class="notes">
		<h2>{t('technique.books')}</h2>
		<ol>
			{#each notes as note (note.id)}
				<li>
					<article class="note" aria-label={t('technique.book_note')}>
						{#if note.kind === 'region' && note.has_image}
							<img src={annotationImageUrl(note.id)} alt={t('books.annotations.crop')} loading="lazy" />
						{:else if note.quote}
							<blockquote>{note.quote}</blockquote>
							{#if looksGarbled(note.quote)}<p class="garbled">{t('technique.book_note_garbled')}</p>{/if}
						{/if}
						{#if note.note}<p class="text">{note.note}</p>{/if}
						<p class="source">
							<Citation reference={note.reference} />
							{t('technique.book_page', { n: note.page })}
						</p>
						<footer>
							<span>
								{t('books.annotations.by', {
									name: note.created_by ?? t('common.deleted_user'),
									date: when(note.modified_at)
								})}
							</span>
							{#if note.book_id}
								<a href={url(`/books/${note.book_id}?annotation=${note.id}`)}>{t('technique.open_book')}</a>
							{/if}
						</footer>
					</article>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.notes {
		margin-top: var(--space-6);
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0 0 var(--space-3);
	}
	ol {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* Framed like a comment. */
	.note {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	blockquote {
		margin: 0;
		padding-left: var(--space-3);
		border-left: 3px solid var(--accent);
		font-style: italic;
		overflow-wrap: anywhere;
	}
	img {
		max-width: 100%;
		max-height: 20rem;
		justify-self: start;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	p {
		margin: 0;
	}
	.text {
		white-space: pre-line;
	}
	.garbled {
		font-size: var(--text-xs);
		color: var(--muted);
	}
	.source {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--muted);
	}
</style>
