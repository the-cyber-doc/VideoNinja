<script lang="ts">
	// A technique.
	import TechniquePage from '#lib/browse/TechniquePage.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<TechniquePage path={params} />
