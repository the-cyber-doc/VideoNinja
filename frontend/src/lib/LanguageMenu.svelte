<script lang="ts">
	// Language chooser: a button with the current language's flag, opening the list of
	// supported languages, each with its flag and its name in that language.
	import Flag from './Flag.svelte';
	import { i18n, LANGUAGES, setLang, t, type Lang } from './i18n.svelte';

	let open = $state(false);
	let root = $state<HTMLElement>();
	const langs = Object.keys(LANGUAGES) as Lang[];
	const label = $derived(t('language.current', { name: LANGUAGES[i18n.lang] }));

	function choose(lang: Lang) {
		setLang(lang);
		open = false;
	}

	function onWindowClick(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="language-menu" bind:this={root}>
	<button
		class="flag-button"
		aria-label={label}
		title={label}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Flag lang={i18n.lang} width={26} />
	</button>
	{#if open}
		<div class="menu" role="menu">
			{#each langs as lang (lang)}
				<button
					role="menuitemradio"
					aria-checked={lang === i18n.lang}
					onclick={() => choose(lang)}
				>
					<Flag {lang} />
					<span {lang}>{LANGUAGES[lang]}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.language-menu {
		position: relative;
	}
	.flag-button {
		display: grid;
		place-items: center;
		height: 2.4rem;
		padding: 0 var(--space-2);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.menu {
		position: absolute;
		right: 0;
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
	.menu button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font: inherit;
		font-weight: normal;
		color: var(--text);
		background: none;
		border: 0;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--bg);
	}
	.menu button[aria-checked='true'] {
		font-weight: 600;
	}
</style>
