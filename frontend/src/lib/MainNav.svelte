<script lang="ts">
	// Main navigation: the entries of nav.ts, the current page's one highlighted.
	// Wide screens: the entries side by side. Phones (≤ 40rem): one button with
	// the current page's name (or "Menu") opening the entries, to save width;
	// a single entry stays a plain link.
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { t } from './i18n.svelte';
	import { NAV } from './nav';
	import { hasAccess } from './session.svelte';

	const entries = $derived(NAV.filter((e) => !e.access || hasAccess(e.access)));
	const isCurrent = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	const current = $derived(entries.find((e) => isCurrent(e.href)));

	let open = $state(false);
	let dropdown = $state<HTMLElement>();

	// Close on navigation.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});

	function onWindowClick(e: MouseEvent) {
		if (open && dropdown && !dropdown.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

{#snippet link(entry: (typeof entries)[number])}
	<a href={entry.href} aria-current={isCurrent(entry.href) ? 'page' : undefined}>
		{t(entry.label)}
	</a>
{/snippet}

<nav aria-label={t('nav.main')} class:single={entries.length < 2}>
	<div class="inline">
		{#each entries as entry (entry.href)}
			{@render link(entry)}
		{/each}
	</div>
	{#if entries.length > 1}
		<div class="dropdown" bind:this={dropdown}>
			<button type="button" aria-expanded={open} onclick={() => (open = !open)}>
				{t(current?.label ?? 'nav.menu')}
				<Icon name="chevron-down" size={16} />
			</button>
			{#if open}
				<div class="menu">
					{#each entries as entry (entry.href)}
						{@render link(entry)}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</nav>

<style>
	.inline {
		display: flex;
		gap: var(--space-5);
	}
	.dropdown {
		display: none;
		position: relative;
	}
	@media (max-width: 40rem) {
		nav:not(.single) .inline {
			display: none;
		}
		.dropdown {
			display: block;
		}
	}
	a {
		padding: var(--space-1) var(--space-0);
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
	}
	a:hover {
		color: var(--text);
	}
	a[aria-current='page'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.dropdown button {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		height: 2.4rem;
		padding: 0 var(--space-2) 0 var(--space-3);
		font: inherit;
		font-weight: 600;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		white-space: nowrap;
	}
	.menu {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		top: calc(100% + var(--space-2));
		z-index: 10;
		min-width: 10rem;
		display: grid;
		padding: var(--space-1);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-menu);
	}
	.menu a {
		padding: var(--space-2) var(--space-3);
		border-bottom: 0;
		border-left: 3px solid transparent;
		border-radius: var(--radius-sm);
	}
	.menu a:hover {
		background: var(--bg);
	}
	.menu a[aria-current='page'] {
		border-left-color: var(--accent);
	}
</style>
