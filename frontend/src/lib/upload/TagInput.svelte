<script lang="ts">
	// Tags as removable chips. Add: type or pick a tag name (only existing tags:
	// admins define them on the Options page), then its value as the tag's rule says:
	// one of its fixed values, text (its hint as placeholder, its keyboard), or none.
	// Shown by their (translated) names, kept by ID: a language change relabels them.
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';
	import { valueProblem } from '../tags';
	import { rules } from '../validation';
	import ErrorMessage from '../ErrorMessage.svelte';
	import type { Tag, TagIn } from '../api/types';

	let { available, value = $bindable(), label }: { available: Tag[]; value: TagIn[]; label: string } = $props();

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

	// The server checks it again. Shown once something is typed.
	const problem = $derived(chosen ? valueProblem(chosen, tagValue.trim()) : null);
	const valueOk = $derived(!!chosen && !problem);

	function add() {
		if (!chosen || !valueOk) return;
		value.push(chosen.format ? { id: chosen.id, value: tagValue.trim() } : { id: chosen.id });
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
					<IconButton
						label={t('upload.tag.remove', { name: tagName(tag.id) })}
						icon="cross"
						iconSize={14}
						variant="quiet"
						size="sm"
						round
						onclick={() => value.splice(i, 1)}
					/>
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
			{:else if chosen?.format}
				{@const label = chosen.hint ?? t('upload.tag.value')}
				<input
					bind:value={tagValue}
					inputmode={chosen.input_mode === 'numeric' ? 'numeric' : 'text'}
					placeholder={label}
					aria-label={label}
					aria-invalid={!!tagValue && !!problem}
					maxlength={rules.tag_value.max_length}
					onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
				/>
			{/if}
			<button type="button" class="secondary" disabled={!valueOk} onclick={add}>
				{t('upload.add')}
			</button>
		</div>
		{#if chosen && tagValue && problem}
			<ErrorMessage error={t(problem.key, { ...problem.params, tag: chosen.name })} role={null} />
		{/if}
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
