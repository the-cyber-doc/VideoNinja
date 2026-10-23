<script lang="ts">
	// Tags as removable chips. Add: type or pick a tag name (only existing tags:
	// admins define them), then its value: one of its fixed values, or free text.
	import Icon from '../Icon.svelte';
	import { t } from '../i18n.svelte';
	import type { Tag, TagValue } from './api';

	let {
		available,
		value = $bindable(),
		label
	}: { available: Tag[]; value: TagValue[]; label: string } = $props();

	const id = $props.id();
	let name = $state('');
	let tagValue = $state('');
	const unused = $derived(available.filter((tag) => !value.some((v) => v.id === tag.id)));
	const chosen = $derived(unused.find((tag) => tag.id === name));

	function add() {
		if (!chosen || (chosen.values && !tagValue)) return;
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
					{tag.id}{tag.value ? `: ${tag.value}` : ''}
					<button
						type="button"
						title={t('upload.tag.remove', { name: tag.id })}
						aria-label={t('upload.tag.remove', { name: tag.id })}
						onclick={() => value.splice(i, 1)}
					>
						<Icon name="cross" size={14} />
					</button>
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
					<option value={tag.id}></option>
				{/each}
			</datalist>
			{#if chosen?.values}
				<select bind:value={tagValue} aria-label={t('upload.tag.value')}>
					<option value="">{t('upload.tag.value')}</option>
					{#each chosen.values as v (v)}
						<option value={v}>{v}</option>
					{/each}
				</select>
			{:else if chosen}
				<input bind:value={tagValue} placeholder={t('upload.tag.value')} aria-label={t('upload.tag.value')} maxlength="64" />
			{/if}
			<button type="button" class="secondary" disabled={!chosen || (!!chosen.values && !tagValue)} onclick={add}>
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
		gap: 0.4rem;
	}
	legend {
		font-size: 0.9rem;
		color: var(--muted);
		padding: 0;
		margin-bottom: 0.3rem;
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.3rem 0.15rem 0.6rem;
		font-size: 0.85rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.chip button {
		display: grid;
		place-items: center;
		padding: 0.15rem;
		color: var(--muted);
		background: none;
		border-radius: 50%;
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.add input,
	.add select {
		flex: 1 1 8rem;
		min-width: 0;
	}
</style>
