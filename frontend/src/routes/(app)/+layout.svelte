<script lang="ts">
	// Shell of the logged-in application: full-size layout, header with the user menu.
	// Login, setup and registration pages are outside this group and have no shell.
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, currentUser, isInitialized } from '#lib/api.js';
	import { url } from '#lib/base.js';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import Icon from '#lib/Icon.svelte';
	import LanguageMenu from '#lib/LanguageMenu.svelte';
	import MainNav from '#lib/MainNav.svelte';
	import { watchSavedMedia } from '#lib/offline.svelte.js';
	import { clearUserData, persistStorage } from '#lib/pwa.js';
	import { hasAccess, session } from '#lib/session.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	let error = $state('');
	let menuOpen = $state(false);
	let menu = $state<HTMLElement>();

	$effect(() => {
		(async () => {
			try {
				if (!(await isInitialized())) return goto(url('/setup'), { replace: true });
				session.user = await currentUser();
				if (!session.user) return goto(url('/login'), { replace: true });
				persistStorage();
				watchSavedMedia();
			} catch (e) {
				error = (e as Error).message;
			}
		})();
	});

	// Language changed: reload the user, whose role name is translated by the server.
	$effect(() => {
		void i18n.lang;
		if (!untrack(() => session.user)) return;
		currentUser()
			.then((user) => {
				if (user) session.user = user; // a statement: an object assigned to state is proxied
			})
			.catch(() => {}); // keep the current name: only the role label is stale
	});

	// Close the menu on navigation.
	$effect(() => {
		void page.url.pathname;
		menuOpen = false;
	});

	function onWindowClick(e: MouseEvent) {
		if (menuOpen && menu && !menu.contains(e.target as Node)) menuOpen = false;
	}

	async function logout() {
		await api('/api/auth/logout', {});
		await clearUserData();
		session.user = null;
		goto(url('/login'), { replace: true });
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#if session.user}
	<div class="app">
		<header>
			<!-- Phones: the icon only (the name stays the link's accessible name). -->
			<a class="brand" href={url('/')}>
				<img src={url('/favicon.svg')} alt="" width="32" height="32" />
				<span class="name">Video Ninja</span>
			</a>
			<MainNav />
			<div class="tools">
				<LanguageMenu />
				<div class="user-menu" bind:this={menu}>
					<button
						class="icon"
						aria-label={t('menu.user')}
						title={session.user.name ?? session.user.username}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = !menuOpen)}
					>
						<Icon name="user" size={22} />
					</button>
					{#if menuOpen}
						<!-- Entries: Profile first, About just before Log out, Log out always last. -->
						<div class="menu" role="menu">
							<p class="who">{session.user.name ?? session.user.username}</p>
							<a role="menuitem" href={url('/profile')}>{t('menu.profile')}</a>
							{#if hasAccess('user_mgmt')}
								<a role="menuitem" href={url('/admin/users')}>{t('menu.user_mgmt')}</a>
							{/if}
							<a role="menuitem" href={url('/about')}>{t('menu.about')}</a>
							<button role="menuitem" class="logout" onclick={logout}>{t('menu.logout')}</button>
						</div>
					{/if}
				</div>
			</div>
		</header>
		<div class="content">
			{@render children()}
		</div>
	</div>
{:else if error}
	<main class="card"><p class="error">{error}</p></main>
{/if}

<style>
	.app {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto 1fr;
	}
	header {
		/* brand | main navigation (centred whatever the side widths) | tools */
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 1rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.brand {
		justify-self: start;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 700;
		color: var(--text);
		text-decoration: none;
		white-space: nowrap;
	}
	.brand img {
		display: block;
	}
	@media (max-width: 40rem) {
		header {
			gap: 0.5rem;
			padding: 0.5rem 0.75rem;
		}
		/* Hidden but still read: the link keeps "Video Ninja" as its name. */
		.brand .name {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	.content {
		min-width: 0;
		padding: 1rem;
	}
	.tools {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.user-menu {
		position: relative;
	}
	button.icon {
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border-radius: 50%;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.4rem);
		z-index: 10;
		min-width: 12rem;
		display: grid;
		padding: 0.3rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.15);
	}
	.who {
		margin: 0;
		padding: 0.4rem 0.7rem;
		font-size: 0.85rem;
		color: var(--muted);
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.3rem;
	}
	.menu a,
	.menu button {
		display: block;
		width: 100%;
		padding: 0.5rem 0.7rem;
		font: inherit;
		font-weight: normal;
		text-align: left;
		color: var(--text);
		background: none;
		border: 0;
		border-radius: 6px;
		text-decoration: none;
		cursor: pointer;
	}
	.menu a:hover,
	.menu button:hover {
		background: var(--bg);
	}
	.menu .logout {
		border-top: 1px solid var(--border);
		border-radius: 0 0 6px 6px;
		margin-top: 0.3rem;
	}
</style>
