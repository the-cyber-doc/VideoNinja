<script lang="ts">
	// Annotating a video: player and timeline (Editor), the video's tags, "define
	// later" / "no technique segment", the segment forms, "all segments done",
	// Cancel / Proceed. Used by the upload page (a local file) and the Videos page
	// (a published video); what Proceed does is the page's.
	import type { Snippet } from 'svelte';
	import type { Catalog } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import type { Performer, Tag } from './api';
	import type { Annotation, Mode } from './draft.svelte';
	import Editor from './Editor.svelte';
	import { allSegmentsDone, canProceed, checkboxLocked, segmentProblems } from './rules';
	import SegmentForm from './SegmentForm.svelte';
	import TagInput from './TagInput.svelte';

	let {
		src,
		annotation = $bindable(),
		catalog,
		performers,
		tags,
		busy = false,
		blocker = '',
		onaddperformer,
		onproceed,
		oncancel,
		children
	}: {
		src: string;
		annotation: Annotation;
		catalog: Catalog;
		performers: Performer[];
		tags: Tag[];
		/** Working (upload, saving): no change, no Proceed. */
		busy?: boolean;
		/** Why Proceed is not possible, from the page (e.g. the server cannot receive uploads). */
		blocker?: string;
		onaddperformer: (name: string) => Promise<Performer>;
		onproceed: () => void;
		oncancel: () => void;
		/** Shown above the buttons (e.g. the upload's progress). */
		children?: Snippet;
	} = $props();

	let duration = $state(0);
	let playable = $state(true);
	let selected = $state<number | null>(null);

	const ready = $derived(!blocker && canProceed(annotation, duration, playable));
	const reason = $derived.by(() => {
		if (ready) return '';
		if (blocker) return blocker;
		if (!playable) return t('upload.reason.not_playable');
		if (annotation.mode === null && !annotation.segments.length) return t('upload.reason.no_segment');
		return t('upload.reason.incomplete');
	});

	function setMode(event: Event, mode: Mode) {
		const n = annotation.segments.length;
		if (mode === 'none' && n && !confirm(t('upload.mode.discard_confirm', { n }))) {
			(event.currentTarget as HTMLInputElement).checked = false;
			return;
		}
		if (mode === 'none') annotation.segments = [];
		annotation.mode = mode;
	}
</script>

<section class="card">
	<Editor {src} bind:draft={annotation} bind:duration bind:playable bind:selected />
	{#if !playable}
		<p class="error">{t('upload.not_playable')}</p>
	{/if}
</section>

<section class="card">
	<TagInput available={tags} bind:value={annotation.tags} label={t('upload.video_tags')} />
</section>

<fieldset class="card mode" disabled={busy}>
	<legend>{t('upload.mode.label')}</legend>
	<label class="choice">
		<input type="radio" name="mode" checked={annotation.mode === 'later'} onchange={(e) => setMode(e, 'later')} />
		{t('upload.mode.later')}
	</label>
	<label class="choice">
		<input type="radio" name="mode" checked={annotation.mode === 'none'} onchange={(e) => setMode(e, 'none')} />
		{t('upload.mode.none')}
	</label>
	<button type="button" class="secondary" disabled={annotation.mode === null} onclick={() => (annotation.mode = null)}>
		{t('upload.mode.clear')}
	</button>
</fieldset>

{#if annotation.mode !== 'none' && playable}
	<section class="segments">
		<h2>{t('upload.segments')}</h2>
		{#if !annotation.segments.length}
			<p class="hint">{t('upload.no_segments_yet')}</p>
		{/if}
		{#each annotation.segments as segment, i (segment.key)}
			<SegmentForm
				bind:segment={annotation.segments[i]}
				number={i + 1}
				{catalog}
				{performers}
				{tags}
				problems={segmentProblems(segment, duration)}
				selected={segment.key === selected}
				onselect={() => (selected = segment.key)}
				{onaddperformer}
				ondelete={() => annotation.segments.splice(i, 1)}
			/>
		{/each}
	</section>
{/if}

<section class="card finish">
	<label class="choice">
		<input
			type="checkbox"
			checked={allSegmentsDone(annotation.mode, annotation.allSegmentsDone)}
			disabled={checkboxLocked(annotation.mode) || busy}
			onchange={(e) => (annotation.allSegmentsDone = e.currentTarget.checked)}
		/>
		{t('upload.all_done')}
	</label>

	{@render children?.()}
	{#if reason}<p class="hint">{reason}</p>{/if}

	<div class="buttons">
		<button type="button" class="secondary" onclick={oncancel}>{t('common.cancel')}</button>
		<button type="button" disabled={!ready || busy} onclick={() => ready && onproceed()}>{t('upload.proceed')}</button>
	</div>
</section>

<style>
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
