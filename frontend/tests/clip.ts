// The test clip served as nginx serves a segment clip: Range requests answered
// with 206, "Accept-Ranges: bytes" otherwise. Without them, Chrome cannot seek
// (setting currentTime snaps back to 0) and frame stepping cannot be tested.
import { readFileSync } from 'node:fs';
import type { Route } from '@playwright/test';

export const CLIP = readFileSync('tests/fixtures/clip.webm');

export function fulfillClip(route: Route) {
	const headers = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' };
	const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '');
	if (!range) return route.fulfill({ status: 200, headers, body: CLIP });
	const start = Number(range[1]);
	const end = range[2] ? Math.min(Number(range[2]), CLIP.length - 1) : CLIP.length - 1;
	return route.fulfill({
		status: 206,
		headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${CLIP.length}` },
		body: CLIP.subarray(start, end + 1)
	});
}
