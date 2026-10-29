<script lang="ts">
	// The video's timeline: film strip, segments as coloured bands, playhead, and
	// the begin marker set with "Begin here". Click = seek; click-and-drag on an
	// empty place = new segment; drag a segment's edge = move it; click a segment
	// = select it. The pointer's position is previewed all the time (hovering,
	// creating, resizing): onpreview(time), then onpreview(null) when it leaves.
	import { t } from '../i18n.svelte';
	import { formatTime } from '../time';
	import type { DraftSegment } from './draft.svelte';

	let {
		duration,
		current,
		segments,
		selected,
		marker,
		strip,
		onseek,
		oncreate,
		onchange,
		onselect,
		onpreview
	}: {
		duration: number;
		current: number;
		segments: DraftSegment[];
		selected: number | null;
		marker: number | null;
		/** Film strip images (data URLs), evenly spaced. */
		strip: string[];
		onseek: (time: number) => void;
		oncreate: (begin: number, end: number) => void;
		onchange: (key: number, begin: number, end: number) => void;
		onselect: (key: number | null) => void;
		/** The time under the pointer, or null: back to the playhead. */
		onpreview: (time: number | null) => void;
	} = $props();

	let hover = $state<number | null>(null);
	function preview(time: number | null) {
		hover = time;
		onpreview(time);
	}

	/** Pointer outside the track: the playhead's frame again. */
	function outside(e: PointerEvent) {
		const rect = track!.getBoundingClientRect();
		return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
	}

	let track = $state<HTMLElement>();
	let drag = $state<
		| { kind: 'create'; start: number; end: number; x: number }
		| { kind: 'edge'; key: number; edge: 'begin' | 'end' }
		| null
	>(null);

	const MIN_DRAG_PX = 4; // shorter: a click (seek), not a segment
	const pct = (time: number) => `${duration ? (time / duration) * 100 : 0}%`;

	function timeAt(e: PointerEvent): number {
		const rect = track!.getBoundingClientRect();
		const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
		return fraction * duration;
	}

	function down(e: PointerEvent) {
		if (!duration || e.button !== 0) return;
		const target = e.target as HTMLElement;
		const time = timeAt(e);
		track!.setPointerCapture(e.pointerId);
		const edge = target.dataset.edge as 'begin' | 'end' | undefined;
		const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
		if (edge && key) {
			drag = { kind: 'edge', key: Number(key), edge };
			onselect(Number(key));
		} else if (key) {
			onselect(Number(key));
			onseek(time);
		} else {
			drag = { kind: 'create', start: time, end: time, x: e.clientX };
		}
	}

	function move(e: PointerEvent) {
		const time = timeAt(e);
		// While dragging (pointer captured), also outside the track: the edge being placed.
		if (drag || !outside(e)) preview(time);
		if (!drag) return;
		if (drag.kind === 'create') {
			drag.end = time;
		} else {
			const segment = segments.find((s) => s.key === (drag as { key: number }).key);
			if (!segment) return;
			if (drag.edge === 'begin') onchange(segment.key, Math.min(time, segment.end - 0.04), segment.end);
			else onchange(segment.key, segment.begin, Math.max(time, segment.begin + 0.04));
		}
	}

	function up(e: PointerEvent) {
		if (drag?.kind === 'create') {
			if (Math.abs(e.clientX - drag.x) < MIN_DRAG_PX) {
				onselect(null);
				onseek(timeAt(e));
			} else {
				oncreate(Math.min(drag.start, drag.end), Math.max(drag.start, drag.end));
			}
		}
		drag = null;
		// A finger has no hover; a mouse released outside the track has left it.
		if (e.pointerType === 'touch' || outside(e)) preview(null);
	}
</script>

<div
	class="track"
	bind:this={track}
	role="slider"
	tabindex="-1"
	aria-label={t('upload.timeline')}
	aria-valuemin={0}
	aria-valuemax={Math.round(duration)}
	aria-valuenow={Math.round(current)}
	aria-valuetext={formatTime(Math.floor(current))}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={() => ((drag = null), preview(null))}
	onpointerleave={() => drag || preview(null)}
>
	<div class="strip" aria-hidden="true">
		{#each strip as image, i (i)}
			<img src={image} alt="" draggable="false" />
		{/each}
	</div>

	{#each segments as segment, i (segment.key)}
		<div
			class="segment"
			class:selected={segment.key === selected}
			data-key={segment.key}
			style:left={pct(segment.begin)}
			style:width={pct(segment.end - segment.begin)}
			style:--hue={(i * 67) % 360}
		>
			<span class="edge begin" data-edge="begin"></span>
			<span class="label">{i + 1}</span>
			<span class="edge end" data-edge="end"></span>
		</div>
	{/each}

	{#if drag?.kind === 'create'}
		<div
			class="segment preview"
			style:left={pct(Math.min(drag.start, drag.end))}
			style:width={pct(Math.abs(drag.end - drag.start))}
		></div>
	{/if}
	{#if marker !== null}
		<div class="marker" style:left={pct(marker)} title={t('upload.begin_here')}></div>
	{/if}
	<div class="playhead" style:left={pct(current)}></div>
	{#if hover !== null}
		<div class="hover" style:left={pct(hover)} aria-hidden="true">
			<span class:right={hover > duration / 2}>{formatTime(Math.floor(hover))}</span>
		</div>
	{/if}
</div>

<style>
	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 4rem;
		min-height: 4rem; /* in a column (phones), flex: 1 alone would shrink it to nothing */
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		overflow: hidden;
		cursor: crosshair;
		touch-action: none; /* drag with a finger without scrolling the page */
		user-select: none;
	}
	.strip {
		position: absolute;
		inset: 0;
		display: flex;
		opacity: 0.85;
	}
	.strip img {
		flex: 1;
		min-width: 0;
		height: 100%;
		object-fit: cover;
	}
	.segment {
		position: absolute;
		top: var(--space-2);
		bottom: var(--space-2);
		background: hsl(var(--hue, 0) 70% 50% / 0.45);
		border: 2px solid hsl(var(--hue, 0) 70% 40%);
		border-radius: var(--radius-xs);
		cursor: pointer;
	}
	.segment.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent);
	}
	.segment.preview {
		background: var(--media-highlight);
		border-style: dashed;
		border-color: var(--text);
		pointer-events: none;
	}
	.label {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--on-media);
		text-shadow: var(--media-text-shadow);
		pointer-events: none;
	}
	.edge {
		--edge: 0.6rem; /* the handle's width, centred on the segment's edge */
		position: absolute;
		top: 0;
		bottom: 0;
		width: var(--edge);
		cursor: ew-resize;
	}
	.edge.begin {
		left: calc(var(--edge) / -2);
	}
	.edge.end {
		right: calc(var(--edge) / -2);
	}
	.playhead,
	.marker {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		translate: -1px 0;
		pointer-events: none;
	}
	.playhead {
		background: var(--accent);
	}
	.marker {
		border-left: 2px dashed var(--text);
	}
	.hover {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--text);
		opacity: 0.8;
		pointer-events: none;
	}
	.hover span {
		position: absolute;
		top: 0;
		left: var(--space-0);
		padding: 0 var(--space-1);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--on-media);
		background: var(--scrim);
		border-radius: 3px;
	}
	.hover span.right {
		left: auto;
		right: var(--space-0);
	}
</style>
