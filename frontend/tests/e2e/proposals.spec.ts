import { expect, test, type Cookie, type Locator, type Page } from '@playwright/test';
import { admin, loggedIn } from '../accounts';

// Catalogue entries proposed with "Other" (the technique picker), resolved on the Options page,
// on the real backend (project "options", after account.spec.ts). Serial: the tests build on
// each other. Every name has "Wombat" in it, a word no other spec searches for (the search
// specs compare whole result lists).
test.describe.configure({ mode: 'serial' });

let adminCookies: Cookie[] = [];
test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, admin());
	adminCookies = await context.cookies();
	await context.close();
});
test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

const JO_RYAKU = 'gyokko.taijutsu.jo_ryaku';
const KOKU = `${JO_RYAKU}.koku`;
const NEW_SCHOOL = 'wombat_ryu';
const NEW_SECTION = `${NEW_SCHOOL}.taijutsu.wombat_kihon`;
const created: Record<string, string> = {};

const fresh = (romaji: string, kanji = '') => ({ new: { romaji, kanji } });
async function propose(page: Page, data: object) {
	const r = await page.request.post('api/catalog/proposals', { data });
	expect(r.status(), await r.text()).toBe(201);
	return (await r.json()) as { technique: string };
}
async function catalogTechnique(page: Page, id: string) {
	const catalog = await (await page.request.get('api/catalog')).json();
	return catalog.techniques.find((t: { id: string }) => t.id === id);
}
const entryOf = (page: Page, kind: string, id: string): Locator => page.locator(`details[data-key="${kind}:${id}"]`);
async function open(page: Page, kind: string, id: string) {
	const entry = entryOf(page, kind, id);
	if (!(await entry.evaluate((e) => (e as HTMLDetailsElement).open))) await entry.locator('summary').click();
	return entry;
}

test('proposed: a new school with its scroll and technique, three techniques in a known scroll', async ({ page }) => {
	const known = { school: { id: 'gyokko' }, category: { id: 'taijutsu' }, section: { id: JO_RYAKU } };
	created.chain = (
		await propose(page, {
			school: fresh('Wombat Ryu', '袋熊流'),
			category: { id: 'taijutsu' },
			section: fresh('Wombat Kihon'),
			technique: fresh('Wombat Kote')
		})
	).technique;
	expect(created.chain).toBe(`${NEW_SECTION}.wombat_kote`);
	created.used = (await propose(page, { ...known, technique: fresh('Wombat Gaeshi') })).technique;
	created.merge = (await propose(page, { ...known, technique: fresh('Wombat Bis') })).technique;
	created.spare = (await propose(page, { ...known, technique: fresh('Wombat Spare') })).technique;
	const comment = await page.request.post(`api/techniques/${created.used}/comments`, {
		data: { text: 'A wombat comment', lang: 'en' }
	});
	expect(comment.status()).toBe(201);
	// In the catalogue at once, marked.
	await expect.poll(async () => (await catalogTechnique(page, created.used))?.proposed).toBe(true);
});

test('the upload page: a category the school has no scroll in, its scroll and technique added there', async ({
	page
}) => {
	await page.goto('upload');
	await page.getByLabel('Video file').setInputFiles('tests/fixtures/clip.webm');
	const slider = page.getByRole('slider', { name: 'Timeline' });
	await slider.scrollIntoViewIfNeeded();
	const box = (await slider.boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.1, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, y, { steps: 5 });
	await page.mouse.up();
	const segment = page.getByRole('article', { name: 'Segment 1' });
	const select = (label: string) => segment.getByLabel(label);

	// Gyokko Ryu has taijutsu scrolls only: Muto Dori and Buki offered all the same.
	await select('School').selectOption('gyokko');
	await expect(select('Category')).toHaveValue('taijutsu'); // its own, filled in
	await select('Category').selectOption('buki');
	await expect(select('Weapon')).toHaveValue('');
	const { weapons } = await (await page.request.get('api/catalog')).json();
	await expect(select('Weapon').locator('option')).toHaveCount(weapons.length + 2); // every one, Choose… and Other…
	await select('Category').selectOption('muto_dori');
	expect(await select('Scroll or form').locator('option').allTextContents()).toEqual(['Choose…', 'Other…']);
	await select('Scroll or form').selectOption({ label: 'Other…' });
	await segment.locator('[data-new="section"]').getByLabel('Romaji').fill('Wombat Muto');
	await segment.locator('[data-new="technique"]').getByLabel('Romaji').fill('Wombat Dori');
	await segment.getByRole('button', { name: 'Add to the catalogue' }).click();
	const id = 'gyokko.muto_dori.wombat_muto.wombat_dori';
	await expect(select('Technique')).toHaveValue(id);
	await expect(select('Category')).toHaveValue('muto_dori');
	await expect.poll(async () => (await catalogTechnique(page, id))?.proposed, { timeout: 10_000 }).toBe(true);

	// Not submitted: unused, removed again (the tests below resolve every other one).
	for (const [kind, entry] of [
		['technique', id],
		['section', 'gyokko.muto_dori.wombat_muto']
	])
		expect((await page.request.delete(`api/admin/proposals/${kind}/${entry}`)).status()).toBe(204);
});

test('the Options page lists them; one renamed, its meanings given: everything follows', async ({ page }) => {
	await page.goto('options');
	await expect(page.getByRole('heading', { name: 'Proposed entries' })).toBeVisible();
	for (const [kind, id] of [
		['school', NEW_SCHOOL],
		['section', NEW_SECTION],
		['technique', created.chain],
		['technique', created.used]
	])
		await expect(entryOf(page, kind, id)).toBeVisible();

	const used = await open(page, 'technique', created.used);
	await expect(used.locator('summary')).toContainText('Used 1 time(s)');
	await expect(used.getByRole('button', { name: 'Delete' })).toBeDisabled(); // its comment
	await used.getByLabel('Name in the ID').fill('wombat_omote');
	await expect(used.locator('code').last()).toHaveText(`${JO_RYAKU}.wombat_omote`); // the ID it will get
	await used.getByLabel('Kanji', { exact: true }).fill('表');
	await used.getByLabel('Meaning (English)').fill('Front');
	await expect(used.getByRole('button', { name: 'Validate' })).toBeDisabled(); // saved first
	await used.getByRole('button', { name: 'Save' }).click();
	created.used = `${JO_RYAKU}.wombat_omote`;
	await expect(page.getByRole('status').filter({ hasText: 'saved' })).toHaveText(`${created.used} saved.`);
	await expect(entryOf(page, 'technique', created.used)).toBeVisible();

	// Its comment moved with it; the catalogue has its new ID and meaning.
	const comments = await (await page.request.get(`api/techniques/${created.used}/comments`)).json();
	expect(comments.map((c: { text: string }) => c.text)).toEqual(['A wombat comment']);
	await expect
		.poll(async () => (await catalogTechnique(page, created.used))?.description, { timeout: 10_000 })
		.toBe('Front');
});

test('validated parents first, then the technique: ordinary entries from then on', async ({ page }) => {
	await page.goto('options');
	const technique = await open(page, 'technique', created.chain);
	await technique.getByRole('button', { name: 'Validate' }).click();
	await expect(technique.getByRole('alert')).toHaveText(`Validate ${NEW_SECTION} first.`);

	for (const [kind, id] of [
		['school', NEW_SCHOOL],
		['section', NEW_SECTION],
		['technique', created.chain]
	]) {
		const entry = await open(page, kind, id);
		await entry.getByRole('button', { name: 'Validate' }).click();
		await expect(page.getByRole('status').filter({ hasText: 'validated' })).toHaveText(`${id} validated.`);
		await expect(entryOf(page, kind, id)).toHaveCount(0);
	}
	await expect
		.poll(async () => (await catalogTechnique(page, created.chain))?.proposed ?? 'validated', { timeout: 10_000 })
		.toBe('validated');
});

test('merged into Koku, an unused one deleted', async ({ page }) => {
	page.on('dialog', (d) => d.accept());
	await page.goto('options');
	const merged = await open(page, 'technique', created.merge);
	await merged.getByLabel('Merge into').selectOption(KOKU);
	await merged.getByRole('button', { name: 'Merge' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'merged' })).toHaveText(`${created.merge} merged.`);
	await expect(entryOf(page, 'technique', created.merge)).toHaveCount(0);

	const spare = await open(page, 'technique', created.spare);
	await spare.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'deleted' })).toHaveText(`${created.spare} deleted.`);
	await expect.poll(async () => await catalogTechnique(page, created.spare), { timeout: 10_000 }).toBeUndefined();

	// Left to validate: the renamed one.
	const left = await open(page, 'technique', created.used);
	await left.getByRole('button', { name: 'Validate' }).click();
	await expect(page.getByText('No proposed entry.')).toBeVisible();
});
