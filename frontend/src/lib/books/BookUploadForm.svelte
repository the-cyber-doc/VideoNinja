<script lang="ts">
	// Uploading a book (PDF), at the end of the upload page (the 'book_mgmt' access): read on
	// this device first (its page count, its own title and author, its first page as the
	// thumbnail), then its reference and tags, then sent (tus) and queued; the server
	// publishes it within seconds. Steps and state: ./upload.svelte.ts (BookUpload).
	import { beforeNavigate } from '$app/navigation';
	import type { Tag } from '../api/types';
	import { url } from '../base';
	import ErrorMessage from '../ErrorMessage.svelte';
	import { t } from '../i18n.svelte';
	import TagInput from '../upload/TagInput.svelte';
	import ReferenceForm from './ReferenceForm.svelte';
	import { BookUpload } from './upload.svelte';

	let { tags, maxBytes }: { tags: Tag[]; maxBytes: number | null } = $props();
	// The largest PDF the page opened with (the server checks anyway).
	// svelte-ignore state_referenced_locally
	const flow = new BookUpload(maxBytes);
	let input: HTMLInputElement | undefined = $state();

	beforeNavigate(({ cancel, willUnload }) => {
		if (flow.busy && !willUnload && !confirm(t('books.upload.leave_confirm'))) cancel();
	});

	function choose() {
		const file = input?.files?.[0];
		if (file) void flow.choose(file);
		if (input) input.value = ''; // the same file can be chosen again
	}
	async function cancel() {
		if (flow.step === 'edit' || confirm(t('books.upload.cancel_confirm'))) await flow.cancel();
	}
</script>

<svelte:window onbeforeunload={(e) => flow.busy && e.preventDefault()} />

<section class="book-upload" id="book" aria-labelledby="book-upload-title">
	<h2 id="book-upload-title">{t('books.upload.title')}</h2>
	<p class="hint">{t('books.upload.intro')}</p>
	<ErrorMessage error={flow.error} />
	{#if flow.step === 'done'}
		<p class="ok" role="status">
			{t('books.upload.done')} <a href={url('/books')}>{t('books.upload.to_books')}</a>
		</p>
	{/if}

	<section class="card">
		<label class="file">
			{t('books.upload.choose')}
			<input bind:this={input} type="file" accept=".pdf,application/pdf" onchange={choose} disabled={flow.busy} />
		</label>
		{#if flow.step === 'hashing'}
			<label class="bar">
				{t('upload.hashing')}
				<progress max="1" value={flow.hashProgress}></progress>
			</label>
		{:else if flow.step === 'reading'}
			<p class="hint" role="status">{t('books.upload.reading')}</p>
		{/if}
	</section>

	{#if flow.file && (flow.step === 'edit' || flow.step === 'uploading' || flow.step === 'submitting')}
		<section class="card edit">
			<div class="about">
				{#if flow.thumbnailSrc}
					<img src={flow.thumbnailSrc} alt={t('books.upload.first_page')} />
				{:else}
					<p class="hint">{t('books.upload.no_picture')}</p>
				{/if}
				<p class="file-name">{flow.file.name}</p>
				{#if flow.pages}<p class="hint">{t('books.pages', { n: flow.pages })}</p>{/if}
			</div>
			<div class="form">
				<ReferenceForm bind:draft={flow.draft} disabled={flow.step !== 'edit'} />
				<TagInput available={tags} bind:value={flow.tags} label={t('books.upload.tags')} />
				{#if flow.step !== 'edit'}
					<label class="bar">
						{t('books.upload.sending')}
						<progress max="1" value={flow.uploadProgress}></progress>
					</label>
					{#if flow.retrying}<ErrorMessage error={t('upload.retrying')} role="status" />{/if}
					{#if flow.step === 'submitting'}<p class="hint">{t('books.upload.submitting')}</p>{/if}
				{/if}
				<div class="buttons">
					<button
						type="button"
						disabled={flow.step !== 'edit' || Object.keys(flow.problems).length > 0}
						onclick={() => flow.proceed()}
					>
						{t('books.upload.send')}
					</button>
					<button type="button" class="secondary" onclick={cancel}>{t('books.upload.cancel')}</button>
				</div>
			</div>
		</section>
	{/if}
</section>

<style>
	.book-upload {
		display: grid;
		gap: var(--space-3);
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0;
	}
	.card {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.file input {
		padding: var(--space-2);
	}
	.bar {
		display: grid;
		gap: var(--space-1);
	}
	progress {
		width: 100%;
	}
	.ok {
		color: var(--ok);
		margin: 0;
	}
	.edit {
		grid-template-columns: 12rem 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	@media (max-width: 40rem) {
		.edit {
			grid-template-columns: 1fr;
		}
	}
	.about {
		display: grid;
		gap: var(--space-1);
	}
	.about img {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.about p {
		margin: 0;
	}
	.file-name {
		overflow-wrap: anywhere;
		font-size: var(--text-sm);
	}
	.form {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
