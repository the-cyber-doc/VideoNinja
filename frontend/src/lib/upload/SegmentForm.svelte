<script lang="ts">
	// One segment: its times, school › level › technique (each choice narrows the
	// next), performer (or a new one), tags. All but tags are mandatory.
	import { techniquesOf, type Catalog } from '../catalog.svelte';
	import Icon from '../Icon.svelte';
	import { t } from '../i18n.svelte';
	import { displayName } from '../session.svelte';
	import { formatTime } from '../time';
	import type { Performer, Tag } from './api';
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
		onselect: () => void;
		onaddperformer: (name: string) => Promise<Performer>;
		ondelete: () => void;
	} = $props();

	const ADD = '\u0000add'; // the "Add a performer…" option
	let adding = $state(false);
	let newName = $state('');
	let addError = $state('');
	const techniques = $derived(
		segment.school && segment.level ? techniquesOf(catalog, segment.school, segment.level) : []
	);
	const missing = (field: SegmentField) => problems.includes(field);
	// Not set: a new segment, mine. null: its author is unknown.
	const author = $derived(segment.createdBy === undefined ? displayName() : segment.createdBy);
	const time = (seconds: number) => `${formatTime(Math.floor(seconds))}.${Math.floor((seconds % 1) * 10)}`;

	function schoolChanged() {
		segment.level = '';
		segment.technique = '';
	}

	function performerChanged() {
		if (segment.performer === ADD) {
			segment.performer = '';
			adding = true;
		}
	}

	async function addPerformer() {
		addError = '';
		try {
			const performer = await onaddperformer(newName);
			segment.performer = performer.id;
			adding = false;
			newName = '';
		} catch (e) {
			addError = (e as Error).message;
		}
	}
</script>

<article class="segment" class:selected aria-label={t('upload.segment_n', { n: number })}>
	<header>
		<button type="button" class="link" onclick={onselect}>
			<strong>{t('upload.segment_n', { n: number })}</strong>
			<span class:invalid={missing('times')}>{time(segment.begin)} – {time(segment.end)}</span>
		</button>
		<span class="author">{t('upload.segment.created_by', { name: author ?? t('upload.deleted_user') })}</span>
		<button
			type="button"
			class="icon"
			title={t('upload.segment.delete')}
			aria-label={t('upload.segment.delete')}
			onclick={ondelete}
		>
			<Icon name="cross" size={16} />
		</button>
	</header>
	{#if missing('times')}
		<p class="error">{t('upload.segment.bad_times')}</p>
	{/if}

	<div class="fields">
		<label class:invalid={missing('school')}>
			{t('upload.segment.school')}
			<select bind:value={segment.school} onchange={schoolChanged} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each catalog.schools as school (school.id)}
					<option value={school.id}>{school.romaji}</option>
				{/each}
			</select>
		</label>
		<label class:invalid={missing('level')}>
			{t('upload.segment.level')}
			<select bind:value={segment.level} onchange={() => (segment.technique = '')} disabled={!segment.school} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each catalog.levels as level (level.id)}
					<option value={level.id}>{level.romaji}</option>
				{/each}
			</select>
		</label>
		<label class:invalid={missing('technique')}>
			{t('upload.segment.technique')}
			<select bind:value={segment.technique} disabled={!techniques.length} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each techniques as technique (technique.id)}
					<option value={technique.id}>{technique.romaji}</option>
				{/each}
			</select>
		</label>
		<label class:invalid={missing('performer')}>
			{t('upload.segment.performer')}
			{#if adding}
				<span class="add">
					<input bind:value={newName} placeholder={t('upload.segment.performer_name')} aria-label={t('upload.segment.performer_name')} maxlength="64" />
					<button type="button" class="secondary" disabled={!newName.trim()} onclick={addPerformer}>{t('upload.add')}</button>
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
	{#if addError}<p class="error">{addError}</p>{/if}
	<TagInput available={tags} bind:value={segment.tags} label={t('upload.tags')} />
</article>

<style>
	.segment {
		display: grid;
		gap: 0.6rem;
		padding: 0.8rem 1rem;
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
		gap: 0.5rem;
	}
	header .link {
		margin-right: auto;
	}
	.author {
		font-size: 0.85rem;
		color: var(--muted);
		text-align: right;
	}
	button.link {
		display: flex;
		gap: 0.75rem;
		padding: 0;
		font-weight: normal;
		color: var(--text);
		background: none;
	}
	button.icon {
		display: grid;
		place-items: center;
		padding: 0.3rem;
		color: var(--muted);
		background: none;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.6rem;
	}
	.invalid {
		color: var(--error);
	}
	label.invalid select {
		border-color: var(--error);
	}
	.add {
		display: flex;
		gap: 0.3rem;
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
</style>
