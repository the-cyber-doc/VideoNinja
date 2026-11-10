// A region being drawn on a page before it becomes an annotation ("Create region", then
// "Annotate"): drawn by a drag, then resized by its handles or moved, always inside its page.
// In the page's own units (PDF points, origin top left, as EmbedPDF's rects), so the zoom
// never changes it. Pure: ViewerPages wires it to the pointer.
import type { Rect } from './annotations.svelte';

export interface Point {
	x: number;
	y: number;
}
export interface Size {
	width: number;
	height: number;
}
/** The draft: a rect on one page. */
export interface Draft {
	pageIndex: number;
	rect: Rect;
}

/** The handles: corners and edges, by compass point. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

/** Smaller (points, either side) is a click, not a region. */
export const MIN_SIZE = 4;

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

/** A point of the page from the pointer's position over its element (any zoom). */
export function pagePoint(client: Point, box: { left: number; top: number } & Size, page: Size): Point {
	return {
		x: clamp(((client.x - box.left) / box.width) * page.width, page.width),
		y: clamp(((client.y - box.top) / box.height) * page.height, page.height)
	};
}

/** The rect between two corners (either order), inside the page. */
export function between(a: Point, b: Point, page: Size): Rect {
	const x1 = clamp(Math.min(a.x, b.x), page.width);
	const y1 = clamp(Math.min(a.y, b.y), page.height);
	const x2 = clamp(Math.max(a.x, b.x), page.width);
	const y2 = clamp(Math.max(a.y, b.y), page.height);
	return { origin: { x: x1, y: y1 }, size: { width: x2 - x1, height: y2 - y1 } };
}

/** Big enough to be a region (else a click). */
export const isRegion = (rect: Rect) => rect.size.width >= MIN_SIZE && rect.size.height >= MIN_SIZE;

/** The rect with one handle dragged to `p` (its opposite side stays; past it, the rect flips). */
export function resized(rect: Rect, handle: Handle, p: Point, page: Size): Rect {
	let x1 = rect.origin.x;
	let y1 = rect.origin.y;
	let x2 = x1 + rect.size.width;
	let y2 = y1 + rect.size.height;
	if (handle.includes('w')) x1 = p.x;
	if (handle.includes('e')) x2 = p.x;
	if (handle.includes('n')) y1 = p.y;
	if (handle.includes('s')) y2 = p.y;
	return between({ x: x1, y: y1 }, { x: x2, y: y2 }, page);
}

/** The rect moved by (dx, dy), stopped at the page's edges (its size kept). */
export function moved(rect: Rect, dx: number, dy: number, page: Size): Rect {
	const { width, height } = rect.size;
	return {
		origin: {
			x: clamp(rect.origin.x + dx, Math.max(0, page.width - width)),
			y: clamp(rect.origin.y + dy, Math.max(0, page.height - height))
		},
		size: { width, height }
	};
}

/** Where to draw it over its page: percentages of the page (CSS). */
export function placement(rect: Rect, page: Size) {
	const pct = (v: number, of: number) => `${(v / of) * 100}%`;
	return {
		left: pct(rect.origin.x, page.width),
		top: pct(rect.origin.y, page.height),
		width: pct(rect.size.width, page.width),
		height: pct(rect.size.height, page.height)
	};
}
