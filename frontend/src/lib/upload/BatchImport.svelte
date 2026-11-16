<script lang="ts">
	// Mass import, on the upload page: video files added in as many picks as wanted, the
	// tags of every video, then Process: each one hashed, uploaded and queued (no segments:
	// added later on the Videos page). Steps and state: ./batch.svelte.ts (BatchImport).
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { Tag, UploadLimits } from '../api/types';
	import ErrorMessage from '../ErrorMessage.svelte';
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';
	import { BatchImport, sizeText, type BatchItem } from './batch.svelte';
	import TagInput from './TagInput.svelte';

	let {
		tags,
		limits,
		unavailable = false,
		onsubmitted = () => {}
	}: {
		tags: Tag[];
		limits: UploadLimits | null;
		unavailable?: boolean;
		/** A video was queued (each time). */
		onsubmitted?: () => void;
	} = $props();
	// The limits and availability the page opened with (rechecked by Process).
	// svelte-ignore state_referenced_locally
	const batch = new BatchImport(limits, unavailable);
	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (batch.submitted) untrack(onsubmitted); // what it reads is not this effect's
	});

	beforeNavigate(({ cancel, willUnload }) => {
		if (batch.running && !willUnload && !confirm(t('upload.leave_confirm'))) cancel();
	});
	$effect(() => () => batch.dispose());

	function add() {
		if (input?.files) batch.add(input.files);
		if (input) input.value = ''; // the button can be used again, even for the same files
	}

	const percent = (item: BatchItem) => Math.round(item.progress * 100);
</script>

<svelte:window onbeforeunload={(e) => batch.running && e.preventDefault()} />

<section class="card batch" id="batch" aria-labelledby="batch-title">
	<h2 id="batch-title">{t('upload.batch.title')}</h2>
	<p class="hint">{t('upload.batch.intro')}</p>

	<label class="file">
		{t('upload.batch.choose')}
		<input
			bind:this={input}
			type="file"
			multiple
			accept={limits ? limits.extensions.map((e) => `.${e}`).join(',') : 'video/*'}
			onchange={add}
		/>
	</label>

	{#if batch.items.length}
		<ul class="files" aria-label={t('upload.batch.list')}>
			{#each batch.items as item (item.key)}
				<li data-status={item.status}>
					<span class="name">{item.file.name}</span>
					<span class="hint">{sizeText(item.file.size)}</span>
					<span class="status">{t(`upload.batch.status.${item.status}`, { n: percent(item) })}</span>
					{#if item.key !== batch.current}
						<IconButton
							label={t('upload.batch.remove', { name: item.file.name })}
							icon="cross"
							iconSize={14}
							variant="quiet"
							size="sm"
							round
							onclick={() => batch.remove(item.key)}
						/>
					{/if}
					{#if item.status === 'hashing' || item.status === 'uploading'}
						<progress max="1" value={item.progress} aria-label={item.file.name}></progress>
					{/if}
					{#if item.retrying}<ErrorMessage error={t('upload.retrying')} role="status" />{/if}
					<ErrorMessage error={item.error} role={null} />
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">{t('upload.batch.empty')}</p>
	{/if}

	<TagInput available={tags} bind:value={batch.tags} label={t('upload.batch.tags')} />

	<ErrorMessage error={batch.error} />
	{#if !batch.running && batch.queued}
		<p class="ok" role="status">{t('upload.batch.queued', { n: batch.queued })}</p>
	{/if}

	<div class="buttons">
		{#if batch.running}
			<button type="button" class="secondary" onclick={() => batch.stop()}>{t('upload.batch.stop')}</button>
		{:else}
			<button type="button" disabled={!batch.pending} onclick={() => batch.process()}>
				{t('upload.batch.process', { n: batch.pending })}
			</button>
		{/if}
		{#if batch.finished}
			<button type="button" class="secondary" onclick={() => batch.removeFinished()}>
				{t('upload.batch.remove_finished')}
			</button>
		{/if}
	</div>
</section>

<style>
	.card {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0;
	}
	.hint {
		margin: 0;
	}
	.file {
		display: grid;
		gap: var(--space-1);
	}
	.file input {
		padding: var(--space-2);
	}
	.files {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.files li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	.name {
		flex: 1;
		overflow-wrap: anywhere;
	}
	.status {
		font-size: var(--text-sm);
	}
	[data-status='done'] .status {
		color: var(--ok);
	}
	progress {
		flex-basis: 100%;
		width: 100%;
	}
	.ok {
		color: var(--ok);
		margin: 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
