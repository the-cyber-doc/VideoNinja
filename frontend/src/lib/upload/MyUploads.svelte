<script lang="ts">
	// My uploads on the server: queued (place in the queue), encoding (%),
	// published, failed (Retry / Delete). Refreshed every few seconds while shown.
	import { i18n, t } from '../i18n.svelte';
	import { myUploads, remove, retry, type UploadStatus } from './api';

	let { refresh = 0 }: { refresh?: number } = $props();
	let list = $state<UploadStatus[]>([]);
	let error = $state('');
	const POLL_MS = 5000;

	async function load() {
		try {
			list = await myUploads();
			error = '';
		} catch (e) {
			error = (e as Error).message;
		}
	}

	$effect(() => {
		void refresh; // reload at once after a submit
		load();
		const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
		return () => clearInterval(timer);
	});

	async function act(action: () => Promise<unknown>) {
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
		load();
	}

	const date = (s: number) =>
		new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(s * 1000);

	function label(u: UploadStatus) {
		switch (u.status) {
			case 'queued':
				return t('upload.status.queued', { n: u.queue_position ?? '?' });
			case 'encoding':
				return t('upload.status.encoding', { n: u.progress });
			case 'published':
				return t('upload.status.published');
			case 'failed':
				return t('upload.status.failed', { error: u.error ?? '' });
		}
	}
</script>

<section class="mine">
	<h2>{t('upload.mine')}</h2>
	{#if error}<p class="error">{error}</p>{/if}
	{#if list.length}
		<ul>
			{#each list as u (u.id)}
				<li class={u.status}>
					<div class="row">
						<strong>{u.filename}</strong>
						<span class="when">{date(u.uploaded_s)}</span>
					</div>
					<div class="row">
						<span class="status">{label(u)}</span>
						{#if u.status === 'failed'}
							<span class="actions">
								<button type="button" class="secondary" onclick={() => act(() => retry(u.id))}>{t('upload.retry')}</button>
								<button
									type="button"
									class="secondary"
									onclick={() => confirm(t('upload.delete_confirm')) && act(() => remove(u.id))}
								>
									{t('upload.delete')}
								</button>
							</span>
						{/if}
					</div>
					{#if u.status === 'encoding'}
						<progress max="100" value={u.progress} aria-label={label(u)}></progress>
					{/if}
				</li>
			{/each}
		</ul>
	{:else if !error}
		<p class="hint">{t('upload.none_yet')}</p>
	{/if}
</section>

<style>
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	ul {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: 0.3rem;
		padding: 0.6rem 0.8rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-left-width: 4px;
		border-radius: var(--radius);
	}
	li.published {
		border-left-color: var(--ok);
	}
	li.failed {
		border-left-color: var(--error);
	}
	li.encoding {
		border-left-color: var(--accent);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	strong {
		overflow-wrap: anywhere;
	}
	.when,
	.status {
		font-size: 0.85rem;
		color: var(--muted);
	}
	li.failed .status {
		color: var(--error);
	}
	.actions {
		display: flex;
		gap: 0.4rem;
	}
	progress {
		width: 100%;
	}
</style>
