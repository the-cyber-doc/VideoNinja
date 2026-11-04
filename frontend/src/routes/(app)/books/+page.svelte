<script lang="ts">
	// Every book (PDF), in one grid, newest upload first: its first page, its reference
	// (Chicago style), who uploaded it. Books still being published, or failed, say so;
	// those can be deleted (by their uploader or an admin). The filter button opens a pane
	// that filters and sorts them, kept on this device. The 'book_mgmt' access (+page.ts).
	import { invalidate } from '$app/navigation';
	import { deleteBook } from '#lib/api/books.js';
	import type { BookRow } from '#lib/api/types.js';
	import { url } from '#lib/base.js';
	import Citation from '#lib/books/Citation.svelte';
	import FilterPane from '#lib/books/FilterPane.svelte';
	import {
		activeCount,
		effective,
		filterOptions,
		loadFilter,
		matches,
		saveFilter,
		sortBooks
	} from '#lib/books/filter.js';
	import IconButton from '#lib/IconButton.svelte';
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import { bookThumbnailUrl, bookUrl } from '#lib/media.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let error = $state<unknown>(null);
	let failed = $state<Record<number, boolean>>({}); // thumbnails that did not load

	// The filter as chosen (kept as is, even what no book offers now), and what applies of it.
	let filter = $state(loadFilter());
	let paneOpen = $state(false);
	$effect(() => saveFilter($state.snapshot(filter)));
	const options = $derived(filterOptions(data.books, data.tags));
	const applied = $derived(effective(filter, options));
	const active = $derived(activeCount(applied));
	const kept = $derived(
		sortBooks(
			data.books.filter((b) => matches(b, applied)),
			applied.sort,
			i18n.lang
		)
	);

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
	<header>
		<h1>{t('books.title')}</h1>
		<div class="actions">
			<IconButton
				label={active ? t('filter.active', { n: active }) : t('filter.open')}
				icon="filter"
				iconSize={22}
				size="lg"
				round
				class="filter{active ? ' active' : ''}"
				aria-haspopup="dialog"
				disabled={!data.books.length}
				onclick={() => (paneOpen = true)}
			/>
		</div>
	</header>
	<ErrorMessage error={error ?? data.error} />
	{#if !data.books.length && !data.error}
		<p class="hint centered">{t('books.none')} <a href={url('/upload/book')}>{t('books.upload.link')}</a></p>
	{:else if data.books.length}
		<FilterPane bind:open={paneOpen} bind:filter {options} shown={kept.length} total={data.books.length} />
		<p class="hint centered" role="status">
			{active
				? t('books.filter.shown', { n: kept.length, total: data.books.length })
				: t('books.count', { n: data.books.length })}
		</p>
		{#if !kept.length}<p class="hint centered">{t('books.filtered_none')}</p>{/if}
		<ul class="grid">
			{#each kept as book (book.id)}
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
	/* The title centred, the filter button at the right of the same line. */
	header {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
	}
	h1 {
		grid-column: 2;
		text-align: center;
		margin: 0;
	}
	.actions {
		grid-column: 3;
		justify-self: end;
		display: flex;
		gap: var(--space-2);
	}
	.actions :global(.filter) {
		background: var(--bg);
	}
	/* Something filtered or sorted otherwise: the button says so in the accent colour. */
	.actions :global(.filter.active) {
		color: var(--accent);
		border-color: var(--accent);
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
