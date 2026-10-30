import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/client.js';
import { UserAdmin } from './users.svelte';

const mocks = vi.hoisted(() => ({
	invalidate: vi.fn(async () => {}),
	createUser: vi.fn(),
	getInvite: vi.fn(),
	resetUser: vi.fn()
}));
vi.mock('$app/navigation', () => ({ invalidate: mocks.invalidate }));
vi.mock('#lib/api/users.js', () => ({
	createUser: mocks.createUser,
	getInvite: mocks.getInvite,
	resetUser: mocks.resetUser
}));

const invite = { token: 'tok', expires_at: '2026-11-05T10:00:00+01:00' };
const kenji = { id: 2, username: 'kenji' } as never;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	writeText = vi.fn(async () => {});
	vi.stubGlobal('location', new URL('https://app.test/admin/users'));
	vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

describe('user management actions', () => {
	it('create: the invitation link shown and copied, the list reloaded', async () => {
		mocks.createUser.mockResolvedValue(invite);
		const admin = new UserAdmin();
		expect(await admin.create('kenji', 'user')).toBe(true);
		expect(mocks.createUser).toHaveBeenCalledWith({ username: 'kenji', role: 'user' });
		expect(admin.link).toEqual({
			username: 'kenji',
			url: 'https://app.test/register#tok',
			expires_at: invite.expires_at,
			copied: true
		});
		expect(writeText).toHaveBeenCalledWith('https://app.test/register#tok');
		expect(mocks.invalidate).toHaveBeenCalledWith('app:users');
		expect(admin.busy).toBe(false);
	});

	it('the link again, without the clipboard: shown to copy by hand', async () => {
		mocks.getInvite.mockResolvedValue(invite);
		writeText.mockRejectedValue(new Error('denied'));
		const admin = new UserAdmin();
		expect(await admin.copyInvite(kenji)).toBe(true);
		expect(admin.link?.copied).toBe(false);
		expect(mocks.invalidate).not.toHaveBeenCalled();
	});

	it('reset: a new link, the list reloaded; a failure kept for the page', async () => {
		mocks.resetUser.mockResolvedValue(invite);
		const admin = new UserAdmin();
		expect(await admin.reset(kenji)).toBe(true);
		expect(mocks.resetUser).toHaveBeenCalledWith(2);
		expect(mocks.invalidate).toHaveBeenCalledWith('app:users');
		const refused = new ApiError(403, 'auth.access_denied');
		mocks.resetUser.mockRejectedValue(refused);
		expect(await admin.reset(kenji)).toBe(false);
		expect([admin.error, admin.busy]).toEqual([refused, false]);
	});
});
