// Colours offered for a book's annotations (highlights and region outlines): data, the
// PDF's own (written into a downloaded copy), not the app's theme. Named for their buttons.
export const ANNOTATION_COLORS = [
	{ id: 'yellow', value: '#FFCD45' },
	{ id: 'green', value: '#4ADE80' },
	{ id: 'blue', value: '#60A5FA' },
	{ id: 'pink', value: '#F472B6' },
	{ id: 'red', value: '#E11D48' }
] as const;

/** A theme colour (CSS variable on :root) as the viewer's handles need it: a value, not var(). */
export function token(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
