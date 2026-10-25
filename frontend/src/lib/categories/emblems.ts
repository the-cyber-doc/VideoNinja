// Category emblems (Taijutsu, Muto Dori, Buki): emblems/<category ID>.svg (see $lib/cards/emblems.ts).
import { emblemLookup } from '../cards/emblems';

export const categoryEmblems = emblemLookup(
	import.meta.glob<string>('./emblems/*.svg', { eager: true, query: '?url', import: 'default' })
);
