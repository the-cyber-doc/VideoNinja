<script lang="ts">
	// The local video (never uploaded here), its controls and the timeline where
	// segments are marked. Keys: Space play/pause, ← → one frame, I begin, O end,
	// Escape clears the selection.
	// `current` is the seek marker (playhead): it moves when seeking or playing.
	// Pointing at the timeline shows that frame in the video without moving it;
	// when the pointer leaves, the video shows the marker's frame again.
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';
	import { FRAME_SAMPLES, frameDuration, frameStep, type FrameSample } from '../frames';
	import { formatTime } from '../time';
	import type { Annotation } from './draft.svelte';
	import Timeline from './Timeline.svelte';

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
	const STRIP_IMAGES = 24;

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

	function nextKey() {
		return Math.max(0, ...draft.segments.map((s) => s.key)) + 1;
	}

	function create(begin: number, end: number) {
		// The new segment starts with the previous one's place in the catalogue (all but the technique) and performer.
		const last = draft.segments.at(-1);
		const key = nextKey();
		draft.segments.push({
			key,
			begin,
			end,
			school: last?.school ?? '',
			category: last?.category ?? '',
			weapon: last?.weapon ?? '',
			section: last?.section ?? '',
			technique: '',
			performer: last?.performer ?? '',
			tags: []
		});
		selected = key;
		marker = null;
	}

	function change(key: number, begin: number, end: number) {
		const segment = draft.segments.find((s) => s.key === key);
		if (segment) Object.assign(segment, { begin: clamp(begin), end: clamp(end) });
	}

	/** I: the selected segment's begin, else the marker of a new segment. */
	function beginHere() {
		const segment = draft.segments.find((s) => s.key === selected);
		if (segment && current < segment.end) segment.begin = current;
		else marker = current;
	}

	/** O: ends the segment started by the marker, else the selected segment's end. */
	function endHere() {
		if (marker !== null && current > marker) return create(marker, current);
		const segment = draft.segments.find((s) => s.key === selected);
		if (segment && current > segment.begin) segment.end = current;
	}

	function onkeydown(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (!playable || target.closest('input, select, textarea, button') || e.ctrlKey || e.metaKey || e.altKey) {
			return;
		}
		const actions: Record<string, () => void> = {
			' ': toggle,
			ArrowLeft: () => step(-1),
			ArrowRight: () => step(1),
			i: beginHere,
			o: endHere,
			Escape: () => {
				selected = null;
				marker = null;
			}
		};
		const action = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
		if (action) {
			e.preventDefault();
			action();
		}
	}

	/** Frame duration from consecutive frames, played for a moment by a hidden,
	 * muted video: the visible one (and its seek marker) is never disturbed. In the
	 * page, invisible: WebKit only reports the frames of a video it renders. */
	async function measureFrame(url: string): Promise<number> {
		const v = document.createElement('video');
		if (!('requestVideoFrameCallback' in v)) return frame;
		v.muted = true;
		v.playsInline = true;
		v.preload = 'auto';
		v.setAttribute('aria-hidden', 'true');
		v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
		document.body.append(v);
		v.src = url;
		const samples: FrameSample[] = [];
		const measured = await new Promise<number>((resolve) => {
			const timer = setTimeout(() => resolve(frame), 2000);
			const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
				samples.push(meta);
				if (samples.length < FRAME_SAMPLES) return v.requestVideoFrameCallback(onFrame);
				clearTimeout(timer);
				resolve(frameDuration(samples) ?? frame);
			};
			v.requestVideoFrameCallback(onFrame);
			v.play().catch(() => resolve(frame));
		});
		v.pause();
		v.removeAttribute('src');
		v.load();
		v.remove();
		return measured;
	}

	/** Film strip: frames grabbed by a second, hidden video element. Stops at an
	 * error (e.g. the server's limit of parallel requests for one video: 429). */
	async function makeStrip(url: string, total: number) {
		const probe = document.createElement('video');
		probe.muted = true;
		probe.preload = 'auto';
		probe.src = url;
		const next = (event: string) =>
			new Promise<boolean>((resolve) => {
				probe.addEventListener(event, () => resolve(true), { once: true });
				probe.addEventListener('error', () => resolve(false), { once: true });
			});
		if (!(await next('loadeddata'))) return;
		const canvas = document.createElement('canvas');
		canvas.height = 54;
		canvas.width = Math.max(1, Math.round((54 * probe.videoWidth) / (probe.videoHeight || 1)));
		const images: string[] = [];
		for (let i = 0; i < STRIP_IMAGES && url === src; i++) {
			probe.currentTime = ((i + 0.5) * total) / STRIP_IMAGES;
			if (!(await next('seeked'))) break;
			canvas.getContext('2d')!.drawImage(probe, 0, 0, canvas.width, canvas.height);
			images.push(canvas.toDataURL('image/jpeg', 0.6));
			strip = [...images];
		}
		probe.removeAttribute('src');
		probe.load();
	}

	async function loaded() {
		if (!video) return;
		duration = video.duration;
		playable = video.videoWidth > 0;
		if (!playable) return;
		frame = await measureFrame(src);
		makeStrip(src, duration);
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
				<button type="button" class="secondary" onclick={beginHere}>{t('upload.begin_here')}</button>
				<button type="button" class="secondary" onclick={endHere}>{t('upload.end_here')}</button>
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
