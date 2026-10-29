<script lang="ts">
	// The local video (never uploaded here), its controls and the timeline where
	// segments are marked. Keys: Space play/pause, ← → one frame, I begin, O end,
	// Escape clears the selection.
	// `current` is the seek marker (playhead): it moves when seeking or playing.
	// Pointing at the timeline shows that frame in the video without moving it;
	// when the pointer leaves, the video shows the marker's frame again.
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';
	import { frameStep } from '../frames';
	import { formatTime } from '../time';
	import type { Annotation } from './draft.svelte';
	import { addSegment, beginHere, endHere, keyAction, moveSegment, type KeyAction } from './marking';
	import Timeline from './Timeline.svelte';
	import { makeStrip, measureFrame } from './video';

	let {
		src,
		draft = $bindable(),
		duration = $bindable(0),
		playable = $bindable(true),
		selected = $bindable(null),
		video = $bindable()
	}: {
		src: string;
		draft: Annotation;
		duration?: number;
		playable?: boolean;
		selected?: number | null;
		video?: HTMLVideoElement;
	} = $props();

	let current = $state(0);
	let paused = $state(true);
	let marker = $state<number | null>(null);
	let frame = $state(1 / 30); // seconds per frame, measured once the video is loaded
	let strip = $state<string[]>([]);

	const clamp = (time: number) => Math.min(Math.max(time, 0), duration);

	let previewing = false;
	let resume = false; // playing when the preview started: play again after it
	let pending: number | null = null; // the latest frame asked for while a seek runs

	/** Show this frame. Seeks one at a time: a fast pointer would queue hundreds. */
	function show(time: number) {
		if (!video) return;
		if (video.seeking) pending = time;
		else video.currentTime = time;
	}

	function seeked() {
		if (pending === null) return;
		const time = pending;
		pending = null;
		show(time);
	}

	function seek(time: number) {
		// At once, not on the next timeupdate: I/O pressed right after a click
		// must use the clicked time.
		current = clamp(time);
		show(current);
	}

	function preview(time: number | null) {
		if (!video) return;
		if (time !== null) {
			if (!previewing) {
				previewing = true;
				resume = !video.paused;
				video.pause();
			}
			show(clamp(time));
		} else if (previewing) {
			previewing = false;
			show(current);
			if (resume) video.play();
		}
	}

	/** Playing moves the marker; a preview's seeks never do. */
	function timeupdate() {
		if (video && !previewing && !video.paused) current = video.currentTime;
	}

	const step = (frames: number) => {
		if (video && !video.paused) {
			video.pause();
			current = video.currentTime; // timeupdate lags: where it actually stopped
		}
		seek(frameStep(current, frames, frame));
	};

	function stop() {
		video?.pause();
		seek(0);
	}

	const toggle = () => (video?.paused ? video.play() : video?.pause());

	// The rules (marking.ts) on this editor's state: the selected segment, the begin marker.
	function create(begin: number, end: number) {
		selected = addSegment(draft, begin, end);
		marker = null;
	}

	const change = (key: number, begin: number, end: number) => moveSegment(draft, key, begin, end, duration);

	function mark(rule: typeof beginHere) {
		({ selected, marker } = rule(draft, { selected, marker }, current));
	}

	const ACTIONS: Record<KeyAction, () => void> = {
		toggle,
		back: () => step(-1),
		forward: () => step(1),
		begin: () => mark(beginHere),
		end: () => mark(endHere),
		clear: () => {
			selected = null;
			marker = null;
		}
	};

	function onkeydown(e: KeyboardEvent) {
		if (!playable) return;
		const inControl = !!(e.target as HTMLElement).closest('input, select, textarea, button');
		const action = keyAction(e.key, e, inControl);
		if (action) {
			e.preventDefault();
			ACTIONS[action]();
		}
	}

	async function loaded() {
		if (!video) return;
		duration = video.duration;
		playable = video.videoWidth > 0;
		if (!playable) return;
		const url = src;
		frame = await measureFrame(url, frame);
		makeStrip(url, duration, (images) => (strip = images), () => url === src);
	}
</script>

<svelte:window {onkeydown} />

<div class="editor">
	<!-- svelte-ignore a11y_media_has_caption: the user's own video, being edited -->
	<video
		bind:this={video}
		{src}
		preload="auto"
		bind:paused
		ontimeupdate={timeupdate}
		onseeked={seeked}
		onended={() => video && (current = video.currentTime)}
		onloadedmetadata={loaded}
		onerror={() => (playable = false)}
	></video>

	{#if playable}
		<div class="controls">
			<div class="buttons">
				<IconButton label={t('player.back_frame')} icon="frame-back" onclick={() => step(-1)} />
				<IconButton label={t(paused ? 'player.play' : 'player.pause')} icon={paused ? 'play' : 'pause'} onclick={toggle} />
				<IconButton label={t('player.stop')} icon="stop" onclick={stop} />
				<IconButton label={t('player.forward_frame')} icon="frame-forward" onclick={() => step(1)} />
			</div>
			<Timeline
				{duration}
				{current}
				segments={draft.segments}
				{selected}
				{marker}
				{strip}
				onseek={seek}
				oncreate={create}
				onchange={change}
				onselect={(key) => (selected = key)}
				onpreview={preview}
			/>
		</div>
		<div class="marks">
			<span class="time">{formatTime(Math.floor(current))} / {formatTime(Math.floor(duration))}</span>
			<!-- Together: they wrap as a pair, side by side or one above the other. -->
			<span class="mark-buttons">
				<button type="button" class="secondary" onclick={() => mark(beginHere)}>{t('upload.begin_here')}</button>
				<button type="button" class="secondary" onclick={() => mark(endHere)}>{t('upload.end_here')}</button>
			</span>
		</div>
		<p class="hint">{t('upload.timeline_hint')}</p>
	{/if}
</div>

<style>
	.editor {
		display: grid;
		gap: var(--space-2);
	}
	video {
		width: 100%;
		max-height: 60vh;
		background: var(--media-bg);
		border-radius: var(--radius);
	}
	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.buttons {
		display: flex;
		gap: var(--space-1);
	}
	.marks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.mark-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.time {
		font-variant-numeric: tabular-nums;
		color: var(--muted);
		margin-right: auto;
	}
	@media (max-width: 30rem) {
		.controls {
			flex-direction: column;
			align-items: stretch;
		}
		.buttons {
			justify-content: center;
		}
	}
</style>
