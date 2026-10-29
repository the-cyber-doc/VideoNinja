import { describe, expect, it } from 'vitest';
import { frameDuration, frameStep } from './frames';

const ms = (seconds: number) => Math.round(seconds * 1000);

describe('frameStep', () => {
	it('one frame forward or back, on the grid', () => {
		expect(ms(frameStep(1, 1, 0.04))).toBe(1040);
		expect(ms(frameStep(1, -1, 0.04))).toBe(960);
	});
	it('from a position off the grid: to the next frame, not one frame later', () => {
		// Shown: the frame of 0.32 s (0.32 to 0.36); paused at 0.337.
		expect(ms(frameStep(0.337, 1, 0.04))).toBe(360);
		expect(ms(frameStep(0.337, -1, 0.04))).toBe(280);
	});
	it('repeated steps move exactly one frame each', () => {
		let t = 0.337;
		const moves: number[] = [];
		for (const frames of [1, 1, -1, 1, -1, -1]) {
			const next = frameStep(t, frames, 0.04);
			moves.push(ms(next) - ms(t));
			t = next;
		}
		expect(moves.slice(1)).toEqual([40, -40, 40, -40, -40]);
	});
	it('rounding errors do not fall back to the previous frame', () => {
		expect(ms(frameStep(0.1 + 0.2, 1, 0.1))).toBe(401); // 0.30000000000000004 is the frame of 0.3
		expect(ms(frameStep(90 * (1 / 30), 1, 1 / 30))).toBe(3034); // frame 90 (3 s), not 89
		expect(ms(frameStep(2.9999999, 1, 1 / 30))).toBe(3000); // still in frame 89 (2.967 to 3 s)
	});
});

const samples = (pairs: [number, number][]) =>
	pairs.map(([mediaTime, presentedFrames]) => ({ mediaTime, presentedFrames }));

describe('frameDuration', () => {
	it('regular frames: their duration', () => {
		expect(
			ms(
				frameDuration(
					samples([
						[0.04, 2],
						[0.08, 3],
						[0.12, 4],
						[0.16, 5],
						[0.2, 6]
					])
				)!
			)
		).toBe(40);
	});
	it("WebKit's extra callback when the speed changes does not count (measured)", () => {
		const webkit = samples([
			[0, 1],
			[0.16, 5],
			[0.175645, 6],
			[0.2, 7],
			[0.24, 8],
			[0.28, 9],
			[0.32, 10],
			[0.36, 11],
			[0.4, 12]
		]);
		expect(ms(frameDuration(webkit)!)).toBe(40);
	});
	it('a skipped frame (two presented between callbacks) counts as two', () => {
		expect(
			ms(
				frameDuration(
					samples([
						[0, 1],
						[0.08, 3],
						[0.12, 4],
						[0.2, 6],
						[0.24, 7]
					])
				)!
			)
		).toBe(40);
	});
	it('nothing to tell: null', () => {
		expect(frameDuration(samples([[0.5, 3]]))).toBeNull();
		expect(
			frameDuration(
				samples([
					[0.5, 3],
					[0.5, 3]
				])
			)
		).toBeNull(); // same frame twice (paused)
	});
});
