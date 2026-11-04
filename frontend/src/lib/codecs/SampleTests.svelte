<script lang="ts">
	// Test local codecs: the real tests' results (samples.ts): each sample decoded and
	// played, then the encodings from one of them. Rows fill in as the tests run ("…").
	import type { MessageKey } from '../i18n.svelte';
	import { t } from '../i18n.svelte';
	import {
		SAMPLE_FRAMES,
		SAMPLES,
		sampleUrl,
		TARGETS,
		type DecodeResult,
		type EncodeResult,
		type TestError
	} from './samples';

	let {
		decoding,
		encoding,
		encodedFrom,
		running
	}: {
		decoding: Record<string, DecodeResult>;
		encoding: Record<string, EncodeResult> | null;
		encodedFrom: string | null;
		running: boolean;
	} = $props();

	const yesNo = (ok: boolean) => (ok ? t('codecs.yes') : t('codecs.no'));
	const problem = (e?: TestError) =>
		e ? [t(`codecs.error.${e.code}` as MessageKey), e.detail].filter(Boolean).join(' — ') : '';
	const source = $derived(SAMPLES.find((s) => s.id === encodedFrom));
</script>

<div class="scroll">
	<table class="decoding">
		<thead>
			<tr>
				<th scope="col">{t('codecs.col.sample')}</th>
				<th scope="col">{t('codecs.col.frames')}</th>
				<th scope="col">{t('codecs.col.audio')}</th>
				<th scope="col">{t('codecs.col.plays')}</th>
				<th scope="col">{t('codecs.col.problem')}</th>
			</tr>
		</thead>
		<tbody>
			{#each SAMPLES as sample (sample.id)}
				{@const d = decoding[sample.id]}
				<tr data-id={sample.id}>
					<th scope="row"><a href={sampleUrl(sample)} download>{sample.label}</a></th>
					{#if d}
						<td class:yes={d.frames === SAMPLE_FRAMES} class:no={d.frames < SAMPLE_FRAMES}>
							{d.frames}/{SAMPLE_FRAMES}
						</td>
						<td class:yes={d.audio} class:no={!d.audio}>{yesNo(d.audio)}</td>
						<td class:yes={d.plays} class:no={!d.plays}>{yesNo(d.plays)}</td>
						<td class="problem">{problem(d.error)}</td>
					{:else}
						<td colspan="4">…</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if source && encoding}
	<div class="scroll">
		<table class="encoding">
			<thead>
				<tr>
					<th scope="col">{t('codecs.col.target', { name: source.label })}</th>
					<th scope="col">{t('codecs.col.result')}</th>
					<th scope="col">{t('codecs.col.time')}</th>
					<th scope="col">{t('codecs.col.size')}</th>
					<th scope="col">{t('codecs.col.problem')}</th>
				</tr>
			</thead>
			<tbody>
				{#each TARGETS as target (target.id)}
					{@const e = encoding[target.id]}
					<tr data-id={target.id}>
						<th scope="row">{target.label}</th>
						{#if e}
							<td class:yes={e.ok} class:no={!e.ok}>
								{e.ok ? t('codecs.frames_back', { n: e.framesBack ?? 0 }) : t('codecs.no')}
							</td>
							<td>{e.seconds === undefined ? '' : t('codecs.seconds', { n: e.seconds })}</td>
							<td>{e.bytes === undefined ? '' : t('codecs.kilobytes', { n: Math.round(e.bytes / 1024) })}</td>
							<td class="problem">{problem(e.error)}</td>
						{:else}
							<td colspan="4">…</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if !running && !source}
	<p class="hint">{t('codecs.no_source')}</p>
{/if}

<style>
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th,
	td {
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: top;
		white-space: nowrap;
	}
	tbody th {
		font-weight: normal;
	}
	.problem {
		white-space: normal;
		font-size: var(--text-xs);
		color: var(--muted);
		min-width: 12rem;
	}
	.yes {
		color: var(--ok);
		font-weight: 600;
	}
	.no {
		color: var(--error);
	}
</style>
