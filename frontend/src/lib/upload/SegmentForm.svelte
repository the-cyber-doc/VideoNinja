<script lang="ts">
	// One segment: its times, school › category › weapon (under Buki only) › section ›
	// technique (each choice narrows the next and resets those after it; a step with
	// a single choice is filled in), performer (or a new one), tags. All but tags are
	// mandatory.
	import ErrorMessage from '../ErrorMessage.svelte';
	import {
		BUKI,
		categoriesOf,
		sectionsOf,
		techniquesOf,
		weaponsOf,
		type Catalog
	} from '../catalog.svelte';
	import IconButton from '../IconButton.svelte';
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
	let addError = $state<unknown>(null);
	const categories = $derived(segment.school ? categoriesOf(catalog, segment.school) : []);
	const weapons = $derived(segment.category === BUKI ? weaponsOf(catalog, segment.school) : []);
	const sections = $derived(
		segment.category && (segment.category !== BUKI || segment.weapon)
			? sectionsOf(catalog, segment.school, segment.category, segment.weapon || undefined)
			: []
	);
	const techniques = $derived(segment.section ? techniquesOf(catalog, segment.section) : []);
	const missing = (field: SegmentField) => problems.includes(field);
	// Not set: a new segment, mine. null: its author is unknown.
	const author = $derived(segment.createdBy === undefined ? displayName() : segment.createdBy);
	const time = (seconds: number) => `${formatTime(Math.floor(seconds))}.${Math.floor((seconds % 1) * 10)}`;

	const STEPS = ['school', 'category', 'weapon', 'section', 'technique'] as const;
	type Step = (typeof STEPS)[number];

	/** `step` was chosen: the steps after it start again, filled in when there is a single choice. */
	function changed(step: Step) {
		for (const next of STEPS.slice(STEPS.indexOf(step) + 1)) segment[next] = '';
		const only = <T extends { id: string }>(list: T[]) => (list.length === 1 ? list[0].id : '');
		if (!segment.category) segment.category = only(categoriesOf(catalog, segment.school));
		if (segment.category === BUKI && !segment.weapon) segment.weapon = only(weaponsOf(catalog, segment.school));
		if (!segment.section && segment.category && (segment.category !== BUKI || segment.weapon)) {
			segment.section = only(sectionsOf(catalog, segment.school, segment.category, segment.weapon || undefined));
		}
		if (!segment.technique && segment.section) segment.technique = only(techniquesOf(catalog, segment.section));
	}

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

<article class="segment" class:selected aria-label={t('upload.segment_n', { n: number })}>
	<header>
		<button type="button" class="link" onclick={onselect}>
			<strong>{t('upload.segment_n', { n: number })}</strong>
			<span class:invalid={missing('times')}>{time(segment.begin)} – {time(segment.end)}</span>
		</button>
		<span class="author">{t('upload.segment.created_by', { name: author ?? t('upload.deleted_user') })}</span>
		<IconButton label={t('upload.segment.delete')} icon="cross" iconSize={16} variant="quiet" onclick={ondelete} />
	</header>
	{#if missing('times')}
		<ErrorMessage error={t('upload.segment.bad_times')} role={null} />
	{/if}

	<div class="fields">
		<label class:invalid={missing('school')}>
			{t('upload.segment.school')}
			<select bind:value={segment.school} onchange={() => changed('school')} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each catalog.schools as school (school.id)}
					<option value={school.id}>{school.romaji}</option>
				{/each}
			</select>
		</label>
		<label class:invalid={missing('category')}>
			{t('upload.segment.category')}
			<select bind:value={segment.category} onchange={() => changed('category')} disabled={!categories.length} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each categories as category (category.id)}
					<option value={category.id}>{category.romaji}</option>
				{/each}
			</select>
		</label>
		{#if segment.category === BUKI}
			<label class:invalid={missing('weapon')}>
				{t('upload.segment.weapon')}
				<select bind:value={segment.weapon} onchange={() => changed('weapon')} required>
					<option value="">{t('upload.segment.choose')}</option>
					{#each weapons as weapon (weapon.id)}
						<option value={weapon.id}>{weapon.romaji}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class:invalid={missing('section')}>
			{t('upload.segment.section')}
			<select bind:value={segment.section} onchange={() => changed('section')} disabled={!sections.length} required>
				<option value="">{t('upload.segment.choose')}</option>
				{#each sections as section (section.id)}
					<option value={section.id}>{section.romaji}</option>
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
