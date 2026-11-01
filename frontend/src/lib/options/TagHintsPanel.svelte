<script lang="ts">
	// A text tag's input hints (regexp, free): a hint in every language (the input's
	// placeholder and help), the keyboard, and for numbers their bounds (checked too).
	import { LANGUAGES, t } from '../i18n.svelte';
	import { hintId } from '../tags';
	import { rules } from '../validation';
	import { LANGS, type TagDraft } from './drafts';

	let { draft }: { draft: TagDraft } = $props();
	const id = $props.id();
</script>

<fieldset>
	<legend>{t('options.tags.input')}</legend>
	<p class="hint">
		{t('options.tags.hint_hint')}
		{t('options.tags.translation_id')} <code>{hintId(draft.id.trim())}</code>
	</p>
	<div class="row">
		{#each LANGS as lang (lang)}
			<label>
				{t('options.tags.hint_in', { lang: LANGUAGES[lang] })}
				<input bind:value={draft.hint[lang]} maxlength={rules.tag_hint.max_length} />
			</label>
		{/each}
	</div>
	<div class="row">
		<div class="field">
			<label for="{id}-keyboard">{t('options.tags.keyboard')}</label>
			<select id="{id}-keyboard" bind:value={draft.inputMode}>
				<option value="text">{t('options.tags.keyboard.text')}</option>
				<option value="numeric">{t('options.tags.keyboard.numeric')}</option>
			</select>
		</div>
		{#if draft.inputMode === 'numeric'}
			<label>
				{t('options.tags.min')}
				<input bind:value={draft.min} inputmode="numeric" autocomplete="off" />
			</label>
			<label>
				{t('options.tags.max')}
				<input bind:value={draft.max} inputmode="numeric" autocomplete="off" />
			</label>
		{/if}
	</div>
</fieldset>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	label,
	.field {
		flex: 1 1 10rem;
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-label);
	}
	code {
		overflow-wrap: anywhere;
	}
</style>
