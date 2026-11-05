<script lang="ts">
	// The search box (top right of the Schools, Videos and Books pages): a combobox whose
	// drop-down shows the best hits of each group as you type; Enter opens the active one,
	// or every result (/search) when none is chosen. Arrow keys move, Escape closes.
	import { afterNavigate, goto } from '$app/navigation';
	import { url } from '../base';
	import { i18n, t, type MessageKey } from '../i18n.svelte';
	import Icon from '../Icon.svelte';
	import { searcher } from './app';
	import { results } from './search';

	const LIMIT = 5; // hits per group in the drop-down

	const id = $props.id();
	let query = $state('');
	let open = $state(false);
	let active = $state(-1); // index in `options`; -1: none
	let root = $state<HTMLElement>();

	// The hits, numbered in order (the arrows move through them, then "every result").
	const groups = $derived.by(() => {
		void searcher.version;
		let n = 0;
		return results(searcher.hits(query), searcher.sources.catalogs[i18n.lang], searcher.sources, LIMIT).map((g) => ({
			...g,
			hits: g.hits.map((h) => ({ ...h, n: n++ }))
		}));
	});
	const allHref = $derived(url(`/search?q=${encodeURIComponent(query.trim())}`));
	const options = $derived([...groups.flatMap((g) => g.hits.map((h) => h.href)), allHref]);
	const last = $derived(options.length - 1); // "every result"
	const shown = $derived(open && !!query.trim());

	$effect(() => {
		void query;
		active = -1; // a new query: nothing chosen
	});
	afterNavigate(() => {
		open = false;
	});

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Open: only closed (a search input clears itself on Escape otherwise); closed: cleared.
			if (shown) {
				e.preventDefault();
				open = false;
			} else query = '';
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
			const n = options.length;
			active = e.key === 'ArrowDown' ? (active + 1) % n : active <= 0 ? n - 1 : active - 1;
			document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter' && query.trim()) {
			e.preventDefault();
			void goto(options[active] ?? allHref);
		}
	}
	function focusout(e: FocusEvent) {
		if (!root?.contains(e.relatedTarget as Node | null)) open = false;
	}
</script>

<div class="search-box" bind:this={root} onfocusout={focusout}>
	<span class="icon"><Icon name="search" size={18} /></span>
	<input
		type="search"
		role="combobox"
		bind:value={query}
		placeholder={t('search.placeholder')}
		aria-label={t('search.label')}
		aria-expanded={shown}
		aria-controls="{id}-list"
		aria-autocomplete="list"
		aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
		autocomplete="off"
		spellcheck="false"
		onfocus={() => {
			open = true;
			void searcher.refresh();
		}}
		oninput={() => (open = true)}
		onkeydown={keydown}
	/>
	{#if shown}
		<div class="popup">
			{#if searcher.failed}
				<p class="hint">{t('search.unavailable')}</p>
			{:else if !groups.length}
				<p class="hint" role="status">{t('search.none')}</p>
			{/if}
			<div id="{id}-list" role="listbox" aria-label={t('search.label')}>
				{#each groups as g (g.group)}
					<div role="group" aria-labelledby="{id}-{g.group}">
						<div class="group" id="{id}-{g.group}">{t(`search.group.${g.group}` as MessageKey)}</div>
						{#each g.hits as hit (hit.key)}
							<a
								id="{id}-{hit.n}"
								role="option"
								aria-selected={active === hit.n}
								class:active={active === hit.n}
								href={hit.href}
								tabindex="-1"
								data-kind={hit.kind}
							>
								<span class="title">{hit.title}</span>
								<span class="detail">
									{#if g.group === 'catalog'}{t(`search.kind.${hit.kind}` as MessageKey)} ·{/if}
									{hit.detail}
								</span>
							</a>
						{/each}
					</div>
				{/each}
				<a
					id="{id}-{last}"
					role="option"
					aria-selected={active === last}
					class="all"
					class:active={active === last}
					href={allHref}
					tabindex="-1"
				>
					{t('search.all')}
				</a>
			</div>
		</div>
	{/if}
</div>

<style>
	.search-box {
		position: relative;
		width: 16rem;
		max-width: 100%;
	}
	.icon {
		position: absolute;
		left: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		color: var(--muted);
		pointer-events: none;
	}
	input {
		width: 100%;
		padding-left: var(--space-7);
		border-radius: var(--radius-pill);
	}
	.popup {
		position: absolute;
		right: 0;
		top: calc(100% + var(--space-2));
		z-index: 10;
		width: min(28rem, calc(100vw - 2 * var(--space-4)));
		max-height: 70vh;
		overflow-y: auto;
		display: grid;
		padding: var(--space-1);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-menu);
	}
	.popup .hint {
		margin: 0;
		padding: var(--space-2) var(--space-3);
	}
	.group {
		padding: var(--space-2) var(--space-3) var(--space-1);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		color: var(--muted);
	}
	a {
		display: grid;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--text);
		text-decoration: none;
	}
	a:hover,
	a.active {
		background: var(--bg);
	}
	a.active {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.title {
		font-weight: 600;
	}
	.detail {
		font-size: var(--text-sm);
		color: var(--muted);
	}
	.all {
		color: var(--accent);
		font-size: var(--text-sm);
	}
</style>
