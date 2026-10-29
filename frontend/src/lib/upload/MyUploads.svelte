<script lang="ts">
	// My uploads on the server: queued (place in the queue), encoding (%),
	// published, failed (Retry / Delete). Refreshed every few seconds while one
	// is queued or encoding and the page is visible; otherwise only when shown,
	// after a submit or an action, and when the page becomes visible again.
	import { refreshCatalog } from '../catalog.svelte';
	import { i18n, t } from '../i18n.svelte';
	import type { UploadStatus } from '../api/types';
	import { myUploads, remove, retry } from '../api/uploads';

	let { refresh = 0 }: { refresh?: number } = $props();
	let list = $state<UploadStatus[]>([]);
	let error = $state('');
	const POLL_MS = 5000;

	let published = new Set<number>(); // seen published: a new one means new segments

	async function load() {
		try {
			list = await myUploads();
			error = '';
			const now = new Set(list.filter((u) => u.status === 'published').map((u) => u.id));
			if ([...now].some((id) => !published.has(id))) refreshCatalog();
			published = now;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	/** Something the server is still working on: worth checking again soon. */
	const pending = $derived(list.some((u) => u.status === 'queued' || u.status === 'encoding'));

	$effect(() => {
		void refresh; // reload at once after a submit
		load();
	});

	$effect(() => {
		if (!pending) return;
		const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
		return () => clearInterval(timer);
	});

	function visible() {
		if (document.visibilityState === 'visible') load(); // e.g. back from another tab
	}

	async function act(action: () => Promise<unknown>) {
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		}
		load();
	}

	const date = (at: string) =>
		new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));

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

<svelte:document onvisibilitychange={visible} />

<section class="mine">
	<h2>{t('upload.mine')}</h2>
	{#if error}<p class="error">{error}</p>{/if}
	{#if list.length}
		<ul>
			{#each list as u (u.id)}
				<li class={u.status}>
					<div class="row">
						<strong>{u.original_filename}</strong>
						<span class="when">{date(u.uploaded_at)}</span>
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
