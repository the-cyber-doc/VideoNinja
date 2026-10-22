<script lang="ts">
	// Main navigation: the entries of nav.ts, the current page's one highlighted.
	import { page } from '$app/state';
	import { t } from './i18n.svelte';
	import { NAV } from './nav';
	import { hasAccess } from './session.svelte';

	const entries = $derived(NAV.filter((e) => !e.access || hasAccess(e.access)));
	const isCurrent = (href: string) =>
		page.url.pathname === href || page.url.pathname.startsWith(href + '/');
</script>

<nav aria-label={t('nav.main')}>
	{#each entries as entry (entry.href)}
		<a href={entry.href} aria-current={isCurrent(entry.href) ? 'page' : undefined}>
			{t(entry.label)}
		</a>
	{/each}
</nav>

<style>
	nav {
		display: flex;
		gap: 1.25rem;
	}
	a {
		padding: 0.3rem 0.1rem;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	a:hover {
		color: var(--text);
	}
	a[aria-current='page'] {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
</style>
