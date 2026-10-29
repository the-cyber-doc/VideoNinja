import { expect, test, type Page } from '@playwright/test';
import { CATALOG as FULL, KOKU } from '../catalog';

// Writing comments, with a fake API that keeps them (and sorts them as the server:
// last modified first). The logged-in user is kenji.
const CATALOG = { ...FULL, segments: [] };
const PAGE = '/schools/gyokko/taijutsu/jo_ryaku/koku';

interface Comment {
	id: number;
	user: string;
	created_at: string;
	modified_at: string;
	lang: string;
	text: string;
	mine: boolean;
}

async function setup(page: Page, access = ['segment', 'comment']) {
	let now = Date.parse('2027-01-15T09:00:00Z');
	const stamp = () => new Date((now += 60_000)).toISOString().replace('.000Z', '+00:00');
	const comments: Comment[] = [
		{ id: 1, user: 'Hana', created_at: '2027-01-10T09:00:00+00:00', modified_at: '2027-01-10T09:00:00+00:00', lang: 'fr', text: "Celui d'Hana", mine: false },
		{ id: 2, user: 'kenji', created_at: '2027-01-12T09:00:00+00:00', modified_at: '2027-01-12T09:00:00+00:00', lang: 'en', text: 'My old one', mine: true }
	];
	const sent: { method: string; url: string; body: unknown }[] = [];
	const sorted = () => [...comments].sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at));
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({ json: { username: 'kenji', name: null, role: 'user', role_name: 'User', access } })
	);
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.route(`/api/techniques/${KOKU}/comments`, (r) => {
		if (r.request().method() === 'GET') return r.fulfill({ json: sorted() });
		const body = r.request().postDataJSON();
		sent.push({ method: 'POST', url: r.request().url(), body });
		const at = stamp();
		const comment = { id: comments.length + 10, user: 'kenji', created_at: at, modified_at: at, ...body, mine: true };
		comments.push(comment);
		return r.fulfill({ status: 201, json: comment });
	});
	await page.route('/api/comments/*', (r) => {
		const id = Number(r.request().url().split('/').pop());
		const method = r.request().method();
		const body = method === 'PATCH' ? r.request().postDataJSON() : undefined;
		sent.push({ method, url: new URL(r.request().url()).pathname, body });
		const i = comments.findIndex((c) => c.id === id);
		if (method === 'DELETE') {
			comments.splice(i, 1);
			return r.fulfill({ status: 204 });
		}
		comments[i] = { ...comments[i], ...body, modified_at: stamp() };
		return r.fulfill({ json: comments[i] });
	});
	return sent;
}

const list = (page: Page) => page.locator('.comment');

test('add a comment: the button comes first, the new comment on top', async ({ page }) => {
	const sent = await setup(page);
	await page.goto(PAGE);
	const section = page.locator('section', { has: page.getByRole('heading', { name: 'Comments' }) });
	await expect(section.getByRole('button').first()).toHaveText('Add a comment'); // at the beginning
	await expect(list(page)).toHaveText([/My old one/, /Celui d'Hana/]);

	await section.getByRole('button', { name: 'Add a comment' }).click();
	const form = section.locator('form');
	await expect(form.getByLabel('Language of the comment')).toHaveValue('en'); // the UI's language
	await expect(form.getByRole('button', { name: 'Save' })).toBeDisabled(); // nothing written yet
	await form.getByPlaceholder('Your comment').fill('  Keep the elbow low.\nThen turn.  ');
	await form.getByLabel('Language of the comment').selectOption({ label: 'Français' });
	await form.getByRole('button', { name: 'Save' }).click();

	await expect(section.locator('form')).toHaveCount(0);
	await expect(list(page)).toHaveText([/Keep the elbow low/, /My old one/, /Celui d'Hana/]);
	expect(sent).toEqual([
		{ method: 'POST', url: expect.stringMatching(new RegExp(`/api/techniques/${KOKU}/comments$`)), body: { text: 'Keep the elbow low.\nThen turn.', lang: 'fr' } }
	]);
	const added = list(page).first();
	await expect(added.getByRole('img', { name: 'Language: Français' })).toBeVisible();
	await expect(added).toContainText('kenji');
});

test('edit and delete: only on my own comments', async ({ page }) => {
	const sent = await setup(page);
	page.on('dialog', (d) => d.accept());
	await page.goto(PAGE);
	const mine = list(page).filter({ hasText: 'My old one' });
	const hanas = list(page).filter({ hasText: "Celui d'Hana" });
	await expect(mine.getByRole('button')).toHaveText(['Edit', 'Delete']);
	await expect(hanas.getByRole('button')).toHaveCount(0);

	// Edit: the same form, filled; the comment moves to the top, marked as edited.
	await expect(list(page).first()).toContainText('My old one');
	const first = list(page).first(); // by place: while edited, its text is in the form
	await first.getByRole('button', { name: 'Edit' }).click();
	await expect(first.getByPlaceholder('Your comment')).toHaveValue('My old one');
	await first.getByPlaceholder('Your comment').fill('My better one');
	await first.getByRole('button', { name: 'Save' }).click();
	await expect(list(page)).toHaveText([/My better one/, /Celui d'Hana/]);
	await expect(list(page).first()).toContainText('(edited)');
	await expect(list(page).first().locator('time')).toHaveAttribute('datetime', '2027-01-15T09:01:00.000Z'); // the modification time
	await expect(list(page).last()).not.toContainText('(edited)');

	// Cancel leaves it as it was.
	await list(page).first().getByRole('button', { name: 'Edit' }).click();
	await list(page).first().getByPlaceholder('Your comment').fill('Not saved');
	await list(page).first().getByRole('button', { name: 'Cancel' }).click();
	await expect(list(page).first()).toContainText('My better one');

	// Delete, after confirming.
	await list(page).first().getByRole('button', { name: 'Delete' }).click();
	await expect(list(page)).toHaveText([/Celui d'Hana/]);
	expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['PATCH /api/comments/2', 'DELETE /api/comments/2']);
});

test('delete cancelled: nothing sent', async ({ page }) => {
	const sent = await setup(page);
	page.on('dialog', (d) => d.dismiss());
	await page.goto(PAGE);
	await list(page).filter({ hasText: 'My old one' }).getByRole('button', { name: 'Delete' }).click();
	await expect(list(page)).toHaveCount(2);
	expect(sent).toEqual([]);
});

test('without the comment access: no add, edit or delete', async ({ page }) => {
	await setup(page, ['segment']);
	await page.goto(PAGE);
	await expect(list(page)).toHaveCount(2);
	await expect(page.getByRole('button', { name: 'Add a comment' })).toHaveCount(0);
	await expect(list(page).getByRole('button')).toHaveCount(0);
});

test('a failed save keeps the text and says why', async ({ page }) => {
	await setup(page);
	await page.route(`/api/techniques/${KOKU}/comments`, (r) =>
		r.request().method() === 'POST' ? r.fulfill({ status: 403, json: { code: 'auth.access_denied', detail: 'Access denied', params: {} } }) : r.fallback()
	);
	await page.goto(PAGE);
	await page.getByRole('button', { name: 'Add a comment' }).click();
	await page.getByPlaceholder('Your comment').fill('Lost?');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('alert')).toHaveText('You do not have access to this.');
	await expect(page.getByPlaceholder('Your comment')).toHaveValue('Lost?');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto(PAGE);
	await page.getByRole('button', { name: 'Ajouter un commentaire' }).click();
	await expect(page.getByLabel('Langue du commentaire')).toHaveValue('fr');
	await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
	await expect(list(page).filter({ hasText: 'My old one' }).getByRole('button')).toHaveText(['Modifier', 'Supprimer']);
});
