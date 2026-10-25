// A small catalogue for the browser tests, shaped like the server's snapshot:
// school › category › (weapon, under Buki) › section › technique.
export const KOKU = 'gyokko.taijutsu.jo_ryaku.koku';
export const KETO = 'gyokko.taijutsu.jo_ryaku.keto';
export const STAFF = 'kukishinden.buki.rokushakubo.shoden.chudan_kangi';

export const CATALOG = {
	schools: [
		{ id: 'togakure', kanji: '戸隠流', romaji: 'Togakure Ryu' },
		{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu' },
		{ id: 'kukishinden', kanji: '九鬼神流', romaji: 'Kukishin Ryu' },
		{ id: 'koto', kanji: '虎倒流', romaji: 'Koto Ryu' },
		{ id: 'gyokushin', kanji: '玉心流', romaji: 'Gyokushin Ryu' }
	],
	categories: [
		{ id: 'taijutsu', kanji: '体術', romaji: 'Taijutsu', description: 'Unarmed techniques' },
		{ id: 'muto_dori', kanji: '無刀捕', romaji: 'Muto Dori' },
		{ id: 'buki', kanji: '武器', romaji: 'Buki', description: 'Weapons' }
	],
	weapons: [
		{ id: 'rokushakubo', kanji: '六尺棒', romaji: 'Rokushakubo' },
		{ id: 'hanbo', kanji: '半棒', romaji: 'Hanbo' }
	],
	sections: [
		{ id: 'togakure.taijutsu.kamae', kanji: '構', romaji: 'Kamae', ryu: 'togakure', category: 'taijutsu' },
		{ id: 'gyokko.taijutsu.jo_ryaku', kanji: '上略之巻', romaji: 'Jo Ryaku no Maki', ryu: 'gyokko', category: 'taijutsu' },
		{ id: 'gyokko.taijutsu.ge_ryaku', kanji: '下略之巻', romaji: 'Ge Ryaku no Maki', ryu: 'gyokko', category: 'taijutsu' },
		{ id: 'kukishinden.taijutsu.shoden', kanji: '初伝型', romaji: 'Shoden Gata', ryu: 'kukishinden', category: 'taijutsu' },
		{
			id: 'kukishinden.buki.rokushakubo.shoden',
			kanji: '初伝型',
			romaji: 'Shoden Gata',
			ryu: 'kukishinden',
			category: 'buki',
			weapon: 'rokushakubo'
		},
		{ id: 'kukishinden.buki.hanbo.okuden', kanji: '奥伝之型', romaji: 'Okuden no Kata', ryu: 'kukishinden', category: 'buki', weapon: 'hanbo' },
		{ id: 'koto.muto_dori.hekito', kanji: '劈刀型', romaji: 'Hekito Gata', ryu: 'koto', category: 'muto_dori' }
	],
	techniques: [
		{ id: KOKU, kanji: '虚空', romaji: 'Koku', section: 'gyokko.taijutsu.jo_ryaku', description: 'Empty space' },
		{ id: KETO, kanji: '闕倒', romaji: 'Keto', section: 'gyokko.taijutsu.jo_ryaku' },
		{ id: 'togakure.taijutsu.kamae.ichi', kanji: '一之構', romaji: 'Ichi no Kamae', section: 'togakure.taijutsu.kamae' },
		{ id: 'kukishinden.taijutsu.shoden.seion', kanji: '生音', romaji: 'Seion', section: 'kukishinden.taijutsu.shoden' },
		{ id: STAFF, kanji: '中段扞打', romaji: 'Chudan Kangi', section: 'kukishinden.buki.rokushakubo.shoden' },
		{ id: 'kukishinden.buki.hanbo.okuden.hane_otoshi', kanji: '跳落', romaji: 'Hane Otoshi', section: 'kukishinden.buki.hanbo.okuden' },
		{ id: 'koto.muto_dori.hekito.kibo', kanji: '跂望', romaji: 'Kibo', section: 'koto.muto_dori.hekito' }
	],
	segments: [
		{ id: 7, video: 1, technique: KOKU, begin_s: 12, end_s: 27, performer: 'p' },
		{ id: 8, video: 1, technique: KOKU, begin_s: 75, end_s: 90, performer: 'p' },
		{ id: 9, video: 1, technique: KETO, begin_s: 1, end_s: 5, performer: 'p' }
	]
};
