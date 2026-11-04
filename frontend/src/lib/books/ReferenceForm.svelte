<script lang="ts">
	// A book's reference, by type of work (reference.ts: the fields each type asks for),
	// with its names (authors, editors, translators: family + given name, or a name
	// written as is), and the bibliography entry it gives, live (Chicago style).
	import ErrorMessage from '../ErrorMessage.svelte';
	import IconButton from '../IconButton.svelte';
	import { t, type MessageKey } from '../i18n.svelte';
	import { rules } from '../validation';
	import Citation from './Citation.svelte';
	import {
		emptyName,
		FIELDS,
		problems,
		ROLES,
		ruleOf,
		toReference,
		TYPES,
		type ReferenceDraft,
		type TextField
	} from './reference';

	let { draft = $bindable(), disabled = false }: { draft: ReferenceDraft; disabled?: boolean } = $props();

	const found = $derived(problems(draft));
	const fields = $derived(FIELDS[draft.type]);
	const reference = $derived(toReference(draft));
	// Shown once the field was left (or the user tried to send).
	let touched = $state<Partial<Record<TextField, boolean>>>({});

	const label = (field: TextField) => t(`books.reference.field.${field}` as MessageKey);
	const PLACEHOLDERS: Partial<Record<TextField, MessageKey>> = {
		issued: 'books.reference.placeholder.date',
		'original-date': 'books.reference.placeholder.date',
		URL: 'books.reference.placeholder.url',
		language: 'books.reference.placeholder.language',
		edition: 'books.reference.placeholder.edition',
		page: 'books.reference.placeholder.page'
	};
	const placeholder = (field: TextField) => {
		if (field === 'genre')
			return t(
				draft.type === 'thesis' ? 'books.reference.placeholder.thesis' : 'books.reference.placeholder.manuscript'
			);
		const key = PLACEHOLDERS[field];
		return key ? t(key) : '';
	};
	const LONG: TextField[] = ['title', 'original-title', 'container-title', 'note'];
</script>

<fieldset class="reference" {disabled}>
	<legend>{t('books.reference.title')}</legend>

	<label for="reference-type">{t('books.reference.type')}</label>
	<select id="reference-type" bind:value={draft.type}>
		{#each TYPES as type (type)}
			<option value={type}>{t(`books.reference.type.${type}` as MessageKey)}</option>
		{/each}
	</select>

	<fieldset class="names">
		<legend>{t('books.reference.names')}</legend>
		<p class="hint">{t('books.reference.names_hint')}</p>
		{#each draft.names as name, i (i)}
			<div class="name">
				<select bind:value={name.role} aria-label={t('books.reference.role')}>
					{#each ROLES as role (role)}
						<option value={role}>{t(`books.reference.role.${role}` as MessageKey)}</option>
					{/each}
				</select>
				<input
					bind:value={name.family}
					aria-label={name.literal ? t('books.reference.literal_name') : t('books.reference.family')}
					placeholder={name.literal ? t('books.reference.literal_name') : t('books.reference.family')}
					maxlength={rules.reference_name.max_length}
				/>
				{#if !name.literal}
					<input
						bind:value={name.given}
						aria-label={t('books.reference.given')}
						placeholder={t('books.reference.given')}
						maxlength={rules.reference_name.max_length}
					/>
				{/if}
				<label class="literal">
					<input type="checkbox" bind:checked={name.literal} />
					{t('books.reference.as_written')}
				</label>
				<IconButton
					label={t('books.reference.remove_name', { n: i + 1 })}
					icon="cross"
					iconSize={14}
					variant="quiet"
					size="sm"
					round
					onclick={() => draft.names.splice(i, 1)}
				/>
			</div>
		{/each}
		{#if found.names}<ErrorMessage error={t(found.names)} role={null} />{/if}
		<button type="button" class="secondary add" onclick={() => draft.names.push(emptyName())}>
			{t('books.reference.add_name')}
		</button>
	</fieldset>

	<div class="fields">
		{#each fields as field (field)}
			{@const rule = ruleOf(field)}
			{@const problem = touched[field] ? found[field] : undefined}
			<div class="field" class:long={LONG.includes(field)}>
				<label>
					{label(field)}{#if field === 'title'}&nbsp;*{/if}
					{#if field === 'note'}
						<textarea
							bind:value={draft.fields[field]}
							maxlength={rule.max_length}
							onblur={() => (touched[field] = true)}></textarea>
					{:else}
						<input
							bind:value={draft.fields[field]}
							maxlength={rule.max_length}
							placeholder={placeholder(field)}
							inputmode={field === 'issued' || field === 'original-date' || field === 'number-of-pages'
								? 'numeric'
								: 'text'}
							type={field === 'URL' ? 'url' : 'text'}
							lang={field === 'original-title' ? 'ja' : undefined}
							aria-invalid={!!problem}
							required={field === 'title'}
							onblur={() => (touched[field] = true)}
						/>
					{/if}
				</label>
				{#if problem}<ErrorMessage error={t(problem)} role={null} />{/if}
			</div>
		{/each}
	</div>

	<div class="preview">
		<h3>{t('books.reference.preview')}</h3>
		<p><Citation {reference} /></p>
	</div>
</fieldset>

<style>
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: grid;
		gap: var(--space-2);
		min-width: 0;
	}
	legend {
		font-size: var(--text-lg);
		font-weight: 600;
		padding: 0;
		margin-bottom: var(--space-2);
	}
	.names legend {
		font-size: var(--text-label);
		font-weight: normal;
		color: var(--muted);
		margin-bottom: var(--space-1);
	}
	.names .hint {
		margin: 0;
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.name input:not([type='checkbox']) {
		flex: 1 1 10rem;
		min-width: 0;
	}
	.literal {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--text-sm);
	}
	.add {
		justify-self: start;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
	.field,
	.field label {
		display: grid;
		gap: var(--space-1);
		align-content: start;
	}
	.fields .long {
		grid-column: 1 / -1;
	}
	textarea {
		min-height: 5rem;
	}
	.preview {
		padding: var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	h3 {
		font-size: var(--text-label);
		font-weight: normal;
		color: var(--muted);
		margin: 0 0 var(--space-1);
	}
	.preview p {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
