// The search's results page in the e2e tests (tests/e2e/search.spec.ts, tests/stack/search.spec.ts):
// what it shows, compared with every match ./search-reference.ts works out from the API's
// data (the browser's index) and with the server's own full-text answer.
import { expect, test, type Page } from '@playwright/test';
import { expected, type Book, type Catalog, type Group, type Video } from './search-reference';

const ALL: (Group | 'texts' | 'comments')[] = ['catalog', 'segments', 'videos', 'books', 'texts', 'comments'];

/** The app's base path ("" at the root, "/videoninja" on the stack). */
const basePath = () => new URL(test.info().project.use.baseURL!).pathname.replace(/\/$/, '');

/** Shown in this language (the saved choice, as the language menu keeps it). */
export async function inLanguage(page: Page, lang: 'en' | 'fr') {
	await page.addInitScript((l) => localStorage.setItem('lang', l), lang);
}

/** The /search page's results: each group's links, without the base path, sorted. */
export async function shown(page: Page, query: string): Promise<Record<string, string[]>> {
	await page.goto(`search?q=${encodeURIComponent(query)}`);
	await expect(page.getByRole('status')).toBeVisible({ timeout: 15_000 }); // the count, or nothing found
	await expect(page.getByText(/^(Searching the books|Recherche dans le contenu)/)).toHaveCount(0); // the server's too
	const base = basePath();
	const groups = await page.locator('section[aria-labelledby^="results-"]').evaluateAll((sections) =>
		sections.map((s) => ({
			group: s.getAttribute('aria-labelledby')!.replace('results-', ''),
			links: [...s.querySelectorAll('li a')].map((a) => a.getAttribute('href')!)
		}))
	);
	return Object.fromEntries(
		groups.map((g) => [g.group, g.links.map((l) => (l.startsWith(base) ? l.slice(base.length) : l)).sort()])
	);
}

/** What the server's full text answers, as the results page links it. */
export async function serverHits(page: Page, query: string, catalog: Catalog) {
	const hits = await (await page.request.get(`api/search?q=${encodeURIComponent(query)}`)).json();
	const technique = (id: string) => {
		const t = catalog.techniques.find((x) => x.id === id)!;
		const s = catalog.sections.find((x) => x.id === t.section)!;
		const at = (x: string) => x.slice(x.lastIndexOf('.') + 1);
		return `/schools/${s.ryu}/${s.category}${s.weapon ? `/${s.weapon}` : ''}/${at(s.id)}/${at(t.id)}`;
	};
	return {
		hits,
		texts: [
			...hits.pages.map((p: { book: number; page: number }) => `/books/${p.book}?page=${p.page}`),
			...hits.annotations.map((a: { id: number; book: number | null; technique: string }) =>
				a.book === null ? technique(a.technique) : `/books/${a.book}?annotation=${a.id}`
			)
		].sort(),
		comments: [
			...hits.comments.map((c: { technique: string }) => technique(c.technique)),
			...hits.book_comments.map(
				(c: { book: number; annotation: number }) => `/books/${c.book}?annotation=${c.annotation}`
			)
		].sort()
	};
}

/** Every match of `query`, and only those, on the results page; what was expected (to check it is not empty). */
export async function everyMatch(page: Page, query: string) {
	const get = async (path: string, lang = 'en') =>
		(await page.request.get(path, { headers: { 'Accept-Language': lang } })).json();
	const catalogs: Catalog[] = [await get('api/catalog', 'en'), await get('api/catalog', 'fr')];
	const videos: Video[] = await get('api/videos');
	const books: Book[] = await get('api/books');
	const want = { ...expected(catalogs, videos, books, query), ...(await serverHits(page, query, catalogs[0]!)) };
	const got = await shown(page, query);
	for (const group of ALL) expect(got[group] ?? [], `${query}: ${group}`).toEqual(want[group]);
	const total = ALL.reduce((n, g) => n + (want[g] as string[]).length, 0);
	if (total) await expect(page.getByRole('status')).toHaveText(new RegExp(`^${total} (result|résultat)\\(s\\)$`));
	return want;
}
