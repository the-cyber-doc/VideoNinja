<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import AccountWizard from '#lib/AccountWizard.svelte';

	// The link is /register#<token>: the fragment never reaches the server or its logs.
	// Read it once, then remove it from the address bar and the browser history.
	const token = decodeURIComponent(location.hash.slice(1));
	onMount(() => replaceState(location.pathname, {}));
</script>

<AccountWizard invite={token} />
