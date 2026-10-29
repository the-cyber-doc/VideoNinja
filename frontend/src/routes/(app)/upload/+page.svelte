<script lang="ts">
	// Upload and annotate a video: the steps and their state are the flow's
	// (lib/upload/flow.svelte.ts); the page's data (+page.ts: access checked there).
	// Here, the component's own work: the draft saved shortly after every change, the
	// guard against leaving while hashing or uploading, the confirmations.
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { beforeNavigate, invalidate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { addPerformer } from '#lib/api/performers.js';
	import { loadCatalog } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import AnnotationPanel from '#lib/upload/AnnotationPanel.svelte';
	import { saveDraft } from '#lib/upload/draft.svelte.js';
	import { UploadFlow } from '#lib/upload/flow.svelte.js';
	import MyUploads from '#lib/upload/MyUploads.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const catalog = $derived(loadCatalog());
	// The limits and availability the page opened with (rechecked by the flow).
	// svelte-ignore state_referenced_locally
	const flow = new UploadFlow(data.limits, !data.available);
	let input = $state<HTMLInputElement>();

	// Save the draft shortly after every change.
	let saveTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		const draft = flow.draft;
		if (!draft || flow.step === 'pick') return;
		JSON.stringify(draft); // read everything: any change saves
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveDraft(draft).catch(() => {}), 400);
	});

	// Hashing or uploading: leaving stops it (the draft is kept; the upload resumes later).
	beforeNavigate(({ cancel, willUnload }) => {
		if (flow.busy && !willUnload && !confirm(t('upload.leave_confirm'))) cancel();
	});
	onDestroy(() => flow.dispose());

	async function choose() {
		const chosen = input?.files?.[0];
		if (chosen && !(await flow.choose(chosen)) && input) input.value = ''; // refused: pick again
	}

	async function newPerformer(name: string) {
		const performer = await addPerformer(name);
		await invalidate('app:performers');
		return performer;
	}

	async function cancel() {
		if (!confirm(t('upload.cancel_confirm'))) return;
		await flow.cancel();
		if (input) input.value = '';
	}
</script>

<svelte:window onbeforeunload={(e) => flow.busy && e.preventDefault()} />

<div class="page">
	<h1>{t('upload.title')}</h1>

	{#if flow.unavailable}<ErrorMessage error={t('upload.unavailable')} />{/if}
	{#if flow.message}<p class="ok" role="status">{flow.message}</p>{/if}
	<ErrorMessage error={flow.error ?? data.error} />

	<section class="card">
		<label class="file">
			{t('upload.choose')}
			<input
				bind:this={input}
				type="file"
				accept={flow.limits ? flow.limits.extensions.map((e) => `.${e}`).join(',') : 'video/*'}
				onchange={choose}
				disabled={flow.busy}
			/>
		</label>
		<p class="hint">{t('upload.hint_local')}</p>

		{#if flow.step === 'hashing'}
			<label class="bar">
				{t('upload.hashing')}
				<progress max="1" value={flow.hashProgress}></progress>
			</label>
		{/if}
		{#if flow.duplicate}<ErrorMessage error={t('upload.duplicate')} />{/if}
		{#if flow.resumed}<p class="ok">{t('upload.resumed')}</p>{/if}

		{#if flow.step === 'pick' && flow.drafts.length}
			<div class="drafts">
				<h2>{t('upload.drafts')}</h2>
				<p class="hint">{t('upload.draft_resume_hint')}</p>
				<ul>
					{#each flow.drafts as d (d.sha256)}
						<li>
							<span>{d.originalFilename}</span>
							<span class="hint">{t('upload.draft_segments', { n: d.segments.length })}</span>
							<button type="button" class="secondary" onclick={() => flow.discard(d.sha256)}>
								{t('upload.draft_discard')}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</section>

	{#if flow.draft && flow.src && flow.step !== 'hashing'}
		{#await catalog then c}
			<AnnotationPanel
				src={flow.src}
				filename={flow.draft.originalFilename}
				bind:annotation={flow.draft}
				catalog={c}
				performers={data.performers}
				tags={data.tags}
				busy={flow.busy}
				blocker={flow.unavailable ? t('upload.reason.unavailable') : ''}
				onaddperformer={newPerformer}
				onproceed={() => flow.proceed()}
				oncancel={cancel}
			>
				{#if flow.step === 'uploading' || flow.step === 'submitting'}
					<label class="bar">
						{t('upload.step.upload')}
						<progress max="1" value={flow.uploadProgress}></progress>
					</label>
					{#if flow.retrying}<ErrorMessage error={t('upload.retrying')} role="status" />{/if}
					{#if flow.step === 'submitting'}<p class="hint">{t('upload.step.submit')}</p>{/if}
				{/if}
			</AnnotationPanel>
		{/await}
	{/if}

	<MyUploads refresh={flow.submitted} />
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
		margin-bottom: 0;
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0 0 var(--space-2);
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
	.drafts ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.drafts li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.drafts li span:first-child {
		flex: 1;
		overflow-wrap: anywhere;
	}
</style>
