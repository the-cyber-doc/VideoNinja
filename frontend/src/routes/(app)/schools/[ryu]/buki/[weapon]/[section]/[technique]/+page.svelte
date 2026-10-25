<script lang="ts">
	// A weapon technique.
	import TechniquePage from '#lib/browse/TechniquePage.svelte';
	import { BUKI } from '#lib/catalog.svelte.js';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<TechniquePage path={{ ...params, category: BUKI }} />
