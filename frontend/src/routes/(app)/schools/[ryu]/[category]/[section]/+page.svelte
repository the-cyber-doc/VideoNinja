<script lang="ts">
	// The techniques of a section.
	import TechniquesPage from '#lib/browse/TechniquesPage.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<TechniquesPage path={{ ryu: params.ryu, category: params.category, section: params.section }} />
