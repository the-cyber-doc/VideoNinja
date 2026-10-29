<script lang="ts">
	// Writing a comment (new or edited): its text and its language (default: the
	// UI's). onsave throws on failure: the message is shown and the text kept.
	import ErrorMessage from '../ErrorMessage.svelte';
	import { i18n, LANGUAGES, t, type Lang } from '../i18n.svelte';
	import { rules } from '../validation';
	import type { CommentIn } from '../api/types';

	let {
		initial,
		onsave,
		oncancel
	}: {
		initial?: CommentIn;
		onsave: (comment: CommentIn) => Promise<unknown>;
		oncancel: () => void;
	} = $props();

	const id = $props.id();
	// The starting values only: the form then keeps its own.
	// svelte-ignore state_referenced_locally
	let text = $state(initial?.text ?? '');
	// svelte-ignore state_referenced_locally
	let lang = $state<Lang>(initial?.lang ?? i18n.lang);
	let busy = $state(false);
	let error = $state<unknown>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			await onsave({ text: text.trim(), lang });
		} catch (err) {
			error = navigator.onLine ? err : t('comments.offline');
		} finally {
			busy = false;
		}
	}
</script>

<form class="comment-form" onsubmit={submit}>
	<label for="{id}-text" class="visually-hidden">{t('comments.text')}</label>
	<!-- svelte-ignore a11y_autofocus: opened by the user to write -->
	<textarea
		id="{id}-text"
		bind:value={text}
		placeholder={t('comments.text')}
		required
		maxlength={rules.comment_text.max_length}
		rows="3"
		autofocus
	></textarea>
	<div class="row">
		<label>
			{t('comments.language')}
			<select bind:value={lang}>
				{#each Object.entries(LANGUAGES) as [code, name] (code)}
					<option value={code}>{name}</option>
				{/each}
			</select>
		</label>
		<span class="buttons">
			<button type="button" class="secondary" onclick={oncancel} disabled={busy}>{t('common.cancel')}</button>
			<button type="submit" disabled={busy || !text.trim()}>{t('comments.save')}</button>
		</span>
	</div>
	<ErrorMessage error={error} />
</form>

<style>
	.comment-form {
		display: grid;
		gap: var(--space-2);
	}
	textarea {
		width: 100%;
		resize: vertical;
		font: inherit;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--text-label);
	}
	.row label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.buttons {
		display: flex;
		gap: var(--space-2);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
