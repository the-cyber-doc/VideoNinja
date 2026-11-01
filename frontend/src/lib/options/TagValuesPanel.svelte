<script lang="ts">
	// A list tag's values: each one's ID and name in every language, its translation ID
	// as it will be stored (tag_value.<tag>.<value>.name, following both IDs as they are
	// typed), and how often it is used. A filter for long lists (countries).
	import IconButton from '../IconButton.svelte';
	import { LANGUAGES, t } from '../i18n.svelte';
	import { valueNameId } from '../tags';
	import { rules } from '../validation';
	import { filterValues, LANGS, type TagActions, type TagDraft } from './drafts';

	let { draft, actions }: { draft: TagDraft; actions: TagActions } = $props();

	const FILTER_FROM = 10; // values: below, no filter field
	let filter = $state('');
	const shown = $derived(filterValues(draft.values, filter));
</script>

<fieldset>
	<legend>{t('options.tags.values', { n: draft.values.length })}</legend>
	{#if draft.values.length > FILTER_FROM}
		<input
			type="search"
			bind:value={filter}
			placeholder={t('options.tags.filter')}
			aria-label={t('options.tags.filter')}
		/>
	{/if}
	{#if !draft.values.length}
		<p class="hint">{t('options.tags.no_values')}</p>
	{/if}
	<ul>
		{#each shown as value (value.key)}
			<li class="value">
				<label>
					{t('options.tags.value_id')}
					<input
						bind:value={value.id}
						required
						minlength={rules.tag_value_id.min_length}
						maxlength={rules.tag_value_id.max_length}
						pattern={rules.tag_value_id.pattern}
						autocapitalize="none"
						autocomplete="off"
						spellcheck="false"
					/>
				</label>
				{#each LANGS as lang (lang)}
					<label>
						{t('options.tags.name_in', { lang: LANGUAGES[lang] })}
						<input bind:value={value.names[lang]} required maxlength={rules.tag_name.max_length} />
					</label>
				{/each}
				<IconButton
					label={t('options.tags.remove_value', { id: value.id.trim() || '…' })}
					icon="trash"
					variant="quiet"
					class="remove"
					onclick={() => actions.removeValue(draft, value)}
				/>
				<p class="hint about">
					{t('options.tags.translation_id')} <code>{valueNameId(draft.id.trim(), value.id.trim())}</code>
					{#if value.used}· {t('options.tags.used', { n: value.used })}{/if}
				</p>
			</li>
		{/each}
	</ul>
	<button type="button" class="secondary add" onclick={() => actions.addValue(draft)}>
		{t('options.tags.add_value')}
	</button>
</fieldset>

<style>
	ul {
		display: grid;
		gap: var(--space-2);
		max-height: 60dvh;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.value {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-1) var(--space-2);
		padding-bottom: var(--space-2);
		border-bottom: 1px solid var(--border);
	}
	label {
		flex: 1 1 8rem;
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-label);
	}
	.about {
		flex-basis: 100%;
	}
	code {
		overflow-wrap: anywhere;
	}
	.add {
		justify-self: start;
	}
</style>
