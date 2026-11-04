<script lang="ts">
	// One book: its reference (edited here), its PDF in the viewer with its annotations
	// beside it. Page logic: $lib/books/book.svelte.ts (BookPage). The 'book_mgmt' access (+page.ts).
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { url } from '#lib/base.js';
	import AnnotationList from '#lib/books/AnnotationList.svelte';
	import { BookPage } from '#lib/books/book.svelte.js';
	import Citation from '#lib/books/Citation.svelte';
	import ReferenceForm from '#lib/books/ReferenceForm.svelte';
	import Viewer from '#lib/books/Viewer.svelte';
	import { loadCatalog, type Catalog } from '#lib/catalog.svelte.js';
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { t } from '#lib/i18n.svelte.js';
	import { bookUrl } from '#lib/media.js';
	import { displayName } from '#lib/session.svelte.js';
	import TagInput from '#lib/upload/TagInput.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// The book the page opened with (a reload brings a newer one).
	// svelte-ignore state_referenced_locally
	const page = data.book ? new BookPage(data.book, data.annotations) : null;
	let catalog = $state<Catalog | null>(null);

	onMount(() => {
		if (page?.book.status === 'published') void page.load();
		loadCatalog().then(
			(c) => (catalog = c),
			() => {}
		);
	});
	// Changes still being saved: leaving waits for them.
	beforeNavigate(({ willUnload }) => {
		if (!willUnload && page?.annotations.pending) void page.annotations.settled();
	});
</script>

<svelte:window onbeforeunload={(e) => page?.annotations.pending && e.preventDefault()} />

<div class="page">
	<a class="back" href={url('/books')}>← {t('books.viewer.back')}</a>
	<ErrorMessage error={data.error} />
	{#if page}
		<header>
			<p class="reference"><Citation reference={page.book.reference} /></p>
			<div class="actions">
				<a href={bookUrl(page.book.id)} download={page.book.original_filename}>{t('books.download')}</a>
				{#if !page.editing}
					<button type="button" class="secondary" onclick={() => page.edit()}>{t('books.edit')}</button>
				{/if}
			</div>
		</header>
		{#if page.saved}<p class="ok" role="status">{t('books.edit.saved')}</p>{/if}
		<ErrorMessage error={page.error ?? page.annotations.error} />

		{#if page.editing}
			<section class="card edit">
				<ReferenceForm bind:draft={page.draft} disabled={page.saving} />
				<TagInput available={data.tags} bind:value={page.tags} label={t('books.upload.tags')} />
				<div class="buttons">
					<button
						type="button"
						disabled={page.saving || Object.keys(page.problems).length > 0}
						onclick={() => page.save()}>{t('books.edit.save')}</button
					>
					<button type="button" class="secondary" onclick={() => (page.editing = false)}
						>{t('books.edit.cancel')}</button
					>
				</div>
			</section>
		{/if}

		{#if page.book.status !== 'published'}
			<p class="hint">
				{page.book.status === 'queued' ? t('books.queued') : t('books.failed', { error: page.book.error ?? '' })}
			</p>
		{:else}
			<p class="hint">{t('books.viewer.hint')}</p>
			<div class="workspace">
				<div class="pdf">
					{#if page.pdf}
						<Viewer
							pdf={page.pdf}
							name={page.book.original_filename}
							author={displayName()}
							annotations={page.annotations}
							onready={(controls) => page.ready(controls)}
						/>
					{:else if !page.error}
						<p class="hint" role="status">
							{page.progress === null
								? t('books.viewer.loading')
								: t('books.viewer.downloading', { percent: Math.round(page.progress * 100) })}
						</p>
					{/if}
				</div>
				<AnnotationList annotations={page.annotations} controls={page.controls} {catalog} />
			</div>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 90rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-3);
	}
	.back {
		justify-self: start;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.reference {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.actions,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.ok {
		color: var(--ok);
		margin: 0;
	}
	.card {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	/* The PDF and its annotations side by side; stacked on a phone. */
	.workspace {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 20rem;
		gap: var(--space-4);
		height: calc(100dvh - 14rem);
		min-height: 24rem;
	}
	.pdf {
		display: grid;
		min-height: 0;
	}
	@media (max-width: 40rem) {
		.workspace {
			grid-template-columns: 1fr;
			height: auto;
		}
		.pdf {
			height: 75dvh;
		}
	}
</style>
