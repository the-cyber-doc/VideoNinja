<script lang="ts">
	// Upload and annotate a video. The file is opened on this device; nothing is
	// sent before Proceed. Then the original is uploaded (tus, resumable), submitted
	// with its segments, encoded by the server's queue and published later.
	// The work in progress is saved on this device (draft) and resumed by picking
	// the same file again.
	import { beforeNavigate, goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { Upload } from 'tus-js-client';
	import { loadCatalog } from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import { hasAccess } from '#lib/session.svelte.js';
	import {
		addPerformer,
		performers as loadPerformers,
		submit,
		tags as loadTags,
		uploadsAvailable,
		videoExists,
		type Performer,
		type Tag
	} from '#lib/upload/api.js';
	import {
		deleteDraft,
		listDrafts,
		loadDraft,
		newDraft,
		saveDraft,
		type Draft,
		type Mode
	} from '#lib/upload/draft.svelte.js';
	import Editor from '#lib/upload/Editor.svelte';
	import { sha256File } from '#lib/upload/hash.js';
	import MyUploads from '#lib/upload/MyUploads.svelte';
	import {
		allSegmentsDone,
		canProceed,
		checkboxLocked,
		segmentProblems,
		submitBody
	} from '#lib/upload/rules.js';
	import SegmentForm from '#lib/upload/SegmentForm.svelte';
	import TagInput from '#lib/upload/TagInput.svelte';
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
	let duration = $state(0);
	let playable = $state(true);
	let selected = $state<number | null>(null);
	let duplicate = $state(false);
	let resumed = $state(false);
	let message = $state('');
	let error = $state('');
	let refresh = $state(0);
	let unavailable = $state(false); // the server cannot receive uploads (tusd not running)
	let retrying = $state(false); // upload interrupted, being retried
	let hashing: AbortController | null = null;
	let upload: Upload | null = null;

	const busy = $derived(step === 'hashing' || step === 'uploading' || step === 'submitting');
	const ready = $derived(!!draft && !unavailable && canProceed(draft, duration, playable));
	const reason = $derived.by(() => {
		if (!draft || ready) return '';
		if (unavailable) return t('upload.reason.unavailable');
		if (!playable) return t('upload.reason.not_playable');
		if (draft.mode === null && !draft.segments.length) return t('upload.reason.no_segment');
		return t('upload.reason.incomplete');
	});

	$effect(() => {
		if (!allowed) {
			goto('/', { replace: true });
			return;
		}
		loadPerformers().then((list) => (performers = list), (e) => (error = e.message));
		loadTags().then((list) => (tags = list), (e) => (error = e.message));
		listDrafts().then((list) => (drafts = list), () => {});
		checkAvailable();
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
		hashProgress = uploadProgress = duration = 0;
		playable = true;
		selected = null;
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

	function setMode(event: Event, mode: Mode) {
		if (!draft) return;
		const n = draft.segments.length;
		if (mode === 'none' && n && !confirm(t('upload.mode.discard_confirm', { n }))) {
			(event.currentTarget as HTMLInputElement).checked = false;
			return;
		}
		if (mode === 'none') draft.segments = [];
		draft.mode = mode;
	}

	async function newPerformer(name: string) {
		const performer = await addPerformer(name);
		performers = [...performers, performer];
		return performer;
	}

	function proceed() {
		if (!draft || !file || !ready) return;
		error = message = '';
		step = 'uploading';
		uploadProgress = 0;
		retrying = false;
		const current = draft;
		upload = startUpload(file, { sha256: current.sha256, filename: current.filename, uploadUrl: current.uploadUrl }, {
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
				<input bind:this={input} type="file" accept="video/*" onchange={choose} disabled={busy} />
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
								<span>{d.filename}</span>
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
				<section class="card">
					<Editor {src} bind:draft bind:duration bind:playable bind:selected />
					{#if !playable}
						<p class="error">{t('upload.not_playable')}</p>
					{/if}
				</section>

				<fieldset class="card mode" disabled={busy}>
					<legend>{t('upload.mode.label')}</legend>
					<label class="choice">
						<input type="radio" name="mode" checked={draft.mode === 'later'} onchange={(e) => setMode(e, 'later')} />
						{t('upload.mode.later')}
					</label>
					<label class="choice">
						<input type="radio" name="mode" checked={draft.mode === 'none'} onchange={(e) => setMode(e, 'none')} />
						{t('upload.mode.none')}
					</label>
					<button type="button" class="secondary" disabled={draft.mode === null} onclick={() => draft && (draft.mode = null)}>
						{t('upload.mode.clear')}
					</button>
				</fieldset>

				{#if draft.mode !== 'none' && playable}
					<section class="segments">
						<h2>{t('upload.segments')}</h2>
						{#if !draft.segments.length}
							<p class="hint">{t('upload.no_segments_yet')}</p>
						{/if}
						{#each draft.segments as segment, i (segment.key)}
							<SegmentForm
								bind:segment={draft.segments[i]}
								number={i + 1}
								catalog={c}
								{performers}
								{tags}
								problems={segmentProblems(segment, duration)}
								selected={segment.key === selected}
								onselect={() => (selected = segment.key)}
								onaddperformer={newPerformer}
								ondelete={() => draft?.segments.splice(i, 1)}
							/>
						{/each}
					</section>
				{/if}

				<section class="card">
					<TagInput available={tags} bind:value={draft.tags} label={t('upload.video_tags')} />
				</section>

				<section class="card finish">
					<label class="choice">
						<input
							type="checkbox"
							checked={allSegmentsDone(draft.mode, draft.allSegmentsDone)}
							disabled={checkboxLocked(draft.mode) || busy}
							onchange={(e) => draft && (draft.allSegmentsDone = e.currentTarget.checked)}
						/>
						{t('upload.all_done')}
					</label>

					{#if step === 'uploading' || step === 'submitting'}
						<label class="bar">
							{t('upload.step.upload')}
							<progress max="1" value={uploadProgress}></progress>
						</label>
						{#if retrying}<p class="error" role="status">{t('upload.retrying')}</p>{/if}
						{#if step === 'submitting'}<p class="hint">{t('upload.step.submit')}</p>{/if}
					{/if}
					{#if reason}<p class="hint">{reason}</p>{/if}

					<div class="buttons">
						<button type="button" class="secondary" onclick={cancel}>{t('common.cancel')}</button>
						<button type="button" disabled={!ready || busy} onclick={proceed}>{t('upload.proceed')}</button>
					</div>
				</section>
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
	.mode {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
	}
	.mode legend {
		float: left;
		width: 100%;
		padding: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	label.choice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		color: var(--text);
	}
	.segments {
		display: grid;
		gap: 0.75rem;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
