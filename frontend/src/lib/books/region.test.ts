// The region drawn before "Annotate": drawn, resized, moved, always inside its page.
import { describe, expect, it } from 'vitest';
import { between, isRegion, moved, pagePoint, placement, resized } from './region';

const PAGE = { width: 600, height: 800 };
const rect = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });

describe('pagePoint', () => {
	it('the page’s units at any zoom, inside the page', () => {
		const box = { left: 100, top: 50, width: 300, height: 400 }; // shown at half size
		expect(pagePoint({ x: 250, y: 250 }, box, PAGE)).toEqual({ x: 300, y: 400 });
		expect(pagePoint({ x: 0, y: 1000 }, box, PAGE)).toEqual({ x: 0, y: 800 });
	});
});

describe('between', () => {
	it('either corner first, cut at the page’s edges', () => {
		expect(between({ x: 50, y: 60 }, { x: 10, y: 20 }, PAGE)).toEqual(rect(10, 20, 40, 40));
		expect(between({ x: -5, y: 700 }, { x: 650, y: 900 }, PAGE)).toEqual(rect(0, 700, 600, 100));
	});
});

describe('isRegion', () => {
	it('a click is not one', () => {
		expect(isRegion(rect(0, 0, 4, 4))).toBe(true);
		expect(isRegion(rect(0, 0, 3, 100))).toBe(false);
		expect(isRegion(rect(0, 0, 100, 2))).toBe(false);
	});
});

describe('resized', () => {
	const r = rect(100, 100, 200, 100);
	it('a corner or an edge moves, the opposite side stays', () => {
		expect(resized(r, 'se', { x: 350, y: 250 }, PAGE)).toEqual(rect(100, 100, 250, 150));
		expect(resized(r, 'nw', { x: 50, y: 80 }, PAGE)).toEqual(rect(50, 80, 250, 120));
		expect(resized(r, 'n', { x: 999, y: 150 }, PAGE)).toEqual(rect(100, 150, 200, 50));
		expect(resized(r, 'e', { x: 120, y: 0 }, PAGE)).toEqual(rect(100, 100, 20, 100));
		expect(resized(r, 'sw', { x: 90, y: 210 }, PAGE)).toEqual(rect(90, 100, 210, 110));
		expect(resized(r, 'ne', { x: 310, y: 90 }, PAGE)).toEqual(rect(100, 90, 210, 110));
		expect(resized(r, 's', { x: 0, y: 120 }, PAGE)).toEqual(rect(100, 100, 200, 20));
		expect(resized(r, 'w', { x: 110, y: 0 }, PAGE)).toEqual(rect(110, 100, 190, 100));
	});
	it('past the opposite side: flipped', () => {
		expect(resized(r, 'w', { x: 400, y: 0 }, PAGE)).toEqual(rect(300, 100, 100, 100));
	});
});

describe('moved', () => {
	it('by the drag, stopped at the edges, its size kept', () => {
		const r = rect(100, 100, 200, 100);
		expect(moved(r, 10, -20, PAGE)).toEqual(rect(110, 80, 200, 100));
		expect(moved(r, -500, 900, PAGE)).toEqual(rect(0, 700, 200, 100));
		expect(moved(rect(0, 0, 700, 900), 10, 10, PAGE)).toEqual(rect(0, 0, 700, 900)); // bigger than the page
	});
});

describe('placement', () => {
	it('percentages of the page', () => {
		expect(placement(rect(60, 200, 300, 80), PAGE)).toEqual({ left: '10%', top: '25%', width: '50%', height: '10%' });
	});
});
