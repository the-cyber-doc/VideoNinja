// Section emblems, by section name (the last part of its ID, e.g. jo_ryaku):
// emblems/<name>.svg, or the emblem of the kind of section it is (KIND), e.g. every
// school's Shoden sections share shoden.svg. See $lib/cards/emblems.ts.
import { emblemLookup, type Emblems } from '../cards/emblems';

const files = emblemLookup(
	import.meta.glob<string>('./emblems/*.svg', { eager: true, query: '?url', import: 'default' })
);

/** Section name → emblem, when it has no file of its own. */
const KIND: Record<string, string> = {
	santo_tonko: 'tonko',
	torite_kihon: 'torite',
	shirabe_moguri: 'moguri',
	keiko_sabaki: 'sabaki',
	kaisetsu: 'shoden',
	gokui: 'okuden',
	hencho: 'kaiden',
	roppo: 'kata',
	kurai_dori: 'kamae',
	hekito: 'muto_dori',
	daken_ten: 'ten',
	daken_chi: 'chi',
	daken_shizen: 'shizen',
	jutai_kamae: 'kamae',
	jutai_shoden: 'shoden',
	jutai_chuden: 'chuden',
	jutai_okuden: 'okuden',
	shoden_omote: 'shoden',
	shoden_ura: 'shoden',
	chuden_sabaki: 'sabaki',
	chuden_tai: 'chuden',
	okuden_shirabe: 'okuden',
	okuden_moguri: 'moguri',
	daisho_sabaki: 'daisho'
};

const emblemOf = (name: string) => (files.has(name) ? name : (KIND[name] ?? name));

export const sectionEmblems: Emblems = {
	has: (name) => files.has(emblemOf(name)),
	url: (name) => files.url(emblemOf(name))
};
