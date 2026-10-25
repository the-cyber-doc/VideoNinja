// Weapon emblems: emblems/<weapon ID>.svg (see $lib/cards/emblems.ts).
import { emblemLookup } from '../cards/emblems';

export const weaponEmblems = emblemLookup(
	import.meta.glob<string>('./emblems/*.svg', { eager: true, query: '?url', import: 'default' })
);
