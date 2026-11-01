<script lang="ts">
	// A regexp tag's regular expression (the whole value must match it): refused until
	// valid, and a test field that checks a value as the upload page will (bounds too).
	import ErrorMessage from '../ErrorMessage.svelte';
	import Icon from '../Icon.svelte';
	import { i18n, t } from '../i18n.svelte';
	import { compilePattern, valueProblem } from '../tags';
	import { rules } from '../validation';
	import { ruleOf, type TagDraft } from './drafts';

	let { draft }: { draft: TagDraft } = $props();

	const id = $props.id();
	let sample = $state('');
	const valid = $derived(!!draft.regexp && !!compilePattern(draft.regexp));
	const problem = $derived(valid && sample ? valueProblem(ruleOf(draft, i18n.lang), sample) : null);
	const name = $derived(draft.names[i18n.lang].trim() || draft.id);
</script>

<fieldset>
	<legend>{t('options.tags.regexp')}</legend>
	<label>
		{t('options.tags.regexp_label')}
		<input
			class="mono"
			bind:value={draft.regexp}
			required
			maxlength={rules.tag_regexp.max_length}
			autocapitalize="none"
			autocomplete="off"
			spellcheck="false"
			aria-invalid={!!draft.regexp && !valid}
			aria-describedby="{id}-hint"
		/>
	</label>
	<p class="hint" id="{id}-hint">{t('options.tags.regexp_hint')}</p>
	{#if draft.regexp && !valid}
		<ErrorMessage error={t('error.tag.regexp_invalid')} role={null} />
	{/if}
	<label>
		{t('options.tags.test')}
		<input bind:value={sample} disabled={!valid} autocomplete="off" spellcheck="false" />
	</label>
	{#if valid && sample}
		<p class="result" class:ok={!problem} role="status">
			<Icon name={problem ? 'cross' : 'check'} size={16} />
			{problem ? t(problem.key, { ...problem.params, tag: name }) : t('options.tags.test_ok')}
		</p>
	{/if}
</fieldset>

<style>
	label {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-label);
	}
	.mono {
		font-family: ui-monospace, monospace;
	}
	.result {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		margin: 0;
		color: var(--error);
	}
	.result.ok {
		color: var(--ok);
	}
</style>
