<script lang="ts">
	import '../app.css';
	import { registerServiceWorker } from '#lib/pwa.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	$effect(registerServiceWorker);
</script>

<svelte:head>
	<title>Video Ninja</title>
</svelte:head>

{@render children()}
