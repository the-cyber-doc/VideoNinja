// What the editor reads from the local video with hidden video elements of its own:
// the length of a frame, and the film strip's pictures. The visible video (and its
// seek marker) is never disturbed.
import { FRAME_SAMPLES, frameDuration, type FrameSample } from '../frames';

export const STRIP_IMAGES = 24;
const STRIP_HEIGHT = 54;

/** Seconds per frame, from consecutive frames played for a moment by a hidden, muted
 * video; `fallback` if the browser cannot tell. In the page, invisible: WebKit only
 * reports the frames of a video it renders. */
export async function measureFrame(url: string, fallback: number): Promise<number> {
	const v = document.createElement('video');
	if (!('requestVideoFrameCallback' in v)) return fallback;
	v.muted = true;
	v.playsInline = true;
	v.preload = 'auto';
	v.setAttribute('aria-hidden', 'true');
	v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
	document.body.append(v);
	v.src = url;
	const samples: FrameSample[] = [];
	const measured = await new Promise<number>((resolve) => {
		const timer = setTimeout(() => resolve(fallback), 2000);
		const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
			samples.push(meta);
			if (samples.length < FRAME_SAMPLES) return v.requestVideoFrameCallback(onFrame);
			clearTimeout(timer);
			resolve(frameDuration(samples) ?? fallback);
		};
		v.requestVideoFrameCallback(onFrame);
		v.play().catch(() => resolve(fallback));
	});
	v.pause();
	v.removeAttribute('src');
	v.load();
	v.remove();
	return measured;
}

/** The film strip: STRIP_IMAGES frames across `total` seconds, grabbed by a hidden
 * video. `onImages` gets the pictures so far after each one; it stops when `wanted()`
 * turns false (another file opened) or at an error (e.g. the server's limit of
 * parallel requests for one video: 429). */
export async function makeStrip(url: string, total: number, onImages: (images: string[]) => void, wanted: () => boolean) {
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
	canvas.height = STRIP_HEIGHT;
	canvas.width = Math.max(1, Math.round((STRIP_HEIGHT * probe.videoWidth) / (probe.videoHeight || 1)));
	const images: string[] = [];
	for (let i = 0; i < STRIP_IMAGES && wanted(); i++) {
		probe.currentTime = ((i + 0.5) * total) / STRIP_IMAGES;
		if (!(await next('seeked'))) break;
		canvas.getContext('2d')!.drawImage(probe, 0, 0, canvas.width, canvas.height);
		images.push(canvas.toDataURL('image/jpeg', 0.6));
		onImages([...images]);
	}
	probe.removeAttribute('src');
	probe.load();
}
