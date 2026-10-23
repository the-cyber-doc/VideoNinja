<script lang="ts">
	// Writing a comment (new or edited): its text and its language (default: the
	// UI's). onsave throws on failure: the message is shown and the text kept.
	import { i18n, LANGUAGES, t, type Lang } from '../i18n.svelte';
	import { rules } from '../validation';
	import type { CommentIn } from './comments';

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
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			await onsave({ text: text.trim(), lang });
		} catch (err) {
			error = navigator.onLine ? (err as Error).message : t('comments.offline');
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
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
	.comment-form {
		display: grid;
		gap: 0.5rem;
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
		gap: 0.5rem;
		font-size: 0.9rem;
	}
	.row label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.buttons {
		display: flex;
		gap: 0.4rem;
	}
	.error {
		margin: 0;
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
