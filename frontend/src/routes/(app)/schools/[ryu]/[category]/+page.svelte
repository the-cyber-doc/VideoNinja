<script lang="ts">
	// A school's sections in a category (Taijutsu, Muto Dori; Buki has its own route).
	import SectionsPage from '#lib/browse/SectionsPage.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<SectionsPage path={{ ryu: params.ryu, category: params.category }} />
