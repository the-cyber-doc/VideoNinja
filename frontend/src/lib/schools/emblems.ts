// Card backgrounds: emblems/<school ID>.svg, the generic one for a school without its own.
// Adding a school's emblem = adding its file, nothing else.
const files = import.meta.glob<string>('./emblems/*.svg', {
	eager: true,
	query: '?url',
	import: 'default'
});

const EMBLEMS = Object.fromEntries(
	Object.entries(files).map(([path, url]) => [path.slice('./emblems/'.length, -'.svg'.length), url])
);

export const GENERIC = 'generic';

export const hasEmblem = (id: string) => id !== GENERIC && Object.hasOwn(EMBLEMS, id);

export const emblemUrl = (id: string): string => EMBLEMS[hasEmblem(id) ? id : GENERIC];
