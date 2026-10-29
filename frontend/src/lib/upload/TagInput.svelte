<script lang="ts">
	// Tags as removable chips. Add: type or pick a tag name (only existing tags:
	// admins define them), then its value: one of its fixed values, or free text.
	// Shown by their (translated) names, kept by ID: a language change relabels them.
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';
	import type { Tag, TagIn } from '../api/types';

	let {
		available,
		value = $bindable(),
		label
	}: { available: Tag[]; value: TagIn[]; label: string } = $props();

	const id = $props.id();
	let name = $state('');
	let tagValue = $state('');
	const unused = $derived(available.filter((tag) => !value.some((v) => v.id === tag.id)));
	const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
	const chosen = $derived(unused.find((tag) => same(tag.name, name.trim())));

	const tagName = (id: string) => available.find((tag) => tag.id === id)?.name ?? id;
	function chip(tag: TagIn) {
		const values = available.find((a) => a.id === tag.id)?.values;
		const value = values ? (values.find((v) => v.id === tag.value)?.name ?? tag.value) : tag.value;
		return value ? t('upload.tag.chip', { name: tagName(tag.id), value }) : tagName(tag.id);
	}

	// The server checks it again.
	const valueOk = $derived.by(() => {
		if (!chosen) return false;
		if (chosen.values) return !!tagValue;
		if (chosen.format === 'year') {
			const year = Number(tagValue);
			return /^[0-9]{4}$/.test(tagValue) && year >= chosen.min! && year <= chosen.max!;
		}
		return true;
	});

	function add() {
		if (!chosen || !valueOk) return;
		value.push(tagValue ? { id: chosen.id, value: tagValue } : { id: chosen.id });
		name = '';
		tagValue = '';
	}
</script>

<fieldset class="tags">
	<legend>{label}</legend>
	{#if value.length}
		<ul>
			{#each value as tag, i (tag.id)}
				<li class="chip">
					{chip(tag)}
					<IconButton label={t('upload.tag.remove', { name: tagName(tag.id) })} icon="cross" iconSize={14} variant="quiet" size="sm" round onclick={() => value.splice(i, 1)} />
				</li>
			{/each}
		</ul>
	{/if}
	{#if !available.length}
		<p class="hint">{t('upload.tag.none')}</p>
	{:else if unused.length}
		<div class="add">
			<input
				list="{id}-names"
				bind:value={name}
				placeholder={t('upload.tag.add')}
				aria-label={t('upload.tag.add')}
				onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
			/>
			<datalist id="{id}-names">
				{#each unused as tag (tag.id)}
					<option value={tag.name}></option>
				{/each}
			</datalist>
			{#if chosen?.values}
				<select bind:value={tagValue} aria-label={t('upload.tag.value')}>
					<option value="">{t('upload.tag.value')}</option>
					{#each chosen.values as v (v.id)}
						<option value={v.id}>{v.name}</option>
					{/each}
				</select>
			{:else if chosen?.format === 'year'}
				<input
					type="number"
					inputmode="numeric"
					min={chosen.min}
					max={chosen.max}
					step="1"
					value={tagValue}
					oninput={(e) => (tagValue = e.currentTarget.value)}
					onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
					placeholder={t('upload.tag.year', { min: chosen.min!, max: chosen.max! })}
					aria-label={t('upload.tag.year', { min: chosen.min!, max: chosen.max! })}
				/>
			{:else if chosen}
				<input bind:value={tagValue} placeholder={t('upload.tag.value')} aria-label={t('upload.tag.value')} maxlength="64" />
			{/if}
			<button type="button" class="secondary" disabled={!valueOk} onclick={add}>
				{t('upload.add')}
			</button>
		</div>
	{/if}
</fieldset>

<style>
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: var(--space-2);
	}
	legend {
		font-size: var(--text-label);
		color: var(--muted);
		padding: 0;
		margin-bottom: var(--space-1);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-0) var(--space-1) var(--space-0) var(--space-2);
		font-size: var(--text-sm);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.add input,
	.add select {
		flex: 1 1 8rem;
		min-width: 0;
	}
</style>
