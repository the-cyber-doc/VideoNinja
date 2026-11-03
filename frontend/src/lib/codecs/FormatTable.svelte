<script lang="ts">
	// Test local codecs: the browser's answers, one row per format (formats.ts). Play =
	// the browser's own player in MP4 and WebM; encode / decode = WebCodecs.
	import { t } from '../i18n.svelte';
	import { FORMATS, type Answer, type Container, type FormatResult, type Playback } from './formats';

	let { formats }: { formats: Record<string, FormatResult> } = $props();

	const CONTAINERS: Container[] = ['mp4', 'webm'];
	const answer = (a: Answer) => (a === null ? t('codecs.unknown') : a ? t('codecs.yes') : t('codecs.no'));
	function playing(p: Playback | null | undefined) {
		if (!p) return t('codecs.unknown');
		if (!p.supported) return t('codecs.no');
		const notes = [!p.smooth && t('codecs.play.not_smooth'), p.powerEfficient && t('codecs.play.hardware')];
		return [t('codecs.yes'), ...notes.filter(Boolean)].join(', ');
	}
</script>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th scope="col">{t('codecs.col.format')}</th>
				<th scope="col">{t('codecs.col.play_mp4')}</th>
				<th scope="col">{t('codecs.col.play_webm')}</th>
				<th scope="col">{t('codecs.col.encode_hw')}</th>
				<th scope="col">{t('codecs.col.encode')}</th>
				<th scope="col">{t('codecs.col.decode')}</th>
			</tr>
		</thead>
		<tbody>
			{#each FORMATS as format (format.id)}
				{@const r = formats[format.id]}
				<tr data-id={format.id}>
					<th scope="row">{format.label}<br /><code>{format.codec}</code></th>
					{#each CONTAINERS as container (container)}
						{@const p = r.play[container]}
						<td class:yes={p?.supported} class:no={p && !p.supported}>
							{format.containers.includes(container) ? playing(p) : ''}
						</td>
					{/each}
					{#each [format.kind === 'video' ? r.encodeHardware : undefined, r.encode, r.decode] as a, i (i)}
						<td class:yes={a === true} class:no={a === false}>{a === undefined ? '' : answer(a)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="hint">{t('codecs.legend')}</p>

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
	code {
		font-size: var(--text-xs);
		color: var(--muted);
	}
	.yes {
		color: var(--accent);
		font-weight: 600;
	}
	.no {
		color: var(--muted);
	}
</style>
