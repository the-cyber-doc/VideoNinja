import { expect, test, type Cookie } from '@playwright/test';
import { admin, loggedIn } from '../accounts';
import { everyMatch, inLanguage } from '../search-page';

// The search on the real backend (project "options": after account.spec.ts, as its admin;
// on the real containers too), over the seeded catalogue in English and French: a word of
// one language found on a page in the other, Japanese, typos, several words; then the
// server's full text (FTS5) over comments: accents, Japanese, short words, a deleted comment.
// Every result page is compared with what ../search-reference.ts works out from the API's
// data: all the matches, nothing else.
test.describe.configure({ mode: 'serial' });

const KOKU = 'schools/gyokko/taijutsu/jo_ryaku/koku';
const STAFF_KOKU = 'schools/kukishinden/buki/rokushakubo/waza/koku';
const KETO = 'gyokko.taijutsu.jo_ryaku.keto';
const KETO_PAGE = '/schools/gyokko/taijutsu/jo_ryaku/keto';

let adminCookies: Cookie[] = [];

test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, admin());
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

test('a French word on an English page: every match, shown in English', async ({ page }) => {
	await inLanguage(page, 'en');
	const want = await everyMatch(page, 'vide'); // "Espace vide", "Forme du vide"… only in French
	expect(want.catalog).toEqual(expect.arrayContaining([`/${KOKU}`, `/${STAFF_KOKU}`]));
	expect(want.catalog.length).toBeGreaterThanOrEqual(5);
	const koku = page.locator('li', { has: page.locator(`a[href$="/${KOKU}"]`) });
	await expect(koku).toContainText('Technique · Gyokko Ryu › Jo Ryaku no Maki'); // English labels
	await expect(page.getByRole('heading', { name: /^Catalogue/ })).toBeVisible();

	// A French word that starts others ("extérieure"), techniques and a section among them.
	const outer = await everyMatch(page, 'extérieur');
	expect(outer.catalog).toEqual(
		expect.arrayContaining([
			'/schools/gyokko/taijutsu/torite_kihon/omote_gyaku',
			'/schools/kukishinden/buki/hanbo/chuden/soto_waza',
			'/schools/takagi/taijutsu/shoden_omote'
		])
	);
});

test('an English word on a French page: every match, shown in French', async ({ page }) => {
	await inLanguage(page, 'fr');
	const want = await everyMatch(page, 'empty');
	expect(want.catalog).toEqual(expect.arrayContaining([`/${KOKU}`, `/${STAFF_KOKU}`]));
	await expect(page.locator('li', { has: page.locator(`a[href$="/${KOKU}"]`) })).toContainText(
		'Technique · Gyokko Ryu › Jo Ryaku no Maki'
	);
	await expect(page.getByRole('heading', { name: 'Recherche', level: 1 })).toBeVisible();
	await everyMatch(page, 'outside reversal'); // several words: every one of them
});

test('Japanese: by word and by character; typos in longer words; several words', async ({ page }) => {
	const kanji = await everyMatch(page, '虚空');
	expect(kanji.catalog).toEqual(expect.arrayContaining([`/${KOKU}`, `/${STAFF_KOKU}`]));
	expect((await everyMatch(page, '空')).catalog.length).toBeGreaterThan(kanji.catalog.length);
	const typo = await everyMatch(page, 'ichimoji'); // Ichimonji: one letter missing
	expect(typo.catalog.length).toBeGreaterThan(0);
	const keto = (await everyMatch(page, 'keto')).catalog; // short: no typo allowed, so never Koto Ryu itself
	expect(keto.length).toBeGreaterThan(1);
	expect(keto.every((path) => path.endsWith('/keto'))).toBe(true);
	await everyMatch(page, 'omote gyaku');
	await everyMatch(page, 'nothing-like-this');
});

test('the drop-down: the first matches of each group, then every result', async ({ page }) => {
	await page.goto('schools');
	const box = page.getByRole('combobox', { name: 'Search' });
	await box.fill('gyaku'); // dozens of techniques
	const catalog = page.getByRole('group', { name: 'Catalogue' }).getByRole('option');
	await expect(catalog).toHaveCount(5);
	await box.press('Enter');
	await expect(page).toHaveURL(/search\?q=gyaku$/);
	expect((await everyMatch(page, 'gyaku')).catalog.length).toBeGreaterThan(5);
});

test('the server’s full text: comments with accents, Japanese, short words; gone with the comment', async ({
	page
}) => {
	const post = async (text: string, lang: string) => {
		const r = await page.request.post(`api/techniques/${KETO}/comments`, { data: { text, lang } });
		expect(r.status()).toBe(201);
		return (await r.json()).id as number;
	};
	const french = await post('Très bien placé, le déplacement', 'fr');
	const japanese = await post('虚空の構えから', 'en');
	const ids = async (q: string) =>
		(await (await page.request.get(`api/search?q=${encodeURIComponent(q)}`)).json()).comments.map(
			(c: { id: number }) => c.id
		);
	expect(await ids('PLACE')).toEqual([french]); // accents and case ignored; any part of a word ("déplacement")
	expect(await ids('tres bien')).toEqual([french]); // every word
	expect(await ids('tres nowhere')).toEqual([]);
	expect(await ids('虚空の')).toEqual([japanese]); // 3 characters: the index
	expect(await ids('の構')).toEqual([japanese]); // fewer: looked up without it
	expect(await ids('le')).toEqual([french]);

	// On the results page: in Comments, the technique's page, the match marked.
	const want = await everyMatch(page, 'placé');
	expect(want.comments).toEqual([KETO_PAGE]);
	await expect(page.locator('section[aria-labelledby="results-comments"] mark')).toHaveText(['placé', 'place']); // "dé·place·ment" too
	// Japanese everywhere at once: the catalogue's Koku and the comment.
	const both = await everyMatch(page, '虚空');
	expect(both.comments).toEqual([KETO_PAGE]);

	for (const id of [french, japanese]) expect((await page.request.delete(`api/comments/${id}`)).status()).toBe(204);
	expect(await ids('placé')).toEqual([]);
	expect(await ids('虚空の')).toEqual([]);
});
