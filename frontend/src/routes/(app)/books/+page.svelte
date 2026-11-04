<script lang="ts">
	// Every book (PDF), in one grid, newest upload first: its first page, its reference
	// (Chicago style), who uploaded it. Books still being published, or failed, say so;
	// those can be deleted (by their uploader or an admin). The 'book_mgmt' access (+page.ts).
	import { invalidate } from '$app/navigation';
	import { deleteBook } from '#lib/api/books.js';
	import type { BookRow } from '#lib/api/types.js';
	import { url } from '#lib/base.js';
	import Citation from '#lib/books/Citation.svelte';
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import { bookThumbnailUrl, bookUrl } from '#lib/media.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let error = $state<unknown>(null);
	let failed = $state<Record<number, boolean>>({}); // thumbnails that did not load

	const day = (iso: string) => new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(new Date(iso));
	const uploader = (book: BookRow) => book.uploaded_by ?? t('common.deleted_user');

	async function remove(book: BookRow) {
		if (!confirm(t('books.delete_confirm', { name: book.original_filename }))) return;
		error = null;
		try {
			await deleteBook(book.id);
			await invalidate('app:books');
		} catch (e) {
			error = e;
		}
	}
</script>

<div class="page">
	<h1>{t('books.title')}</h1>
	<ErrorMessage error={error ?? data.error} />
	{#if !data.books.length && !data.error}
		<p class="hint centered">{t('books.none')} <a href={url('/upload/book')}>{t('books.upload.link')}</a></p>
	{:else}
		<p class="hint centered">{t('books.count', { n: data.books.length })}</p>
		<ul class="grid">
			{#each data.books as book (book.id)}
				<li class="book" data-id={book.id}>
					<span class="picture">
						{#if book.status === 'published' && book.has_thumbnail && !failed[book.id]}
							<img
								src={bookThumbnailUrl(book.id)}
								alt={t('books.upload.first_page')}
								loading="lazy"
								onerror={() => (failed[book.id] = true)}
							/>
						{:else}
							<span class="placeholder">{t('books.no_thumbnail')}</span>
						{/if}
					</span>
					<div class="about">
						<p class="reference"><Citation reference={book.reference} /></p>
						<p class="hint">
							{[
								t('books.uploaded', { name: uploader(book), date: day(book.uploaded_at) }),
								book.pages && t('books.pages', { n: book.pages })
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
						{#if book.status === 'published'}
							<a href={bookUrl(book.id)} download={book.original_filename}>{t('books.download')}</a>
						{:else}
							{#if book.status === 'queued'}
								<p class="hint" role="status">{t('books.queued')}</p>
							{:else}
								<ErrorMessage error={t('books.failed', { error: book.error ?? '' })} role={null} />
							{/if}
							<button type="button" class="secondary" onclick={() => remove(book)}>{t('books.delete')}</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-4);
	}
	h1 {
		text-align: center;
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.book {
		display: grid;
		grid-template-columns: 6rem 1fr;
		gap: var(--space-3);
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.picture img,
	.placeholder {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 4;
		object-fit: cover;
		object-position: top;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.placeholder {
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: var(--text-sm);
	}
	.about {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		min-width: 0;
	}
	.about p {
		margin: 0;
	}
	.reference {
		overflow-wrap: anywhere;
		font-size: var(--text-sm);
	}
	.about button {
		justify-self: start;
	}
</style>
