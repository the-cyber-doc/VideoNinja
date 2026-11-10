// A finger over a page of the viewer (Select mode): a swipe scrolls (the browser's own),
// a finger held still a moment first selects text (EmbedPDF's selection, as a mouse drag).
// Decided at its first real move. Pure: ViewerPages wires it to the pointer and touch events.

/** Held this long without moving: a selection, not a scroll. */
export const LONG_PRESS_MS = 400;
/** A finger's own jitter (CSS pixels): not a move yet. */
export const SLOP_PX = 8;

export type Intent = 'undecided' | 'select' | 'scroll';

/** What a touch is, `elapsed` ms after it began, `dx`/`dy` from where it began. */
export function intentOf(elapsed: number, dx: number, dy: number): Intent {
	if (Math.hypot(dx, dy) < SLOP_PX) return 'undecided';
	return elapsed >= LONG_PRESS_MS ? 'select' : 'scroll';
}
