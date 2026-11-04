<script lang="ts">
	// A filter pane's tags, one fieldset each, by what the items use (common.ts tagOptions):
	// the list values used (checkboxes), numbers (a range), other text (contains), no value
	// (present).
	import { t } from '../i18n.svelte';
	import RangeSlider from '../RangeSlider.svelte';
	import Checklist from './Checklist.svelte';
	import type { Range, TagFilter, TagOption } from './common';

	let { options, tags = $bindable() }: { options: TagOption[]; tags: Record<string, TagFilter> } = $props();

	// A tag's criterion, read by kind (none yet: nothing chosen).
	const tagValues = (tag: string) => {
		const f = tags[tag];
		return f && 'values' in f ? f.values : [];
	};
	const tagRange = (option: Extract<TagOption, { kind: 'range' }>): Range => {
		const f = tags[option.tag.id];
		return f && 'range' in f ? f.range : [option.min, option.max];
	};
	const tagText = (tag: string) => {
		const f = tags[tag];
		return f && 'text' in f ? f.text : '';
	};
	const tagPresent = (tag: string) => {
		const f = tags[tag];
		return !!f && 'present' in f && f.present;
	};
</script>

{#each options as option (option.tag.id)}
	{@const tag = option.tag.id}
	{#if option.kind === 'list'}
		<Checklist
			legend={option.tag.name}
			items={option.values.map((v) => ({ value: v.id, label: v.name }))}
			bind:selected={() => tagValues(tag), (values) => (tags[tag] = { values })}
		/>
	{:else}
		<fieldset>
			<legend>{option.tag.name}</legend>
			{#if option.kind === 'range'}
				<RangeSlider
					min={option.min}
					max={option.max}
					bind:value={() => tagRange(option), (range) => (tags[tag] = { range })}
					lowLabel={t('filter.from', { name: option.tag.name })}
					highLabel={t('filter.to', { name: option.tag.name })}
				/>
			{:else if option.kind === 'text'}
				<input
					type="search"
					aria-label={option.tag.name}
					placeholder={t('filter.contains')}
					value={tagText(tag)}
					oninput={(e) => (tags[tag] = { text: e.currentTarget.value })}
				/>
			{:else}
				<label class="check">
					<input
						type="checkbox"
						checked={tagPresent(tag)}
						onchange={(e) => (tags[tag] = { present: e.currentTarget.checked })}
					/>
					{t('filter.has_tag')}
				</label>
			{/if}
		</fieldset>
	{/if}
{/each}
