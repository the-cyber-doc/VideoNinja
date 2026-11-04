<script lang="ts">
	// Every book (PDF), in one grid: the 'book_mgmt' access (+page.ts). Uploads, the
	// grid, its filter and the viewer come next.
	import { t } from '#lib/i18n.svelte.js';
</script>

<div class="page">
	<h1>{t('books.title')}</h1>
	<p class="hint centered">{t('books.none')}</p>
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
	}
	h1 {
		text-align: center;
	}
</style>
