<script lang="ts">
	// The Books page's filter and sort, in a pane over the page ($lib/filters/FilterDialog).
	// Every change applies at once; Reset goes back to every book, newest first. What it
	// offers comes from the books (./filter.ts filterOptions): their years, names, types,
	// languages, publishers, uploaders and tags.
	import Checklist from '../filters/Checklist.svelte';
	import FilterDialog from '../filters/FilterDialog.svelte';
	import { formatDay } from '../filters/common';
	import SortFields from '../filters/SortFields.svelte';
	import TagFilters from '../filters/TagFilters.svelte';
	import RangeSlider from '../RangeSlider.svelte';
	import { i18n, t, type MessageKey } from '../i18n.svelte';
	import { emptyFilter, SORT_KEYS, type BookFilter, type FilterOptions } from './filter';

	let {
		open = $bindable(),
		filter = $bindable(),
		options,
		shown,
		total
	}: { open: boolean; filter: BookFilter; options: FilterOptions; shown: number; total: number } = $props();

	const day = (n: number) => formatDay(n, i18n.lang);
	/** A language code as its name in the page's language ("ja" → "Japanese"); else the code. */
	function language(code: string) {
		try {
			return new Intl.DisplayNames(i18n.lang, { type: 'language' }).of(code) ?? code;
		} catch {
			return code;
		}
	}
	const plain = (values: string[]) => values.map((value) => ({ value, label: value }));
</script>

<FilterDialog bind:open shown={t('books.filter.shown', { n: shown, total })} onreset={() => (filter = emptyFilter())}>
	<SortFields
		bind:sort={filter.sort}
		keys={SORT_KEYS}
		keyLabel={(key) => t(`books.filter.sort.${key}` as MessageKey)}
		dirLabel={(key, dir) => t(`books.filter.${dir}.${key}` as MessageKey)}
	/>

	<fieldset>
		<legend>{t('books.filter.text')}</legend>
		<input
			type="search"
			aria-label={t('books.filter.text')}
			placeholder={t('books.filter.text_placeholder')}
			bind:value={filter.text}
		/>
	</fieldset>

	{#if options.year}
		{@const full = options.year}
		<fieldset>
			<legend>{t('books.filter.year')}</legend>
			<RangeSlider
				min={full[0]}
				max={full[1]}
				bind:value={() => filter.year ?? full, (v) => (filter.year = v)}
				lowLabel={t('filter.from', { name: t('books.filter.year') })}
				highLabel={t('filter.to', { name: t('books.filter.year') })}
			/>
		</fieldset>
	{/if}

	{#if options.authors.length}
		<Checklist legend={t('books.filter.authors')} items={plain(options.authors)} bind:selected={filter.authors} />
	{/if}
	{#if options.types.length > 1}
		<Checklist
			legend={t('books.filter.types')}
			items={options.types.map((type) => ({ value: type, label: t(`books.reference.type.${type}` as MessageKey) }))}
			bind:selected={filter.types}
		/>
	{/if}
	{#if options.languages.length}
		<Checklist
			legend={t('books.filter.languages')}
			items={options.languages.map((code) => ({ value: code, label: language(code) }))}
			bind:selected={filter.languages}
		/>
	{/if}
	{#if options.publishers.length}
		<Checklist
			legend={t('books.filter.publishers')}
			items={plain(options.publishers)}
			bind:selected={filter.publishers}
		/>
	{/if}

	{#if options.uploadedAt}
		{@const full = options.uploadedAt}
		<fieldset>
			<legend>{t('books.filter.uploaded_at')}</legend>
			<RangeSlider
				min={full[0]}
				max={full[1]}
				bind:value={() => filter.uploadedAt ?? full, (v) => (filter.uploadedAt = v)}
				format={day}
				lowLabel={t('filter.from', { name: t('books.filter.uploaded_at') })}
				highLabel={t('filter.to', { name: t('books.filter.uploaded_at') })}
			/>
		</fieldset>
	{/if}

	{#if options.uploaders.length}
		<Checklist
			legend={t('books.filter.uploaded_by')}
			items={options.uploaders.map((name) => ({ value: name, label: name ?? t('common.deleted_user') }))}
			bind:selected={filter.uploadedBy}
		/>
	{/if}

	<TagFilters options={options.tags} bind:tags={filter.tags} />
</FilterDialog>
