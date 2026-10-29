// Card backgrounds: one folder of SVG emblems per kind of card (schools/emblems/,
// levels/emblems/), each file named after the ID it illustrates, plus generic.svg
// for an ID without its own (e.g. a school added later). Adding an emblem = adding
// its file. Each folder calls import.meta.glob itself (it needs a literal path).

export const GENERIC = 'generic';

export interface Emblems {
	/** True if the ID has its own emblem (not the generic one). */
	has(id: string): boolean;
	/** URL of the ID's emblem, else of the generic one. */
	url(id: string): string;
}

/** `files`: import.meta.glob('./emblems/*.svg', { eager: true, query: '?url', import: 'default' }). */
export function emblemLookup(files: Record<string, string>): Emblems {
	const urls = Object.fromEntries(
		Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), url])
	);
	const has = (id: string) => id !== GENERIC && Object.hasOwn(urls, id);
	return { has, url: (id) => urls[has(id) ? id : GENERIC] };
}
