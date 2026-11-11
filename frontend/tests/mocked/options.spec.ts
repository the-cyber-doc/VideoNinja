import { expect, test, type Page } from '@playwright/test';
import { CATALOG } from '../catalog';

// The Options page, API faked (the real one: tests/e2e/options.spec.ts).
const ADMIN = { username: 'admin', name: 'Sensei', role: 'admin', access: ['segment', 'user_mgmt', 'options'] };
const USER = { username: 'kenji', name: null, role: 'user', access: ['segment'] };

const PLACE = {
	id: 'place',
	names: { en: 'Place', fr: 'Lieu' },
	format: 'list',
	regexp: null,
	hint: null,
	input_mode: 'text',
	min: null,
	max: null,
	values: [
		{ id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' }, used: 3 },
		{ id: 'beach', names: { en: 'Beach', fr: 'Plage' }, used: 0 }
	],
	used: 3
};
const YEAR = {
	...PLACE,
	id: 'year',
	names: { en: 'Year', fr: 'Année' },
	format: 'regexp',
	regexp: '[12][0-9]{3}',
	hint: { en: 'A year, e.g. 2024', fr: 'Une année, par ex. 2024' },
	input_mode: 'numeric',
	values: [],
	used: 0
};

async function open(page: Page, user: object = ADMIN, tags: object[] = [PLACE, YEAR], proposals: object[] = []) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
	await page.route('/api/admin/tags', (r) => r.fulfill({ json: tags }));
	await page.route('/api/admin/proposals', (r) => r.fulfill({ json: proposals }));
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.goto('/options');
}

const tag = (page: Page, name: string) =>
	page.locator('details.tag', { has: page.locator('summary', { hasText: name }) });

test('without the options access: back to the home page', async ({ page }) => {
	await open(page, USER);
	await expect(page).toHaveURL('/');
});

test('the tags, collapsed, with their format and use', async ({ page }) => {
	await open(page);
	await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
	await expect(page.locator('details.tag summary')).toHaveText([
		/Place\s*place\s*One of a list\s*uses: 3/,
		/Year\s*year\s*Text matching a regular expression/
	]);
	await expect(page.getByLabel('ID', { exact: true }).first()).toBeHidden(); // collapsed
});

test('a list: values, translation IDs following the IDs, save', async ({ page }) => {
	let sent: unknown = null;
	await page.route('/api/admin/tags/place', (r) => {
		sent = r.request().postDataJSON();
		return r.fulfill({ json: { ...PLACE, ...(sent as object), values: PLACE.values } });
	});
	await open(page);
	const place = tag(page, 'Place');
	await place.locator('summary').click();
	const save = place.getByRole('button', { name: 'Save' });
	await expect(save).toBeDisabled(); // nothing changed
	await expect(place.getByText('tag.place.name')).toBeVisible();
	await expect(place.getByText('tag_value.place.dojo.name')).toBeVisible();
	await expect(place.getByText('uses: 3').last()).toBeVisible();

	// The tag's ID changes the value's translation ID too, as typed.
	await place.getByLabel('ID', { exact: true }).fill('venue');
	await expect(place.getByText('tag.venue.name')).toBeVisible();
	await expect(place.getByText('tag_value.venue.dojo.name')).toBeVisible();
	await expect(place.getByText('not saved')).toBeVisible();

	await place.getByRole('button', { name: 'Add a value' }).click();
	const added = place.locator('.value').last();
	await expect(added.getByText('tag_value.venue..name')).toBeVisible();
	await expect(place.getByText("Each value's ID: letters, digits, _ and - only.")).toBeVisible();
	await expect(save).toBeDisabled();
	await added.getByLabel('Value ID').fill('hall');
	await expect(added.getByText('tag_value.venue.hall.name')).toBeVisible();
	await added.getByLabel('Name (English)').fill('Hall');
	await added.getByLabel('Name (Français)').fill('Salle');
	await place.locator('.value').nth(1).getByRole('button', { name: 'Remove the value beach' }).click();
	await save.click();
	await expect(place.getByRole('status')).toHaveText('Saved.');
	expect(sent).toEqual({
		id: 'venue',
		names: { en: 'Place', fr: 'Lieu' },
		format: 'list',
		regexp: null,
		hint: null,
		input_mode: 'text',
		min: null,
		max: null,
		values: [
			{ id: 'dojo', previous_id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' } },
			{ id: 'hall', previous_id: null, names: { en: 'Hall', fr: 'Salle' } }
		]
	});
});

test('the format chooses the panel', async ({ page }) => {
	await open(page);
	const place = tag(page, 'Place');
	await place.locator('summary').click();
	const format = place.getByLabel('Value', { exact: true });
	await format.selectOption({ label: 'Text matching a regular expression' });
	await expect(place.getByRole('group', { name: 'Regular expression' })).toBeVisible();
	await expect(place.getByRole('group', { name: /^Values/ })).toHaveCount(0);
	await expect(place.getByText('tag.place.hint')).toBeVisible();
	await format.selectOption({ label: 'Free text' });
	await expect(place.getByRole('group', { name: 'Regular expression' })).toHaveCount(0);
	await expect(place.getByRole('group', { name: 'Input' })).toBeVisible();
	await format.selectOption({ label: 'No value' });
	await expect(place.getByRole('group', { name: 'Input' })).toHaveCount(0);
	await place.getByRole('button', { name: 'Discard the changes' }).click();
	await expect(place.getByRole('group', { name: /^Values/ })).toBeVisible();
});

test('a regular expression: invalid blocks the save; the test field tells', async ({ page }) => {
	await open(page);
	const year = tag(page, 'Year');
	await year.locator('summary').click();
	const regexp = year.getByLabel('Expression', { exact: true });
	const tryIt = year.getByLabel('Try a value');
	const save = year.getByRole('button', { name: 'Save' });

	await tryIt.fill('2024');
	await expect(year.getByRole('status')).toHaveText('Accepted.');
	await tryIt.fill('0999');
	await expect(year.getByRole('status')).toHaveText('Year: the value does not have the expected form.');

	await regexp.fill('[12[0-9]{3}');
	await expect(regexp).toHaveAttribute('aria-invalid', 'true');
	await expect(year.getByText('This is not a valid regular expression.')).toBeVisible();
	await expect(tryIt).toBeDisabled();
	await expect(save).toBeDisabled();

	await regexp.fill('[0-9]{4}');
	await expect(tryIt).toBeEnabled();
	await expect(year.getByRole('status')).toHaveText('Accepted.');
	// Numbers: their bounds are tried too.
	await year.getByLabel('Maximum').fill('500');
	await expect(year.getByRole('status')).toHaveText('Year: enter a number from … to 500.');
	await expect(save).toBeEnabled();
});

test('a new tag: problems listed until it can be created; a refusal shown', async ({ page }) => {
	await open(page, ADMIN, [PLACE]);
	// Added last: answers before open()'s route.
	await page.route('/api/admin/tags', (r) =>
		r.request().method() === 'POST'
			? r.fulfill({
					status: 409,
					json: { code: 'tag.exists', detail: '', params: { tag: 'place' } }
				})
			: r.fulfill({ json: [PLACE] })
	);
	await page.getByRole('button', { name: 'New tag' }).click();
	const added = page.locator('details.tag').first();
	await expect(added).toHaveAttribute('open', '');
	await expect(added.getByText('The ID: lowercase letters, digits and _ only.')).toBeVisible();
	await expect(added.getByText('A name is needed in every language.')).toBeVisible();
	await added.getByLabel('ID', { exact: true }).fill('place');
	await added.getByLabel('Name (English)').fill('Place');
	await added.getByLabel('Name (Français)').fill('Lieu');
	await added.getByLabel('Value', { exact: true }).selectOption({ label: 'No value' });
	await added.getByRole('button', { name: 'Save' }).click();
	await expect(added.getByRole('alert')).toHaveText('A tag with the ID place exists already.');
	await added.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.locator('details.tag')).toHaveCount(1);
});

test('delete: confirmed, then refused while in use', async ({ page }) => {
	await page.route('/api/admin/tags/place', (r) =>
		r.fulfill({ status: 409, json: { code: 'tag.in_use', detail: '', params: { tag: 'place', count: 3 } } })
	);
	const dialogs: string[] = [];
	page.on('dialog', (d) => (dialogs.push(d.message()), d.accept()));
	await open(page);
	const place = tag(page, 'Place');
	await place.locator('summary').click();
	await place.getByRole('button', { name: 'Delete the tag' }).click();
	expect(dialogs[0]).toContain('Delete the tag Place?');
	await expect(place.getByRole('alert')).toHaveText('place cannot be deleted: videos or segments use it (3).');
});

test('long lists get a filter', async ({ page }) => {
	const values = Array.from({ length: 12 }, (_, i) => ({
		id: `v${i}`,
		names: { en: `Value ${i}`, fr: `Valeur ${i}` },
		used: 0
	}));
	await open(page, ADMIN, [{ ...PLACE, values }]);
	const place = tag(page, 'Place');
	await place.locator('summary').click();
	await expect(place.locator('.value')).toHaveCount(12);
	await place.getByLabel('Filter the values').fill('valeur 11');
	await expect(place.locator('.value')).toHaveCount(1);
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await open(page);
	await expect(page.getByRole('heading', { name: 'Étiquettes' })).toBeVisible();
	const year = tag(page, 'Année');
	await year.locator('summary').click();
	await expect(year.getByLabel('Indication (Français)')).toHaveValue('Une année, par ex. 2024');
	await year.getByLabel('Essayer une valeur').fill('99');
	await expect(year.getByRole('status')).toHaveText("Année : la valeur n'a pas la forme attendue.");
});

// --- proposed catalogue entries (the whole flow on the real backend: tests/e2e/proposals.spec.ts) ---

const KIHON = {
	kind: 'section',
	id: 'gyokko.taijutsu.kihon',
	name: 'kihon',
	kanji: '',
	romaji: 'Kihon',
	ryu: 'gyokko',
	category: 'taijutsu',
	weapon: null,
	section: null,
	descriptions: { en: '', fr: '' },
	used: 0,
	children: 1,
	proposed_by: null,
	proposed_at: '2026-11-10T10:00:00+01:00'
};

test('a proposed scroll: its parents, a weapon under Buki, its new ID; saved as a whole', async ({ page }) => {
	await open(page, ADMIN, [PLACE], [KIHON]);
	const bodies: unknown[] = [];
	await page.route('/api/admin/proposals/section/*', (r) => {
		bodies.push(r.request().postDataJSON());
		return r.fulfill({ json: { ...KIHON, id: 'gyokko.buki.hanbo.kihon', category: 'buki', weapon: 'hanbo' } });
	});
	const entry = page.locator('details[data-key="section:gyokko.taijutsu.kihon"]');
	await expect(entry.locator('summary')).toContainText('1 entr(y/ies) under it');
	await entry.locator('summary').click();
	await expect(entry).toContainText('Proposed by a deleted user');
	await expect(entry.getByRole('button', { name: 'Delete' })).toBeDisabled(); // a technique under it
	await expect(entry.getByLabel('Weapon')).toHaveCount(0);

	await entry.getByLabel('Category').selectOption('buki');
	await expect(entry.getByText('Under Buki, choose its weapon.')).toBeVisible();
	await expect(entry.getByRole('button', { name: 'Save' })).toBeDisabled();
	await entry.getByLabel('Weapon').selectOption('hanbo');
	await expect(entry.locator('code').last()).toHaveText('gyokko.buki.hanbo.kihon');
	await entry.getByLabel('Meaning (Français)').fill('Les bases');
	await expect(entry.getByText('Give the English meaning too.')).toBeVisible();
	await entry.getByLabel('Meaning (English)').fill('Basics');
	await entry.getByRole('button', { name: 'Save' }).click();
	expect(bodies).toEqual([
		{
			name: 'kihon',
			kanji: '',
			romaji: 'Kihon',
			parents: { ryu: 'gyokko', category: 'buki', weapon: 'hanbo' },
			descriptions: { en: 'Basics', fr: 'Les bases' }
		}
	]);
});
