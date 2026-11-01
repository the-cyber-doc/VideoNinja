<script lang="ts">
	// The Videos page's filter and sort, in a pane over the page (a modal dialog at the
	// right). Every change applies at once; Reset goes back to every video, newest
	// first. What it offers comes from the videos (./filter.ts filterOptions): ranges
	// between their own bounds, lists of the values they use.
	import IconButton from '../IconButton.svelte';
	import RangeSlider from '../RangeSlider.svelte';
	import { i18n, t, type MessageKey } from '../i18n.svelte';
	import { formatTime } from '../time';
	import {
		emptyFilter,
		formatDay,
		SORT_KEYS,
		type FilterOptions,
		type Range,
		type TagOption,
		type VideoFilter
	} from './filter';

	let {
		open = $bindable(),
		filter = $bindable(),
		options,
		shown,
		total
	}: { open: boolean; filter: VideoFilter; options: FilterOptions; shown: number; total: number } = $props();

	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (open && !dialog?.open) dialog?.showModal();
		else if (!open && dialog?.open) dialog.close();
	});

	const id = $props.id();
	const day = (n: number) => formatDay(n, i18n.lang);
	const uploader = (name: string | null) => name ?? t('common.deleted_user');

	/** Checked or not: `item` in or out of the list. */
	function toggle<T>(list: T[], item: T, on: boolean): T[] {
		return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
	}

	// A tag's criterion, read and written by kind (none yet: nothing chosen).
	const tagValues = (tag: string) => {
		const f = filter.tags[tag];
		return f && 'values' in f ? f.values : [];
	};
	const tagRange = (option: Extract<TagOption, { kind: 'range' }>): Range => {
		const f = filter.tags[option.tag.id];
		return f && 'range' in f ? f.range : [option.min, option.max];
	};
	const tagText = (tag: string) => {
		const f = filter.tags[tag];
		return f && 'text' in f ? f.text : '';
	};
	const tagPresent = (tag: string) => {
		const f = filter.tags[tag];
		return !!f && 'present' in f && f.present;
	};

	function reset() {
		filter = emptyFilter();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<header>
		<h2 id="{id}-title">{t('videos.filter.title')}</h2>
		<IconButton label={t('videos.filter.close')} icon="cross" onclick={() => dialog?.close()} />
	</header>
	<p class="hint" role="status">{t('videos.filter.shown', { n: shown, total })}</p>

	<fieldset>
		<legend>{t('videos.filter.sort')}</legend>
		<!-- Explicit labels: a wrapping one would add the chosen option to the select's name. -->
		<div class="sort">
			<label for="{id}-sort">{t('videos.filter.sort_by')}</label>
			<label for="{id}-dir">{t('videos.filter.sort_dir')}</label>
			<select id="{id}-sort" bind:value={filter.sort.key}>
				{#each SORT_KEYS as key (key)}
					<option value={key}>{t(`videos.filter.sort.${key}` as MessageKey)}</option>
				{/each}
			</select>
			<select id="{id}-dir" bind:value={filter.sort.dir}>
				<option value="asc">{t(`videos.filter.asc.${filter.sort.key}` as MessageKey)}</option>
				<option value="desc">{t(`videos.filter.desc.${filter.sort.key}` as MessageKey)}</option>
			</select>
		</div>
	</fieldset>

	{#if options.duration}
		{@const full = options.duration}
		<fieldset>
			<legend>{t('videos.filter.duration')}</legend>
			<RangeSlider
				min={full[0]}
				max={full[1]}
				bind:value={() => filter.duration ?? full, (v) => (filter.duration = v)}
				format={formatTime}
				lowLabel={t('videos.filter.from', { name: t('videos.filter.duration') })}
				highLabel={t('videos.filter.to', { name: t('videos.filter.duration') })}
			/>
		</fieldset>
	{/if}

	{#if options.uploadedAt}
		{@const full = options.uploadedAt}
		<fieldset>
			<legend>{t('videos.filter.uploaded_at')}</legend>
			<RangeSlider
				min={full[0]}
				max={full[1]}
				bind:value={() => filter.uploadedAt ?? full, (v) => (filter.uploadedAt = v)}
				format={day}
				lowLabel={t('videos.filter.from', { name: t('videos.filter.uploaded_at') })}
				highLabel={t('videos.filter.to', { name: t('videos.filter.uploaded_at') })}
			/>
		</fieldset>
	{/if}

	{#if options.uploaders.length}
		<fieldset>
			<legend>{t('videos.filter.uploaded_by')}</legend>
			<div class="choices">
				{#each options.uploaders as name (name)}
					<label class="check">
						<input
							type="checkbox"
							checked={filter.uploadedBy.includes(name)}
							onchange={(e) => (filter.uploadedBy = toggle(filter.uploadedBy, name, e.currentTarget.checked))}
						/>
						{uploader(name)}
					</label>
				{/each}
			</div>
		</fieldset>
	{/if}

	{#each options.tags as option (option.tag.id)}
		{@const tag = option.tag.id}
		<fieldset>
			<legend>{option.tag.name}</legend>
			{#if option.kind === 'list'}
				<div class="choices">
					{#each option.values as value (value.id)}
						<label class="check">
							<input
								type="checkbox"
								checked={tagValues(tag).includes(value.id)}
								onchange={(e) =>
									(filter.tags[tag] = { values: toggle(tagValues(tag), value.id, e.currentTarget.checked) })}
							/>
							{value.name}
						</label>
					{/each}
				</div>
			{:else if option.kind === 'range'}
				<RangeSlider
					min={option.min}
					max={option.max}
					bind:value={() => tagRange(option), (range) => (filter.tags[tag] = { range })}
					lowLabel={t('videos.filter.from', { name: option.tag.name })}
					highLabel={t('videos.filter.to', { name: option.tag.name })}
				/>
			{:else if option.kind === 'text'}
				<input
					type="search"
					aria-label={option.tag.name}
					placeholder={t('videos.filter.contains')}
					value={tagText(tag)}
					oninput={(e) => (filter.tags[tag] = { text: e.currentTarget.value })}
				/>
			{:else}
				<label class="check">
					<input
						type="checkbox"
						checked={tagPresent(tag)}
						onchange={(e) => (filter.tags[tag] = { present: e.currentTarget.checked })}
					/>
					{t('videos.filter.has_tag')}
				</label>
			{/if}
		</fieldset>
	{/each}

	<footer>
		<button type="button" class="secondary" onclick={reset}>{t('videos.filter.reset')}</button>
		<button type="button" onclick={() => dialog?.close()}>{t('videos.filter.done')}</button>
	</footer>
</dialog>

<style>
	/* A pane at the right, the whole height; the whole width on a phone. */
	dialog {
		width: min(24rem, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0 0 0 auto;
		padding: var(--space-4);
		display: none;
		color: var(--text);
		background: var(--surface);
		border: none;
		border-left: 1px solid var(--border);
		box-shadow: var(--shadow-menu);
	}
	dialog[open] {
		display: grid;
		align-content: start;
		gap: var(--space-4);
		overflow-y: auto;
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
	}
	fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}
	legend {
		padding: 0;
		margin-bottom: var(--space-2);
		font-size: var(--text-label);
		font-weight: 600;
	}
	.sort {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-1) var(--space-2);
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
		cursor: pointer;
	}
	footer {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border);
	}
	@media (max-width: 30rem) {
		dialog {
			width: 100vw;
			border-left: none;
		}
	}
</style>
