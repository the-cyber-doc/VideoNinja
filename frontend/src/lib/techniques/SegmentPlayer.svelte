<script lang="ts">
	// A segment's clip in a modal dialog, playing at once. The server sends only the
	// clip (cut from the video), which starts while the rest downloads; the service
	// worker keeps it for offline use. Own play/pause (Space; the browser's is tiny
	// on phones), frame by frame (buttons, ← →) and slow motion (½, ¼, ⅛); the
	// browser's controls stay for seeking, volume and full screen. Closes with
	// Escape, the button or a click outside; closing stops it.
	// The server sends one clip per user at a time: while another one downloads
	// (e.g. still being saved for offline use), it refuses this one (429). The
	// player says so and offers to try again.
	import Icon from '../Icon.svelte';
	import type { Segment } from '../catalog.svelte';
	import { i18n, t } from '../i18n.svelte';
	import { clipUrl, segmentDuration } from '../media';
	import { FRAME_SAMPLES, frameDuration, frameStep, type FrameSample } from '../frames';
	import { formatTime } from '../time';

	let { segment, title, onclose }: { segment: Segment; title: string; onclose: () => void } = $props();

	let dialog = $state<HTMLDialogElement>();
	let video = $state<HTMLVideoElement>();
	let failed = $state<'' | 'busy' | 'error'>('');
	let speed = $state(1);
	let paused = $state(true);
	const SPEEDS = [1, 0.5, 0.25, 0.125];
	const speedLabel = (value: number) =>
		t('player.speed_value', { speed: new Intl.NumberFormat(i18n.lang, { maximumFractionDigits: 3 }).format(value) });

	// Seconds per frame: measured from the first frames played (no second download,
	// unlike a probe video), 1/30 until then or where the browser cannot tell.
	let frame = 1 / 30;
	function measureFrame(v: HTMLVideoElement) {
		if (!('requestVideoFrameCallback' in v)) return;
		const samples: FrameSample[] = [];
		const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
			samples.push(meta);
			if (samples.length < FRAME_SAMPLES) return v.requestVideoFrameCallback(onFrame);
			// Slowed down or not, mediaTime counts in the video's own time.
			frame = frameDuration(samples) ?? frame;
		};
		v.requestVideoFrameCallback(onFrame);
	}

	function step(frames: number) {
		if (!video) return;
		video.pause();
		video.currentTime = Math.min(Math.max(frameStep(video.currentTime, frames, frame), 0), video.duration || 0);
	}

	/** Why the clip did not load: a HEAD (not answered by the service worker) asks the server. */
	async function loadFailed() {
		let busy = false;
		try {
			busy = (await fetch(clipUrl(segment), { method: 'HEAD', credentials: 'same-origin' })).status === 429;
		} catch {
			// offline
		}
		failed = busy ? 'busy' : 'error';
	}

	const toggle = () => (video?.paused ? video.play() : video?.pause());

	function onkeydown(e: KeyboardEvent) {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		// Space on a button presses that button.
		if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
			e.preventDefault();
			toggle();
		}
		// Also when the video has the focus: its own arrows jump 5 s, too much for a clip.
		const frames = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
		if (frames === undefined) return;
		e.preventDefault();
		step(frames);
	}

	$effect(() => {
		dialog?.showModal();
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions: Escape closes it (native) -->
<dialog
	bind:this={dialog}
	aria-label={t('player.label', { title, duration: formatTime(segmentDuration(segment)) })}
	onclose={onclose}
	onclick={(e) => e.target === dialog && dialog.close()}
	onkeydowncapture={onkeydown}
>
	<header>
		<h2>{title} <span class="duration">{formatTime(segmentDuration(segment))}</span></h2>
		<button type="button" class="icon" title={t('player.close')} aria-label={t('player.close')} onclick={() => dialog?.close()}>
			<Icon name="cross" />
		</button>
	</header>
	{#if failed}
		<div class="failed">
			<p class="error" role="alert">{t(failed === 'busy' ? 'player.busy' : 'player.error')}</p>
			<button type="button" class="secondary" onclick={() => (failed = '')}>{t('player.retry')}</button>
		</div>
	{:else}
		<!-- svelte-ignore a11y_media_has_caption: no captions yet (notes.<lang>.vtt later) -->
		<video
			bind:this={video}
			bind:playbackRate={speed}
			bind:paused
			src={clipUrl(segment)}
			controls
			autoplay
			playsinline
			preload="auto"
			onloadeddata={(e) => measureFrame(e.currentTarget)}
			onerror={loadFailed}
		></video>
		<div class="tools">
			<button type="button" class="icon" title={t('player.back_frame')} aria-label={t('player.back_frame')} onclick={() => step(-1)}>
				<Icon name="frame-back" size={18} />
			</button>
			<button
				type="button"
				class="icon"
				title={t(paused ? 'player.play' : 'player.pause')}
				aria-label={t(paused ? 'player.play' : 'player.pause')}
				onclick={toggle}
			>
				<Icon name={paused ? 'play' : 'pause'} size={18} />
			</button>
			<button type="button" class="icon" title={t('player.forward_frame')} aria-label={t('player.forward_frame')} onclick={() => step(1)}>
				<Icon name="frame-forward" size={18} />
			</button>
			<div class="speeds" role="group" aria-label={t('player.speed')}>
				{#each SPEEDS as value (value)}
					<button type="button" class="speed" aria-pressed={speed === value} onclick={() => (speed = value)}>
						{speedLabel(value)}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(56rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 2rem);
		padding: var(--space-3);
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.failed {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
	}
	.duration {
		font-weight: normal;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	button.icon {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		padding: 0;
		color: var(--text);
		background: transparent;
		border: 1px solid var(--border);
	}
	/* Sized like the browser's own controls; one line, also on a phone. */
	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin-top: var(--space-2);
	}
	.tools button.icon {
		width: 2rem;
		height: 2rem;
	}
	.speeds {
		display: flex;
		margin-left: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	button.speed {
		height: 2rem;
		padding: 0 var(--space-2);
		font-size: var(--text-xs); /* four of them fit one line on a phone */
		font-variant-numeric: tabular-nums;
		color: var(--text);
		background: transparent;
		border: 0;
		border-radius: 0;
	}
	button.speed + button.speed {
		border-left: 1px solid var(--border);
	}
	button.speed[aria-pressed='true'] {
		color: var(--accent-text); /* as every button on the accent */
		background: var(--accent);
	}
	video {
		display: block;
		width: 100%;
		max-height: calc(100dvh - 10rem);
		background: var(--media-bg);
		border-radius: var(--radius-sm);
	}
</style>
