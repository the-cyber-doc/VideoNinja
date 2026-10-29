<script lang="ts">
	// My uploads on the server: queued (place in the queue), encoding (%),
	// published, failed (Retry / Delete). Refreshed every few seconds while one
	// is queued or encoding and the page is visible; otherwise only when shown,
	// after a submit or an action, and when the page becomes visible again.
	import ErrorMessage from '../ErrorMessage.svelte';
	import { refreshCatalog } from '../catalog.svelte';
	import { i18n, t } from '../i18n.svelte';
	import type { UploadStatus } from '../api/types';
	import { myUploads, remove, retry } from '../api/uploads';

	let { refresh = 0 }: { refresh?: number } = $props();
	let list = $state<UploadStatus[]>([]);
	let error = $state<unknown>(null);
	const POLL_MS = 5000;

	let published = new Set<number>(); // seen published: a new one means new segments

	async function load() {
		try {
			list = await myUploads();
			error = null;
			const now = new Set(list.filter((u) => u.status === 'published').map((u) => u.id));
			if ([...now].some((id) => !published.has(id))) refreshCatalog();
			published = now;
		} catch (e) {
			error = e;
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
			error = e;
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
	<ErrorMessage {error} />
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
								<button type="button" class="secondary" onclick={() => act(() => retry(u.id))}
									>{t('upload.retry')}</button
								>
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
		font-size: var(--text-lg);
		margin: 0 0 var(--space-3);
	}
	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
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
		gap: var(--space-2);
	}
	strong {
		overflow-wrap: anywhere;
	}
	.when,
	.status {
		font-size: var(--text-sm);
		color: var(--muted);
	}
	li.failed .status {
		color: var(--error);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	progress {
		width: 100%;
	}
</style>
