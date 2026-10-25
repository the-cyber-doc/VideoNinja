import { describe, expect, it } from 'vitest';
import {
	catalogCrumbs,
	catalogHref,
	categoriesOf,
	pathOf,
	resolvePath,
	sectionsOf,
	techniquesOf,
	weaponsOf,
	type Catalog
} from './catalog.svelte';

const named = (id: string, romaji = id) => ({ id, kanji: '字', romaji });
const catalog: Catalog = {
	schools: [named('gyokko', 'Gyokko Ryu'), named('kukishinden', 'Kukishin Ryu'), named('gyokushin')],
	categories: [named('taijutsu', 'Taijutsu'), named('muto_dori'), named('buki', 'Buki')],
	weapons: [named('rokushakubo', 'Rokushakubo'), named('hanbo')],
	sections: [
		{ ...named('gyokko.taijutsu.jo_ryaku', 'Jo Ryaku no Maki'), ryu: 'gyokko', category: 'taijutsu' },
		{ ...named('kukishinden.taijutsu.shoden'), ryu: 'kukishinden', category: 'taijutsu' },
		{ ...named('kukishinden.buki.rokushakubo.shoden', 'Shoden Gata'), ryu: 'kukishinden', category: 'buki', weapon: 'rokushakubo' }
	],
	techniques: [
		{ ...named('gyokko.taijutsu.jo_ryaku.koku', 'Koku'), section: 'gyokko.taijutsu.jo_ryaku' },
		{ ...named('kukishinden.buki.rokushakubo.shoden.chudan_kangi', 'Chudan Kangi'), section: 'kukishinden.buki.rokushakubo.shoden' }
	],
	segments: []
};
const staff = { ryu: 'kukishinden', category: 'buki', weapon: 'rokushakubo', section: 'shoden', technique: 'chudan_kangi' };

describe('catalogue paths', () => {
	it('lists only what a school has, in the catalogue order', () => {
		expect(categoriesOf(catalog, 'kukishinden').map((c) => c.id)).toEqual(['taijutsu', 'buki']);
		expect(categoriesOf(catalog, 'gyokushin')).toEqual([]);
		expect(weaponsOf(catalog, 'kukishinden').map((w) => w.id)).toEqual(['rokushakubo']);
		expect(sectionsOf(catalog, 'kukishinden', 'buki', 'rokushakubo').map((s) => s.id)).toEqual([
			'kukishinden.buki.rokushakubo.shoden'
		]);
		expect(sectionsOf(catalog, 'kukishinden', 'buki', 'hanbo')).toEqual([]);
		expect(techniquesOf(catalog, 'gyokko.taijutsu.jo_ryaku').map((t) => t.romaji)).toEqual(['Koku']);
	});

	it('resolves a path step by step; a wrong step is not found', () => {
		expect(resolvePath(catalog, staff)).toMatchObject({ found: true, technique: { romaji: 'Chudan Kangi' } });
		expect(resolvePath(catalog, { ...staff, weapon: 'hanbo' }).found).toBe(false);
		expect(resolvePath(catalog, { ryu: 'gyokko', category: 'buki' }).found).toBe(false); // Gyokko has no weapons
		expect(resolvePath(catalog, { ryu: 'gyokko', category: 'shoden' }).found).toBe(false); // an old level URL
	});

	it('URLs: the weapon only under Buki', () => {
		expect(catalogHref(staff)).toBe('/schools/kukishinden/buki/rokushakubo/shoden/chudan_kangi');
		expect(catalogHref({ ryu: 'gyokko', category: 'taijutsu', section: 'jo_ryaku', technique: 'koku' })).toBe(
			'/schools/gyokko/taijutsu/jo_ryaku/koku'
		);
		expect(catalogHref({ ryu: 'kukishinden', category: 'buki' })).toBe('/schools/kukishinden/buki');
	});

	it('the path of a technique (the annotation form)', () => {
		expect(pathOf(catalog, 'kukishinden.buki.rokushakubo.shoden.chudan_kangi')).toEqual(staff);
		expect(pathOf(catalog, 'gyokko.koku')).toBeUndefined(); // an ID of the old catalogue
	});

	it('breadcrumbs as far as the path exists', () => {
		expect(catalogCrumbs(catalog, staff).map((c) => c.label)).toEqual([
			'Schools',
			'Kukishin Ryu',
			'Buki',
			'Rokushakubo',
			'Shoden Gata',
			'Chudan Kangi'
		]);
		expect(catalogCrumbs(catalog, { ryu: 'gyokko', category: 'taijutsu', section: 'nope' }).map((c) => c.href)).toEqual([
			'/schools',
			'/schools/gyokko',
			'/schools/gyokko/taijutsu'
		]);
	});
});
