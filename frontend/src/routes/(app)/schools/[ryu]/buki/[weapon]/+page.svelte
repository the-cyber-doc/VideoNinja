<script lang="ts">
	// The sections of a weapon, in a school.
	import SectionsPage from '#lib/browse/SectionsPage.svelte';
	import { BUKI } from '#lib/catalog.svelte.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<SectionsPage path={{ ryu: params.ryu, category: BUKI, weapon: params.weapon }} />
