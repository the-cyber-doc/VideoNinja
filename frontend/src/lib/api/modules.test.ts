// The API modules: each function's method, URL and body, and what it returns from the
// answer (the server's own tests check the answers themselves).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as about from './about';
import * as auth from './auth';
import * as catalog from './catalog';
import { ApiError } from './client';
import * as comments from './comments';
import * as performers from './performers';
import * as profile from './profile';
import * as register from './register';
import * as setup from './setup';
import * as tags from './tags';
import * as uploads from './uploads';
import * as users from './users';
import * as videos from './videos';

type Sent = { method: string; path: string; body: unknown };

/** fetch answering `answer` (JSON, or 204 when undefined); returns what was sent. */
function server(answer?: unknown, status = 200): Sent[] {
	const sent: Sent[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit) => {
			sent.push({
				method: init.method!,
				path,
				body: init.body === undefined ? undefined : JSON.parse(String(init.body))
			});
			return answer === undefined ? new Response(null, { status: 204 }) : Response.json(answer, { status });
		})
	);
	return sent;
}

afterEach(() => vi.unstubAllGlobals());

const IN = { text: 'Keep the elbow low', lang: 'en' as const };

// [name, call, method, path, body]
const CALLS: [string, () => Promise<unknown>, string, string, unknown][] = [
	['about', about.getAbout, 'GET', '/api/about', undefined],
	[
		'login',
		() => auth.login({ username: 'a', password: 'p', totp_code: '1' }),
		'POST',
		'/api/auth/login',
		{ username: 'a', password: 'p', totp_code: '1' }
	],
	['logout', auth.logout, 'POST', '/api/auth/logout', {}],
	['catalog', catalog.getCatalog, 'GET', '/api/catalog', undefined],
	['comments', () => comments.listComments('gyokko.a/b'), 'GET', '/api/techniques/gyokko.a%2Fb/comments', undefined],
	['add comment', () => comments.addComment('koku', IN), 'POST', '/api/techniques/koku/comments', IN],
	['edit comment', () => comments.editComment(3, IN), 'PATCH', '/api/comments/3', IN],
	['delete comment', () => comments.deleteComment(3), 'DELETE', '/api/comments/3', undefined],
	['performers', performers.listPerformers, 'GET', '/api/performers', undefined],
	['add performer', () => performers.addPerformer('Hatsumi'), 'POST', '/api/performers', { name: 'Hatsumi' }],
	['name', () => profile.setName('Kenji'), 'POST', '/api/profile/name', { name: 'Kenji' }],
	[
		'password',
		() => profile.setPassword({ current_password: 'a', new_password: 'b' }),
		'POST',
		'/api/profile/password',
		{ current_password: 'a', new_password: 'b' }
	],
	['new totp', profile.newTotp, 'POST', '/api/profile/totp', {}],
	[
		'confirm totp',
		() => profile.confirmTotp({ current_password: 'a', totp_secret: 's', totp_code: '1' }),
		'POST',
		'/api/profile/totp/confirm',
		{ current_password: 'a', totp_secret: 's', totp_code: '1' }
	],
	['verify invite', () => register.verifyInvite('tok'), 'POST', '/api/register/verify', { token: 'tok' }],
	['invite totp', () => register.newTotp('tok'), 'POST', '/api/register/totp', { token: 'tok' }],
	[
		'register',
		() => register.complete({ token: 'tok', name: 'Kenji', password: 'p', totp_secret: 's', totp_code: '1' }),
		'POST',
		'/api/register/complete',
		{ token: 'tok', name: 'Kenji', password: 'p', totp_secret: 's', totp_code: '1' }
	],
	['verify setup token', () => setup.verifyToken('tok'), 'POST', '/api/setup/verify', { token: 'tok' }],
	['setup totp', () => setup.newTotp('tok', 'admin'), 'POST', '/api/setup/totp', { token: 'tok', username: 'admin' }],
	['tags', tags.listTags, 'GET', '/api/tags', undefined],
	['limits', uploads.uploadLimits, 'GET', '/api/uploads/limits', undefined],
	[
		'submit',
		() => uploads.submit('a/b', { original_filename: 'k.mp4', all_segments_done: true, segments: [], tags: [] }),
		'POST',
		'/api/uploads/a%2Fb/submit',
		{ original_filename: 'k.mp4', all_segments_done: true, segments: [], tags: [] }
	],
	['my uploads', uploads.myUploads, 'GET', '/api/uploads/mine', undefined],
	['retry', () => uploads.retry(4), 'POST', '/api/videos/4/retry', {}],
	['remove', () => uploads.remove(4), 'DELETE', '/api/videos/4', undefined],
	['users', users.listUsers, 'GET', '/api/admin/users', undefined],
	['roles', users.listRoles, 'GET', '/api/admin/roles', undefined],
	[
		'create user',
		() => users.createUser({ username: 'kenji', role: 'user' }),
		'POST',
		'/api/admin/users',
		{ username: 'kenji', role: 'user' }
	],
	['invite', () => users.getInvite(2), 'GET', '/api/admin/users/2/invite', undefined],
	['reset', () => users.resetUser(2), 'POST', '/api/admin/users/2/reset', {}],
	['videos', videos.listVideos, 'GET', '/api/videos', undefined],
	['annotations', () => videos.getAnnotations(5), 'GET', '/api/videos/5/annotations', undefined],
	[
		'save annotations',
		() => videos.saveAnnotations(5, { all_segments_done: false, segments: [], tags: [] }),
		'PUT',
		'/api/videos/5/annotations',
		{ all_segments_done: false, segments: [], tags: [] }
	]
];

describe('API modules', () => {
	it.each(CALLS)('%s', async (_, call, method, path, body) => {
		const sent = server({ ok: true });
		expect(await call()).toEqual({ ok: true });
		expect(sent).toEqual([{ method, path, body }]);
	});

	it('read the field they promise', async () => {
		server({ initialized: true });
		expect(await setup.isInitialized()).toBe(true);
		server({ available: false });
		expect(await uploads.uploadsAvailable()).toBe(false);
		const sent = server({ exists: true });
		expect(await uploads.videoExists('ab12')).toBe(true);
		expect(sent[0].path).toBe('/api/videos/exists?original_sha256=ab12');
	});

	it('the logged-in user, or null when nobody is', async () => {
		server({ id: 1, username: 'admin' });
		expect(await auth.currentUser()).toEqual({ id: 1, username: 'admin' });
		server({ code: 'auth.not_logged_in', detail: '…', params: {} }, 401);
		expect(await auth.currentUser()).toBeNull();
		server({ code: 'internal', detail: '…', params: {} }, 500);
		await expect(auth.currentUser()).rejects.toBeInstanceOf(ApiError);
	});

	it("the setup's progress, line by line", async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"step":"schema"}\n{"step":"done"}\n'))
		);
		const lines = [];
		for await (const line of setup.complete({
			token: 't',
			username: 'admin',
			name: 'Admin',
			password: 'p',
			totp_secret: 's',
			totp_code: '1'
		}))
			lines.push(line);
		expect(lines).toEqual([{ step: 'schema' }, { step: 'done' }]);
	});
});
