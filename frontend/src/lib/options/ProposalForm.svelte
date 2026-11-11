<script lang="ts">
	// One proposed catalogue entry on the Options page, collapsible: its name (the last part of
	// its ID, the whole ID shown as it will be), kanji, romaji, parent (a section's school,
	// category and weapon; a technique's section), meanings; then Save, Validate (saved changes
	// first), Merge into another entry of its kind, Delete (unused only). Rules: ./proposals.ts.
	import { untrack } from 'svelte';
	import type { ProposedEntry } from '../api/types';
	import { BUKI, type Catalog } from '../catalog.svelte';
	import ErrorMessage from '../ErrorMessage.svelte';
	import { i18n, LANGUAGES, t, type MessageKey } from '../i18n.svelte';
	import { rules } from '../validation';
	import { changed, entriesOf, idOf, mergeTargets, problems, type ProposalDraft } from './proposals';
	import type { ProposalOptions } from '../../routes/(app)/options/proposals.svelte';

	let {
		draft,
		actions,
		catalog,
		open = false
	}: { draft: ProposalDraft; actions: ProposalOptions; catalog: Catalog | null; open?: boolean } = $props();

	const id = $props.id();
	let expanded = $state(untrack(() => open));
	const entry = $derived<ProposedEntry>(actions.saved(draft));
	const issues = $derived(problems(draft));
	const dirty = $derived(changed(draft, entry));
	const targets = $derived(mergeTargets(draft, catalog, actions.entries));
	const list = (kind: ProposedKind) => entriesOf(kind, catalog, actions.entries);
	type ProposedKind = ProposedEntry['kind'];
	const day = (iso: string) => new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(new Date(iso));

	function submit(e: SubmitEvent) {
		e.preventDefault();
		actions.save(draft);
	}
	function merge() {
		const into = actions.into[draft.key];
		if (into && confirm(t('options.proposals.merge_confirm', { name: entry.romaji, into }))) actions.merge(draft);
	}
	function remove() {
		if (confirm(t('options.proposals.delete_confirm', { name: entry.romaji }))) actions.remove(draft);
	}
</script>

<details class="entry" bind:open={expanded} data-key={draft.key}>
	<summary>
		<span class="name">{entry.romaji}</span>
		{#if entry.kanji}<span lang="ja">{entry.kanji}</span>{/if}
		<span class="meta">{t(`options.proposals.kind.${draft.kind}` as MessageKey)}</span>
		<code>{entry.id}</code>
		{#if entry.used}<span class="meta">{t('options.proposals.used', { n: entry.used })}</span>{/if}
		{#if entry.children}<span class="meta">{t('options.proposals.children', { n: entry.children })}</span>{/if}
		{#if dirty}<span class="unsaved">{t('options.proposals.unsaved')}</span>{/if}
	</summary>

	<form onsubmit={submit} aria-label={entry.romaji}>
		<p class="meta">
			{t('options.proposals.by', {
				name: entry.proposed_by ?? t('common.deleted_user'),
				date: day(entry.proposed_at)
			})}
		</p>
		<div class="row">
			<label>
				{t('options.proposals.name')}
				<input
					bind:value={draft.name}
					required
					maxlength={rules.catalog_name.max_length}
					pattern={rules.catalog_name.pattern}
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					aria-describedby="{id}-id"
				/>
			</label>
			<label>
				{t('options.proposals.romaji')}
				<input bind:value={draft.romaji} required maxlength={rules.catalog_romaji.max_length} />
			</label>
			<label>
				{t('options.proposals.kanji')}
				<input bind:value={draft.kanji} lang="ja" maxlength={rules.catalog_kanji.max_length} />
			</label>
		</div>
		<p class="hint" id="{id}-id">
			{t('options.proposals.name_hint', { max: rules.catalog_name.max_length })} <code>{idOf(draft)}</code>
		</p>

		{#if draft.kind === 'section'}
			<div class="row">
				<div class="field">
					<label for="{id}-ryu">{t('upload.segment.school')}</label>
					<select id="{id}-ryu" bind:value={draft.ryu}>
						{#each list('school') as e (e.id)}<option value={e.id}>{e.romaji}</option>{/each}
					</select>
				</div>
				<div class="field">
					<label for="{id}-category">{t('upload.segment.category')}</label>
					<select id="{id}-category" bind:value={draft.category}>
						{#each list('category') as e (e.id)}<option value={e.id}>{e.romaji}</option>{/each}
					</select>
				</div>
				{#if draft.category === BUKI}
					<div class="field">
						<label for="{id}-weapon">{t('upload.segment.weapon')}</label>
						<select id="{id}-weapon" bind:value={draft.weapon}>
							<option value="">{t('upload.segment.choose')}</option>
							{#each list('weapon') as e (e.id)}<option value={e.id}>{e.romaji}</option>{/each}
						</select>
					</div>
				{/if}
			</div>
		{:else if draft.kind === 'technique'}
			<div class="field">
				<label for="{id}-section">{t('upload.segment.section')}</label>
				<select id="{id}-section" bind:value={draft.section}>
					{#each list('section') as e (e.id)}<option value={e.id}>{e.romaji} ({e.id})</option>{/each}
				</select>
			</div>
		{/if}

		<div class="row">
			{#each ['en', 'fr'] as const as lang (lang)}
				<label>
					{t('options.proposals.meaning_in', { lang: LANGUAGES[lang] })}
					<input bind:value={draft.descriptions[lang]} maxlength={rules.catalog_description.max_length} />
				</label>
			{/each}
		</div>

		{#if issues.length}
			<ul class="problems">
				{#each issues as issue (issue)}
					<li><ErrorMessage error={t(`options.proposals.problem.${issue}` as MessageKey)} role={null} /></li>
				{/each}
			</ul>
		{/if}
		<ErrorMessage error={actions.errors[draft.key]} />

		<div class="actions">
			<button type="submit" disabled={actions.busy || !dirty || issues.length > 0}>{t('options.proposals.save')}</button
			>
			<button
				type="button"
				class="secondary"
				disabled={actions.busy || dirty}
				title={dirty ? t('options.proposals.validate_hint') : undefined}
				onclick={() => actions.validate(draft)}>{t('options.proposals.validate')}</button
			>
		</div>
		<div class="actions">
			<div class="field">
				<label for="{id}-into">{t('options.proposals.merge_into')}</label>
				<select id="{id}-into" bind:value={actions.into[draft.key]}>
					<option value="">{t('upload.segment.choose')}</option>
					{#each targets as e (e.id)}<option value={e.id}>{e.romaji} ({e.id})</option>{/each}
				</select>
			</div>
			<button type="button" class="secondary" disabled={actions.busy || !actions.into[draft.key]} onclick={merge}
				>{t('options.proposals.merge')}</button
			>
			<button
				type="button"
				class="secondary"
				disabled={actions.busy || entry.used > 0 || entry.children > 0}
				title={entry.used || entry.children ? t('options.proposals.delete_hint') : undefined}
				onclick={remove}>{t('options.proposals.delete')}</button
			>
		</div>
	</form>
</details>

<style>
	.entry {
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
		margin: 0;
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
	.row,
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-3);
	}
	.row label,
	.field {
		flex: 1 1 12rem;
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-label);
	}
	.actions .field {
		flex: 0 1 20rem;
	}
	.hint {
		margin: 0;
	}
	code {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.problems {
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
