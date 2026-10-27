/** Where a frame step goes: `frames` frames from the one shown at `time` (`frame`:
 * seconds per frame), on the frame grid and a hundredth of a frame inside it.
 * Not `time + frames * frame`: a position slightly off the grid (WebKit refines it
 * a moment after a pause) or a rounding error would then land on a neighbour. */
export function frameStep(time: number, frames: number, frame: number): number {
	const shown = Math.floor(time / frame + 1e-6);
	return (shown + frames) * frame + frame / 100;
}

/** What a frame callback (requestVideoFrameCallback) reports. */
export interface FrameSample {
	mediaTime: number;
	presentedFrames: number;
}

/** Frames sampled before deciding: one or two odd callbacks are outvoted. */
export const FRAME_SAMPLES = 9;

/** Seconds per frame from consecutive frame callbacks, or null if they don't tell:
 * the median of the gaps per frame shown. Not the smallest gap: WebKit adds a
 * callback at the current position when the speed changes (0.1756 s between the
 * frames of 0.16 and 0.2 s), and a skipped frame makes one gap two frames long. */
export function frameDuration(samples: FrameSample[]): number | null {
	const gaps: number[] = [];
	for (let i = 1; i < samples.length; i++) {
		const frames = samples[i].presentedFrames - samples[i - 1].presentedFrames || 1;
		const time = samples[i].mediaTime - samples[i - 1].mediaTime;
		if (frames > 0 && time > 0.001) gaps.push(time / frames);
	}
	if (!gaps.length) return null;
	gaps.sort((a, b) => a - b);
	return gaps[Math.floor(gaps.length / 2)];
}
