<script lang="ts">
	// One segment: its times, its technique (../TechniquePicker: school › … › technique),
	// performer (or a new one), tags. All but tags are mandatory.
	import ErrorMessage from '../ErrorMessage.svelte';
	import type { Catalog } from '../catalog.svelte';
	import IconButton from '../IconButton.svelte';
	import TechniquePicker from '../TechniquePicker.svelte';
	import { t } from '../i18n.svelte';
	import { displayName } from '../session.svelte';
	import { formatTime } from '../time';
	import type { Performer, Tag } from '../api/types';
	import type { DraftSegment } from './draft.svelte';
	import type { SegmentField } from './rules';
	import TagInput from './TagInput.svelte';

	let {
		segment = $bindable(),
		number,
		catalog,
		performers,
		tags,
		problems,
		selected,
		reveal = false,
		onselect,
		onaddperformer,
		ondelete
	}: {
		segment: DraftSegment;
		number: number;
		catalog: Catalog;
		performers: Performer[];
		tags: Tag[];
		problems: SegmentField[];
		selected: boolean;
		/** Scrolled into view (the segment the page opens on). */
		reveal?: boolean;
		onselect: () => void;
		onaddperformer: (name: string) => Promise<Performer>;
		ondelete: () => void;
	} = $props();

	let article = $state<HTMLElement>();
	$effect(() => {
		if (reveal) article?.scrollIntoView({ block: 'center' });
	});

	const ADD = '\u0000add'; // the "Add a performer…" option
	let adding = $state(false);
	let newName = $state('');
	let addError = $state<unknown>(null);
	const missing = (field: SegmentField) => problems.includes(field);
	// Not set: a new segment, mine. null: its author is unknown.
	const author = $derived(segment.createdBy === undefined ? displayName() : segment.createdBy);
	const time = (seconds: number) => `${formatTime(Math.floor(seconds))}.${Math.floor((seconds % 1) * 10)}`;

	function performerChanged() {
		if (segment.performer === ADD) {
			segment.performer = '';
			adding = true;
		}
	}

	async function addPerformer() {
		addError = null;
		try {
			const performer = await onaddperformer(newName);
			segment.performer = performer.id;
			adding = false;
			newName = '';
		} catch (e) {
			addError = e;
		}
	}
</script>

<article bind:this={article} class="segment" class:selected aria-label={t('upload.segment_n', { n: number })}>
	<header>
		<button type="button" class="link" onclick={onselect}>
			<strong>{t('upload.segment_n', { n: number })}</strong>
			<span class:invalid={missing('times')}>{time(segment.begin)} – {time(segment.end)}</span>
		</button>
		<span class="author">{t('upload.segment.created_by', { name: author ?? t('common.deleted_user') })}</span>
		<IconButton label={t('upload.segment.delete')} icon="cross" iconSize={16} variant="quiet" onclick={ondelete} />
	</header>
	{#if missing('times')}
		<ErrorMessage error={t('upload.segment.bad_times')} role={null} />
	{/if}

	<div class="fields">
		<TechniquePicker bind:place={segment} {catalog} invalid={(step) => missing(step)} />
		<label class:invalid={missing('performer')}>
			{t('upload.segment.performer')}
			{#if adding}
				<span class="add">
					<input
						bind:value={newName}
						placeholder={t('upload.segment.performer_name')}
						aria-label={t('upload.segment.performer_name')}
						maxlength="64"
					/>
					<button type="button" class="secondary" disabled={!newName.trim()} onclick={addPerformer}
						>{t('upload.add')}</button
					>
					<button type="button" class="secondary" onclick={() => (adding = false)}>{t('common.cancel')}</button>
				</span>
			{:else}
				<select bind:value={segment.performer} onchange={performerChanged} required>
					<option value="">{t('upload.segment.choose')}</option>
					{#each performers as performer (performer.id)}
						<option value={performer.id}>{performer.name}</option>
					{/each}
					<option value={ADD}>{t('upload.segment.add_performer')}</option>
				</select>
			{/if}
		</label>
	</div>
	<ErrorMessage error={addError} />
	<TagInput available={tags} bind:value={segment.tags} label={t('upload.tags')} />
</article>

<style>
	.segment {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.segment.selected {
		border-color: var(--accent);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	header .link {
		margin-right: auto;
	}
	.author {
		font-size: var(--text-sm);
		color: var(--muted);
		text-align: right;
	}
	button.link {
		display: flex;
		gap: var(--space-3);
		padding: 0;
		font-weight: normal;
		color: var(--text);
		background: none;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--space-2);
	}
	.invalid {
		color: var(--error);
	}
	label.invalid select {
		border-color: var(--error);
	}
	.add {
		display: flex;
		gap: var(--space-1);
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
</style>
