// Level emblems: emblems/<level ID>.svg (see $lib/cards/emblems.ts).
import { emblemLookup } from '../cards/emblems';

export const levelEmblems = emblemLookup(
	import.meta.glob<string>('./emblems/*.svg', { eager: true, query: '?url', import: 'default' })
);
