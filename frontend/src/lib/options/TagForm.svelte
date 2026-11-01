<script lang="ts">
	// One tag on the Options page, collapsible: its ID, its name in every language and
	// its format, then the panel of that format (values, regular expression, input
	// hints). Saved as a whole; a new ID renames it everywhere. The translation IDs
	// are shown as the server will store them (made from the IDs, never typed).
	import { untrack } from 'svelte';
	import ErrorMessage from '../ErrorMessage.svelte';
	import { i18n, LANGUAGES, t, type MessageKey } from '../i18n.svelte';
	import { nameId } from '../tags';
	import { rules } from '../validation';
	import TagHintsPanel from './TagHintsPanel.svelte';
	import TagRegexpPanel from './TagRegexpPanel.svelte';
	import TagValuesPanel from './TagValuesPanel.svelte';
	import { changed, FORMATS, LANGS, problems, type TagActions, type TagDraft } from './drafts';

	let { draft, actions, open = false }: { draft: TagDraft; actions: TagActions; open?: boolean } = $props();

	const id = $props.id();
	// Open or closed by the user from then on (the attribute alone would be set again
	// whenever the summary changes).
	let expanded = $state(untrack(() => open));
	const issues = $derived(problems(draft));
	const dirty = $derived(changed(draft));
	const title = $derived(draft.names[i18n.lang].trim() || draft.names.en.trim() || t('options.tags.new'));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		actions.save(draft);
	}

	function remove() {
		if (confirm(t('options.tags.delete_confirm', { name: title }))) actions.remove(draft);
	}
</script>

<details class="tag" bind:open={expanded}>
	<summary>
		<span class="name">{title}</span>
		{#if draft.savedId}<code>{draft.savedId}</code>{/if}
		<span class="meta">{t(`options.tags.format.${draft.format}` as MessageKey)}</span>
		{#if draft.used}<span class="meta">{t('options.tags.used', { n: draft.used })}</span>{/if}
		{#if dirty}<span class="unsaved">{t('options.tags.unsaved')}</span>{/if}
	</summary>

	<form onsubmit={submit} aria-label={title}>
		<div class="row">
			<label>
				{t('options.tags.id')}
				<input
					bind:value={draft.id}
					required
					minlength={rules.tag_id.min_length}
					maxlength={rules.tag_id.max_length}
					pattern={rules.tag_id.pattern}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					aria-describedby="{id}-id-hint"
				/>
			</label>
			<!-- An explicit label: a wrapping one would add the chosen option to the select's name. -->
			<div class="field">
				<label for="{id}-format">{t('options.tags.format')}</label>
				<select id="{id}-format" bind:value={draft.format}>
					{#each FORMATS as format (format)}
						<option value={format}>{t(`options.tags.format.${format}` as MessageKey)}</option>
					{/each}
				</select>
			</div>
		</div>
		<p class="hint" id="{id}-id-hint">{t('options.tags.id_hint', { max: rules.tag_id.max_length })}</p>

		<fieldset>
			<legend>{t('options.tags.names')}</legend>
			<p class="hint">{t('options.tags.translation_id')} <code>{nameId(draft.id.trim())}</code></p>
			<div class="row">
				{#each LANGS as lang (lang)}
					<label>
						{t('options.tags.name_in', { lang: LANGUAGES[lang] })}
						<input bind:value={draft.names[lang]} required maxlength={rules.tag_name.max_length} />
					</label>
				{/each}
			</div>
		</fieldset>

		{#if draft.format === 'list'}
			<TagValuesPanel {draft} {actions} />
		{:else if draft.format === 'regexp'}
			<TagRegexpPanel {draft} />
		{/if}
		{#if draft.format === 'regexp' || draft.format === 'free'}
			<TagHintsPanel {draft} />
		{/if}

		{#each issues as issue (issue)}
			<ErrorMessage error={t(issue)} role={null} />
		{/each}
		<ErrorMessage error={actions.errors[draft.key]} />
		{#if actions.saved[draft.key] && !dirty}<p class="ok" role="status">{t('options.tags.saved')}</p>{/if}
		<div class="actions">
			<button disabled={actions.busy || !!issues.length || !dirty}>{t('options.tags.save')}</button>
			{#if dirty || !draft.savedId}
				<button type="button" class="secondary" disabled={actions.busy} onclick={() => actions.discard(draft)}>
					{t(draft.savedId ? 'options.tags.discard' : 'common.cancel')}
				</button>
			{/if}
			{#if draft.savedId}
				<button type="button" class="secondary delete" disabled={actions.busy} onclick={remove}>
					{t('options.tags.delete')}
				</button>
			{/if}
		</div>
	</form>
</details>

<style>
	.tag {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
	}
	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
	}
	.name {
		font-weight: 600;
	}
	.meta {
		font-size: var(--text-sm);
		color: var(--muted);
	}
	.unsaved {
		font-size: var(--text-sm);
		color: var(--accent);
	}
	form {
		display: grid;
		gap: var(--space-3);
		padding: 0 var(--space-3) var(--space-3);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.row label,
	.field {
		flex: 1 1 12rem;
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-label);
	}
	form :global(fieldset) {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	form :global(legend) {
		font-weight: 600;
		padding: 0 var(--space-1);
	}
	code {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.ok {
		color: var(--ok);
		margin: 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.delete {
		margin-left: auto;
		color: var(--error);
	}
</style>
