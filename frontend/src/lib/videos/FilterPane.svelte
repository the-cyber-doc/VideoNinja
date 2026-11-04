<script lang="ts">
	// The Videos page's filter and sort, in a pane over the page ($lib/filters/FilterDialog).
	// Every change applies at once; Reset goes back to every video, newest first. What it
	// offers comes from the videos (./filter.ts filterOptions): ranges between their own
	// bounds, lists of the values they use.
	import Checklist from '../filters/Checklist.svelte';
	import FilterDialog from '../filters/FilterDialog.svelte';
	import SortFields from '../filters/SortFields.svelte';
	import TagFilters from '../filters/TagFilters.svelte';
	import RangeSlider from '../RangeSlider.svelte';
	import { i18n, t, type MessageKey } from '../i18n.svelte';
	import { formatTime } from '../time';
	import { emptyFilter, formatDay, SORT_KEYS, type FilterOptions, type VideoFilter } from './filter';

	let {
		open = $bindable(),
		filter = $bindable(),
		options,
		shown,
		total
	}: { open: boolean; filter: VideoFilter; options: FilterOptions; shown: number; total: number } = $props();

	const day = (n: number) => formatDay(n, i18n.lang);
</script>

<FilterDialog bind:open shown={t('videos.filter.shown', { n: shown, total })} onreset={() => (filter = emptyFilter())}>
	<SortFields
		bind:sort={filter.sort}
		keys={SORT_KEYS}
		keyLabel={(key) => t(`videos.filter.sort.${key}` as MessageKey)}
		dirLabel={(key, dir) => t(`videos.filter.${dir}.${key}` as MessageKey)}
	/>

	{#if options.duration}
		{@const full = options.duration}
		<fieldset>
			<legend>{t('videos.filter.duration')}</legend>
			<RangeSlider
				min={full[0]}
				max={full[1]}
				bind:value={() => filter.duration ?? full, (v) => (filter.duration = v)}
				format={formatTime}
				lowLabel={t('filter.from', { name: t('videos.filter.duration') })}
				highLabel={t('filter.to', { name: t('videos.filter.duration') })}
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
				lowLabel={t('filter.from', { name: t('videos.filter.uploaded_at') })}
				highLabel={t('filter.to', { name: t('videos.filter.uploaded_at') })}
			/>
		</fieldset>
	{/if}

	{#if options.uploaders.length}
		<Checklist
			legend={t('videos.filter.uploaded_by')}
			items={options.uploaders.map((name) => ({ value: name, label: name ?? t('common.deleted_user') }))}
			bind:selected={filter.uploadedBy}
		/>
	{/if}

	<TagFilters options={options.tags} bind:tags={filter.tags} />
</FilterDialog>
