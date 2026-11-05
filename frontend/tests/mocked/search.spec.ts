import { expect, test, type Page } from '@playwright/test';
// The API is faked: the search box on the catalogue, Videos and Books pages; a French word
// found while the page is in English; the drop-down's keys; every result on /search.
import type { SearchHits } from '../../src/lib/api/types';
import { CATALOG, KOKU } from '../catalog';

const TAGS = (fr: boolean) => [
	{ id: 'location', name: fr ? 'Lieu' : 'Location', values: [{ id: 'outdoor', name: fr ? 'Extérieur' : 'Outdoor' }] }
];
const catalogIn = (fr: boolean) => ({
	...CATALOG,
	techniques: CATALOG.techniques.map((t) =>
		t.id === KOKU ? { ...t, description: fr ? 'Espace vide' : 'Empty space' } : t
	),
	segments: CATALOG.segments.map((s) => (s.id === 7 ? { ...s, tags: [{ id: 'location', value: 'outdoor' }] } : s)),
	performers: [{ id: 'p', name: 'Hatsumi' }],
	tags: TAGS(fr)
});
const VIDEO = {
	id: 4,
	original_filename: 'koku-outdoor.mp4',
	uploaded_at: '2026-10-23T12:13:38+02:00',
	duration_s: 95,
	all_segments_done: true,
	segment_count: 1,
	uploaded_by: 'Hana',
	tags: [{ id: 'location', value: 'outdoor' }]
};
const BOOK = {
	id: 3,
	original_filename: 'ninjutsu.pdf',
	status: 'published',
	error: null,
	pages: 12,
	reference: { type: 'book', title: 'Ninjutsu History', author: [{ family: 'Hatsumi', given: 'Masaaki' }] },
	uploaded_at: '2026-10-23T12:13:38+02:00',
	uploaded_by: 'Aiko',
	has_thumbnail: false,
	tags: []
};

const NO_HITS: SearchHits = { pages: [], annotations: [], comments: [], book_comments: [] };

async function loggedIn(page: Page, access: string[] = [], remote: (q: string) => SearchHits = () => NO_HITS) {
	const requests: string[] = [];
	await page.route('/api/search?*', (r) => {
		const q = new URL(r.request().url()).searchParams.get('q')!;
		requests.push(`search ${q}`);
		return r.fulfill({ json: remote(q) });
	});
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({ json: { username: 'kenji', name: null, role: 'user', role_name: 'User', access } })
	);
	await page.route('/api/catalog', (r) => {
		const lang = r.request().headers()['accept-language'];
		requests.push(`catalog ${lang}`);
		return r.fulfill({ json: catalogIn(lang === 'fr') });
	});
	await page.route('/api/videos', (r) => {
		requests.push('videos');
		return r.fulfill({ json: [VIDEO] });
	});
	await page.route('/api/books', (r) => {
		requests.push('books');
		return r.fulfill({ json: [BOOK] });
	});
	await page.route('/api/tags', (r) => r.fulfill({ json: [] }));
	await page.route('/api/techniques/*/comments', (r) => r.fulfill({ json: [] }));
	await page.route('/api/techniques/*/book-notes', (r) => r.fulfill({ json: [] }));
	await page.route('/media/**', (r) => r.fulfill({ status: 404 }));
	return requests;
}

const box = (page: Page) => page.getByRole('combobox', { name: 'Search' });
const options = (page: Page) => page.getByRole('listbox', { name: 'Search' }).getByRole('option');

test('a French word on an English page: found in the translation, shown in English', async ({ page }) => {
	const requests = await loggedIn(page);
	await page.goto('/schools');
	await box(page).fill('espace vide');
	await expect(options(page)).toHaveText([
		/^Koku.*Technique · Gyokko Ryu › Jo Ryaku no Maki/,
		/^Koku.*0:12–0:27 · Hatsumi/,
		/^Koku.*1:15–1:30 · Hatsumi/, // both its segments
		'See all results'
	]);
	expect(requests.filter((r) => !r.startsWith('search')).sort()).toEqual(['catalog en', 'catalog fr']); // no videos nor books
	await expect.poll(() => requests.filter((r) => r.startsWith('search'))).toEqual(['search espace vide']); // once typed
	// A tag's value by its French name; a performer.
	await box(page).fill('extérieur');
	await expect(options(page)).toHaveText([/^Koku.*0:12–0:27/, 'See all results']);
	await box(page).fill('hatsumi');
	await expect(page.getByRole('group', { name: 'Segments' }).getByRole('option')).toHaveCount(3);
	await box(page).fill('zzzz');
	await expect(page.getByRole('status')).toHaveText('Nothing found');
});

test('keys: arrows choose, Enter opens; Escape closes, then clears', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/gyokko');
	await box(page).fill('koku');
	await box(page).press('ArrowDown');
	await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
	await expect(box(page)).toHaveAttribute('aria-activedescendant', /.+/);
	await box(page).press('ArrowUp'); // round: the last one
	await expect(options(page).last()).toHaveAttribute('aria-selected', 'true');
	await box(page).press('ArrowDown');
	await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
	await box(page).press('Enter');
	await expect(page).toHaveURL(`/schools/gyokko/taijutsu/jo_ryaku/koku`);
	await expect(page.getByRole('listbox')).toHaveCount(0); // closed after the navigation

	await box(page).fill('koku');
	await expect(box(page)).toHaveAttribute('aria-expanded', 'true');
	await box(page).press('Escape');
	await expect(box(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(box(page)).toHaveValue('koku');
	await box(page).press('Escape');
	await expect(box(page)).toHaveValue('');
});

test('Videos and Books pages: the box left of the filter button; videos and books found', async ({ page }) => {
	await loggedIn(page, ['video_mgmt', 'book_mgmt']);
	for (const path of ['/videos', '/books']) {
		await page.goto(path);
		const [search, filter] = await Promise.all([
			box(page).boundingBox(),
			page.getByRole('button', { name: 'Filter and sort' }).boundingBox()
		]);
		expect(search!.x + search!.width).toBeLessThanOrEqual(filter!.x);
		expect(Math.abs(search!.y + search!.height / 2 - (filter!.y + filter!.height / 2))).toBeLessThan(4);
	}
	await box(page).fill('outdoor');
	await expect(page.getByRole('group', { name: 'Videos' }).getByRole('option')).toHaveText([
		/koku-outdoor\.mp4.*Hana · 1:35/
	]);
	await box(page).fill('masaaki');
	await expect(page.getByRole('group', { name: 'Books' }).getByRole('option')).toHaveText([
		/Ninjutsu History.*Masaaki Hatsumi/
	]);
	await options(page).filter({ hasText: 'Ninjutsu History' }).click();
	await expect(page).toHaveURL('/books/3');
});

test('Enter with nothing chosen: every result, grouped, on /search; the query edited there', async ({ page }) => {
	await loggedIn(page, ['video_mgmt']);
	await page.goto('/schools');
	await box(page).fill('koku');
	await box(page).press('Enter');
	await expect(page).toHaveURL('/search?q=koku');
	await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText('4 result(s)'); // Koku, its 2 segments, the video
	await expect(page.getByRole('region', { name: /Segments/ }).getByRole('listitem')).toHaveCount(2);
	await expect(page.getByRole('region', { name: /Videos/ }).getByRole('link')).toHaveAttribute('href', '/videos/4');
	await page.getByRole('searchbox', { name: 'Search' }).fill('keto');
	await expect(page).toHaveURL('/search?q=keto');
	await expect(page.getByRole('status')).toHaveText('2 result(s)'); // Keto and its segment (never Koto)
	await page.getByRole('searchbox', { name: 'Search' }).fill('');
	await expect(page.getByText('Techniques, segments, videos, books, their contents')).toBeVisible();
});

test('in French: the page’s language for the results', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedIn(page);
	await page.goto('/schools');
	await page.getByRole('combobox', { name: 'Rechercher' }).fill('empty');
	await expect(page.getByRole('option').first()).toContainText('Technique · Gyokko Ryu');
	await expect(page.getByRole('option').last()).toHaveText('Voir tous les résultats');
});

test('phones: the box under the title, beside the buttons', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 700 });
	await loggedIn(page, ['video_mgmt']);
	await page.goto('/videos');
	const [title, search] = await Promise.all([
		page.getByRole('heading', { name: 'Videos', level: 1 }).boundingBox(),
		box(page).boundingBox()
	]);
	expect(search!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(375); // no horizontal scroll
});

test('the server’s full text: book pages and comments, their matches marked, each opening its place', async ({
	page
}) => {
	await loggedIn(page, ['book_mgmt'], (q) =>
		q === 'ichimonji'
			? {
					pages: [{ book: 3, page: 7, snippet: 'Le \u0002Ichimonji\u0003 no kamae' }],
					annotations: [{ id: 5, book: 3, page: 2, technique: KOKU, snippet: '\u0002ichimonji\u0003 here' }],
					comments: [{ id: 9, technique: KOKU, user: null, snippet: 'As \u0002Ichimonji\u0003' }],
					book_comments: []
				}
			: NO_HITS
	);
	await page.goto('/books');
	await box(page).fill('ichimonji');
	const texts = page.getByRole('group', { name: 'In the books' }).getByRole('option');
	await expect(texts).toHaveText([
		/Ninjutsu History.*Page 7.*Le Ichimonji no kamae/,
		/Ninjutsu History.*Page 2 · Koku/
	]);
	await expect(texts.first().locator('mark')).toHaveText('Ichimonji');
	await expect(page.getByRole('group', { name: 'Comments' }).getByRole('option')).toHaveText([
		/Koku.*a deleted user.*As Ichimonji/
	]);
	await page.route('/api/books/3', (r) => r.fulfill({ status: 404, json: { code: 'book.unknown', params: {} } }));
	await texts.first().click();
	await expect(page).toHaveURL('/books/3?page=7');
});

test('offline: the full text not searched, said; the browser’s results still shown', async ({ page }) => {
	await loggedIn(page);
	await page.route('/api/search?*', (r) => r.abort());
	await page.goto('/schools');
	await box(page).fill('koku');
	await expect(page.getByText('Book contents and comments could not be searched')).toBeVisible();
	await expect(options(page).first()).toContainText('Koku');
});
