<script lang="ts">
	// Test local codecs (from the upload page; the 'upload' access, checked in +page.ts): the
	// browser's answers for every format, the real tests on the sample clips, the results
	// copied for whoever asked. The logic is CodecTest's (codecs.svelte.ts).
	import { url } from '#lib/base.js';
	import FormatTable from '#lib/codecs/FormatTable.svelte';
	import SampleTests from '#lib/codecs/SampleTests.svelte';
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { t } from '#lib/i18n.svelte.js';
	import Section from '#lib/Section.svelte';
	import { CodecTest } from './codecs.svelte.js';

	const test = new CodecTest();
	$effect(() => {
		test.start();
	});
</script>

<div class="page">
	<a class="back" href={url('/upload')}>← {t('upload.title')}</a>
	<h1>{t('codecs.title')}</h1>
	<p class="hint intro">{t('codecs.intro')}</p>
	<ErrorMessage error={test.error} />

	<Section title={t('codecs.answers')} hint={t('codecs.answers_hint')} open>
		<div class="content">
			{#if test.formats}
				<FormatTable formats={test.formats} />
			{:else}
				<p class="hint" role="status">{t('codecs.checking')}</p>
			{/if}
		</div>
	</Section>

	<Section title={t('codecs.tests')} hint={t('codecs.tests_hint')} open>
		<div class="content">
			<div class="buttons">
				<button type="button" disabled={test.running} onclick={() => test.run()}>{t('codecs.run')}</button>
				{#if test.step}
					<span class="hint" role="status">
						{t(test.step.kind === 'decode' ? 'codecs.step.decode' : 'codecs.step.encode', { name: test.step.label })}
					</span>
				{/if}
			</div>
			{#if test.decoding}
				<SampleTests
					decoding={test.decoding}
					encoding={test.encoding}
					encodedFrom={test.encodedFrom}
					running={test.running}
				/>
			{/if}
		</div>
	</Section>

	<section class="card send">
		<label>
			{t('codecs.name')}
			<input bind:value={test.name} placeholder={t('codecs.name_placeholder')} maxlength="60" />
		</label>
		<div class="buttons">
			<button type="button" disabled={test.running || !test.formats} onclick={() => test.copy()}>
				{test.copied ? t('codecs.copied') : t('codecs.copy')}
			</button>
			<span class="hint">{t('codecs.copy_hint')}</span>
		</div>
	</section>
</div>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-4);
	}
	.back {
		justify-self: start;
	}
	h1 {
		text-align: center;
		margin: 0;
	}
	.intro {
		text-align: center;
	}
	.content {
		display: grid;
		gap: var(--space-3);
		padding: 0 var(--space-4) var(--space-4);
	}
	.card {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	label {
		display: grid;
		gap: var(--space-1);
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
</style>
