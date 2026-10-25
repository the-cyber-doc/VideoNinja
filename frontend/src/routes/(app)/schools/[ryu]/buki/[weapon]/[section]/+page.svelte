<script lang="ts">
	// The techniques of a weapon's section.
	import TechniquesPage from '#lib/browse/TechniquesPage.svelte';
	import { BUKI } from '#lib/catalog.svelte.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<TechniquesPage path={{ ryu: params.ryu, category: BUKI, weapon: params.weapon, section: params.section }} />
