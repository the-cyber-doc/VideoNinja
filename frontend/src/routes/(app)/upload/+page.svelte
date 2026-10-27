<script lang="ts">
	// Upload and annotate a video. The file is opened on this device; nothing is
	// sent before Proceed. Then the original is uploaded (tus, resumable), submitted
	// with its segments, encoded by the server's queue and published later.
	// The work in progress is saved on this device (draft) and resumed by picking
	// the same file again.
	import { beforeNavigate, goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { Upload } from 'tus-js-client';
	import { url } from '#lib/base.js';
	import { loadCatalog } from '#lib/catalog.svelte.js';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import { hasAccess } from '#lib/session.svelte.js';
	import {
		addPerformer,
		performers as loadPerformers,
		submit,
		tags as loadTags,
		refusal,
		uploadLimits,
		uploadsAvailable,
		videoExists,
		type Performer,
		type Tag,
		type UploadLimits
	} from '#lib/upload/api.js';
	import AnnotationPanel from '#lib/upload/AnnotationPanel.svelte';
	import { deleteDraft, listDrafts, loadDraft, newDraft, saveDraft, type Draft } from '#lib/upload/draft.svelte.js';
	import { sha256File } from '#lib/upload/hash.js';
	import MyUploads from '#lib/upload/MyUploads.svelte';
	import { submitBody } from '#lib/upload/rules.js';
	import { startUpload } from '#lib/upload/upload.js';

	type Step = 'pick' | 'hashing' | 'edit' | 'uploading' | 'submitting';

	const allowed = $derived(hasAccess('upload'));
	const catalog = $derived(loadCatalog());

	let step = $state<Step>('pick');
	let input = $state<HTMLInputElement>();
	let file = $state<File | null>(null);
	let src = $state('');
	let draft = $state<Draft | null>(null);
	let drafts = $state<Draft[]>([]);
	let performers = $state<Performer[]>([]);
	let tags = $state<Tag[]>([]);
	let hashProgress = $state(0);
	let uploadProgress = $state(0);
	let duplicate = $state(false);
	let resumed = $state(false);
	let message = $state('');
	let error = $state('');
	let refresh = $state(0);
	let unavailable = $state(false); // the server cannot receive uploads (tusd not running)
	let limits = $state<UploadLimits | null>(null); // largest file, accepted types
	let retrying = $state(false); // upload interrupted, being retried
	let hashing: AbortController | null = null;
	let upload: Upload | null = null;

	const busy = $derived(step === 'hashing' || step === 'uploading' || step === 'submitting');

	$effect(() => {
		if (!allowed) {
			goto(url('/'), { replace: true });
			return;
		}
		loadPerformers().then((list) => (performers = list), (e) => (error = e.message));
		listDrafts().then((list) => (drafts = list), () => {});
		checkAvailable();
		uploadLimits().then((l) => (limits = l), () => {});
	});

	$effect(() => {
		if (!allowed) return;
		void i18n.lang; // reload on language change: tag names are translated by the server
		loadTags().then((list) => (tags = list), (e) => (error = e.message));
	});

	function checkAvailable() {
		uploadsAvailable().then((ok) => (unavailable = !ok), () => {});
	}

	// Save the draft shortly after every change.
	let saveTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		if (!draft || step === 'pick') return;
		JSON.stringify(draft); // read everything: any change saves
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => draft && saveDraft(draft).catch(() => {}), 400);
	});

	// Hashing or uploading: leaving stops it (the draft is kept; the upload resumes later).
	beforeNavigate(({ cancel, willUnload }) => {
		if (busy && !willUnload && !confirm(t('upload.leave_confirm'))) cancel();
	});
	onDestroy(() => {
		hashing?.abort();
		upload?.abort(); // not terminated: resumed from the draft
		if (src) URL.revokeObjectURL(src);
	});

	function reset() {
		if (src) URL.revokeObjectURL(src);
		file = null;
		src = '';
		draft = null;
		step = 'pick';
		hashProgress = uploadProgress = 0;
		duplicate = resumed = false;
		upload = null;
		if (input) input.value = '';
		listDrafts().then((list) => (drafts = list), () => {});
	}

	async function choose() {
		const chosen = input?.files?.[0];
		if (!chosen) return;
		reset();
		message = error = '';
		// Refused by the server anyway: said at once, before hashing a large file for nothing.
		const refused = refusal(chosen, limits);
		if (refused) {
			error =
				refused === 'size'
					? t('upload.too_large', { max: gigabytes(limits!.max_bytes) })
					: t('upload.wrong_type', { types: limits!.extensions.join(', ') });
			if (input) input.value = '';
			return;
		}
		file = chosen;
		step = 'hashing';
		checkAvailable(); // it may have come back since the page was opened
		hashing = new AbortController();
		try {
			const sha = await sha256File(chosen, (f) => (hashProgress = f), hashing.signal);
			if (await videoExists(sha)) {
				duplicate = true;
				step = 'pick';
				return;
			}
			const saved = await loadDraft(sha).catch(() => undefined);
			resumed = !!saved;
			draft = saved ?? newDraft(sha, chosen);
			src = URL.createObjectURL(chosen);
			step = 'edit';
		} catch (e) {
			if (!hashing?.signal.aborted) {
				error = (e as Error).message;
				step = 'pick';
			}
		}
	}

	const gigabytes = (bytes: number) =>
		new Intl.NumberFormat(i18n.lang, { maximumSignificantDigits: 3 }).format(bytes / 1024 ** 3);

	async function newPerformer(name: string) {
		const performer = await addPerformer(name);
		performers = [...performers, performer];
		return performer;
	}

	/** Called by the panel once the annotation is complete. */
	function proceed() {
		if (!draft || !file || unavailable) return;
		error = message = '';
		step = 'uploading';
		uploadProgress = 0;
		retrying = false;
		const current = draft;
		upload = startUpload(file, { sha256: current.sha256, originalFilename: current.originalFilename, uploadUrl: current.uploadUrl }, {
			onUrl: (url) => (current.uploadUrl = url),
			onProgress: (f) => {
				uploadProgress = f;
				retrying = false;
			},
			onRetry: () => (retrying = true),
			onSuccess: async (tusId) => {
				step = 'submitting';
				try {
					await submit(tusId, submitBody(current));
					await deleteDraft(current.sha256).catch(() => {});
					reset();
					message = t('upload.submitted');
					refresh++;
				} catch (e) {
					error = (e as Error).message;
					step = 'edit';
				}
			},
			onError: (e) => {
				// The server forgot this upload (expired, deleted): start over next time.
				const status = (e as { originalResponse?: { getStatus(): number } }).originalResponse?.getStatus();
				if (status === 404 || status === 410) current.uploadUrl = undefined;
				error = t('upload.failed', { error: e.message });
				retrying = false;
				step = 'edit';
				checkAvailable();
			}
		});
	}

	async function cancel() {
		if (!confirm(t('upload.cancel_confirm'))) return;
		hashing?.abort();
		await upload?.abort(true).catch(() => {}); // also deletes what was uploaded
		if (draft) await deleteDraft(draft.sha256).catch(() => {});
		reset();
	}

	async function discard(sha256: string) {
		await deleteDraft(sha256).catch(() => {});
		drafts = drafts.filter((d) => d.sha256 !== sha256);
	}
</script>

<svelte:window onbeforeunload={(e) => busy && e.preventDefault()} />

{#if allowed}
	<div class="page">
		<h1>{t('upload.title')}</h1>

		{#if unavailable}<p class="error" role="alert">{t('upload.unavailable')}</p>{/if}
		{#if message}<p class="ok" role="status">{message}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<section class="card">
			<label class="file">
				{t('upload.choose')}
				<input
					bind:this={input}
					type="file"
					accept={limits ? limits.extensions.map((e) => `.${e}`).join(',') : 'video/*'}
					onchange={choose}
					disabled={busy}
				/>
			</label>
			<p class="hint">{t('upload.hint_local')}</p>

			{#if step === 'hashing'}
				<label class="bar">
					{t('upload.hashing')}
					<progress max="1" value={hashProgress}></progress>
				</label>
			{/if}
			{#if duplicate}<p class="error">{t('upload.duplicate')}</p>{/if}
			{#if resumed}<p class="ok">{t('upload.resumed')}</p>{/if}

			{#if step === 'pick' && drafts.length}
				<div class="drafts">
					<h2>{t('upload.drafts')}</h2>
					<p class="hint">{t('upload.draft_resume_hint')}</p>
					<ul>
						{#each drafts as d (d.sha256)}
							<li>
								<span>{d.originalFilename}</span>
								<span class="hint">{t('upload.draft_segments', { n: d.segments.length })}</span>
								<button type="button" class="secondary" onclick={() => discard(d.sha256)}>
									{t('upload.draft_discard')}
								</button>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</section>

		{#if draft && src && step !== 'hashing'}
			{#await catalog then c}
				<AnnotationPanel
					{src}
					filename={draft.originalFilename}
					bind:annotation={draft}
					catalog={c}
					{performers}
					{tags}
					{busy}
					blocker={unavailable ? t('upload.reason.unavailable') : ''}
					onaddperformer={newPerformer}
					onproceed={proceed}
					oncancel={cancel}
				>
					{#if step === 'uploading' || step === 'submitting'}
						<label class="bar">
							{t('upload.step.upload')}
							<progress max="1" value={uploadProgress}></progress>
						</label>
						{#if retrying}<p class="error" role="status">{t('upload.retrying')}</p>{/if}
						{#if step === 'submitting'}<p class="hint">{t('upload.step.submit')}</p>{/if}
					{/if}
				</AnnotationPanel>
			{/await}
		{/if}

		<MyUploads {refresh} />
	</div>
{/if}

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		display: grid;
		gap: 1rem;
	}
	h1 {
		text-align: center;
		margin-bottom: 0;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.5rem;
	}
	.card {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.file input {
		padding: 0.4rem;
	}
	.bar {
		display: grid;
		gap: 0.25rem;
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
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.drafts li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.drafts li span:first-child {
		flex: 1;
		overflow-wrap: anywhere;
	}
</style>
